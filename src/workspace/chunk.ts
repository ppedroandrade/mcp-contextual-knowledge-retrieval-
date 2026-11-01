import type { Section, WorkspaceChunk } from './types.js';

/** Tamanho-alvo de um trecho, em caracteres (~300 tokens no bge-m3). */
export const CHUNK_CHARS = 1200;

/**
 * Divide as seções em trechos de até `max` caracteres, juntando parágrafos vizinhos da mesma
 * seção. Um parágrafo maior que o limite é quebrado por frases. Sem sobreposição: o título do
 * documento e o da seção entram no texto indexado de cada trecho (como em `indexText`).
 */
export function chunkSections(sections: Section[], max = CHUNK_CHARS): Section[] {
  const out: Section[] = [];
  for (const { heading, text } of sections) {
    const pieces = text.split(/\n{2,}/).flatMap((p) => (p.length <= max ? [p] : splitLong(p, max)));
    let buf = '';
    for (const piece of pieces) {
      if (buf && buf.length + piece.length + 2 > max) {
        out.push({ heading, text: buf });
        buf = '';
      }
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
    if (buf.trim()) out.push({ heading, text: buf });
  }
  return out;
}

function splitLong(p: string, max: number): string[] {
  const sentences = p.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [p];
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && buf.length + s.length > max) { out.push(buf.trim()); buf = ''; }
    // Frase sozinha maior que o limite: corte duro.
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
      continue;
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function buildChunks(docKey: string, sourceId: string, title: string, url: string | undefined, sections: Section[]): WorkspaceChunk[] {
  return chunkSections(sections).map((s, i) => ({
    id: `${docKey}#${i + 1}`, sourceId, docKey, title, heading: s.heading, text: s.text, ...(url ? { url } : {}),
  }));
}

/** Texto enviado ao modelo de embeddings: título, seção e conteúdo (igual a `indexText`). */
export const chunkIndexText = (c: WorkspaceChunk) => `${c.title}\n${c.heading}\n${c.text}`;
