import { ABSTENTION } from './prompt.js';
import type { ChatMessage, Completion, LlmProvider } from './provider.js';

/** Primeiro id de trecho da última mensagem, no formato de `buildMessages`. */
const firstContextId = (messages: ChatMessage[]) => messages.at(-1)?.content.match(/^\[([^\]]+)\] \(fonte:/m)?.[1];

/**
 * Provedor simulado: determinístico e sem rede, para testes e para rodar o pipeline sem o
 * Ollama. Por padrão cita o primeiro trecho do contexto ou, sem trechos, diz que não sabe.
 * **Não tem valor experimental.**
 */
export class SimulatedProvider implements LlmProvider {
  readonly name = 'simulado';

  constructor(private readonly respond: (messages: ChatMessage[]) => string = (m) => {
    const id = firstContextId(m);
    return id ? `Resposta simulada [${id}].` : ABSTENTION;
  }) {}

  async complete(messages: ChatMessage[]): Promise<Completion> {
    return { text: this.respond(messages), promptTokens: null, outputTokens: null, loadMs: null, truncated: false };
  }

  async describe() {
    return { llm: 'simulado', warning: 'determinístico, sem modelo; só para testes' };
  }
}
