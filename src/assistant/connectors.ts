import { extname } from 'node:path';
import { SUPPORTED_EXTENSIONS } from './documents.js';
import type { KnowledgeSource } from './workspace.js';

/** Documento trazido por um conector, ainda no formato original. */
export interface IncomingDocument {
  id: string;
  title: string;
  url: string | null;
  /** Nome com extensão: decide o leitor (`parseFile`). */
  fileName: string;
  data: Buffer;
  updatedAt?: string;
}

export interface Connector {
  /** Documentos atuais da fonte. Os que não vierem são retirados do índice. */
  fetchDocuments(source: KnowledgeSource, secret: Record<string, string> | null): AsyncIterable<IncomingDocument>;
}

async function getJson<T>(fetchFn: typeof fetch, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetchFn(url, { headers: { accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`${new URL(url).host} respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- Confluence (Atlassian) --

interface ConfluencePage {
  id: string;
  title: string;
  version?: { createdAt?: string };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

/**
 * Confluence Cloud, API REST v2, com e-mail + token de API (id.atlassian.com → Segurança →
 * Tokens de API). Configuração: `site` (https://empresa.atlassian.net) e `spaceKey`; segredo:
 * `email` e `token`. Lê todas as páginas do espaço no formato `storage` (XHTML).
 */
export function confluenceConnector(fetchFn: typeof fetch = fetch): Connector {
  return {
    async *fetchDocuments(source, secret) {
      const site = (source.config.site ?? '').replace(/\/+$/, '');
      const spaceKey = source.config.spaceKey ?? '';
      if (!/^https:\/\/[\w.-]+$/.test(site)) throw new Error('informe o site do Confluence, ex.: https://empresa.atlassian.net');
      if (!spaceKey) throw new Error('informe a chave do espaço do Confluence');
      if (!secret?.email || !secret.token) throw new Error('informe o e-mail e o token de API da Atlassian');
      const auth = { authorization: `Basic ${Buffer.from(`${secret.email}:${secret.token}`).toString('base64')}` };
      const spaces = await getJson<{ results: { id: string }[] }>(fetchFn, `${site}/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`, auth);
      const spaceId = spaces.results[0]?.id;
      if (!spaceId) throw new Error(`espaço ${spaceKey} não encontrado (ou sem permissão) em ${site}`);
      let next: string | null = `/wiki/api/v2/spaces/${spaceId}/pages?body-format=storage&limit=50`;
      while (next) {
        const page: { results: ConfluencePage[]; _links?: { next?: string; base?: string } } = await getJson(fetchFn, `${site}${next}`, auth);
        const base = page._links?.base ?? `${site}/wiki`;
        for (const p of page.results) {
          const html = p.body?.storage?.value ?? '';
          yield {
            id: p.id,
            title: p.title,
            url: p._links?.webui ? `${base}${p._links.webui}` : null,
            fileName: `${p.id}.html`,
            data: Buffer.from(`<html><head><title>${p.title}</title></head><body>${html}</body></html>`),
            updatedAt: p.version?.createdAt,
          };
        }
        next = page._links?.next ?? null;
      }
    },
  };
}

// ------------------------------------------------------------------- Google Drive/Docs --

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Precisa estar cadastrado no cliente OAuth do Google Cloud. */
  redirectUri: string;
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
/** Tipos baixados como arquivo; o Google Docs é exportado como HTML. */
const DOWNLOADABLE: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/html': '.html',
  'text/csv': '.csv',
};

export function googleAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: GOOGLE_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function googleToken(cfg: GoogleOAuthConfig, body: Record<string, string>, fetchFn: typeof fetch) {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`Google OAuth respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { access_token: string; refresh_token?: string };
}

/** Troca o código do retorno do OAuth pelo refresh token, que fica cifrado no workspace. */
export async function googleExchangeCode(cfg: GoogleOAuthConfig, code: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const t = await googleToken(cfg, { code, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }, fetchFn);
  if (!t.refresh_token) throw new Error('o Google não devolveu refresh token; remova o acesso do app na conta Google e conecte de novo');
  return t.refresh_token;
}

/**
 * Google Drive (somente leitura), com OAuth do próprio usuário: o assistente vê só o que a
 * pessoa que conectou pode ver. Configuração opcional: `folderId` (só uma pasta). Segredo:
 * `refreshToken`. Lê Google Docs (exportados como HTML) e PDF, DOCX, Markdown e texto.
 */
export function googleDriveConnector(cfg: GoogleOAuthConfig, fetchFn: typeof fetch = fetch): Connector {
  return {
    async *fetchDocuments(source, secret) {
      if (!secret?.refreshToken) throw new Error('conecte a conta Google desta fonte');
      const { access_token } = await googleToken(cfg, { refresh_token: secret.refreshToken, grant_type: 'refresh_token' }, fetchFn);
      const auth = { authorization: `Bearer ${access_token}` };
      const types = [GOOGLE_DOC, ...Object.keys(DOWNLOADABLE)].map((t) => `mimeType='${t}'`).join(' or ');
      const folder = source.config.folderId ? `'${source.config.folderId.replace(/'/g, '')}' in parents and ` : '';
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: `${folder}trashed=false and (${types})`, pageSize: '100',
          fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',
          supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        const list = await getJson<{ nextPageToken?: string; files: { id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }[] }>(
          fetchFn, `https://www.googleapis.com/drive/v3/files?${params}`, auth);
        for (const f of list.files) {
          const isDoc = f.mimeType === GOOGLE_DOC;
          const url = isDoc
            ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/html`
            : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
          const res = await fetchFn(url, { headers: auth });
          if (!res.ok) throw new Error(`Google Drive respondeu ${res.status} ao baixar ${f.name}`);
          const ext = isDoc ? '.html' : (extname(f.name).toLowerCase() || DOWNLOADABLE[f.mimeType]!);
          if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) continue;
          yield {
            id: f.id,
            title: isDoc ? f.name : f.name.slice(0, f.name.length - extname(f.name).length) || f.name,
            url: f.webViewLink ?? null,
            fileName: `${f.id}${ext}`,
            data: Buffer.from(await res.arrayBuffer()),
            updatedAt: f.modifiedTime,
          };
        }
        pageToken = list.nextPageToken;
      } while (pageToken);
    },
  };
}
