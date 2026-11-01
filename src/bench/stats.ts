import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, SEED } from '../corpus/generate.js';
import { ALPHA, comparePaired, letter, perQuestion, type Comparison, type MeasureSpec } from '../evaluation/compare.js';
import { median } from '../evaluation/metrics.js';
import type { RetrievalScores } from '../evaluation/metrics.js';
import { CRITERIA } from '../evaluation/rubric.js';
import type { ItemEvaluation } from './answers.js';
import { ruleCorrect } from './answers.js';
import { environment } from './environment.js';
import type { GenerationResult } from './generation.js';
import type { QuestionResult } from './retrieval.js';

/**
 * Testes de hipótese sobre uma execução gravada (ADR 008): `npm run stats -- --run <id>`.
 * Reconhece o tipo da execução pelos arquivos: `bench:retrieval` (latência e métricas de
 * recuperação), `bench:generation` (latência com geração) ou `eval:answers` (notas das
 * respostas). Grava `estatistica.json` na pasta da execução e imprime a tabela.
 */

export const RESAMPLES = 10000;

/** Latência por pergunta: a mediana das rodadas medidas, como nos resumos do bench. */
const latency = (xs: number[]) => (xs.length ? median(xs) : NaN);

export function retrievalMeasures(rows: QuestionResult[]): MeasureSpec[] {
  const answerable = rows.filter((r) => r.type !== 'unanswerable');
  const quality = (key: keyof RetrievalScores, name: string): MeasureSpec => ({
    name, estimator: 'mean', better: 'higher',
    values: perQuestion(answerable, (r) => letter(r.retriever), (r) => r.questionId, (r) => r.scores[key]),
  });
  return [
    { name: 'latência da recuperação (ms)', estimator: 'median', better: 'lower', values: perQuestion(rows, (r) => letter(r.retriever), (r) => r.questionId, (r) => latency(r.latencyMs)) },
    quality('recall', 'R@5'),
    quality('mrr', 'MRR@5'),
    quality('ndcg', 'nDCG@5'),
    quality('evidenceRecall', 'ER@5'),
    quality('evidenceComplete', 'completas@5'),
  ];
}

export function generationMeasures(rows: GenerationResult[]): MeasureSpec[] {
  const by = (f: (r: GenerationResult) => number) => perQuestion(rows, (r) => letter(r.retriever), (r) => r.questionId, f);
  return [
    { name: 'latência da recuperação (ms)', estimator: 'median', better: 'lower', values: by((r) => latency(r.retrievalMs)) },
    { name: 'latência da recuperação + geração (ms)', estimator: 'median', better: 'lower', values: by((r) => latency(r.totalMs)) },
  ];
}

/** Um item avaliado vale para todas as configurações que deram a resposta (C e D, quando iguais). */
export function answerMeasures(items: ItemEvaluation[]): MeasureSpec[] {
  const rows = items.flatMap((e) => e.approaches.map((a) => ({ a: letter(a), e })));
  const by = (f: (e: ItemEvaluation) => number) => perQuestion(rows, (r) => r.a, (r) => r.e.questionId, (r) => f(r.e));
  const scored = items.every((e) => e.scores !== null);
  return [
    { name: 'acerto pela regra (0/1)', estimator: 'mean', better: 'higher', values: by((e) => Number(ruleCorrect(e))) },
    ...(scored ? [
      { name: 'acerto pela rubrica (correção ≥ 4, 0/1)', estimator: 'mean' as const, better: 'higher' as const, values: by((e) => Number(e.scores!.correcao >= 4)) },
      ...CRITERIA.map((c): MeasureSpec => ({ name: `${c} (1–5)`, estimator: 'mean', better: 'higher', values: by((e) => e.scores![c]) })),
    ] : []),
  ];
}

export function measuresForRun(dir: string): { kind: string; measures: MeasureSpec[] } {
  if (existsSync(join(dir, 'items.json'))) {
    return { kind: 'eval:answers', measures: answerMeasures(JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')) as ItemEvaluation[]) };
  }
  const rows = JSON.parse(readFileSync(join(dir, 'per-question.json'), 'utf8')) as (QuestionResult | GenerationResult)[];
  if (rows.length && 'answer' in rows[0]!) return { kind: 'bench:generation', measures: generationMeasures(rows as GenerationResult[]) };
  return { kind: 'bench:retrieval', measures: retrievalMeasures(rows as QuestionResult[]) };
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(1) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3));
const fmtP = (p: number) => (p < 0.001 ? '<0,001' : p.toFixed(3));

export function table(rows: Comparison[]) {
  return rows.map((r) => ({
    medida: r.measure, par: r.pair, n: r.n, estimador: r.estimator === 'median' ? 'mediana' : 'média',
    primeiro: fmt(r.first), segundo: fmt(r.second),
    diferenca: fmt(r.difference.estimate),
    ic95: `[${fmt(r.difference.low)}; ${fmt(r.difference.high)}]`,
    wilcoxonP: fmtP(r.wilcoxon.p), wilcoxonPHolm: fmtP(r.wilcoxon.pHolm), r: r.wilcoxon.rankBiserial.toFixed(2),
    mannWhitneyP: fmtP(r.mannWhitney.p), mannWhitneyPHolm: fmtP(r.mannWhitney.pHolm),
    leitura: r.reading,
  }));
}

async function main() {
  const env = environment();
  const { values } = parseArgs({ options: { run: { type: 'string' }, resamples: { type: 'string', default: String(RESAMPLES) } } });
  if (!values.run) throw new Error('informe a execução: npm run stats -- --run <id>');
  const dir = join(DATA_DIR, '..', 'results', 'runs', values.run);
  const sourceEnv = JSON.parse(readFileSync(join(dir, 'environment.json'), 'utf8')) as { gitCommit?: string; set?: string };
  const { kind, measures } = measuresForRun(dir);
  const opts = { resamples: Number(values.resamples), seed: SEED };
  const comparisons = measures.flatMap((m) => comparePaired(m, undefined, opts));
  console.table(table(comparisons));
  const out = {
    geradoEm: env.timestamp, gitCommit: env.gitCommit, gitDirty: env.gitDirty, node: env.node,
    execucao: values.run, tipo: kind, commitDaExecucao: sourceEnv.gitCommit ?? null, conjunto: sourceEnv.set ?? null,
    metodo: {
      teste: 'Wilcoxon pareado bilateral (exato se n ≤ 50 sem empates; normal com correção de empates, sem correção de continuidade); diferenças nulas descartadas',
      correcao: 'Holm, dentro de cada medida, sobre as comparações feitas',
      ic: `bootstrap percentil das diferenças por pergunta, ${opts.resamples} reamostragens, semente ${opts.seed}, 95%`,
      complementar: 'Mann-Whitney U bilateral, sem pareamento (TCC 1), com Holm na mesma família',
      alfa: ALPHA,
    },
    comparacoes: comparisons,
  };
  writeFileSync(join(dir, 'estatistica.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`estatística em ${join(dir, 'estatistica.json')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
