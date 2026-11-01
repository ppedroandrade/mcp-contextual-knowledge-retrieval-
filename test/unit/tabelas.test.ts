import { describe, expect, it } from 'vitest';
import { mdTable, num, provenance } from '../../scripts/tabelas-artigo.js';

describe('tabelas do artigo', () => {
  it('formata números com vírgula decimal e traço para ausente', () => {
    expect(num(0.5)).toBe('0,500');
    expect(num(3.14159, 2)).toBe('3,14');
    expect(num(NaN)).toBe('—');
    expect(num(null)).toBe('—');
  });

  it('monta a tabela em Markdown', () => {
    expect(mdTable(['a', 'b'], [[1, 'x']])).toBe('| a | b |\n| --- | --- |\n| 1 | x |');
  });

  it('marca em destaque as execuções sem valor experimental', () => {
    const real = provenance('r', { gitCommit: 'abcdef123', set: 'heldout', embedder: { embedder: 'ollama', model: 'bge-m3' }, llm: { llm: 'ollama', model: 'qwen3' } });
    expect(real).toContain('commit `abcdef1`');
    expect(real).not.toContain('SEM VALOR');
    expect(provenance('h', { set: 'heldout', embedder: { embedder: 'hash' } })).toContain('SEM VALOR EXPERIMENTAL:** embedder hash');
    expect(provenance('s', { set: 'heldout', llm: { llm: 'simulated' } })).toContain('LLM simulado');
    expect(provenance('d', { set: 'heldout', gitDirty: true })).toContain('árvore do git suja');
    expect(provenance('v', { set: 'dev' })).toContain('conjunto dev, não é o resultado final');
  });
});

describe('avaliação humana × juiz', () => {
  it('compara item a item e separa os itens que o juiz pontuou', async () => {
    const { compare } = await import('../../scripts/humano-x-juiz.js');
    const key = { R1: { key: 'a', questionId: 'q1', approaches: ['B-rag'] }, R2: { key: 'b', questionId: 'q2', approaches: ['B-rag'] }, R3: { key: 'c', questionId: 'q3', approaches: ['B-rag'] } };
    const s = (c: number) => ({ correcao: c, completude: c, sustentacao: 5 });
    const evals = [
      { key: 'a', judge: [s(5)], scores: s(5) },
      { key: 'b', judge: [s(2)], scores: s(2) },
      { key: 'c', judge: [], scores: s(1) },
    ] as never;
    const human = new Map([['R1', s(5)], ['R2', s(3)], ['R3', s(1)]]);
    const all = compare(human, key, evals, false);
    expect(all.correcao.itens).toBe(3);
    expect(all.correcao.notasIguais).toBeCloseTo(2 / 3, 12);
    expect(all.correcao.diferencaMedia).toBeCloseTo(1 / 3, 12);
    const judged = compare(human, key, evals, true);
    expect(judged.correcao.itens).toBe(2);
    expect(judged.correcao.notasIguais).toBe(0.5);
  });
});
