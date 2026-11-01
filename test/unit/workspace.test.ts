import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedProvider } from '../../src/generation/simulated.js';
import { ABSTENTION } from '../../src/generation/prompt.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';
import { createWorkspaceHandler } from '../../src/workspace/app.js';
import { buildWorkspaceMessages, ChatService, extractiveAnswer, retrievalQuery } from '../../src/workspace/chat.js';
import { chunkSections } from '../../src/workspace/chunk.js';
import { confluenceBaseUrl } from '../../src/workspace/connectors/confluence.js';
import { driveQuery, exchangeGoogleCode, googleAuthUrl } from '../../src/workspace/connectors/google-drive.js';
import { ConnectorHttpError, request } from '../../src/workspace/connectors/http.js';
import { createMockApis, MOCK_CONFLUENCE_URL } from '../../src/workspace/connectors/mock.js';
import { decodeEntities, docxToSections, extractSections, htmlToSections, markdownToSections, parseCsv, UnsupportedFormatError } from '../../src/workspace/extract.js';
import { createWorkspaceMcpServer, WorkspaceHost } from '../../src/workspace/mcp.js';
import { FileWorkspaceStore } from '../../src/workspace/store.js';
import type { ChunkHit, WorkspaceChunk } from '../../src/workspace/types.js';
import { Workspace } from '../../src/workspace/workspace.js';

const NO_WAIT = { retries: 2, backoffMs: () => 0, timeoutMs: 5000 };
const GOOGLE = { clientId: 'cliente-simulado', clientSecret: 'segredo-simulado', redirectUri: 'http://localhost/api/connectors/google/callback' };
const CONFLUENCE_SECRETS = { email: 'demo@aurora.com.br', apiToken: 'token-demo' };

/** ZIP mínimo (deflate) com as entradas dadas, para montar um .docx no teste. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = deflateRawSync(Buffer.from(content));
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const DOCX = zip({ 'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${para('Contrato de transporte', 'Ttulo')}${para('Avarias', 'Heading1')}${para('Limite de R$ 50.000 por carga &amp; seguro.')}${para('Prazo', 'Ttulo1')}${para('7 dias corridos.')}</w:body></w:document>` });

/** PDF mínimo de uma página com o texto dado (xref calculado). */
function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function newWorkspace(opts: { dir?: string | null; mock?: ReturnType<typeof createMockApis>; embedder?: HashEmbedder } = {}) {
  const embedder = opts.embedder ?? new HashEmbedder(512);
  const dir = opts.dir ?? null;
  const store = new FileWorkspaceStore(dir ? join(dir, 'indice.json') : null);
  const mock = opts.mock ?? createMockApis();
  return { ws: new Workspace({ dir, embedder, store, fetch: mock.fetch, http: NO_WAIT }), mock, store, embedder };
}

async function connectedHost(ws: Workspace) {
  const mcp = createWorkspaceMcpServer(ws.embedder, ws.store, () => ws.sources());
  ws.onSourcesChanged = mcp.refresh;
  const [c, s] = InMemoryTransport.createLinkedPair();
  await mcp.server.connect(s);
  return { host: await WorkspaceHost.connect(c), mcp };
}

