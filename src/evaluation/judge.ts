import { createHash } from 'node:crypto';
import type { ChatMessage, LlmProvider } from '../generation/provider.js';
import { sourceInfo } from '../sources/catalog.js';
import type { EvalItem } from './items.js';
import { CRITERIA, RUBRIC_TEXT, type Scores } from './rubric.js';

/** Instruções fixas do juiz: a mesma rubrica dos avaliadores humanos. */
export const JUDGE_SYSTEM_PROMPT = [
  'Você avalia respostas de um assistente que responde perguntas sobre a documentação interna de uma empresa usando trechos recuperados.',
  'Compare a resposta com a resposta de referência e com os trechos entregues ao assistente e dê uma nota inteira de 1 a 5 para cada critério:',
  '',
  RUBRIC_TEXT,
  '',
  'Responda só com o JSON pedido.',
].join('\n');

/** Saída estruturada: uma nota inteira de 1 a 5 por critério. */
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(CRITERIA.map((c) => [c, { type: 'integer', enum: [1, 2, 3, 4, 5] }])),
  required: [...CRITERIA],
};

export function buildJudgeMessages(item: Pick<EvalItem, 'question' | 'referenceAnswer' | 'context' | 'answer'>): ChatMessage[] {
  const context = item.context.map((c) => `[${c.unitId}] (fonte: ${sourceInfo(c.source).title})\n${c.text}`).join('\n\n');
  return [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Pergunta: ${item.question}\n\nResposta de referência: ${item.referenceAnswer}\n\n`
        + `Trechos entregues ao assistente:\n\n${context}\n\nResposta a avaliar: ${item.answer}`,
    },
  ];
}

/** Impressão digital do prompt e do esquema do juiz, gravada em cada execução. */
export const JUDGE_PROMPT_SHA256 = createHash('sha256')
  .update(JSON.stringify([
    buildJudgeMessages({ question: '{pergunta}', referenceAnswer: '{referencia}', context: [{ unitId: '{id}', source: 'docs', text: '{texto}' }], answer: '{resposta}' }),
    JUDGE_SCHEMA,
  ]))
  .digest('hex');

/** Nota do juiz para um item. Falha se a saída não for o JSON com as três notas de 1 a 5. */
export async function judgeItem(llm: LlmProvider, item: EvalItem): Promise<Scores> {
  const { text } = await llm.complete(buildJudgeMessages(item), { format: JUDGE_SCHEMA });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`o juiz não devolveu JSON no item ${item.key}: ${text.slice(0, 200)}`);
  }
  return Object.fromEntries(CRITERIA.map((c) => {
    const v = parsed[c];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw new Error(`nota inválida do juiz para ${c} no item ${item.key}: ${JSON.stringify(v)}`);
    return [c, v];
  })) as Scores;
}
