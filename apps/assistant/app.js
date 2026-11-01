'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_LABEL = { upload: 'Arquivos', 'google-drive': 'Google Drive', confluence: 'Confluence' };
const STATUS_LABEL = { pronta: 'pronta', sincronizando: 'sincronizando', erro: 'erro', 'aguardando-conexao': 'falta conectar' };
const icon = (name) => `<svg class="icon" data-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/icons.svg#${name}"/></svg>`;
const LOGO = '<svg class="nexo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="/nexo.svg#mark"/></svg>';
const SOURCE_ICON = {
  upload: icon('file-text'),
  'google-drive': '<img class="brand-icon" src="google-drive.png" width="28" height="28" alt="" aria-hidden="true">',
  confluence: '<img class="brand-icon" src="confluence.svg" width="28" height="28" alt="" aria-hidden="true">',
};
const UPLOADS_NAME = 'Arquivos enviados';

const state = {
  config: null,
  sources: [],
  conversations: [],
  current: null,
  /** Fontes escolhidas antes de a conversa existir (null = todas). */
  pendingScope: null,
  streaming: null,
  adding: null,
  openDocs: new Set(),
  uploadTarget: null,
};

// ------------------------------------------------------------------------------ API

async function api(path, opts = {}) {
  const json = typeof opts.body === 'string';
  const res = await fetch(path, { ...opts, headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...opts.headers } });
  const body = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error ?? `erro ${res.status}`);
  return body;
}

async function* readEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (event) yield { event, data: data ? JSON.parse(data) : null };
    }
  }
}

let toastTimer;
function toast(message, ms = 3200) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
  el.setAttribute('role', 'status');
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// ------------------------------------------------------------------------- Markdown

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (_, nums) => nums.split(/[,;]/)
      .map((n) => `<button type="button" class="cite" data-n="${n.trim()}" aria-label="Ver trecho ${n.trim()}">${n.trim()}</button>`).join(''));
}