describe('extração de texto', () => {
  it('Markdown: seções pelos títulos, sem front-matter', () => {
    const r = markdownToSections('---\nid: x\n---\n# Manual\nIntro.\n## Prazo\nAté 30 dias.\n### Exceção\nDiretor aprova.');
    expect(r.title).toBe('Manual');
    expect(r.sections).toEqual([{ heading: 'Manual', text: 'Intro.' }, { heading: 'Prazo', text: 'Até 30 dias.' }, { heading: 'Exceção', text: 'Diretor aprova.' }]);
  });

  it('HTML: seções por h1–h4, entidades, listas, CDATA e sem script', () => {
    const r = htmlToSections('<html><head><title>Runbook &amp; deploy</title><style>p{}</style></head><body><p>Topo</p><h2>Sa&uacute;de &#8212; API</h2><p>GET&nbsp;/health</p><script>alert(1)</script><ul><li>um</li><li>dois</li></ul><ac:plain-text-body><![CDATA[x < y]]></ac:plain-text-body></body></html>');
    expect(r.title).toBe('Runbook & deploy');
    expect(r.sections[0]).toEqual({ heading: '', text: 'Topo' });
    expect(r.sections[1]!.heading).toBe('Saúde — API');
    expect(r.sections[1]!.text).toContain('GET /health');
    expect(r.sections[1]!.text).toContain('- um\n- dois');
    expect(r.sections[1]!.text).toContain('x < y');
    expect(r.sections[1]!.text).not.toContain('alert');
  });

  it('decodifica entidades numéricas e nomeadas', () => {
    expect(decodeEntities('&#x41;&#66;&lt;&quot;&unknown;&ccedil;&Atilde;o')).toBe('AB<"&unknown;çÃo');
  });

  it('CSV: detecta ponto e vírgula e respeita aspas', () => {
    expect(parseCsv('nome;valor\n"Silva; João";"10,5"\n')).toEqual([['nome', 'valor'], ['Silva; João', '10,5']]);
    expect(parseCsv('a,b\n1,"x ""y"""')).toEqual([['a', 'b'], ['1', 'x "y"']]);
  });

  it('.docx: título, seções pelos estilos de título (em inglês e português) e entidades', async () => {
    const r = docxToSections(DOCX);
    expect(r.title).toBe('Contrato de transporte');
    expect(r.sections).toEqual([{ heading: 'Avarias', text: 'Limite de R$ 50.000 por carga & seguro.' }, { heading: 'Prazo', text: '7 dias corridos.' }]);
    expect((await extractSections(DOCX, undefined, 'contrato.docx')).title).toBe('Contrato de transporte');
  });

  it('PDF: uma seção por página', async () => {
    const r = await extractSections(pdf('Senhas com 14 caracteres'), 'application/pdf', 'politica.pdf');
    expect(r.title).toBe('politica');
    expect(r.sections).toEqual([{ heading: 'página 1', text: 'Senhas com 14 caracteres' }]);
  });

  it('formato desconhecido e JSON inválido são recusados', async () => {
    await expect(extractSections(Buffer.from('x'), 'image/png', 'foto.png')).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(extractSections(Buffer.from('{'), undefined, 'a.json')).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});

describe('segmentação', () => {
  it('junta parágrafos até o limite e quebra parágrafo longo por frases', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Frase número ${i} do parágrafo.`).join(' ');
    const out = chunkSections([{ heading: 'A', text: `curto\n\noutro curto\n\n${long}` }], 200);
    expect(out[0]!.text.startsWith('curto\n\noutro curto\n\nFrase número 0')).toBe(true);
    expect(out.length).toBeGreaterThan(3);
    expect(out.every((c) => c.text.length <= 200 && c.heading === 'A')).toBe(true);
    expect(out.map((c) => c.text).join(' ').replace(/\s+/g, ' ')).toContain('Frase número 29 do parágrafo.');
  });
});

describe('cliente HTTP dos conectores', () => {
  it('repete 503 e falha de rede; não repete 401', async () => {
    let n = 0;
    const flaky = (async () => { n++; if (n === 1) throw new TypeError('fetch failed'); return n === 2 ? new Response('x', { status: 503 }) : new Response('ok'); }) as unknown as typeof fetch;
    expect(await (await request(flaky, 'https://x.test/a', {}, NO_WAIT)).text()).toBe('ok');
    expect(n).toBe(3);
    let m = 0;
    const denied = (async () => { m++; return new Response('nope', { status: 401 }); }) as unknown as typeof fetch;
    await expect(request(denied, 'https://x.test/a', {}, NO_WAIT)).rejects.toMatchObject({ status: 401 });
    expect(m).toBe(1);
  });

  it('desiste depois das tentativas e informa o status', async () => {
    const down = (async () => new Response('fora', { status: 502 })) as unknown as typeof fetch;
    const err = await request(down, 'https://x.test/a', {}, NO_WAIT).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorHttpError);
    expect(err.status).toBe(502);
    expect(err.message).toContain('3 tentativas');
  });
});

describe('conectores', () => {
  it('URL de autorização do Google pede acesso offline só de leitura', () => {
    const u = new URL(googleAuthUrl(GOOGLE, 'abc'));
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('abc');
  });

  it('consulta do Drive filtra os tipos e a pasta, sem injeção de aspas', () => {
    expect(driveQuery()).toContain("mimeType = 'application/vnd.google-apps.document'");
    expect(driveQuery("ab'c")).toContain("'abc' in parents");
  });

  it('normaliza a URL do Confluence e exige https', () => {
    expect(confluenceBaseUrl('https://empresa.atlassian.net/wiki/home')).toBe('https://empresa.atlassian.net');
    expect(() => confluenceBaseUrl('http://empresa.atlassian.net')).toThrow(/https/);
  });

  it('código do OAuth inválido falha', async () => {
    await expect(exchangeGoogleCode(createMockApis().fetch, GOOGLE, 'errado')).rejects.toThrow();
  });
});

describe('workspace: upload e sincronização incremental', () => {
  it('upload novo, repetido, nova versão e remoção', async () => {
    const { ws } = newWorkspace();
    const first = await ws.upload('Manual.md', Buffer.from('# Manual\n## Prazo\nO prazo é de 30 dias.'));
    expect(first.status).toBe('added');
    expect(first.doc).toMatchObject({ key: 'D1', title: 'Manual', chunkCount: 1 });
    expect((await ws.upload('Manual.md', Buffer.from('# Manual\n## Prazo\nO prazo é de 30 dias.'))).status).toBe('unchanged');
    const second = await ws.upload('manual.MD', Buffer.from('# Manual\n## Prazo\nO prazo é de 45 dias.\n## Exceção\nDiretor.'));
    expect(second).toMatchObject({ status: 'updated', doc: { key: 'D1', chunkCount: 2 } });
    expect(await ws.store.count()).toBe(2);
    expect((await ws.store.get('D1#1'))!.text).toContain('45 dias');
    await ws.removeDoc('D1');
    expect(await ws.store.count()).toBe(0);
    expect(ws.docs()).toEqual([]);
  });

  it('recusa formato desconhecido, arquivo vazio e documento sem texto', async () => {
    const { ws } = newWorkspace();
    await expect(ws.upload('foto.png', Buffer.from('x'))).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(ws.upload('vazio.txt', Buffer.alloc(0))).rejects.toThrow(/vazio/);
    await expect(ws.upload('branco.txt', Buffer.from('   \n  '))).rejects.toThrow(/nenhum texto/);
  });

  it('Google Drive: indexa, não refaz o que não mudou, atualiza e remove o que sumiu', async () => {
    const { ws, mock } = newWorkspace();
    const secrets = await exchangeGoogleCode(mock.fetch, GOOGLE, 'codigo-simulado');
    const s = ws.addSource('gdrive', 'Google Drive', {}, secrets);
    expect(s.id).toBe('gdrive');
    expect(await ws.sync(s.id)).toEqual({ added: 4, updated: 0, removed: 0, unchanged: 0, failed: [] });
    const doc = ws.docs(s.id).find((d) => d.title.startsWith('Política de reembolso'))!;
    expect(doc.url).toContain('docs.google.com');
    expect(ws.docs(s.id).find((d) => d.mimeType === 'text/plain')!.title).toBe('Canais de atendimento');

    mock.calls.length = 0;
    expect(await ws.sync(s.id)).toMatchObject({ added: 0, updated: 0, unchanged: 4 });
    expect(mock.calls.some((c) => c.includes('/export'))).toBe(false);

    mock.drive[0]!.modifiedTime = '2026-11-01T00:00:00.000Z';
    mock.drive[0]!.html = '<h2>Limites</h2><p>Hospedagem: até R$ 500 por noite.</p>';
    mock.drive.splice(2, 1);
    expect(await ws.sync(s.id)).toMatchObject({ added: 0, updated: 1, removed: 1, unchanged: 2 });
    const updated = ws.docs(s.id).find((d) => d.externalId === mock.drive[0]!.id)!;
    expect(updated.key).toBe(doc.key);
    expect((await ws.store.get(`${doc.key}#1`))!.text).toContain('R$ 500');
    expect(await ws.store.get(`${doc.key}#2`)).toBeNull();
    expect(ws.docs(s.id)).toHaveLength(3);
  });

  it('Google Drive: renova o token expirado e grava o novo', async () => {
    const { ws, mock } = newWorkspace();
    const secrets = { ...(await exchangeGoogleCode(mock.fetch, GOOGLE, 'codigo-simulado')), accessToken: 'vencido', expiresAt: '0' };
    const s = ws.addSource('gdrive', 'Google Drive', {}, secrets);
    await ws.sync(s.id);
    expect(ws.state.getSecrets(s.id).accessToken).toBe('ya29.simulado');
    expect(Number(ws.state.getSecrets(s.id).expiresAt)).toBeGreaterThan(Date.now());
  });

  it('Confluence: pagina por cursor, filtra espaços e guarda o link da página', async () => {
    const { ws } = newWorkspace();
    const all = ws.addSource('confluence', 'Confluence', { baseUrl: MOCK_CONFLUENCE_URL, spaceKeys: '' }, CONFLUENCE_SECRETS, 'aurora-logistica');
    expect(all.id).toBe('confluence_aurora_logistica');
    expect((await ws.sync(all.id)).added).toBe(4);
    expect(ws.docs(all.id).find((d) => d.title === 'Processo de deploy')!.url).toBe(`${MOCK_CONFLUENCE_URL}/wiki/spaces/ENG/pages/65538`);
    const ops = ws.addSource('confluence', 'Só OPS', { baseUrl: MOCK_CONFLUENCE_URL, spaceKeys: 'OPS' }, CONFLUENCE_SECRETS, 'aurora-logistica');
    expect(ops.id).toBe('confluence_aurora_logistica_2');
    expect((await ws.sync(ops.id)).added).toBe(2);
  });

  it('Confluence: espaço inexistente e credencial errada deixam a fonte em erro', async () => {
    const { ws } = newWorkspace();
    const bad = ws.addSource('confluence', 'X', { baseUrl: MOCK_CONFLUENCE_URL, spaceKeys: 'NAOEXISTE' }, CONFLUENCE_SECRETS);
    await expect(ws.sync(bad.id)).rejects.toThrow(/NAOEXISTE/);
    expect(ws.source(bad.id)).toMatchObject({ status: 'error' });
    const denied = ws.addSource('confluence', 'Y', { baseUrl: MOCK_CONFLUENCE_URL }, { email: 'x@y', apiToken: 'errado' });
    await expect(ws.sync(denied.id)).rejects.toMatchObject({ status: 401 });
  });

  it('falha num documento não derruba a sincronização nem apaga a versão anterior', async () => {
    const mock = createMockApis();
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('1bOnboardingAbC/export') && failing.broken) return new Response('erro interno', { status: 500 });
      return mock.fetch(input, init);
    }) as typeof fetch & { broken: boolean };
    failing.broken = false;
    const { ws } = newWorkspace({ mock: { ...mock, fetch: failing } });
    const s = ws.addSource('gdrive', 'Google Drive', {}, await exchangeGoogleCode(mock.fetch, GOOGLE, 'codigo-simulado'));
    await ws.sync(s.id);
    const before = ws.docs(s.id).find((d) => d.title.startsWith('Onboarding'))!;
    failing.broken = true;
    mock.drive[1]!.modifiedTime = '2026-11-01T00:00:00.000Z';
    const r = await ws.sync(s.id);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.error).toContain('500');
    expect(r.unchanged).toBe(3);
    expect(ws.source(s.id)).toMatchObject({ status: 'idle' });
    expect(ws.source(s.id).lastError).toContain('Onboarding');
    expect(ws.docs(s.id).find((d) => d.key === before.key)!.version).toBe(before.version);
    // Na próxima sincronização, com a API de volta, a versão nova entra.
    failing.broken = false;
    expect((await ws.sync(s.id)).updated).toBe(1);
  });

  it('sincronizações simultâneas da mesma fonte rodam uma vez só', async () => {
    const { ws, mock } = newWorkspace();
    const s = ws.addSource('confluence', 'C', { baseUrl: MOCK_CONFLUENCE_URL }, CONFLUENCE_SECRETS);
    const [a, b] = [ws.sync(s.id), ws.sync(s.id)];
    expect(a).toBe(b);
    await a;
    expect(mock.calls.filter((c) => c.includes('/pages')).length).toBe(2);
  });

  it('remover a fonte tira os trechos do índice e apaga os segredos', async () => {
    const { ws } = newWorkspace();
    const s = ws.addSource('confluence', 'C', { baseUrl: MOCK_CONFLUENCE_URL }, CONFLUENCE_SECRETS);
    await ws.sync(s.id);
    await ws.upload('a.txt', Buffer.from('texto do upload'));
    await ws.removeSource(s.id);
    expect(await ws.store.count()).toBe(1);
    expect(ws.state.getSecrets(s.id)).toEqual({});
    await expect(ws.removeSource('uploads')).rejects.toThrow(/não pode ser removida/);
  });
});

