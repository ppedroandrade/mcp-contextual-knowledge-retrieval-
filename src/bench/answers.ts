import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../core/config.js';
import type { Question } from '../core/types.js';
import { DATA_DIR, SEED } from '../corpus/generate.js';
import type { Fact } from '../corpus/model.js';
import { Rng } from '../corpus/random.js';
import { cohenKappa, krippendorffAlpha } from '../evaluation/agreement.js';
import { checkFacts, type FactCheck } from '../evaluation/facts.js';
import { distinctItems, type EvalItem } from '../evaluation/items.js';
import { JUDGE_PROMPT_SHA256, judgeItem } from '../evaluation/judge.js';
import { mean } from '../evaluation/metrics.js';
import { CRITERIA, scoresByRule, type Scores } from '../evaluation/rubric.js';
import { OllamaChatProvider, type OllamaChatOptions } from '../generation/ollama.js';
import type { LlmProvider } from '../generation/provider.js';
import { loadSource } from '../sources/index.js';
import { environment, saveRun } from './environment.js';
import type { GenerationResult } from './generation.js';
import { loadQuestions, sourcesFor } from './setup.js';

export interface ItemEvaluation extends Omit<EvalItem, 'context'> {
  contextUnitIds: string[];
  rule: FactCheck;
  /** Notas brutas do juiz, uma por repetição; vazio quando a rubrica fixa todas as notas. */
  judge: Scores[];
  /** Notas finais: as que a rubrica fixa e, nos demais critérios, a 1ª repetição do juiz. */
  scores: Scores | null;
}

/** O prompt do juiz é maior que o do gerador (rubrica e referência) e a saída é curta. */
export const JUDGE_OPTIONS: OllamaChatOptions = { numCtx: 8192, numPredict: 128, seed: 42 };

const fixedByRule = (e: { type: string; abstained: boolean }) => CRITERIA.every((c) => scoresByRule(e)[c] !== undefined);

/** Nota final de um item: a que a rubrica fixa e, nos demais critérios, a 1ª repetição do juiz. */
export function finalScores(e: { type: string; abstained: boolean; judge: Scores[] }): Scores | null {
  const fixed = scoresByRule(e);
  if (fixedByRule(e)) return fixed as Scores;
  return e.judge[0] ? { ...e.judge[0], ...fixed } : null;
}

/**
 * Aplica a checagem por regra e a rubrica a cada resposta distinta (ADR 007). O juiz só é
 * chamado quando a rubrica não fixa todas as notas, salvo com `judgeAll` (calibração). A 1ª
 * repetição segue a ordem dos itens e dá a nota; as seguintes usam ordens embaralhadas,
 * porque na mesma ordem o juiz repete a sequência de pedidos e parece mais estável do que é.
 */
export async function evaluateAnswers(items: EvalItem[], questions: Question[], facts: Map<string, Fact>, judge: LlmProvider | null, repeats: number, { judgeAll = false, log = (_: string) => {} } = {}) {
  const factIds = new Map(questions.map((q) => [q.id, q.factIds]));
  const evals: ItemEvaluation[] = items.map(({ context, ...it }) => ({
    ...it,
    contextUnitIds: context.map((c) => c.unitId),
    rule: checkFacts(it.answer, factIds.get(it.questionId)!.map((id) => facts.get(id)!)),
    judge: [],
    scores: null,
  }));
  if (judge) {
    const indexes = items.map((_, i) => i);
    for (let r = 0; r < repeats; r++) {
      log(`juiz: repetição ${r + 1}/${repeats}`);
      for (const i of r === 0 ? indexes : new Rng(SEED + r).shuffle(indexes)) {
        if (judgeAll || !fixedByRule(items[i]!)) evals[i]!.judge.push(await judgeItem(judge, items[i]!));
      }
    }
  }
  for (const e of evals) e.scores = finalScores(e);
  return evals;
}

/** Acerto pela regra: sem resposta no corpus, abster-se; com resposta, todos os fatos literais. */
export const ruleCorrect = (e: ItemEvaluation) => (e.type === 'unanswerable' ? e.abstained : e.rule.literal === 1);

