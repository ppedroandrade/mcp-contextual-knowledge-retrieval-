/** Configuração lida do ambiente, com padrões para execução local (docker-compose). */
export interface AppConfig {
  pgUrl: string;
  ollamaUrl: string;
  embeddingModel: string;
  llmModel: string;
}

export const DEFAULTS: AppConfig = {
  pgUrl: 'postgres://tcc:tcc@localhost:5432/tcc',
  ollamaUrl: 'http://localhost:11434',
  embeddingModel: 'bge-m3',
  llmModel: 'qwen3:4b-instruct-2507-q4_K_M',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    pgUrl: env.PG_URL || DEFAULTS.pgUrl,
    ollamaUrl: env.OLLAMA_URL || DEFAULTS.ollamaUrl,
    embeddingModel: env.EMBEDDING_MODEL || DEFAULTS.embeddingModel,
    llmModel: env.LLM_MODEL || DEFAULTS.llmModel,
  };
}
