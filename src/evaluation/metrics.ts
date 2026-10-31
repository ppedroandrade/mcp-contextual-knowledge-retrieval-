import type { Hit, Question } from '../core/types.js';

/** Documentos na ordem da primeira aparição no ranking de unidades. */
export function rankedDocs(hits: Hit[]): string[] {
  return [...new Set(hits.map((h) => h.docId))];
}

export function precisionAtK(docs: string[], relevant: string[], k: number): number {
  const rel = new Set(relevant);
  return docs.slice(0, k).filter((d) => rel.has(d)).length / k;
}

export function recallAtK(docs: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return NaN;
  const top = new Set(docs.slice(0, k));
  return relevant.filter((d) => top.has(d)).length / relevant.length;
}

export function reciprocalRank(docs: string[], relevant: string[], k: number): number {
  const rel = new Set(relevant);
  const i = docs.slice(0, k).findIndex((d) => rel.has(d));
  return i < 0 ? 0 : 1 / (i + 1);
}

/** nDCG@k binário. */
export function ndcgAtK(docs: string[], relevant: string[], k: number): number {
  const rel = new Set(relevant);
  const dcg = docs.slice(0, k).reduce((s, d, i) => s + (rel.has(d) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(rel.size, k) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return ideal === 0 ? NaN : dcg / ideal;
}

/** Fração das evidências necessárias satisfeitas por alguma unidade do top-k (ER@k). */
export function evidenceRecallAtK(hits: Hit[], evidence: string[][], k: number): number {
  if (evidence.length === 0) return NaN;
  const top = new Set(hits.slice(0, k).map((h) => h.unitId));
  return evidence.filter((alts) => alts.some((u) => top.has(u))).length / evidence.length;
}

/** Maior Precision@k possível para a pergunta (limita a leitura da métrica). */
export const maxPrecisionAtK = (relevant: string[], k: number) => Math.min(relevant.length, k) / k;

export interface RetrievalScores {
  precision: number;
  recall: number;
  mrr: number;
  ndcg: number;
  evidenceRecall: number;
  /** 1 se todas as evidências necessárias estão no top-k. */
  evidenceComplete: number;
}

/** Métricas no nível do documento (P, R, MRR, nDCG) e da unidade (ER, completude). */
export function scoreRetrieval(q: Question, hits: Hit[], k: number): RetrievalScores {
  const docs = rankedDocs(hits);
  const er = evidenceRecallAtK(hits, q.evidence, k);
  return {
    precision: precisionAtK(docs, q.relevantDocIds, k),
    recall: recallAtK(docs, q.relevantDocIds, k),
    mrr: reciprocalRank(docs, q.relevantDocIds, k),
    ndcg: ndcgAtK(docs, q.relevantDocIds, k),
    evidenceRecall: er,
    evidenceComplete: Number.isNaN(er) ? NaN : er === 1 ? 1 : 0,
  };
}

export const mean = (xs: number[]) => {
  const v = xs.filter((x) => !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};

/** Mediana das rodadas de latência (com n par, o maior dos dois valores centrais). */
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
