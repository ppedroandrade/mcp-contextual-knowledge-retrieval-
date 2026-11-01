import { describeOllamaModel } from '../core/ollama.js';
import type { ChatMessage, Completion, CompletionOptions, LlmProvider } from './provider.js';

export interface OllamaChatOptions {
  /** Janela de contexto. A chamada falha antes de enviar se o prompt puder não caber. */
  numCtx: number;
  /** Limite de tokens da resposta. */
  numPredict: number;
  seed: number;
}

/** num_ctx comporta o pior caso do corpus (5 maiores unidades + maior pergunta: 3925 bytes). */
export const OLLAMA_CHAT_DEFAULTS: OllamaChatOptions = { numCtx: 5120, numPredict: 512, seed: 42 };

/** Tokens reservados para as marcações do modelo de chat (papéis, início e fim de turno). */
const TEMPLATE_MARGIN = 256;

interface ChatResponse {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  load_duration?: number;
}

/**
 * Chat do Ollama (`POST /api/chat`), sem streaming e com temperatura 0. Nos modelos com modo
 * de raciocínio (`thinking` em `/api/show`) ele é desligado, para todos gerarem só a resposta.
 */
export class OllamaChatProvider implements LlmProvider {
  readonly name: string;
  private capabilities?: Promise<string[]>;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly options: OllamaChatOptions = OLLAMA_CHAT_DEFAULTS,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `ollama:${model}`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async hasThinking(): Promise<boolean> {
    this.capabilities ??= this.post<{ capabilities?: string[] }>('/api/show', { model: this.model }).then((b) => b.capabilities ?? []);
    return (await this.capabilities).includes('thinking');
  }

  async complete(messages: ChatMessage[], { format }: CompletionOptions = {}): Promise<Completion> {
    const { numCtx, numPredict, seed } = this.options;
    // Cada token tem ao menos 1 byte: bytes do texto + margem limitam o prompt por cima, e o
    // Ollama truncaria em silêncio um prompt maior que num_ctx.
    const bytes = messages.reduce((s, m) => s + Buffer.byteLength(m.content), 0);
    if (bytes + TEMPLATE_MARGIN + numPredict > numCtx) {
      throw new Error(`prompt de ${bytes} bytes pode não caber em num_ctx = ${numCtx} com ${numPredict} tokens de resposta`);
    }
    const body = await this.post<ChatResponse>('/api/chat', {
      model: this.model,
      messages,
      stream: false,
      ...((await this.hasThinking()) ? { think: false } : {}),
      ...(format ? { format } : {}),
      options: { temperature: 0, seed, num_ctx: numCtx, num_predict: numPredict },
    });
    return {
      text: body.message?.content?.trim() ?? '',
      promptTokens: body.prompt_eval_count ?? null,
      outputTokens: body.eval_count ?? null,
      loadMs: body.load_duration === undefined ? null : body.load_duration / 1e6,
      truncated: body.done_reason === 'length',
    };
  }

  async describe() {
    return {
      llm: 'ollama',
      ...(await describeOllamaModel(this.baseUrl, this.model, this.fetchFn)),
      options: { temperature: 0, ...this.options },
      thinkingDisabled: await this.hasThinking(),
    };
  }
}
