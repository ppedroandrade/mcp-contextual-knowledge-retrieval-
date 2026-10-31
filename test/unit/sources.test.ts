import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../../src/sources/csv.js';
import { parseMarkdownDoc } from '../../src/sources/docs.js';
import { escapeHtml, parsePolicyHtml, unescapeHtml } from '../../src/sources/policies.js';

describe('csv', () => {
  it('preserva vírgulas, aspas e quebras de linha', () => {
    const rows = [['a', 'b,c', 'diz "oi"'], ['linha\nnova', '', 'fim']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('html', () => {
  it('escapa e desescapa caracteres especiais', () => {
    const s = 'A & B < C > D "E"';
    expect(unescapeHtml(escapeHtml(s))).toBe(s);
  });

  it('extrai seções de uma política', () => {
    const html = '<meta name="doc-id" content="POL-99"><title>Teste &amp; cia</title>'
      + '<section id="regra">\n<h2>Regra</h2>\n<p>Texto &lt;importante&gt;.</p>\n</section>';
    expect(parsePolicyHtml(html)).toEqual([
      { id: 'POL-99#regra', docId: 'POL-99', source: 'policies', title: 'Teste & cia', heading: 'Regra', text: 'Texto <importante>.' },
    ]);
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
