import { describe, expect, it } from 'vitest';
import { evaluateAnswers, summarizeAnswers } from '../../src/bench/answers.js';
import type { EvidenceUnit, Question } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import type { Fact } from '../../src/corpus/model.js';
import { cohenKappa, krippendorffAlpha } from '../../src/evaluation/agreement.js';
import { checkFacts, factAnswerValue } from '../../src/evaluation/facts.js';
import { blindSheet, evaluatorInstructions, parseRatings, SHEET_COLUMNS, summarizeRatings } from '../../src/evaluation/human.js';
import { distinctItems, type AnsweredQuestion } from '../../src/evaluation/items.js';
import { buildJudgeMessages, JUDGE_PROMPT_SHA256, JUDGE_SCHEMA, judgeItem } from '../../src/evaluation/judge.js';
import { CRITERIA, RUBRIC, scoresByRule } from '../../src/evaluation/rubric.js';
import type { CompletionOptions, LlmProvider } from '../../src/generation/provider.js';
import { SimulatedProvider } from '../../src/generation/simulated.js';
import { parseCsv } from '../../src/sources/csv.js';

const fact = (id: string, value: string): Fact => ({ id, value, unitId: 'u#x', docId: 'u', source: 'docs' });
const unit = (id: string, source: EvidenceUnit['source'] = 'docs'): EvidenceUnit =>
  ({ id, docId: id.split('#')[0]!, source, title: `Título ${id}`, heading: 'Seção', text: `texto de ${id}` });
const question = (id: string, type: Question['type'], factIds: string[] = []): Question => ({
  id, type, set: 'dev', text: `pergunta ${id}?`, sources: [], relevantDocIds: [], evidence: [], factIds,
  referenceAnswer: `referência ${id}`,
});
const answered = (questionId: string, retriever: string, contextUnitIds: string[], text: string, abstained = false): AnsweredQuestion =>
  ({ questionId, retriever, answer: { contextUnitIds, text, abstained } });

describe('checagem por regra', () => {
  it('compara o valor do fato sem o rótulo de campo do corpus', () => {
    expect(factAnswerValue('Serviço afetado: payments-adapter')).toBe('payments-adapter');
    expect(factAnswerValue('Severidade: SEV1')).toBe('SEV1');
    expect(factAnswerValue('https://status.orbital.example')).toBe('https://status.orbital.example');
    expect(factAnswerValue('99,5% dos e-mails aceitos')).toBe('99,5% dos e-mails aceitos');
  });

  it('separa o fato literal (em sequência) da cobertura de termos (paráfrase)', () => {
    const f = [fact('a', 'regra de firewall nova bloqueou a saída')];
    expect(checkFacts('A causa foi uma regra de firewall nova, que bloqueou a saída.', f)).toEqual({ literal: 1, coverage: 1 });
    expect(checkFacts('Uma nova regra de firewall bloqueou a saída.', f)).toEqual({ literal: 0, coverage: 1 });
    expect(checkFacts('Foi o firewall.', f).coverage).toBeCloseTo(0.2);
  });

  it('dá a fração dos fatos presentes quando a pergunta depende de vários', () => {
    const f = [fact('a', 'Serviço afetado: payments-adapter'), fact('b', '/actuator/health/payments')];
    const c = checkFacts('O serviço afetado foi o payments-adapter.', f);
    expect(c.literal).toBe(0.5);
    expect(c.coverage).toBeCloseTo((1 + 1 / 3) / 2); // "payments" também é termo do segundo fato
    expect(checkFacts('qualquer', []).literal).toBeNaN();
  });

  it('todo fato usado nas perguntas tem termos para conferir', () => {
    const corpus = buildCorpus();
    const byId = new Map(corpus.facts.map((f) => [f.id, f]));
    const used = [...corpus.questions.dev, ...corpus.questions.policies].flatMap((q) => q.factIds.map((id) => byId.get(id)!));
    expect(used.length).toBeGreaterThan(0);
    for (const f of used) expect(() => checkFacts('', [f]), f.id).not.toThrow();
  });
});

