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

describe('H3: integração da 4ª fonte', () => {
  it('o host passa a usar a fonte nova sem nenhuma mudança no código do host', async () => {
    const { clientT } = await setup(['docs', 'tickets', 'incidents', 'policies']);
    const d = await createMcpRetriever(clientT);
    expect(d.tools).toContain('buscar_policies');
    const hits = await d.search('prazo de primeira resposta SEV1 plantão', 5);
    expect(hits.some((h) => h.source === 'policies')).toBe(true);
    await d.close?.();
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
