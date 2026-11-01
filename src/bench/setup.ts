import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceUnit, Question, Retriever, SourceName } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { DATA_DIR } from '../corpus/generate.js';
import { OllamaChatProvider } from '../generation/ollama.js';
import type { LlmProvider } from '../generation/provider.js';
import { SimulatedProvider } from '../generation/simulated.js';
import { createBm25Retriever } from '../approaches/a-bm25.js';
import { createGlobalVectorRetriever } from '../approaches/b-rag.js';
import { createPerSourceRetriever } from '../approaches/c-per-source.js';
import { createMcpRetriever, stdioServerTransport } from '../approaches/d-mcp-rag.js';
import { HashEmbedder, OllamaEmbedder, type Embedder } from '../indexing/embeddings.js';
import { ingest } from '../indexing/ingest.js';
import { PgVectorStore } from '../indexing/pgvector.js';
import { MemoryVectorStore, type VectorStore } from '../indexing/vector-store.js';

export type EmbedderKind = 'ollama' | 'hash';
export type StoreKind = 'pg' | 'memory';
export type LlmKind = 'ollama' | 'simulated';

export function loadQuestions(set: string): Question[] {
  return JSON.parse(readFileSync(join(DATA_DIR, 'questions', `${set}.json`), 'utf8')) as Question[];
}

/** Fontes indexadas para cada conjunto: `policies` só entra com a 4ª fonte (H3). */
export function sourcesFor(set: string): SourceName[] {
  return set === 'policies' ? ['docs', 'tickets', 'incidents', 'policies'] : ['docs', 'tickets', 'incidents'];
}

/** LLM das configurações que geram resposta. O simulado não tem valor experimental. */
export function makeLlm(kind: LlmKind, model = loadConfig().llmModel): LlmProvider {
  if (kind === 'simulated') return new SimulatedProvider();
  if (!model) throw new Error('defina o modelo do LLM: LLM_MODEL no ambiente ou --model');
  return new OllamaChatProvider(loadConfig().ollamaUrl, model);
}

export function makeEmbedder(kind: EmbedderKind): Embedder {
  const cfg = loadConfig();
  return kind === 'ollama' ? new OllamaEmbedder(cfg.ollamaUrl, cfg.embeddingModel) : new HashEmbedder();
}

/** Nome da tabela derivado do modelo e das fontes, para índices diferentes não se misturarem. */
export function tableName(embedder: Embedder, sources: SourceName[]): string {
  return `units_${embedder.name}_${sources.join('_')}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * Abre o armazenamento vetorial. Em memória, indexa na hora. No pgvector, reaproveita a
 * tabela se ela já tiver todas as unidades (rode `npm run ingest` antes).
 */
export async function openStore(kind: StoreKind, embedder: Embedder, units: EvidenceUnit[], sources: SourceName[]): Promise<VectorStore> {
  if (kind === 'memory') {
    const store = new MemoryVectorStore();
    await ingest(units, embedder, store);
    return store;
  }
  const [probe] = await embedder.embed(['dimensão']);
  const store = await PgVectorStore.open(loadConfig().pgUrl, tableName(embedder, sources), probe!.length);
  const n = await store.count();
  if (n !== units.length) {
    await store.close();
    throw new Error(`tabela ${tableName(embedder, sources)} tem ${n} unidades, esperado ${units.length}; rode npm run ingest`);
  }
  return store;
}

export interface RetrieverOptions {
  units: EvidenceUnit[];
  sources: SourceName[];
  embedder: Embedder | null;
  store: VectorStore | null;
  /** Como o servidor MCP (D), em outro processo, cria o próprio embedder e armazenamento. */
  embedderKind: EmbedderKind;
  storeKind: StoreKind;
}

export async function makeRetrievers(names: string[], o: RetrieverOptions): Promise<Retriever[]> {
  const out: Retriever[] = [];
  for (const n of names) {
    if (n === 'A') { out.push(createBm25Retriever(o.units)); continue; }
    if (n === 'D') {
      out.push(await createMcpRetriever(stdioServerTransport({ sources: o.sources, embedder: o.embedderKind, store: o.storeKind })));
      continue;
    }
    if (!o.embedder || !o.store) throw new Error(`a abordagem ${n} precisa de embeddings`);
    if (n === 'B') out.push(createGlobalVectorRetriever(o.embedder, o.store));
    else if (n === 'C') out.push(createPerSourceRetriever(o.embedder, o.store, o.sources));
    else throw new Error(`abordagem desconhecida: ${n}`);
  }
  return out;
}
