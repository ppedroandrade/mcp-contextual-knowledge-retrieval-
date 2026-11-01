/**
 * Critérios de avaliação das respostas (H2), os mesmos para o juiz automático e para os
 * avaliadores humanos. Notas inteiras de 1 a 5.
 */
export const CRITERIA = ['correcao', 'completude', 'sustentacao'] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Scores = Record<Criterion, number>;

export const RUBRIC: Record<Criterion, { title: string; text: string }> = {
  correcao: {
    title: 'Correção',
    text: 'A resposta está correta em relação à resposta de referência? 5: correta; 4: correta, com imprecisão menor; '
      + '3: parcialmente correta; 2: mais errada que certa; 1: errada ou inventada. Se a referência diz que o corpus não '
      + 'tem a informação, dizer que não sabe vale 5 e afirmar qualquer resposta vale 1. Se a referência traz a '
      + 'informação e a resposta diz que não sabe, vale 1.',
  },
  completude: {
    title: 'Completude',
    text: 'A resposta traz todos os elementos da resposta de referência? 5: todos; 4: quase todos; 3: cerca de metade; '
      + '2: poucos; 1: nenhum. Se a referência diz que o corpus não tem a informação, dizer que não sabe vale 5.',
  },
  sustentacao: {
    title: 'Sustentação nos trechos',
    text: 'O que a resposta afirma está nos trechos entregues ao assistente? Avalie só o apoio nos trechos, não se a '
      + 'resposta está certa. 5: tudo o que ela afirma está nos trechos; 3: parte está; 1: afirma coisas que não estão '
      + 'nos trechos. Uma resposta que só diz que não sabe não afirma nada e vale 5.',
  },
};

/** Rubrica em texto corrido, para o prompt do juiz e as instruções dos avaliadores. */
export const RUBRIC_TEXT = CRITERIA.map((c) => `- ${c} (${RUBRIC[c].title}): ${RUBRIC[c].text}`).join('\n');

/**
 * Notas que a rubrica fixa sem julgamento. Quem só diz que não sabe não afirma nada
 * (sustentação 5) e acerta só se o corpus não tem a resposta; quem afirma algo numa pergunta
 * sem resposta no corpus erra (correção e completude 1). Os critérios que faltarem ficam
 * para o juiz.
 */
export function scoresByRule(item: { type: string; abstained: boolean }): Partial<Scores> {
  const unanswerable = item.type === 'unanswerable';
  if (item.abstained) return unanswerable ? { correcao: 5, completude: 5, sustentacao: 5 } : { correcao: 1, completude: 1, sustentacao: 5 };
  return unanswerable ? { correcao: 1, completude: 1 } : {};
}
