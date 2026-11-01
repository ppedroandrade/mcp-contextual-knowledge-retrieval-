import type { ConnectorKind, RemoteDocument } from '../types.js';
import type { RequestOptions } from './http.js';

export interface ConnectorContext {
  /** Configuração sem segredos (URL do site, espaços, pasta). */
  settings: Record<string, string>;
  /** Tokens e chaves; o conector pode renová-los com `saveSecrets`. */
  secrets: Record<string, string>;
  saveSecrets(next: Record<string, string>): void;
  fetch: typeof fetch;
  http?: RequestOptions;
}

/** Conector de uma fonte externa: lista os documentos com a versão de cada um. */
export interface Connector {
  readonly kind: ConnectorKind;
  list(ctx: ConnectorContext): Promise<RemoteDocument[]>;
}
