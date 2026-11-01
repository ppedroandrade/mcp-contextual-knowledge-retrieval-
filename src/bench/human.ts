import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, SEED } from '../corpus/generate.js';
import { blindSheet, evaluatorInstructions, parseRatings, summarizeRatings, type BlindKey } from '../evaluation/human.js';
import { distinctItems } from '../evaluation/items.js';
import { loadSource } from '../sources/index.js';
import { environment, saveRun } from './environment.js';
import type { GenerationResult } from './generation.js';
import { loadQuestions, sourcesFor } from './setup.js';

/**
 * Avaliação humana (H2), em dois passos:
 * - exportar: `--run <execução de bench:generation> --out <id>` grava a planilha cega, as
 *   instruções e a chave (que não vai para os avaliadores);
 * - importar: `--import <id> --ratings a.csv,b.csv` lê as planilhas preenchidas, guarda uma
 *   cópia e resume as notas e a concordância.
 */
async function main() {
  const env = environment();
  const { values } = parseArgs({ options: {
    run: { type: 'string' },
    out: { type: 'string' },
    import: { type: 'string' },
    ratings: { type: 'string' },
  } });
  const runsDir = join(DATA_DIR, '..', 'results', 'runs');

  if (values.import) {
    if (!values.ratings) throw new Error('informe as planilhas preenchidas: --ratings a.csv,b.csv');
    const dir = join(runsDir, values.import);
    const key = JSON.parse(readFileSync(join(dir, 'chave.json'), 'utf8')) as BlindKey;
    mkdirSync(join(dir, 'avaliacoes'), { recursive: true });
    const raters = values.ratings.split(',').map((path) => {
      const name = basename(path, extname(path));
      copyFileSync(path, join(dir, 'avaliacoes', `${name}.csv`));
      return { name, ratings: parseRatings(readFileSync(path, 'utf8'), key) };
    });
    const summary = summarizeRatings(raters, key);
    writeFileSync(join(dir, 'notas-humanas.json'), JSON.stringify({ importedAt: env.timestamp, gitCommit: env.gitCommit, ...summary }, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (!values.run || !values.out) throw new Error('para exportar: --run <execução de bench:generation> --out <id>');
  const runDir = join(runsDir, values.run);
  const results = JSON.parse(readFileSync(join(runDir, 'per-question.json'), 'utf8')) as GenerationResult[];
  const source = JSON.parse(readFileSync(join(runDir, 'environment.json'), 'utf8')) as { set: string; gitCommit: string };
  const questions = loadQuestions(source.set);
  const items = distinctItems(results, questions, sourcesFor(source.set).flatMap((s) => loadSource(s)));
  const { csv, key } = blindSheet(items, SEED);
  const dir = saveRun(values.out, {
    'chave.json': key,
    'environment.json': { ...env, generationRun: values.run, generationCommit: source.gitCommit, set: source.set, items: items.length, shuffleSeed: SEED },
  });
  writeFileSync(join(dir, 'planilha.csv'), csv);
  writeFileSync(join(dir, 'instrucoes.md'), evaluatorInstructions(items.length));
  console.log(`${items.length} itens em ${dir}: envie planilha.csv e instrucoes.md aos avaliadores (não envie chave.json)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
