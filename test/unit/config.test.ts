import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadConfig } from '../../src/core/config.js';

describe('loadConfig', () => {
  it('usa os padrões quando o ambiente está vazio', () => {
    expect(loadConfig({})).toEqual(DEFAULTS);
  });

  it('lê os valores do ambiente', () => {
    const cfg = loadConfig({ PG_URL: 'postgres://x', EMBEDDING_MODEL: 'outro', LLM_MODEL: 'm' });
    expect(cfg.pgUrl).toBe('postgres://x');
    expect(cfg.embeddingModel).toBe('outro');
    expect(cfg.llmModel).toBe('m');
    expect(cfg.ollamaUrl).toBe(DEFAULTS.ollamaUrl);
  });

  it('trata variável vazia como ausente', () => {
    expect(loadConfig({ PG_URL: '' }).pgUrl).toBe(DEFAULTS.pgUrl);
  });
});
