import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Question } from '../core/types.js';
import type { Fact, GeneratedFile } from './model.js';
import { buildHeldoutQuestions } from './heldout.js';
import { buildDevQuestions, buildPolicyQuestions } from './questions.js';
import { Rng } from './random.js';
import { renderDocs } from './render/docs.js';
import { renderIncidents } from './render/incidents.js';
import { renderPolicies } from './render/policies.js';
import { renderTickets, type TicketMeta } from './render/tickets.js';

/** Semente única do corpus. Mudar a semente muda o corpus inteiro. */
export const SEED = 20261031;

export const DATA_DIR = join(import.meta.dirname, '..', '..', 'data');

export interface Corpus {
  /** Arquivos das fontes, com caminho relativo a `data/corpus`. */
  files: GeneratedFile[];
  facts: Fact[];
  tickets: TicketMeta[];
  questions: { dev: Question[]; policies: Question[]; heldout: Question[] };
}

/**
 * Gera o corpus inteiro em memória. Cada fonte e cada conjunto de perguntas tem a sua
 * própria sequência aleatória, para que mudar uma parte não altere as outras.
 */
export function buildCorpus(seed = SEED): Corpus {
  const docs = renderDocs(new Rng(seed + 1));
  const tickets = renderTickets(new Rng(seed + 2));
  const incidents = renderIncidents(new Rng(seed + 3));
  const policies = renderPolicies();
  const facts = [...docs.facts, ...tickets.facts, ...incidents.facts, ...policies.facts];
  const byId = new Map<string, Fact>();
  for (const f of facts) {
    if (byId.has(f.id)) throw new Error(`fato duplicado: ${f.id}`);
    byId.set(f.id, f);
  }
  return {
    files: [...docs.files, ...tickets.files, ...incidents.files, ...policies.files],
    facts,
    tickets: tickets.tickets,
    questions: (() => {
      const dev = buildDevQuestions(new Rng(seed + 10), byId, tickets.tickets);
      return {
        dev,
        policies: buildPolicyQuestions(new Rng(seed + 11), byId),
        // Criado depois do congelamento da arquitetura (ADR 010).
        heldout: buildHeldoutQuestions(new Rng(seed + 12), byId, tickets.tickets, dev),
      };
    })(),
  };
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/** Arquivos a gravar, com caminho relativo a `data/`. */
export function outputFiles(c: Corpus): GeneratedFile[] {
  return [
    ...c.files.map((f) => ({ path: `corpus/${f.path}`, content: f.content })),
    { path: 'corpus/facts.json', content: json(c.facts) },
    { path: 'questions/dev.json', content: json(c.questions.dev) },
    { path: 'questions/policies.json', content: json(c.questions.policies) },
    { path: 'questions/heldout.json', content: json(c.questions.heldout) },
  ];
}

function main() {
  const corpus = buildCorpus();
  for (const dir of ['corpus/docs', 'corpus/tickets', 'corpus/incidents', 'corpus/policies', 'questions']) {
    rmSync(join(DATA_DIR, dir), { recursive: true, force: true });
  }
  for (const f of outputFiles(corpus)) {
    const path = join(DATA_DIR, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.content);
  }
  const count = (p: string) => corpus.files.filter((f) => f.path.startsWith(p)).length;
  console.log(`docs: ${count('docs/')} arquivos | chamados: ${corpus.tickets.length} | fatos: ${corpus.facts.length}`);
  console.log(`perguntas dev: ${corpus.questions.dev.length} | políticas: ${corpus.questions.policies.length} | heldout: ${corpus.questions.heldout.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
