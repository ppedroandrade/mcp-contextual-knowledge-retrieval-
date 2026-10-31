import { normalize } from '../core/text.js';
import type { Hit } from '../core/types.js';
import { ABSTENTION, buildMessages, CONTEXT_UNITS } from './prompt.js';
import type { Completion, LlmProvider } from './provider.js';

export interface ParsedAnswer {
  /** Ids citados que estavam no contexto, na ordem da primeira citação. */
  citedUnitIds: string[];
  /** Ids citados que não estavam no contexto (citação inventada). */
  invalidCitations: string[];
  /** A resposta começa com "Não sei" ou traz a frase de abstenção do prompt. */
  abstained: boolean;
}

const ABSTENTION_NORMALIZED = normalize(ABSTENTION);

/** Lê as citações `[id]` (uma ou várias por colchete) e a abstenção de uma resposta. */
export function parseAnswer(text: string, contextIds: string[]): ParsedAnswer {
  const cited = [...new Set([...text.matchAll(/\[([^[\]]+)\]/g)]
    .flatMap((m) => m[1]!.split(/[\s,;]+/))
    .filter((t) => t.includes('#')))];
  const context = new Set(contextIds);
  const normalized = normalize(text.trim());
  return {
    citedUnitIds: cited.filter((id) => context.has(id)),
    invalidCitations: cited.filter((id) => !context.has(id)),
    abstained: /^\W*nao sei\b/.test(normalized) || normalized.includes(ABSTENTION_NORMALIZED),
  };
}

export interface GeneratedAnswer extends Completion, ParsedAnswer {
  /** Unidades entregues ao LLM, na ordem do prompt. */
  contextUnitIds: string[];
}

/** Gera a resposta a partir dos trechos recuperados. Único caminho de geração para B, C e D. */
export async function generateAnswer(provider: LlmProvider, question: string, hits: Hit[]): Promise<GeneratedAnswer> {
  const context = hits.slice(0, CONTEXT_UNITS);
  const contextUnitIds = context.map((h) => h.unitId);
  const completion = await provider.complete(buildMessages(question, context));
  return { ...completion, contextUnitIds, ...parseAnswer(completion.text, contextUnitIds) };
}
