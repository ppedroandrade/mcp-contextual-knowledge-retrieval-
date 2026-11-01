import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/**
 * Monta as tabelas das seções 3 e 4 do artigo a partir das execuções gravadas em
 * `results/runs/`, sem nenhum número digitado à mão. Cada tabela cita a execução, o commit e o
 * modo (embedder, LLM), e marca em destaque as execuções sem valor experimental (embedder
 * `hash`, LLM simulado, árvore suja).
 *
 *   npx tsx scripts/tabelas-artigo.ts --recuperacao <id> --geracao <id> --respostas <id> \
 *     --humana <id> --h3 <id> --politicas <id> [--out docs/artigo/tabelas.md]
 *
 * Todos os argumentos são opcionais; cada um acrescenta as suas tabelas. A estatística
 * (`estatistica.json` e `estatistica-<estilo>.json`) entra quando existir na pasta.
 */

const RUNS = join(import.meta.dirname, '..', 'results', 'runs');
const read = (id: string, file: string) => JSON.parse(readFileSync(join(RUNS, id, file), 'utf8'));
const has = (id: string, file: string) => existsSync(join(RUNS, id, file));

/** Número no formato do artigo (vírgula decimal). */
export function num(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return x.toFixed(digits).replace('.', ',');
}
const ms = (x: number) => num(x, Math.abs(x) >= 100 ? 0 : 1);
const pct = (x: number) => `${num(x * 100, 1)}%`;
/** Diferenças: 1 casa acima de 100, 2 acima de 1, 3 abaixo. */
const sig = (x: number) => num(x, Math.abs(x) >= 100 ? 1 : Math.abs(x) >= 1 ? 2 : 3);
const p = (x: number) => (x < 0.001 ? '< 0,001' : num(x, 3));

export function mdTable(header: string[], rows: (string | number)[][]): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

interface Env {
  gitCommit?: string; gitDirty?: boolean; set?: string; rounds?: number; node?: string;
  embedder?: { embedder?: string; model?: string } | null;
  llm?: { llm?: string; model?: string } | null;
  judge?: { model?: string } | null;
  generationRun?: string;
}

/** Linha de procedência e alertas de validade de uma execução. */
export function provenance(id: string, env: Env): string {
  const bits = [`execução \`${id}\``, `commit \`${(env.gitCommit ?? '?').slice(0, 7)}\``];
  if (env.generationRun) bits.push(`respostas de \`${env.generationRun}\``);
  if (env.set) bits.push(`conjunto \`${env.set}\``);
  if (env.embedder?.model) bits.push(`embeddings \`${env.embedder.model}\``);
  if (env.llm?.model) bits.push(`gerador \`${env.llm.model}\``);
  if (env.judge?.model) bits.push(`juiz \`${env.judge.model}\``);
  if (env.rounds) bits.push(`${env.rounds} rodadas`);
  if (env.node) bits.push(`Node ${env.node}`);
  const alerts: string[] = [];
  if (env.embedder?.embedder === 'hash') alerts.push('embedder hash');
  if (env.llm?.llm === 'simulated') alerts.push('LLM simulado');
  if (env.gitDirty) alerts.push('árvore do git suja');
  if (env.set && env.set !== 'heldout' && env.set !== 'policies') alerts.push(`conjunto ${env.set}, não é o resultado final`);
  const warn = alerts.length ? `\n\n> **SEM VALOR EXPERIMENTAL:** ${alerts.join('; ')}.` : '';
  return `Fonte: ${bits.join(', ')}.${warn}`;
}

/** Avaliações herdam o embedder e o gerador da execução de geração que avaliam (para os alertas). */
function withGeneration(env: Env): Env {
  if (!env.generationRun || !has(env.generationRun, 'environment.json')) return env;
  const gen = read(env.generationRun, 'environment.json') as Env;
  return { ...env, embedder: gen.embedder, llm: gen.llm };
}

const APPROACH_ORDER = ['A-bm25', 'B-rag', 'C-por-fonte', 'D-mcp'];
const ordered = <T>(o: Record<string, T>) => APPROACH_ORDER.filter((a) => a in o).map((a) => [a, o[a]!] as const);

function retrieval(id: string): string {
  const s = read(id, 'summary.json') as Record<string, Record<string, number>>;
  const rows = ordered(s).map(([a, m]) => [a, m.questions!, num(m['P@5']), num(m['R@5']), num(m['MRR@5']), num(m['nDCG@5']), num(m['ER@5']), num(m['ER@5 multifonte']), num(m['completas@5']), ms(m.latenciaMedianaMs!)]);
  return `### Recuperação (k = 5)\n\n${mdTable(['Configuração', 'Perguntas', 'P@5', 'R@5', 'MRR@5', 'nDCG@5', 'ER@5', 'ER@5 multifonte', 'Completas@5', 'Latência mediana (ms)'], rows)}\n\n${provenance(id, read(id, 'environment.json'))}`;
}

