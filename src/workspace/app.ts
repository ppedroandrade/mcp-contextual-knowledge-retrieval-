import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ChatService, MAX_QUESTION } from './chat.js';
import { confluenceBaseUrl, verifyConfluence } from './connectors/confluence.js';
import { exchangeGoogleCode, googleAuthUrl, type GoogleOAuthConfig } from './connectors/google-drive.js';
import { ConnectorHttpError } from './connectors/http.js';
import { SUPPORTED_EXTENSIONS, UnsupportedFormatError } from './extract.js';
import type { WorkspaceHost } from './mcp.js';
import { BadRequestError, MAX_UPLOAD_BYTES, NotFoundError, type Workspace } from './workspace.js';

/**
 * API HTTP do app corporativo (ADR 012). Sem autenticação própria: pensado para rodar na
 * máquina do usuário (127.0.0.1). Em rede, colocar atrás de um proxy com login (limitação
 * documentada em docs/workspace.md).
 */

export interface WorkspaceAppDeps {
  ws: Workspace;
  host: WorkspaceHost;
  chat: ChatService;
  /** Descrição do modo (embeddings, índice, LLM, conectores), mostrada na UI. */
  mode: Record<string, string>;
  /** OAuth do Google; `null` deixa o botão do Drive desabilitado com a explicação. */
  google: GoogleOAuthConfig | null;
  /** Conectores simulados: o OAuth do Google pula a tela de consentimento. */
  simulated: boolean;
  staticDir?: string | null;
  /** `fetch` usado na troca do código do OAuth (o simulado no modo de demonstração). */
  fetch?: typeof fetch;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SMALL_BODY = 64 * 1024;
const UPLOAD_BODY = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 64 * 1024;

async function readJson(req: IncomingMessage, limit = SMALL_BODY): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'corpo da requisição grande demais');
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

const str = (v: unknown, field: string, max = 500): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `informe ${field}`);
  if (v.length > max) throw new HttpError(400, `${field} com mais de ${max} caracteres`);
  return v.trim();
};

