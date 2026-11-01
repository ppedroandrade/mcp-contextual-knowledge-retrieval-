import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { environment } from '../src/bench/environment.js';
import type { GenerationResult } from '../src/bench/generation.js';
import type { QuestionResult } from '../src/bench/retrieval.js';
import { summarize } from '../src/bench/retrieval.js';
import { generationMeasures, RESAMPLES, restrict, retrievalMeasures } from '../src/bench/stats.js';
import { loadQuestions } from '../src/bench/setup.js';
import { SEED } from '../src/corpus/generate.js';
import { comparePaired, type Comparison, type MeasureSpec } from '../src/evaluation/compare.js';
import { mean } from '../src/evaluation/metrics.js';
import { medianOf, quantile } from '../src/evaluation/stats.js';

/**
 * Recálculo POSTERIOR ao experimento (ADR 016): refaz, a partir dos tempos brutos gravados em
 * `results/runs/<id>/per-question.json`, os números de latência que dependem da mediana das
 * rodadas de cada pergunta, agora com a mediana usual (n par: média dos dois centrais). Até a
 * correção, `median` em `src/evaluation/metrics.ts` tomava o central superior.
 *
 * Não altera nada em `results/runs/`: lê os resumos e as estatísticas publicados e grava, ao
 * lado, os valores recalculados em `results/recalculos/2026-11-01-mediana-usual/`. Só as
 * medidas de latência são refeitas; as de qualidade não dependem da mediana e não são
 * repetidas. Uma execução em que nenhuma mediana por pergunta muda (número ímpar de rodadas)
 * fica registrada como inalterada, sem refazer os testes.
 *
 * Uso: npx tsx scripts/recalculo-mediana.ts
 */

const ROOT = join(import.meta.dirname, '..');
const RUNS = join(ROOT, 'results', 'runs');
const OUT = join(ROOT, 'results', 'recalculos', '2026-11-01-mediana-usual');
const RECALC_RUNS = ['2026-11-01-heldout-recuperacao', '2026-11-01-heldout-geracao', '2026-11-01-politicas-recuperacao'];

const read = (id: string, f: string) => JSON.parse(readFileSync(join(RUNS, id, f), 'utf8'));

/** Mediana como era calculada antes da correção (central superior com n par). Só para a comparação. */
const upperMedian = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
/** Quantil como era calculado em scripts/compare-c-d.ts antes da correção (posto mais próximo, ⌊p·(n − 1)⌋). */
const nearestRank = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!;

type Row = QuestionResult | GenerationResult;
const isGeneration = (r: Row): r is GenerationResult => 'answer' in r;

interface Stat { file: string; estilo: string | null; comparacoes: Comparison[] }

function publishedStats(id: string): Stat[] {
  return ['estatistica.json', 'estatistica-literal.json', 'estatistica-parafraseada.json']
    .filter((f) => existsSync(join(RUNS, id, f)))
    .map((f) => { const s = read(id, f); return { file: f, estilo: s.estilo ?? null, comparacoes: s.comparacoes }; });
}

/** Séries de latência de uma linha: nome da medida → tempos por rodada. */
function series(r: Row): Record<string, number[]> {
  return isGeneration(r)
    ? { 'latência da recuperação (ms)': r.retrievalMs, 'latência da recuperação + geração (ms)': r.totalMs }
    : { 'latência da recuperação (ms)': r.latencyMs };
}

/**
 * Diagnóstico de `scripts/compare-c-d.ts` (b) e (c), pelo método anterior e pelo corrigido. O (c),
 * latência de D menos o maior tempo das tools, só existe para a recuperação.
 */
function cdDiagnostics(rows: Row[], of: (r: Row) => number[], withTool = true) {
  const by = (name: string) => new Map(rows.filter((r) => r.retriever === name).map((r) => [r.questionId, r]));
  const c = by('C-por-fonte');
  const d = by('D-mcp');
  const calc = (med: (xs: number[]) => number, q: (xs: number[], p: number) => number) => {
    const deltas = [...c].map(([id, rc]) => med(of(d.get(id)!)) - med(of(rc)));
    const iqr = [...c.values()].map((r) => q(of(r), 0.75) - q(of(r), 0.25));
    const inside = [...d.values()].filter((r) => withTool && r.toolMs?.length).map((r) => med(of(r).map((x, i) => x - r.toolMs![i]!)));
    return {
      dMenosC: { p25: q(deltas, 0.25), mediana: med(deltas), p75: q(deltas, 0.75), dMaisLento: deltas.filter((x) => x > 0).length, n: deltas.length },
      iqrDeCMediana: med(iqr),
      dMenosTool: inside.length ? { p25: q(inside, 0.25), mediana: med(inside), p75: q(inside, 0.75), n: inside.length } : null,
    };
  };
  // Antes: mediana por pergunta pelo central superior; a "mediana" das diferenças era o quantil 0,5 por posto mais próximo.
  return { anterior: calc(upperMedian, nearestRank), corrigido: calc(medianOf, quantile) };
}

