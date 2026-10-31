import { parseArgs } from 'node:util';
import type { Question, Retriever } from '../core/types.js';
import { SEED } from '../corpus/generate.js';
import { Rng } from '../corpus/random.js';
import { mean, median } from '../evaluation/metrics.js';
import { generateAnswer, type GeneratedAnswer } from '../generation/answer.js';
import { CONTEXT_UNITS, PROMPT_SHA256 } from '../generation/prompt.js';
import type { LlmProvider } from '../generation/provider.js';
import { loadSource } from '../sources/index.js';
import { environment, saveRun } from './environment.js';
import { loadQuestions, makeEmbedder, makeLlm, makeRetrievers, openStore, sourcesFor, type EmbedderKind, type LlmKind, type StoreKind } from './setup.js';

export interface GenerationResult {
  questionId: string;
  type: Question['type'];
  retriever: string;
  /** Resposta da rodada de aquecimento, que é a avaliada. */
  answer: GeneratedAnswer;
  /** Rodadas medidas em que a resposta diferiu da avaliada (com temperatura 0, espera-se 0). */
  changedAnswers: number;
  /** Só a recuperação dos trechos, por rodada medida (ms). */
  retrievalMs: number[];
  /** Recuperação + geração, por rodada medida (ms). */
  totalMs: number[];
  /** Carga do modelo informada pelo provedor, por rodada medida (ms); alta indica recarga. */
  loadMs: (number | null)[];
}

/**
 * Recupera os trechos e gera a resposta de cada pergunta, medindo a recuperação e a
 * recuperação + geração na mesma chamada (ADR 006). A rodada 0 é o aquecimento: a resposta
 * dela é a avaliada e a latência é descartada. A ordem das abordagens é embaralhada a cada
 * rodada.
 */
export async function runGeneration(retrievers: Retriever[], questions: Question[], llm: LlmProvider, rounds: number, seed = SEED, log: (msg: string) => void = () => {}) {
  const rng = new Rng(seed);
  const results = new Map<string, GenerationResult>();
  for (let round = 0; round <= rounds; round++) {
    for (const r of rng.shuffle(retrievers)) {
      log(`rodada ${round}/${rounds}${round === 0 ? ' (aquecimento)' : ''}: ${r.name}`);
      for (const q of questions) {
        const t0 = performance.now();
        const hits = await r.search(q.text, CONTEXT_UNITS);
        const t1 = performance.now();
        const answer = await generateAnswer(llm, q.text, hits);
        const t2 = performance.now();
        const key = `${r.name}|${q.id}`;
        if (round === 0) {
          results.set(key, { questionId: q.id, type: q.type, retriever: r.name, answer, changedAnswers: 0, retrievalMs: [], totalMs: [], loadMs: [] });
          continue;
        }
        const res = results.get(key)!;
        res.retrievalMs.push(t1 - t0);
        res.totalMs.push(t2 - t0);
        res.loadMs.push(answer.loadMs);
        if (answer.text !== res.answer.text) res.changedAnswers++;
      }
    }
  }
  return [...results.values()];
}

/**
 * Conformidade com o prompt e latência por abordagem. Abstenção = a resposta começa com
 * "Não sei". A correção das respostas fica para a etapa de avaliação.
 */
export function summarizeGeneration(results: GenerationResult[]) {
  const byRetriever = Map.groupBy(results, (r) => r.retriever);
  return Object.fromEntries([...byRetriever].map(([name, rs]) => {
    const frac = (xs: GenerationResult[], f: (r: GenerationResult) => boolean) => (xs.length ? xs.filter(f).length / xs.length : NaN);
    const unanswerable = rs.filter((r) => r.type === 'unanswerable');
    const answerable = rs.filter((r) => r.type !== 'unanswerable');
    const loads = rs.flatMap((r) => r.loadMs).filter((x): x is number => x !== null);
    return [name, {
      perguntas: rs.length,
      abstencaoCorreta: frac(unanswerable, (r) => r.answer.abstained),
      abstencaoIndevida: frac(answerable, (r) => r.answer.abstained),
      citamTrecho: frac(rs.filter((r) => !r.answer.abstained), (r) => r.answer.citedUnitIds.length > 0),
      citacaoInvalida: frac(rs, (r) => r.answer.invalidCitations.length > 0),
      truncadas: rs.filter((r) => r.answer.truncated).length,
      respostasQueVariaram: rs.filter((r) => r.changedAnswers > 0).length,
      tokensRespostaMedio: mean(rs.map((r) => r.answer.outputTokens ?? NaN)),
      latenciaRecuperacaoMs: mean(rs.map((r) => median(r.retrievalMs))),
      latenciaTotalMs: mean(rs.map((r) => median(r.totalMs))),
      cargaMaximaMs: loads.length ? Math.max(...loads) : null,
    }];
  }));
}

async function main() {
  // Lido na partida: o código que roda é o carregado agora, mesmo que a branch mude depois.
  const env = environment();
  const { values } = parseArgs({ options: {
    set: { type: 'string', default: 'dev' },
    rounds: { type: 'string', default: '5' },
    out: { type: 'string' },
    approaches: { type: 'string', default: 'B,C,D' },
    embedder: { type: 'string', default: 'ollama' },
    store: { type: 'string', default: 'pg' },
    llm: { type: 'string', default: 'ollama' },
    model: { type: 'string' },
  } });
  const names = values.approaches.split(',');
  if (names.includes('A')) throw new Error('a abordagem A (busca textual) não gera resposta; ela fica só em bench:retrieval (ADR 005)');
  const questions = loadQuestions(values.set);
  const sources = sourcesFor(values.set);
  const units = sources.flatMap((s) => loadSource(s));
  const embedderKind = values.embedder as EmbedderKind;
  const storeKind = values.store as StoreKind;
  const embedder = makeEmbedder(embedderKind);
  const store = names.some((n) => n === 'B' || n === 'C') ? await openStore(storeKind, embedder, units, sources) : null;
  const retrievers = await makeRetrievers(names, { units, sources, embedder, store, embedderKind, storeKind });
  const llm = makeLlm(values.llm as LlmKind, values.model);
  const results = await runGeneration(retrievers, questions, llm, Number(values.rounds), SEED, (m) => console.error(m));
  for (const r of retrievers) await r.close?.();
  await store?.close();
  const summary = summarizeGeneration(results);
  console.table(summary);
  if (values.out) {
    const dir = saveRun(values.out, {
      'per-question.json': results,
      'summary.json': summary,
      'environment.json': {
        ...env,
        embedder: await embedder.describe(), llm: await llm.describe(),
        prompt: { sha256: PROMPT_SHA256, contextUnits: CONTEXT_UNITS },
        store: values.store, approaches: names, set: values.set, rounds: Number(values.rounds), sources, units: units.length,
      },
    });
    console.log(`resultados em ${dir}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
