import { createHash } from 'node:crypto';
import type { Hit } from '../core/types.js';
import { SOURCE_CATALOG } from '../sources/catalog.js';
import type { ChatMessage } from './provider.js';

/** Trechos entregues ao LLM: os 5 primeiros da recuperação, iguais ao k da avaliação. */
export const CONTEXT_UNITS = 5;

export const ABSTENTION = 'Não sei: os trechos recuperados não contêm essa informação.';

/** Instruções fixas, iguais para B, C e D. Qualquer mudança altera `PROMPT_SHA256`. */
export const SYSTEM_PROMPT = [
  'Você responde perguntas sobre a documentação interna de uma empresa usando somente os trechos fornecidos.',
  '',
  'Regras:',
  '1. Use apenas o que está escrito nos trechos. Não use conhecimento próprio e não suponha nada.',
  '2. Cite o id de cada trecho que sustenta a resposta, entre colchetes, logo depois da informação. Exemplo: "O serviço foi reiniciado [DOC-123#secao]."',
  `3. Se os trechos não trouxerem a informação pedida, responda exatamente: "${ABSTENTION}" Nesse caso, não cite trechos.`,
  '4. Responda em português, de forma direta, em no máximo 3 frases.',
].join('\n');

/** Mensagens enviadas ao LLM: instruções fixas, trechos na ordem da recuperação e pergunta. */
export function buildMessages(question: string, hits: Hit[]): ChatMessage[] {
  const context = hits.map((h) => `[${h.unitId}] (fonte: ${SOURCE_CATALOG[h.source].title})\n${h.text}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Trechos:\n\n${context}\n\nPergunta: ${question}` },
  ];
}

/** Impressão digital do prompt (instruções + modelo da mensagem), gravada em cada execução. */
export const PROMPT_SHA256 = createHash('sha256')
  .update(JSON.stringify(buildMessages('{pergunta}', [
    { chunkId: '{id}', unitId: '{id}', docId: '{doc}', source: 'docs', text: '{texto}', score: 0 },
  ])))
  .digest('hex');
