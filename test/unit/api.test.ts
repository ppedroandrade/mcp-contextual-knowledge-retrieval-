import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBm25Retriever } from '../../src/approaches/a-bm25.js';
import { createGlobalVectorRetriever } from '../../src/approaches/b-rag.js';
import { createPerSourceRetriever } from '../../src/approaches/c-per-source.js';
import { createMcpRetriever } from '../../src/approaches/d-mcp-rag.js';
import { createDemoHandler } from '../../src/api/app.js';
import type { Retriever, SourceName } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { SimulatedProvider } from '../../src/generation/simulated.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';
import { ingest } from '../../src/indexing/ingest.js';
import { MemoryVectorStore } from '../../src/indexing/vector-store.js';
import { createKnowledgeServer } from '../../src/mcp/server.js';
import { parseSource } from '../../src/sources/index.js';

const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
const corpus = buildCorpus();
const units = sources.flatMap((s) => parseSource(s, corpus.files));
let server: Server;
let base: string;
let d: Retriever;

beforeAll(async () => {
  const embedder = new HashEmbedder();
  const store = new MemoryVectorStore();
  await ingest(units, embedder, store);
  const mcp = createKnowledgeServer(embedder, store, sources);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverT);
  d = await createMcpRetriever(clientT);
  const handler = createDemoHandler({
    units, sources, llm: new SimulatedProvider(), mode: { embedder: 'hash', store: 'memory', llm: 'simulado' },
    retrievers: { A: createBm25Retriever(units), B: createGlobalVectorRetriever(embedder, store), C: createPerSourceRetriever(embedder, store, sources), D: d },
    staticDir: join(import.meta.dirname, '..', '..', 'apps', 'demo'),
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await d?.close?.();
  await new Promise((ok) => server?.close(ok));
});

const post = (body: unknown) => fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('API da demonstração', () => {
  it('lista as abordagens; A não gera resposta', async () => {
    const cfg = await (await fetch(`${base}/api/config`)).json();
    expect(cfg.approaches.map((a: { id: string }) => a.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(cfg.approaches.find((a: { id: string }) => a.id === 'A').generates).toBe(false);
  });

  it('lista as fontes com todos os documentos e unidades', async () => {
    const { sources: list } = await (await fetch(`${base}/api/sources`)).json();
    expect(list.map((s: { source: string }) => s.source)).toEqual(sources);
    const total = list.reduce((n: number, s: { unitCount: number }) => n + s.unitCount, 0);
    expect(total).toBe(units.length);
  });

  it('abre um trecho pelo id e devolve 404 para id desconhecido', async () => {
    const u = units[0]!;
    const got = await (await fetch(`${base}/api/units/${encodeURIComponent(u.id)}`)).json();
    expect(got).toMatchObject({ id: u.id, text: u.text, source: u.source });
    expect((await fetch(`${base}/api/units/NAO-EXISTE%23x`)).status).toBe(404);
  });

  it('D responde com os mesmos trechos e a mesma resposta de C (mesmo caminho do benchmark)', async () => {
    const q = corpus.questions.dev[0]!.text;
    const [c, dd] = await Promise.all([post({ question: q, approach: 'C' }).then((r) => r.json()), post({ question: q, approach: 'D' }).then((r) => r.json())]);
    expect(dd.passages.map((p: { unitId: string }) => p.unitId)).toEqual(c.passages.map((p: { unitId: string }) => p.unitId));
    expect(dd.answer.text).toBe(c.answer.text);
    expect(dd.passages).toHaveLength(5);
    expect(dd.answer.citedUnitIds[0]).toBe(dd.passages[0].unitId);
  });

  it('A devolve só os trechos, sem resposta', async () => {
    const r = await (await post({ question: 'endpoint de saúde do billing-api', approach: 'A' })).json();
    expect(r.answer).toBeNull();
    expect(r.passages.length).toBeGreaterThan(0);
  });

  it('valida a entrada', async () => {
    expect((await post({ question: '', approach: 'B' })).status).toBe(400);
    expect((await post({ question: 'x', approach: 'Z' })).status).toBe(400);
    expect((await post({ question: 'x'.repeat(501), approach: 'B' })).status).toBe(400);
    expect((await fetch(`${base}/api/ask`, { method: 'POST', body: '{' })).status).toBe(400);
  });

  it('entrega o front e não sai da pasta estática', async () => {
    const html = await fetch(`${base}/`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('<script type="module" src="app.js">');
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/.env`)).status).toBe(404);
  });
});
