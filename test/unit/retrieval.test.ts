import { describe, expect, it } from 'vitest';
import { createBm25Retriever } from '../../src/approaches/a-bm25.js';
import { tokenize } from '../../src/core/text.js';
import type { Hit, Question } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { Bm25Index } from '../../src/indexing/bm25.js';
import { evidenceRecallAtK, ndcgAtK, precisionAtK, rankedDocs, recallAtK, reciprocalRank, scoreRetrieval } from '../../src/evaluation/metrics.js';
import { parseSource } from '../../src/sources/index.js';

describe('tokenize', () => {
  it('remove acentos, caixa e stopwords e mantém termos técnicos', () => {
    expect(tokenize('Qual é o endpoint de saúde do billing-api?')).toEqual(['endpoint', 'saude', 'billing', 'api']);
  });
});

describe('BM25', () => {
  const docs = [
    { id: 'd1', t: 'fila de faturas parada' },
    { id: 'd2', t: 'faturas faturas faturas em PDF' },
    { id: 'd3', t: 'login com SSO' },
  ];
  const index = new Bm25Index(docs, (d) => d.t);

  it('ordena por relevância e ignora documentos sem termos em comum', () => {
    const r = index.search('faturas em PDF', 10).map((x) => x.item.id);
    expect(r).toEqual(['d2', 'd1']);
  });

  it('consulta sem termos conhecidos devolve lista vazia', () => {
    expect(index.search('xyz', 10)).toEqual([]);
    expect(index.search('de o a', 10)).toEqual([]);
  });
});

const hit = (unitId: string): Hit => ({ chunkId: unitId, unitId, docId: unitId.split('#')[0]!, source: 'docs', text: '', score: 1 });

describe('métricas', () => {
  const hits = ['D1#a', 'D2#a', 'D1#b', 'D3#a'].map(hit);
  const docs = rankedDocs(hits);

  it('deduplica documentos mantendo a primeira posição', () => {
    expect(docs).toEqual(['D1', 'D2', 'D3']);
  });

  it('calcula P, R, MRR e nDCG no nível do documento', () => {
    expect(precisionAtK(docs, ['D2', 'D9'], 2)).toBe(0.5);
    expect(recallAtK(docs, ['D2', 'D9'], 3)).toBe(0.5);
    expect(reciprocalRank(docs, ['D3'], 5)).toBeCloseTo(1 / 3);
    expect(reciprocalRank(docs, ['D9'], 5)).toBe(0);
    expect(ndcgAtK(docs, ['D1'], 5)).toBe(1);
    expect(ndcgAtK(docs, ['D2'], 5)).toBeCloseTo(1 / Math.log2(3));
  });

  it('ER@k conta evidências necessárias satisfeitas por alguma alternativa', () => {
    expect(evidenceRecallAtK(hits, [['D1#b'], ['D9#a', 'D3#a']], 4)).toBe(1);
    expect(evidenceRecallAtK(hits, [['D1#b'], ['D3#a']], 3)).toBe(0.5);
    expect(evidenceRecallAtK(hits, [], 3)).toBeNaN();
  });

  it('pergunta sem resposta não tem recall definido', () => {
    const q = { relevantDocIds: [], evidence: [] } as unknown as Question;
    const s = scoreRetrieval(q, hits, 5);
    expect(s.recall).toBeNaN();
    expect(s.evidenceRecall).toBeNaN();
  });
});

describe('configuração A (BM25)', () => {
  it('encontra a seção certa para uma pergunta literal do corpus', async () => {
    const c = buildCorpus();
    const units = (['docs', 'tickets', 'incidents'] as const).flatMap((s) => parseSource(s, c.files));
    const a = createBm25Retriever(units);
    const hits = await a.search('Qual comando faz o rollback do auth-service?', 5);
    expect(hits[0]!.unitId).toMatch(/#rollback$/);
    expect(hits[0]!.text).toContain('orbctl rollback auth-service');
  });
});
