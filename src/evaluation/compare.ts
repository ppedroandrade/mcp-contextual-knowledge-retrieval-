import { bootstrapCi, holm, mannWhitneyU, meanOf, medianOf, wilcoxonSignedRank, type BootstrapCi, type MannWhitneyResult, type WilcoxonResult } from './stats.js';

/**
 * Comparações pareadas entre configurações (ADR 008). Cada medida tem um valor por pergunta e
 * por configuração; cada comparação (X, Y) usa as perguntas que as duas têm, a diferença X − Y
 * por pergunta, o Wilcoxon pareado e o Mann-Whitney U. A correção de Holm vale dentro de cada
 * medida, sobre as comparações feitas com ela.
 */

/** Valor por pergunta de uma medida, por configuração (letra A–D). */
export type PerQuestion = Map<string, Map<string, number>>;

export interface MeasureSpec {
  name: string;
  /** Latência: mediana; notas e métricas de qualidade (muitas vezes 0/1): média. */
  estimator: 'median' | 'mean';
  /** Sentido em que a medida melhora (latência: menor; qualidade: maior). */
  better: 'lower' | 'higher';
  values: PerQuestion;
}

/**
 * Pares comparados, sempre no sentido (com a mudança, sem a mudança): D × A é a H1 (MCP + RAG
 * contra a busca textual), D × B é MCP + RAG contra o RAG tradicional, C × B isola a estratégia
 * (busca por fonte) e D × C isola o protocolo.
 */
export const PAIRS: [string, string][] = [['D', 'A'], ['D', 'B'], ['C', 'B'], ['D', 'C']];

export const ALPHA = 0.05;

export interface Comparison {
  measure: string;
  pair: string;
  n: number;
  estimator: 'median' | 'mean';
  first: number;
  second: number;
  /** Estimador das diferenças por pergunta (primeiro − segundo), com IC 95% por bootstrap. */
  difference: BootstrapCi;
  wilcoxon: WilcoxonResult & { pHolm: number };
  mannWhitney: MannWhitneyResult & { pHolm: number };
  /** Pelo Wilcoxon com Holm, α = 0,05. */
  significant: boolean;
  /** Leitura em texto, sem interpretar a hipótese. */
  reading: string;
}

export function comparePaired(measure: MeasureSpec, pairs: [string, string][] = PAIRS, opts: { resamples?: number; seed?: number } = {}): Comparison[] {
  const est = measure.estimator === 'median' ? medianOf : meanOf;
  const rows = pairs
    .filter(([x, y]) => measure.values.has(x) && measure.values.has(y))
    .map(([x, y]) => {
      const vx = measure.values.get(x)!;
      const vy = measure.values.get(y)!;
      const ids = [...vx.keys()].filter((q) => vy.has(q) && !Number.isNaN(vx.get(q)!) && !Number.isNaN(vy.get(q)!)).sort();
      const a = ids.map((q) => vx.get(q)!);
      const b = ids.map((q) => vy.get(q)!);
      const diffs = a.map((v, i) => v - b[i]!);
      return {
        measure: measure.name, pair: `${x} × ${y}`, n: ids.length, estimator: measure.estimator,
        first: est(a), second: est(b),
        difference: bootstrapCi(diffs, est, opts),
        wilcoxon: wilcoxonSignedRank(a, b),
        mannWhitney: mannWhitneyU(a, b),
      };
    });
  const wh = holm(rows.map((r) => (r.wilcoxon.method === 'sem diferenças' ? NaN : r.wilcoxon.p)));
  const mh = holm(rows.map((r) => r.mannWhitney.p));
  return rows.map((r, i) => {
    const pHolm = Number.isNaN(wh[i]!) ? 1 : wh[i]!;
    const significant = pHolm < ALPHA;
    const [x, y] = r.pair.split(' × ');
    const d = r.difference.estimate;
    const better = measure.better === 'lower' ? d < 0 : d > 0;
    const reading = r.wilcoxon.method === 'sem diferenças'
      ? `${x} e ${y} iguais em todas as perguntas`
      : significant
        ? `${x} ${better ? 'melhor' : 'pior'} que ${y} (p Holm = ${pHolm.toPrecision(2)})`
        : `sem diferença significativa entre ${x} e ${y} (p Holm = ${pHolm.toPrecision(2)})`;
    return { ...r, wilcoxon: { ...r.wilcoxon, pHolm }, mannWhitney: { ...r.mannWhitney, pHolm: mh[i]! }, significant, reading };
  });
}

/** Letra da configuração a partir do nome do retriever (`D-mcp` → `D`). */
export const letter = (retriever: string) => retriever[0]!;

/** Agrupa linhas (configuração, pergunta, valor) numa medida por pergunta. */
export function perQuestion<T>(rows: T[], approach: (r: T) => string, question: (r: T) => string, value: (r: T) => number): PerQuestion {
  const out: PerQuestion = new Map();
  for (const r of rows) {
    const a = approach(r);
    if (!out.has(a)) out.set(a, new Map());
    out.get(a)!.set(question(r), value(r));
  }
  return out;
}