/** Markdown pequeno e seguro: escapa tudo antes e só então reconhece listas, código e ênfase. */
function markdown(text) {
  const blocks = [];
  const src = esc(text).replace(/```\w*\n?([\s\S]*?)(```|$)/g, (_, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\n\u0000${blocks.length - 1}\u0000\n`;
  });
  let html = '';
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) html += `<p>${inline(para.join('<br>'))}</p>`; para = []; };
  const flushList = () => { if (list) html += `<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`; list = null; };
  for (const line of src.split('\n')) {
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((ul ?? ol)[1]);
    } else if (h) {
      flushPara(); flushList();
      html += `<p><strong>${inline(h[1])}</strong></p>`;
    } else if (/^\u0000\d+\u0000$/.test(line.trim())) {
      flushPara(); flushList();
      html += line.trim();
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

// --------------------------------------------------------------------------- Barra lateral

const ago = (iso) => {
  if (!iso) return 'nunca';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
};

function renderSidebar() {
  const today = new Date().toDateString();
  const week = Date.now() - 7 * 86400e3;
  const groups = [['Hoje', []], ['Últimos 7 dias', []], ['Mais antigas', []]];
  for (const c of state.conversations) {
    const t = new Date(c.updatedAt);
    groups[t.toDateString() === today ? 0 : t.getTime() > week ? 1 : 2][1].push(c);
  }
  $('#conversations').innerHTML = groups.filter(([, cs]) => cs.length).map(([label, cs]) => `
    <div class="conv-group">${label}</div>
    ${cs.map((c) => `
      <div class="conv ${state.current?.id === c.id ? 'active' : ''}">
        <a href="#c/${c.id}" title="${esc(c.title)}">${esc(c.title)}</a>
        <button type="button" data-delete-conv="${c.id}" aria-label="Apagar conversa ${esc(c.title)}">
          ${icon('trash-2')}
        </button>
    </div>`).join('')}`).join('') || '<p class="history-empty">Nenhuma conversa ainda.</p>';
  const docs = state.sources.reduce((n, s) => n + s.documents.length, 0);
  $('#sources-summary').textContent = state.sources.length
    ? `${state.sources.length} ${state.sources.length === 1 ? 'fonte' : 'fontes'} · ${docs} ${docs === 1 ? 'documento' : 'documentos'}`
    : 'Seu conhecimento começa aqui';
  $('#source-count').textContent = state.sources.length;
  $('#home-link').classList.toggle('active', !state.current);
  if (state.current) $('#home-link').removeAttribute('aria-current');
  else $('#home-link').setAttribute('aria-current', 'page');
  if (state.config) {
    const simulated = /simula/i.test(state.config.mode.llm);
    $('#mode').textContent = simulated ? 'Modo de demonstração' : 'Processamento local';
    $('#mode').title = `${state.config.mode.llm} · ${state.config.mode.embedder}`;
  }
}

// ------------------------------------------------------------------------------ Conversa

function scopeIds() {
  return state.current ? state.current.sourceIds : state.pendingScope;
}

function renderScope() {
  const ids = scopeIds();
  const chosen = ids ? state.sources.filter((s) => ids.includes(s.id)) : state.sources;
  $('#scope-label').textContent = !ids ? 'Todas as fontes' : chosen.length === 1 ? chosen[0].name : `${chosen.length} fontes`;
  $('#scope-menu').innerHTML = state.sources.length ? `
    <label><input type="checkbox" data-scope-all ${!ids ? 'checked' : ''}> Todas as fontes</label>
    <hr>
    ${state.sources.map((s) => `
      <label><input type="checkbox" data-scope="${s.id}" ${!ids || ids.includes(s.id) ? 'checked' : ''}>
        <span class="source-icon">${SOURCE_ICON[s.kind]}</span>${esc(s.name)}<small>${s.documents.length} doc.</small></label>`).join('')}`
    : '<p>Nenhuma fonte conectada ainda.</p>';
}

async function setScope(ids) {
  const all = !ids || ids.length === state.sources.length;
  const value = all ? null : ids;
  if (state.current) {
    const conv = state.current;
    const { conversation } = await api(`/api/conversas/${conv.id}`, { method: 'PATCH', body: JSON.stringify({ sourceIds: value }) });
    conv.sourceIds = conversation.sourceIds;
  }
  else state.pendingScope = value;
  renderScope();
  if (!state.current?.messages.length) renderThread();
}

function renderEmpty() {
  const hasDocuments = state.sources.some((source) => source.documents.length);
  return `
    <div class="empty">
      <div class="hero">
        <span class="home-mark" aria-hidden="true">${LOGO}</span>
        <h2>O que você quer saber?</h2>
      </div>
      <div class="home-composer"></div>
      ${hasDocuments ? '' : `<button class="home-setup" type="button" data-manage-sources>${icon('plus')} Adicionar documentos para começar</button>`}
    </div>`;
}

/**
 * Rastro da resposta. O modelo decide se busca: enquanto decide, "Pensando…"; ao buscar, a
 * consulta que ele escreveu e as fontes consultadas; em conversa sem busca, nada.
 */
function trailHtml(turn) {
  const query = turn.searchQuery ? `<span class="trail-step">Buscou “${esc(turn.searchQuery)}”</span>` : '';
  if (!turn.citations) {
    if (!turn.pending) return '';
    if (!turn.searchQuery) return turn.content ? '' : '<div class="trail"><span class="trail-step searching">Pensando…</span></div>';
    const ids = scopeIds();
    const sources = ids ? state.sources.filter((s) => ids.includes(s.id)) : state.sources;
    return `<div class="trail"><span class="trail-step searching">Buscando “${esc(turn.searchQuery)}”</span>${sources.map((s) => `<span class="trail-step searching"><span class="source-icon">${SOURCE_ICON[s.kind]}</span>${esc(s.name)}</span>`).join('')}</div>`;
  }
  if (!turn.citations.length) return turn.searchQuery ? `<div class="trail">${query}<span class="trail-step">nenhum trecho encontrado</span></div>` : '';
  const bySource = new Map();
  for (const c of turn.citations) {
    const cur = bySource.get(c.sourceId) ?? { name: c.sourceName, kind: c.sourceKind, n: 0, cited: false };
    cur.n += 1;
    cur.cited ||= c.cited;
    bySource.set(c.sourceId, cur);
  }
  const done = !turn.pending;
  return `<div class="trail">${query}${[...bySource.values()].map((s) => `
    <span class="trail-step" title="${s.n} trecho(s) desta fonte entre os ${turn.citations.length} entregues ao modelo">
      <span class="source-icon ${done && !s.cited ? 'hollow' : ''}">${SOURCE_ICON[s.kind]}</span>${esc(s.name)} · ${s.n} ${s.n === 1 ? 'trecho' : 'trechos'}</span>`).join('')}</div>`;
}

function refsHtml(turn) {
  if (!turn.citations?.length) return '';
  const done = !turn.pending;
  return `<div class="refs">${turn.citations.map((c) => `
    <button type="button" class="ref ${done ? (c.cited ? 'cited' : 'uncited') : ''}" data-n="${c.n}" title="${esc(c.docTitle)} · ${esc(c.heading)}">
      <span class="ref-n">${c.n}</span>
      <span class="ref-title">${esc(c.docTitle)}</span>
      <span class="ref-meta"><span class="source-icon">${SOURCE_ICON[c.sourceKind]}</span>${esc(c.sourceName)} · ${esc(c.heading)}</span>
    </button>`).join('')}</div>`;
}

function assistantHtml(turn, index) {
  return `
    <div class="msg msg-assistant" data-index="${index}">
      <div class="avatar">${LOGO}</div>
      <div>
        ${trailHtml(turn)}
        ${turn.content || !turn.pending ? `<div class="answer ${turn.pending ? 'streaming' : ''}">${markdown(turn.content)}</div>` : ''}
        ${turn.error ? `<p class="error-note">${esc(turn.error)}</p>` : ''}
        ${refsHtml(turn)}
        ${turn.pending ? '' : `<div class="msg-foot"><button type="button" data-copy="${index}">${icon('copy')} Copiar</button></div>`}
      </div>
    </div>`;
}

function renderThread() {
  const thread = $('#thread');
  const conv = state.current;
  // Keep the same form and its listeners when moving between overview and conversation.
  $('.main').insertBefore($('#composer'), $('#drop-hint'));
  $('#title').textContent = conv?.title ?? 'Nexo';
  if (!conv || conv.messages.length === 0) {
    thread.innerHTML = renderEmpty();
    $('.home-composer', thread).append($('#composer'));
    thread.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }
  thread.innerHTML = conv.messages.map((m, i) => (m.role === 'user'
    ? `<div class="msg msg-user"><div class="bubble">${esc(m.content)}</div></div>`
    : assistantHtml(m, i))).join('');
  thread.scrollTop = thread.scrollHeight;
}

let frame = 0;
function updateLive(conv) {
  if (frame || state.current !== conv) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (state.current !== conv) return;
    const index = conv.messages.length - 1;
    const el = $(`.msg-assistant[data-index="${index}"]`);
    const thread = $('#thread');
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    if (el) el.outerHTML = assistantHtml(conv.messages[index], index);
    if (nearBottom) thread.scrollTop = thread.scrollHeight;
  });
}

function updateComposer() {
  const send = $('#send');
  const busy = !!state.streaming;
  send.classList.toggle('stop', busy);
  send.setAttribute('aria-label', busy ? 'Parar resposta' : 'Enviar');
  send.innerHTML = icon(busy ? 'square' : 'arrow-up');
  send.disabled = !busy && !$('#input').value.trim();
}

async function send(text) {
  if (state.streaming || !text.trim()) return;
  const operation = { abort: new AbortController(), conversation: null };
  state.streaming = operation;
  updateComposer();
  let conv;
  let live;
  try {
    if (!state.current) {
      state.current = (await api('/api/conversas', { method: 'POST', body: JSON.stringify({ sourceIds: state.pendingScope }), signal: operation.abort.signal })).conversation;
      state.pendingScope = null;
      history.replaceState(null, '', `#c/${state.current.id}`);
    }
    conv = state.current;
    operation.conversation = conv;
    conv.messages.push({ role: 'user', content: text.trim() });
    live = { role: 'assistant', content: '', citations: null, pending: true };
    conv.messages.push(live);
    $('#input').value = '';
    autosize();
    renderThread();
    renderSidebar();
    $('#response-status').textContent = 'Gerando a resposta.';
    const res = await fetch(`/api/conversas/${conv.id}/mensagens`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: text.trim() }), signal: operation.abort.signal,
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `erro ${res.status}`);
    for await (const { event, data } of readEvents(res)) {
      if (event === 'busca') {
        // O que o modelo escreveu antes de pedir a busca é substituído pela resposta citada.
        live.searchQuery = data.query;
        live.content = '';
        $('#response-status').textContent = `Buscando nas fontes: ${data.query}`;
      } else if (event === 'fontes') live.citations = data.citations;
      else if (event === 'token') live.content += data.t;
      else if (event === 'fim') {
        Object.assign(live, data.turn, { timing: data.timing });
        conv.title = data.conversation.title;
        if (state.current === conv) $('#title').textContent = conv.title;
      } else if (event === 'erro') live.error = data.message;
      updateLive(conv);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (live) live.content += live.content ? ' …(interrompida)' : 'Consulta interrompida.';
    } else if (live) live.error = `Não foi possível responder: ${err.message}`;
    else toast(`Não foi possível iniciar a consulta: ${err.message}`, 6000);
  } finally {
    if (live) {
      live.pending = false;
      live.citations ??= [];
      if (state.current === conv) renderThread();
    }
    state.streaming = null;
    updateComposer();
    $('#response-status').textContent = live?.error ? 'Não foi possível concluir a consulta.' : 'Consulta finalizada.';
    loadConversations().catch((err) => toast(`Não foi possível atualizar o histórico: ${err.message}`));
  }
}

