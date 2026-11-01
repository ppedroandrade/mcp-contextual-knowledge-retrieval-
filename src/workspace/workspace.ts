import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Embedder } from '../indexing/embeddings.js';
import { buildChunks, chunkIndexText } from './chunk.js';
import { confluenceConnector } from './connectors/confluence.js';
import { googleDriveConnector } from './connectors/google-drive.js';
import type { RequestOptions } from './connectors/http.js';
import type { Connector } from './connectors/types.js';
import { extractSections, mimeFromName, UnsupportedFormatError } from './extract.js';
import { WorkspaceState } from './state.js';
import type { WorkspaceStore } from './store.js';
import type { ConnectorKind, RemoteDocument, WorkspaceDoc, WorkspaceSource } from './types.js';

export const UPLOADS_SOURCE = 'uploads';
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const DEFAULT_DESCRIPTIONS: Record<ConnectorKind, string> = {
  upload: 'Arquivos enviados pelos usuários do workspace (PDF, Word, Markdown, texto, planilhas CSV).',
  gdrive: 'Documentos do Google Drive da empresa (Google Docs, PDF, Word e texto).',
  confluence: 'Páginas do Confluence da empresa: documentação técnica, processos, runbooks e postmortems.',
};

export interface SyncReport {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  failed: { title: string; error: string }[];
}

export interface WorkspaceOptions {
  dir: string | null;
  embedder: Embedder;
  store: WorkspaceStore;
  /** `fetch` usado pelos conectores (o simulado nos testes e no modo de demonstração). */
  fetch?: typeof fetch;
  http?: RequestOptions;
  connectors?: Partial<Record<ConnectorKind, Connector>>;
  /** Avisado a cada mudança nas fontes (o servidor MCP atualiza as tools). */
  onSourcesChanged?: () => void;
}

/** Embeddings em lotes pequenos, para a barra de progresso andar e o Ollama não estourar memória. */
const EMBED_BATCH = 16;

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'fonte';

/**
 * Núcleo do app corporativo: fontes (conectores), documentos e índice vetorial com
 * sincronização incremental. Cada documento tem uma versão (data de modificação no Drive,
 * número da versão no Confluence, SHA-256 no upload); só o que mudou é reextraído e
 * reindexado, e o que sumiu da origem sai do índice.
 */
export class Workspace {
  readonly state: WorkspaceState;
  readonly embedder: Embedder;
  readonly store: WorkspaceStore;
  private readonly fetchFn: typeof fetch;
  private readonly connectors: Partial<Record<ConnectorKind, Connector>>;
  private readonly running = new Map<string, Promise<SyncReport>>();
  onSourcesChanged: () => void;

  constructor(private readonly o: WorkspaceOptions) {
    this.embedder = o.embedder;
    this.store = o.store;
    this.fetchFn = o.fetch ?? fetch;
    this.connectors = { gdrive: googleDriveConnector, confluence: confluenceConnector, ...o.connectors };
    this.onSourcesChanged = o.onSourcesChanged ?? (() => {});
    this.state = new WorkspaceState(o.dir, o.embedder.name);
    if (!this.state.data.sources.some((s) => s.id === UPLOADS_SOURCE)) {
      this.state.data.sources.unshift({ id: UPLOADS_SOURCE, kind: 'upload', name: 'Arquivos enviados', description: DEFAULT_DESCRIPTIONS.upload, status: 'idle', settings: {} });
      this.state.save();
    }
  }

  /**
   * Se o índice foi feito com outro modelo de embeddings, os vetores não são comparáveis:
   * apaga o índice e reindexa os uploads guardados e os conectores.
   */
  async reindexIfEmbedderChanged(): Promise<boolean> {
    const d = this.state.data;
    if (d.embedder === this.embedder.name) return false;
    for (const s of d.sources) await this.store.deleteSource(s.id);
    d.docs = [];
    d.embedder = this.embedder.name;
    this.state.save();
    await this.reindexUploads();
    for (const s of d.sources) if (s.kind !== 'upload') await this.sync(s.id).catch(() => {});
    return true;
  }

  private async reindexUploads() {
    const dir = this.state.uploadsDir();
    const index = dir && join(dir, 'index.json');
    if (!index || !existsSync(index)) return;
    for (const [sha, meta] of Object.entries(JSON.parse(readFileSync(index, 'utf8')) as Record<string, { name: string }>)) {
      const file = join(dir, sha);
      if (existsSync(file)) await this.upload(meta.name, readFileSync(file)).catch(() => {});
    }
  }

  sources(): WorkspaceSource[] {
    return this.state.data.sources;
  }

