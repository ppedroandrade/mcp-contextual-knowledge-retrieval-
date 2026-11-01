import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';
import { createMockApis, MOCK_CONFLUENCE_URL } from '../../src/workspace/connectors/mock.js';
import { FileWorkspaceStore, PgWorkspaceStore } from '../../src/workspace/store.js';
import { Workspace } from '../../src/workspace/workspace.js';

/** Precisa do PostgreSQL com pgvector (docker compose up -d postgres). */
describe('PgWorkspaceStore', () => {
  const embedder = new HashEmbedder(1024);
  const table = 'test_ws_chunks_hash';
  let pgStore: PgWorkspaceStore;
  const memory = new FileWorkspaceStore(null);
  let pgWs: Workspace;
  let memWs: Workspace;

  beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: loadConfig().pgUrl });
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
    pgStore = await PgWorkspaceStore.open(loadConfig().pgUrl, table, embedder.dim);
    const secrets = { email: 'demo@aurora.com.br', apiToken: 'token-demo' };
    for (const [store, set] of [[pgStore, (w: Workspace) => { pgWs = w; }], [memory, (w: Workspace) => { memWs = w; }]] as const) {
      const ws = new Workspace({ dir: null, embedder, store, fetch: createMockApis().fetch });
      const s = ws.addSource('confluence', 'C', { baseUrl: MOCK_CONFLUENCE_URL }, secrets);
      await ws.sync(s.id);
      await ws.upload('Manual.md', Buffer.from('# Manual\n## Prazo\nO prazo é de 30 dias.\n## Exceção\nDiretor aprova.'));
      set(ws);
    }
  });

  afterAll(async () => {
    await pgStore?.close();
  });

  it('dá o mesmo ranking que a busca exata em memória, com e sem filtro de fonte', async () => {
    const [v] = await embedder.embed(['rollback da API de rastreamento']);
    for (const source of [undefined, 'confluence', 'uploads']) {
      const a = (await pgStore.search(v!, 6, source)).map((h) => h.chunk.id);
      const b = (await memory.search(v!, 6, source)).map((h) => h.chunk.id);
      expect(a).toEqual(b);
    }
    expect((await pgStore.get('D5#1'))).toEqual(await memory.get('D5#1'));
  });

  it('apaga por documento e por fonte', async () => {
    const before = await pgStore.count();
    await pgWs.removeDoc('D5');
    expect(await pgStore.count()).toBe(before - 2);
    await pgWs.removeSource('confluence');
    expect(await pgStore.count()).toBe(0);
    expect(memWs.docs()).toHaveLength(5);
  });
});