let citationOpener;
function openCitation(turnIndex, n) {
  citationOpener = document.activeElement;
  const turn = state.current?.messages[turnIndex];
  const c = turn?.citations?.find((x) => x.n === n);
  if (!c) return;
  $('#drawer-eyebrow').innerHTML = `<span class="source-icon">${SOURCE_ICON[c.sourceKind]}</span>[${c.n}] ${esc(c.sourceName)} · ${KIND_LABEL[c.sourceKind]}`;
  $('#drawer-body').innerHTML = `
    <h3>${esc(c.docTitle)}</h3>
    <p class="heading">${esc(c.heading)}</p>
    <blockquote>${esc(c.excerpt)}</blockquote>
    ${c.url ? `<a class="open-original" href="${esc(c.url)}" target="_blank" rel="noopener">Abrir o original
      ${icon('external-link')}</a>` : ''}`;
  $('#drawer').hidden = false;
  $('#close-drawer').focus();
}

// --------------------------------------------------------------------------- Fontes

function sourceStats(s) {
  const docs = `${s.documents.length} ${s.documents.length === 1 ? 'documento' : 'documentos'} · ${s.chunks} trechos`;
  if (s.kind === 'upload') return `${docs} · atualizada ${ago(s.documents.at(-1)?.updatedAt ?? s.createdAt)}`;
  if (s.kind === 'confluence') return `${docs} · ${esc(s.config.site)} · espaço ${esc(s.config.spaceKey)} · sincronizada ${ago(s.syncedAt)}`;
  return `${docs} · ${s.config.folderId ? 'uma pasta' : 'todo o Drive da conta'} · sincronizada ${ago(s.syncedAt)}`;
}

