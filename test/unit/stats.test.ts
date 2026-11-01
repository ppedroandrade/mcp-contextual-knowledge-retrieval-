import { describe, expect, it } from 'vitest';
import { answerMeasures, generationMeasures, humanMeasures } from '../../src/bench/stats.js';
import { comparePaired, perQuestion } from '../../src/evaluation/compare.js';
import { bootstrapCi, holm, mannWhitneyU, medianOf, quantile, ranks, wilcoxonSignedRank } from '../../src/evaluation/stats.js';

// Valores de referência calculados com SciPy 1.18.1 e statsmodels (script auxiliar, fora do repositório):
// scipy.stats.wilcoxon(x, y[, method='approx']), scipy.stats.mannwhitneyu(x, y),
// statsmodels.stats.multitest.multipletests(p, method='holm').

describe('postos', () => {
  it('dá a média dos postos nos empates', () => {
    expect(ranks([10, 20, 20, 5, 30])).toEqual([2, 3.5, 3.5, 1, 5]);
  });
});

describe('Wilcoxon pareado', () => {
  it('exato, sem empates (exemplo de Hollander & Wolfe)', () => {
    const r = wilcoxonSignedRank([1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3], [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29]);
    expect(r.method).toBe('exato');
    expect(r.statistic).toBe(5);
    expect(r.p).toBeCloseTo(0.0390625, 10);
    expect(r.rankBiserial).toBeCloseTo((40 - 5) / 45, 10);
  });

  it('com empates e diferenças nulas: aproximação normal com correção de empates', () => {
    const r = wilcoxonSignedRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 0, 1, 5, 5, 4, 3, 8, 7, 7, 15, 10]);
    expect(r).toMatchObject({ method: 'normal', n: 10, zeros: 2, statistic: 11 });
    expect(r.p).toBeCloseTo(0.08793560714236243, 6);
    expect(r.z!).toBeCloseTo(1.7063893769835632, 6); // SciPy dá o sinal pelo lado da estatística mínima
  });

  it('n > 50: aproximação normal', () => {
    const x = Array.from({ length: 60 }, (_, i) => ((i * 1.3) % 7) + i * 0.01);
    const y = Array.from({ length: 60 }, (_, i) => ((i * 2.7) % 5) + i * 0.012);
    const r = wilcoxonSignedRank(x, y);
    expect(r.method).toBe('normal');
    expect(r.statistic).toBe(491);
    expect(r.p).toBeCloseTo(0.0029403845613114573, 6);
  });

  it('sem nenhuma diferença: p = 1, sem teste', () => {
    expect(wilcoxonSignedRank([1, 2, 3], [1, 2, 3])).toMatchObject({ n: 0, zeros: 3, p: 1, method: 'sem diferenças' });
  });
});

describe('Mann-Whitney U', () => {
  it('exato, amostras pequenas sem empates', () => {
    const r = mannWhitneyU([1.1, 2.2, 3.3, 4.4, 5.5], [0.5, 2.5, 6.6, 7.7, 8.8, 9.9]);
    expect(r).toMatchObject({ method: 'exato', u: 8 });
    expect(r.p).toBeCloseTo(0.24675324675324672, 10);
  });

  it('com empates: normal com correção de empates e de continuidade', () => {
    const r = mannWhitneyU([1, 2, 2, 3, 4, 5, 5, 6], [3, 4, 4, 5, 6, 7, 8, 8, 9, 10]);
    expect(r).toMatchObject({ method: 'normal', u: 14 });
    expect(r.p).toBeCloseTo(0.02261389084125779, 6);
  });

  it('amostras grandes de tamanhos diferentes', () => {
    const r = mannWhitneyU(Array.from({ length: 40 }, (_, i) => (i * 1.3) % 7), Array.from({ length: 45 }, (_, i) => ((i * 2.7) % 5) + 1));
    expect(r.u).toBe(861);
    expect(r.p).toBeCloseTo(0.7346171419651444, 6);
  });

  it('delta de Cliff vai de −1 a 1', () => {
    expect(mannWhitneyU([1, 2, 3], [4, 5, 6]).cliffsDelta).toBe(-1);
    expect(mannWhitneyU([4, 5, 6], [1, 2, 3]).cliffsDelta).toBe(1);
  });
});

describe('Holm', () => {
  it('confere com o statsmodels e mantém NaN', () => {
    const adj = holm([0.01, 0.04, 0.03, 0.005]);
    [0.03, 0.06, 0.06, 0.02].forEach((v, i) => expect(adj[i]).toBeCloseTo(v, 12));
    expect(holm([0.01, NaN, 0.02])).toEqual([0.02, NaN, 0.02]);
  });
});