export function summarizeAnswers(evals: ItemEvaluation[]) {
  const approaches = [...new Set(evals.flatMap((e) => e.approaches))].sort();
  const scored = evals.every((e) => e.scores !== null);
  const judged = evals.filter((e) => e.judge.length > 0);
  const repeats = judged.length ? Math.min(...judged.map((e) => e.judge.length)) : 0;
  // Onde o juiz decide a correção: respostas afirmativas a perguntas com resposta no corpus.
  const affirmative = judged.filter((e) => e.type !== 'unanswerable' && !e.abstained);
  const rule = affirmative.map((e) => e.rule.literal === 1);
  const byJudge = affirmative.map((e) => e.judge[0]!.correcao >= 4);
  // Só com --judge-all: o juiz também nos casos que a rubrica fixa, para medir se ele a segue.
  const fixedJudged = judged.filter(fixedByRule);
  return {
    itens: evals.length,
    itensComJuiz: judged.length,
    porAbordagem: Object.fromEntries(approaches.map((a) => {
      const mine = evals.filter((e) => e.approaches.includes(a));
      const answerable = mine.filter((e) => e.type !== 'unanswerable');
      return [a, {
        perguntas: mine.length,
        regraFatosLiterais: mean(answerable.map((e) => e.rule.literal)),
        regraCoberturaTermos: mean(answerable.map((e) => e.rule.coverage)),
        regraAcerto: mine.filter(ruleCorrect).length / mine.length,
        ...(scored ? {
          rubricaAcerto: mine.filter((e) => e.scores!.correcao >= 4).length / mine.length,
          ...Object.fromEntries(CRITERIA.map((c) => [c, mean(mine.map((e) => e.scores![c]))])),
        } : {}),
      }];
    })),
    ...(affirmative.length ? {
      juizXRegra: {
        itens: affirmative.length,
        concordancia: rule.filter((x, i) => x === byJudge[i]).length / affirmative.length,
        kappa: cohenKappa(rule, byJudge),
        regraAcertaJuizNao: affirmative.filter((_, i) => rule[i] && !byJudge[i]).map((e) => e.key),
        regraErraJuizSim: affirmative.filter((_, i) => !rule[i] && byJudge[i]).map((e) => e.key),
      },
    } : {}),
    ...(fixedJudged.length ? {
      juizNosCasosFixos: {
        itens: fixedJudged.length,
        correcaoDivergente: fixedJudged.filter((e) => (e.judge[0]!.correcao >= 4) !== (scoresByRule(e).correcao! >= 4)).map((e) => e.key),
      },
    } : {}),
    ...(repeats > 1 ? {
      repetibilidade: {
        repeticoes: repeats,
        itensIdenticos: judged.filter((e) => e.judge.every((s) => JSON.stringify(s) === JSON.stringify(e.judge[0]))).length / judged.length,
        alfaOrdinal: Object.fromEntries(CRITERIA.map((c) => [c, krippendorffAlpha(
          Array.from({ length: repeats }, (_, r) => judged.map((e) => e.judge[r]![c])), 'ordinal')])),
      },
    } : {}),
  };
}

async function main() {
  // Lido na partida: o código que roda é o carregado agora, mesmo que a branch mude depois.
  const env = environment();
  const { values } = parseArgs({ options: {
    run: { type: 'string' },
    judge: { type: 'string', default: loadConfig().judgeModel },
    repeats: { type: 'string', default: '1' },
    'judge-all': { type: 'boolean', default: false },
    out: { type: 'string' },
  } });
  if (!values.run) throw new Error('informe a execução de bench:generation: --run <id>');
  const runDir = join(DATA_DIR, '..', 'results', 'runs', values.run);
  const results = JSON.parse(readFileSync(join(runDir, 'per-question.json'), 'utf8')) as GenerationResult[];
  const source = JSON.parse(readFileSync(join(runDir, 'environment.json'), 'utf8')) as { set: string; gitCommit: string; llm: { model?: string } };
  if (values.judge === source.llm.model) console.error(`aviso: o juiz é o próprio gerador (${values.judge})`);
  const questions = loadQuestions(source.set);
  const units = sourcesFor(source.set).flatMap((s) => loadSource(s));
  const facts = new Map((JSON.parse(readFileSync(join(DATA_DIR, 'corpus', 'facts.json'), 'utf8')) as Fact[]).map((f) => [f.id, f]));
  const items = distinctItems(results, questions, units);
  const judge = values.judge === 'none' ? null : new OllamaChatProvider(loadConfig().ollamaUrl, values.judge, JUDGE_OPTIONS);
  const repeats = Number(values.repeats);
  const evals = await evaluateAnswers(items, questions, facts, judge, repeats, { judgeAll: values['judge-all'], log: (m) => console.error(m) });
  const summary = summarizeAnswers(evals);
  console.table(summary.porAbordagem);
  for (const k of ['juizXRegra', 'juizNosCasosFixos', 'repetibilidade'] as const) {
    if (summary[k]) console.log(`${k}:`, JSON.stringify(summary[k], (_, v) => (Array.isArray(v) ? v.length : v)));
  }
  if (values.out) {
    const dir = saveRun(values.out, {
      'items.json': evals,
      'summary.json': summary,
      'environment.json': {
        ...env,
        generationRun: values.run, generationCommit: source.gitCommit, generator: source.llm,
        judge: judge ? await judge.describe() : null, judgePromptSha256: JUDGE_PROMPT_SHA256,
        repeats: judge ? repeats : 0, judgeAll: values['judge-all'], set: source.set, items: items.length,
      },
    });
    console.log(`resultados em ${dir}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
