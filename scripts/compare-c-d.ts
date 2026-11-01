import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationResult } from '../src/bench/generation.js';
import type { QuestionResult } from '../src/bench/retrieval.js';
import { medianOf as median, quantile } from '../src/evaluation/stats.js';

/**
 * Confere C × D numa execução gravada do bench (ADR 005): (a) o mesmo resultado em cada
 * pergunta (top-k e métricas em `bench:retrieval`; trechos e texto da resposta em
 * `bench:generation`); (b) diferença de latência D − C por pergunta, que deve ser só o
 * custo do protocolo. Mediana usual e quantis por interpolação linear (tipo 7), as mesmas
 * funções da estatística (`src/evaluation/stats.ts`, ADR 016). Até a correção do ADR 016,
 * posterior à execução final, este script usava o posto mais próximo, índice ⌊p·(n − 1)⌋, e o
 * maior dos dois valores centrais como mediana.
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
const ms = (x: number) => x.toFixed(2);

const differing = [...c].filter(([q, rc]) => outcome(rc) !== outcome(d.get(q)!)).map(([q]) => q);
const what = isGeneration(c.values().next().value!) ? 'trechos e resposta' : 'top-k e métricas';
console.log(`(a) perguntas com ${what} iguais em C e D: ${c.size - differing.length}/${c.size}`);
if (differing.length) console.log(`    diferentes: ${differing.join(', ')}`);

function latency(label: string, of: (r: Row) => number[]) {
  const deltas = [...c].map(([q, rc]) => median(of(d.get(q)!)) - median(of(rc)));
  const spread = [...c.values()].map((r) => quantile(of(r), 0.75) - quantile(of(r), 0.25));
  console.log(`(b) ${label}: D − C por pergunta (ms, mediana das rodadas): mín ${ms(quantile(deltas, 0))} · p25 ${ms(quantile(deltas, 0.25))} · mediana ${ms(median(deltas))} · p75 ${ms(quantile(deltas, 0.75))} · máx ${ms(quantile(deltas, 1))}`);
  console.log(`    perguntas com D mais lento que C: ${deltas.filter((x) => x > 0).length}/${deltas.length}`);
  console.log(`    ruído de C entre rodadas (IQR por pergunta, mediana): ${ms(median(spread))} ms`);
}

/** Custo do protocolo dentro de D: latência − maior tempo de busca das tools, por rodada (ADR 004). */
function protocolInsideD(of: (r: Row) => number[]) {
  const withTool = [...d.values()].filter((r) => r.toolMs?.length);
  if (!withTool.length) return console.log('(c) a execução não tem o tempo das tools de D (execuções anteriores ao ADR 009)');
  const perQuestion = withTool.map((r) => median(of(r).map((x, i) => x - r.toolMs![i]!)));
  console.log(`(c) D − tempo da tool (máx. das tools em paralelo), por pergunta (ms, mediana das rodadas): p25 ${ms(quantile(perQuestion, 0.25))} · mediana ${ms(median(perQuestion))} · p75 ${ms(quantile(perQuestion, 0.75))}`);
}

if (isGeneration(c.values().next().value!)) {
  latency('recuperação', (r) => (r as GenerationResult).retrievalMs);
  latency('recuperação + geração', (r) => (r as GenerationResult).totalMs);
  protocolInsideD((r) => (r as GenerationResult).retrievalMs);
} else {
  latency('recuperação', (r) => (r as QuestionResult).latencyMs);
  protocolInsideD((r) => (r as QuestionResult).latencyMs);
}
