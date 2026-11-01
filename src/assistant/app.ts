import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import type { Embedder } from '../indexing/embeddings.js';
import {
  citedNumbers, CONTEXT_PASSAGES, conversationMessages, isConversational, retrievalQuery, SEARCH_TOOL, searchToolSpec, toCitations, toolResultText, withoutCitationMarks,
  type ChatModel, type ModelEvent, type ToolCall,
} from './chat.js';
import { googleAuthUrl, googleExchangeCode, type Connector, type GoogleOAuthConfig } from './connectors.js';
import { SUPPORTED_EXTENSIONS } from './documents.js';
import { indexDocument, removeDocument, syncSource } from './knowledge.js';
import type { KnowledgeHost } from './mcp.js';
import type { ChunkStore } from './store.js';
import type { Citation, KnowledgeSource, SourceKind, Workspace } from './workspace.js';

export interface AssistantDeps {
  ws: Workspace;
  store: ChunkStore;
  embedder: Embedder;
  /** LLM da conversa; decide quando buscar nas fontes (tool calling). */
  model: ChatModel;
  /** Host MCP ligado ao servidor de conhecimento do próprio processo. */
  host: KnowledgeHost;
  /** Servidor MCP novo para cada pedido do endpoint `/mcp` (sem estado). */
  mcpServer: () => { server: McpServer; dispose(): void };
  /** Conector de uma fonte (Confluence, Google Drive); null para upload. */
  connectorFor: (source: KnowledgeSource) => Connector | null;
  google: GoogleOAuthConfig | null;
  /** Endereço público do servidor (OAuth e `/mcp`). */
  publicUrl: string;
  staticDir: string | null;
  mode: Record<string, string>;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const MAX_JSON = 64 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_MESSAGE = 4000;
const STATIC_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, `arquivo ou corpo maior que ${Math.round(limit / 1024 / 1024) || 1} MB`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}') as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'JSON inválido');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const text = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `informe ${field}`);
  if (v.length > max) throw new HttpError(400, `${field} com mais de ${max} caracteres`);
  return v.trim();
};

const notFound = (err: unknown) => (err instanceof Error && /não encontrad/.test(err.message) ? new HttpError(404, err.message) : err);

/** Fonte como a UI vê: sem segredos, com o total de trechos. */
function publicSource(ws: Workspace, s: KnowledgeSource) {
  return { ...s, connected: s.kind === 'upload' || ws.getSecret(s.id) !== null, chunks: s.documents.reduce((n, d) => n + d.chunks, 0) };
}

/**
 * API do assistente da empresa (ADR 012). Fora do experimento do TCC: usa a mesma
 * arquitetura da configuração D, mas nada daqui entra nas métricas.
 */
