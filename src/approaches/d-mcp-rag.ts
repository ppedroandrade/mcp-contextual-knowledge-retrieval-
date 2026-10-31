import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { join } from 'node:path';
import type { Hit, Retriever, SourceName } from '../core/types.js';
import { reciprocalRankFusion } from '../retrieval/fusion.js';

interface ToolResult { resultados: { unitId: string; docId: string; source: string; text: string; score: number }[] }

/**
 * Configuração D — MCP + RAG. O host não conhece as fontes: descobre as tools de busca com
 * `tools/list`, chama todas com a mesma consulta e funde os resultados por RRF.
 */
export async function createMcpRetriever(transport: Transport): Promise<Retriever & { tools: string[] }> {
  const client = new Client({ name: 'tcc2-host', version: '0.1.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const searchTools = tools.filter((t) => t.name.startsWith('buscar_')).map((t) => t.name);
  if (searchTools.length === 0) throw new Error('o servidor MCP não expôs nenhuma tool de busca');

  return {
    name: 'D-mcp',
    tools: searchTools,
    async search(query, k) {
      const lists = await Promise.all(searchTools.map(async (name) => {
        const res = await client.callTool({ name, arguments: { consulta: query, k } });
        if (res.isError) throw new Error(`tool ${name} falhou: ${JSON.stringify(res.content)}`);
        const { resultados } = res.structuredContent as unknown as ToolResult;
        return resultados.map((r): Hit => ({ chunkId: r.unitId, unitId: r.unitId, docId: r.docId, source: r.source as SourceName, text: r.text, score: r.score }));
      }));
      return reciprocalRankFusion(lists, k);
    },
    async close() {
      await client.close();
    },
  };
}

/** Transporte stdio que inicia o servidor MCP deste repositório num processo separado. */
export function stdioServerTransport(env: { sources: SourceName[]; embedder: string; store: string }): StdioClientTransport {
  const root = join(import.meta.dirname, '..', '..');
  return new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(root, 'src', 'mcp', 'stdio.ts')],
    cwd: root,
    env: {
      ...(process.env as Record<string, string>),
      MCP_SOURCES: env.sources.join(','),
      MCP_EMBEDDER: env.embedder,
      MCP_STORE: env.store,
    },
    stderr: 'pipe',
  });
}