function renderSources() {
  const list = $('#source-list');
  list.innerHTML = state.sources.length ? state.sources.map((s) => `
    <article class="source" data-source="${s.id}">
      <div class="source-head">
        <span class="source-icon">${SOURCE_ICON[s.kind]}</span>
        <span class="source-name">${esc(s.name)}</span>
        <span class="source-kind">${KIND_LABEL[s.kind]}</span>
        <span class="status status-${s.status}">${STATUS_LABEL[s.status]}</span>
        <div class="source-actions">
          ${s.kind === 'upload' ? `<button class="btn" type="button" data-upload-to="${s.id}">${icon('upload')} Enviar arquivos</button>` : ''}
          ${s.kind === 'google-drive' && !s.connected ? `<a class="btn primary" href="/api/conectores/google/iniciar?fonte=${s.id}">Conectar conta Google</a>` : ''}
          ${s.kind !== 'upload' && s.connected ? `<button class="btn" type="button" data-sync="${s.id}" ${s.status === 'sincronizando' ? 'disabled' : ''}>${icon('refresh-cw')} Sincronizar agora</button>` : ''}
          ${s.documents.length ? `<button class="btn" type="button" data-docs="${s.id}" aria-expanded="${state.openDocs.has(s.id)}">${icon('files')} Documentos</button>` : ''}
          <button class="btn danger" type="button" data-remove="${s.id}">${icon('trash-2')} Remover</button>
        </div>
      </div>
      <p class="source-stats">${sourceStats(s)}</p>
      ${s.error ? `<p class="source-error">${esc(s.error)}</p>` : ''}
      ${s.kind === 'upload' ? `<div class="drop-zone" data-drop="${s.id}">Arraste arquivos para cá ou use "Enviar arquivos"</div>` : ''}
      ${state.openDocs.has(s.id) ? `<ul class="docs">${s.documents.map((d) => `
        <li><span title="${esc(d.title)}">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : esc(d.title)}</span>
          <small>${d.chunks} trechos</small>
          ${s.kind === 'upload' ? `<button type="button" data-remove-doc="${s.id}" data-doc="${esc(d.id)}" aria-label="Retirar ${esc(d.title)}">retirar</button>` : ''}</li>`).join('')}</ul>` : ''}
    </article>`).join('')
    : '<p class="empty-sources">Nenhuma fonte ainda. Escolha acima como trazer os documentos da empresa.</p>';
  for (const btn of document.querySelectorAll('[data-add]')) btn.setAttribute('aria-pressed', String(btn.dataset.add === state.adding));
  renderAddForm();
  if (state.config) {
    $('#mcp-note').innerHTML = `Use estas mesmas fontes no Claude Desktop, no Claude Code ou em outro cliente MCP: o servidor fica em
      <code>${esc(state.config.mcpUrl)}</code> <button class="btn" type="button" data-copy-mcp>${icon('copy')} Copiar</button>`;
  }
}

