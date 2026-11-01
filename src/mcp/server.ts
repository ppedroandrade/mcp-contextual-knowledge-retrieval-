import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SourceName } from '../core/types.js';
import { searchSource } from '../approaches/c-per-source.js';
import type { Embedder } from '../indexing/embeddings.js';
import type { VectorStore } from '../indexing/vector-store.js';
import { sourceInfo, toolName } from '../sources/catalog.js';

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
    const { title, description } = sourceInfo(source);
    server.registerTool(
      toolName(source),
      {
        title: `Buscar em: ${title}`,
        description: `${description} Devolve os trechos mais parecidos com a consulta.`,
        inputSchema: { consulta: z.string().min(1), k: z.number().int().min(1).max(50).default(5) },
        outputSchema: { resultados: z.array(resultSchema), tempoMs: z.number().describe('tempo da busca dentro do servidor, em ms') },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async ({ consulta, k }) => {
        // Tempo da busca dentro do servidor: separa o custo da busca do custo do protocolo (ADR 004).
        const t0 = performance.now();
        const hits = await searchSource(embedder, store, source, consulta, k);
        const tempoMs = performance.now() - t0;
        const resultados = hits.map(({ unitId, docId, source: s, text, score }) => ({ unitId, docId, source: s, text, score }));
        return {
          content: [{ type: 'text', text: JSON.stringify({ resultados, tempoMs }) }],
          structuredContent: { resultados, tempoMs },
        };
      },
    );
  }
  return server;
}
