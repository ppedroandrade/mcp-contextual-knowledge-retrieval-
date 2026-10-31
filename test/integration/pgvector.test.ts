import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import type { SourceName } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';
import { ingest } from '../../src/indexing/ingest.js';
import { PgVectorStore } from '../../src/indexing/pgvector.js';
import { MemoryVectorStore } from '../../src/indexing/vector-store.js';
import { parseSource } from '../../src/sources/index.js';

/** Precisa do PostgreSQL com pgvector (docker compose up -d postgres). */
describe('PgVectorStore', () => {
  const embedder = new HashEmbedder();
  const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
  const units = sources.flatMap((s) => parseSource(s, buildCorpus().files));
  const memory = new MemoryVectorStore();
  let pgStore: PgVectorStore;

  beforeAll(async () => {
    pgStore = await PgVectorStore.open(loadConfig().pgUrl, 'test_units_hash', embedder.dim);
    await pgStore.truncate();
    await ingest(units, embedder, pgStore);
    await ingest(units, embedder, memory);
  });

  afterAll(async () => {
    await pgStore?.close();
  });

  it('guarda todas as unidades', async () => {
    expect(await pgStore.count()).toBe(units.length);
  });

  it('dá o mesmo ranking que a busca exata em memória', async () => {
    const [v] = await embedder.embed(['fila de faturas parada no invoice-worker']);
    for (const source of [undefined, 'tickets'] as const) {
      const a = (await pgStore.search(v!, 10, source)).map((h) => h.unit.id);
      const b = (await memory.search(v!, 10, source)).map((h) => h.unit.id);
      expect(a).toEqual(b);
    }
  });

  it('preserva o texto da unidade', async () => {
    const [v] = await embedder.embed([units[0]!.text]);
    const [top] = await pgStore.search(v!, 1);
    expect(top!.unit).toEqual(units.find((u) => u.id === top!.unit.id));
  });
});