export function createAssistantHandler(deps: AssistantDeps) {
  const { ws, store, embedder } = deps;
  const syncing = new Map<string, Promise<void>>();
  /** Estados do OAuth em andamento (contra CSRF), com a fonte de cada um. */
  const oauthStates = new Map<string, string>();

  function startSync(sourceId: string): Promise<void> {
    const source = ws.getSource(sourceId);
    const connector = deps.connectorFor(source);
    if (!connector) throw new HttpError(400, 'esta fonte recebe arquivos por upload; não há o que sincronizar');
    const running = syncing.get(sourceId);
    if (running) return running;
    const job = syncSource(ws, store, embedder, sourceId, connector).finally(() => syncing.delete(sourceId));
    syncing.set(sourceId, job);
    return job;
  }

  async function createSource(body: Record<string, unknown>) {
    const kind = body.kind as SourceKind;
    const name = text(body.name, 'o nome da fonte', 80);
    const config = (body.config ?? {}) as Record<string, string>;
    const secret = (body.secret ?? {}) as Record<string, string>;
    if (kind === 'upload') return { source: publicSource(ws, ws.createSource({ kind, name })) };
    if (kind === 'confluence') {
      const cfg = { site: text(config.site, 'o site do Confluence'), spaceKey: text(config.spaceKey, 'a chave do espaço', 40) };
      const source = ws.createSource({ kind, name, config: cfg, status: 'sincronizando' });
      ws.setSecret(source.id, { email: text(secret.email, 'o e-mail da conta Atlassian'), token: text(secret.token, 'o token de API', 400) });
      void startSync(source.id);
      return { source: publicSource(ws, ws.getSource(source.id)) };
    }
    if (kind === 'google-drive') {
      if (!deps.google) throw new HttpError(400, 'o conector do Google não está configurado: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (docs/assistente.md)');
      const folderId = typeof config.folderId === 'string' ? config.folderId.trim() : '';
      const source = ws.createSource({ kind, name, config: folderId ? { folderId } : {}, status: 'aguardando-conexao' });
      return { source: publicSource(ws, source), connectUrl: `/api/conectores/google/iniciar?fonte=${source.id}` };
    }
    throw new HttpError(400, 'tipo de fonte inválido: use upload, google-drive ou confluence');
  }

  async function upload(sourceId: string, req: IncomingMessage, url: URL) {
    const source = ws.getSource(sourceId);
    if (source.kind !== 'upload') throw new HttpError(400, 'esta fonte é sincronizada pelo conector; envie arquivos para uma fonte de upload');
    const name = text(url.searchParams.get('nome'), 'o nome do arquivo', 200).replace(/[\\/]/g, '_');
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase())) {
      throw new HttpError(400, `formato não suportado; use ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }
    const data = await readBody(req, MAX_UPLOAD);
    if (data.length === 0) throw new HttpError(400, 'arquivo vazio');
    try {
      const doc = await indexDocument(ws, store, embedder, sourceId, { id: name.toLowerCase(), title: '', url: null, fileName: name, data });
      return { document: doc, source: publicSource(ws, ws.getSource(sourceId)) };
    } catch (err) {
      throw new HttpError(422, `não foi possível ler ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Responde em Server-Sent Events. O LLM conversa direto (`token`…) ou pede a busca: aí vêm
   * `busca` (a consulta que ele escreveu), `fontes` (os trechos) e a resposta citada. Termina
   * com `fim` (ou `erro`).
   */
  async function chat(conversationId: string, req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req);
    const question = text(body.texto, 'a mensagem', MAX_MESSAGE);
    const conversation = ws.getConversation(conversationId);
    const history = [...conversation.messages];
    ws.appendTurn(conversationId, { role: 'user', content: question });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    const t0 = performance.now();
    const sources = ws.listSources().filter((s) => !conversation.sourceIds || conversation.sourceIds.includes(s.id));
    const messages = conversationMessages(history, question, sources);
    let answer = '';
    let citations: Citation[] = [];
    let searchQuery: string | undefined;
    let searchMs: number | null = null;
    const stream = async (events: AsyncIterable<ModelEvent>) => {
      for await (const ev of events) {
        if (ev.type === 'text') {
          answer += ev.text;
          event('token', { t: ev.text });
        }
      }
    };
    /**
     * Primeira passada, com a ferramenta: se o modelo pedir a busca, vale a consulta dele; se
     * começar a responder direto, essa resposta é descartada (nada chega à tela) e a busca é
     * feita com a consulta de reserva.
     */
    const plan = async (): Promise<ToolCall> => {
      const pass = new AbortController();
      const stop = () => pass.abort();
      abort.signal.addEventListener('abort', stop);
      try {
        for await (const ev of deps.model.chat(messages, { tools: [searchToolSpec(sources)], signal: pass.signal })) {
          if (ev.type === 'tool' && ev.call.function.name === SEARCH_TOOL) return ev.call;
          if (ev.type === 'text' && ev.text.trim()) break;
        }
      } finally {
        pass.abort();
        abort.signal.removeEventListener('abort', stop);
      }
      return { function: { name: SEARCH_TOOL, arguments: { consulta: retrievalQuery(history, question) } } };
    };
    try {
      if (!sources.length || isConversational(question, history)) {
        await stream(deps.model.chat(messages, { signal: abort.signal }));
      } else {
        const call = await plan();
        const asked = call.function.arguments.consulta;
        searchQuery = typeof asked === 'string' && asked.trim() ? asked.trim().slice(0, 300) : retrievalQuery(history, question);
        event('busca', { query: searchQuery });
        const ts = performance.now();
        citations = toCitations(await deps.host.retrieve(searchQuery, conversation.sourceIds, CONTEXT_PASSAGES), ws.listSources());
        searchMs = performance.now() - ts;
        event('fontes', { citations, searchMs, query: searchQuery });
        const toolCall: ToolCall = { function: { name: SEARCH_TOOL, arguments: { consulta: searchQuery } } };
        await stream(deps.model.chat([...messages, { role: 'assistant', content: '', tool_calls: [toolCall] }, { role: 'tool', content: toolResultText(citations) }], { signal: abort.signal }));
      }
      if (!answer.trim()) {
        answer = 'Não consegui gerar uma resposta agora. Tente reformular a mensagem.';
        event('token', { t: answer });
      }
      if (!searchQuery) answer = withoutCitationMarks(answer);
      const cited = citedNumbers(answer);
      const turn = ws.appendTurn(conversationId, {
        role: 'assistant', content: answer.trim(), citations: citations.map((c) => ({ ...c, cited: cited.has(c.n) })), ...(searchQuery ? { searchQuery } : {}),
      });
      event('fim', { turn, conversation: { id: conversationId, title: ws.getConversation(conversationId).title }, timing: { searchMs, totalMs: performance.now() - t0 } });
    } catch (err) {
      if (abort.signal.aborted) {
        if (answer) ws.appendTurn(conversationId, { role: 'assistant', content: `${answer.trim()} …(interrompida)` });
      } else {
        event('erro', { message: err instanceof Error ? err.message : String(err) });
      }
    }
    res.end();
  }

  async function mcp(req: IncomingMessage, res: ServerResponse) {
    const { server, dispose } = deps.mcpServer();
    const host = new URL(deps.publicUrl).host;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: [host, host.replace('127.0.0.1', 'localhost')],
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
      dispose();
    });
    await server.connect(transport);
    const body = req.method === 'POST' ? JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || 'null') : undefined;
    await transport.handleRequest(req, res, body);
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const m = (re: RegExp) => path.match(re);
    let p: RegExpMatchArray | null;

    if (path === '/mcp') return mcp(req, res);
    if (req.method === 'GET' && path === '/api/config') {
      return send(res, 200, { mode: deps.mode, google: deps.google !== null, mcpUrl: `${deps.publicUrl}/mcp`, formats: SUPPORTED_EXTENSIONS });
    }

    // Fontes de conhecimento
    if (req.method === 'GET' && path === '/api/fontes') return send(res, 200, { sources: ws.listSources().map((s) => publicSource(ws, s)) });
    if (req.method === 'POST' && path === '/api/fontes') return send(res, 201, await createSource(await readJson(req)));
    if ((p = m(/^\/api\/fontes\/([\w-]+)$/))) {
      if (req.method === 'PATCH') return send(res, 200, { source: publicSource(ws, ws.updateSource(p[1]!, { name: text((await readJson(req)).name, 'o nome', 80) })) });
      if (req.method === 'DELETE') {
        await store.deleteSource(p[1]!);
        ws.removeSource(p[1]!);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'POST' && (p = m(/^\/api\/fontes\/([\w-]+)\/sincronizar$/))) {
      void startSync(p[1]!);
      return send(res, 202, { source: publicSource(ws, ws.getSource(p[1]!)) });
    }
    if (req.method === 'POST' && (p = m(/^\/api\/fontes\/([\w-]+)\/arquivos$/))) return send(res, 201, await upload(p[1]!, req, url));
    if (req.method === 'DELETE' && (p = m(/^\/api\/fontes\/([\w-]+)\/documentos\/(.+)$/))) {
      await removeDocument(ws, store, p[1]!, decodeURIComponent(p[2]!));
      return send(res, 200, { source: publicSource(ws, ws.getSource(p[1]!)) });
    }

    // Conversas
    if (req.method === 'GET' && path === '/api/conversas') return send(res, 200, { conversations: ws.listConversations() });
    if (req.method === 'POST' && path === '/api/conversas') {
      const { sourceIds } = await readJson(req);
      return send(res, 201, { conversation: ws.createConversation(Array.isArray(sourceIds) ? sourceIds.map(String) : null) });
    }
    if ((p = m(/^\/api\/conversas\/([\w-]+)$/))) {
      if (req.method === 'GET') return send(res, 200, { conversation: ws.getConversation(p[1]!) });
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        return send(res, 200, { conversation: ws.updateConversation(p[1]!, {
          ...(body.title !== undefined ? { title: text(body.title, 'o título', 80) } : {}),
          ...(body.sourceIds !== undefined ? { sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : null } : {}),
        }) });
      }
      if (req.method === 'DELETE') {
        ws.deleteConversation(p[1]!);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'POST' && (p = m(/^\/api\/conversas\/([\w-]+)\/mensagens$/))) return chat(p[1]!, req, res);

    // OAuth do Google: o usuário autoriza no Google e volta com um código.
    if (req.method === 'GET' && path === '/api/conectores/google/iniciar') {
      if (!deps.google) throw new HttpError(400, 'o conector do Google não está configurado');
      const sourceId = ws.getSource(text(url.searchParams.get('fonte'), 'a fonte')).id;
      const state = randomBytes(16).toString('hex');
      oauthStates.set(state, sourceId);
      res.writeHead(302, { location: googleAuthUrl(deps.google, state) });
      return res.end();
    }
    if (req.method === 'GET' && path === '/api/conectores/google/retorno') {
      const sourceId = oauthStates.get(url.searchParams.get('state') ?? '');
      if (!deps.google || !sourceId) throw new HttpError(400, 'retorno do Google inválido ou expirado; conecte de novo');
      oauthStates.delete(url.searchParams.get('state')!);
      const code = url.searchParams.get('code');
      if (!code) {
        ws.updateSource(sourceId, { status: 'erro', error: `o Google não autorizou: ${url.searchParams.get('error') ?? 'sem código'}` });
      } else {
        ws.setSecret(sourceId, { refreshToken: await googleExchangeCode(deps.google, code) });
        void startSync(sourceId);
      }
      res.writeHead(302, { location: '/#fontes' });
      return res.end();
    }

    if (path.startsWith('/api/')) throw new HttpError(404, 'rota não encontrada');
    if (req.method === 'GET' && deps.staticDir) {
      const file = path === '/' ? 'index.html' : path.slice(1);
      if (/^[\w.-]+$/.test(file) && !file.startsWith('.') && STATIC_TYPES[extname(file)]) {
        try {
          const content = readFileSync(join(deps.staticDir, file));
          const type = STATIC_TYPES[extname(file)]!;
          res.writeHead(200, { 'content-type': type === 'image/png' ? type : `${type}; charset=utf-8` });
          return res.end(content);
        } catch {
          /* cai no 404 */
        }
      }
    }
    throw new HttpError(404, 'não encontrado');
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (raw) {
      const err = notFound(raw);
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  };
  /** Espera as sincronizações em andamento (testes e desligamento). */
  return Object.assign(handler, { idle: () => Promise.allSettled([...syncing.values()]) });
}
