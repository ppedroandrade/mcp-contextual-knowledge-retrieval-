import { Rng } from '../corpus/random.js';
import { SOURCE_CATALOG } from '../sources/catalog.js';
import { parseCsv, toCsv } from '../sources/csv.js';
import { krippendorffAlpha } from './agreement.js';
import type { EvalItem } from './items.js';
import { mean } from './metrics.js';
import { CRITERIA, RUBRIC, type Criterion } from './rubric.js';

/** Colunas da planilha. Não há nenhuma referência à abordagem que gerou a resposta. */
export const SHEET_COLUMNS = ['item', 'pergunta', 'resposta_referencia', 'trechos', 'resposta', ...CRITERIA, 'observacoes'] as const;

/** Liga o id cego de cada linha ao item avaliado; não vai para os avaliadores. */
export type BlindKey = Record<string, { key: string; questionId: string; approaches: string[] }>;

/**
 * Planilha cega: uma linha por resposta distinta, em ordem embaralhada com semente fixa e
 * com ids sem relação com a abordagem. Separador `;` e BOM, para o Excel em português abrir
 * as colunas e os acentos corretamente.
 */
export function blindSheet(items: EvalItem[], seed: number): { csv: string; key: BlindKey } {
  const shuffled = new Rng(seed).shuffle(items);
  const key: BlindKey = {};
  const rows = shuffled.map((it, i) => {
    const id = `R${String(i + 1).padStart(3, '0')}`;
    key[id] = { key: it.key, questionId: it.questionId, approaches: it.approaches };
    const trechos = it.context.map((c) => `[${c.unitId}] (fonte: ${SOURCE_CATALOG[c.source].title})\n${c.text}`).join('\n\n');
    return [id, it.question, it.referenceAnswer, trechos, it.answer, ...CRITERIA.map(() => ''), ''];
  });
  return { csv: '﻿' + toCsv([[...SHEET_COLUMNS], ...rows], ';'), key };
}

/** Instruções para os avaliadores, com a mesma rubrica do juiz. */
export function evaluatorInstructions(items: number): string {
  return [
    '# Avaliação das respostas',
    '',
    `A planilha tem ${items} respostas de um assistente a perguntas sobre a documentação interna de uma empresa fictícia.`,
    'Para cada linha, leia a pergunta, a resposta de referência, os trechos que o assistente recebeu e a resposta dele.',
    'Preencha as colunas de nota com um número inteiro de 1 a 5. A coluna `observacoes` é opcional.',
    'Avalie cada linha de forma independente. Não altere as colunas `item`, `pergunta`, `resposta_referencia`, `trechos` e `resposta`.',
    '',
    ...CRITERIA.flatMap((c) => [`## ${c}: ${RUBRIC[c].title}`, '', RUBRIC[c].text, '']),
  ].join('\n');
}

export type Ratings = Map<string, Partial<Record<Criterion, number>>>;

/** Lê uma planilha preenchida. Aceita `;` ou `,`, BOM e notas como "4", "4,0" ou "4.0". */
export function parseRatings(text: string, key: BlindKey): Ratings {
  const body = text.replace(/^﻿/, '');
  const sep = (body.split('\n', 1)[0] ?? '').includes(';') ? ';' : ',';
  const [header, ...rows] = parseCsv(body, sep);
  const col = (name: string) => {
    const i = header?.indexOf(name) ?? -1;
    if (i < 0) throw new Error(`a planilha não tem a coluna ${name}`);
    return i;
  };
  const itemCol = col('item');
  const cols = CRITERIA.map((c) => [c, col(c)] as const);
  const ratings: Ratings = new Map();
  for (const row of rows) {
    const id = row[itemCol]?.trim();
    if (!id) continue;
    if (!key[id]) throw new Error(`item desconhecido na planilha: ${id}`);
    const scores: Partial<Record<Criterion, number>> = {};
    for (const [c, i] of cols) {
      const raw = (row[i] ?? '').trim().replace(',', '.');
      if (raw === '') continue;
      const v = Number(raw);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`nota inválida em ${id}, ${c}: "${row[i]}"`);
      scores[c] = v;
    }
    ratings.set(id, scores);
  }
  return ratings;
}

/**
 * Resume as notas humanas: concordância entre avaliadores (alfa de Krippendorff ordinal, por
 * critério) e média por abordagem. Cada item tem a média dos avaliadores, e essa nota vale
 * para todas as abordagens que deram a resposta (C e D, quando iguais).
 */
export function summarizeRatings(raters: { name: string; ratings: Ratings }[], key: BlindKey) {
  const ids = Object.keys(key).sort();
  const itemMean = (id: string, c: Criterion) => mean(raters.map((r) => r.ratings.get(id)?.[c] ?? NaN));
  const approaches = [...new Set(Object.values(key).flatMap((k) => k.approaches))].sort();
  return {
    avaliadores: raters.map((r) => ({ nome: r.name, itensAvaliados: [...r.ratings.values()].filter((s) => Object.keys(s).length > 0).length })),
    concordancia: Object.fromEntries(CRITERIA.map((c) => [c, krippendorffAlpha(raters.map((r) => ids.map((id) => r.ratings.get(id)?.[c] ?? null)), 'ordinal')])),
    porAbordagem: Object.fromEntries(approaches.map((a) => {
      const mine = ids.filter((id) => key[id]!.approaches.includes(a));
      return [a, { itens: mine.length, ...Object.fromEntries(CRITERIA.map((c) => [c, mean(mine.map((id) => itemMean(id, c)))])) }];
    })),
  };
}
