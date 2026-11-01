import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { SourceName } from '../core/types.js';
import { makeEmbedder, openStore, type EmbedderKind, type StoreKind } from '../bench/setup.js';
import { loadSource } from '../sources/index.js';
import { createKnowledgeServer } from './server.js';

/**
 * Processo do servidor MCP via stdio. Configuração por variáveis de ambiente:
 * MCP_SOURCES (padrão: docs,tickets,incidents,policies), MCP_EMBEDDER (ollama|hash), MCP_STORE (pg|memory).
 * Nada pode ser escrito em stdout além do protocolo; logs vão para stderr.
 */
const sources = (process.env.MCP_SOURCES ?? 'docs,tickets,incidents,policies').split(',') as SourceName[];
const embedder = makeEmbedder((process.env.MCP_EMBEDDER ?? 'ollama') as EmbedderKind);
const units = sources.flatMap((s) => loadSource(s));
const store = await openStore((process.env.MCP_STORE ?? 'pg') as StoreKind, embedder, units, sources);
const server = createKnowledgeServer(embedder, store, sources);
await server.connect(new StdioServerTransport());
console.error(`servidor MCP pronto: ${sources.join(', ')} (${embedder.name})`);
const shutdown = async () => { await server.close(); await store.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