const STATIC_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function createWorkspaceHandler(deps: WorkspaceAppDeps) {
  const { ws, chat } = deps;
  const fetchFn = deps.fetch ?? fetch;
  /** `state` do OAuth: protege o callback contra CSRF; vale 10 minutos. */
  const oauthStates = new Map<string, number>();
  /** Pasta do Drive escolhida antes da autorização (opcional), pelo `state`. */
  const folderByState = new Map<string, string>();

  function sourcesPayload() {
    return ws.sources().map((s) => {
      const docs = ws.docs(s.id);
      return {
        ...s, documents: docs.length, chunks: docs.reduce((n, d) => n + d.chunkCount, 0), syncing: ws.isSyncing(s.id),
        docs: docs.map(({ key, title, url, mimeType, chunkCount, indexedAt, bytes }) => ({ key, title, url, mimeType, chunkCount, indexedAt, bytes })).sort((a, b) => a.title.localeCompare(b.title)),
      };
    });
  }

  /** Sincronização em segundo plano: a UI acompanha pelo status da fonte. */
  function syncInBackground(id: string) {
    ws.sync(id).catch((err) => console.error(`sincronização de ${id} falhou: ${err instanceof Error ? err.message : err}`));
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const seg = path.split('/').filter(Boolean).map(decodeURIComponent);

    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true });
    if (method === 'GET' && path === '/api/workspace') {
      return send(res, 200, {
        mode: { ...deps.mode, llm: chat.mode }, simulated: deps.simulated, supportedExtensions: SUPPORTED_EXTENSIONS, maxUploadBytes: MAX_UPLOAD_BYTES,
        connectors: {
          gdrive: deps.google ? { available: true } : { available: false, reason: 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (docs/workspace.md) ou rode com --conectores simulados.' },
          confluence: { available: true },
        },
      });
    }
    if (method === 'GET' && path === '/api/sources') return send(res, 200, { sources: sourcesPayload() });
    if (method === 'GET' && path === '/api/mcp/tools') {
      const tools = await deps.host.listTools();
      return send(res, 200, { tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description })) });
    }

    // Fontes: /api/sources/:id[/sync|/docs/:key]
    if (seg[0] === 'api' && seg[1] === 'sources' && seg[2]) {
      const id = seg[2];
      if (method === 'POST' && seg[3] === 'sync' && seg.length === 4) {
        const s = ws.source(id);
        if (s.kind === 'upload') throw new HttpError(400, 'a fonte de arquivos enviados não sincroniza');
        syncInBackground(id);
        return send(res, 202, { source: { ...ws.source(id), syncing: true } });
      }
      if (method === 'PATCH' && seg.length === 3) {
        const b = await readJson(req);
        return send(res, 200, { source: ws.updateSource(id, { ...(typeof b.name === 'string' ? { name: b.name } : {}), ...(typeof b.description === 'string' ? { description: b.description } : {}) }) });
      }
      if (method === 'DELETE' && seg.length === 3) {
        await ws.removeSource(id);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE' && seg[3] === 'docs' && seg[4] && seg.length === 5) {
        const doc = ws.doc(seg[4]);
        if (!doc || doc.sourceId !== id) throw new HttpError(404, 'documento não encontrado');
        if (ws.source(id).kind !== 'upload') throw new HttpError(400, 'documentos de conectores saem do índice quando são apagados na origem; remova a fonte para desconectar');
        await ws.removeDoc(doc.key);
        return send(res, 200, { ok: true });
      }
    }

    if (method === 'POST' && path === '/api/uploads') {
      const b = await readJson(req, UPLOAD_BODY);
      const name = str(b.name, 'o nome do arquivo', 200);
      const data = Buffer.from(str(b.contentBase64, 'o conteúdo', UPLOAD_BODY), 'base64');
      const r = await ws.upload(name, data);
      return send(res, r.status === 'added' ? 201 : 200, r);
    }

    if (method === 'POST' && path === '/api/connectors/confluence') {
      const b = await readJson(req);
      let baseUrl: string;
      try {
        baseUrl = confluenceBaseUrl(str(b.baseUrl, 'a URL do Confluence'));
      } catch (e) {
        throw new HttpError(400, e instanceof Error && e.message.includes('https') ? e.message : 'URL do Confluence inválida (ex.: https://empresa.atlassian.net)');
      }
      const settings = { baseUrl, spaceKeys: typeof b.spaceKeys === 'string' ? b.spaceKeys.toUpperCase().replace(/[^A-Z0-9_,~]/g, '') : '' };
      const secrets = { email: str(b.email, 'o e-mail da conta Atlassian', 200), apiToken: str(b.apiToken, 'o API token', 500) };
      try {
        await verifyConfluence({ settings, secrets, saveSecrets: () => {}, fetch: fetchFn });
      } catch (e) {
        if (e instanceof ConnectorHttpError && (e.status === 401 || e.status === 403)) throw new HttpError(400, 'o Confluence recusou o e-mail ou o API token');
        throw new HttpError(502, `não foi possível falar com o Confluence: ${e instanceof Error ? e.message : e}`);
      }
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `Confluence (${new URL(baseUrl).hostname.split('.')[0]})`;
      const source = ws.addSource('confluence', name, settings, secrets, new URL(baseUrl).hostname.split('.')[0]);
      syncInBackground(source.id);
      return send(res, 201, { source });
    }

    if (method === 'GET' && path === '/api/connectors/google/start') {
      if (!deps.google) throw new HttpError(400, 'Google Drive não configurado: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET');
      const state = randomBytes(16).toString('hex');
      const now = Date.now();
      for (const [k, exp] of oauthStates) if (exp < now) oauthStates.delete(k);
      oauthStates.set(state, now + 10 * 60_000);
      const folderId = url.searchParams.get('folderId')?.trim();
      if (folderId) folderByState.set(state, folderId);
      return redirect(res, deps.simulated ? `/api/connectors/google/callback?code=codigo-simulado&state=${state}` : googleAuthUrl(deps.google, state));
    }
    if (method === 'GET' && path === '/api/connectors/google/callback') {
      const state = url.searchParams.get('state') ?? '';
      const exp = oauthStates.get(state);
      oauthStates.delete(state);
      if (!deps.google || !exp || exp < Date.now()) return redirect(res, `/?erro=${encodeURIComponent('autorização do Google expirada ou inválida; tente de novo')}`);
      const error = url.searchParams.get('error');
      if (error) return redirect(res, `/?erro=${encodeURIComponent(`o Google recusou a autorização (${error})`)}`);
      try {
        const secrets = await exchangeGoogleCode(fetchFn, deps.google, url.searchParams.get('code') ?? '');
        const folderId = folderByState.get(state);
        folderByState.delete(state);
        const source = ws.addSource('gdrive', 'Google Drive', folderId ? { folderId } : {}, secrets);
        syncInBackground(source.id);
        return redirect(res, `/?conectado=${encodeURIComponent(source.id)}`);
      } catch (e) {
        return redirect(res, `/?erro=${encodeURIComponent(`falha ao conectar o Google Drive: ${e instanceof Error ? e.message : e}`)}`);
      }
    }

    if (method === 'GET' && seg[0] === 'api' && seg[1] === 'chunks' && seg[2] && seg.length === 3) {
      const c = await ws.store.get(seg[2]);
      if (!c) throw new HttpError(404, 'trecho não encontrado');
      const s = ws.sources().find((x) => x.id === c.sourceId);
      return send(res, 200, { ...c, url: c.url ?? ws.doc(c.docKey)?.url, sourceName: s?.name ?? c.sourceId, kind: s?.kind });
    }

    if (method === 'GET' && path === '/api/conversations') return send(res, 200, { conversations: chat.list() });
    if (seg[0] === 'api' && seg[1] === 'conversations' && seg[2]) {
      if (method === 'GET' && seg.length === 3) {
        const c = chat.get(seg[2]);
        if (!c) throw new HttpError(404, 'conversa não encontrada');
        return send(res, 200, { conversation: c });
      }
      if (method === 'DELETE' && seg.length === 3) {
        chat.remove(seg[2]);
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && seg[3] === 'messages' && seg.length === 4) {
        const b = await readJson(req);
        const question = str(b.question, 'a pergunta', MAX_QUESTION);
        const r = await chat.ask(seg[2] === 'nova' ? null : seg[2], question);
        return send(res, 200, r);
      }
    }

    if (path.startsWith('/api/')) throw new HttpError(404, 'rota não encontrada');
    if (method === 'GET' && deps.staticDir) {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const ext = file.slice(file.lastIndexOf('.'));
      if (/^[\w.-]+$/.test(file) && !file.startsWith('.') && STATIC_TYPES[ext]) {
        try {
          const content = readFileSync(join(deps.staticDir, file));
          res.writeHead(200, { 'content-type': `${STATIC_TYPES[ext]}; charset=utf-8` });
          return res.end(content);
        } catch {
          /* cai no 404 */
        }
      }
    }
    throw new HttpError(404, 'não encontrado');
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status
        : err instanceof NotFoundError ? 404
          : err instanceof BadRequestError || err instanceof UnsupportedFormatError ? 400
            : err instanceof Error && /conversa não encontrada|informe a pergunta/.test(err.message) ? 400 : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  };
}
