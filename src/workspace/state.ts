import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Conversation, WorkspaceDoc, WorkspaceSource } from './types.js';

export interface StateData {
  /** Embedder com que o índice foi construído; se mudar, o índice é refeito. */
  embedder: string;
  nextDocNumber: number;
  sources: WorkspaceSource[];
  docs: WorkspaceDoc[];
  conversations: Conversation[];
}

const empty = (embedder: string): StateData => ({ embedder, nextDocNumber: 1, sources: [], docs: [], conversations: [] });

function writeAtomic(file: string, content: string, mode?: number) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, mode ? { mode } : undefined);
  renameSync(tmp, file);
  if (mode) chmodSync(file, mode);
}

/**
 * Estado do workspace em arquivos locais: `workspace.json` (fontes, documentos e conversas) e
 * `credentials.json` (tokens dos conectores, permissão 600). `dir = null` mantém tudo só em
 * memória (testes).
 */
export class WorkspaceState {
  data: StateData;
  private secrets: Record<string, Record<string, string>>;

  constructor(readonly dir: string | null, embedder: string) {
    if (dir) mkdirSync(dir, { recursive: true });
    this.data = dir && existsSync(join(dir, 'workspace.json'))
      ? { ...empty(embedder), ...(JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')) as StateData) }
      : empty(embedder);
    this.secrets = dir && existsSync(join(dir, 'credentials.json')) ? JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8')) : {};
    // Uma sincronização interrompida (processo encerrado) não fica presa em "sincronizando".
    for (const s of this.data.sources) if (s.status === 'syncing') { s.status = 'idle'; delete s.progress; }
  }

  save() {
    if (this.dir) writeAtomic(join(this.dir, 'workspace.json'), JSON.stringify(this.data, null, 2));
  }

  getSecrets(sourceId: string): Record<string, string> {
    return { ...(this.secrets[sourceId] ?? {}) };
  }

  setSecrets(sourceId: string, value: Record<string, string> | null) {
    if (value) this.secrets[sourceId] = value;
    else delete this.secrets[sourceId];
    if (this.dir) writeAtomic(join(this.dir, 'credentials.json'), JSON.stringify(this.secrets, null, 2), 0o600);
  }

  /** Pasta dos arquivos enviados (originais guardados para reindexar se o modelo mudar). */
  uploadsDir(): string | null {
    if (!this.dir) return null;
    const d = join(this.dir, 'uploads');
    mkdirSync(d, { recursive: true });
    return d;
  }
}
