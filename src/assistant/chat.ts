import type { ChatMessage } from '../generation/provider.js';
import type { RetrievedPassage } from './mcp.js';
import type { ChatTurn, Citation, KnowledgeSource } from './workspace.js';

/** Trechos entregues ao LLM por pergunta (o k da avaliação do TCC). */
export const CONTEXT_PASSAGES = 5;
/** Turnos anteriores mandados ao LLM, para perguntas de seguimento. */
export const HISTORY_TURNS = 6;

export const ASSISTANT_SYSTEM_PROMPT = [
  'Você é o assistente de conhecimento da empresa. Responde perguntas das pessoas da empresa usando só os trechos das fontes internas que vêm junto com cada pergunta.',
  '',
  'Regras:',
  '1. Use apenas o que está nos trechos; não invente nem complete com conhecimento próprio.',
  '2. Cite a origem de cada informação com o número do trecho entre colchetes, logo depois dela, por exemplo: "O deploy é às terças [2]."',
  '3. Se os trechos não trouxerem a resposta, diga que não encontrou isso nas fontes conectadas e, se fizer sentido, sugira qual fonte ou equipe poderia ter a informação.',
  '4. Responda em português, de forma direta; use listas curtas quando ajudarem.',
].join('\n');

/**
 * Consulta usada na busca. Uma pergunta curta de seguimento ("e o rollback?") sozinha
 * recupera mal, então vai junto com a pergunta anterior.
 */
export function retrievalQuery(history: ChatTurn[], question: string): string {
  const previous = [...history].reverse().find((t) => t.role === 'user')?.content;
  return previous && question.trim().length < 60 ? `${previous}\n${question.trim()}` : question.trim();
}

/** Trechos recuperados numerados de 1 a n, com a fonte de cada um, prontos para citar. */
export function toCitations(passages: RetrievedPassage[], sources: KnowledgeSource[]): Citation[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return passages.map((p, i) => ({
    n: i + 1, chunkId: p.trecho, sourceId: p.fonte,
    sourceName: byId.get(p.fonte)?.name ?? p.fonte, sourceKind: byId.get(p.fonte)?.kind ?? 'upload',
    docTitle: p.titulo, heading: p.secao, url: p.url, excerpt: p.texto, cited: false,
  }));
}

/** Mensagens para o LLM: instruções, histórico recente e a pergunta com os trechos numerados. */
export function buildChatMessages(history: ChatTurn[], question: string, citations: Citation[]): ChatMessage[] {
  const context = citations.length
    ? citations.map((c) => `[${c.n}] ${c.sourceName} · ${c.docTitle} — ${c.heading}\n${c.excerpt}`).join('\n\n')
    : '(nenhum trecho encontrado nas fontes selecionadas)';
  return [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
    ...history.slice(-HISTORY_TURNS).map((t): ChatMessage => ({ role: t.role, content: t.content })),
    { role: 'user', content: `Trechos das fontes da empresa:\n\n${context}\n\nPergunta: ${question.trim()}` },
  ];
}

/** Números citados na resposta, em `[2]` ou `[1, 3]`. */
export function citedNumbers(text: string): Set<number> {
  return new Set([...text.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)].flatMap((m) => m[1]!.split(/[,;]/).map((n) => Number(n.trim()))));
}

/** Gera a resposta token a token. */
export interface ChatStreamer {
  readonly name: string;
  stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<string>;
}

/**
 * Chat do Ollama com streaming (`POST /api/chat`, NDJSON). Temperatura 0 e modo de
 * raciocínio desligado nos modelos que o têm, como na geração do TCC.
 */
export class OllamaChatStreamer implements ChatStreamer {
  readonly name: string;
  private thinking?: Promise<boolean>;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly options = { numCtx: 8192, numPredict: 1024 },
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `ollama:${model}`;
  }

  private hasThinking(): Promise<boolean> {
    this.thinking ??= this.fetchFn(`${this.baseUrl}/api/show`, { method: 'POST', body: JSON.stringify({ model: this.model }) })
      .then((r) => r.json() as Promise<{ capabilities?: string[] }>)
      .then((b) => (b.capabilities ?? []).includes('thinking'));
    return this.thinking;
  }

  async *stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<string> {
    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model, messages, stream: true,
        ...((await this.hasThinking()) ? { think: false } : {}),
        options: { temperature: 0, num_ctx: this.options.numCtx, num_predict: this.options.numPredict },
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
        if (event.error) throw new Error(`Ollama: ${event.error}`);
        if (event.message?.content) yield event.message.content;
      }
    }
  }
}

/** Gerador simulado, determinístico e sem rede, para testes e para ver a UI sem Ollama. */
export class SimulatedChatStreamer implements ChatStreamer {
  readonly name = 'simulado';

  constructor(private readonly respond: (messages: ChatMessage[]) => string = (m) => {
    const first = m.at(-1)?.content.match(/^\[(\d+)\] [^\n]*\n([^\n]*)/m);
    return first ? `Segundo as fontes, ${first[2]!.slice(0, 120)} [${first[1]}].` : 'Não encontrei isso nas fontes conectadas.';
  }) {}

  async *stream(messages: ChatMessage[]) {
    for (const word of this.respond(messages).split(/(?<= )/)) yield word;
  }
}