describe('itens distintos', () => {
  const questions = [question('q1', 'single-source'), question('q2', 'unanswerable')];
  const units = ['A#1', 'B#1', 'C#1'].map((id) => unit(id));
  const results = [
    answered('q1', 'B-rag', ['A#1', 'B#1'], 'Resposta [A#1].'),
    answered('q1', 'C-por-fonte', ['A#1', 'C#1'], 'Resposta [A#1].'),
    answered('q1', 'D-mcp', ['A#1', 'C#1'], 'Resposta [A#1].'),
    answered('q2', 'B-rag', ['C#1'], 'Não sei.', true),
    answered('q2', 'C-por-fonte', ['C#1'], 'Não sei.', true),
    answered('q2', 'D-mcp', ['C#1'], 'Não sei.', true),
  ];

  it('avalia uma vez cada resposta distinta, com os trechos na chave', () => {
    const items = distinctItems(results, questions, units);
    expect(items.map((i) => [i.questionId, i.approaches])).toEqual([
      ['q1', ['B-rag']],
      ['q1', ['C-por-fonte', 'D-mcp']],
      ['q2', ['B-rag', 'C-por-fonte', 'D-mcp']],
    ]);
    expect(items[0]!.context[1]).toEqual({ unitId: 'B#1', source: 'docs', text: 'Título B#1\nSeção\ntexto de B#1' });
  });

  it('dá o mesmo id ao item independentemente da ordem das respostas', () => {
    const a = distinctItems(results, questions, units).map((i) => i.key);
    const b = distinctItems([...results].reverse(), questions, units).map((i) => i.key);
    expect(b).toEqual(a);
  });

  it('falha se a resposta cita uma unidade fora do corpus', () => {
    expect(() => distinctItems([answered('q1', 'B-rag', ['X#9'], 'r')], questions, units)).toThrow(/X#9/);
  });
});

describe('concordância', () => {
  it('reproduz o exemplo de Krippendorff (2011)', () => {
    const _ = null;
    const data = [
      [1, 2, 3, 3, 2, 1, 4, 1, 2, _, _, _],
      [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, _, 3],
      [_, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, _],
      [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, _],
    ];
    expect(krippendorffAlpha(data, 'nominal')).toBeCloseTo(0.743, 3);
    expect(krippendorffAlpha(data, 'ordinal')).toBeCloseTo(0.815, 3);
    expect(krippendorffAlpha(data, 'interval')).toBeCloseTo(0.849, 3);
  });

  it('vale 1 com concordância total e é indefinido sem variação', () => {
    expect(krippendorffAlpha([[1, 2, 3], [1, 2, 3]], 'ordinal')).toBe(1);
    expect(krippendorffAlpha([[4, 4], [4, 4]], 'ordinal')).toBeNaN();
  });

  it('calcula o kappa de Cohen para classificações binárias', () => {
    expect(cohenKappa([true, true, false, false], [true, false, false, false])).toBeCloseTo(0.5);
    expect(() => cohenKappa([true], [])).toThrow();
  });
});

describe('juiz', () => {
  const item = distinctItems([answered('q1', 'B-rag', ['A#1'], 'Resposta [A#1].')], [question('q1', 'single-source')], [unit('A#1', 'incidents')])[0]!;

  it('é fixo: mudar o prompt ou o esquema exige atualizar este teste de propósito', () => {
    expect(JUDGE_PROMPT_SHA256).toBe('55704e0b6fed1386e022c70e5a4d1514574e44f7a913b29d3b43c68cb997278a');
  });

  it('mostra a rubrica, a referência, os trechos e a resposta', () => {
    const [system, user] = buildJudgeMessages(item);
    for (const c of CRITERIA) expect(system!.content).toContain(RUBRIC[c].text);
    expect(user!.content).toBe(
      'Pergunta: pergunta q1?\n\nResposta de referência: referência q1\n\n'
      + 'Trechos entregues ao assistente:\n\n[A#1] (fonte: Registros de incidentes)\nTítulo A#1\nSeção\ntexto de A#1\n\n'
      + 'Resposta a avaliar: Resposta [A#1].',
    );
    expect(JUDGE_SCHEMA.required).toEqual([...CRITERIA]);
  });

  it('pede a saída estruturada e lê as três notas', async () => {
    let seen: CompletionOptions | undefined;
    const llm: LlmProvider = {
      name: 'x',
      async complete(_m, options) { seen = options; return { text: '{"correcao":5,"completude":4,"sustentacao":3}', promptTokens: null, outputTokens: null, loadMs: null, truncated: false }; },
      async describe() { return {}; },
    };
    expect(await judgeItem(llm, item)).toEqual({ correcao: 5, completude: 4, sustentacao: 3 });
    expect(seen).toEqual({ format: JUDGE_SCHEMA });
  });

  it('falha se a saída não for JSON ou trouxer nota fora de 1 a 5', async () => {
    await expect(judgeItem(new SimulatedProvider(() => 'nota 5'), item)).rejects.toThrow(/não devolveu JSON/);
    await expect(judgeItem(new SimulatedProvider(() => '{"correcao":6,"completude":1,"sustentacao":1}'), item)).rejects.toThrow(/correcao/);
    await expect(judgeItem(new SimulatedProvider(() => '{"correcao":5}'), item)).rejects.toThrow(/completude/);
  });
});

describe('rubrica fixada por regra', () => {
  it('fixa as notas de quem diz que não sabe e de quem afirma sem haver resposta no corpus', () => {
    expect(scoresByRule({ type: 'unanswerable', abstained: true })).toEqual({ correcao: 5, completude: 5, sustentacao: 5 });
    expect(scoresByRule({ type: 'multi-source', abstained: true })).toEqual({ correcao: 1, completude: 1, sustentacao: 5 });
    expect(scoresByRule({ type: 'unanswerable', abstained: false })).toEqual({ correcao: 1, completude: 1 });
    expect(scoresByRule({ type: 'single-source', abstained: false })).toEqual({});
  });
});

describe('avaliação das respostas (regra + juiz)', () => {
  const questions = [question('q1', 'single-source', ['f1']), question('q2', 'unanswerable'), question('q3', 'single-source', ['f1'])];
  const facts = new Map([['f1', fact('f1', 'Time Faturamento')]]);
  const items = distinctItems([
    answered('q1', 'B-rag', ['A#1'], 'É o Time Faturamento [A#1].'),
    answered('q1', 'C-por-fonte', ['B#1'], 'É o Time Plataforma [B#1].'),
    answered('q1', 'D-mcp', ['B#1'], 'É o Time Plataforma [B#1].'),
    ...['B-rag', 'C-por-fonte', 'D-mcp'].flatMap((a) => [answered('q2', a, ['B#1'], 'Não sei.', true), answered('q3', a, ['B#1'], 'Não sei.', true)]),
  ], questions, [unit('A#1'), unit('B#1')]);
  // Juiz simulado: acerta B em q1, erra C/D em q1 e (como os juízes reais) aceita toda abstenção.
  const judge = new SimulatedProvider((m) => (m[1]!.content.includes('Time Plataforma')
    ? '{"correcao":1,"completude":1,"sustentacao":5}'
    : '{"correcao":5,"completude":5,"sustentacao":5}'));

  it('chama o juiz só onde a rubrica não fixa a nota e copia a nota de C para D', async () => {
    const evals = await evaluateAnswers(items, questions, facts, judge, 2);
    expect(evals.map((e) => [e.questionId, e.judge.length])).toEqual([['q1', 2], ['q1', 2], ['q2', 0], ['q3', 0]]);
    const s = summarizeAnswers(evals);
    expect(s.porAbordagem['B-rag']).toMatchObject({ perguntas: 3, regraFatosLiterais: 0.5, regraAcerto: 2 / 3, rubricaAcerto: 2 / 3, correcao: 11 / 3 });
    expect(s.porAbordagem['C-por-fonte']).toEqual(s.porAbordagem['D-mcp']);
    expect(s.porAbordagem['D-mcp']).toMatchObject({ regraAcerto: 1 / 3, rubricaAcerto: 1 / 3, correcao: 7 / 3, sustentacao: 5 });
    expect(s.juizXRegra).toMatchObject({ itens: 2, concordancia: 1, kappa: 1, regraAcertaJuizNao: [], regraErraJuizSim: [] });
    expect(s.repetibilidade).toMatchObject({ repeticoes: 2, itensIdenticos: 1 });
    expect(s).not.toHaveProperty('juizNosCasosFixos');
  });

  it('com judgeAll, mede se o juiz segue a rubrica nos casos fixos', async () => {
    const evals = await evaluateAnswers(items, questions, facts, judge, 1, { judgeAll: true });
    expect(evals.every((e) => e.judge.length === 1)).toBe(true);
    const s = summarizeAnswers(evals);
    const q3 = evals.find((e) => e.questionId === 'q3')!;
    expect(s.juizNosCasosFixos).toEqual({ itens: 2, correcaoDivergente: [q3.key] });
    expect(q3.scores!.correcao).toBe(1); // a nota final segue a rubrica, não o juiz
  });

  it('sem juiz, resume só a regra', async () => {
    const s = summarizeAnswers(await evaluateAnswers(items, questions, facts, null, 3));
    expect(s.porAbordagem['B-rag']).not.toHaveProperty('correcao');
    expect(s).not.toHaveProperty('juizXRegra');
    expect(s).not.toHaveProperty('repetibilidade');
  });
});

describe('planilha cega', () => {
  const questions = [question('q1', 'single-source'), question('q2', 'single-source')];
  const items = distinctItems([
    answered('q1', 'B-rag', ['A#1'], 'Resposta B'),
    answered('q1', 'C-por-fonte', ['B#1'], 'Resposta CD'),
    answered('q1', 'D-mcp', ['B#1'], 'Resposta CD'),
    answered('q2', 'B-rag', ['A#1'], 'Outra B'),
    answered('q2', 'C-por-fonte', ['B#1'], 'Outra CD'),
    answered('q2', 'D-mcp', ['B#1'], 'Outra CD'),
  ], questions, [unit('A#1'), unit('B#1', 'tickets')]);

  it('tem uma linha por resposta distinta e nenhuma pista da abordagem', () => {
    const { csv, key } = blindSheet(items, 7);
    expect(csv.startsWith('﻿')).toBe(true);
    const [header, ...rows] = parseCsv(csv.slice(1), ';');
    expect(header).toEqual([...SHEET_COLUMNS]);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[0])).toEqual(['R001', 'R002', 'R003', 'R004']);
    expect(csv).not.toMatch(/B-rag|C-por-fonte|D-mcp|MCP/);
    expect(Object.values(key).map((k) => k.approaches.join('+')).sort()).toEqual(['B-rag', 'B-rag', 'C-por-fonte+D-mcp', 'C-por-fonte+D-mcp']);
    expect(blindSheet(items, 7)).toEqual(blindSheet(items, 7));
  });

  it('lê as notas preenchidas e resume a concordância e a média por abordagem', () => {
    const { csv, key } = blindSheet(items, 7);
    const ids = Object.keys(key).sort();
    const fill = (scores: Record<string, string>, sep = ';') => {
      const [header, ...rows] = parseCsv(csv.slice(1), ';');
      const i = header!.indexOf('correcao');
      return [header!, ...rows.map((r) => r.map((v, j) => (j >= i && j < i + 3 ? scores[r[0]!] ?? '' : v)))]
        .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(sep)).join('\n');
    };
    const cd = ids.filter((id) => key[id]!.approaches.includes('D-mcp'));
    const a = parseRatings(fill(Object.fromEntries(ids.map((id) => [id, cd.includes(id) ? '2' : '4,0']))), key);
    const b = parseRatings(fill(Object.fromEntries(ids.map((id) => [id, cd.includes(id) ? '2' : '5'])), ','), key);
    expect(a.get(ids[0]!)).toEqual(cd.includes(ids[0]!) ? { correcao: 2, completude: 2, sustentacao: 2 } : { correcao: 4, completude: 4, sustentacao: 4 });
    const s = summarizeRatings([{ name: 'a', ratings: a }, { name: 'b', ratings: b }], key);
    expect(s.porAbordagem['C-por-fonte']).toEqual(s.porAbordagem['D-mcp']);
    expect(s.porAbordagem['D-mcp']).toMatchObject({ itens: 2, correcao: 2 });
    expect(s.porAbordagem['B-rag']).toMatchObject({ itens: 2, correcao: 4.5 });
    expect(s.concordancia.correcao).toBeGreaterThan(0.5);
  });

  it('recusa item desconhecido e nota fora de 1 a 5', () => {
    const { key } = blindSheet(items, 7);
    expect(() => parseRatings('item;correcao;completude;sustentacao\nR999;5;5;5', key)).toThrow(/R999/);
    expect(() => parseRatings('item;correcao;completude;sustentacao\nR001;7;5;5', key)).toThrow(/R001/);
    expect(parseRatings('item;correcao;completude;sustentacao\nR001;;;', key).get('R001')).toEqual({});
  });

  it('as instruções trazem a mesma rubrica do juiz', () => {
    const text = evaluatorInstructions(4);
    for (const c of CRITERIA) expect(text).toContain(RUBRIC[c].text);
  });
});
