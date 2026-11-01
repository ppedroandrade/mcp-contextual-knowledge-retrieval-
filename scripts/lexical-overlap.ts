import { tokenize } from '../src/core/text.js';
import type { Question } from '../src/core/types.js';
import { loadQuestions, sourcesFor } from '../src/bench/setup.js';
import { indexText } from '../src/approaches/units.js';
import { loadSource } from '../src/sources/index.js';

/**
 * Sobreposição lexical entre cada pergunta e as suas evidências (risco de docs/metodologia.md,
 * seção 4): fração dos termos da pergunta (com a normalização da busca) que aparecem no texto
 * das unidades de evidência. Quanto maior, mais a pergunta favorece a busca textual (A).
 * Só lê os arquivos versionados; não é execução do experimento.
 *
 * Uso: npx tsx scripts/lexical-overlap.ts [dev,heldout]
 */
const sets = (process.argv[2] ?? 'dev,heldout').split(',');
const units = new Map(sourcesFor('dev').flatMap((s) => loadSource(s)).map((u) => [u.id, u]));

function overlap(q: Question): number {
  const terms = [...new Set(tokenize(q.text))];
  const evidence = new Set(q.evidence.flat().flatMap((id) => tokenize(indexText(units.get(id)!))));
  return terms.length ? terms.filter((t) => evidence.has(t)).length / terms.length : NaN;
}

const rows: Record<string, { perguntas: number; sobreposicaoMedia: string }> = {};
for (const set of sets) {
  const qs = loadQuestions(set).filter((q) => q.type !== 'unanswerable');
  const groups = Map.groupBy(qs, (q) => `${set}${q.style ? ` · ${q.style}` : ''}`);
  for (const [name, g] of [[set, qs] as const, ...(groups.size > 1 ? groups : [])]) {
    const v = g.map(overlap);
    rows[name] = { perguntas: g.length, sobreposicaoMedia: (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) };
  }
}
console.table(rows);
