// Front da demonstração: consome src/api (npm run demo). Sem dependências e sem build.
// Todo texto vindo da API entra por textContent, nunca como HTML.

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  return node;
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `erro ${res.status}`);
  return data;
}

let approaches = [];

async function showUnit(unitId) {
  const viewer = $('#viewer');
  viewer.replaceChildren(el('p', { class: 'muted' }, 'Carregando…'));
  try {
    const u = await api(`/api/units/${encodeURIComponent(unitId)}`);
    viewer.replaceChildren(el('div', { class: 'unit' },
      el('div', { class: 'meta' }, el('span', { class: `dot ${u.source}` }), u.sourceTitle),
      el('h3', {}, u.title),
      el('div', { class: 'meta' }, u.heading),
      el('div', { class: 'id' }, u.id),
      el('p', { class: 'text' }, u.text),
    ));
  } catch (e) {
    viewer.replaceChildren(el('p', { class: 'error' }, e.message));
  }
}

async function loadSources() {
  const { sources } = await api('/api/sources');
  $('#sources').replaceChildren(...sources.map((s) => el('details', { class: 'source', open: true },
    el('summary', {}, el('span', { class: `dot ${s.source}` }), `${s.title} (${s.documents})`),
    el('p', { class: 'desc' }, s.description),
    ...s.docs.map((d) => el('button', { type: 'button', class: 'doc', title: d.docId, onclick: () => showUnit(d.units[0].id) }, `${d.docId} · ${d.title}`)),
  )));
}

async function loadConfig() {
  const cfg = await api('/api/config');
  approaches = cfg.approaches;
  $('#mode').textContent = `embeddings: ${cfg.mode.embedder} · índice: ${cfg.mode.store} · LLM: ${cfg.mode.llm}`;
  const group = $('#approaches');
  group.replaceChildren(...approaches.map((a, i) => el('label', { title: a.description },
    el('input', { type: 'radio', name: 'approach', value: a.id, checked: a.id === 'D' || (i === approaches.length - 1 && !approaches.some((x) => x.id === 'D')), onchange: updateHelp }),
    el('span', {}, a.label),
  )));
  updateHelp();
}

function selectedApproach() {
  return document.querySelector('input[name=approach]:checked')?.value;
}

function updateHelp() {
  const a = approaches.find((x) => x.id === selectedApproach());
  $('#approach-help').textContent = a ? a.description : '';
}

/** Troca os `[id#secao]` da resposta por botões que abrem o trecho citado. */
function renderAnswer(text, passages) {
  const order = passages.map((p) => p.unitId);
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^[\]]+)\]/g)) {
    const ids = m[1].split(/[\s,;]+/).filter((t) => t.includes('#'));
    if (!ids.length) continue;
    parts.push(text.slice(last, m.index));
    for (const id of ids) {
      const n = order.indexOf(id);
      parts.push(n >= 0
        ? el('button', { type: 'button', class: 'cite', title: id, onclick: () => showUnit(id) }, String(n + 1))
        : el('span', { class: 'cite invalid', title: `citação fora dos trechos entregues: ${id}` }, '?'));
    }
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

function addMessage(node) {
  const box = $('#messages');
  box.querySelector('.empty')?.remove();
  box.append(node);
  box.scrollTop = box.scrollHeight;
}

async function ask(question, approach) {
  addMessage(el('div', { class: 'msg user' }, el('div', { class: 'bubble' }, question)));
  const pending = el('div', { class: 'msg' }, el('div', { class: 'meta' }, `${approach}: buscando…`));
  addMessage(pending);
  try {
    const r = await api('/api/ask', { question, approach });
    const label = approaches.find((a) => a.id === r.approach)?.label ?? r.approach;
    const timing = `recuperação ${r.timing.retrievalMs.toFixed(0)} ms` + (r.answer ? ` · total ${r.timing.totalMs.toFixed(0)} ms` : '');
    pending.replaceChildren(
      el('div', { class: 'meta' }, `${label} · ${timing}`),
      r.answer
        ? el('div', { class: 'bubble' }, ...renderAnswer(r.answer.text, r.passages))
        : el('div', { class: 'bubble muted' }, 'Esta abordagem não gera resposta; veja os trechos encontrados.'),
      el('div', { class: 'passages' }, ...r.passages.map((p, i) => el('button', { type: 'button', class: 'passage', onclick: () => showUnit(p.unitId) },
        el('div', { class: 'head' }, el('span', { class: `dot ${p.source}` }), `${i + 1}. ${p.title} · ${p.heading}`),
        el('div', { class: 'snippet' }, p.text),
      ))),
    );
  } catch (e) {
    pending.replaceChildren(el('div', { class: 'error' }, e.message));
  }
}

$('#ask').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = $('#question').value.trim();
  const a = selectedApproach();
  if (!q || !a) return;
  $('#send').disabled = true;
  $('#question').value = '';
  await ask(q, a);
  $('#send').disabled = false;
  $('#question').focus();
});
$('#question').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('#ask').requestSubmit(); }
});
document.querySelector('.example')?.addEventListener('click', (ev) => { $('#question').value = ev.target.textContent; $('#question').focus(); });

await Promise.all([loadConfig(), loadSources()]).catch((e) => {
  $('#sources').replaceChildren(el('p', { class: 'error' }, `API indisponível: ${e.message}`));
});
