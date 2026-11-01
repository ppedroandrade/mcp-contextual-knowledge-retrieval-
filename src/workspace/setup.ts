import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import type { Embedder } from '../indexing/embeddings.js';
import { HashEmbedder, OllamaEmbedder } from '../indexing/embeddings.js';
import { OllamaChatProvider } from '../generation/ollama.js';
import { FileWorkspaceStore, PgWorkspaceStore, type WorkspaceStore } from './store.js';

export type WorkspaceEmbedderKind = 'ollama' | 'hash';
export type WorkspaceStoreKind = 'pg' | 'memory';

export const DEFAULT_WORKSPACE_DIR = join(import.meta.dirname, '..', '..', 'workspace-data');

export function makeWorkspaceEmbedder(kind: WorkspaceEmbedderKind): Embedder {
  const cfg = loadConfig();
  // 1024 dimensões (como o bge-m3) para menos colisões de hash; continua não semântico.
  if (kind === 'hash') return new HashEmbedder(1024);
  if (kind === 'ollama') return new OllamaEmbedder(cfg.ollamaUrl, cfg.embeddingModel);
  throw new Error(`embedder desconhecido: ${kind}`);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/**
 * Índice do workspace: no pgvector (tabela `ws_chunks_<modelo>`) ou num arquivo JSON na pasta
 * de dados. A tabela tem o nome do modelo para vetores de modelos diferentes não se misturarem.
 */
export async function openWorkspaceStore(kind: WorkspaceStoreKind, embedder: Embedder, dir: string): Promise<WorkspaceStore> {
  if (kind === 'memory') return new FileWorkspaceStore(join(dir, `indice-${slug(embedder.name)}.json`));
  if (kind !== 'pg') throw new Error(`armazenamento desconhecido: ${kind}`);
  const [probe] = await embedder.embed(['dimensão']);
  return PgWorkspaceStore.open(loadConfig().pgUrl, `ws_chunks_${slug(embedder.name)}`, probe!.length);
}

/**
 * LLM do workspace: o mesmo modelo do experimento, com janela maior (5 trechos de até 1.200
 * caracteres + histórico não cabem nos 5.120 tokens fixados para o benchmark).
 */
export function makeWorkspaceLlm(model = loadConfig().llmModel) {
  return new OllamaChatProvider(loadConfig().ollamaUrl, model, { numCtx: 12_288, numPredict: 768, seed: 42 });
}
