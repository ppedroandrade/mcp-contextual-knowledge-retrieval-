import type { SourceName } from '../core/types.js';

/** Fato do "mundo" fictício, com o valor literal que aparece no texto da unidade. */
export interface Fact {
  id: string;
  value: string;
  unitId: string;
  docId: string;
  source: SourceName;
}

/** Arquivo gerado, com caminho relativo a `data/corpus`. */
export interface GeneratedFile {
  path: string;
  content: string;
}

/** Saída da renderização de uma fonte: arquivos e os fatos que eles contêm. */
export interface SourceOutput {
  files: GeneratedFile[];
  facts: Fact[];
}

/** Acumula fatos durante a renderização de uma fonte. */
export class FactSink {
  readonly facts: Fact[] = [];

  constructor(readonly source: SourceName) {}

  add(id: string, value: string, docId: string, slug: string): string {
    this.facts.push({ id, value, unitId: `${docId}#${slug}`, docId, source: this.source });
    return value;
  }
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** AAAA-MM-DD -> DD/MM/AAAA */
export function brDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthName(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1]!;
}
