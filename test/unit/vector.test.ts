import { describe, expect, it, vi } from 'vitest';
import { createGlobalVectorRetriever } from '../../src/approaches/b-rag.js';
import { createPerSourceRetriever } from '../../src/approaches/c-per-source.js';
import type { EvidenceUnit, Hit, SourceName } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { HashEmbedder, OllamaEmbedder } from '../../src/indexing/embeddings.js';
import { ingest } from '../../src/indexing/ingest.js';
import { cosine, MemoryVectorStore } from '../../src/indexing/vector-store.js';
import { reciprocalRankFusion } from '../../src/retrieval/fusion.js';
import { parseSource } from '../../src/sources/index.js';

const unit = (id: string, source: SourceName = 'docs'): EvidenceUnit =>
  ({ id, docId: id.split('#')[0]!, source, title: 't', heading: 'h', text: 'x' });

describe('HashEmbedder', () => {
  it('é determinístico e devolve vetores unitários', async () => {
    const e = new HashEmbedder(64);
    const [a, b] = await e.embed(['fila de faturas', 'fila de faturas']);
    expect(a).toEqual(b);
    expect(Math.hypot(...a!)).toBeCloseTo(1);
  });
});

describe('OllamaEmbedder', () => {
  const okFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const input = JSON.parse(String(init!.body)).input as string[];
    return new Response(JSON.stringify({ embeddings: input.map((_, i) => [3, 4 + i * 0]) }));
  });

  it('envia em lotes e normaliza os vetores', async () => {
    okFetch.mockClear();
    const e = new OllamaEmbedder('http://ollama', 'bge-m3', 2, okFetch as unknown as typeof fetch);
    const out = await e.embed(['a', 'b', 'c']);
    expect(okFetch).toHaveBeenCalledTimes(2);
    const [url, init] = okFetch.mock.calls[0]!;
    expect(url).toBe('http://ollama/api/embed');
    expect(JSON.parse(String(init!.body))).toEqual({ model: 'bge-m3', input: ['a', 'b'] });
    expect(out).toEqual([[0.6, 0.8], [0.6, 0.8], [0.6, 0.8]]);
  });

  it('falha com mensagem clara quando o Ollama devolve erro', async () => {
    const bad = (async () => new Response('model not found', { status: 404 })) as unknown as typeof fetch;
    await expect(new OllamaEmbedder('http://o', 'x', 8, bad).embed(['a'])).rejects.toThrow(/404/);
  });

  it('falha se o número de vetores não bate com o de textos', async () => {
    const short = (async () => new Response(JSON.stringify({ embeddings: [[1, 0]] }))) as unknown as typeof fetch;
    await expect(new OllamaEmbedder('http://o', 'x', 8, short).embed(['a', 'b'])).rejects.toThrow(/número de embeddings/);
  });
});

describe('MemoryVectorStore', () => {
  it('ordena por cosseno e filtra por fonte', async () => {
    const s = new MemoryVectorStore();
    await s.upsert([
      { unit: unit('D1#a'), embedding: [1, 0] },
      { unit: unit('T1#a', 'tickets'), embedding: [0.9, 0.1] },
      { unit: unit('D2#a'), embedding: [0, 1] },
    ]);
    expect((await s.search([1, 0], 3)).map((h) => h.unit.id)).toEqual(['D1#a', 'T1#a', 'D2#a']);
    expect((await s.search([1, 0], 3, 'tickets')).map((h) => h.unit.id)).toEqual(['T1#a']);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

const hit = (unitId: string, score = 1): Hit => ({ chunkId: unitId, unitId, docId: unitId.split('#')[0]!, source: 'docs', text: '', score });

describe('RRF', () => {
  it('soma contribuições de itens repetidos e não depende da ordem das listas', () => {
    const l1 = [hit('a'), hit('b')];
    const l2 = [hit('b'), hit('c')];
    const r1 = reciprocalRankFusion([l1, l2], 3).map((h) => h.unitId);
    const r2 = reciprocalRankFusion([l2, l1], 3).map((h) => h.unitId);
    expect(r1[0]).toBe('b');
    expect(r1).toEqual(r2);
  });

  it('com listas disjuntas intercala por posição, desempatando pela pontuação original', () => {
    const r = reciprocalRankFusion([[hit('a', 0.5), hit('b', 0.4)], [hit('x', 0.9), hit('y', 0.1)]], 4);
    expect(r.map((h) => h.unitId)).toEqual(['x', 'a', 'b', 'y']);
  });
});

describe('configurações B e C (com embedding de teste)', async () => {
  const c = buildCorpus();
  const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
  const units = sources.flatMap((s) => parseSource(s, c.files));
  const embedder = new HashEmbedder();
  const store = new MemoryVectorStore();
  await ingest(units, embedder, store);

  it('B encontra a unidade com o mesmo vocabulário da pergunta', async () => {
    const hits = await createGlobalVectorRetriever(embedder, store).search('rollback auth-service orbctl', 5);
    expect(hits[0]!.unitId).toMatch(/#rollback$/);
  });

  it('C traz resultados de mais de uma fonte e só itens das listas por fonte', async () => {
    const hits = await createPerSourceRetriever(embedder, store, sources).search('fila de faturas parada', 9);
    expect(new Set(hits.map((h) => h.source)).size).toBeGreaterThan(1);
    expect(hits).toHaveLength(9);
  });
});
