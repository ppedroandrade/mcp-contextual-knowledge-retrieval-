/**
 * Tipos do app corporativo (ADR 012). Camada separada do experimento: as fontes aqui são
 * dinâmicas (cada conector conectado vira uma fonte), enquanto `SourceName` do experimento é
 * uma lista fechada.
 */

export type ConnectorKind = 'upload' | 'gdrive' | 'confluence';

export type SourceStatus = 'idle' | 'syncing' | 'error';

/** Uma fonte de conhecimento do workspace: um conector configurado. Vira uma tool MCP. */
export interface WorkspaceSource {
  /** Id curto e estável (`uploads`, `gdrive`, `confluence_acme`); nome da tool: `buscar_<id>`. */
  id: string;
  kind: ConnectorKind;
  name: string;
  /** Descrição do conteúdo, usada na tool MCP. Editável pelo usuário. */
  description: string;
  status: SourceStatus;
  /** Progresso da sincronização em andamento. */
  progress?: { done: number; total: number };
  lastSyncAt?: string;
  lastError?: string;
  /** Configuração sem segredos (ex.: URL do Confluence, espaços). Segredos ficam em credentials.json. */
  settings: Record<string, string>;
}

/** Documento indexado. `version` decide se precisa reindexar (data de modificação, versão ou hash). */
export interface WorkspaceDoc {
  /** Id curto do documento no workspace (`D12`), usado nas citações. */
  key: string;
  sourceId: string;
  /** Id do documento na origem (id do Drive, id da página, hash do arquivo). */
  externalId: string;
  title: string;
  url?: string;
  mimeType?: string;
  version: string;
  chunkCount: number;
  bytes: number;
  indexedAt: string;
}

/** Trecho indexável. Id no formato `<chave do documento>#<n>` (ex.: `D12#3`). */
export interface WorkspaceChunk {
  id: string;
  sourceId: string;
  docKey: string;
  title: string;
  heading: string;
  text: string;
  url?: string;
}

export interface ChunkHit {
  chunk: WorkspaceChunk;
  score: number;
}

/** Documento como chega de um conector, antes da extração de texto. */
export interface RemoteDocument {
  externalId: string;
  title: string;
  version: string;
  url?: string;
  mimeType?: string;
  /** Busca o conteúdo só se a versão mudou. */
  fetch(): Promise<{ data: Buffer; mimeType: string; fileName?: string }>;
}

/** Seção de texto extraída de um documento. */
export interface Section {
  heading: string;
  text: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** Só nas respostas. */
  citations?: CitationView[];
  passages?: CitationView[];
  abstained?: boolean;
  invalidCitations?: string[];
  tools?: { name: string; hits: number; ms: number }[];
  timing?: { retrievalMs: number; totalMs: number };
}

export interface CitationView {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  kind: ConnectorKind;
  title: string;
  heading: string;
  url?: string;
  text: string;
  score: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
}
