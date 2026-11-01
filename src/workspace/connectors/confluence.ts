import type { RemoteDocument } from '../types.js';
import { requestJson } from './http.js';
import type { Connector, ConnectorContext } from './types.js';

/**
 * Conector do Confluence Cloud (Atlassian), API REST v2, com e-mail + API token
 * (https://id.atlassian.com/manage-profile/security/api-tokens). Documentação:
 * https://developer.atlassian.com/cloud/confluence/rest/v2/
 */

interface Page {
  id: string;
  title: string;
  spaceId: string;
  version?: { number: number; createdAt?: string };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}
interface Paged<T> { results: T[]; _links?: { next?: string } }

/** Normaliza a URL do site: `https://empresa.atlassian.net` (sem /wiki nem barra no fim). */
export function confluenceBaseUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== 'https:') throw new Error('a URL do Confluence precisa ser https');
  return `${u.origin}`;
}

function auth(ctx: ConnectorContext) {
  const { email, apiToken } = ctx.secrets;
  if (!email || !apiToken) throw new Error('Confluence sem e-mail ou API token');
  return { authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`, accept: 'application/json' };
}

async function* paginate<T>(ctx: ConnectorContext, base: string, first: string): AsyncGenerator<T> {
  let next: string | undefined = first;
  while (next) {
    const url: string = next.startsWith('http') ? next : `${base}${next.startsWith('/wiki') ? '' : '/wiki'}${next}`;
    const page: Paged<T> = await requestJson<Paged<T>>(ctx.fetch, url, { headers: auth(ctx) }, ctx.http);
    yield* page.results;
    next = page._links?.next;
  }
}

/** Ids dos espaços pelas chaves (ex.: `ENG,OPS`). Chave inexistente é erro, não lista vazia. */
async function spaceIds(ctx: ConnectorContext, base: string, keys: string[]): Promise<string[]> {
  const found = new Map<string, string>();
  for await (const s of paginate<{ id: string; key: string }>(ctx, base, `/wiki/api/v2/spaces?keys=${encodeURIComponent(keys.join(','))}&limit=250`)) found.set(s.key, s.id);
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) throw new Error(`espaço do Confluence não encontrado ou sem acesso: ${missing.join(', ')}`);
  return [...found.values()];
}

/** Confere as credenciais antes de criar a fonte (resposta rápida no formulário). */
export async function verifyConfluence(ctx: ConnectorContext): Promise<void> {
  const base = confluenceBaseUrl(ctx.settings.baseUrl ?? '');
  await requestJson(ctx.fetch, `${base}/wiki/api/v2/spaces?limit=1`, { headers: auth(ctx) }, { ...ctx.http, retries: 0 });
}

export const confluenceConnector: Connector = {
  kind: 'confluence',
  async list(ctx) {
    const base = confluenceBaseUrl(ctx.settings.baseUrl ?? '');
    const keys = (ctx.settings.spaceKeys ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    const ids = keys.length ? await spaceIds(ctx, base, keys) : [];
    const query = `/wiki/api/v2/pages?limit=100&status=current&body-format=storage${ids.length ? `&space-id=${ids.join(',')}` : ''}`;
    const docs: RemoteDocument[] = [];
    // A listagem já traz o corpo: guarda e devolve no fetch, sem segunda chamada por página.
    for await (const p of paginate<Page>(ctx, base, query)) {
      const html = p.body?.storage?.value ?? '';
      docs.push({
        externalId: p.id, title: p.title, version: String(p.version?.number ?? p.version?.createdAt ?? ''), mimeType: 'text/html',
        ...(p._links?.webui ? { url: `${base}/wiki${p._links.webui}` } : {}),
        async fetch() {
          return { data: Buffer.from(`<html><head><title>${p.title.replace(/</g, '&lt;')}</title></head><body>${html}</body></html>`), mimeType: 'text/html' };
        },
      });
    }
    return docs;
  },
};
