import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, SEED } from '../corpus/generate.js';
import { ALPHA, comparePaired, letter, perQuestion, type Comparison, type MeasureSpec } from '../evaluation/compare.js';
import { median } from '../evaluation/metrics.js';
import type { RetrievalScores } from '../evaluation/metrics.js';
import { parseRatings, type BlindKey, type Ratings } from '../evaluation/human.js';
import { CRITERIA } from '../evaluation/rubric.js';
import type { ItemEvaluation } from './answers.js';
import { ruleCorrect } from './answers.js';
import { environment } from './environment.js';
import { loadQuestions } from './setup.js';
import type { PerQuestion } from '../evaluation/compare.js';
import type { GenerationResult } from './generation.js';
import type { QuestionResult } from './retrieval.js';

/**
 * Testes de hipótese sobre uma execução gravada (ADR 008): `npm run stats -- --run <id>`.
 * Reconhece o tipo da execução pelos arquivos: `bench:retrieval` (latência e métricas de
 * recuperação), `bench:generation` (latência com geração), `eval:answers` (notas das
 * respostas) ou a planilha cega de `eval:human` com as notas importadas (H2). Grava `estatistica.json` na pasta da execução e imprime a tabela.
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

/**
 * Notas humanas (H2): por pergunta e configuração, a média das notas dos avaliadores no item
 * que a configuração gerou (C e D, quando iguais, dividem o item). Item sem nota de ninguém
 * fica de fora do par (NaN).
 */
export function humanMeasures(key: BlindKey, raters: Ratings[]): MeasureSpec[] {
  const rows = Object.entries(key).flatMap(([id, k]) => k.approaches.map((a) => ({ id, a: letter(a), q: k.questionId })));
  const itemMean = (id: string, c: (typeof CRITERIA)[number]) => {
    const xs = raters.map((r) => r.get(id)?.[c]).filter((v): v is number => v !== undefined);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN;
  };
  return CRITERIA.map((c): MeasureSpec => ({
    name: `${c}, avaliação humana (1–5)`, estimator: 'mean', better: 'higher',
    values: perQuestion(rows, (r) => r.a, (r) => r.q, (r) => itemMean(r.id, c)),
  }));
}

export function measuresForRun(dir: string): { kind: string; measures: MeasureSpec[] } {
  if (existsSync(join(dir, 'chave.json'))) {
    const rated = join(dir, 'avaliacoes');
    const files = existsSync(rated) ? readdirSync(rated).filter((f) => f.endsWith('.csv')).sort() : [];
    if (!files.length) throw new Error('a planilha ainda não tem notas importadas: npm run eval:human -- --import <id> --ratings a.csv,b.csv');
    const key = JSON.parse(readFileSync(join(dir, 'chave.json'), 'utf8')) as BlindKey;
    return { kind: 'eval:human', measures: humanMeasures(key, files.map((f) => parseRatings(readFileSync(join(rated, f), 'utf8'), key))) };
  }
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

/** Mantém só as perguntas do subconjunto (ex.: as parafraseadas do heldout). */
export function restrict(measures: MeasureSpec[], keep: Set<string>): MeasureSpec[] {
  const cut = (v: PerQuestion): PerQuestion => new Map([...v].map(([a, m]) => [a, new Map([...m].filter(([q]) => keep.has(q)))]));
  return measures.map((m) => ({ ...m, values: cut(m.values) }));
}

async function main() {
  const env = environment();
  const { values } = parseArgs({ options: {
    run: { type: 'string' },
    resamples: { type: 'string', default: String(RESAMPLES) },
    // Análise por subgrupo, prevista antes da execução final: `literal` ou `parafraseada` (heldout).
    style: { type: 'string' },
  } });
  if (!values.run) throw new Error('informe a execução: npm run stats -- --run <id>');
  const dir = join(DATA_DIR, '..', 'results', 'runs', values.run);
  const sourceEnv = JSON.parse(readFileSync(join(dir, 'environment.json'), 'utf8')) as { gitCommit?: string; set?: string };
  const { kind, measures: all } = measuresForRun(dir);
  let measures = all;
  if (values.style) {
    if (!sourceEnv.set) throw new Error('a execução não registra o conjunto de perguntas');
    const keep = new Set(loadQuestions(sourceEnv.set).filter((q) => q.style === values.style).map((q) => q.id));
    if (keep.size === 0) throw new Error(`o conjunto ${sourceEnv.set} não tem perguntas com estilo ${values.style}`);
    measures = restrict(all, keep);
  }
  const opts = { resamples: Number(values.resamples), seed: SEED };
  const comparisons = measures.flatMap((m) => comparePaired(m, undefined, opts));
  console.table(table(comparisons));
  const out = {
    geradoEm: env.timestamp, gitCommit: env.gitCommit, gitDirty: env.gitDirty, node: env.node,
    execucao: values.run, tipo: kind, commitDaExecucao: sourceEnv.gitCommit ?? null, conjunto: sourceEnv.set ?? null, estilo: values.style ?? null,
    metodo: {
      teste: 'Wilcoxon pareado bilateral (exato se n ≤ 50 sem empates; normal com correção de empates, sem correção de continuidade); diferenças nulas descartadas',
      correcao: 'Holm, dentro de cada medida, sobre as comparações feitas',
      ic: `bootstrap percentil das diferenças por pergunta, ${opts.resamples} reamostragens, semente ${opts.seed}, 95%`,
      complementar: 'Mann-Whitney U bilateral, sem pareamento (TCC 1), com Holm na mesma família',
      alfa: ALPHA,
    },
    comparacoes: comparisons,
  };
  const file = values.style ? `estatistica-${values.style}.json` : 'estatistica.json';
  writeFileSync(join(dir, file), JSON.stringify(out, null, 2) + '\n');
  console.log(`estatística em ${join(dir, file)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
