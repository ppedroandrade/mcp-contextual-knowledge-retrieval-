import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Question, Retriever, SourceName } from '../core/types.js';
import { DATA_DIR, SEED } from '../corpus/generate.js';
import { Rng } from '../corpus/random.js';
import { mean, scoreRetrieval, type RetrievalScores } from '../evaluation/metrics.js';
import { loadSource } from '../sources/index.js';
import { environment } from './environment.js';
import { makeEmbedder, makeRetrievers, openStore, type EmbedderKind, type StoreKind } from './setup.js';

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
    const medians = rs.map((r) => [...r.latencyMs].sort((a, b) => a - b)[Math.floor(r.latencyMs.length / 2)] ?? NaN);
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
  const questions = JSON.parse(readFileSync(join(DATA_DIR, 'questions', `${values.set}.json`), 'utf8')) as Question[];
  const sources: SourceName[] = values.set === 'policies' ? ['docs', 'tickets', 'incidents', 'policies'] : ['docs', 'tickets', 'incidents'];
  const units = sources.flatMap((s) => loadSource(s));
  const vectorial = names.some((n) => n !== 'A');
  const embedder = vectorial ? makeEmbedder(values.embedder as EmbedderKind) : null;
  const store = embedder ? await openStore(values.store as StoreKind, embedder, units, sources) : null;
  const retrievers = makeRetrievers(names, units, embedder, store, sources);
  const results = await runRetrieval(retrievers, questions, Number(values.rounds));
  await store?.close();
  const summary = summarize(results);
  console.table(summary);
  if (values.out) {
    const dir = join(DATA_DIR, '..', 'results', 'runs', values.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'per-question.json'), JSON.stringify(results, null, 2) + '\n');
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    writeFileSync(join(dir, 'environment.json'), JSON.stringify(environment({ embedder: embedder ? await embedder.describe() : null, store: store ? values.store : null, approaches: names, set: values.set, rounds: Number(values.rounds), k: K, depth: SEARCH_DEPTH, sources, units: units.length }), null, 2) + '\n');
    console.log(`resultados em ${dir}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
