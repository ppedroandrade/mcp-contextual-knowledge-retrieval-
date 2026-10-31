import type { EvidenceUnit } from '../core/types.js';
import { indexText } from '../approaches/units.js';
import type { Embedder } from './embeddings.js';
import type { VectorStore } from './vector-store.js';

/** Calcula os embeddings das unidades (título + seção + texto) e grava no armazenamento. */
export async function ingest(units: EvidenceUnit[], embedder: Embedder, store: VectorStore): Promise<number> {
  const vectors = await embedder.embed(units.map(indexText));
  await store.upsert(units.map((unit, i) => ({ unit, embedding: vectors[i]! })));
  return units.length;
}
