// Modo de avaliação humana cega (npm run demo -- --avaliacao <id>). Nada aqui sabe qual
// abordagem gerou cada resposta. Todo texto da API entra por textContent.

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

async function api(path, init) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `erro ${res.status}`);
  return data;
}

let config;
let items = [];
let notes = {};
let rater = '';
let index = 0;

/** Markdown mínimo das instruções: títulos e parágrafos. */
function renderInstructions(md) {
  return md.split(/\n{2,}/).map((block) => {
    const h = block.match(/^(#+)\s+(.*)$/);
    if (h) return el(h[1].length === 1 ? 'h3' : 'h4', {}, h[2]);
    return el('p', {}, block.replace(/`/g, ''));
  });
}

const complete = (id) => config.criterios.every((c) => Number.isInteger(notes[id]?.scores?.[c.id]));

function renderGrid() {
  const done = items.filter((it) => complete(it.item)).length;
  $('#progress').textContent = `${done} de ${items.length} avaliadas`;
  $('#grid').replaceChildren(...items.map((it, i) => el('button', {
    type: 'button', title: it.item,
    class: `cell${complete(it.item) ? ' done' : ''}${i === index ? ' current' : ''}`,
    onclick: () => go(i),
  }, String(i + 1))));
}

function renderCriteria() {
  $('#criteria').replaceChildren(...config.criterios.map((c) => el('fieldset', { class: 'criterion' },
    el('legend', {}, c.title),
    el('p', { class: 'small muted' }, c.text),
    el('div', { class: 'scale' }, ...[1, 2, 3, 4, 5].map((v) => el('label', {},
      el('input', { type: 'radio', name: c.id, value: String(v), required: true }), el('span', {}, String(v)),
    ))),
  )));
}

function show() {
  const it = items[index];
  $('#item-id').textContent = `${index + 1} de ${items.length} · ${it.item}`;
  $('#q').textContent = it.pergunta;
  $('#ref').textContent = it.resposta_referencia;
  $('#ans').textContent = it.resposta;
  $('#nctx').textContent = String(it.trechos.length);
  $('#passages').replaceChildren(...it.trechos.map((t) => el('div', { class: 'passage static' },
    el('div', { class: 'head' }, `[${t.unitId}] · ${t.fonte}`),
    el('div', { class: 'text' }, t.texto),
  )));
  const n = notes[it.item];
  for (const c of config.criterios) {
    for (const input of document.querySelectorAll(`input[name=${c.id}]`)) input.checked = Number(input.value) === n?.scores?.[c.id];
  }
  $('#obs').value = n?.observacoes ?? '';
  $('#prev').disabled = index === 0;
  $('#saved').textContent = complete(it.item) ? 'Já avaliada; você pode alterar as notas.' : '';
  renderGrid();
  $('.eval-item').scrollTop = 0;
}

function go(i) {
  index = Math.max(0, Math.min(items.length - 1, i));
  show();
}

async function refreshAgreement() {
  try {
    const a = await api('/api/eval/agreement');
    const who = a.avaliadores.map((r) => `${r.nome}: ${r.itensAvaliados}`).join(' · ');
    if (!a.concordancia) { $('#agreement').textContent = `Avaliadores: ${who || 'nenhum'}. A concordância aparece com 2 ou mais.`; return; }
    $('#agreement').replaceChildren(
      el('div', {}, `Avaliadores: ${who}`),
      el('div', {}, 'Alfa de Krippendorff (ordinal):'),
      ...Object.entries(a.concordancia).map(([c, v]) => el('div', {}, `${c}: ${Number.isFinite(v) ? v.toFixed(3) : 'indefinido'}`)),
    );
  } catch (e) {
    $('#agreement').textContent = e.message;
  }
}

$('#scores').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const it = items[index];
  const body = { observacoes: $('#obs').value };
  for (const c of config.criterios) body[c.id] = Number(document.querySelector(`input[name=${c.id}]:checked`)?.value);
  $('#next').disabled = true;
  try {
    await api(`/api/eval/ratings/${encodeURIComponent(rater)}/${encodeURIComponent(it.item)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    notes[it.item] = { scores: Object.fromEntries(config.criterios.map((c) => [c.id, body[c.id]])), observacoes: body.observacoes };
    const nextOpen = items.findIndex((x, i) => i > index && !complete(x.item));
    if (nextOpen >= 0) go(nextOpen);
    else if (index < items.length - 1) go(index + 1);
    else { show(); $('#saved').textContent = 'Salvo.'; }
    if (items.every((x) => complete(x.item))) $('#saved').textContent = 'Todas as respostas foram avaliadas. Obrigado!';
    refreshAgreement();
  } catch (e) {
    $('#saved').textContent = `Não salvou: ${e.message}`;
  } finally {
    $('#next').disabled = false;
  }
});
$('#prev').addEventListener('click', () => go(index - 1));

$('#login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const r = await api(`/api/eval/ratings/${encodeURIComponent($('#rater').value)}`);
    rater = r.avaliador;
    notes = r.notas;
    $('#who').textContent = `avaliador: ${rater}`;
    $('#start').hidden = true;
    $('#work').hidden = false;
    const firstOpen = items.findIndex((x) => !complete(x.item));
    go(firstOpen >= 0 ? firstOpen : 0);
    refreshAgreement();
  } catch (e) {
    alert(e.message);
  }
});

[config, { items }] = await Promise.all([api('/api/eval/config'), api('/api/eval/items')]);
$('#instructions').replaceChildren(...renderInstructions(config.instrucoes));
renderCriteria();