function renderAddForm() {
  const form = $('#add-form');
  form.hidden = !state.adding;
  const kind = state.adding ?? '';
  if (form.dataset.kind === kind) return;
  form.dataset.kind = kind;
  if (state.adding === 'upload') {
    form.innerHTML = `
      <label class="full">Nome da fonte<input name="name" required maxlength="80" value="Documentos da equipe"></label>
      <p class="hint full">Depois de criar, arraste os arquivos para a fonte. PDF, Word (.docx), Markdown, HTML, texto e CSV, até 25 MB cada. PDF escaneado precisa de OCR antes.</p>
      <div class="actions full"><button class="btn" type="button" data-cancel-add>Cancelar</button><button class="btn primary">Criar fonte</button></div>`;
  } else if (state.adding === 'google-drive') {
    form.innerHTML = state.config?.google ? `
      <label>Nome da fonte<input name="name" required maxlength="80" value="Google Drive"></label>
      <label>ID da pasta (opcional)<input name="folderId" placeholder="todo o Drive da conta"></label>
      <p class="hint full">Você vai autorizar o acesso de leitura na sua conta Google. O assistente vê só o que essa conta pode ver. O ID da pasta é o final do endereço dela no Drive.</p>
      <div class="actions full"><button class="btn" type="button" data-cancel-add>Cancelar</button><button class="btn primary">Conectar conta Google</button></div>`
      : `
      <p class="hint full">O conector do Google ainda não foi configurado neste servidor. Crie um cliente OAuth no Google Cloud (tipo "Aplicativo da Web") com o endereço de retorno
        <code>${esc(location.origin)}/api/conectores/google/retorno</code>, coloque GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no arquivo .env e reinicie o assistente. O passo a passo está em docs/assistente.md.</p>
      <div class="actions full"><button class="btn" type="button" data-cancel-add>Fechar</button></div>`;
  } else if (state.adding === 'confluence') {
    form.innerHTML = `
      <label>Nome da fonte<input name="name" required maxlength="80" value="Confluence"></label>
      <label>Site<input name="site" required placeholder="https://empresa.atlassian.net"></label>
      <label>Chave do espaço<input name="spaceKey" required placeholder="ENG"></label>
      <label>E-mail da conta Atlassian<input name="email" type="email" required autocomplete="off"></label>
      <label class="full">Token de API<input name="token" type="password" required autocomplete="off"></label>
      <p class="hint full">Crie o token em id.atlassian.com → Segurança → Tokens de API. Ele fica cifrado neste servidor e não aparece de novo. O assistente lê as páginas do espaço que essa conta pode ver.</p>
      <div class="actions full"><button class="btn" type="button" data-cancel-add>Cancelar</button><button class="btn primary">Conectar e sincronizar</button></div>`;
  } else form.innerHTML = '';
  form.querySelector('input')?.focus();
}

