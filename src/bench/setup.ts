import type { EvidenceUnit, Retriever, SourceName } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { createBm25Retriever } from '../approaches/a-bm25.js';
import { createGlobalVectorRetriever } from '../approaches/b-rag.js';
import { createPerSourceRetriever } from '../approaches/c-per-source.js';
import { HashEmbedder, OllamaEmbedder, type Embedder } from '../indexing/embeddings.js';
import { ingest } from '../indexing/ingest.js';
import { PgVectorStore } from '../indexing/pgvector.js';
import { MemoryVectorStore, type VectorStore } from '../indexing/vector-store.js';

export type EmbedderKind = 'ollama' | 'hash';
export type StoreKind = 'pg' | 'memory';

export function makeEmbedder(kind: EmbedderKind): Embedder {
  const cfg = loadConfig();
  return kind === 'ollama' ? new OllamaEmbedder(cfg.ollamaUrl, cfg.embeddingModel) : new HashEmbedder();
}

/** Nome da tabela derivado do modelo e das fontes, para índices diferentes não se misturarem. */
export function tableName(embedder: Embedder, sources: SourceName[]): string {
  return `units_${embedder.name}_${sources.join('_')}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * Abre o armazenamento vetorial. Em memória, indexa na hora. No pgvector, reaproveita a
 * tabela se ela já tiver todas as unidades (rode `npm run ingest` antes).
 */
export async function openStore(kind: StoreKind, embedder: Embedder, units: EvidenceUnit[], sources: SourceName[]): Promise<VectorStore> {
  if (kind === 'memory') {
    const store = new MemoryVectorStore();
    await ingest(units, embedder, store);
    return store;
  }
  const [probe] = await embedder.embed(['dimensão']);
  const store = await PgVectorStore.open(loadConfig().pgUrl, tableName(embedder, sources), probe!.length);
  const n = await store.count();
  if (n !== units.length) {
    await store.close();
    throw new Error(`tabela ${tableName(embedder, sources)} tem ${n} unidades, esperado ${units.length}; rode npm run ingest`);
  }
  return store;
}

export function makeRetrievers(names: string[], units: EvidenceUnit[], embedder: Embedder | null, store: VectorStore | null, sources: SourceName[]): Retriever[] {
  return names.map((n) => {
    if (n === 'A') return createBm25Retriever(units);
    if (!embedder || !store) throw new Error(`a abordagem ${n} precisa de embeddings`);
    if (n === 'B') return createGlobalVectorRetriever(embedder, store);
    if (n === 'C') return createPerSourceRetriever(embedder, store, sources);
    throw new Error(`abordagem desconhecida: ${n}`);
  });
}
