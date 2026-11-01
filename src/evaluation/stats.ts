import { Rng } from '../corpus/random.js';

/**
 * Estatística inferencial do experimento (ADR 008). Todas as configurações respondem às
 * mesmas perguntas, então o teste principal é o de Wilcoxon pareado, com correção de Holm
 * para várias comparações e intervalo de confiança por bootstrap. O Mann-Whitney U, citado
 * no TCC 1, é reportado ao lado, sem o pareamento. Valores conferidos contra o SciPy 1.18 nos
 * testes unitários.
 */

/** Postos de 1 a n, com a média dos postos nos empates. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

/** Tamanhos dos grupos de empates (só os com 2 ou mais). */
function tieGroups(xs: number[]): number[] {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.values()].filter((t) => t > 1);
}

/** Função de erro complementar (Numerical Recipes, `erfcc`; erro relativo < 1,2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** P(Z ≥ z) da normal padrão. */
export const normalSf = (z: number) => 0.5 * erfc(z / Math.SQRT2);

/** p bilateral da normal padrão. */
const twoSidedNormal = (z: number) => Math.min(1, 2 * normalSf(Math.abs(z)));

export interface WilcoxonResult {
  /** Pares usados (sem as diferenças nulas). */
  n: number;
  /** Pares com diferença nula, descartados (método de Wilcoxon, o padrão do SciPy). */
  zeros: number;
  wPlus: number;
  wMinus: number;
  /** min(W+, W−), a estatística bilateral reportada pelo SciPy. */
  statistic: number;
  z: number | null;
  p: number;
  method: 'exato' | 'normal' | 'sem diferenças';
  /** Correlação bisserial de postos pareada: (W+ − W−) / (W+ + W−), de −1 a 1. */
  rankBiserial: number;
}

/**
 * Teste de postos sinalizados de Wilcoxon, bilateral, sobre as diferenças x − y. Exato quando
 * n ≤ 50 e não há empates entre os |d|; senão, aproximação normal com correção de empates e
 * sem correção de continuidade (os padrões do SciPy).
 */
export function wilcoxonSignedRank(x: number[], y: number[]): WilcoxonResult {
  if (x.length !== y.length) throw new Error('Wilcoxon pareado: as amostras precisam ter o mesmo tamanho');
  const d = x.map((v, i) => v - y[i]!).filter((v) => !Number.isNaN(v));
  const nonzero = d.filter((v) => v !== 0);
  const zeros = d.length - nonzero.length;
  const n = nonzero.length;
  if (n === 0) return { n, zeros, wPlus: 0, wMinus: 0, statistic: 0, z: null, p: 1, method: 'sem diferenças', rankBiserial: 0 };
  const abs = nonzero.map(Math.abs);
  const r = ranks(abs);
  const wPlus = r.reduce((s, rk, i) => s + (nonzero[i]! > 0 ? rk : 0), 0);
  const total = (n * (n + 1)) / 2;
  const wMinus = total - wPlus;
  const statistic = Math.min(wPlus, wMinus);
  const rankBiserial = (wPlus - wMinus) / total;
  const ties = tieGroups(abs);
  if (n <= 50 && ties.length === 0) {
    // Distribuição exata de W+ sob H0: número de subconjuntos de {1..n} com cada soma.
    const counts = new Array<number>(total + 1).fill(0);
    counts[0] = 1;
    for (let k = 1; k <= n; k++) for (let s = total; s >= k; s--) counts[s]! += counts[s - k]!;
    const all = 2 ** n;
    let cdf = 0;
    for (let s = 0; s <= statistic; s++) cdf += counts[s]!;
    return { n, zeros, wPlus, wMinus, statistic, z: null, p: Math.min(1, (2 * cdf) / all), method: 'exato', rankBiserial };
  }
  const mean = total / 2;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - ties.reduce((s, t) => s + t ** 3 - t, 0) / 48;
  const z = variance > 0 ? (wPlus - mean) / Math.sqrt(variance) : 0;
  return { n, zeros, wPlus, wMinus, statistic, z, p: variance > 0 ? twoSidedNormal(z) : 1, method: 'normal', rankBiserial };
}

export interface MannWhitneyResult {
  n1: number;
  n2: number;
  /** U da primeira amostra (o que o SciPy devolve). */
  u: number;
  z: number | null;
  p: number;
  method: 'exato' | 'normal';
  /** Delta de Cliff: P(x > y) − P(x < y), de −1 a 1. */
  cliffsDelta: number;
}

