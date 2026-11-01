import { createHash } from 'node:crypto';
import type { EvidenceUnit, Question, QuestionType, SourceName } from '../core/types.js';
import { indexText } from '../approaches/units.js';

/** O que a avaliação precisa de cada resposta gerada (ver `GenerationResult`). */
export interface AnsweredQuestion {
  questionId: string;
  retriever: string;
  answer: { contextUnitIds: string[]; text: string; abstained: boolean };
}

/** Uma resposta distinta a avaliar: a nota vale para todas as abordagens que a deram. */
export interface EvalItem {
  /** Id estável, derivado da pergunta, dos trechos e do texto da resposta. */
  key: string;
  questionId: string;
  type: QuestionType;
  approaches: string[];
  question: string;
  referenceAnswer: string;
  context: { unitId: string; source: SourceName; text: string }[];
  answer: string;
  abstained: boolean;
}

/**
 * Junta respostas idênticas (mesma pergunta, mesmos trechos e mesmo texto) num item só.
 * C e D dão a mesma resposta; duas linhas iguais revelariam ao avaliador quais são do MCP.
 * Os trechos fazem parte da chave porque a sustentação depende deles.
 */
export function distinctItems(results: AnsweredQuestion[], questions: Question[], units: EvidenceUnit[]): EvalItem[] {
  const question = new Map(questions.map((q) => [q.id, q]));
  const unit = new Map(units.map((u) => [u.id, u]));
  const items = new Map<string, EvalItem>();
  for (const r of results) {
    const key = createHash('sha256')
      .update(JSON.stringify([r.questionId, r.answer.contextUnitIds, r.answer.text]))
      .digest('hex')
      .slice(0, 12);
    const existing = items.get(key);
    if (existing) { existing.approaches.push(r.retriever); continue; }
    const q = question.get(r.questionId);
    if (!q) throw new Error(`pergunta ${r.questionId} não está no conjunto`);
    items.set(key, {
      key, questionId: q.id, type: q.type, approaches: [r.retriever],
      question: q.text, referenceAnswer: q.referenceAnswer,
      context: r.answer.contextUnitIds.map((id) => {
        const u = unit.get(id);
        if (!u) throw new Error(`unidade ${id} não está no corpus`);
        return { unitId: id, source: u.source, text: indexText(u) };
      }),
      answer: r.answer.text, abstained: r.answer.abstained,
    });
  }
  return [...items.values()]
    .map((it) => ({ ...it, approaches: it.approaches.sort() }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId) || a.approaches[0]!.localeCompare(b.approaches[0]!));
}