describe('bootstrap', () => {
  it('é determinístico pela semente e contém a estimativa', () => {
    const d = Array.from({ length: 50 }, (_, i) => Math.sin(i) + 0.3);
    const a = bootstrapCi(d, medianOf, { resamples: 2000, seed: 7 });
    expect(bootstrapCi(d, medianOf, { resamples: 2000, seed: 7 })).toEqual(a);
    expect(a.low).toBeLessThanOrEqual(a.estimate);
    expect(a.high).toBeGreaterThanOrEqual(a.estimate);
  });

  it('valor constante dá intervalo degenerado', () => {
    expect(bootstrapCi([2, 2, 2, 2], medianOf, { resamples: 100 })).toMatchObject({ estimate: 2, low: 2, high: 2 });
  });

  it('quantil tipo 7 e mediana usual', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('comparações pareadas', () => {
  const qs = Array.from({ length: 20 }, (_, i) => `q${String(i).padStart(2, '0')}`);
  const rows = qs.flatMap((q, i) => [
    { a: 'A', q, v: 1 + (i % 3) * 0.1 },
    { a: 'B', q, v: 50 + i },
    { a: 'C', q, v: 150 + i },
    { a: 'D', q, v: 150 + i },
  ]);
  const measure = { name: 'latência', estimator: 'median' as const, better: 'lower' as const, values: perQuestion(rows, (r) => r.a, (r) => r.q, (r) => r.v) };
  const out = comparePaired(measure, undefined, { resamples: 500 });

  it('faz os 4 pares no sentido (com a mudança, sem a mudança)', () => {
    expect(out.map((r) => r.pair)).toEqual(['D × A', 'D × B', 'C × B', 'D × C']);
  });

  it('lê o sentido pela medida: latência maior é pior', () => {
    expect(out[0]).toMatchObject({ significant: true });
    expect(out[0]!.reading).toMatch(/^D pior que A/);
    expect(out[0]!.difference.estimate).toBeGreaterThan(0);
  });

  it('pares idênticos não entram na correção de Holm', () => {
    expect(out[3]).toMatchObject({ n: 20, significant: false, reading: 'D e C iguais em todas as perguntas' });
    expect(out[3]!.wilcoxon.pHolm).toBe(1);
    // 3 comparações válidas: o menor p é multiplicado por 3, não por 4.
    const ps = out.slice(0, 3).map((r) => r.wilcoxon.p).sort((a, b) => a - b);
    expect(Math.min(...out.slice(0, 3).map((r) => r.wilcoxon.pHolm))).toBeCloseTo(Math.min(1, 3 * ps[0]!), 12);
  });

  it('usa só as perguntas presentes nas duas configurações', () => {
    const partial = perQuestion([{ a: 'D', q: 'x', v: 1 }, { a: 'D', q: 'y', v: 2 }, { a: 'C', q: 'y', v: 3 }], (r) => r.a, (r) => r.q, (r) => r.v);
    const [r] = comparePaired({ name: 'm', estimator: 'mean', better: 'higher', values: partial }, [['D', 'C']], { resamples: 50 });
    expect(r!.n).toBe(1);
  });
});

describe('medidas a partir das execuções', () => {
  it('geração: latência por pergunta é a mediana das rodadas', () => {
    const row = (retriever: string, ms: number[]) => ({ questionId: 'q1', type: 'single-source', retriever, retrievalMs: ms, totalMs: ms.map((x) => x * 10) }) as never;
    const [ret, total] = generationMeasures([row('B-rag', [3, 1, 2]), row('D-mcp', [5, 4, 6])]);
    expect(ret!.values.get('B')!.get('q1')).toBe(2);
    expect(total!.values.get('D')!.get('q1')).toBe(50);
  });

  it('respostas: um item de C e D vale para as duas', () => {
    const item = { questionId: 'q1', type: 'single-source', approaches: ['C-por-fonte', 'D-mcp'], abstained: false, rule: { literal: 1, coverage: 1 }, scores: { correcao: 5, completude: 4, sustentacao: 5 } } as never;
    const [rule, , correcao] = answerMeasures([item]);
    expect(rule!.values.get('C')!.get('q1')).toBe(1);
    expect(rule!.values.get('D')!.get('q1')).toBe(1);
    expect(correcao!.values.get('D')!.get('q1')).toBe(5);
  });

  it('notas humanas: média dos avaliadores no item, que vale para C e D', () => {
    const key = {
      R001: { key: 'k1', questionId: 'q1', approaches: ['B-rag'] },
      R002: { key: 'k2', questionId: 'q1', approaches: ['C-por-fonte', 'D-mcp'] },
      R003: { key: 'k3', questionId: 'q2', approaches: ['B-rag'] },
    };
    const ana = new Map([['R001', { correcao: 4 }], ['R002', { correcao: 5, completude: 3 }]]);
    const bruno = new Map([['R001', { correcao: 2 }], ['R002', { correcao: 4 }]]);
    const [correcao, completude] = humanMeasures(key, [ana, bruno]);
    expect(correcao!.values.get('B')!.get('q1')).toBe(3);
    expect(correcao!.values.get('C')!.get('q1')).toBe(4.5);
    expect(correcao!.values.get('D')!.get('q1')).toBe(4.5);
    expect(correcao!.values.get('B')!.get('q2')).toBeNaN();
    expect(completude!.values.get('D')!.get('q1')).toBe(3);
  });
});

describe('subgrupo por estilo', () => {
  it('restringe as medidas às perguntas escolhidas', async () => {
    const { restrict } = await import('../../src/bench/stats.js');
    const values = perQuestion([{ a: 'D', q: 'h1', v: 1 }, { a: 'D', q: 'h2', v: 2 }, { a: 'B', q: 'h1', v: 3 }], (r) => r.a, (r) => r.q, (r) => r.v);
    const [m] = restrict([{ name: 'x', estimator: 'mean', better: 'higher', values }], new Set(['h1']));
    expect([...m!.values.get('D')!.keys()]).toEqual(['h1']);
    expect([...m!.values.get('B')!.keys()]).toEqual(['h1']);
  });
});
