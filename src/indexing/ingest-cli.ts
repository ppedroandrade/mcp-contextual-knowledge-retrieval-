import { parseArgs } from 'node:util';
import type { SourceName } from '../core/types.js';
import { makeEmbedder, tableName, type EmbedderKind } from '../bench/setup.js';
import { loadConfig } from '../core/config.js';
import { loadSource } from '../sources/index.js';
import { ingest } from './ingest.js';
import { PgVectorStore } from './pgvector.js';

/** Indexa as fontes no pgvector: `npm run ingest -- --sources docs,tickets,incidents`. */
const { values } = parseArgs({ options: {
  sources: { type: 'string', default: 'docs,tickets,incidents' },
  embedder: { type: 'string', default: 'ollama' },
} });
const sources = values.sources.split(',') as SourceName[];
const embedder = makeEmbedder(values.embedder as EmbedderKind);
const units = sources.flatMap((s) => loadSource(s));
const [probe] = await embedder.embed(['dimensão']);
const table = tableName(embedder, sources);
const store = await PgVectorStore.open(loadConfig().pgUrl, table, probe!.length);
await store.truncate();
const t0 = performance.now();
const n = await ingest(units, embedder, store);
console.log(`${n} unidades indexadas em ${table} (${probe!.length} dimensões) em ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(await embedder.describe());
await store.close();
