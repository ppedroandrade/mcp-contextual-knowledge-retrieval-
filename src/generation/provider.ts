/** Mensagem de chat no formato comum aos provedores. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Resposta de um provedor, com as contagens que ele informar (null quando não informa). */
export interface Completion {
  text: string;
  promptTokens: number | null;
  outputTokens: number | null;
  /** Tempo que o provedor gastou carregando o modelo nesta chamada; alto indica recarga. */
  loadMs: number | null;
  /** A resposta parou no limite de tokens de saída. */
  truncated: boolean;
}

/** Contrato dos provedores de LLM. B, C e D usam o mesmo provedor, prompt e contexto. */
export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[]): Promise<Completion>;
  /** Metadados para o registro do ambiente (modelo, digest, opções). */
  describe(): Promise<Record<string, unknown>>;
}
