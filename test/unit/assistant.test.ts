import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssistantHandler } from '../../src/assistant/app.js';
import { buildChatMessages, citedNumbers, OllamaChatStreamer, retrievalQuery, SimulatedChatStreamer, toCitations } from '../../src/assistant/chat.js';
import { confluenceConnector, googleAuthUrl, googleDriveConnector, googleExchangeCode, type Connector, type IncomingDocument } from '../../src/assistant/connectors.js';
import { chunkDocument, htmlToSections, markdownToSections, parseFile, textToSections } from '../../src/assistant/documents.js';
import { indexDocument, searchSource, syncSource } from '../../src/assistant/knowledge.js';
import { createKnowledgeMcpServer, KnowledgeHost, toolNameFor } from '../../src/assistant/mcp.js';
import { MemoryChunkStore } from '../../src/assistant/store.js';
import { Workspace, type KnowledgeSource } from '../../src/assistant/workspace.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'assistente-teste-'));
const doc = (id: string, text: string, extra: Partial<IncomingDocument> = {}): IncomingDocument =>
  ({ id, title: '', url: null, fileName: `${id}.md`, data: Buffer.from(text), ...extra });

/** PDF mínimo com uma linha de texto (Helvetica), com a tabela xref correta. */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 14 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('leitura de documentos', () => {
  it('divide o Markdown nos títulos e ignora o front-matter', () => {
    const d = markdownToSections('---\nid: x\n---\n# Runbook\nIntro.\n\n## Rollback\nUse o comando.\n### Detalhe\nMais.', 'arquivo');
    expect(d.title).toBe('Runbook');
    expect(d.sections).toEqual([
      { heading: 'Runbook', text: 'Intro.' },
      { heading: 'Rollback', text: 'Use o comando.' },
      { heading: 'Detalhe', text: 'Mais.' },
    ]);
  });

  it('lê HTML com título, seções, listas e entidades', () => {
    const d = htmlToSections('<html><head><title>Política &amp; RH</title></head><body><p>Abertura</p><h2>Prazos</h2><ul><li>30&nbsp;dias</li><li>3 períodos</li></ul><script>x()</script></body></html>', 'f');
    expect(d.title).toBe('Política & RH');
    expect(d.sections).toEqual([{ heading: 'Introdução', text: 'Abertura' }, { heading: 'Prazos', text: '- 30 dias\n- 3 períodos' }]);
  });

  it('lê texto puro e PDF; recusa formato desconhecido', async () => {
    expect(textToSections('a\r\n\r\n\r\nb', 't')).toEqual({ title: 't', sections: [{ heading: 'Conteúdo', text: 'a\n\nb' }] });
    const pdf = await parseFile('manual.pdf', minimalPdf('Prazo de ferias: 30 dias'));
    expect(pdf.title).toBe('manual');
    expect(pdf.sections).toEqual([{ heading: 'Página 1', text: 'Prazo de ferias: 30 dias' }]);
    await expect(parseFile('planilha.xlsx', Buffer.from('x'))).rejects.toThrow(/formato não suportado/);
  });

  it('divide em trechos de até maxChars, juntando parágrafos curtos e cortando os longos', () => {
    const long = 'palavra '.repeat(60).trim();
    const chunks = chunkDocument({ title: 't', sections: [{ heading: 'S', text: `um\n\ndois\n\n${long}` }] }, 120);
    expect(chunks[0]).toEqual({ heading: 'S', text: 'um\n\ndois' });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(120);
    expect(chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ')).toBe(`um dois ${long}`);
  });
});

describe('workspace', () => {
  it('guarda fontes e conversas em disco e avisa quando uma fonte entra ou sai', () => {
    const dir = tempDir();
    const ws = new Workspace(dir);
    const events: string[] = [];
    ws.on('fonte', (e) => events.push(`${e.type}:${e.source.name}`));
    const s = ws.createSource({ kind: 'upload', name: '  RH  ' });
    ws.upsertDocument(s.id, { id: 'a', title: 'A', url: null, chunks: 2 });
    const c = ws.createConversation([s.id]);
    ws.appendTurn(c.id, { role: 'user', content: 'Qual é o prazo de férias?\n' });
    ws.removeSource(s.id);
    expect(events).toEqual(['criada:RH', 'removida:RH']);
    const reloaded = new Workspace(dir);
    expect(reloaded.listSources()).toEqual([]);
    expect(reloaded.getConversation(c.id)).toMatchObject({ title: 'Qual é o prazo de férias?', sourceIds: [] });
  });

  it('cifra os segredos em disco e só os devolve com a chave', () => {
    const dir = tempDir();
    const ws = new Workspace(dir);
    const s = ws.createSource({ kind: 'confluence', name: 'Wiki' });
    ws.setSecret(s.id, { email: 'a@b.com', token: 'segredo-123' });
    const onDisk = readFileSync(join(dir, 'estado.json'), 'utf8');
    expect(onDisk).not.toContain('segredo-123');
    expect(new Workspace(dir).getSecret(s.id)).toEqual({ email: 'a@b.com', token: 'segredo-123' });
    expect(() => new Workspace(dir).getSecret('x')).not.toThrow();
  });
});

describe('conectores', () => {
  const source = (config: Record<string, string>): KnowledgeSource =>
    ({ id: 'f', kind: 'confluence', name: 'n', config, status: 'pronta', error: null, documents: [], createdAt: '', syncedAt: null });

  it('Confluence: busca o espaço, pagina as páginas e monta o endereço de cada uma', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, auth: new Headers(init?.headers).get('authorization') });
      if (u.includes('/spaces?keys=ENG')) return Response.json({ results: [{ id: '99' }] });
      if (u.includes('cursor=2')) return Response.json({ results: [{ id: '2', title: 'Deploy', body: { storage: { value: '<h2>Passos</h2><p>Rode o pipeline.</p>' } }, _links: { webui: '/spaces/ENG/pages/2' } }], _links: { base: 'https://acme.atlassian.net/wiki' } });
      return Response.json({ results: [{ id: '1', title: 'Plantão', version: { createdAt: '2026-10-01' }, body: { storage: { value: '<p>Canal #oncall</p>' } }, _links: { webui: '/spaces/ENG/pages/1' } }], _links: { next: '/wiki/api/v2/spaces/99/pages?cursor=2', base: 'https://acme.atlassian.net/wiki' } });
    });
    const docs = [];
    for await (const d of confluenceConnector(fetchFn as unknown as typeof fetch).fetchDocuments(source({ site: 'https://acme.atlassian.net/', spaceKey: 'ENG' }), { email: 'a@acme.com', token: 't' })) docs.push(d);
    expect(docs.map((d) => [d.id, d.title, d.url, d.updatedAt])).toEqual([
      ['1', 'Plantão', 'https://acme.atlassian.net/wiki/spaces/ENG/pages/1', '2026-10-01'],
      ['2', 'Deploy', 'https://acme.atlassian.net/wiki/spaces/ENG/pages/2', undefined],
    ]);
    expect(calls[1]!.url).toBe('https://acme.atlassian.net/wiki/api/v2/spaces/99/pages?body-format=storage&limit=50');
    expect(calls.every((c) => c.auth === `Basic ${Buffer.from('a@acme.com:t').toString('base64')}`)).toBe(true);
    expect((await parseFile(docs[1]!.fileName, docs[1]!.data)).sections).toEqual([{ heading: 'Passos', text: 'Rode o pipeline.' }]);
  });

  it('Confluence: falha com mensagem clara sem configuração ou com espaço inexistente', async () => {
    const run = async (config: Record<string, string>, secret: Record<string, string> | null, fetchFn = vi.fn()) => {
      for await (const _ of confluenceConnector(fetchFn as unknown as typeof fetch).fetchDocuments(source(config), secret)) { /* consome */ }
    };
    await expect(run({ site: 'acme', spaceKey: 'X' }, { email: 'e', token: 't' })).rejects.toThrow(/site do Confluence/);
    await expect(run({ site: 'https://a.atlassian.net', spaceKey: 'X' }, null)).rejects.toThrow(/token de API/);
    await expect(run({ site: 'https://a.atlassian.net', spaceKey: 'X' }, { email: 'e', token: 't' }, vi.fn(async () => Response.json({ results: [] })))).rejects.toThrow(/espaço X não encontrado/);
  });

  const google = { clientId: 'cid', clientSecret: 'cs', redirectUri: 'http://127.0.0.1:3100/api/conectores/google/retorno' };

  it('Google: monta o OAuth com leitura do Drive e troca o código pelo refresh token', async () => {
    const url = new URL(googleAuthUrl(google, 'estado'));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'cid', scope: 'https://www.googleapis.com/auth/drive.readonly', access_type: 'offline', state: 'estado', redirect_uri: google.redirectUri });
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect(String(init!.body)).toContain('grant_type=authorization_code');
      return Response.json({ access_token: 'a', refresh_token: 'r' });
    });
    expect(await googleExchangeCode(google, 'codigo', fetchFn as unknown as typeof fetch)).toBe('r');
  });

  it('Google: exporta Google Docs como HTML, baixa PDF e restringe à pasta', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      urls.push(u);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'acesso' });
      if (u.includes('/drive/v3/files?')) return Response.json({ files: [
        { id: 'd1', name: 'Onboarding', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-10', webViewLink: 'https://docs.google.com/d1' },
        { id: 'p1', name: 'Manual.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-11' },
      ] });
      if (u.includes('/d1/export?mimeType=text/html')) return new Response('<html><head><title>Onboarding</title></head><body><h1>Onboarding</h1><p>Bem-vindo</p></body></html>');
      if (u.includes('/p1?alt=media')) return new Response(new Uint8Array(minimalPdf('Manual')));
      return new Response('não esperado', { status: 500 });
    });
    const docs = [];
    const src = { ...source({ folderId: "pasta'1" }), kind: 'google-drive' as const };
    for await (const d of googleDriveConnector(google, fetchFn as unknown as typeof fetch).fetchDocuments(src, { refreshToken: 'r' })) docs.push(d);
    expect(docs.map((d) => [d.id, d.title, d.fileName, d.url])).toEqual([['d1', 'Onboarding', 'd1.html', 'https://docs.google.com/d1'], ['p1', 'Manual', 'p1.pdf', null]]);
    expect(new URL(urls[1]!).searchParams.get('q')).toMatch(/^'pasta1' in parents and trashed=false/);
  });
});

