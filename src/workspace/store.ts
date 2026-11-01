import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { cosine } from '../indexing/vector-store.js';
import type { ChunkHit, WorkspaceChunk } from './types.js';

export interface StoredChunk {
  chunk: WorkspaceChunk;
  embedding: number[];
}

/**
 * Índice vetorial do workspace. Diferente do `VectorStore` do experimento, apaga por documento
 * e por fonte (a sincronização incremental troca só o que mudou) e filtra por fonte dinâmica.
 */
export interface WorkspaceStore {
  readonly kind: 'memory' | 'pg';
  upsert(items: StoredChunk[]): Promise<void>;
  deleteDoc(docKey: string): Promise<void>;
  deleteSource(sourceId: string): Promise<void>;
  search(vector: number[], k: number, sourceId?: string): Promise<ChunkHit[]>;
  get(chunkId: string): Promise<WorkspaceChunk | null>;
  count(): Promise<number>;
  close(): Promise<void>;
}

/** Busca exata em memória, gravada num arquivo JSON a cada mudança (sem Docker). */
export class FileWorkspaceStore implements WorkspaceStore {
  readonly kind = 'memory' as const;
  private readonly items = new Map<string, StoredChunk>();
  private loadedMtime = 0;

  constructor(private readonly file: string | null) {
    this.reloadIfChanged();
  }

  /** Relê o arquivo se outro processo o mudou (o servidor MCP via stdio ao lado do app). */
  reloadIfChanged() {
    if (!this.file || !existsSync(this.file)) return;
    const mtime = statSync(this.file).mtimeMs;
    if (mtime === this.loadedMtime) return;
    this.items.clear();
    for (const it of JSON.parse(readFileSync(this.file, 'utf8')) as StoredChunk[]) this.items.set(it.chunk.id, it);
    this.loadedMtime = mtime;
  }

  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.items.values()]));
    renameSync(tmp, this.file);
    this.loadedMtime = statSync(this.file).mtimeMs;
  }

  async upsert(items: StoredChunk[]) {
    for (const it of items) this.items.set(it.chunk.id, it);
    this.persist();
  }

  async deleteDoc(docKey: string) {
    for (const [id, it] of this.items) if (it.chunk.docKey === docKey) this.items.delete(id);
    this.persist();
  }

  async deleteSource(sourceId: string) {
    for (const [id, it] of this.items) if (it.chunk.sourceId === sourceId) this.items.delete(id);
    this.persist();
  }

  async search(vector: number[], k: number, sourceId?: string): Promise<ChunkHit[]> {
    this.reloadIfChanged();
    return [...this.items.values()]
      .filter((it) => !sourceId || it.chunk.sourceId === sourceId)
      .map((it) => ({ chunk: it.chunk, score: cosine(vector, it.embedding) }))
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, k);
  }

  async get(chunkId: string) {
    this.reloadIfChanged();
    return this.items.get(chunkId)?.chunk ?? null;
  }

  async count() {
    return this.items.size;
  }

  async close() {}
}

const toVector = (v: number[]) => `[${v.join(',')}]`;

/** PostgreSQL + pgvector (o mesmo do experimento, ADR 002), numa tabela própria do workspace. */
export class PgWorkspaceStore implements WorkspaceStore {
  readonly kind = 'pg' as const;
  private constructor(private readonly pool: pg.Pool, private readonly table: string) {}

  static async open(url: string, table: string, dim: number): Promise<PgWorkspaceStore> {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`nome de tabela inválido: ${table}`);
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id text PRIMARY KEY, source_id text NOT NULL, doc_key text NOT NULL,
      title text NOT NULL, heading text NOT NULL, body text NOT NULL, url text,
      embedding vector(${dim}) NOT NULL)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_source ON ${table} (source_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_doc ON ${table} (doc_key)`);
    return new PgWorkspaceStore(pool, table);
  }

  async upsert(items: StoredChunk[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const { chunk: c, embedding } of items) {
        await client.query(
          `INSERT INTO ${this.table} (id, source_id, doc_key, title, heading, body, url, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET source_id = EXCLUDED.source_id, doc_key = EXCLUDED.doc_key, title = EXCLUDED.title,
             heading = EXCLUDED.heading, body = EXCLUDED.body, url = EXCLUDED.url, embedding = EXCLUDED.embedding`,
          [c.id, c.sourceId, c.docKey, c.title, c.heading, c.text, c.url ?? null, toVector(embedding)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteDoc(docKey: string) {
    await this.pool.query(`DELETE FROM ${this.table} WHERE doc_key = $1`, [docKey]);
  }

  async deleteSource(sourceId: string) {
    await this.pool.query(`DELETE FROM ${this.table} WHERE source_id = $1`, [sourceId]);
  }

  private static row(r: Record<string, string | null>): WorkspaceChunk {
    return { id: r.id!, sourceId: r.source_id!, docKey: r.doc_key!, title: r.title!, heading: r.heading!, text: r.body!, ...(r.url ? { url: r.url } : {}) };
  }

  async search(vector: number[], k: number, sourceId?: string): Promise<ChunkHit[]> {
    const params: unknown[] = [toVector(vector), k];
    if (sourceId) params.push(sourceId);
    const { rows } = await this.pool.query(
      `SELECT id, source_id, doc_key, title, heading, body, url, 1 - (embedding <=> $1) AS score
       FROM ${this.table} ${sourceId ? 'WHERE source_id = $3' : ''} ORDER BY embedding <=> $1, id LIMIT $2`,
      params,
    );
    return rows.map((r) => ({ chunk: PgWorkspaceStore.row(r), score: Number(r.score) }));
  }

  async get(chunkId: string) {
    const { rows } = await this.pool.query(`SELECT id, source_id, doc_key, title, heading, body, url FROM ${this.table} WHERE id = $1`, [chunkId]);
    return rows[0] ? PgWorkspaceStore.row(rows[0]) : null;
  }

  async count() {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM ${this.table}`);
    return rows[0].n as number;
  }

  async close() {
    await this.pool.end();
  }
}