async function submitAddForm(form) {
  const f = Object.fromEntries(new FormData(form));
  const kind = state.adding;
  const body = kind === 'confluence'
    ? { kind, name: f.name, config: { site: f.site, spaceKey: f.spaceKey }, secret: { email: f.email, token: f.token } }
    : kind === 'google-drive' ? { kind, name: f.name, config: { folderId: f.folderId } } : { kind, name: f.name };
  const button = form.querySelector('.btn.primary');
  button.disabled = true;
  try {
    const res = await api('/api/fontes', { method: 'POST', body: JSON.stringify(body) });
    if (res.connectUrl) { location.href = res.connectUrl; return; }
    state.adding = null;
    toast(kind === 'confluence' ? 'Fonte criada. Sincronizando as páginas do espaço…' : 'Fonte criada. Agora envie os arquivos.');
    await loadSources();
  } catch (err) {
    toast(err.message, 6000);
    button.disabled = false;
  }
}

async function ensureUploadSource() {
  const existing = state.sources.find((s) => s.kind === 'upload' && s.name === UPLOADS_NAME);
  if (existing) return existing.id;
  return (await api('/api/fontes', { method: 'POST', body: JSON.stringify({ kind: 'upload', name: UPLOADS_NAME }) })).source.id;
}

async function uploadFiles(files, sourceId) {
  if (!files.length) return;
  const target = sourceId ?? await ensureUploadSource();
  let ok = 0;
  for (const file of files) {
    toast(`Lendo ${file.name}…`, 60000);
    try {
      await api(`/api/fontes/${target}/arquivos?nome=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } });
      ok += 1;
    } catch (err) {
      toast(err.message, 7000);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (ok) toast(ok === 1 ? `${files[ok - 1]?.name ?? 'Arquivo'} adicionado às fontes` : `${ok} arquivos adicionados às fontes`);
  await loadSources();
}

// ---------------------------------------------------------------------- Carregamento

let pollTimer;
async function loadSources() {
  state.sources = (await api('/api/fontes')).sources;
  renderSidebar();
  renderScope();
  if (!$('#sources-overlay').hidden) renderSources();
  if (!state.current?.messages.length) renderThread();
  clearTimeout(pollTimer);
  if (state.sources.some((s) => s.status === 'sincronizando')) pollTimer = setTimeout(loadSources, 2000);
}

async function loadConversations() {
  state.conversations = (await api('/api/conversas')).conversations;
  renderSidebar();
}

async function route() {
  const hash = location.hash;
  setSidebar(false);
  if (hash === '#fontes') {
    if (!$('#thread').children.length) renderThread();
    return openSources();
  }
  if (!$('#sources-overlay').hidden) closeSources();
  const id = hash.match(/^#c\/([\w-]+)$/)?.[1];
  if (id && state.current?.id !== id) {
    try {
      state.current = state.streaming?.conversation?.id === id ? state.streaming.conversation : (await api(`/api/conversas/${id}`)).conversation;
    } catch {
      state.current = null;
      history.replaceState(null, '', '#');
    }
  } else if (!id) state.current = null;
  $('#drawer').hidden = true;
  renderSidebar();
  renderScope();
  renderThread();
}

let sourcesOpener;
function openSources(kind) {
  if ($('#sources-overlay').hidden) sourcesOpener = document.activeElement;
  setSidebar(false);
  state.adding = kind ?? null;
  $('#sources-overlay').hidden = false;
  $('.app').inert = true;
  renderSources();
  if (!kind) $('#close-sources').focus();
}

function closeSources() {
  $('#sources-overlay').hidden = true;
  $('.app').inert = false;
  state.adding = null;
  const focusTarget = sourcesOpener?.isConnected && !sourcesOpener.closest('[inert]') ? sourcesOpener
    : window.matchMedia('(max-width: 760px)').matches ? $('#toggle-sidebar') : $('#open-sources');
  focusTarget.focus();
  if (location.hash === '#fontes') history.replaceState(null, '', state.current ? `#c/${state.current.id}` : '#');
}

let sidebarCollapsed = false;
function setSidebar(open) {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  $('.app').classList.toggle('sidebar-collapsed', !mobile && sidebarCollapsed);
  $('#sidebar').classList.toggle('open', mobile && open);
  $('#sidebar').inert = mobile ? !open : sidebarCollapsed;
  $('.main').inert = mobile && open;
  $('#sidebar-backdrop').hidden = !(mobile && open);
  $('#toggle-sidebar').setAttribute('aria-expanded', String(mobile ? open : !sidebarCollapsed));
  if (mobile && open) $('#home-link').focus();
}

function closeCitation() {
  $('#drawer').hidden = true;
  if (citationOpener?.isConnected) citationOpener.focus();
  else $('#input').focus();
}

function run(action) {
  Promise.resolve().then(action).catch((err) => toast(err.message, 6000));
}

// -------------------------------------------------------------------------- Eventos

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  updateComposer();
}

$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send($('#input').value);
  }
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.streaming) state.streaming.abort.abort();
  else send($('#input').value);
});
$('#new-chat').addEventListener('click', () => {
  state.current = null;
  state.pendingScope = null;
  history.pushState(null, '', '#');
  run(async () => { await route(); $('#input').focus(); });
});
$('#open-sources').addEventListener('click', () => { history.pushState(null, '', '#fontes'); openSources(); });
$('#close-sources').addEventListener('click', closeSources);
$('#sources-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSources(); });
$('#close-drawer').addEventListener('click', closeCitation);
$('#toggle-sidebar').addEventListener('click', () => {
  if (window.matchMedia('(max-width: 760px)').matches) setSidebar(!$('#sidebar').classList.contains('open'));
  else { sidebarCollapsed = false; setSidebar(false); $('#collapse-sidebar').focus(); }
});
$('#collapse-sidebar').addEventListener('click', () => {
  if (!window.matchMedia('(max-width: 760px)').matches) sidebarCollapsed = true;
  setSidebar(false);
  $('#toggle-sidebar').focus();
});
$('#sidebar-backdrop').addEventListener('click', () => { setSidebar(false); $('#toggle-sidebar').focus(); });
$('#attach').addEventListener('click', () => { state.uploadTarget = null; $('#file-input').click(); });
$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  run(() => uploadFiles(files, state.uploadTarget));
});

