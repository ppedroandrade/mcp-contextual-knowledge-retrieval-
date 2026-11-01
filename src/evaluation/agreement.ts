export type MeasurementLevel = 'nominal' | 'ordinal' | 'interval';

/**
 * Alfa de Krippendorff (Krippendorff, 2011), para dois ou mais avaliadores e notas
 * faltantes. `ratings[c][u]` é a nota do avaliador c na unidade u, ou null; unidades com
 * menos de duas notas ficam de fora. Sem nenhuma variação nas notas, o alfa é indefinido (NaN).
 */
export function krippendorffAlpha(ratings: (number | null)[][], level: MeasurementLevel): number {
  const values = [...new Set(ratings.flat().filter((v): v is number => v !== null))].sort((a, b) => a - b);
  const index = new Map(values.map((v, i) => [v, i]));
  // Matriz de coincidências: cada par de notas da mesma unidade, com peso 1 / (m − 1).
  const o = values.map(() => values.map(() => 0));
  const units = Math.max(0, ...ratings.map((r) => r.length));
  for (let u = 0; u < units; u++) {
    const vs = ratings.map((r) => r[u]).filter((v): v is number => v !== null && v !== undefined);
    if (vs.length < 2) continue;
    for (let i = 0; i < vs.length; i++) {
      for (let j = 0; j < vs.length; j++) if (i !== j) o[index.get(vs[i]!)!]![index.get(vs[j]!)!]! += 1 / (vs.length - 1);
    }
  }
  const nc = o.map((row) => row.reduce((a, b) => a + b, 0));
  const n = nc.reduce((a, b) => a + b, 0);
  const delta = (c: number, k: number): number => {
    if (level === 'nominal') return c === k ? 0 : 1;
    if (level === 'interval') return (values[c]! - values[k]!) ** 2;
    const [a, b] = c < k ? [c, k] : [k, c];
    let between = 0;
    for (let g = a; g <= b; g++) between += nc[g]!;
    return (between - (nc[a]! + nc[b]!) / 2) ** 2;
  };
  let observed = 0;
  let expected = 0;
  for (let c = 0; c < values.length; c++) {
    for (let k = 0; k < values.length; k++) {
      observed += o[c]![k]! * delta(c, k);
      expected += nc[c]! * nc[k]! * delta(c, k);
    }
  }
  return expected === 0 ? NaN : 1 - ((n - 1) * observed) / expected;
}

/** Kappa de Cohen para duas classificações binárias das mesmas unidades. */
export function cohenKappa(a: boolean[], b: boolean[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error('as classificações precisam ter o mesmo tamanho, maior que zero');
  const n = a.length;
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const pa = a.filter(Boolean).length / n;
  const pb = b.filter(Boolean).length / n;
  const expected = pa * pb + (1 - pa) * (1 - pb);
  return expected === 1 ? NaN : (observed - expected) / (1 - expected);
}
