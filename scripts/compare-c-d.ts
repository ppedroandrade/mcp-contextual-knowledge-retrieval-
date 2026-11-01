import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationResult } from '../src/bench/generation.js';
import type { QuestionResult } from '../src/bench/retrieval.js';

/**
 * Confere C × D numa execução gravada do bench (ADR 005): (a) o mesmo resultado em cada
 * pergunta (top-k e métricas em `bench:retrieval`; trechos e texto da resposta em
 * `bench:generation`); (b) diferença de latência D − C por pergunta, que deve ser só o
 * custo do protocolo. Quantis pelo posto mais próximo, índice ⌊p·(n − 1)⌋.
 *
 * Uso: npx tsx scripts/compare-c-d.ts <id da execução em results/runs>
 */
type Row = QuestionResult | GenerationResult;

const id = process.argv[2];
if (!id) throw new Error('informe o id da execução: npx tsx scripts/compare-c-d.ts <id>');
const results = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'results', 'runs', id, 'per-question.json'), 'utf8')) as Row[];

const byQuestion = (name: string) => new Map(results.filter((r) => r.retriever === name).map((r) => [r.questionId, r]));
const c = byQuestion('C-por-fonte');
const d = byQuestion('D-mcp');
if (c.size === 0 || d.size === 0 || c.size !== d.size) throw new Error(`a execução ${id} não tem C e D com as mesmas perguntas`);

const isGeneration = (r: Row): r is GenerationResult => 'answer' in r;
const outcome = (r: Row) => JSON.stringify(isGeneration(r) ? [r.answer.contextUnitIds, r.answer.text] : [r.topUnits, r.scores]);
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const quantile = (xs: number[], p: number) => sorted(xs)[Math.floor(p * (xs.length - 1))]!;
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]!;
const ms = (x: number) => x.toFixed(2);

const differing = [...c].filter(([q, rc]) => outcome(rc) !== outcome(d.get(q)!)).map(([q]) => q);
const what = isGeneration(c.values().next().value!) ? 'trechos e resposta' : 'top-k e métricas';
console.log(`(a) perguntas com ${what} iguais em C e D: ${c.size - differing.length}/${c.size}`);
if (differing.length) console.log(`    diferentes: ${differing.join(', ')}`);

function latency(label: string, of: (r: Row) => number[]) {
  const deltas = [...c].map(([q, rc]) => median(of(d.get(q)!)) - median(of(rc)));
  const spread = [...c.values()].map((r) => quantile(of(r), 0.75) - quantile(of(r), 0.25));
  console.log(`(b) ${label}: D − C por pergunta (ms, mediana das rodadas): mín ${ms(quantile(deltas, 0))} · p25 ${ms(quantile(deltas, 0.25))} · mediana ${ms(quantile(deltas, 0.5))} · p75 ${ms(quantile(deltas, 0.75))} · máx ${ms(quantile(deltas, 1))}`);
  console.log(`    perguntas com D mais lento que C: ${deltas.filter((x) => x > 0).length}/${deltas.length}`);
  console.log(`    ruído de C entre rodadas (IQR por pergunta, mediana): ${ms(median(spread))} ms`);
}

if (isGeneration(c.values().next().value!)) {
  latency('recuperação', (r) => (r as GenerationResult).retrievalMs);
  latency('recuperação + geração', (r) => (r as GenerationResult).totalMs);
} else {
  latency('recuperação', (r) => (r as QuestionResult).latencyMs);
}
