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
