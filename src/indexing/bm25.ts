import { tokenize } from '../core/text.js';

export interface Bm25Params {
  k1: number;
  b: number;
}

export const BM25_DEFAULTS: Bm25Params = { k1: 1.2, b: 0.75 };

/** Índice BM25 em memória (Robertson; Zaragoza, 2009), com IDF não negativo. */
export class Bm25Index<T extends { id: string }> {
  private readonly docs: { item: T; tf: Map<string, number>; len: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(items: T[], text: (item: T) => string, private readonly params = BM25_DEFAULTS) {
    this.docs = items.map((item) => {
      const tokens = tokenize(text(item));
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { item, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(this.docs.length, 1);
  }

  get size(): number {
    return this.docs.length;
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  /** Itens com pontuação > 0, em ordem decrescente; empate desfeito pela ordem de indexação. */
  search(query: string, k: number): { item: T; score: number }[] {
    const terms = [...new Set(tokenize(query))];
    const { k1, b } = this.params;
    const scored = this.docs.map((d, i) => {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        score += this.idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen)));
      }
      return { item: d.item, score, i };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score || a.i - b2.i)
      .slice(0, k)
      .map(({ item, score }) => ({ item, score }));
  }
}
