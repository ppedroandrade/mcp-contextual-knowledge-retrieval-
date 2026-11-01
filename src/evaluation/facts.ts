import { tokenize } from '../core/text.js';
import type { Fact } from '../corpus/model.js';

/**
 * Valor do fato como uma resposta o diria: sem o rótulo de campo que o precede no corpus
 * ("Serviço afetado: payments-adapter" → "payments-adapter").
 */
export function factAnswerValue(value: string): string {
  return value.replace(/^[^:]{2,40}: /, '');
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) return true;
  }
  return false;
}

export interface FactCheck {
  /** Fração dos fatos cujos termos aparecem em sequência na resposta. */
  literal: number;
  /** Média, por fato, da fração dos termos do fato que aparecem em qualquer lugar da resposta. */
  coverage: number;
}

/**
 * Checagem por regra, determinística: os fatos de que a pergunta depende aparecem na
 * resposta? Usa a normalização da busca (minúsculas, sem acentos e sem palavras vazias).
 * Sem fatos (pergunta sem resposta no corpus), devolve NaN.
 */
export function checkFacts(answer: string, facts: Fact[]): FactCheck {
  if (facts.length === 0) return { literal: NaN, coverage: NaN };
  const tokens = tokenize(answer);
  const present = new Set(tokens);
  const checks = facts.map((f) => {
    const terms = tokenize(factAnswerValue(f.value));
    if (terms.length === 0) throw new Error(`o fato ${f.id} não tem termos para conferir`);
    return { literal: containsSequence(tokens, terms), coverage: terms.filter((t) => present.has(t)).length / terms.length };
  });
  return {
    literal: checks.filter((c) => c.literal).length / checks.length,
    coverage: checks.reduce((s, c) => s + c.coverage, 0) / checks.length,
  };
}
