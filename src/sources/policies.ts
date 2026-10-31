import type { EvidenceUnit } from '../core/types.js';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const stripTags = (s: string) => unescapeHtml(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

/** Políticas internas: um arquivo HTML por política, com uma `<section id>` por tópico. */
export function parsePolicyHtml(html: string): EvidenceUnit[] {
  const id = /<meta name="doc-id" content="([^"]+)"/.exec(html)?.[1];
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
  if (!id || !title) throw new Error('política sem doc-id ou title');
  const units: EvidenceUnit[] = [];
  for (const m of html.matchAll(/<section id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/g)) {
    units.push({
      id: `${id}#${m[1]}`, docId: id, source: 'policies', title: unescapeHtml(title),
      heading: stripTags(m[2]!), text: stripTags(m[3]!),
    });
  }
  return units;
}