describe('ingestão, sincronização e busca', () => {
  const embedder = new HashEmbedder();

  it('sincroniza: indexa o que mudou, pula o que não mudou, retira o que sumiu e registra falhas', async () => {
    const ws = new Workspace(tempDir());
    const store = new MemoryChunkStore();
    const s = ws.createSource({ kind: 'confluence', name: 'Wiki' });
    let round: IncomingDocument[] = [doc('a', '# A\nfila de faturas', { updatedAt: '1' }), doc('b', '# B\nplantão', { updatedAt: '1' })];
    const connector: Connector = { async *fetchDocuments() { yield* round; } };
    const spy = vi.spyOn(embedder, 'embed');
    await syncSource(ws, store, embedder, s.id, connector);
    expect(ws.getSource(s.id)).toMatchObject({ status: 'pronta', error: null });
    expect(ws.getSource(s.id).documents.map((d) => d.id)).toEqual(['a', 'b']);
    spy.mockClear();
    round = [doc('a', '# A\nfila de faturas', { updatedAt: '1' }), doc('c', '', { updatedAt: '2', fileName: 'c.txt' })];
    await syncSource(ws, store, embedder, s.id, connector);
    expect(spy).not.toHaveBeenCalled();
    expect(ws.getSource(s.id).documents.map((d) => d.id)).toEqual(['a']);
    expect(ws.getSource(s.id).error).toMatch(/1 documento\(s\) não lido\(s\).*nenhum texto/);
    expect(await store.search((await embedder.embed(['plantão']))[0]!, 5, s.id)).toHaveLength(1);
  });

  it('marca a fonte com erro quando o conector falha', async () => {
    const ws = new Workspace(tempDir());
    const s = ws.createSource({ kind: 'confluence', name: 'Wiki' });
    const broken: Connector = { async *fetchDocuments() { throw new Error('401 não autorizado'); } };
    await syncSource(ws, new MemoryChunkStore(), embedder, s.id, broken);
    expect(ws.getSource(s.id)).toMatchObject({ status: 'erro', error: '401 não autorizado' });
  });
});

