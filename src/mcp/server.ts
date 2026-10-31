import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SourceName } from '../core/types.js';
import { searchSource } from '../approaches/c-per-source.js';
import type { Embedder } from '../indexing/embeddings.js';
import type { VectorStore } from '../indexing/vector-store.js';
import { SOURCE_CATALOG, toolName } from '../sources/catalog.js';

export const SERVER_NAME = 'orbital-knowledge';

const resultSchema = z.object({
  unitId: z.string(),
  docId: z.string(),
  source: z.string(),
  text: z.string(),
  score: z.number(),
});

/**
 * Servidor MCP com uma tool de busca por fonte (ADR 004). Cada tool chama `searchSource`,
 * a mesma função da configuração C; a única diferença entre C e D é o protocolo.
 */
export function createKnowledgeServer(embedder: Embedder, store: VectorStore, sources: SourceName[]): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: '0.1.0' });
  for (const source of sources) {
    const { title, description } = SOURCE_CATALOG[source];
    server.registerTool(
      toolName(source),
      {
        title: `Buscar em: ${title}`,
        description: `${description} Devolve os trechos mais parecidos com a consulta.`,
        inputSchema: { consulta: z.string().min(1), k: z.number().int().min(1).max(50).default(5) },
        outputSchema: { resultados: z.array(resultSchema) },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async ({ consulta, k }) => {
        const hits = await searchSource(embedder, store, source, consulta, k);
        const resultados = hits.map(({ unitId, docId, source: s, text, score }) => ({ unitId, docId, source: s, text, score }));
        return {
          content: [{ type: 'text', text: JSON.stringify({ resultados }) }],
          structuredContent: { resultados },
        };
      },
    );
  }
  return server;
}
