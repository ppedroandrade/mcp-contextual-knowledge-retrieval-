import { inflateRawSync } from 'node:zlib';
import type { Section } from './types.js';

/**
 * Extração de texto dos formatos aceitos no upload e nos conectores. Cada formato vira uma
 * lista de seções (título da seção + texto); a segmentação em trechos fica em `chunk.ts`.
 */

export const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.html', '.htm', '.csv', '.json', '.pdf', '.docx'] as const;

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
  '.csv': 'text/csv', '.json': 'application/json', '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export class UnsupportedFormatError extends Error {}

export function mimeFromName(fileName: string): string | undefined {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? undefined : MIME_BY_EXT[fileName.slice(i).toLowerCase()];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ordm: 'º', ordf: 'ª' };
// Letras acentuadas do português: &aacute; &Atilde; &ccedil; ...
const ACCENTS: Record<string, string> = { acute: '\u0301', grave: '\u0300', tilde: '\u0303', circ: '\u0302', cedil: '\u0327', uml: '\u0308' };
for (const base of 'aeioucnAEIOUCN') for (const [name, mark] of Object.entries(ACCENTS)) {
  const ch = (base + mark).normalize('NFC');
  if (ch.length === 1) ENTITIES[base + name] = ch;
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => s.replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function htmlFragmentToText(html: string): string {
  return clean(decodeEntities(html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c.replace(/</g, '&lt;'))
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|h[1-6]|table|ul|ol|pre|blockquote|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')));
}

/** HTML (página exportada do Google Docs, página do Confluence, arquivo .html): uma seção por h1–h4. */
export function htmlToSections(html: string, fallbackTitle = ''): { title: string; sections: Section[] } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '') || fallbackTitle;
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html)
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const sections: Section[] = [];
  const parts = body.split(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
  const first = htmlFragmentToText(parts[0]!);
  if (first) sections.push({ heading: '', text: first });
  for (let i = 1; i < parts.length; i += 2) {
    const heading = htmlFragmentToText(parts[i]!).replace(/\n/g, ' ');
    const text = htmlFragmentToText(parts[i + 1] ?? '');
    if (heading || text) sections.push({ heading, text });
  }
  return { title, sections: sections.filter((s) => s.text) };
}

/** Markdown: uma seção por título `#`, `##` ou `###`; front-matter descartado. */
export function markdownToSections(md: string): { title: string; sections: Section[] } {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  const sections: Section[] = [];
  let title = '';
  let heading = '';
  let buf: string[] = [];
  const flush = () => {
    const text = clean(buf.join('\n'));
    if (text) sections.push({ heading, text });
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (m) {
      flush();
      heading = m[2]!;
      if (!title && m[1] === '#') title = heading;
    } else buf.push(line);
  }
  flush();
  return { title, sections };
}

function csvToSections(csv: string): Section[] {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  if (rows.length === 0) return [];
  const [header, ...data] = rows;
  // Uma linha por registro, com os nomes das colunas: cada linha vira um parágrafo e a
  // segmentação junta linhas vizinhas no mesmo trecho.
  const text = data.map((r) => header!.map((h, i) => `${h.trim()}: ${(r[i] ?? '').trim()}`).join('; ')).join('\n\n');
  return [{ heading: '', text }];
}

/** Vírgula ou ponto e vírgula (planilhas em português), pelo que aparece mais na 1ª linha. */
function detectDelimiter(csv: string): string {
  const head = csv.slice(0, csv.search(/\r?\n|$/));
  return (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** CSV com aspas (RFC 4180). */
export function parseCsv(csv: string, delimiter = detectDelimiter(csv)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function jsonToSections(json: string): Section[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new UnsupportedFormatError('JSON inválido');
  }
  const flat = (v: unknown, path: string): string[] => {
    if (v === null || typeof v !== 'object') return [`${path}: ${String(v)}`];
    if (Array.isArray(v)) return v.flatMap((x, i) => flat(x, `${path}[${i}]`));
    return Object.entries(v).flatMap(([k, x]) => flat(x, path ? `${path}.${k}` : k));
  };
  const items = Array.isArray(value) ? value : [value];
  return [{ heading: '', text: items.map((it) => flat(it, '').join('\n')).join('\n\n') }];
}

/** Lê uma entrada de um arquivo ZIP (só o necessário para o .docx: armazenado ou deflate). */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  // Fim do diretório central: assinatura 0x06054b50 nos últimos 64 KiB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new UnsupportedFormatError('arquivo .docx corrompido (ZIP sem diretório central)');
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new UnsupportedFormatError(`compressão ZIP não suportada (${method})`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** .docx: parágrafos de word/document.xml; estilos de título (Heading/Título) abrem seções. */
export function docxToSections(data: Buffer): { title: string; sections: Section[] } {
  const xml = readZipEntry(data, 'word/document.xml')?.toString('utf8');
  if (!xml) throw new UnsupportedFormatError('arquivo .docx sem word/document.xml');
  const sections: Section[] = [];
  let title = '';
  let heading = '';
  let buf: string[] = [];
  const flush = () => {
    const text = clean(buf.join('\n'));
    if (text) sections.push({ heading, text });
    buf = [];
  };
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const text = decodeEntities([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map((m) => m[1] ?? (m[0] === '<w:tab/>' ? '\t' : '\n')).join('')).trim();
    if (!text) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    // Ids dos estilos: "Title"/"Heading1" no Word em inglês, "Ttulo"/"Ttulo1" no Word em português.
    if (/^(title|t[ií]?tulo|ttulo)$/i.test(style)) { title ||= text; continue; }
    if (/^(heading|t[ií]?tulo|ttulo)\s*\d$/i.test(style)) { flush(); heading = text; title ||= text; continue; }
    buf.push(text);
  }
  flush();
  return { title, sections };
}

async function pdfToSections(data: Buffer): Promise<Section[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ heading: `página ${i + 1}`, text: clean(t) })).filter((s) => s.text);
}

export interface Extracted {
  title: string;
  sections: Section[];
}

/** Extrai as seções de um arquivo pelo tipo MIME (ou pela extensão do nome). */
export async function extractSections(data: Buffer, mimeType: string | undefined, fileName = ''): Promise<Extracted> {
  const mime = (mimeType && mimeType !== 'application/octet-stream' ? mimeType : mimeFromName(fileName)) ?? '';
  const base = fileName.replace(/\.[^.]+$/, '');
  const text = () => data.toString('utf8').replace(/^﻿/, '');
  let out: Extracted;
  if (mime.startsWith('text/markdown')) {
    const md = markdownToSections(text());
    out = { title: md.title || base, sections: md.sections };
  } else if (mime.startsWith('text/html')) out = htmlToSections(text(), base);
  else if (mime.startsWith('text/csv')) out = { title: base, sections: csvToSections(text()) };
  else if (mime.startsWith('application/json')) out = { title: base, sections: jsonToSections(text()) };
  else if (mime === 'application/pdf') out = { title: base, sections: await pdfToSections(data) };
  else if (mime === MIME_BY_EXT['.docx']) {
    const d = docxToSections(data);
    out = { title: d.title || base, sections: d.sections };
  } else if (mime.startsWith('text/')) out = { title: base, sections: [{ heading: '', text: clean(text()) }] };
  else throw new UnsupportedFormatError(`formato não suportado${fileName ? ` (${fileName})` : ''}; use ${SUPPORTED_EXTENSIONS.join(', ')}`);
  return { title: out.title || base || 'sem título', sections: out.sections.filter((s) => s.text) };
}
