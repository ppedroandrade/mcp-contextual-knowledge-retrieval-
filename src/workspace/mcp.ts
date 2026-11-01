import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { Hit, SourceName } from '../core/types.js';
import type { Embedder } from '../indexing/embeddings.js';
import { reciprocalRankFusion } from '../retrieval/fusion.js';
import type { WorkspaceStore } from './store.js';
import type { ChunkHit, WorkspaceChunk, WorkspaceSource } from './types.js';

export const WORKSPACE_SERVER_NAME = 'workspace-conhecimento';
export const toolNameFor = (sourceId: string) => `buscar_${sourceId}`;

/** Busca vetorial numa fonte do workspace (o equivalente de `searchSource` do experimento). */
export async function searchWorkspaceSource(embedder: Embedder, store: WorkspaceStore, sourceId: string, query: string, k: number): Promise<ChunkHit[]> {
  const [v] = await embedder.embed([query]);
  return store.search(v!, k, sourceId);
}

const resultSchema = z.object({
  id: z.string(), fonte: z.string(), titulo: z.string(), secao: z.string(), texto: z.string(), url: z.string().optional(), score: z.number(),
});
type ToolResult = z.infer<typeof resultSchema>;

const toolDescription = (s: WorkspaceSource) => `${s.description} Fonte: ${s.name}. Devolve os trechos mais parecidos com a consulta, com o id para citar.`;

/**
 * Servidor MCP do workspace: uma tool de busca por fonte conectada (upload, Google Drive,
 * Confluence), como o servidor do experimento (ADR 004). As tools acompanham as fontes:
 * `refresh()` adiciona, atualiza e remove, e o SDK avisa os clientes com
 * `notifications/tools/list_changed`.
 */
export function createWorkspaceMcpServer(embedder: Embedder, store: WorkspaceStore, sources: () => WorkspaceSource[]) {
  const server = new McpServer({ name: WORKSPACE_SERVER_NAME, version: '0.1.0' });
  const tools = new Map<string, { tool: RegisteredTool; description: string; title: string }>();

  function refresh() {
    const current = sources();
    for (const [id, t] of tools) {
      if (!current.some((s) => s.id === id)) { t.tool.remove(); tools.delete(id); }
    }
    for (const s of current) {
      const description = toolDescription(s);
      const title = `Buscar em: ${s.name}`;
      const known = tools.get(s.id);
      if (known) {
        if (known.description !== description || known.title !== title) {
          known.tool.update({ description, title });
          Object.assign(known, { description, title });
        }
        continue;
      }
      const tool = server.registerTool(toolNameFor(s.id), {
        title, description,
        inputSchema: { consulta: z.string().min(1), k: z.number().int().min(1).max(50).default(5) },
        outputSchema: { resultados: z.array(resultSchema), tempoMs: z.number() },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      }, async ({ consulta, k }) => {
        const t0 = performance.now();
        const hits = await searchWorkspaceSource(embedder, store, s.id, consulta, k);
        const resultados: ToolResult[] = hits.map(({ chunk: c, score }) => ({ id: c.id, fonte: c.sourceId, titulo: c.title, secao: c.heading, texto: c.text, ...(c.url ? { url: c.url } : {}), score }));
        const tempoMs = performance.now() - t0;
        return { content: [{ type: 'text', text: JSON.stringify({ resultados, tempoMs }) }], structuredContent: { resultados, tempoMs } };
      });
      tools.set(s.id, { tool, description, title });
    }
  }

  refresh();
  return { server, refresh };
}

export interface HostSearch {
  hits: ChunkHit[];
  tools: { name: string; hits: number; ms: number }[];
}

/**
 * Host MCP do app: a cada pergunta lista as tools do servidor (`tools/list`), chama todas as de
 * busca com a mesma consulta e funde por RRF (a mesma função de C e D). Não conhece as fontes:
 * uma fonte nova aparece como tool nova, sem mudança no host.
 */
export class WorkspaceHost {
  private constructor(private readonly client: Client) {}

  static async connect(transport: Transport): Promise<WorkspaceHost> {
    const client = new Client({ name: 'workspace-host', version: '0.1.0' });
    await client.connect(transport);
    return new WorkspaceHost(client);
  }

  async listTools() {
    return (await this.client.listTools()).tools.filter((t) => t.name.startsWith('buscar_'));
  }

  async search(query: string, k: number): Promise<HostSearch> {
    const tools = await this.listTools();
    const calls = await Promise.all(tools.map(async (t) => {
      const t0 = performance.now();
      const res = await this.client.callTool({ name: t.name, arguments: { consulta: query, k } });
      if (res.isError) throw new Error(`tool ${t.name} falhou: ${JSON.stringify(res.content)}`);
      const { resultados } = res.structuredContent as { resultados: ToolResult[] };
      return { name: t.name, ms: performance.now() - t0, hits: resultados.map((r): ChunkHit => ({ chunk: fromResult(r), score: r.score })) };
    }));
    const byId = new Map(calls.flatMap((c) => c.hits).map((h) => [h.chunk.id, h.chunk]));
    // Reaproveita a fusão do experimento; `source` só passa adiante (a RRF não lê o campo).
    const asHits = calls.map((c) => c.hits.map((h): Hit => ({ chunkId: h.chunk.id, unitId: h.chunk.id, docId: h.chunk.docKey, source: h.chunk.sourceId as SourceName, text: h.chunk.text, score: h.score })));
    const fused = reciprocalRankFusion(asHits, k).map((h) => ({ chunk: byId.get(h.unitId)!, score: h.score }));
    return { hits: fused, tools: calls.map((c) => ({ name: c.name, hits: c.hits.length, ms: c.ms })) };
  }

  async close() {
    await this.client.close();
  }
}

function fromResult(r: ToolResult): WorkspaceChunk {
  return { id: r.id, sourceId: r.fonte, docKey: r.id.split('#')[0]!, title: r.titulo, heading: r.secao, text: r.texto, ...(r.url ? { url: r.url } : {}) };
}