$('#scope-button').addEventListener('click', () => {
  const menu = $('#scope-menu');
  menu.hidden = !menu.hidden;
  $('#scope-button').setAttribute('aria-expanded', String(!menu.hidden));
});
$('#scope-menu').addEventListener('change', (e) => {
  if (e.target.matches('[data-scope-all]')) return run(() => setScope(e.target.checked ? null : []));
  const ids = [...document.querySelectorAll('[data-scope]:checked')].map((i) => i.dataset.scope);
  run(() => setScope(ids));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.scope')) { $('#scope-menu').hidden = true; $('#scope-button').setAttribute('aria-expanded', 'false'); }
});

$('#thread').addEventListener('click', (e) => run(async () => {
  const t = e.target.closest('button');
  if (!t) return;
  const msg = t.closest('.msg-assistant');
  if (t.matches('.cite, .ref') && msg) return openCitation(Number(msg.dataset.index), Number(t.dataset.n));
  if (t.hasAttribute('data-manage-sources')) { history.pushState(null, '', '#fontes'); return openSources(); }
  if (t.dataset.copy) {
    await navigator.clipboard.writeText(state.current.messages[Number(t.dataset.copy)].content);
    toast('Resposta copiada');
  }
}));

$('#conversations').addEventListener('click', (e) => run(async () => {
  const id = e.target.closest('[data-delete-conv]')?.dataset.deleteConv;
  if (!id || !confirm('Apagar esta conversa?')) return;
  await api(`/api/conversas/${id}`, { method: 'DELETE' });
  if (state.current?.id === id) { state.current = null; history.replaceState(null, '', '#'); renderThread(); renderScope(); }
  await loadConversations();
}));

