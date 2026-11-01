import { extname } from 'node:path';

/** Documento lido de qualquer formato: título e seções (título da seção + texto). */
export interface ParsedDocument {
  title: string;
  sections: { heading: string; text: string }[];
}

/** Formatos aceitos no upload e nos conectores. */
export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt', '.html', '.htm', '.csv', '.json'] as const;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Texto de um trecho de HTML: sem tags, com entidades resolvidas e espaços normalizados. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Seções de um HTML, cortadas nos títulos h1–h3. O texto antes do 1º título vira "Introdução". */
export function htmlToSections(html: string, fallbackTitle: string): ParsedDocument {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const title = htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || htmlText(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '') || fallbackTitle;
  const parts = body.split(/(<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>)/i);
  const sections: ParsedDocument['sections'] = [];
  let heading = 'Introdução';
  for (const part of parts) {
    const h = part.match(/^<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>$/i);
    if (h) { heading = htmlText(h[1]!) || heading; continue; }
    const text = htmlText(part);
    if (text) sections.push({ heading, text });
  }
  return { title, sections };
}

/** Seções de um Markdown, cortadas nos títulos `#` a `###` (front-matter YAML ignorado). */
export function markdownToSections(md: string, fallbackTitle: string): ParsedDocument {
  const lines = md.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\r?\n/);
  let title = '';
  let heading = 'Introdução';
  let buffer: string[] = [];
  const sections: ParsedDocument['sections'] = [];
  const flush = () => {
    const text = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text) sections.push({ heading, text });
    buffer = [];
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      if (h[1] === '#' && !title) title = h[2]!.trim();
      heading = h[2]!.trim();
    } else buffer.push(line);
  }
  flush();
  return { title: title || fallbackTitle, sections };
}

/** Texto corrido: uma seção só; a divisão em trechos fica com `chunkDocument`. */
export function textToSections(text: string, title: string): ParsedDocument {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, sections: clean ? [{ heading: 'Conteúdo', text: clean }] : [] };
}

/** Lê um arquivo pelo nome (extensão) e devolve o título e as seções. */
export async function parseFile(name: string, data: Buffer): Promise<ParsedDocument> {
  const ext = extname(name).toLowerCase();
  // Sem título no próprio arquivo, o nome vira título: "Politica-de-Home_Office" → "Politica de Home Office".
  const base = name.slice(0, name.length - ext.length).replace(/[-_]+/g, ' ').trim() || name;
  switch (ext) {
    case '.md':
    case '.markdown':
      return markdownToSections(data.toString('utf8'), base);
    case '.html':
    case '.htm':
      return htmlToSections(data.toString('utf8'), base);
    case '.txt':
    case '.csv':
    case '.json':
      return textToSections(data.toString('utf8'), base);
    case '.docx': {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.convertToHtml({ buffer: data });
      const doc = htmlToSections(value, base);
      return { ...doc, title: doc.title === 'Introdução' ? base : doc.title };
    }
    case '.pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: false });
      const pages = (Array.isArray(text) ? text : [text]).map((t, i) => ({ heading: `Página ${i + 1}`, text: t.replace(/[ \t]+/g, ' ').trim() }));
      return { title: base, sections: pages.filter((p) => p.text) };
    }
    default:
      throw new Error(`formato não suportado: ${ext || name}; use ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
}

/** Trecho indexável: o texto vai para o embedding com o título do documento e da seção. */
export interface DocumentChunk {
  heading: string;
  text: string;
}

/**
 * Divide as seções em trechos de até `maxChars`, respeitando parágrafos e, se preciso,
 * frases. Trechos curtos da mesma seção são juntados.
 */
export function chunkDocument(doc: ParsedDocument, maxChars = 1200): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const { heading, text } of doc.sections) {
    const pieces = text.split(/\n{2,}/).flatMap((p) => (p.length <= maxChars ? [p] : p.match(new RegExp(`[^]{1,${maxChars}}(?=\\s|$)|[^]{1,${maxChars}}`, 'g')) ?? [p]));
    let current = '';
    for (const piece of pieces.map((p) => p.trim()).filter(Boolean)) {
      if (current && current.length + piece.length + 2 > maxChars) {
        chunks.push({ heading, text: current });
        current = '';
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
    if (current) chunks.push({ heading, text: current });
  }
  return chunks;
}
