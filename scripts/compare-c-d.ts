import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QuestionResult } from '../src/bench/retrieval.js';

/**
 * Confere C × D numa execução gravada do bench (ADR 005): (a) top-k e métricas iguais em
 * cada pergunta; (b) diferença de latência D − C por pergunta, que deve ser só o custo do
 * protocolo. Quantis pelo posto mais próximo, índice ⌊p·(n − 1)⌋.
 *
 * Uso: npx tsx scripts/compare-c-d.ts <id da execução em results/runs>
 */
const id = process.argv[2];
if (!id) throw new Error('informe o id da execução: npx tsx scripts/compare-c-d.ts <id>');
const results = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'results', 'runs', id, 'per-question.json'), 'utf8')) as QuestionResult[];

const byQuestion = (name: string) => new Map(results.filter((r) => r.retriever === name).map((r) => [r.questionId, r]));
const c = byQuestion('C-por-fonte');
const d = byQuestion('D-mcp');
if (c.size === 0 || d.size === 0 || c.size !== d.size) throw new Error(`a execução ${id} não tem C e D com as mesmas perguntas`);

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const quantile = (xs: number[], p: number) => sorted(xs)[Math.floor(p * (xs.length - 1))]!;
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]!;
const ms = (x: number) => x.toFixed(2);

const differing = [...c].filter(([q, rc]) => {
  const rd = d.get(q)!;
  return JSON.stringify(rc.topUnits) !== JSON.stringify(rd.topUnits) || JSON.stringify(rc.scores) !== JSON.stringify(rd.scores);
}).map(([q]) => q);
console.log(`(a) perguntas com top-k e métricas iguais em C e D: ${c.size - differing.length}/${c.size}`);
if (differing.length) console.log(`    diferentes: ${differing.join(', ')}`);

const deltas = [...c].map(([q, rc]) => median(d.get(q)!.latencyMs) - median(rc.latencyMs));
const spread = [...c.values()].map((r) => quantile(r.latencyMs, 0.75) - quantile(r.latencyMs, 0.25));
console.log(`(b) D − C por pergunta (ms, mediana das rodadas): mín ${ms(quantile(deltas, 0))} · p25 ${ms(quantile(deltas, 0.25))} · mediana ${ms(quantile(deltas, 0.5))} · p75 ${ms(quantile(deltas, 0.75))} · máx ${ms(quantile(deltas, 1))}`);
console.log(`    perguntas com D mais lento que C: ${deltas.filter((x) => x > 0).length}/${deltas.length}`);
console.log(`    ruído de C entre rodadas (IQR por pergunta, mediana): ${ms(median(spread))} ms`);