document.querySelector('.add-row').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-add]')?.dataset.add;
  if (kind) { state.adding = state.adding === kind ? null : kind; renderSources(); }
});
$('#add-form').addEventListener('submit', (e) => { e.preventDefault(); submitAddForm(e.target); });
$('#sources-overlay').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  try {
    if (t.matches('[data-cancel-add]')) { state.adding = null; renderSources(); }
    else if (t.dataset.uploadTo) { state.uploadTarget = t.dataset.uploadTo; $('#file-input').click(); }
    else if (t.dataset.sync) { await api(`/api/fontes/${t.dataset.sync}/sincronizar`, { method: 'POST' }); toast('Sincronizando…'); await loadSources(); }
    else if (t.dataset.docs) { state.openDocs.has(t.dataset.docs) ? state.openDocs.delete(t.dataset.docs) : state.openDocs.add(t.dataset.docs); renderSources(); }
    else if (t.dataset.remove) {
      const s = state.sources.find((x) => x.id === t.dataset.remove);
      if (!confirm(`Remover a fonte "${s.name}"? Os documentos saem do índice; o original não é apagado.`)) return;
      await api(`/api/fontes/${s.id}`, { method: 'DELETE' });
      toast('Fonte removida');
      await loadSources();
    } else if (t.dataset.removeDoc) {
      await api(`/api/fontes/${t.dataset.removeDoc}/documentos/${encodeURIComponent(t.dataset.doc)}`, { method: 'DELETE' });
      await loadSources();
    } else if (t.matches('[data-copy-mcp]')) {
      await navigator.clipboard.writeText(state.config.mcpUrl);
      toast('Endereço do servidor MCP copiado');
    }
  } catch (err) {
    toast(err.message, 6000);
  }
});

// Arrastar e soltar: na fonte de upload do painel ou em qualquer lugar da conversa.
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth += 1;
  if ($('#sources-overlay').hidden) $('#drop-hint').hidden = false;
});
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-hint').hidden = true; });
document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  document.querySelectorAll('.drop-zone').forEach((z) => z.classList.toggle('over', z.contains(e.target)));
});
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-hint').hidden = true;
  const zone = e.target.closest?.('[data-drop]');
  document.querySelectorAll('.drop-zone').forEach((z) => z.classList.remove('over'));
  run(() => uploadFiles([...e.dataTransfer.files], zone?.dataset.drop ?? null));
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-guide]')) { setSidebar(false); $('#guide').showModal(); }
});
$('#close-guide').addEventListener('click', () => $('#guide').close());
$('#guide-done').addEventListener('click', () => { $('#guide').close(); $('#input').focus(); });
$('#guide').addEventListener('click', (e) => {
  if (e.target !== e.currentTarget) return;
  const rect = e.currentTarget.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) e.currentTarget.close();
});

document.addEventListener('keydown', (e) => {
  if (!$('#sources-overlay').hidden && e.key === 'Tab') {
    const controls = [...$('#sources-overlay').querySelectorAll('button, input, a[href], summary, [tabindex="0"]')].filter((el) =>
      !el.disabled && el.getClientRects().length && (!el.closest('details:not([open])') || el.matches('summary')));
    const first = controls[0];
    const last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  if (e.key !== 'Escape' || $('#guide').open) return;
  if (!$('#sources-overlay').hidden) closeSources();
  else if (!$('#scope-menu').hidden) { $('#scope-menu').hidden = true; $('#scope-button').setAttribute('aria-expanded', 'false'); $('#scope-button').focus(); }
  else if (!$('#drawer').hidden) closeCitation();
  else if ($('#sidebar').classList.contains('open')) { setSidebar(false); $('#toggle-sidebar').focus(); }
});
window.addEventListener('hashchange', () => run(route));
window.matchMedia('(max-width: 760px)').addEventListener('change', () => setSidebar(false));

(async function init() {
  try {
    state.config = await api('/api/config');
    $('#file-input').accept = state.config.formats.join(',');
    await Promise.all([loadSources(), loadConversations()]);
    await route();
  } catch (err) {
    $('#connection-dot').classList.add('offline');
    $('#mode').textContent = 'Servidor indisponível';
    $('#thread').innerHTML = `<p class="error-note">Não foi possível falar com o servidor do assistente: ${esc(err.message)}</p>`;
  }
  $('#thread').setAttribute('aria-busy', 'false');
  updateComposer();
})();
