import { parseArgs } from 'node:util';
import type { Question, Retriever } from '../core/types.js';
import { SEED } from '../corpus/generate.js';
import { Rng } from '../corpus/random.js';
import { mean, median, scoreRetrieval, type RetrievalScores } from '../evaluation/metrics.js';
import { loadSource } from '../sources/index.js';
import { environment, saveRun } from './environment.js';
import { loadQuestions, makeEmbedder, makeRetrievers, openStore, sourcesFor, type EmbedderKind, type StoreKind } from './setup.js';

/** Unidades buscadas por pergunta: profundidade suficiente para deduplicar por documento. */
export const SEARCH_DEPTH = 50;
export const K = 5;

export interface QuestionResult {
  questionId: string;
  type: Question['type'];
  retriever: string;
  topUnits: string[];
  scores: RetrievalScores;
  latencyMs: number[];
}

/**
 * Executa as abordagens sobre as perguntas. A qualidade é medida uma vez (as abordagens
 * são determinísticas); a latência é medida em `rounds` rodadas após uma rodada de
 * aquecimento descartada, com a ordem das abordagens embaralhada a cada rodada.
 */
export async function runRetrieval(retrievers: Retriever[], questions: Question[], rounds: number, seed = SEED) {
  const rng = new Rng(seed);
  const results = new Map<string, QuestionResult>();
  for (const r of retrievers) {
    for (const q of questions) {
      const hits = await r.search(q.text, SEARCH_DEPTH);
      results.set(`${r.name}|${q.id}`, {
        questionId: q.id, type: q.type, retriever: r.name,
        topUnits: hits.slice(0, K).map((h) => h.unitId),
        scores: scoreRetrieval(q, hits, K),
        latencyMs: [],
      });
    }
  }
  for (let round = 0; round <= rounds; round++) {
    for (const r of rng.shuffle(retrievers)) {
      for (const q of questions) {
        const t0 = performance.now();
        await r.search(q.text, SEARCH_DEPTH);
        const dt = performance.now() - t0;
        if (round > 0) results.get(`${r.name}|${q.id}`)!.latencyMs.push(dt);
      }
    }
  }
  return [...results.values()];
}

export function summarize(results: QuestionResult[]) {
  const byRetriever = Map.groupBy(results, (r) => r.retriever);
  return Object.fromEntries([...byRetriever].map(([name, rs]) => {
    const answerable = rs.filter((r) => r.type !== 'unanswerable');
    const m = (key: keyof RetrievalScores, filter: (r: QuestionResult) => boolean = () => true) =>
      mean(answerable.filter(filter).map((r) => r.scores[key]));
    const medians = rs.map((r) => median(r.latencyMs));
    return [name, {
      questions: answerable.length,
      [`P@${K}`]: m('precision'),
      [`R@${K}`]: m('recall'),
      [`MRR@${K}`]: m('mrr'),
      [`nDCG@${K}`]: m('ndcg'),
      [`ER@${K}`]: m('evidenceRecall'),
      [`ER@${K} multifonte`]: m('evidenceRecall', (r) => r.type === 'multi-source'),
      [`completas@${K}`]: m('evidenceComplete'),
      latenciaMedianaMs: mean(medians),
    }];
  }));
}

async function main() {
  const { values } = parseArgs({ options: {
    set: { type: 'string', default: 'dev' },
    rounds: { type: 'string', default: '5' },
    out: { type: 'string' },
    approaches: { type: 'string', default: 'A' },
    embedder: { type: 'string', default: 'ollama' },
    store: { type: 'string', default: 'pg' },
  } });
  const names = values.approaches.split(',');
  const questions = loadQuestions(values.set);
  const sources = sourcesFor(values.set);
  const units = sources.flatMap((s) => loadSource(s));
  const embedderKind = values.embedder as EmbedderKind;
  const storeKind = values.store as StoreKind;
  const inProcess = names.some((n) => n === 'B' || n === 'C');
  const embedder = inProcess || names.includes('D') ? makeEmbedder(embedderKind) : null;
  const store = inProcess && embedder ? await openStore(storeKind, embedder, units, sources) : null;
  const retrievers = await makeRetrievers(names, { units, sources, embedder, store, embedderKind, storeKind });
  const results = await runRetrieval(retrievers, questions, Number(values.rounds));
  for (const r of retrievers) await r.close?.();
  await store?.close();
  const summary = summarize(results);
  console.table(summary);
  if (values.out) {
    const dir = saveRun(values.out, {
      'per-question.json': results,
      'summary.json': summary,
      'environment.json': environment({ embedder: embedder ? await embedder.describe() : null, store: store ? values.store : null, approaches: names, set: values.set, rounds: Number(values.rounds), k: K, depth: SEARCH_DEPTH, sources, units: units.length }),
    });
    console.log(`resultados em ${dir}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
