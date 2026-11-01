import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { makeEmbedder, type EmbedderKind } from '../bench/setup.js';
import { loadConfig } from '../core/config.js';
import { DATA_DIR } from '../corpus/generate.js';
import { createAssistantHandler } from './app.js';
import { OllamaChatModel, SimulatedChatModel } from './chat.js';
import { confluenceConnector, googleDriveConnector, type GoogleOAuthConfig } from './connectors.js';
import { indexDocument, searchSource } from './knowledge.js';
import { createKnowledgeMcpServer, KnowledgeHost } from './mcp.js';
import { MemoryChunkStore, PgChunkStore, type ChunkStore } from './store.js';
import { Workspace } from './workspace.js';

/**
 * Assistente da empresa: `npm run assistente` (ADR 012, docs/assistente.md). Fora do
 * experimento do TCC. Padrão: bge-m3 + pgvector + qwen3 no Ollama; sem Docker:
 * `--embedder hash --store memory --llm simulated` (só para ver a UI).
 */
const root = join(import.meta.dirname, '..', '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3100' },
  host: { type: 'string', default: '127.0.0.1' },
  embedder: { type: 'string', default: 'ollama' },
  store: { type: 'string', default: 'pg' },
  llm: { type: 'string', default: 'ollama' },
  model: { type: 'string' },
  dados: { type: 'string' },
  exemplo: { type: 'boolean', default: false },
} });

const cfg = loadConfig();
const publicUrl = process.env.ASSISTENTE_URL ?? `http://${values.host === '0.0.0.0' ? '127.0.0.1' : values.host}:${values.port}`;
// Em memória os trechos somem ao sair, então o estado também é temporário.
const dataDir = values.dados ? join(root, values.dados) : values.store === 'memory' ? mkdtempSync(join(tmpdir(), 'assistente-')) : join(root, '.assistente');
const ws = new Workspace(dataDir);
const embedder = makeEmbedder(values.embedder as EmbedderKind);
const [probe] = await embedder.embed(['dimensão']);
const store: ChunkStore = values.store === 'pg'
  ? await PgChunkStore.open(cfg.pgUrl, probe!.length, `assistente_trechos_${embedder.name}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  : new MemoryChunkStore();

const search = (sourceId: string, query: string, k: number) => searchSource(store, embedder, sourceId, query, k);
const internal = createKnowledgeMcpServer(ws, search);
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await internal.server.connect(serverT);
const host = await KnowledgeHost.connect(clientT);

const google: GoogleOAuthConfig | null = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: `${publicUrl}/api/conectores/google/retorno` }
  : null;
const model = values.llm === 'simulated' ? new SimulatedChatModel() : new OllamaChatModel(cfg.ollamaUrl, values.model ?? cfg.llmModel);

if (values.exemplo && !ws.listSources().some((s) => s.config.exemplo)) {
  const source = ws.createSource({ kind: 'upload', name: 'Wiki de exemplo (Orbital Software)', config: { exemplo: 'orbital' } });
  const dir = join(DATA_DIR, 'corpus', 'docs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  console.error(`indexando ${files.length} documentos de exemplo…`);
  for (const f of files) await indexDocument(ws, store, embedder, source.id, { id: f, title: '', url: null, fileName: f, data: readFileSync(join(dir, f)) });
}

const handler = createAssistantHandler({
  ws, store, embedder, model, host, publicUrl,
  mcpServer: () => createKnowledgeMcpServer(ws, search),
  connectorFor: (s) => (s.kind === 'confluence' ? confluenceConnector() : s.kind === 'google-drive' && google ? googleDriveConnector(google) : null),
  google,
  staticDir: join(root, 'apps', 'assistant'),
  mode: { embedder: embedder.name, store: values.store!, llm: model.name, dados: dataDir },
});

const server = createServer((req, res) => void handler(req, res));
server.listen(Number(values.port), values.host, () => {
  console.error(`assistente em ${publicUrl} (${embedder.name}, ${values.store}, ${model.name}); servidor MCP em ${publicUrl}/mcp`);
  if (!google) console.error('conector do Google desligado: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env (docs/assistente.md)');
});

const shutdown = async () => {
  server.close();
  await handler.idle();
  await host.close();
  internal.dispose();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