function generation(id: string): string {
  const s = read(id, 'summary.json') as Record<string, Record<string, number>>;
  const rows = ordered(s).map(([a, m]) => [a, m.perguntas!, ms(m.latenciaRecuperacaoMs!), ms(m.latenciaTotalMs!), pct(m.abstencaoCorreta!), pct(m.citamTrecho!), pct(m.citacaoInvalida!), m.respostasQueVariaram!]);
  return `### Geração\n\n${mdTable(['Configuração', 'Perguntas', 'Recuperação (ms)', 'Recuperação + geração (ms)', 'Abstenção correta', 'Citam trecho', 'Citação inválida', 'Respostas que variaram'], rows)}\n\n${provenance(id, read(id, 'environment.json'))}`;
}

function answers(id: string): string {
  const s = read(id, 'summary.json') as { porAbordagem: Record<string, Record<string, number>>; juizXRegra?: { itens: number; concordancia: number; kappa: number }; repetibilidade?: { repeticoes: number; itensIdenticos: number; alfaOrdinal: Record<string, number> } };
  const rows = ordered(s.porAbordagem).map(([a, m]) => [a, m.perguntas!, pct(m.regraAcerto!), pct(m.rubricaAcerto!), num(m.correcao, 2), num(m.completude, 2), num(m.sustentacao, 2)]);
  const extra: string[] = [];
  if (s.juizXRegra) extra.push(`Juiz × regra: ${s.juizXRegra.itens} itens, concordância ${pct(s.juizXRegra.concordancia)}, kappa ${num(s.juizXRegra.kappa, 2)}.`);
  if (s.repetibilidade) extra.push(`Repetibilidade do juiz (${s.repetibilidade.repeticoes} repetições): ${pct(s.repetibilidade.itensIdenticos)} dos itens idênticos; alfa ordinal ${Object.entries(s.repetibilidade.alfaOrdinal).map(([c, v]) => `${c} ${num(v, 2)}`).join(', ')}.`);
  const prov = provenance(id, withGeneration(read(id, 'environment.json') as Env));
  return `### Qualidade das respostas (automática)\n\n${mdTable(['Configuração', 'Perguntas', 'Acerto pela regra', 'Acerto pela rubrica', 'Correção (1–5)', 'Completude (1–5)', 'Sustentação (1–5)'], rows)}\n\n${extra.join('\n')}${extra.length ? '\n\n' : ''}${prov}`;
}

function human(id: string): string {
  if (!has(id, 'notas-humanas.json')) return `### Avaliação humana\n\n_Sem notas importadas em \`${id}\` (rode \`npm run eval:human -- --import ${id} --ratings ...\`)._`;
  const s = read(id, 'notas-humanas.json') as { avaliadores: { nome: string; itensAvaliados: number }[]; concordancia: Record<string, number | null>; porAbordagem: Record<string, Record<string, number>> };
  const rows = ordered(s.porAbordagem).map(([a, m]) => [a, m.itens!, num(m.correcao, 2), num(m.completude, 2), num(m.sustentacao, 2)]);
  const env = withGeneration(read(id, 'environment.json') as Env);
  const who = s.avaliadores.length === 1
    ? `1 planilha de notas (\`${s.avaliadores[0]!.nome}\`, ${s.avaliadores[0]!.itensAvaliados} itens); sem concordância entre avaliadores, que exige 2 ou mais planilhas independentes.`
    : `${s.avaliadores.length} avaliadores (${s.avaliadores.map((r) => `${r.itensAvaliados} itens`).join(', ')}); alfa de Krippendorff ordinal: ${Object.entries(s.concordancia).map(([c, v]) => `${c} ${num(v, 2)}`).join(', ')}.`;
  let judge = '';
  if (has(id, 'humano-x-juiz.json')) {
    type A = Record<string, { itens: number; alfaOrdinal: number; notasIguais: number; diferencaMedia: number }>;
    const hj = read(id, 'humano-x-juiz.json') as { avaliacaoAutomatica: string; todosOsItens: A; soItensComNotaDoJuiz: A };
    const line = (label: string, a: A) => Object.entries(a).map(([c, v]) => [label, c, v.itens, num(v.alfaOrdinal, 2), pct(v.notasIguais), num(v.diferencaMedia, 2)]);
    judge = `\n\n#### Avaliação humana × juiz automático\n\n${mdTable(['Itens', 'Critério', 'n', 'Alfa ordinal', 'Notas iguais', 'Humano − juiz (média)'], [...line('todos', hj.todosOsItens), ...line('só com nota do juiz', hj.soItensComNotaDoJuiz)])}\n\nJuiz: \`${hj.avaliacaoAutomatica}\`; "todos" inclui as notas que a rubrica fixa por regra (ADR 007).`;
  }
  return `### Avaliação humana (cega)\n\n${mdTable(['Configuração', 'Itens', 'Correção (1–5)', 'Completude (1–5)', 'Sustentação (1–5)'], rows)}\n\n${who}${judge}\n\n${provenance(id, env)}`;
}

