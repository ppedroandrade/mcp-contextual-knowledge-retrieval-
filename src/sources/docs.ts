import type { EvidenceUnit } from '../core/types.js';
import { slugify } from '../corpus/model.js';

/** Wiki técnica: um arquivo Markdown por documento, com front-matter e seções `##`. */
export function parseMarkdownDoc(content: string): EvidenceUnit[] {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!fm) throw new Error('documento sem front-matter');
  const meta = Object.fromEntries(
    fm[1]!.split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  const id = meta.id;
  const title = meta.title;
  if (!id || !title) throw new Error('front-matter sem id ou title');
  const body = content.slice(fm[0].length);
  const parts = body.split(/^## (.+)$/m);
  const units: EvidenceUnit[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]!.trim();
    units.push({ id: `${id}#${slugify(heading)}`, docId: id, source: 'docs', title, heading, text: parts[i + 1]!.trim() });
  }
  return units;
}
