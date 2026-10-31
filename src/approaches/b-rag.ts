import type { Retriever } from '../core/types.js';
import type { Embedder } from '../indexing/embeddings.js';
import type { VectorStore } from '../indexing/vector-store.js';
import { toHit } from './units.js';

/**
 * Configuração B — RAG tradicional: uma busca vetorial no índice único com as unidades de
 * todas as fontes. A geração de resposta é a mesma de C e D (etapa `generation`).
 */
export function createGlobalVectorRetriever(embedder: Embedder, store: VectorStore): Retriever {
  return {
    name: 'B-rag',
    async search(query, k) {
      const [v] = await embedder.embed([query]);
      return (await store.search(v!, k)).map((h) => toHit(h.unit, h.score));
    },
  };
}
