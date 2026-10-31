import type { EvidenceUnit, SourceName } from '../core/types.js';

export interface StoredUnit {
  unit: EvidenceUnit;
  embedding: number[];
}

export interface VectorHit {
  unit: EvidenceUnit;
  /** Similaridade de cosseno (1 = idêntico). */
  score: number;
}

/** Busca exata por similaridade de cosseno, opcionalmente restrita a uma fonte. */
export interface VectorStore {
  upsert(items: StoredUnit[]): Promise<void>;
  search(vector: number[], k: number, source?: SourceName): Promise<VectorHit[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Armazenamento em memória com busca exata. Mesmo resultado que o pgvector sem índice. */
export class MemoryVectorStore implements VectorStore {
  private readonly items = new Map<string, StoredUnit>();

  async upsert(items: StoredUnit[]) {
    for (const it of items) this.items.set(it.unit.id, it);
  }

  async search(vector: number[], k: number, source?: SourceName): Promise<VectorHit[]> {
    return [...this.items.values()]
      .filter((it) => !source || it.unit.source === source)
      .map((it) => ({ unit: it.unit, score: cosine(vector, it.embedding) }))
      .sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id))
      .slice(0, k);
  }

  async count() {
    return this.items.size;
  }

  async close() {}
}