describe('workspace: persistência', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'ws-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reabre com fontes, documentos e índice; segredos fora do workspace.json, com permissão 600', async () => {
    const { ws } = newWorkspace({ dir });
    const s = ws.addSource('confluence', 'C', { baseUrl: MOCK_CONFLUENCE_URL }, CONFLUENCE_SECRETS);
    await ws.sync(s.id);
    await ws.upload('Manual.md', Buffer.from('# Manual\nPrazo de 30 dias.'));
    expect(readFileSync(join(dir, 'workspace.json'), 'utf8')).not.toContain('token-demo');
    expect(statSync(join(dir, 'credentials.json')).mode & 0o777).toBe(0o600);

    const again = newWorkspace({ dir }).ws;
    expect(again.docs()).toHaveLength(5);
    expect(await again.store.count()).toBe(await ws.store.count());
    expect(again.state.getSecrets(s.id)).toEqual(CONFLUENCE_SECRETS);
  });

  it('com outro modelo de embeddings, refaz o índice a partir dos uploads guardados e dos conectores', async () => {
    const { ws } = newWorkspace({ dir, embedder: new HashEmbedder(128) });
    expect(await ws.reindexIfEmbedderChanged()).toBe(true);
    expect(ws.state.data.embedder).toBe('hash:128');
    expect(ws.docs()).toHaveLength(5);
    expect(await ws.reindexIfEmbedderChanged()).toBe(false);
  });
});

