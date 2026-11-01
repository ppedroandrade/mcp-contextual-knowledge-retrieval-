import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ItemEvaluation } from '../src/bench/answers.js';
import { krippendorffAlpha } from '../src/evaluation/agreement.js';
import { CRITERIA } from '../src/evaluation/rubric.js';

/**
 * Compara as notas do juiz (1ª repetição) entre duas execuções gravadas de `eval:answers`,
 * nos itens que as duas avaliaram: mede se o juiz se repete entre execuções (ADR 007).
 *
 * Uso: npx tsx scripts/compare-judge-runs.ts <execução A> <execução B>
 */
const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('informe duas execuções: npx tsx scripts/compare-judge-runs.ts <A> <B>');
const load = (id: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'results', 'runs', id, 'items.json'), 'utf8')) as ItemEvaluation[];
const first = new Map(load(a).filter((e) => e.judge.length).map((e) => [e.key, e.judge[0]!]));
const common = load(b).filter((e) => e.judge.length && first.has(e.key)).map((e) => [first.get(e.key)!, e.judge[0]!] as const);
console.log(`itens avaliados nas duas: ${common.length}`);
console.log(`notas idênticas: ${common.filter(([x, y]) => JSON.stringify(x) === JSON.stringify(y)).length}/${common.length}`);
console.log(`mesma decisão de correção (≥ 4): ${common.filter(([x, y]) => (x.correcao >= 4) === (y.correcao >= 4)).length}/${common.length}`);
for (const c of CRITERIA) console.log(`alfa ordinal, ${c}: ${krippendorffAlpha([common.map(([x]) => x[c]), common.map(([, y]) => y[c])], 'ordinal').toFixed(3)}`);