describe('servidor MCP e host', () => {
  const embedder = new HashEmbedder();

  async function setup() {
    const ws = new Workspace(tempDir());
    const store = new MemoryChunkStore();
    const search = (id: string, q: string, k: number) => searchSource(store, embedder, id, q, k);
    const { server, dispose } = createKnowledgeMcpServer(ws, search);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const host = await KnowledgeHost.connect(clientT);
    return { ws, store, host, dispose };
  }

  it('uma fonte nova vira uma tool sem mudar o host, e some quando a fonte sai', async () => {
    const { ws, host, dispose } = await setup();
    expect(await host.searchTools()).toEqual([]);
    const a = ws.createSource({ kind: 'upload', name: 'RH' });
    const b = ws.createSource({ kind: 'confluence', name: 'Engenharia' });
    expect((await host.searchTools()).map((t) => [t.name, t.title])).toEqual([[toolNameFor(a.id), 'Buscar em: RH'], [toolNameFor(b.id), 'Buscar em: Engenharia']]);
    ws.removeSource(a.id);
    expect((await host.searchTools()).map((t) => t.sourceId)).toEqual([b.id]);
    dispose();
    await host.close();
  });

  it('busca só nas fontes escolhidas e funde as listas por RRF', async () => {
    const { ws, store, host } = await setup();
    const rh = ws.createSource({ kind: 'upload', name: 'RH' });
    const eng = ws.createSource({ kind: 'upload', name: 'Engenharia' });
    await indexDocument(ws, store, embedder, rh.id, doc('ferias', '# Férias\n## Prazo\nPedido de férias com 30 dias.\n## Outro\nValor do vale refeição.'));
    await indexDocument(ws, store, embedder, eng.id, doc('deploy', '# Deploy\n## Férias da equipe\nNão há deploy em férias coletivas.'));
    const both = await host.retrieve('pedido de férias', null, 5);
    expect(new Set(both.map((p) => p.fonte))).toEqual(new Set([rh.id, eng.id]));
    expect(both[0]!.rrf).toBeCloseTo(1 / 61);
    const onlyRh = await host.retrieve('pedido de férias', [rh.id], 5);
    expect(onlyRh.every((p) => p.fonte === rh.id)).toBe(true);
    expect(onlyRh[0]).toMatchObject({ titulo: 'Férias', secao: 'Prazo' });
    await host.close();
  });
});

