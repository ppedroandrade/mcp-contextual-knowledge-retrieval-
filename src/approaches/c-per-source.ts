import type { Hit, Retriever, SourceName } from '../core/types.js';
import type { Embedder } from '../indexing/embeddings.js';
import type { VectorStore } from '../indexing/vector-store.js';
import { reciprocalRankFusion } from '../retrieval/fusion.js';
import { toHit } from './units.js';

/** Busca vetorial em uma fonte. É a mesma função que o servidor MCP expõe como tool (D). */
export async function searchSource(embedder: Embedder, store: VectorStore, source: SourceName, query: string, k: number): Promise<Hit[]> {
  const [v] = await embedder.embed([query]);
  return (await store.search(v!, k, source)).map((h) => toHit(h.unit, h.score));
}

/**
 * Configuração C — controle (ADR 005): busca por fonte + RRF, em processo, sem MCP.
 * Difere de B só na estratégia e de D só no protocolo.
 */
export function createPerSourceRetriever(embedder: Embedder, store: VectorStore, sources: SourceName[]): Retriever {
  return {
    name: 'C-por-fonte',
    async search(query, k) {
      const lists = await Promise.all(sources.map((s) => searchSource(embedder, store, s, query, k)));
      return reciprocalRankFusion(lists, k);
    },
  };
}
