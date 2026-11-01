import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorkspaceMcpServer } from './mcp.js';
import { DEFAULT_WORKSPACE_DIR, makeWorkspaceEmbedder, openWorkspaceStore, type WorkspaceEmbedderKind, type WorkspaceStoreKind } from './setup.js';
import type { WorkspaceSource } from './types.js';

/**
 * Servidor MCP do workspace via stdio, para usar o conhecimento da empresa em outro cliente MCP
 * (Claude Desktop, Claude Code, Cursor). Lê a mesma pasta de dados e o mesmo índice do app;
 * as fontes conectadas no app aparecem como tools em até 5 s.
 * Variáveis: WORKSPACE_DIR, WORKSPACE_EMBEDDER (ollama|hash), WORKSPACE_STORE (pg|memory).
 * Nada além do protocolo em stdout; logs em stderr.
 */
const dir = resolve(process.env.WORKSPACE_DIR ?? DEFAULT_WORKSPACE_DIR);
const embedder = makeWorkspaceEmbedder((process.env.WORKSPACE_EMBEDDER ?? 'ollama') as WorkspaceEmbedderKind);
const store = await openWorkspaceStore((process.env.WORKSPACE_STORE ?? 'pg') as WorkspaceStoreKind, embedder, dir);
const stateFile = join(dir, 'workspace.json');

let sources: WorkspaceSource[] = [];
let mtime = 0;
function readSources(): boolean {
  if (!existsSync(stateFile)) return false;
  const m = statSync(stateFile).mtimeMs;
  if (m === mtime) return false;
  mtime = m;
  sources = (JSON.parse(readFileSync(stateFile, 'utf8')) as { sources: WorkspaceSource[] }).sources;
  return true;
}
readSources();

const mcp = createWorkspaceMcpServer(embedder, store, () => sources);
await mcp.server.connect(new StdioServerTransport());
console.error(`servidor MCP do workspace pronto: ${sources.map((s) => s.id).join(', ') || 'nenhuma fonte'} (${embedder.name}, ${dir})`);
const timer = setInterval(() => { if (readSources()) mcp.refresh(); }, 5000);
const shutdown = async () => { clearInterval(timer); await mcp.server.close(); await store.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