describe('conversa', () => {
  it('junta a pergunta curta de seguimento à anterior na busca', () => {
    const history = [{ role: 'user' as const, content: 'Como faço o deploy do billing-api?', createdAt: '' }, { role: 'assistant' as const, content: 'Assim [1].', createdAt: '' }];
    expect(retrievalQuery(history, 'e o rollback?')).toBe('Como faço o deploy do billing-api?\ne o rollback?');
    expect(retrievalQuery(history, 'Qual é o procedimento completo de rollback do billing-api em produção?')).toBe('Qual é o procedimento completo de rollback do billing-api em produção?');
    expect(retrievalQuery([], 'oi')).toBe('oi');
  });

  it('numera os trechos com a fonte e lê as citações [n] da resposta', () => {
    const sources = [{ id: 'f1', kind: 'confluence', name: 'Wiki' }] as KnowledgeSource[];
    const citations = toCitations([{ trecho: 'f1:d:0', fonte: 'f1', documento: 'd', titulo: 'Deploy', secao: 'Passos', url: 'https://x', texto: 'Rode o pipeline.', score: 0.9, rrf: 0.016 }], sources);
    expect(citations[0]).toMatchObject({ n: 1, sourceName: 'Wiki', sourceKind: 'confluence', docTitle: 'Deploy', cited: false });
    const msgs = buildChatMessages([{ role: 'user', content: 'antes', createdAt: '' }], 'Como faço o deploy?', citations);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(msgs[2]!.content).toBe('Trechos das fontes da empresa:\n\n[1] Wiki · Deploy — Passos\nRode o pipeline.\n\nPergunta: Como faço o deploy?');
    expect([...citedNumbers('Rode o pipeline [1] e depois [2, 3]; não [x].')]).toEqual([1, 2, 3]);
  });

  it('lê o streaming do Ollama mesmo com linhas cortadas entre pedaços, sem raciocínio', async () => {
    const bodies: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/api/show')) return Response.json({ capabilities: ['completion', 'thinking'] });
      bodies.push(String(init!.body));
      const enc = new TextEncoder();
      const parts = ['{"message":{"content":"Rode "}}\n{"messa', 'ge":{"content":"o pipeline [1]."}}\n', '{"done":true}\n'];
      return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }));
    });
    const out: string[] = [];
    for await (const t of new OllamaChatStreamer('http://o', 'm', undefined, fetchFn as unknown as typeof fetch).stream([{ role: 'user', content: 'x' }])) out.push(t);
    expect(out).toEqual(['Rode ', 'o pipeline [1].']);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ model: 'm', stream: true, think: false, options: { temperature: 0 } });
  });
});

