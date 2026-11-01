import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ItemEvaluation } from '../src/bench/answers.js';
import { krippendorffAlpha } from '../src/evaluation/agreement.js';
import { parseRatings, type BlindKey, type Ratings } from '../src/evaluation/human.js';
import { CRITERIA, type Criterion } from '../src/evaluation/rubric.js';

/**
 * Concordância entre a avaliação humana (planilha cega importada) e o juiz automático, item a
 * item, nas mesmas respostas. Serve para validar o juiz e, quando a avaliação humana é uma só
 * (por exemplo, consenso de um painel), substitui o alfa entre avaliadores, que não existe.
 *
 * Uso: npx tsx scripts/humano-x-juiz.ts <planilha> <eval:answers>
 * Grava `humano-x-juiz.json` na pasta da planilha.
 *
 * Duas leituras: (a) todos os itens, com as notas finais do juiz (inclusive as que a rubrica
 * fixa por regra, como "não sei" em pergunta sem resposta); (b) só os itens em que o juiz deu
 * nota de fato, que é a comparação justa da qualidade do juiz.
 */

export interface Agreement { itens: number; alfaOrdinal: number; notasIguais: number; diferencaMedia: number }

export function compare(human: Ratings, key: BlindKey, evals: ItemEvaluation[], onlyJudged: boolean): Record<Criterion, Agreement> {
  const byKey = new Map(evals.map((e) => [e.key, e]));
  const pairs = Object.entries(key).flatMap(([id, k]) => {
    const e = byKey.get(k.key);
    const h = human.get(id);
    if (!e?.scores || !h) return [];
    if (onlyJudged && e.judge.length === 0) return [];
    return [{ h, j: e.scores }];
  });
  return Object.fromEntries(CRITERIA.map((c) => {
    const ok = pairs.filter((p) => p.h[c] !== undefined);
    const hs = ok.map((p) => p.h[c]!);
    const js = ok.map((p) => p.j[c]);
    return [c, {
      itens: ok.length,
      alfaOrdinal: krippendorffAlpha([hs, js], 'ordinal'),
      notasIguais: ok.length ? hs.filter((v, i) => v === js[i]).length / ok.length : NaN,
      diferencaMedia: ok.length ? hs.reduce((s, v, i) => s + (v - js[i]!), 0) / ok.length : NaN,
    }];
  })) as Record<Criterion, Agreement>;
}

function main() {
  const [sheet, answers] = process.argv.slice(2);
  if (!sheet || !answers) throw new Error('uso: npx tsx scripts/humano-x-juiz.ts <planilha> <eval:answers>');
  const runs = join(import.meta.dirname, '..', 'results', 'runs');
  const key = JSON.parse(readFileSync(join(runs, sheet, 'chave.json'), 'utf8')) as BlindKey;
  const evals = JSON.parse(readFileSync(join(runs, answers, 'items.json'), 'utf8')) as ItemEvaluation[];
  const files = readdirSync(join(runs, sheet, 'avaliacoes')).filter((f) => f.endsWith('.csv')).sort();
  if (files.length !== 1) throw new Error(`esperava 1 planilha importada em avaliacoes/ (há ${files.length}); com várias, compare cada uma separadamente`);
  const human = parseRatings(readFileSync(join(runs, sheet, 'avaliacoes', files[0]!), 'utf8'), key);
  const out = {
    planilha: sheet, avaliacaoAutomatica: answers, avaliacaoHumana: files[0],
    todosOsItens: compare(human, key, evals, false),
    soItensComNotaDoJuiz: compare(human, key, evals, true),
    nota: 'diferencaMedia = humano − juiz; alfa de Krippendorff ordinal entre as duas fontes de nota',
  };
  writeFileSync(join(runs, sheet, 'humano-x-juiz.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