/**
 * Teste U de Mann-Whitney, bilateral, para amostras independentes. Exato quando as duas
 * amostras têm até 8 valores e não há empates; senão, aproximação normal com correção de
 * empates e de continuidade (os padrões do SciPy).
 */
export function mannWhitneyU(x: number[], y: number[]): MannWhitneyResult {
  const a = x.filter((v) => !Number.isNaN(v));
  const b = y.filter((v) => !Number.isNaN(v));
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) throw new Error('Mann-Whitney: amostra vazia');
  const all = [...a, ...b];
  const r = ranks(all);
  const r1 = r.slice(0, n1).reduce((s, v) => s + v, 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const cliffsDelta = (2 * u) / (n1 * n2) - 1;
  const ties = tieGroups(all);
  if (n1 <= 8 && n2 <= 8 && ties.length === 0) {
    // f[i][j][u]: número de arranjos de i valores de x e j de y com estatística u.
    const maxU = n1 * n2;
    let prev: number[][] = Array.from({ length: n2 + 1 }, () => [1]);
    for (let i = 1; i <= n1; i++) {
      const cur: number[][] = [[1]];
      for (let j = 1; j <= n2; j++) {
        const len = i * j + 1;
        cur[j] = Array.from({ length: len }, (_, k) => (k >= j ? (prev[j]![k - j] ?? 0) : 0) + (cur[j - 1]![k] ?? 0));
      }
      prev = cur;
    }
    const dist = prev[n2]!;
    const total = dist.reduce((s, v) => s + v, 0);
    const big = Math.max(u, maxU - u);
    let sf = 0;
    for (let k = Math.ceil(big); k <= maxU; k++) sf += dist[k] ?? 0;
    return { n1, n2, u, z: null, p: Math.min(1, (2 * sf) / total), method: 'exato', cliffsDelta };
  }
  const n = n1 + n2;
  const mean = (n1 * n2) / 2;
  const variance = ((n1 * n2) / 12) * (n + 1 - ties.reduce((s, t) => s + t ** 3 - t, 0) / (n * (n - 1)));
  if (variance <= 0) return { n1, n2, u, z: 0, p: 1, method: 'normal', cliffsDelta };
  const big = Math.max(u, n1 * n2 - u);
  const z = (big - mean - 0.5) / Math.sqrt(variance);
  return { n1, n2, u, z, p: Math.min(1, 2 * normalSf(z)), method: 'normal', cliffsDelta };
}

/** p ajustados pelo método de Holm (passo a passo, com monotonicidade). NaN fica NaN. */
export function holm(ps: number[]): number[] {
  const valid = ps.map((p, i) => [p, i] as const).filter(([p]) => !Number.isNaN(p)).sort((a, b) => a[0] - b[0]);
  const m = valid.length;
  const out = ps.map(() => NaN);
  let running = 0;
  valid.forEach(([p, i], k) => {
    running = Math.max(running, Math.min(1, (m - k) * p));
    out[i] = running;
  });
  return out;
}

export const meanOf = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

/**
 * Mediana usual: com n ímpar, o valor central; com n par, a média dos dois valores centrais.
 * Lista vazia dá NaN. É a única implementação de mediana do código medido (ADR 016): os resumos
 * do bench (`median` em `metrics.ts`), a estatística e os scripts usam esta função.
 */
export function medianOf(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Quantil por interpolação linear (tipo 7, o padrão do NumPy e do R). */
export function quantile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  return s[lo]! + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]!) - s[lo]!);
}

export interface BootstrapCi {
  estimate: number;
  low: number;
  high: number;
  level: number;
  resamples: number;
  seed: number;
}

/**
 * Intervalo de confiança por bootstrap percentil: reamostra os valores com reposição
 * (`resamples` vezes, gerador com semente fixa) e toma os quantis α/2 e 1 − α/2 da estatística.
 * Para dados pareados, passe as diferenças por pergunta.
 */
export function bootstrapCi(xs: number[], stat: (v: number[]) => number, { resamples = 10000, level = 0.95, seed = 42 } = {}): BootstrapCi {
  const v = xs.filter((x) => !Number.isNaN(x));
  if (v.length === 0) throw new Error('bootstrap: amostra vazia');
  const rng = new Rng(seed);
  const stats = new Array<number>(resamples);
  const sample = new Array<number>(v.length);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < v.length; i++) sample[i] = v[Math.floor(rng.next() * v.length)]!;
    stats[b] = stat(sample);
  }
  const alpha = 1 - level;
  return { estimate: stat(v), low: quantile(stats, alpha / 2), high: quantile(stats, 1 - alpha / 2), level, resamples, seed };
}
