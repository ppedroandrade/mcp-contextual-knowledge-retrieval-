import { escapeHtml } from '../../sources/policies.js';
import { FactSink, slugify, type SourceOutput } from '../model.js';
import { COMPANY, POLICIES } from '../world.js';

/** Políticas internas em HTML, uma página por política. */
export function renderPolicies(): SourceOutput {
  const sink = new FactSink('policies');
  const files = POLICIES.map((p) => {
    const sections = p.sections.map((s) => {
      const slug = slugify(s.heading);
      if (s.fact) {
        if (!s.text.includes(s.fact.value)) throw new Error(`fato ${s.fact.key} ausente em ${p.id}`);
        sink.add(`pol.${p.id}.${s.fact.key}`, s.fact.value, p.id, slug);
      }
      return `<section id="${slug}">\n<h2>${escapeHtml(s.heading)}</h2>\n<p>${escapeHtml(s.text)}</p>\n</section>`;
    });
    const content = [
      '<!DOCTYPE html>',
      '<html lang="pt-BR">',
      '<head>',
      '<meta charset="utf-8">',
      `<meta name="doc-id" content="${p.id}">`,
      `<meta name="owner" content="${escapeHtml(p.owner)}">`,
      `<title>${escapeHtml(p.title)}</title>`,
      '</head>',
      '<body>',
      '<article>',
      `<h1>${escapeHtml(p.title)}</h1>`,
      `<p class="meta">${escapeHtml(COMPANY)} · Responsável: ${escapeHtml(p.owner)}</p>`,
      ...sections,
      '</article>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
    return { path: `policies/${p.id}.html`, content };
  });
  return { files, facts: sink.facts };
}
