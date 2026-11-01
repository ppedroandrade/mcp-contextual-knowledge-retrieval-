import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvalHandler, raterId, splitPassages } from '../../src/api/eval.js';
import { blindSheet, evaluatorInstructions, parseRatings } from '../../src/evaluation/human.js';
import type { EvalItem } from '../../src/evaluation/items.js';

const item = (n: number, approaches: string[]): EvalItem => ({
  key: `k${n}`, questionId: `q${n}`, type: 'single-source', approaches,
  question: `Pergunta ${n}; com "aspas"?`, referenceAnswer: `Referência ${n}.`,
  context: [{ unitId: `DOC-00${n}#a`, source: 'docs', text: `Título\nSeção\nTexto ${n}` }, { unitId: `T-100${n}#b`, source: 'tickets', text: 'Outro; trecho' }],
  answer: `Resposta ${n} [DOC-00${n}#a].`, abstained: false,
});

const items = [item(1, ['B-rag']), item(1, ['C-por-fonte', 'D-mcp']), item(2, ['B-rag']), item(2, ['C-por-fonte', 'D-mcp'])];
items[1]!.key = 'k1cd';
items[3]!.key = 'k2cd';
const dir = mkdtempSync(join(tmpdir(), 'avaliacao-'));
const { csv, key } = blindSheet(items, 42);
writeFileSync(join(dir, 'planilha.csv'), csv);
writeFileSync(join(dir, 'chave.json'), JSON.stringify(key));
writeFileSync(join(dir, 'instrucoes.md'), evaluatorInstructions(items.length));

let server: Server;
let base: string;
beforeAll(async () => {
  const handler = createEvalHandler({ sheetDir: dir, staticDir: join(import.meta.dirname, '..', '..', 'apps', 'demo') });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((ok) => server?.close(ok)));

const put = (rater: string, id: string, body: unknown) => fetch(`${base}/api/eval/ratings/${rater}/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('modo de avaliação humana cega', () => {
  it('separa os trechos da planilha', () => {
    expect(splitPassages('[A#1] (fonte: Wiki técnica)\nx\ny\n\n[B#2] (fonte: Chamados de suporte)\nz')).toEqual([
      { unitId: 'A#1', fonte: 'Wiki técnica', texto: 'x\ny' },
      { unitId: 'B#2', fonte: 'Chamados de suporte', texto: 'z' },
    ]);
  });

  it('normaliza o nome do avaliador e recusa nomes vazios', () => {
    expect(raterId('  João Silva ')).toBe('joao-silva');
    expect(() => raterId('***')).toThrow();
  });

  it('entrega os itens sem nenhuma pista da abordagem', async () => {
    const body = await (await fetch(`${base}/api/eval/items`)).text();
    const { items: got } = JSON.parse(body);
    expect(got).toHaveLength(4);
    expect(got[0].trechos).toHaveLength(2);
    expect(body).not.toMatch(/B-rag|C-por-fonte|D-mcp|MCP|approach|abordagem/i);
    expect(Object.keys(got[0]).sort()).toEqual(['item', 'pergunta', 'resposta', 'resposta_referencia', 'trechos']);
  });

  it('grava as notas no formato da planilha cega, lido pelo eval:human', async () => {
    expect((await put('Ana', 'R001', { correcao: 5, completude: 4, sustentacao: 5, observacoes: 'ok; "bom"' })).status).toBe(200);
    const file = readFileSync(join(dir, 'avaliacoes-ui', 'ana.csv'), 'utf8');
    const ratings = parseRatings(file, key);
    expect(ratings.get('R001')).toEqual({ correcao: 5, completude: 4, sustentacao: 5 });
    expect(ratings.size).toBe(4);
    const back = await (await fetch(`${base}/api/eval/ratings/ana`)).json();
    expect(back.notas.R001).toEqual({ scores: { correcao: 5, completude: 4, sustentacao: 5 }, observacoes: 'ok; "bom"' });
  });

  it('recusa nota fora de 1 a 5 e item desconhecido', async () => {
    expect((await put('ana', 'R001', { correcao: 6 })).status).toBe(400);
    expect((await put('ana', 'R001', { correcao: 2.5 })).status).toBe(400);
    expect((await put('ana', 'R999', { correcao: 3 })).status).toBe(404);
  });

  it('calcula a concordância com 2 avaliadores, sem expor médias por abordagem', async () => {
    for (const id of ['R001', 'R002', 'R003', 'R004']) {
      const v = Number(id.at(-1));
      await put('ana', id, { correcao: v, completude: v, sustentacao: 5 - (v % 2) });
      await put('bruno', id, { correcao: v, completude: Math.min(5, v + 1), sustentacao: 5 - (v % 2) });
    }
    const a = await (await fetch(`${base}/api/eval/agreement`)).json();
    expect(a.avaliadores.map((r: { nome: string }) => r.nome)).toEqual(['ana', 'bruno']);
    expect(a.concordancia.correcao).toBe(1);
    expect(a.concordancia.completude).toBeLessThan(1);
    expect(JSON.stringify(a)).not.toMatch(/porAbordagem|B-rag|D-mcp/);
  });

  it('só entrega a página de avaliação', async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain('avaliar.js');
    expect((await fetch(`${base}/index.html`)).status).toBe(404);
    expect((await fetch(`${base}/api/ask`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/api/eval/ratings/ana/..%2F..%2Fx`, { method: 'PUT', body: '{}' })).status).toBe(404);
  });
});
