import { createServer } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Retriever } from '../core/types.js';
import { makeEmbedder, makeLlm, makeRetrievers, openStore, sourcesFor, type EmbedderKind, type LlmKind, type StoreKind } from '../bench/setup.js';
import { loadSource } from '../sources/index.js';
import { createDemoHandler } from './app.js';

/**
 * Servidor da demonstração: `npm run demo`. Por padrão usa o ambiente real (bge-m3 +
 * pgvector + qwen3 no Ollama, depois de `npm run ingest`). Para testar sem Docker:
 * `npm run demo -- --embedder hash --store memory --llm simulated` (sem valor experimental).
 */
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3000' },
  host: { type: 'string', default: '127.0.0.1' },
  approaches: { type: 'string', default: 'A,B,C,D' },
  embedder: { type: 'string', default: 'ollama' },
  store: { type: 'string', default: 'pg' },
  llm: { type: 'string', default: 'ollama' },
  model: { type: 'string' },
} });

const names = values.approaches.split(',');
const sources = sourcesFor('dev');
const units = sources.flatMap((s) => loadSource(s));
const embedderKind = values.embedder as EmbedderKind;
const storeKind = values.store as StoreKind;
const embedder = makeEmbedder(embedderKind);
const store = names.some((n) => n === 'B' || n === 'C') ? await openStore(storeKind, embedder, units, sources) : null;
const list = await makeRetrievers(names, { units, sources, embedder, store, embedderKind, storeKind });
const retrievers: Record<string, Retriever> = Object.fromEntries(names.map((n, i) => [n, list[i]!]));
const llm = makeLlm(values.llm as LlmKind, values.model);

const handler = createDemoHandler({
  units, sources, retrievers, llm,
  mode: { embedder: embedder.name, store: storeKind, llm: llm.name },
  staticDir: join(import.meta.dirname, '..', '..', 'apps', 'demo'),
});
const server = createServer((req, res) => void handler(req, res));
server.listen(Number(values.port), values.host, () => {
  console.error(`demonstração em http://${values.host}:${values.port} (${embedder.name}, ${storeKind}, ${llm.name})`);
});

const shutdown = async () => {
  server.close();
  for (const r of list) await r.close?.();
  await store?.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
