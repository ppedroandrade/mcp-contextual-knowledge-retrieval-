import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeGeneration, type GenerationResult } from '../src/bench/generation.js';
import { loadQuestions } from '../src/bench/setup.js';

/**
 * Recalcula, com o código atual, o resumo de uma execução gravada de `bench:generation`
 * (útil quando o resumo ganha campos novos). Não altera os arquivos da execução.
 *
 * Uso: npx tsx scripts/summarize-generation.ts <id da execução em results/runs>
 */
const id = process.argv[2];
if (!id) throw new Error('informe o id da execução: npx tsx scripts/summarize-generation.ts <id>');
const dir = join(import.meta.dirname, '..', 'results', 'runs', id);
const results = JSON.parse(readFileSync(join(dir, 'per-question.json'), 'utf8')) as GenerationResult[];
const { set } = JSON.parse(readFileSync(join(dir, 'environment.json'), 'utf8')) as { set: string };
console.table(summarizeGeneration(results, loadQuestions(set)));
