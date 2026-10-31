import type { EvidenceUnit, Hit } from '../core/types.js';

/** Texto indexado de uma unidade: título do documento, seção e conteúdo. */
export function indexText(u: EvidenceUnit): string {
  return `${u.title}\n${u.heading}\n${u.text}`;
}

export function toHit(u: EvidenceUnit, score: number): Hit {
  return { chunkId: u.id, unitId: u.id, docId: u.docId, source: u.source, text: indexText(u), score };
}
