import pg from 'pg';
import type { EvidenceUnit, SourceName } from '../core/types.js';
import type { StoredUnit, VectorHit, VectorStore } from './vector-store.js';

const toVector = (v: number[]) => `[${v.join(',')}]`;

/**
 * PostgreSQL + pgvector (ADR 002). Busca exata: sem índice aproximado, a consulta faz
 * varredura sequencial ordenada pela distância de cosseno (`<=>`).
 */
export class PgVectorStore implements VectorStore {
  private constructor(private readonly pool: pg.Pool, private readonly table: string) {}

  static async open(url: string, table: string, dim: number): Promise<PgVectorStore> {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`nome de tabela inválido: ${table}`);
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id text PRIMARY KEY, doc_id text NOT NULL, source text NOT NULL,
      title text NOT NULL, heading text NOT NULL, body text NOT NULL,
      embedding vector(${dim}) NOT NULL)`);
    return new PgVectorStore(pool, table);
  }

  async upsert(items: StoredUnit[]) {
    for (const { unit: u, embedding } of items) {
      await this.pool.query(
        `INSERT INTO ${this.table} (id, doc_id, source, title, heading, body, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET doc_id = EXCLUDED.doc_id, source = EXCLUDED.source, title = EXCLUDED.title,
           heading = EXCLUDED.heading, body = EXCLUDED.body, embedding = EXCLUDED.embedding`,
        [u.id, u.docId, u.source, u.title, u.heading, u.text, toVector(embedding)],
      );
    }
  }

  async search(vector: number[], k: number, source?: SourceName): Promise<VectorHit[]> {
    const params: unknown[] = [toVector(vector), k];
    const where = source ? 'WHERE source = $3' : '';
    if (source) params.push(source);
    const { rows } = await this.pool.query(
      `SELECT id, doc_id, source, title, heading, body, 1 - (embedding <=> $1) AS score
       FROM ${this.table} ${where} ORDER BY embedding <=> $1, id LIMIT $2`,
      params,
    );
    return rows.map((r) => ({
      unit: { id: r.id, docId: r.doc_id, source: r.source, title: r.title, heading: r.heading, text: r.body } as EvidenceUnit,
      score: Number(r.score),
    }));
  }

  async count() {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM ${this.table}`);
    return rows[0].n as number;
  }

  async truncate() {
    await this.pool.query(`TRUNCATE ${this.table}`);
  }

  async close() {
    await this.pool.end();
  }
}