function recalcRun(id: string) {
  const env = read(id, 'environment.json') as { rounds: number; set: string; gitCommit: string };
  const rows = read(id, 'per-question.json') as Row[];
  const changedQuestions: Record<string, number> = {};
  for (const r of rows) for (const [m, xs] of Object.entries(series(r))) if (medianOf(xs) !== upperMedian(xs)) changedQuestions[m] = (changedQuestions[m] ?? 0) + 1;
  const affected = Object.keys(changedQuestions).length > 0;

  // Resumo por configuração: média, entre as perguntas, da mediana das rodadas.
  const published = read(id, 'summary.json') as Record<string, Record<string, number>>;
  const summary = Object.fromEntries(Object.entries(published).map(([name, s]) => {
    const rs = rows.filter((r) => r.retriever === name);
    const keys = isGeneration(rs[0]!)
      ? [['latenciaRecuperacaoMs', (r: Row) => (r as GenerationResult).retrievalMs], ['latenciaTotalMs', (r: Row) => (r as GenerationResult).totalMs]] as const
      : [['latenciaMedianaMs', (r: Row) => (r as QuestionResult).latencyMs]] as const;
    return [name, Object.fromEntries(keys.map(([k, of]) => [k, { publicado: s[k]!, recalculado: mean(rs.map((r) => medianOf(of(r)))) }]))];
  }));
  if (!isGeneration(rows[0]!)) {
    // Confere que o resumo do bench, já corrigido, dá o mesmo número.
    const now = summarize(rows as QuestionResult[]);
    for (const [name, s] of Object.entries(summary)) {
      const v = (s as Record<string, { recalculado: number }>).latenciaMedianaMs!.recalculado;
      if (Math.abs(now[name]!.latenciaMedianaMs - v) > 1e-9) throw new Error(`resumo divergente em ${id} ${name}`);
    }
  }

  // Testes de latência: só refeitos se alguma mediana por pergunta mudou.
  const stats = publishedStats(id).map((st) => {
    const oldLatency = st.comparacoes.filter((c) => c.estimator === 'median');
    if (!affected) return { arquivoPublicado: st.file, estilo: st.estilo, refeito: false, comparacoes: oldLatency.map((c) => ({ medida: c.measure, par: c.pair, publicado: brief(c), recalculado: null })) };
    let measures: MeasureSpec[] = (isGeneration(rows[0]!) ? generationMeasures(rows as GenerationResult[]) : retrievalMeasures(rows as QuestionResult[])).filter((m) => m.estimator === 'median');
    if (st.estilo) measures = restrict(measures, new Set(loadQuestions(env.set).filter((q) => q.style === st.estilo).map((q) => q.id)));
    const fresh = measures.flatMap((m) => comparePaired(m, undefined, { resamples: RESAMPLES, seed: SEED }));
    return {
      arquivoPublicado: st.file, estilo: st.estilo, refeito: true,
      comparacoes: fresh.map((c) => {
        const old = oldLatency.find((o) => o.measure === c.measure && o.pair === c.pair);
        return { medida: c.measure, par: c.pair, publicado: old ? brief(old) : null, recalculado: brief(c), completo: c };
      }),
    };
  });

  const of = (r: Row) => (isGeneration(r) ? r.retrievalMs : r.latencyMs);
  return {
    execucao: id, commitDaExecucao: env.gitCommit, conjunto: env.set, rodadas: env.rounds,
    afetada: affected,
    perguntasComMedianaAlterada: changedQuestions,
    resumo: summary,
    estatistica: stats,
    diagnosticoCxD: { recuperacao: cdDiagnostics(rows, of), ...(isGeneration(rows[0]!) ? { recuperacaoMaisGeracao: cdDiagnostics(rows, (r) => (r as GenerationResult).totalMs, false) } : {}) },
  };
}

function brief(c: Comparison) {
  return {
    n: c.n, primeiro: c.first, segundo: c.second,
    diferenca: c.difference.estimate, icBaixo: c.difference.low, icAlto: c.difference.high,
    pWilcoxon: c.wilcoxon.p, pWilcoxonHolm: c.wilcoxon.pHolm, r: c.wilcoxon.rankBiserial,
    pMannWhitneyHolm: c.mannWhitney.pHolm, significativo: c.significant,
  };
}

const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d).replace('.', ','));
const p = (x: number) => (x < 0.001 ? '< 0,001' : f(x, 3));

