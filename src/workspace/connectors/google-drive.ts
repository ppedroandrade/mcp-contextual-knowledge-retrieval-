import type { RemoteDocument } from '../types.js';
import { ConnectorHttpError, request, requestJson } from './http.js';
import type { Connector, ConnectorContext } from './types.js';

/**
 * Conector do Google Drive (Google Docs, PDF, .docx, texto e Markdown). OAuth 2.0 com o
 * escopo `drive.readonly`; o refresh token fica em credentials.json. Documentação:
 * https://developers.google.com/drive/api/reference/rest/v3
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DRIVE_MIME_TYPES = [GOOGLE_DOC, 'application/pdf', DOCX, 'text/plain', 'text/markdown'];
/** Arquivos maiores que isso são ignorados na sincronização. */
export const DRIVE_MAX_BYTES = 15 * 1024 * 1024;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: DRIVE_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  }).toString();
  return u.toString();
}

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string }

async function token(fetchFn: typeof fetch, body: Record<string, string>): Promise<TokenResponse> {
  return requestJson<TokenResponse>(fetchFn, GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  }, { retries: 1 });
}

/** Troca o código do callback pelos tokens. Sem refresh token, a conexão não sobrevive 1 hora. */
export async function exchangeGoogleCode(fetchFn: typeof fetch, cfg: GoogleOAuthConfig, code: string): Promise<Record<string, string>> {
  const t = await token(fetchFn, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('o Google não devolveu refresh token; remova o acesso do app em myaccount.google.com/permissions e conecte de novo');
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: String(Date.now() + t.expires_in * 1000), clientId: cfg.clientId, clientSecret: cfg.clientSecret };
}

/** Token de acesso válido, renovado pelo refresh token quando falta menos de 1 minuto. */
async function accessToken(ctx: ConnectorContext, force = false): Promise<string> {
  const s = ctx.secrets;
  if (!s.refreshToken) throw new Error('Google Drive sem refresh token; conecte de novo');
  if (!force && s.accessToken && Number(s.expiresAt) - Date.now() > 60_000) return s.accessToken;
  const t = await token(ctx.fetch, { refresh_token: s.refreshToken, client_id: s.clientId ?? '', client_secret: s.clientSecret ?? '', grant_type: 'refresh_token' });
  const next = { ...s, accessToken: t.access_token, expiresAt: String(Date.now() + t.expires_in * 1000) };
  ctx.saveSecrets(next);
  ctx.secrets = next;
  return t.access_token;
}

/** GET autenticado; um 401 renova o token uma vez (token revogado ou relógio adiantado). */
async function driveGet(ctx: ConnectorContext, url: string): Promise<Response> {
  const go = async (force: boolean) => request(ctx.fetch, url, { headers: { authorization: `Bearer ${await accessToken(ctx, force)}` } }, ctx.http);
  try {
    return await go(false);
  } catch (err) {
    if (err instanceof ConnectorHttpError && err.status === 401) return go(true);
    throw err;
  }
}

interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string; size?: string }

export function driveQuery(folderId?: string): string {
  const types = DRIVE_MIME_TYPES.map((m) => `mimeType = '${m}'`).join(' or ');
  const folder = folderId ? ` and '${folderId.replace(/['\\]/g, '')}' in parents` : '';
  return `trashed = false and (${types})${folder}`;
}

export const googleDriveConnector: Connector = {
  kind: 'gdrive',
  async list(ctx) {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const u = new URL(`${DRIVE_API}/files`);
      u.search = new URLSearchParams({
        q: driveQuery(ctx.settings.folderId), pageSize: '100', orderBy: 'modifiedTime desc',
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const page = (await (await driveGet(ctx, u.toString())).json()) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files
      .filter((f) => !f.size || Number(f.size) <= DRIVE_MAX_BYTES)
      .map((f): RemoteDocument => ({
        externalId: f.id, title: f.name, version: f.modifiedTime, mimeType: f.mimeType,
        ...(f.webViewLink ? { url: f.webViewLink } : {}),
        async fetch() {
          const id = encodeURIComponent(f.id);
          // Google Docs não tem conteúdo binário: exporta como HTML para manter os títulos das seções.
          const url = f.mimeType === GOOGLE_DOC ? `${DRIVE_API}/files/${id}/export?mimeType=text%2Fhtml` : `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`;
          const res = await driveGet(ctx, url);
          return { data: Buffer.from(await res.arrayBuffer()), mimeType: f.mimeType === GOOGLE_DOC ? 'text/html' : f.mimeType, fileName: f.name };
        },
      }));
  },
};
