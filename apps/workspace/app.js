// Front do app corporativo (src/workspace). Sem dependências e sem build.
// Todo texto vindo da API entra por textContent, nunca como HTML.

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

async function api(path, { method, body } = {}) {
  const res = await fetch(path, { method: method ?? (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `erro ${res.status}`);
  return data;
}

function toast(text, kind = '') {
  const t = el('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

const KIND = {
  upload: { label: 'Arquivos', letter: '⇪' },
  gdrive: { label: 'Google Drive', letter: 'G' },
  confluence: { label: 'Confluence', letter: 'C' },
};
const kindIco = (kind) => el('span', { class: `kind-ico ${kind}`, 'aria-hidden': 'true' }, KIND[kind]?.letter ?? '?');

const state = { config: null, sources: [], conversations: [], current: null, busy: false, poll: null };

// ---------- Fontes ----------

async function loadSources() {
  const { sources } = await api('/api/sources');
  state.sources = sources;
  const docs = sources.reduce((n, s) => n + s.documents, 0);
  $('#sources-count').textContent = String(docs);
  $('#sources-strip').replaceChildren(...sources.filter((s) => s.documents || s.kind !== 'upload').map((s) =>
    el('span', { class: `chip ${s.syncing || s.status === 'syncing' ? 'syncing' : s.status === 'error' ? 'error' : ''}`, title: s.lastError ?? s.description },
      kindIco(s.kind), s.name, ' · ', s.syncing || s.status === 'syncing' ? 'sincronizando…' : `${s.documents} doc.`)));
  const syncing = sources.some((s) => s.syncing || s.status === 'syncing');
  clearTimeout(state.poll);
  if (syncing) state.poll = setTimeout(() => loadSources().catch(() => {}), 1200);
  if ($('#sources-modal').open) renderSourcesModal();
  if (!state.current) renderThread();
}

function fmtBytes(n) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function statusOf(s) {
  if (s.syncing || s.status === 'syncing') return el('span', { class: 'status syncing' }, s.progress?.total ? `sincronizando ${s.progress.done}/${s.progress.total}` : 'sincronizando…');
  if (s.status === 'error') return el('span', { class: 'status error' }, 'erro');
  return el('span', { class: 'status ok' }, s.lastSyncAt ? `atualizado ${fmtDate(s.lastSyncAt)}` : s.kind === 'upload' ? '' : 'conectado');
}

function editableDescription(s) {
  const p = el('p', { class: 'desc', title: 'Clique para editar. O assistente usa esta descrição para entender a fonte (descrição da tool MCP).', contenteditable: 'true', spellcheck: 'false' }, s.description);
  p.addEventListener('blur', async () => {
    const description = p.textContent.trim();
    if (!description || description === s.description) return;
    try {
      await api(`/api/sources/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: { description } });
      toast('Descrição atualizada');
      loadSources();
    } catch (e) { toast(e.message, 'error'); }
  });
  return p;
}

function docList(s, deletable) {
  if (!s.docs.length) return null;
  return el('ul', { class: 'doclist' }, ...s.docs.map((d) => el('li', {},
    kindIco(s.kind),
    el('span', { class: 't', title: d.title }, d.url ? el('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.title) : d.title),
    el('span', { class: 'm' }, `${d.chunkCount} trecho${d.chunkCount === 1 ? '' : 's'} · ${fmtBytes(d.bytes)}`),
    deletable && el('button', { type: 'button', class: 'icon-btn', title: 'Remover da base', 'aria-label': `Remover ${d.title}`, onclick: async () => {
      if (!confirm(`Remover "${d.title}" da base de conhecimento?`)) return;
      try { await api(`/api/sources/${encodeURIComponent(s.id)}/docs/${encodeURIComponent(d.key)}`, { method: 'DELETE' }); loadSources(); } catch (e) { toast(e.message, 'error'); }
    } }, '✕'),
  )));
}

function progressBar(s) {
  if (!(s.syncing || s.status === 'syncing') || !s.progress?.total) return null;
  return el('div', { class: 'progress' }, el('i', { style: `width:${Math.round((100 * s.progress.done) / s.progress.total)}%` }));
}

function sourceActions(s) {
  return el('div', { class: 'row', style: 'margin-top:.6rem' },
    el('button', { type: 'button', class: 'btn', disabled: s.syncing || s.status === 'syncing', onclick: async () => {
      try { await api(`/api/sources/${encodeURIComponent(s.id)}/sync`, { method: 'POST' }); loadSources(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Sincronizar agora'),
    el('button', { type: 'button', class: 'btn danger', onclick: async () => {
      if (!confirm(`Desconectar "${s.name}"? Os documentos dela saem da base (nada é apagado na origem).`)) return;
      try { await api(`/api/sources/${encodeURIComponent(s.id)}`, { method: 'DELETE' }); toast('Fonte desconectada'); loadSources(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Desconectar'),
  );
}

function connectedCard(s) {
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: `logo-badge ${s.kind}` }, KIND[s.kind].letter), el('div', {}, el('h3', {}, s.name), el('span', { class: 'muted small' }, s.settings.baseUrl ?? (s.settings.folderId ? `pasta ${s.settings.folderId}` : 'todos os documentos acessíveis'), s.settings.spaceKeys ? ` · espaços ${s.settings.spaceKeys}` : '')), statusOf(s)),
    editableDescription(s),
    progressBar(s),
    s.status === 'error' || s.lastError ? el('p', { class: 'small error-msg' }, s.lastError) : null,
    el('div', { class: 'small muted' }, `${s.documents} documento${s.documents === 1 ? '' : 's'} · ${s.chunks} trechos indexados · tool MCP `, el('code', {}, `buscar_${s.id}`)),
    docList(s, false),
    sourceActions(s),
  );
}

function uploadCard(s) {
  const zone = el('div', { class: 'dropzone', tabindex: '0', role: 'button', onclick: () => $('#file-input').click(), onkeydown: (e) => { if (e.key === 'Enter') $('#file-input').click(); } },
    el('strong', {}, 'Arraste arquivos ou clique para escolher'), el('br'),
    `${state.config.supportedExtensions.join(' ')} · até ${Math.round(state.config.maxUploadBytes / 1024 / 1024)} MB por arquivo`);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); uploadFiles(e.dataTransfer.files); });
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'logo-badge upload' }, '⇪'), el('div', {}, el('h3', {}, 'Upload de documentos'), el('span', { class: 'muted small' }, 'PDF, Word, Markdown, texto, CSV')), statusOf(s)),
    editableDescription(s),
    zone,
    docList(s, true),
  );
}

function gdriveConnectCard() {
  const c = state.config.connectors.gdrive;
  const folder = el('input', { placeholder: 'opcional: id da pasta (vazio = todos os arquivos)', 'aria-label': 'Id da pasta do Google Drive' });
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'logo-badge gdrive' }, 'G'), el('div', {}, el('h3', {}, 'Google Drive'), el('span', { class: 'muted small' }, 'Google Docs, PDF, Word e texto · somente leitura'))),
    el('p', { class: 'desc' }, 'Você entra com a conta Google da empresa e autoriza leitura. Os documentos são sincronizados aqui; mudanças no Drive entram na próxima sincronização.'),
    c.available
      ? el('div', { class: 'form' }, el('label', { class: 'full' }, 'Pasta (opcional)', folder),
        el('div', { class: 'full row' }, el('button', { type: 'button', class: 'btn primary', onclick: () => { location.href = `/api/connectors/google/start${folder.value.trim() ? `?folderId=${encodeURIComponent(folder.value.trim())}` : ''}`; } }, 'Conectar Google Drive'),
          state.config.simulated && el('span', { class: 'small muted' }, 'modo simulado: conta fictícia, sem tela do Google')))
      : el('p', { class: 'notice' }, c.reason),
  );
}

function confluenceConnectCard() {
  const f = {
    baseUrl: el('input', { placeholder: 'https://empresa.atlassian.net', required: true, value: state.config.simulated ? 'https://aurora-logistica.atlassian.net' : '' }),
    email: el('input', { type: 'email', placeholder: 'voce@empresa.com', required: true, value: state.config.simulated ? 'demo@aurora.com.br' : '' }),
    apiToken: el('input', { type: 'password', placeholder: 'API token da Atlassian', required: true, value: state.config.simulated ? 'token-demo' : '' }),
    spaceKeys: el('input', { placeholder: 'opcional: ENG, OPS (vazio = todos)' }),
  };
  const btn = el('button', { type: 'submit', class: 'btn primary' }, 'Conectar Confluence');
  const form = el('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      await api('/api/connectors/confluence', { body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) });
      toast('Confluence conectado; sincronizando as páginas');
      await loadSources();
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; btn.textContent = 'Conectar Confluence'; }
  } },
  el('label', { class: 'full' }, 'URL do site', f.baseUrl),
  el('label', {}, 'E-mail da conta Atlassian', f.email),
  el('label', {}, 'API token', f.apiToken),
  el('label', { class: 'full' }, 'Espaços', f.spaceKeys),
  el('div', { class: 'full row' }, btn, el('a', { class: 'small muted', href: 'https://id.atlassian.com/manage-profile/security/api-tokens', target: '_blank', rel: 'noopener' }, 'Como criar um API token')));
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'logo-badge confluence' }, 'C'), el('div', {}, el('h3', {}, 'Confluence (Atlassian)'), el('span', { class: 'muted small' }, 'Páginas de espaços do Confluence Cloud · somente leitura'))),
    form);
}

async function toolsCard() {
  const box = el('div', { class: 'tools-list' }, el('div', {}, 'carregando…'));
  api('/api/mcp/tools').then(({ tools }) => box.replaceChildren(...tools.map((t) => el('div', {}, el('b', {}, t.name), ' — ', t.description)))).catch((e) => box.replaceChildren(el('div', {}, e.message)));
  return el('details', { class: 'card' },
    el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Como o assistente enxerga as fontes (tools MCP)'),
    el('p', { class: 'desc' }, 'A cada pergunta, o assistente lista as tools do servidor MCP do workspace (tools/list), chama todas com a pergunta e junta os trechos por Reciprocal Rank Fusion. Conectar uma fonte nova cria uma tool nova, sem mudar o assistente. O mesmo servidor pode ser usado no Claude Desktop ou em outro cliente MCP (npm run workspace:mcp).'),
    box);
}

async function renderSourcesModal() {
  const body = $('#sources-body');
  const cards = [];
  for (const s of state.sources) cards.push(s.kind === 'upload' ? uploadCard(s) : connectedCard(s));
  if (!state.sources.some((s) => s.kind === 'gdrive')) cards.push(gdriveConnectCard());
  if (!state.sources.some((s) => s.kind === 'confluence')) cards.push(confluenceConnectCard());
  else cards.push(el('details', { class: 'card' }, el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Conectar outro site do Confluence'), confluenceConnectCard()));
  cards.push(await toolsCard());
  // Não troca o conteúdo enquanto o usuário digita num formulário.
  if (body.contains(document.activeElement) && document.activeElement.matches('input, [contenteditable]')) return;
  body.replaceChildren(...cards);
}

async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return;
  for (const file of list) {
    if (file.size > state.config.maxUploadBytes) { toast(`${file.name}: maior que o limite`, 'error'); continue; }
    toast(`Enviando ${file.name}…`);
    try {
      const contentBase64 = await new Promise((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => fail(new Error('falha ao ler o arquivo'));
        r.readAsDataURL(file);
      });
      const res = await api('/api/uploads', { body: { name: file.name, contentBase64 } });
      toast(res.status === 'unchanged' ? `${file.name}: já estava na base` : `${file.name}: ${res.doc.chunkCount} trechos indexados`);
    } catch (e) { toast(`${file.name}: ${e.message}`, 'error'); }
  }
  await loadSources();
}

// ---------- Conversas ----------

async function loadConversations() {
  const { conversations } = await api('/api/conversations');
  state.conversations = conversations;
  const nav = $('#history');
  nav.replaceChildren(
    conversations.length ? el('h3', {}, 'Conversas') : el('p', { class: 'small muted', style: 'padding:0 .5rem' }, 'As conversas aparecem aqui.'),
    ...conversations.map((c) => el('button', { type: 'button', class: `conv ${state.current?.id === c.id ? 'active' : ''}`, onclick: () => openConversation(c.id) },
      el('span', {}, c.title),
      el('span', { class: 'del', role: 'button', title: 'Apagar conversa', onclick: async (e) => {
        e.stopPropagation();
        await api(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        if (state.current?.id === c.id) newConversation();
        loadConversations();
      } }, '✕'))),
  );
}

async function openConversation(id) {
  const { conversation } = await api(`/api/conversations/${encodeURIComponent(id)}`);
  state.current = conversation;
  $('#sidebar').classList.remove('open');
  renderThread();
  loadConversations();
}

function newConversation() {
  state.current = null;
  closeViewer();
  renderThread();
  loadConversations();
  $('#question').focus();
}

function inline(text, ctx) {
  // **negrito** e citações [D3#2] (uma ou várias por colchete).
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*([^*]+)\*\*|\[([^[\]]+)\]/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(el('strong', {}, m[1]));
    else {
      const ids = m[2].split(/[\s,;]+/).filter((t) => t.includes('#'));
      if (!ids.length) out.push(m[0]);
      for (const id of ids) {
        const n = ctx.number(id);
        out.push(n ? el('button', { type: 'button', class: 'cite', title: ctx.title(id), onclick: () => showPassage(ctx.passage(id)) }, String(n))
          : el('span', { class: 'cite invalid', title: `citação a um trecho que não estava no contexto: ${id}` }, '?'));
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Markdown mínimo: parágrafos, listas com - ou 1., negrito e citações. */
function renderAnswerText(text, ctx) {
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /^\d/.test(line);
      if (!list || list.ordered !== ordered) { list = { ordered, node: el(ordered ? 'ol' : 'ul') }; blocks.push(list.node); }
      list.node.append(el('li', {}, ...inline(item[1], ctx)));
    } else if (line) {
      list = null;
      blocks.push(el('p', {}, ...inline(line, ctx)));
    } else list = null;
  }
  return blocks;
}

function assistantTurn(turn) {
  const passages = turn.passages ?? [];
  const cited = (turn.citations ?? []).map((c) => c.chunkId);
  // Numeração na ordem da primeira citação, como nos apps de chat.
  const ctx = {
    number: (id) => (cited.includes(id) ? cited.indexOf(id) + 1 : null),
    passage: (id) => passages.find((p) => p.chunkId === id),
    title: (id) => { const p = passages.find((x) => x.chunkId === id); return p ? `${p.title}${p.heading ? ` · ${p.heading}` : ''}` : id; },
  };
  const used = cited.map((id) => passages.find((p) => p.chunkId === id)).filter(Boolean);
  return el('div', { class: 'turn assistant' },
    el('div', { class: 'avatar', 'aria-hidden': 'true' }, '◆'),
    el('div', { class: `answer ${turn.abstained ? 'abstained' : ''}` },
      ...renderAnswerText(turn.text, ctx),
      used.length ? el('div', { class: 'sources-used' }, ...used.map((p, i) => el('button', { type: 'button', class: 'source-card', onclick: () => showPassage(p) },
        el('span', { class: 'n' }, String(i + 1)), kindIco(p.kind),
        el('span', {}, el('span', { class: 't' }, p.title), el('span', { class: 's' }, `${p.sourceName}${p.heading ? ` · ${p.heading}` : ''}`))))) : null,
      el('details', { class: 'trace' },
        el('summary', {}, `Como foi buscado · ${turn.tools?.length ?? 0} tools MCP · ${Math.round(turn.timing?.totalMs ?? 0)} ms`),
        el('table', {}, ...(turn.tools ?? []).map((t) => el('tr', {}, el('td', {}, t.name), el('td', {}, `${t.hits} trechos`), el('td', {}, `${Math.round(t.ms)} ms`)))),
        el('div', { style: 'margin-top:.4rem' }, 'Trechos entregues ao modelo:'),
        el('ol', { style: 'margin:.2rem 0 0;padding-left:1.2rem' }, ...passages.map((p) => el('li', {}, el('button', { type: 'button', class: 'cite', style: 'min-width:auto', onclick: () => showPassage(p) }, p.chunkId), ` ${p.title}${p.heading ? ` · ${p.heading}` : ''} (${p.sourceName})`))),
      ),
    ),
  );
}

function suggestions() {
  const docs = state.sources.flatMap((s) => s.docs.map((d) => ({ ...d, source: s })));
  if (!docs.length) return null;
  const picks = docs.slice(0, 4);
  return el('div', { class: 'suggestions' }, ...picks.map((d) => el('button', { type: 'button', class: 'suggestion', onclick: () => ask(`O que diz o documento "${d.title}"?`) },
    `O que diz o documento "${d.title}"?`, el('small', {}, d.source.name))));
}

function renderThread() {
  const thread = $('#thread');
  $('#conv-title').textContent = state.current?.title ?? 'Nova conversa';
  if (!state.current) {
    const total = state.sources.reduce((n, s) => n + s.documents, 0);
    thread.replaceChildren(el('div', { class: 'welcome' },
      el('span', { class: 'logo', 'aria-hidden': 'true' }, '◆'),
      el('h2', {}, 'Como posso ajudar?'),
      el('p', { class: 'muted' }, total
        ? `Pergunte sobre os ${total} documentos de ${state.sources.filter((s) => s.documents).map((s) => s.name).join(', ')}. As respostas citam o trecho de origem.`
        : 'Primeiro, coloque os documentos da empresa na base de conhecimento.'),
      total ? suggestions() : el('div', { class: 'empty-sources' },
        el('div', {}, 'Envie arquivos ou conecte o Google Drive e o Confluence.'),
        el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn primary', onclick: () => $('#file-input').click() }, 'Enviar arquivos'),
          el('button', { type: 'button', class: 'btn', onclick: openSources }, 'Conectar fontes'))),
    ));
    return;
  }
  const inner = el('div', { class: 'thread-inner' }, ...state.current.turns.map((t) => (t.role === 'user' ? el('div', { class: 'turn user' }, el('div', { class: 'bubble' }, t.text)) : assistantTurn(t))));
  thread.replaceChildren(inner);
  thread.scrollTop = thread.scrollHeight;
}

async function ask(question) {
  const q = question.trim();
  if (!q || state.busy) return;
  state.busy = true;
  $('#send').disabled = true;
  $('#question').value = '';
  autosize();
  if (!state.current) state.current = { id: 'nova', title: q, turns: [] };
  state.current.turns.push({ role: 'user', text: q });
  renderThread();
  const pending = el('div', { class: 'turn assistant' }, el('div', { class: 'avatar' }, '◆'), el('div', { class: 'answer' }, el('span', { class: 'typing' }, el('i'), el('i'), el('i'))));
  $('#thread .thread-inner').append(pending);
  $('#thread').scrollTop = $('#thread').scrollHeight;
  try {
    const { conversation } = await api(`/api/conversations/${encodeURIComponent(state.current.id)}/messages`, { body: { question: q } });
    state.current = conversation;
    renderThread();
    loadConversations();
  } catch (e) {
    pending.querySelector('.answer').replaceChildren(el('p', { class: 'error-msg' }, `Não foi possível responder: ${e.message}`));
    state.current.turns.pop();
  } finally {
    state.busy = false;
    $('#send').disabled = false;
  }
}

// ---------- Trecho citado ----------

function showPassage(p) {
  if (!p) return;
  const v = $('#viewer');
  v.hidden = false;
  $('#viewer-body').replaceChildren(
    el('div', { class: 'meta' }, kindIco(p.kind), p.sourceName),
    el('h3', {}, p.title),
    p.heading ? el('div', { class: 'meta' }, p.heading) : null,
    el('div', { class: 'id' }, p.chunkId),
    p.url ? el('a', { class: 'open-link', href: p.url, target: '_blank', rel: 'noopener' }, `Abrir no ${p.kind === 'gdrive' ? 'Google Drive' : p.kind === 'confluence' ? 'Confluence' : 'documento original'} ↗`) : null,
    el('p', { class: 'text' }, p.text),
  );
}
function closeViewer() { $('#viewer').hidden = true; }

// ---------- Inicialização ----------

function openSources() {
  renderSourcesModal();
  $('#sources-modal').showModal();
}

function autosize() {
  const t = $('#question');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
}

function setupDrop() {
  const main = $('#drop-target');
  let depth = 0;
  main.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; main.classList.add('dragging'); } });
  main.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) main.classList.remove('dragging'); });
  main.addEventListener('dragover', (e) => e.preventDefault());
  main.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; main.classList.remove('dragging'); uploadFiles(e.dataTransfer.files); });
}

async function init() {
  state.config = await api('/api/workspace');
  const m = state.config.mode;
  const warn = m.embedder.startsWith('hash') || m.llm.startsWith('extrativo');
  $('#mode').replaceChildren(
    el('div', {}, `embeddings ${m.embedder} · índice ${m.store}`),
    el('div', {}, `LLM ${m.llm}`),
    state.config.simulated ? el('div', { class: 'warn' }, 'conectores simulados (empresa fictícia)') : null,
    warn ? el('div', { class: 'warn' }, 'modo de teste: sem busca semântica ou sem LLM') : null,
  );
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); ask($('#question').value); });
  $('#question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#question').value); } });
  $('#question').addEventListener('input', autosize);
  $('#attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').accept = state.config.supportedExtensions.join(',');
  $('#file-input').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
  $('#new-chat').addEventListener('click', newConversation);
  $('#open-sources').addEventListener('click', openSources);
  $('#close-sources').addEventListener('click', () => $('#sources-modal').close());
  $('#close-viewer').addEventListener('click', closeViewer);
  $('#toggle-sidebar').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  setupDrop();
  const params = new URLSearchParams(location.search);
  if (params.get('erro')) toast(params.get('erro'), 'error');
  if (params.get('conectado')) { toast('Google Drive conectado; sincronizando os documentos'); openSources(); }
  if (params.size) history.replaceState(null, '', '/');
  await Promise.all([loadSources(), loadConversations()]);
  renderThread();
}

init().catch((e) => toast(e.message, 'error'));
