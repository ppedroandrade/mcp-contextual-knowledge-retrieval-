import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../core/config.js';
import type { Question } from '../core/types.js';
import { DATA_DIR } from '../corpus/generate.js';
import type { Fact } from '../corpus/model.js';
import { cohenKappa, krippendorffAlpha } from '../evaluation/agreement.js';
import { checkFacts, type FactCheck } from '../evaluation/facts.js';
import { distinctItems, type EvalItem } from '../evaluation/items.js';
import { JUDGE_PROMPT_SHA256, judgeItem } from '../evaluation/judge.js';
import { mean } from '../evaluation/metrics.js';
import { CRITERIA, type Scores } from '../evaluation/rubric.js';
import { OllamaChatProvider, type OllamaChatOptions } from '../generation/ollama.js';
import type { LlmProvider } from '../generation/provider.js';
import { loadSource } from '../sources/index.js';
import { environment, saveRun } from './environment.js';
import type { GenerationResult } from './generation.js';
import { loadQuestions, sourcesFor } from './setup.js';

export interface ItemEvaluation extends Omit<EvalItem, 'context'> {
  contextUnitIds: string[];
  rule: FactCheck;
  /** Notas do juiz, uma por repetição (vazio sem juiz). */
  judge: Scores[];
}

/** O prompt do juiz é maior que o do gerador (rubrica e referência) e a saída é curta. */
export const JUDGE_OPTIONS: OllamaChatOptions = { numCtx: 8192, numPredict: 128, seed: 42 };

/**
 * Aplica a checagem por regra e o juiz a cada resposta distinta. As repetições do juiz
 * percorrem todos os itens em sequência, para medir se ele repete as notas (ADR 007).
 */
export async function evaluateAnswers(items: EvalItem[], questions: Question[], facts: Map<string, Fact>, judge: LlmProvider | null, repeats: number, log: (msg: string) => void = () => {}) {
  const factIds = new Map(questions.map((q) => [q.id, q.factIds]));
  const evals: ItemEvaluation[] = items.map(({ context, ...it }) => ({
    ...it,
    contextUnitIds: context.map((c) => c.unitId),
    rule: checkFacts(it.answer, factIds.get(it.questionId)!.map((id) => facts.get(id)!)),
    judge: [],
  }));
  if (!judge) return evals;
  for (let r = 0; r < repeats; r++) {
    log(`juiz: repetição ${r + 1}/${repeats}`);
    for (let i = 0; i < items.length; i++) evals[i]!.judge.push(await judgeItem(judge, items[i]!));
  }
  return evals;
}

/** Acerto pela regra: sem resposta no corpus, abster-se; com resposta, todos os fatos literais. */
export const ruleCorrect = (e: ItemEvaluation) => (e.type === 'unanswerable' ? e.abstained : e.rule.literal === 1);
/** Acerto pelo juiz: correção 4 ou 5. */
export const judgeCorrect = (s: Scores) => s.correcao >= 4;

export function summarizeAnswers(evals: ItemEvaluation[]) {
  const approaches = [...new Set(evals.flatMap((e) => e.approaches))].sort();
  const judged = evals.filter((e) => e.judge.length > 0);
  const repeats = judged.length ? Math.min(...judged.map((e) => e.judge.length)) : 0;
  const rule = judged.map(ruleCorrect);
  const byJudge = judged.map((e) => judgeCorrect(e.judge[0]!));
  return {
    itens: evals.length,
    porAbordagem: Object.fromEntries(approaches.map((a) => {
      const mine = evals.filter((e) => e.approaches.includes(a));
      const answerable = mine.filter((e) => e.type !== 'unanswerable');
      return [a, {
        perguntas: mine.length,
        regraFatosLiterais: mean(answerable.map((e) => e.rule.literal)),
        regraCoberturaTermos: mean(answerable.map((e) => e.rule.coverage)),
        regraAcerto: mine.filter(ruleCorrect).length / mine.length,
        ...(repeats ? {
          juizAcerto: mine.filter((e) => judgeCorrect(e.judge[0]!)).length / mine.length,
          ...Object.fromEntries(CRITERIA.map((c) => [`juiz_${c}`, mean(mine.map((e) => e.judge[0]![c]))])),
        } : {}),
      }];
    })),
    ...(repeats ? {
      juizXRegra: {
        concordancia: rule.filter((x, i) => x === byJudge[i]).length / judged.length,
        kappa: cohenKappa(rule, byJudge),
        regraAcertaJuizNao: judged.filter((_, i) => rule[i] && !byJudge[i]).map((e) => e.key),
        regraErraJuizSim: judged.filter((_, i) => !rule[i] && byJudge[i]).map((e) => e.key),
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
    judge: { type: 'string' },
    repeats: { type: 'string', default: '1' },
    out: { type: 'string' },
  } });
  if (!values.run) throw new Error('informe a execução de bench:generation: --run <id>');
  const runDir = join(DATA_DIR, '..', 'results', 'runs', values.run);
  const results = JSON.parse(readFileSync(join(runDir, 'per-question.json'), 'utf8')) as GenerationResult[];
  const source = JSON.parse(readFileSync(join(runDir, 'environment.json'), 'utf8')) as { set: string; gitCommit: string; llm: unknown };
  const questions = loadQuestions(source.set);
  const units = sourcesFor(source.set).flatMap((s) => loadSource(s));
  const facts = new Map((JSON.parse(readFileSync(join(DATA_DIR, 'corpus', 'facts.json'), 'utf8')) as Fact[]).map((f) => [f.id, f]));
  const items = distinctItems(results, questions, units);
  const judge = values.judge ? new OllamaChatProvider(loadConfig().ollamaUrl, values.judge, JUDGE_OPTIONS) : null;
  const repeats = Number(values.repeats);
  const evals = await evaluateAnswers(items, questions, facts, judge, repeats, (m) => console.error(m));
  const summary = summarizeAnswers(evals);
  console.table(summary.porAbordagem);
  const { repetibilidade, juizXRegra } = summary;
  if (repetibilidade) console.log('repetibilidade do juiz:', JSON.stringify(repetibilidade));
  if (juizXRegra) console.log('juiz × regra:', JSON.stringify({ ...juizXRegra, regraAcertaJuizNao: juizXRegra.regraAcertaJuizNao.length, regraErraJuizSim: juizXRegra.regraErraJuizSim.length }));
  if (values.out) {
    const dir = saveRun(values.out, {
      'items.json': evals,
      'summary.json': summary,
      'environment.json': {
        ...env,
        generationRun: values.run, generationCommit: source.gitCommit, generator: source.llm,
        judge: judge ? await judge.describe() : null, judgePromptSha256: JUDGE_PROMPT_SHA256,
        repeats: judge ? repeats : 0, set: source.set, items: items.length,
      },
    });
    console.log(`resultados em ${dir}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