function stats(id: string): string {
  const files = ['estatistica.json', 'estatistica-literal.json', 'estatistica-parafraseada.json'].filter((f) => has(id, f));
  return files.map((f) => {
    const s = read(id, f) as { tipo: string; estilo: string | null; gitCommit: string; comparacoes: { measure: string; pair: string; n: number; estimator: string; difference: { estimate: number; low: number; high: number }; wilcoxon: { pHolm: number; rankBiserial: number; method: string }; mannWhitney: { pHolm: number }; reading: string }[] };
    const rows = s.comparacoes.map((c) => [c.measure, c.pair, c.n, `${c.estimator === 'median' ? 'mediana' : 'média'} ${sig(c.difference.estimate)} [${sig(c.difference.low)}; ${sig(c.difference.high)}]`, c.wilcoxon.method === 'sem diferenças' ? '—' : p(c.wilcoxon.pHolm), num(c.wilcoxon.rankBiserial, 2), p(c.mannWhitney.pHolm), c.reading.replace(/ \(p Holm = [^)]*\)$/, '')]);
    return `#### Testes (${s.tipo}${s.estilo ? `, só perguntas \`${s.estilo}\`` : ''})\n\n${mdTable(['Medida', 'Par', 'n', 'Diferença [IC 95%]', 'p Wilcoxon (Holm)', 'r', 'p Mann-Whitney (Holm)', 'Leitura'], rows)}\n\nWilcoxon pareado, Holm dentro de cada medida, bootstrap percentil (ADR 008); \`${id}/${f}\`, gerado no commit \`${s.gitCommit.slice(0, 7)}\`.`;
  }).join('\n\n');
}

function h3(id: string): string {
  const s = read(id, 'h3.json') as { congelamento: string; customizada: Variant; mcp: Variant; segundoCliente?: unknown };
  type Variant = { byLayer: Record<string, { files: number; added: number; removed: number }>; total: { files: number; added: number; removed: number }; hostIntocado: boolean };
  const layers = [...new Set([...Object.keys(s.customizada.byLayer), ...Object.keys(s.mcp.byLayer)])];
  const cell = (v: Variant, l: string) => (v.byLayer[l] ? `${v.byLayer[l]!.files} arq., +${v.byLayer[l]!.added} −${v.byLayer[l]!.removed}` : '0');
  const rows = [...layers.map((l) => [l, cell(s.customizada, l), cell(s.mcp, l)]),
    ['**total**', `**${s.customizada.total.files} arq., +${s.customizada.total.added} −${s.customizada.total.removed}**`, `**${s.mcp.total.files} arq., +${s.mcp.total.added} −${s.mcp.total.removed}**`],
    ['host intocado', s.customizada.hostIntocado ? 'sim' : 'não', s.mcp.hostIntocado ? 'sim' : 'não']];
  let second = '';
  if (has(id, 'segundo-cliente.json')) {
    const c = read(id, 'segundo-cliente.json') as { tools?: { nome: string }[] };
    if (c.tools) second = `\n\nSegundo cliente MCP (só o SDK): descobriu ${c.tools.length} tools (${c.tools.map((t) => `\`${t.nome}\``).join(', ')}).`;
  }
  return `### H3: integração da 4ª fonte\n\n${mdTable(['Camada', 'Customizada (B/C)', 'MCP (D)'], rows)}${second}\n\n${provenance(id, read(id, 'environment.json'))} Diff a partir do congelamento \`${s.congelamento.slice(0, 7)}\`.`;
}

async function main() {
  const { values } = parseArgs({ options: {
    recuperacao: { type: 'string' }, geracao: { type: 'string' }, respostas: { type: 'string' },
    humana: { type: 'string' }, h3: { type: 'string' }, politicas: { type: 'string' }, out: { type: 'string' },
  } });
  const parts: string[] = ['<!-- Gerado por scripts/tabelas-artigo.ts; não editar os números à mão. -->'];
  if (values.recuperacao) parts.push(retrieval(values.recuperacao), stats(values.recuperacao));
  if (values.geracao) parts.push(generation(values.geracao), stats(values.geracao));
  if (values.respostas) parts.push(answers(values.respostas), stats(values.respostas));
  if (values.humana) parts.push(human(values.humana), stats(values.humana));
  if (values.politicas) parts.push(retrieval(values.politicas).replace('### Recuperação', '### Recuperação no conjunto de políticas (4 fontes)'), stats(values.politicas));
  if (values.h3) parts.push(h3(values.h3));
  if (parts.length === 1) throw new Error('informe ao menos uma execução: --recuperacao, --geracao, --respostas, --humana, --politicas ou --h3');
  const md = parts.filter(Boolean).join('\n\n') + '\n';
  if (values.out) {
    writeFileSync(values.out, md);
    console.log(`tabelas em ${values.out}`);
  } else process.stdout.write(md);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
