import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { SHEET_COLUMNS, parseRatings, summarizeRatings, type BlindKey } from '../evaluation/human.js';
import { CRITERIA, RUBRIC, type Criterion } from '../evaluation/rubric.js';
import { parseCsv, toCsv } from '../sources/csv.js';
import { HttpError } from './app.js';

/**
 * Modo de avaliação humana cega (H2, ADR 007) na UI: `npm run demo -- --avaliacao <id>`, em que
 * `<id>` é a pasta de `npm run eval:human` em `results/runs/` (planilha.csv, chave.json e
 * instrucoes.md). Cada avaliador dá as notas na tela, uma resposta distinta por vez (C e D,
 * quando iguais, são uma linha só), e o servidor grava a planilha dele no mesmo formato da
 * planilha cega, em `avaliacoes-ui/<avaliador>.csv`, pronta para `npm run eval:human -- --import`.
 *
 * Cegueira: nada do que sai daqui menciona a abordagem; a chave só é lida no servidor, para a
 * concordância (alfa de Krippendorff), que não depende das abordagens. Este modo não carrega
 * as abordagens nem o Ollama: só precisa do Node.
 */

export interface SheetItem {
  item: string;
  pergunta: string;
  resposta_referencia: string;
  trechos: { unitId: string; fonte: string; texto: string }[];
  resposta: string;
}

export interface RaterEntry {
  scores: Partial<Record<Criterion, number>>;
  observacoes: string;
}

const RATER_DIR = 'avaliacoes-ui';
const MAX_OBS = 2000;

/** Separa o campo `trechos` da planilha (`[id] (fonte: X)\ntexto`, separados por linha em branco). */
export function splitPassages(text: string): SheetItem['trechos'] {
  const out: SheetItem['trechos'] = [];
  const re = /^\[([^\]\n]+)\] \(fonte: ([^)\n]+)\)\n/gm;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
    out.push({ unitId: m[1]!, fonte: m[2]!, texto: text.slice(start, end).trim() });
  });
  return out;
}

/** Lê a planilha cega (separador `;`, com BOM). */
export function readSheet(csv: string): SheetItem[] {
  const [header, ...rows] = parseCsv(csv.replace(/^﻿/, ''), ';');
  if (!header) throw new Error('planilha vazia');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`a planilha não tem a coluna ${name}`);
    return i;
  };
  const [ci, cp, cr, ct, ca] = ['item', 'pergunta', 'resposta_referencia', 'trechos', 'resposta'].map(col) as [number, number, number, number, number];
  return rows.filter((r) => r[ci]?.trim()).map((r) => ({
    item: r[ci]!.trim(), pergunta: r[cp] ?? '', resposta_referencia: r[cr] ?? '', trechos: splitPassages(r[ct] ?? ''), resposta: r[ca] ?? '',
  }));
}

/** Nome do avaliador como nome de arquivo: minúsculas, sem acentos, só letras, dígitos e hífen. */
export function raterId(name: string): string {
  const id = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id || id.length > 40) throw new HttpError(400, 'nome do avaliador inválido (use de 1 a 40 letras ou dígitos)');
  return id;
}

