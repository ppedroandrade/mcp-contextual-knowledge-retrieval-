import type { Hit } from '../core/types.js';

/**
 * Reciprocal Rank Fusion (Cormack; Clarke; Büttcher, 2009): score = Σ 1 / (c + posição).
 * Itens repetidos entre listas somam; empate desfeito pela maior pontuação original e
 * depois pelo id, para o resultado não depender da ordem das listas.
 */
export function reciprocalRankFusion(lists: Hit[][], k: number, c = 60): Hit[] {
  const acc = new Map<string, { hit: Hit; rrf: number; best: number }>();
  for (const list of lists) {
    list.forEach((h, i) => {
      const cur = acc.get(h.unitId) ?? { hit: h, rrf: 0, best: -Infinity };
      cur.rrf += 1 / (c + i + 1);
      cur.best = Math.max(cur.best, h.score);
      acc.set(h.unitId, cur);
    });
  }
  return [...acc.values()]
    .sort((a, b) => b.rrf - a.rrf || b.best - a.best || a.hit.unitId.localeCompare(b.hit.unitId))
    .slice(0, k)
    .map(({ hit, rrf }) => ({ ...hit, score: rrf }));
}
