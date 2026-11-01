import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPerSourceRetriever } from '../../src/approaches/c-per-source.js';
import { createMcpRetriever, stdioServerTransport } from '../../src/approaches/d-mcp-rag.js';
import type { Retriever, SourceName } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';
import { ingest } from '../../src/indexing/ingest.js';
import { MemoryVectorStore } from '../../src/indexing/vector-store.js';
import { createKnowledgeServer } from '../../src/mcp/server.js';
import { runRetrieval } from '../../src/bench/retrieval.js';
import { assertMeasurementNode } from '../../src/bench/environment.js';
import { parseSource } from '../../src/sources/index.js';

const corpus = buildCorpus();
const embedder = new HashEmbedder();

async function setup(sources: SourceName[]) {
  const store = new MemoryVectorStore();
  await ingest(sources.flatMap((s) => parseSource(s, corpus.files)), embedder, store);
  const server = createKnowledgeServer(embedder, store, sources);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  return { store, server, clientT };
}

describe('servidor MCP e configuração D (transporte em memória)', () => {
  const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
  let c: Retriever;
  let d: Retriever & { tools: string[] };

  beforeAll(async () => {
    const { store, clientT } = await setup(sources);
    c = createPerSourceRetriever(embedder, store, sources);
    d = await createMcpRetriever(clientT);
  });

  afterAll(async () => {
    await d?.close?.();
  });

  it('o host descobre uma tool por fonte', () => {
    expect(d.tools.sort()).toEqual(['buscar_docs', 'buscar_incidents', 'buscar_tickets']);
  });

  it('C e D dão o mesmo ranking em todas as perguntas do dev', async () => {
    for (const q of corpus.questions.dev) {
      const a = (await c.search(q.text, 5)).map((h) => [h.unitId, h.score]);
      const b = (await d.search(q.text, 5)).map((h) => [h.unitId, h.score]);
      expect(b, q.id).toEqual(a);
    }
  });

  it('valida a entrada da tool', async () => {
    const { clientT } = await setup(['docs']);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(clientT);
    const res = await client.callTool({ name: 'buscar_docs', arguments: { consulta: 'x', k: 500 } });
    expect(res.isError).toBe(true);
    await client.close();
  });
});

describe('tempo da tool dentro de D (ADR 004 e 009)', () => {
  it('cada tool informa o tempo da busca e o bench o registra só para D', async () => {
    const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
    const { store, clientT } = await setup(sources);
    const d = await createMcpRetriever(clientT);
    await d.search('rollback do billing-api', 5);
    expect(d.lastToolMs).toHaveLength(3);
    for (const t of d.lastToolMs) expect(t).toBeGreaterThanOrEqual(0);
    const c = createPerSourceRetriever(embedder, store, sources);
    const rows = await runRetrieval([c, d], corpus.questions.dev.slice(0, 2), 2);
    for (const r of rows.filter((x) => x.retriever === 'D-mcp')) {
      expect(r.toolMs).toHaveLength(2);
      r.toolMs!.forEach((t, i) => expect(t).toBeLessThanOrEqual(r.latencyMs[i]!));
    }
    for (const r of rows.filter((x) => x.retriever === 'C-por-fonte')) expect(r.toolMs).toBeUndefined();
    await d.close?.();
  });
});

describe('versão do Node das medições', () => {
  it('só aceita Node 22, salvo com TCC_ALLOW_ANY_NODE=1', () => {
    expect(() => assertMeasurementNode('v22.23.4', {})).not.toThrow();
    expect(() => assertMeasurementNode('v26.13.0', {})).toThrow(/Node 22/);
    expect(() => assertMeasurementNode('v26.13.0', { TCC_ALLOW_ANY_NODE: '1' })).not.toThrow();
  });
});

describe('servidor MCP via stdio (processo separado)', () => {
  it('responde pelo protocolo real e dá o mesmo resultado que C', async () => {
    const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
    const d = await createMcpRetriever(stdioServerTransport({ sources, embedder: 'hash', store: 'memory' }));
    try {
      const { store } = await setup(sources);
      const c = createPerSourceRetriever(embedder, store, sources);
      const q = 'Qual comando faz o rollback do auth-service?';
      expect((await d.search(q, 5)).map((h) => h.unitId)).toEqual((await c.search(q, 5)).map((h) => h.unitId));
    } finally {
      await d.close?.();
    }
  }, 30_000);
});