function markdown(results: ReturnType<typeof recalcRun>[], env: ReturnType<typeof environment>): string {
  const out: string[] = [
    '<!-- Gerado por scripts/recalculo-mediana.ts; não editar os números à mão. -->',
    '# Recálculo da latência com a mediana usual (posterior ao experimento)',
    '',
    `Correção registrada no ADR 016 e no ADR 010. Gerado em ${env.timestamp.slice(0, 10)}, commit \`${(env.gitCommit ?? '?').slice(0, 7)}\`${env.gitDirty ? ' (árvore suja)' : ''}, Node ${env.node}, a partir dos tempos brutos das execuções abaixo, que não foram alteradas. Nenhuma medição nova foi feita.`,
    '',
    'Antes: a mediana das rodadas de cada pergunta tomava o central superior quando o número de rodadas era par. Agora: a mediana usual (média dos dois centrais). Só a execução com número par de rodadas muda; as medidas de qualidade não dependem da mediana e não foram refeitas.',
    '',
    'Os valores "recalculados" substituem, no artigo, as linhas de latência de `results/artigo/tabelas-2026-11-01.md` que vêm de `2026-11-01-heldout-recuperacao`; os "publicados" são os da v3 do artigo e continuam nos arquivos originais.',
  ];
  for (const r of results) {
    out.push('', `## \`${r.execucao}\` (${r.rodadas} rodadas, commit \`${r.commitDaExecucao.slice(0, 7)}\`)`, '');
    out.push(r.afetada ? `Perguntas × configuração com mediana alterada: ${Object.entries(r.perguntasComMedianaAlterada).map(([m, n]) => `${m}: ${n}`).join('; ')}.` : 'Número ímpar de rodadas: nenhuma mediana por pergunta muda; resumo e testes publicados continuam válidos (testes não refeitos).');
    out.push('', '| Configuração | Medida | Publicado (ms) | Recalculado (ms) |', '| --- | --- | --- | --- |');
    for (const [name, s] of Object.entries(r.resumo)) for (const [k, v] of Object.entries(s as Record<string, { publicado: number; recalculado: number }>)) out.push(`| ${name} | ${k} | ${f(v.publicado)} | ${f(v.recalculado)} |`);
    for (const st of r.estatistica.filter((s) => s.refeito)) {
      out.push('', `### Testes de latência refeitos (\`${st.arquivoPublicado}\`${st.estilo ? `, só \`${st.estilo}\`` : ''})`, '');
      out.push('| Medida | Par | n | Publicado: diferença [IC 95%] | p Holm | Recalculado: diferença [IC 95%] | p Wilcoxon | p Holm | r | p Mann-Whitney (Holm) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const c of st.comparacoes) {
        const o = c.publicado; const n = c.recalculado!;
        out.push(`| ${c.medida} | ${c.par} | ${n.n} | ${o ? `${f(o.diferenca)} [${f(o.icBaixo)}; ${f(o.icAlto)}]` : '—'} | ${o ? p(o.pWilcoxonHolm) : '—'} | ${f(n.diferenca)} [${f(n.icBaixo)}; ${f(n.icAlto)}] | ${p(n.pWilcoxon)} | ${p(n.pWilcoxonHolm)} | ${f(n.r)} | ${p(n.pMannWhitneyHolm)} |`);
      }
    }
    for (const [label, dg] of Object.entries(r.diagnosticoCxD)) {
      out.push('', `### Diagnóstico C × D (\`scripts/compare-c-d.ts\`), ${label === 'recuperacao' ? 'recuperação' : 'recuperação + geração'}`, '');
      out.push('| Método | D − C: p25 | mediana | p75 | D mais lento | IQR de C (mediana) | D − tool: p25 | mediana | p75 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const [m, v] of Object.entries(dg)) {
        const t = v.dMenosTool;
        out.push(`| ${m === 'anterior' ? 'anterior (central superior, posto mais próximo)' : 'corrigido (mediana usual, quantil tipo 7)'} | ${f(v.dMenosC.p25)} | ${f(v.dMenosC.mediana)} | ${f(v.dMenosC.p75)} | ${v.dMenosC.dMaisLento}/${v.dMenosC.n} | ${f(v.iqrDeCMediana)} | ${t ? f(t.p25) : '—'} | ${t ? f(t.mediana) : '—'} | ${t ? f(t.p75) : '—'} |`);
      }
    }
  }
  return out.join('\n') + '\n';
}

const env = environment({ tipo: 'recálculo posterior ao experimento (ADR 016)', execucoes: RECALC_RUNS, reamostragens: RESAMPLES, semente: SEED });
const results = RECALC_RUNS.map(recalcRun);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'environment.json'), JSON.stringify(env, null, 2) + '\n');
writeFileSync(join(OUT, 'recalculo.json'), JSON.stringify({ posteriorAoExperimento: true, adr: '016', ...{ geradoEm: env.timestamp, gitCommit: env.gitCommit }, execucoes: results }, null, 2) + '\n');
writeFileSync(join(OUT, 'recalculo.md'), markdown(results, env));
console.log(markdown(results, env));
