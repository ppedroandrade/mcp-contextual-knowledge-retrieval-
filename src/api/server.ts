import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Retriever } from '../core/types.js';
import { DATA_DIR } from '../corpus/generate.js';
import { makeEmbedder, makeLlm, makeRetrievers, openStore, sourcesFor, type EmbedderKind, type LlmKind, type StoreKind } from '../bench/setup.js';
import { loadSource } from '../sources/index.js';
import { createDemoHandler } from './app.js';
import { createEvalHandler } from './eval.js';

/**
 * Servidor da UI: `npm run demo`.
 * - Demonstração (padrão): ambiente real (bge-m3 + pgvector + qwen3 no Ollama, depois de
 *   `npm run ingest`). Sem Docker: `--embedder hash --store memory --llm simulated` (sem valor
 *   experimental).
 * - Avaliação humana cega: `--avaliacao <id da planilha em results/runs>`. Só o modo de
 *   avaliação fica no ar (a demonstração revelaria as abordagens) e não precisa de Ollama nem
 *   de banco. Para avaliadores em outra máquina da rede: `--host 0.0.0.0`.
 */
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3000' },
  host: { type: 'string', default: '127.0.0.1' },
  approaches: { type: 'string', default: 'A,B,C,D' },
  embedder: { type: 'string', default: 'ollama' },
  store: { type: 'string', default: 'pg' },
  llm: { type: 'string', default: 'ollama' },
  model: { type: 'string' },
  avaliacao: { type: 'string' },
} });

const staticDir = join(import.meta.dirname, '..', '..', 'apps', 'demo');
let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let label: string;
let cleanup = async () => {};

if (values.avaliacao) {
  handler = createEvalHandler({ sheetDir: join(DATA_DIR, '..', 'results', 'runs', values.avaliacao), staticDir });
  label = `avaliação humana cega da planilha ${values.avaliacao}`;
} else {
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
  handler = createDemoHandler({ units, sources, retrievers, llm, mode: { embedder: embedder.name, store: storeKind, llm: llm.name }, staticDir });
  label = `demonstração (${embedder.name}, ${storeKind}, ${llm.name})`;
  cleanup = async () => {
    for (const r of list) await r.close?.();
    await store?.close();
  };
}

const server = createServer((req, res) => void handler(req, res));
server.listen(Number(values.port), values.host, () => console.error(`${label} em http://${values.host}:${values.port}`));

const shutdown = async () => {
  server.close();
  await cleanup();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
