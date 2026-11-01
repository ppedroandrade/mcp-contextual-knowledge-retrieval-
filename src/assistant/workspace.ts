import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SourceKind = 'upload' | 'google-drive' | 'confluence';
export type SourceStatus = 'pronta' | 'sincronizando' | 'erro' | 'aguardando-conexao';

export interface DocumentMeta {
  id: string;
  title: string;
  url: string | null;
  chunks: number;
  updatedAt: string;
}

/** Uma fonte de conhecimento da empresa. Cada fonte vira uma tool do servidor MCP. */
export interface KnowledgeSource {
  id: string;
  kind: SourceKind;
  name: string;
  /** Configuração sem segredos (site e espaço do Confluence, pasta do Drive). */
  config: Record<string, string>;
  status: SourceStatus;
  error: string | null;
  documents: DocumentMeta[];
  createdAt: string;
  syncedAt: string | null;
}

export interface Citation {
  n: number;
  chunkId: string;
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  docTitle: string;
  heading: string;
  url: string | null;
  excerpt: string;
  /** A resposta citou este trecho com [n]. */
  cited: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** Fontes consultadas nesta conversa; null = todas. */
  sourceIds: string[] | null;
  messages: ChatTurn[];
  createdAt: string;
  updatedAt: string;
}

export type SourceEvent = { type: 'criada' | 'atualizada' | 'removida'; source: KnowledgeSource };

interface State {
  sources: KnowledgeSource[];
  conversations: Conversation[];
  /** Segredos por fonte, cifrados: iv.tag.dados em base64. */
  secrets: Record<string, string>;
}

const PREFIX: Record<SourceKind, string> = { upload: 'arquivos', 'google-drive': 'drive', confluence: 'confluence' };

/**
 * Estado do assistente num arquivo JSON local (`<dir>/estado.json`). Os segredos dos
 * conectores ficam cifrados com AES-256-GCM e uma chave local (`ASSISTENTE_CHAVE` ou
 * `<dir>/chave`), e nunca saem pela API. Emite `fonte` quando uma fonte entra, muda ou sai.
 */
export class Workspace extends EventEmitter<{ fonte: [SourceEvent] }> {
  private state: State;
  private readonly key: Buffer;
  private readonly file: string;

  constructor(private readonly dir: string, private readonly now: () => Date = () => new Date()) {
    super();
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'estado.json');
    this.state = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as State) : { sources: [], conversations: [], secrets: {} };
    this.key = Workspace.loadKey(dir);
  }

  private static loadKey(dir: string): Buffer {
    if (process.env.ASSISTENTE_CHAVE) {
      const key = Buffer.from(process.env.ASSISTENTE_CHAVE, 'base64');
      if (key.length !== 32) throw new Error('ASSISTENTE_CHAVE precisa ter 32 bytes em base64');
      return key;
    }
    const path = join(dir, 'chave');
    if (!existsSync(path)) {
      writeFileSync(path, randomBytes(32).toString('base64'));
      chmodSync(path, 0o600);
    }
    return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  private stamp() {
    return this.now().toISOString();
  }

  listSources(): KnowledgeSource[] {
    return this.state.sources;
  }

  getSource(id: string): KnowledgeSource {
    const s = this.state.sources.find((x) => x.id === id);
    if (!s) throw new Error(`fonte não encontrada: ${id}`);
    return s;
  }

  createSource(input: { kind: SourceKind; name: string; config?: Record<string, string>; status?: SourceStatus }): KnowledgeSource {
    const source: KnowledgeSource = {
      id: `${PREFIX[input.kind]}-${randomUUID().slice(0, 8)}`,
      kind: input.kind,
      name: input.name.trim(),
      config: input.config ?? {},
      status: input.status ?? 'pronta',
      error: null,
      documents: [],
      createdAt: this.stamp(),
      syncedAt: null,
    };
    this.state.sources.push(source);
    this.save();
    this.emit('fonte', { type: 'criada', source });
    return source;
  }

  updateSource(id: string, patch: Partial<Pick<KnowledgeSource, 'name' | 'status' | 'error' | 'config' | 'syncedAt'>>): KnowledgeSource {
    const source = Object.assign(this.getSource(id), patch);
    this.save();
    this.emit('fonte', { type: 'atualizada', source });
    return source;
  }

  removeSource(id: string): KnowledgeSource {
    const source = this.getSource(id);
    this.state.sources = this.state.sources.filter((s) => s.id !== id);
    delete this.state.secrets[id];
    for (const c of this.state.conversations) if (c.sourceIds) c.sourceIds = c.sourceIds.filter((s) => s !== id);
    this.save();
    this.emit('fonte', { type: 'removida', source });
    return source;
  }

  upsertDocument(sourceId: string, doc: Omit<DocumentMeta, 'updatedAt'> & { updatedAt?: string }) {
    const source = this.getSource(sourceId);
    source.documents = [...source.documents.filter((d) => d.id !== doc.id), { ...doc, updatedAt: doc.updatedAt ?? this.stamp() }]
      .sort((a, b) => a.title.localeCompare(b.title));
    this.save();
  }

  removeDocument(sourceId: string, docId: string) {
    const source = this.getSource(sourceId);
    source.documents = source.documents.filter((d) => d.id !== docId);
    this.save();
  }

  setSecret(sourceId: string, value: Record<string, string>) {
    this.getSource(sourceId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    this.state.secrets[sourceId] = [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
    this.save();
  }

  getSecret(sourceId: string): Record<string, string> | null {
    const stored = this.state.secrets[sourceId];
    if (!stored) return null;
    const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
    decipher.setAuthTag(tag!);
    return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8')) as Record<string, string>;
  }

  listConversations(): Omit<Conversation, 'messages'>[] {
    return [...this.state.conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ messages: _, ...c }) => c);
  }

  getConversation(id: string): Conversation {
    const c = this.state.conversations.find((x) => x.id === id);
    if (!c) throw new Error(`conversa não encontrada: ${id}`);
    return c;
  }

  createConversation(sourceIds: string[] | null = null): Conversation {
    const at = this.stamp();
    const conversation: Conversation = { id: randomUUID(), title: 'Nova conversa', sourceIds, messages: [], createdAt: at, updatedAt: at };
    this.state.conversations.push(conversation);
    this.save();
    return conversation;
  }

  updateConversation(id: string, patch: Partial<Pick<Conversation, 'title' | 'sourceIds'>>): Conversation {
    const c = Object.assign(this.getConversation(id), patch, { updatedAt: this.stamp() });
    this.save();
    return c;
  }

  appendTurn(id: string, turn: Omit<ChatTurn, 'createdAt'>): ChatTurn {
    const c = this.getConversation(id);
    const full = { ...turn, createdAt: this.stamp() };
    c.messages.push(full);
    if (c.title === 'Nova conversa' && turn.role === 'user') c.title = turn.content.replace(/\s+/g, ' ').trim().slice(0, 60);
    c.updatedAt = full.createdAt;
    this.save();
    return full;
  }

  deleteConversation(id: string) {
    this.getConversation(id);
    this.state.conversations = this.state.conversations.filter((c) => c.id !== id);
    this.save();
  }
}