describe('servidor MCP e host do workspace', () => {
  it('uma tool por fonte; fonte nova, renomeada e removida avisam o cliente', async () => {
    const { ws } = newWorkspace();
    const mcp = createWorkspaceMcpServer(ws.embedder, ws.store, () => ws.sources());
    ws.onSourcesChanged = mcp.refresh;
    const [c, s] = InMemoryTransport.createLinkedPair();
    await mcp.server.connect(s);
    const client = new Client({ name: 't', version: '0' });
    let changes = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { changes++; });
    await client.connect(c);
    const names = async () => (await client.listTools()).tools.map((t) => t.name);
    expect(await names()).toEqual(['buscar_uploads']);
    const src = ws.addSource('confluence', 'Wiki', { baseUrl: MOCK_CONFLUENCE_URL }, CONFLUENCE_SECRETS);
    expect(await names()).toEqual(['buscar_uploads', 'buscar_confluence']);
    ws.updateSource(src.id, { description: 'Runbooks e postmortems.' });
    expect((await client.listTools()).tools[1]!.description).toContain('Runbooks e postmortems.');
    await ws.removeSource(src.id);
    expect(await names()).toEqual(['buscar_uploads']);
    await new Promise((ok) => setTimeout(ok, 10));
    expect(changes).toBeGreaterThanOrEqual(3);
    await client.close();
  });

  it('o host chama todas as tools e funde por RRF; ids e metadados chegam intactos', async () => {
    const { ws } = newWorkspace();
    const { host } = await connectedHost(ws);
    await ws.upload('Reembolso.md', Buffer.from('# Reembolso\n## Prazo\nO pedido de reembolso deve ser feito em até 30 dias.'));
    const src = ws.addSource('confluence', 'Wiki', { baseUrl: MOCK_CONFLUENCE_URL }, CONFLUENCE_SECRETS);
    await ws.sync(src.id);
    const r = await host.search('prazo do pedido de reembolso', 5);
    expect(r.tools.map((t) => t.name).sort()).toEqual(['buscar_confluence', 'buscar_uploads']);
    expect(r.hits).toHaveLength(5);
    expect(r.hits[0]!.chunk).toMatchObject({ id: 'D1#1', sourceId: 'uploads', docKey: 'D1', title: 'Reembolso', heading: 'Prazo' });
    expect(r.hits.find((h) => h.chunk.sourceId === src.id)!.chunk.url).toContain(MOCK_CONFLUENCE_URL);
    await host.close();
  });
});