  source(id: string): WorkspaceSource {
    const s = this.state.data.sources.find((x) => x.id === id);
    if (!s) throw new NotFoundError('fonte não encontrada');
    return s;
  }

  docs(sourceId?: string): WorkspaceDoc[] {
    return this.state.data.docs.filter((d) => !sourceId || d.sourceId === sourceId);
  }

  doc(key: string): WorkspaceDoc | undefined {
    return this.state.data.docs.find((d) => d.key === key);
  }

  /** Cria uma fonte de um conector. Os segredos vão para credentials.json, nunca para workspace.json. */
  addSource(kind: Exclude<ConnectorKind, 'upload'>, name: string, settings: Record<string, string>, secrets: Record<string, string>, idHint?: string): WorkspaceSource {
    const base = idHint ? `${kind}_${slug(idHint)}` : kind;
    let id = base;
    for (let n = 2; this.state.data.sources.some((s) => s.id === id); n++) id = `${base}_${n}`;
    const source: WorkspaceSource = { id, kind, name, description: DEFAULT_DESCRIPTIONS[kind], status: 'idle', settings };
    this.state.data.sources.push(source);
    this.state.setSecrets(id, secrets);
    this.state.save();
    this.onSourcesChanged();
    return source;
  }

  updateSource(id: string, patch: { name?: string; description?: string }) {
    const s = this.source(id);
    if (patch.name?.trim()) s.name = patch.name.trim().slice(0, 80);
    if (patch.description?.trim()) s.description = patch.description.trim().slice(0, 500);
    this.state.save();
    this.onSourcesChanged();
    return s;
  }

  async removeSource(id: string) {
    if (id === UPLOADS_SOURCE) throw new BadRequestError('a fonte de arquivos enviados não pode ser removida; apague os arquivos');
    this.source(id);
    await this.running.get(id)?.catch(() => {});
    await this.store.deleteSource(id);
    this.state.data.docs = this.state.data.docs.filter((d) => d.sourceId !== id);
    this.state.data.sources = this.state.data.sources.filter((s) => s.id !== id);
    this.state.setSecrets(id, null);
    this.state.save();
    this.onSourcesChanged();
  }

  async removeDoc(key: string) {
    const d = this.doc(key);
    if (!d) throw new NotFoundError('documento não encontrado');
    await this.store.deleteDoc(key);
    this.state.data.docs = this.state.data.docs.filter((x) => x.key !== key);
    if (d.sourceId === UPLOADS_SOURCE) this.forgetUpload(d.version);
    this.state.save();
  }

  private newDocKey(): string {
    return `D${this.state.data.nextDocNumber++}`;
  }

