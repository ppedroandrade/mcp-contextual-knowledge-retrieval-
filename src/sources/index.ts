import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceUnit, SourceName } from '../core/types.js';
import type { GeneratedFile } from '../corpus/model.js';
import { parseMarkdownDoc } from './docs.js';
import { parseIncidents } from './incidents.js';
import { parseTickets } from './tickets.js';

export const CORPUS_DIR = join(import.meta.dirname, '..', '..', 'data', 'corpus');

/** Converte os arquivos de uma fonte (caminhos relativos a `data/corpus`) em unidades. */
export function parseSource(source: SourceName, files: GeneratedFile[]): EvidenceUnit[] {
  const mine = files.filter((f) => f.path.startsWith(`${source}/`)).sort((a, b) => a.path.localeCompare(b.path));
  const get = (path: string) => {
    const f = mine.find((x) => x.path === path);
    if (!f) throw new Error(`arquivo ausente: ${path}`);
    return f.content;
  };
  switch (source) {
    case 'docs':
      return mine.filter((f) => f.path.endsWith('.md')).flatMap((f) => parseMarkdownDoc(f.content));
    case 'tickets':
      return parseTickets(get('tickets/tickets.json'));
    case 'incidents':
      return parseIncidents(get('incidents/incidents.csv'), get('incidents/timeline.json'));
    default:
      // `policies` está no corpus, mas ainda não tem leitor: entra na medida da H3 (ADR 009).
      throw new Error(`a fonte ${source} ainda não está integrada ao sistema`);
  }
}

/** Lê do disco os arquivos de uma fonte. */
export function readSourceFiles(source: SourceName, dir = CORPUS_DIR): GeneratedFile[] {
  return readdirSync(join(dir, source)).map((name) => ({
    path: `${source}/${name}`,
    content: readFileSync(join(dir, source, name), 'utf8'),
  }));
}

export function loadSource(source: SourceName, dir = CORPUS_DIR): EvidenceUnit[] {
  return parseSource(source, readSourceFiles(source, dir));
}
