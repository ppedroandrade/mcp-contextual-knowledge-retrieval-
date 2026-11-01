import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { ChunkHit } from './store.js';
import type { KnowledgeSource, SourceEvent, Workspace } from './workspace.js';

export const SERVER_NAME = 'conhecimento-da-empresa';
const TOOL_PREFIX = 'buscar_';

export const toolNameFor = (sourceId: string) => `${TOOL_PREFIX}${sourceId}`;

const KIND_DESCRIPTION: Record<KnowledgeSource['kind'], string> = {
  upload: 'Arquivos enviados pela equipe (PDF, Word, Markdown, texto).',
  'google-drive': 'Documentos do Google Drive (Google Docs, PDF, Word).',
  confluence: 'Páginas de um espaço do Confluence (Atlassian).',
};

const resultSchema = z.object({
  trecho: z.string(),
  fonte: z.string(),
  documento: z.string(),
  titulo: z.string(),
  secao: z.string(),
  url: z.string().nullable(),
  texto: z.string(),
  score: z.number(),
});
export type ToolResult = z.infer<typeof resultSchema>;

/**
 * Servidor MCP do conhecimento da empresa: uma tool de busca por fonte (a configuração D do
 * TCC). Quando uma fonte entra ou sai do workspace, a tool correspondente é registrada ou
 * retirada, e o SDK avisa os clientes conectados (`tools/list_changed`): um conector novo não
 * exige mudança no host.
 */
export function createKnowledgeMcpServer(ws: Workspace, search: (sourceId: string, query: string, k: number) => Promise<ChunkHit[]>) {
  const server = new McpServer({ name: SERVER_NAME, version: '0.1.0' });
  const tools = new Map<string, RegisteredTool>();

  const register = (source: KnowledgeSource) => {
    if (tools.has(source.id)) return;
    tools.set(source.id, server.registerTool(
      toolNameFor(source.id),
      {
        title: `Buscar em: ${source.name}`,
        description: `${KIND_DESCRIPTION[source.kind]} Fonte "${source.name}". Devolve os trechos mais parecidos com a consulta.`,
        inputSchema: { consulta: z.string().min(1), k: z.number().int().min(1).max(20).default(5) },
        outputSchema: { resultados: z.array(resultSchema) },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async ({ consulta, k }) => {
        const resultados: ToolResult[] = (await search(source.id, consulta, k)).map(({ chunk: c, score }) => ({
          trecho: c.id, fonte: c.sourceId, documento: c.docId, titulo: c.docTitle, secao: c.heading, url: c.url, texto: c.text, score,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ resultados }) }], structuredContent: { resultados } };
      },
    ));
  };

  const onSource = ({ type, source }: SourceEvent) => {
    if (type === 'criada') register(source);
    if (type === 'removida') {
      tools.get(source.id)?.remove();
      tools.delete(source.id);
    }
  };
  // O SDK só habilita as tools (e o aviso de lista alterada) ao registrar a primeira, e não
  // aceita habilitar depois de conectado: sem fontes na partida, registra e retira uma
  // provisória para a primeira fonte criada depois funcionar.
  if (ws.listSources().length === 0) server.registerTool('_inicio', { description: 'provisória' }, async () => ({ content: [] })).remove();
  for (const s of ws.listSources()) register(s);
  ws.on('fonte', onSource);
  return { server, dispose: () => ws.off('fonte', onSource) };
}

export interface RetrievedPassage extends ToolResult {
  /** Pontuação da fusão RRF. */
  rrf: number;
}

/**
 * Host MCP do assistente: descobre as tools de busca com `tools/list` a cada pergunta, chama
 * as das fontes escolhidas em paralelo e funde as listas por RRF (c = 60), como a
 * configuração D (`src/approaches/d-mcp-rag.ts`).
 */
export class KnowledgeHost {
  private constructor(private readonly client: Client) {}

  static async connect(transport: Transport): Promise<KnowledgeHost> {
    const client = new Client({ name: 'assistente-da-empresa', version: '0.1.0' });
    await client.connect(transport);
    return new KnowledgeHost(client);
  }

  async searchTools(): Promise<{ name: string; sourceId: string; title: string }[]> {
    const { tools } = await this.client.listTools();
    return tools
      .filter((t) => t.name.startsWith(TOOL_PREFIX))
      .map((t) => ({ name: t.name, sourceId: t.name.slice(TOOL_PREFIX.length), title: t.title ?? t.name }));
  }

  async retrieve(query: string, sourceIds: string[] | null, k: number, c = 60): Promise<RetrievedPassage[]> {
    const tools = (await this.searchTools()).filter((t) => !sourceIds || sourceIds.includes(t.sourceId));
    const lists = await Promise.all(tools.map(async (t) => {
      const res = await this.client.callTool({ name: t.name, arguments: { consulta: query, k } });
      if (res.isError) throw new Error(`a tool ${t.name} falhou: ${JSON.stringify(res.content)}`);
      return (res.structuredContent as { resultados: ToolResult[] }).resultados;
    }));
    const acc = new Map<string, RetrievedPassage>();
    for (const list of lists) {
      list.forEach((r, i) => {
        const cur = acc.get(r.trecho) ?? { ...r, rrf: 0 };
        cur.rrf += 1 / (c + i + 1);
        cur.score = Math.max(cur.score, r.score);
        acc.set(r.trecho, cur);
      });
    }
    return [...acc.values()]
      .sort((a, b) => b.rrf - a.rrf || b.score - a.score || a.trecho.localeCompare(b.trecho))
      .slice(0, k);
  }

  async close() {
    await this.client.close();
  }
}