  /** Extrai, segmenta, calcula os embeddings e troca os trechos antigos do documento pelos novos. */
  private async indexDocument(source: WorkspaceSource, remote: Omit<RemoteDocument, 'fetch'>, content: { data: Buffer; mimeType: string; fileName?: string }, existing?: WorkspaceDoc): Promise<WorkspaceDoc> {
    const extracted = await extractSections(content.data, content.mimeType, content.fileName ?? remote.title);
    const title = remote.title.replace(/\.(md|markdown|txt|html?|csv|json|pdf|docx)$/i, '') || extracted.title;
    const key = existing?.key ?? this.newDocKey();
    const chunks = buildChunks(key, source.id, title, remote.url, extracted.sections);
    if (chunks.length === 0) throw new UnsupportedFormatError('nenhum texto encontrado no documento (PDF escaneado sem OCR?)');
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) vectors.push(...(await this.embedder.embed(chunks.slice(i, i + EMBED_BATCH).map(chunkIndexText))));
    await this.store.deleteDoc(key);
    await this.store.upsert(chunks.map((chunk, i) => ({ chunk, embedding: vectors[i]! })));
    const doc: WorkspaceDoc = {
      key, sourceId: source.id, externalId: remote.externalId, title, version: remote.version, chunkCount: chunks.length,
      bytes: content.data.length, indexedAt: new Date().toISOString(),
      ...(remote.url ? { url: remote.url } : {}), ...(remote.mimeType ?? content.mimeType ? { mimeType: remote.mimeType ?? content.mimeType } : {}),
    };
    this.state.data.docs = [...this.state.data.docs.filter((d) => d.key !== key), doc];
    this.state.save();
    return doc;
  }

  /** Upload de um arquivo. O mesmo nome com conteúdo novo substitui a versão anterior. */
  async upload(fileName: string, data: Buffer): Promise<{ doc: WorkspaceDoc; status: 'added' | 'updated' | 'unchanged' }> {
    const name = fileName.split(/[\\/]/).pop()!.trim().slice(0, 200);
    if (!name) throw new BadRequestError('arquivo sem nome');
    if (data.length === 0) throw new BadRequestError('arquivo vazio');
    if (data.length > MAX_UPLOAD_BYTES) throw new BadRequestError(`arquivo maior que ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB`);
    const mimeType = mimeFromName(name);
    if (!mimeType) throw new UnsupportedFormatError(`formato não suportado: ${name}`);
    const source = this.source(UPLOADS_SOURCE);
    const sha = createHash('sha256').update(data).digest('hex');
    const existing = this.docs(UPLOADS_SOURCE).find((d) => d.externalId === name.toLowerCase());
    if (existing?.version === sha) return { doc: existing, status: 'unchanged' };
    const doc = await this.indexDocument(source, { externalId: name.toLowerCase(), title: name, version: sha, mimeType }, { data, mimeType, fileName: name }, existing);
    if (existing) this.forgetUpload(existing.version);
    this.keepUpload(sha, name, data);
    source.lastSyncAt = doc.indexedAt;
    this.state.save();
    return { doc, status: existing ? 'updated' : 'added' };
  }

  private uploadIndex(): { file: string; map: Record<string, { name: string }> } | null {
    const dir = this.state.uploadsDir();
    if (!dir) return null;
    const file = join(dir, 'index.json');
    return { file, map: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {} };
  }

  private keepUpload(sha: string, name: string, data: Buffer) {
    const idx = this.uploadIndex();
    if (!idx) return;
    writeFileSync(join(this.state.uploadsDir()!, sha), data);
    idx.map[sha] = { name };
    writeFileSync(idx.file, JSON.stringify(idx.map, null, 2));
  }

  private forgetUpload(sha: string) {
    const idx = this.uploadIndex();
    if (!idx || !idx.map[sha]) return;
    delete idx.map[sha];
    rmSync(join(this.state.uploadsDir()!, sha), { force: true });
    writeFileSync(idx.file, JSON.stringify(idx.map, null, 2));
  }

  /** Sincroniza uma fonte; chamadas simultâneas para a mesma fonte reaproveitam a que está rodando. */
  sync(sourceId: string): Promise<SyncReport> {
    const running = this.running.get(sourceId);
    if (running) return running;
    const p = this.doSync(sourceId).finally(() => this.running.delete(sourceId));
    this.running.set(sourceId, p);
    return p;
  }

  isSyncing(sourceId: string) {
    return this.running.has(sourceId);
  }

  private async doSync(sourceId: string): Promise<SyncReport> {
    const source = this.source(sourceId);
    const connector = this.connectors[source.kind];
    if (!connector) throw new BadRequestError(`a fonte ${source.name} não sincroniza (${source.kind})`);
    source.status = 'syncing';
    source.progress = { done: 0, total: 0 };
    delete source.lastError;
    this.state.save();
    const report: SyncReport = { added: 0, updated: 0, removed: 0, unchanged: 0, failed: [] };
    try {
      const remote = await connector.list({
        settings: source.settings, secrets: this.state.getSecrets(sourceId), fetch: this.fetchFn,
        saveSecrets: (next) => this.state.setSecrets(sourceId, next), ...(this.o.http ? { http: this.o.http } : {}),
      });
      const byExternal = new Map(this.docs(sourceId).map((d) => [d.externalId, d]));
      source.progress = { done: 0, total: remote.length };
      for (const r of remote) {
        const existing = byExternal.get(r.externalId);
        byExternal.delete(r.externalId);
        try {
          if (existing && existing.version === r.version) report.unchanged++;
          else {
            await this.indexDocument(source, r, await r.fetch(), existing);
            report[existing ? 'updated' : 'added']++;
          }
        } catch (err) {
          // Um documento com problema não derruba a sincronização da fonte inteira; a versão
          // anterior (se houver) continua no índice.
          report.failed.push({ title: r.title, error: err instanceof Error ? err.message : String(err) });
        }
        source.progress.done++;
      }
      // O que sumiu da origem (apagado, movido, sem permissão) sai do índice.
      for (const gone of byExternal.values()) {
        await this.store.deleteDoc(gone.key);
        this.state.data.docs = this.state.data.docs.filter((d) => d.key !== gone.key);
        report.removed++;
      }
      source.status = 'idle';
      source.lastSyncAt = new Date().toISOString();
      if (report.failed.length) source.lastError = `${report.failed.length} documento(s) com erro: ${report.failed.map((f) => `${f.title} (${f.error})`).join('; ').slice(0, 500)}`;
      return report;
    } catch (err) {
      source.status = 'error';
      source.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      delete source.progress;
      this.state.save();
    }
  }

  newConversationId() {
    return randomUUID();
  }
}

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}