export function createEvalHandler(opts: { sheetDir: string; staticDir?: string | null }) {
  const raw = readFileSync(join(opts.sheetDir, 'planilha.csv'), 'utf8');
  const [header, ...rawRows] = parseCsv(raw.replace(/^﻿/, ''), ';');
  const rowsById = new Map(rawRows.filter((r) => r[0]?.trim()).map((r) => [r[0]!.trim(), r]));
  const items = readSheet(raw);
  const key = JSON.parse(readFileSync(join(opts.sheetDir, 'chave.json'), 'utf8')) as BlindKey;
  for (const it of items) if (!key[it.item]) throw new Error(`item ${it.item} da planilha não está na chave`);
  const instructions = existsSync(join(opts.sheetDir, 'instrucoes.md')) ? readFileSync(join(opts.sheetDir, 'instrucoes.md'), 'utf8') : '';
  const dir = join(opts.sheetDir, RATER_DIR);
  const cache = new Map<string, Map<string, RaterEntry>>();
  const col = (name: string) => header!.indexOf(name);

  function load(rater: string): Map<string, RaterEntry> {
    const hit = cache.get(rater);
    if (hit) return hit;
    const m = new Map<string, RaterEntry>();
    const path = join(dir, `${rater}.csv`);
    if (existsSync(path)) {
      const [h, ...rows] = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''), ';');
      for (const r of rows) {
        const id = r[h!.indexOf('item')]?.trim();
        if (!id) continue;
        const scores: RaterEntry['scores'] = {};
        for (const c of CRITERIA) {
          const v = Number((r[h!.indexOf(c)] ?? '').trim());
          if (Number.isInteger(v) && v >= 1 && v <= 5) scores[c] = v;
        }
        m.set(id, { scores, observacoes: r[h!.indexOf('observacoes')] ?? '' });
      }
    }
    cache.set(rater, m);
    return m;
  }

  /** Regrava a planilha do avaliador: as mesmas linhas e colunas da planilha cega, com as notas. */
  function save(rater: string) {
    const m = load(rater);
    const rows = [...rowsById].map(([id, r]) => {
      const e = m.get(id);
      const out = SHEET_COLUMNS.map((c) => r[col(c)] ?? '');
      if (e) {
        for (const c of CRITERIA) out[SHEET_COLUMNS.indexOf(c)] = e.scores[c] === undefined ? '' : String(e.scores[c]);
        out[SHEET_COLUMNS.indexOf('observacoes')] = e.observacoes;
      }
      return out;
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${rater}.csv`), '﻿' + toCsv([[...SHEET_COLUMNS], ...rows], ';'));
  }

  function agreement() {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.csv')).sort() : [];
    const raters = files.map((f) => ({ name: f.slice(0, -4), ratings: parseRatings(readFileSync(join(dir, f), 'utf8'), key) }));
    const summary = summarizeRatings(raters, key);
    // Só a concordância e a contagem: as médias por abordagem ficam para o `eval:human --import`.
    return { itens: items.length, avaliadores: summary.avaliadores, concordancia: raters.length >= 2 ? summary.concordancia : null };
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) throw new HttpError(413, 'corpo da requisição grande demais');
    }
    try {
      return JSON.parse(body || '{}');
    } catch {
      throw new HttpError(400, 'JSON inválido');
    }
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, modo: 'avaliacao' });
    if (req.method === 'GET' && path === '/api/eval/config') {
      return send(res, 200, { itens: items.length, instrucoes: instructions, criterios: CRITERIA.map((c) => ({ id: c, ...RUBRIC[c] })) });
    }
    if (req.method === 'GET' && path === '/api/eval/items') return send(res, 200, { items });
    if (req.method === 'GET' && path === '/api/eval/agreement') return send(res, 200, agreement());
    if (parts[0] === 'api' && parts[1] === 'eval' && parts[2] === 'ratings' && parts.length === 4 && req.method === 'GET') {
      return send(res, 200, { avaliador: raterId(parts[3]!), notas: Object.fromEntries(load(raterId(parts[3]!))) });
    }
    if (parts[0] === 'api' && parts[1] === 'eval' && parts[2] === 'ratings' && parts.length === 5 && req.method === 'PUT') {
      const rater = raterId(parts[3]!);
      const item = parts[4]!;
      if (!rowsById.has(item)) throw new HttpError(404, `item desconhecido: ${item}`);
      const body = (await readBody(req)) as Record<string, unknown>;
      const scores: RaterEntry['scores'] = {};
      for (const c of CRITERIA) {
        const v = body[c];
        if (v === undefined || v === null || v === '') continue;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw new HttpError(400, `nota inválida em ${c}: use um inteiro de 1 a 5`);
        scores[c] = v;
      }
      const obs = typeof body.observacoes === 'string' ? body.observacoes.slice(0, MAX_OBS) : '';
      load(rater).set(item, { scores, observacoes: obs });
      save(rater);
      return send(res, 200, { ok: true });
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'rota não encontrada');
    if (req.method === 'GET' && opts.staticDir) {
      const file = path === '/' ? 'avaliar.html' : path.slice(1);
      const types: Record<string, string> = { 'avaliar.html': 'text/html', 'avaliar.js': 'text/javascript', 'style.css': 'text/css' };
      if (types[file]) {
        res.writeHead(200, { 'content-type': `${types[file]}; charset=utf-8` });
        return res.end(readFileSync(join(opts.staticDir, file)));
      }
    }
    throw new HttpError(404, 'não encontrado');
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  };
}