describe('API do assistente', () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  async function start(connector?: Connector) {
    const embedder = new HashEmbedder();
    const ws = new Workspace(tempDir());
    const store = new MemoryChunkStore();
    const search = (id: string, q: string, k: number) => searchSource(store, embedder, id, q, k);
    const internal = createKnowledgeMcpServer(ws, search);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await internal.server.connect(serverT);
    const host = await KnowledgeHost.connect(clientT);
    server = createServer();
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const handler = createAssistantHandler({
      ws, store, embedder, host, streamer: new SimulatedChatStreamer(), publicUrl: base,
      mcpServer: () => createKnowledgeMcpServer(ws, search),
      connectorFor: (s) => (s.kind === 'upload' ? null : connector ?? null),
      google: null, staticDir: join(import.meta.dirname, '..', '..', 'apps', 'assistant'), mode: {},
    });
    server.on('request', (req, res) => void handler(req, res));
    const call = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
      return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text() };
    };
    return { base, call, ws, handler };
  }

  const events = (sse: string) => sse.trim().split('\n\n').map((b) => ({ event: /^event: (.*)$/m.exec(b)![1], data: JSON.parse(/^data: (.*)$/m.exec(b)![1]!) }));

  it('cria uma fonte, recebe um arquivo e responde citando o trecho, em streaming', async () => {
    const { call } = await start();
    const { body: { source } } = await call('/api/fontes', { method: 'POST', body: JSON.stringify({ kind: 'upload', name: 'RH' }) });
    const up = await call(`/api/fontes/${source.id}/arquivos?nome=ferias.md`, { method: 'POST', body: '# Férias\n## Prazo\nPedido com 30 dias de antecedência.', headers: { 'content-type': 'application/octet-stream' } });
    expect(up.status).toBe(201);
    expect(up.body.source).toMatchObject({ chunks: 1, connected: true });
    expect((await call(`/api/fontes/${source.id}/arquivos?nome=a.xlsx`, { method: 'POST', body: 'x' })).status).toBe(400);
    const { body: { conversation } } = await call('/api/conversas', { method: 'POST', body: '{}' });
    const sse = await call(`/api/conversas/${conversation.id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto: 'Qual o prazo do pedido de férias?' }) });
    const evs = events(sse.body);
    expect(evs.map((e) => e.event)).toEqual(['fontes', ...evs.slice(1, -1).map(() => 'token'), 'fim']);
    const end = evs.at(-1)!.data;
    expect(end.turn.content).toContain('[1]');
    expect(end.turn.citations[0]).toMatchObject({ n: 1, docTitle: 'Férias', heading: 'Prazo', cited: true });
    expect(end.conversation.title).toBe('Qual o prazo do pedido de férias?');
    expect((await call(`/api/conversas/${conversation.id}`)).body.conversation.messages).toHaveLength(2);
  });

  it('sem nenhuma fonte, orienta a conectar uma em vez de chamar o modelo', async () => {
    const { call } = await start();
    const { body: { conversation } } = await call('/api/conversas', { method: 'POST', body: '{}' });
    const evs = events((await call(`/api/conversas/${conversation.id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto: 'oi' }) })).body);
    expect(evs.at(-1)!.data.turn.content).toMatch(/Ainda não há nenhuma fonte conectada/);
  });

  it('Confluence: guarda o token cifrado, sincroniza em segundo plano e nunca devolve o segredo', async () => {
    const connector: Connector = { async *fetchDocuments(_s, secret) { expect(secret).toEqual({ email: 'a@b.com', token: 'tok' }); yield doc('p1', '# Plantão\nCanal #oncall'); } };
    const { call, handler } = await start(connector);
    const res = await call('/api/fontes', { method: 'POST', body: JSON.stringify({ kind: 'confluence', name: 'Wiki', config: { site: 'https://a.atlassian.net', spaceKey: 'ENG' }, secret: { email: 'a@b.com', token: 'tok' } }) });
    expect(res.status).toBe(201);
    await handler.idle();
    const { body } = await call('/api/fontes');
    expect(body.sources[0]).toMatchObject({ status: 'pronta', connected: true, chunks: 1 });
    expect(JSON.stringify(body)).not.toContain('tok');
    expect((await call('/api/fontes', { method: 'POST', body: JSON.stringify({ kind: 'google-drive', name: 'Drive' }) })).body.error).toMatch(/GOOGLE_CLIENT_ID/);
  });

  it('expõe as fontes num servidor MCP por HTTP para outros clientes', async () => {
    const { base, call } = await start();
    await call('/api/fontes', { method: 'POST', body: JSON.stringify({ kind: 'upload', name: 'RH' }) });
    const client = new Client({ name: 'outro-cliente', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.title)).toEqual(['Buscar em: RH']);
    await client.close();
  });

  it('serve a UI e recusa caminhos fora da pasta', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/`)).headers.get('content-type')).toContain('text/html');
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/api/fontes/nao-existe/arquivos?nome=a.md`, { method: 'POST', body: 'x' })).status).toBe(404);
  });
});