describe('chat', () => {
  const chunk = (id: string, title: string, heading: string, text: string): ChunkHit => ({ chunk: { id, sourceId: 's', docKey: id.split('#')[0]!, title, heading, text } as WorkspaceChunk, score: 1 });

  it('consulta de continuação junta a pergunta anterior; pergunta nova não', () => {
    const h = [{ role: 'user' as const, text: 'Qual o limite de hospedagem?', at: '' }];
    expect(retrievalQuery('e no interior?', h)).toBe('Qual o limite de hospedagem?\ne no interior?');
    expect(retrievalQuery('E para PJ?', h)).toContain('hospedagem');
    expect(retrievalQuery('Qual é a capital da França?', h)).toBe('Qual é a capital da França?');
    expect(retrievalQuery('Quem aprova férias fora do prazo?', h)).toBe('Quem aprova férias fora do prazo?');
    expect(retrievalQuery('e no interior?', [])).toBe('e no interior?');
  });

  it('resposta extrativa escolhe a frase que cobre a pergunta, cita e se abstém sem termos em comum', () => {
    const hits = [
      chunk('D1#1', 'Postmortem atraso', 'Resumo', 'Em 14/10 as entregas atrasaram.'),
      chunk('D1#2', 'Postmortem atraso', 'Causa raiz', 'O certificado TLS expirou.'),
      chunk('D2#1', 'Reembolso', 'Pagamento', 'Pago em até 10 dias úteis.'),
    ];
    expect(extractiveAnswer('Qual foi a causa raiz do atraso?', hits)).toMatch(/^O certificado TLS expirou \[D1#2\]\./);
    expect(extractiveAnswer('capital da França', hits)).toBe(ABSTENTION);
  });

  it('prompt com histórico limitado, trechos com fonte e documento', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `t${i}`, at: '' }));
    const m = buildWorkspaceMessages('pergunta?', [chunk('D3#2', 'Manual', 'Prazo', '30 dias')], history, () => 'Google Drive');
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(m[1]!.content).toBe('t2');
    expect(m.at(-1)!.content).toContain('[D3#2] (fonte: Google Drive; documento: Manual; seção: Prazo)\n30 dias');
  });

  it('conversa: cita o trecho, guarda o histórico e marca abstenção', async () => {
    const { ws } = newWorkspace();
    const { host } = await connectedHost(ws);
    await ws.upload('Reembolso.md', Buffer.from('# Reembolso\n## Prazo\nO pedido deve ser feito em até 30 dias.'));
    const chat = new ChatService(ws, host, new SimulatedProvider());
    const { conversation, turn } = await chat.ask(null, 'Qual o prazo do reembolso?');
    expect(turn.citations!.map((c) => c.chunkId)).toEqual(['D1#1']);
    expect(turn.citations![0]).toMatchObject({ sourceName: 'Arquivos enviados', kind: 'upload', title: 'Reembolso' });
    expect(turn.tools![0]!.name).toBe('buscar_uploads');
    const second = await chat.ask(conversation.id, 'e para PJ?');
    expect(second.conversation.turns).toHaveLength(4);
    expect(chat.list()[0]!.title).toBe('Qual o prazo do reembolso?');
    const abst = new ChatService(ws, host, new SimulatedProvider(() => ABSTENTION));
    expect((await abst.ask(null, 'capital da França?')).turn).toMatchObject({ abstained: true, citations: [] });
    await expect(chat.ask('nao-existe', 'x')).rejects.toThrow(/conversa não encontrada/);
    await host.close();
  });
});

