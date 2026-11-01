import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createWorkspaceHandler } from './app.js';
import { ChatService } from './chat.js';
import { createMockApis } from './connectors/mock.js';
import { createWorkspaceMcpServer, WorkspaceHost } from './mcp.js';
import { DEFAULT_WORKSPACE_DIR, makeWorkspaceEmbedder, makeWorkspaceLlm, openWorkspaceStore, type WorkspaceEmbedderKind, type WorkspaceStoreKind } from './setup.js';
import { Workspace } from './workspace.js';

/**
 * App corporativo: `npm run workspace`. Chat sobre o conhecimento da empresa, com upload e
 * conectores (Google Drive, Confluence). Ver docs/workspace.md.
 *
 * Sem Docker nem Ollama: `--embedder hash --store memory --llm extrativo` (busca não semântica e
 * resposta extrativa; só para conhecer a interface). `--conectores simulados` usa APIs falsas
 * do Google e do Confluence com dados de uma empresa fictícia.
 */
// Credenciais do Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) podem ficar no .env, fora do git.
const envFile = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3001' },
  host: { type: 'string', default: '127.0.0.1' },
  embedder: { type: 'string', default: 'ollama' },
  store: { type: 'string', default: 'pg' },
  llm: { type: 'string', default: 'ollama' },
  model: { type: 'string' },
  dados: { type: 'string' },
  conectores: { type: 'string', default: 'reais' },
} });

if (!['reais', 'simulados'].includes(values.conectores)) throw new Error('--conectores deve ser reais ou simulados');
if (!['ollama', 'extrativo'].includes(values.llm)) throw new Error('--llm deve ser ollama ou extrativo');
const simulated = values.conectores === 'simulados';
const dir = resolve(values.dados ?? (simulated ? join(DEFAULT_WORKSPACE_DIR, 'simulado') : DEFAULT_WORKSPACE_DIR));
const port = Number(values.port);
const publicUrl = process.env.WORKSPACE_PUBLIC_URL ?? `http://${values.host === '0.0.0.0' ? 'localhost' : values.host}:${port}`;

const embedder = makeWorkspaceEmbedder(values.embedder as WorkspaceEmbedderKind);
const store = await openWorkspaceStore(values.store as WorkspaceStoreKind, embedder, dir);
const mock = simulated ? createMockApis() : null;
const ws = new Workspace({ dir, embedder, store, ...(mock ? { fetch: mock.fetch } : {}) });

// Servidor MCP e host no mesmo processo, ligados por transporte em memória (o protocolo é o
// mesmo do stdio; ver ADR 012). Fontes novas viram tools novas.
const mcp = createWorkspaceMcpServer(embedder, store, () => ws.sources());
ws.onSourcesChanged = mcp.refresh;
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await mcp.server.connect(serverT);
const host = await WorkspaceHost.connect(clientT);

const llm = values.llm === 'ollama' ? makeWorkspaceLlm(values.model) : null;
const chat = new ChatService(ws, host, llm);

const google = simulated
  ? { clientId: 'cliente-simulado', clientSecret: 'segredo-simulado', redirectUri: `${publicUrl}/api/connectors/google/callback` }
  : process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: `${publicUrl}/api/connectors/google/callback` }
    : null;

if (await ws.reindexIfEmbedderChanged()) console.error('o modelo de embeddings mudou: índice refeito');

const handler = createWorkspaceHandler({
  ws, host, chat, google, simulated,
  mode: { embedder: embedder.name, store: store.kind, conectores: values.conectores, dados: dir },
  staticDir: join(import.meta.dirname, '..', '..', 'apps', 'workspace'),
  ...(mock ? { fetch: mock.fetch } : {}),
});

const server = createServer((req, res) => void handler(req, res));
server.listen(port, values.host, () => console.error(`workspace (${embedder.name}, ${store.kind}, ${chat.mode}, conectores ${values.conectores}) em ${publicUrl}`));

const shutdown = async () => {
  server.close();
  await host.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
