import pg from 'pg';
import { cosine } from '../indexing/vector-store.js';

/** Trecho de um documento de uma fonte da empresa, pronto para citar. */
export interface Chunk {
  id: string;
  sourceId: string;
  docId: string;
  docTitle: string;
  /** Endereço do original (página do Confluence, documento do Drive); null em upload. */
  url: string | null;
  heading: string;
  text: string;
}

export interface ChunkHit {
  chunk: Chunk;
  score: number;
}

/** Armazenamento vetorial dos trechos, com busca exata por cosseno restrita a uma fonte. */
export interface ChunkStore {
  /** Troca todos os trechos de um documento (reindexação idempotente). */
  replaceDocument(sourceId: string, docId: string, items: { chunk: Chunk; embedding: number[] }[]): Promise<void>;
  deleteDocument(sourceId: string, docId: string): Promise<void>;
  deleteSource(sourceId: string): Promise<void>;
  search(vector: number[], k: number, sourceId: string): Promise<ChunkHit[]>;
  get(id: string): Promise<Chunk | null>;
  close(): Promise<void>;
}

export class MemoryChunkStore implements ChunkStore {
  private readonly items = new Map<string, { chunk: Chunk; embedding: number[] }>();

  async replaceDocument(sourceId: string, docId: string, items: { chunk: Chunk; embedding: number[] }[]) {
    await this.deleteDocument(sourceId, docId);
    for (const it of items) this.items.set(it.chunk.id, it);
  }

  async deleteDocument(sourceId: string, docId: string) {
    for (const [id, it] of this.items) if (it.chunk.sourceId === sourceId && it.chunk.docId === docId) this.items.delete(id);
  }

  async deleteSource(sourceId: string) {
    for (const [id, it] of this.items) if (it.chunk.sourceId === sourceId) this.items.delete(id);
  }

  async search(vector: number[], k: number, sourceId: string) {
    return [...this.items.values()]
      .filter((it) => it.chunk.sourceId === sourceId)
      .map((it) => ({ chunk: it.chunk, score: cosine(vector, it.embedding) }))
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, k);
  }

  async get(id: string) {
    return this.items.get(id)?.chunk ?? null;
  }

  async close() {}
}

const toVector = (v: number[]) => `[${v.join(',')}]`;
type Row = { id: string; source_id: string; doc_id: string; doc_title: string; url: string | null; heading: string; body: string; score?: number };
const fromRow = (r: Row): Chunk => ({ id: r.id, sourceId: r.source_id, docId: r.doc_id, docTitle: r.doc_title, url: r.url, heading: r.heading, text: r.body });

/** PostgreSQL + pgvector, busca exata (ADR 002), numa tabela própria do assistente. */
export class PgChunkStore implements ChunkStore {
  private constructor(private readonly pool: pg.Pool, private readonly table: string) {}

  static async open(url: string, dim: number, table = 'assistente_trechos'): Promise<PgChunkStore> {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`nome de tabela inválido: ${table}`);
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id text PRIMARY KEY, source_id text NOT NULL, doc_id text NOT NULL, doc_title text NOT NULL,
      url text, heading text NOT NULL, body text NOT NULL, embedding vector(${dim}) NOT NULL)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_fonte ON ${table} (source_id, doc_id)`);
    return new PgChunkStore(pool, table);
  }

  async replaceDocument(sourceId: string, docId: string, items: { chunk: Chunk; embedding: number[] }[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${this.table} WHERE source_id = $1 AND doc_id = $2`, [sourceId, docId]);
      for (const { chunk: c, embedding } of items) {
        await client.query(
          `INSERT INTO ${this.table} (id, source_id, doc_id, doc_title, url, heading, body, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [c.id, c.sourceId, c.docId, c.docTitle, c.url, c.heading, c.text, toVector(embedding)],
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

  async deleteDocument(sourceId: string, docId: string) {
    await this.pool.query(`DELETE FROM ${this.table} WHERE source_id = $1 AND doc_id = $2`, [sourceId, docId]);
  }

  async deleteSource(sourceId: string) {
    await this.pool.query(`DELETE FROM ${this.table} WHERE source_id = $1`, [sourceId]);
  }

  async search(vector: number[], k: number, sourceId: string) {
    const { rows } = await this.pool.query<Row>(
      `SELECT id, source_id, doc_id, doc_title, url, heading, body, 1 - (embedding <=> $1) AS score
       FROM ${this.table} WHERE source_id = $3 ORDER BY embedding <=> $1, id LIMIT $2`,
      [toVector(vector), k, sourceId],
    );
    return rows.map((r) => ({ chunk: fromRow(r), score: Number(r.score) }));
  }

  async get(id: string) {
    const { rows } = await this.pool.query<Row>(`SELECT id, source_id, doc_id, doc_title, url, heading, body FROM ${this.table} WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async close() {
    await this.pool.end();
  }
}