describe('API HTTP do workspace', () => {
  let server: Server;
  let base: string;
  let ws: Workspace;
  let host: WorkspaceHost;

  beforeAll(async () => {
    const created = newWorkspace();
    ws = created.ws;
    host = (await connectedHost(ws)).host;
    const handler = createWorkspaceHandler({
      ws, host, chat: new ChatService(ws, host, null), mode: { embedder: 'hash', store: 'memory' }, google: GOOGLE, simulated: true,
      fetch: created.mock.fetch, staticDir: join(import.meta.dirname, '..', '..', 'apps', 'workspace'),
    });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await host?.close();
    await new Promise((ok) => server?.close(ok));
  });

  const json = (path: string, body?: unknown, method = body ? 'POST' : 'GET') =>
    fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const until = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((ok) => setTimeout(ok, 10)); };

  it('serve a UI e recusa caminhos fora da pasta', async () => {
    expect((await fetch(`${base}/`)).headers.get('content-type')).toContain('text/html');
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/api/nada`)).status).toBe(404);
  });

  it('upload em base64, documento listado e citado no chat extrativo', async () => {
    const up = await json('/api/uploads', { name: 'Ferias.docx', contentBase64: DOCX.toString('base64') });
    expect(up.status).toBe(201);
    expect((await json('/api/uploads', { name: 'x.exe', contentBase64: 'eA==' })).status).toBe(400);
    const { sources } = await (await json('/api/sources')).json();
    expect(sources[0]).toMatchObject({ id: 'uploads', documents: 1 });
    const r = await (await json('/api/conversations/nova/messages', { question: 'Qual o limite por carga nas avarias?' })).json();
    expect(r.turn.text).toContain('R$ 50.000');
    expect(r.turn.citations[0].chunkId).toBe('D1#1');
    expect((await (await json(`/api/conversations/${r.conversation.id}`)).json()).conversation.turns).toHaveLength(2);
    expect((await (await json('/api/chunks/D1%231')).json()).sourceName).toBe('Arquivos enviados');
  });

  it('Confluence: credencial errada é 400; certa cria a fonte e sincroniza em segundo plano', async () => {
    const bad = await json('/api/connectors/confluence', { baseUrl: MOCK_CONFLUENCE_URL, email: 'x@y.z', apiToken: 'errado' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('recusou');
    expect((await json('/api/connectors/confluence', { baseUrl: 'ftp://x', email: 'a@b', apiToken: 't' })).status).toBe(400);
    const ok = await json('/api/connectors/confluence', { baseUrl: `${MOCK_CONFLUENCE_URL}/wiki`, ...CONFLUENCE_SECRETS, spaceKeys: 'eng' });
    expect(ok.status).toBe(201);
    const { source } = await ok.json();
    expect(source.settings).toEqual({ baseUrl: MOCK_CONFLUENCE_URL, spaceKeys: 'ENG' });
    expect(JSON.stringify(source)).not.toContain('token-demo');
    await until(() => !ws.isSyncing(source.id));
    expect(ws.docs(source.id)).toHaveLength(2);
    const tools = (await (await json('/api/mcp/tools')).json()).tools.map((t: { name: string }) => t.name);
    expect(tools).toContain(`buscar_${source.id}`);
  });

  it('Google: start redireciona com state; callback com state inválido não conecta', async () => {
    const start = await json('/api/connectors/google/start?folderId=pasta123');
    expect(start.status).toBe(302);
    const loc = start.headers.get('location')!;
    expect(loc).toMatch(/code=codigo-simulado&state=[0-9a-f]{32}$/);
    const forged = await json('/api/connectors/google/callback?code=codigo-simulado&state=forjado');
    expect(forged.headers.get('location')).toMatch(/^\/\?erro=/);
    const cb = await json(loc);
    expect(cb.headers.get('location')).toBe('/?conectado=gdrive');
    expect(ws.source('gdrive').settings).toEqual({ folderId: 'pasta123' });
    // O mesmo state não serve duas vezes.
    expect((await json(loc)).headers.get('location')).toMatch(/^\/\?erro=/);
    await until(() => !ws.isSyncing('gdrive'));
  });

  it('edita a descrição, não apaga documento de conector e remove a fonte', async () => {
    const patched = await (await json('/api/sources/gdrive', { description: 'Políticas de RH.' }, 'PATCH')).json();
    expect(patched.source.description).toBe('Políticas de RH.');
    const key = ws.docs('gdrive')[0]?.key ?? 'D99';
    expect((await json(`/api/sources/gdrive/docs/${key}`, undefined, 'DELETE')).status).toBe(400);
    expect((await json('/api/sources/gdrive', undefined, 'DELETE')).status).toBe(200);
    expect((await json('/api/sources/gdrive', undefined, 'DELETE')).status).toBe(404);
    expect((await json('/api/sources/uploads/sync', {})).status).toBe(400);
  });
});
