import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { EvidenceUnit, SourceName } from '../../src/core/types.js';
import { buildCorpus, DATA_DIR, outputFiles, type Corpus } from '../../src/corpus/generate.js';
import { loadSource, parseSource } from '../../src/sources/index.js';

const SOURCES: SourceName[] = ['docs', 'tickets', 'incidents', 'policies'];

let corpus: Corpus;
let units: Map<string, EvidenceUnit>;

beforeAll(() => {
  corpus = buildCorpus();
  units = new Map(SOURCES.flatMap((s) => parseSource(s, corpus.files)).map((u) => [u.id, u]));
});

describe('geração do corpus', () => {
  it('é determinística', () => {
    expect(buildCorpus()).toEqual(corpus);
  });

  it('muda quando a semente muda', () => {
    expect(buildCorpus(1).questions.dev).not.toEqual(corpus.questions.dev);
  });

  it('os arquivos versionados em data/ estão atualizados (rode npm run corpus)', () => {
    for (const f of outputFiles(corpus)) {
      expect(readFileSync(join(DATA_DIR, f.path), 'utf8'), f.path).toBe(f.content);
    }
  });

  it('tem o tamanho previsto em docs/corpus.md', () => {
    const per = (s: SourceName) => new Set([...units.values()].filter((u) => u.source === s).map((u) => u.docId)).size;
    expect(per('docs')).toBe(26);
    expect(per('tickets')).toBe(80);
    expect(per('incidents')).toBe(25);
    expect(per('policies')).toBe(15);
  });
});

describe('fontes', () => {
  it('ler do disco dá as mesmas unidades que a geração em memória', () => {
    for (const s of SOURCES) expect(loadSource(s)).toEqual(parseSource(s, corpus.files));
  });

  it('ids de unidade são únicos e nenhuma unidade é vazia', () => {
    const all = SOURCES.flatMap((s) => parseSource(s, corpus.files));
    expect(new Set(all.map((u) => u.id)).size).toBe(all.length);
    for (const u of all) expect(u.text.length, u.id).toBeGreaterThan(0);
  });

  it('cada fato aparece literalmente no texto da sua unidade', () => {
    for (const f of corpus.facts) {
      const u = units.get(f.unitId);
      expect(u, f.id).toBeDefined();
      expect(u!.text, f.id).toContain(f.value);
    }
  });
});

describe('perguntas', () => {
  const all = () => [...corpus.questions.dev, ...corpus.questions.policies];

  it('dev tem 30 de fonte única, 24 multifonte e 6 sem resposta', () => {
    const count = (t: string) => corpus.questions.dev.filter((q) => q.type === t).length;
    expect([count('single-source'), count('multi-source'), count('unanswerable')]).toEqual([30, 24, 6]);
    expect(corpus.questions.policies).toHaveLength(15);
  });

  it('ids e textos são únicos', () => {
    expect(new Set(all().map((q) => q.id)).size).toBe(all().length);
    expect(new Set(all().map((q) => q.text)).size).toBe(all().length);
  });

  it('toda evidência existe no corpus e é coerente com documentos e fontes', () => {
    for (const q of all()) {
      for (const alternatives of q.evidence) {
        for (const id of alternatives) {
          const u = units.get(id);
          expect(u, `${q.id}: ${id}`).toBeDefined();
          expect(q.relevantDocIds).toContain(u!.docId);
          expect(q.sources).toContain(u!.source);
        }
      }
    }
  });

  it('perguntas multifonte exigem evidências de pelo menos duas fontes', () => {
    for (const q of all().filter((q) => q.type === 'multi-source')) {
      expect(q.sources.length, q.id).toBeGreaterThanOrEqual(2);
      expect(q.evidence.length, q.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('perguntas sem resposta não têm evidência e tratam de algo ausente do corpus', () => {
    const unanswerable = corpus.questions.dev.filter((q) => q.type === 'unanswerable');
    for (const q of unanswerable) expect(q.evidence, q.id).toEqual([]);
    const text = [...units.values()].map((u) => u.text).join('\n');
    for (const term of ['ledger-service', '12/10/2026', '2026-10-12', 'GraphQL', 'aplicativo móvel', 'por transação']) {
      expect(text).not.toContain(term);
    }
  });

  it('o conjunto dev não depende da fonte de políticas (reservada para a H3)', () => {
    for (const q of corpus.questions.dev) expect(q.sources).not.toContain('policies');
  });
});
