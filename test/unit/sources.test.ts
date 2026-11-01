import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../../src/sources/csv.js';
import { parseMarkdownDoc } from '../../src/sources/docs.js';
import { escapeHtml } from '../../src/corpus/render/policies.js';
import { parseSource } from '../../src/sources/index.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { sourcesFor } from '../../src/bench/setup.js';

describe('csv', () => {
  it('preserva vírgulas, aspas e quebras de linha', () => {
    const rows = [['a', 'b,c', 'diz "oi"'], ['linha\nnova', '', 'fim']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('4ª fonte (políticas, HTML) antes da H3', () => {
  it('o gerador escapa o HTML', () => {
    expect(escapeHtml('A & B < C > D "E"')).toBe('A &amp; B &lt; C &gt; D &quot;E&quot;');
  });

  it('o sistema ainda não lê as políticas nem monta o conjunto policies (ADR 009)', () => {
    expect(() => parseSource('policies', buildCorpus().files)).toThrow(/ainda não está integrada/);
    expect(() => sourcesFor('policies')).toThrow(/ainda não integrada/);
  });
});

describe('markdown', () => {
  it('divide o documento por seções ## e usa o título do front-matter', () => {
    const md = '---\nid: DOC-999\ntitle: Guia X\n---\n\n# Guia X\n\n## Quando usar\n\nSempre.\n\n## Limites e observações\n\nNenhum.\n';
    const units = parseMarkdownDoc(md);
    expect(units.map((u) => u.id)).toEqual(['DOC-999#quando-usar', 'DOC-999#limites-e-observacoes']);
    expect(units[1]!.text).toBe('Nenhum.');
    expect(units[0]!.title).toBe('Guia X');
  });

  it('rejeita documento sem front-matter', () => {
    expect(() => parseMarkdownDoc('# sem metadados')).toThrow();
  });
});
