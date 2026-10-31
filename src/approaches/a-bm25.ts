import type { EvidenceUnit, Retriever } from '../core/types.js';
import { Bm25Index } from '../indexing/bm25.js';
import { indexText, toHit } from './units.js';

/**
 * Configuração A — busca textual convencional: BM25 em memória sobre as unidades de todas
 * as fontes reunidas num índice único. Não gera resposta.
 */
export function createBm25Retriever(units: EvidenceUnit[]): Retriever {
  const index = new Bm25Index(units, indexText);
  return {
    name: 'A-bm25',
    async search(query, k) {
      return index.search(query, k).map(({ item, score }) => toHit(item, score));
    },
  };
}
