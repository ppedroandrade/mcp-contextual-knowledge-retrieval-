import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalScores, summarizeAnswers, type ItemEvaluation } from '../src/bench/answers.js';

/**
 * Recalcula, com o código atual, o resumo de uma execução gravada de `eval:answers` (útil
 * quando a regra de pontuação muda). Não altera os arquivos da execução.
 *
 * Uso: npx tsx scripts/summarize-answers.ts <id da execução em results/runs>
 */
const id = process.argv[2];
if (!id) throw new Error('informe o id da execução: npx tsx scripts/summarize-answers.ts <id>');
const items = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'results', 'runs', id, 'items.json'), 'utf8')) as ItemEvaluation[];
const summary = summarizeAnswers(items.map((e) => ({ ...e, scores: finalScores(e) })));
console.table(summary.porAbordagem);
for (const k of ['juizXRegra', 'juizNosCasosFixos', 'repetibilidade'] as const) {
  if (summary[k]) console.log(`${k}:`, JSON.stringify(summary[k], (_, v) => (Array.isArray(v) ? v.length : v)));
}
