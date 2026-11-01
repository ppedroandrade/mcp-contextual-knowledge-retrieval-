import type { RetrievedPassage } from './mcp.js';
import type { ChatTurn, Citation, KnowledgeSource } from './workspace.js';

/** Trechos entregues ao LLM por busca (o k da avaliação do TCC). */
export const CONTEXT_PASSAGES = 5;
/** Turnos anteriores mandados ao LLM, para a conversa ter memória. */
export const HISTORY_TURNS = 8;
/** Ferramenta que o LLM chama quando a resposta depende das fontes da empresa. */
export const SEARCH_TOOL = 'buscar_nas_fontes';

const KIND_LABEL: Record<KnowledgeSource['kind'], string> = { upload: 'arquivos enviados', 'google-drive': 'Google Drive', confluence: 'Confluence' };

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

/** Mensagem no formato do chat do Ollama, com chamadas de ferramenta. */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ModelEvent = { type: 'text'; text: string } | { type: 'tool'; call: ToolCall };

/** Modelo de conversa: devolve o texto aos poucos ou pede uma ferramenta. */
export interface ChatModel {
  readonly name: string;
  chat(messages: ModelMessage[], options?: { tools?: ToolSpec[]; signal?: AbortSignal }): AsyncIterable<ModelEvent>;
}

/**
 * Instruções do assistente: conversa livre, e busca nas fontes quando a resposta depende da
 * empresa. É o próprio LLM que decide buscar (tool calling) e escreve a consulta, então
 * cumprimentos e pedidos sobre a conversa ("resuma isso") não passam pela busca. As regras de
 * citação vão junto com os trechos (`toolResultText`): no prompt de sistema, "diga que não
 * encontrou" fazia o modelo (4B) responder isso sem buscar.
 */
export function systemPrompt(sources: KnowledgeSource[]): string {
  const intro = 'Você é o Nexo, o assistente de conhecimento da empresa. Converse de forma natural, cordial e direta, em português.';
  const direct = 'Só responda direto, sem buscar, a cumprimentos, agradecimentos, conversa sobre você ou pedidos sobre o que já está nesta conversa (resumir, reescrever, explicar melhor).';
  if (!sources.length) {
    return [intro, '', 'Ainda não há fontes conectadas: se pedirem informação da empresa, explique que ainda não há fontes conectadas e que dá para enviar arquivos ou conectar o Google Drive ou o Confluence em Fontes. Não invente informação da empresa.'].join('\n');
  }
  return [
    intro,
    '',
    'Fontes da empresa disponíveis:',
    sources.map((s) => `- ${s.name} (${KIND_LABEL[s.kind]})`).join('\n'),
    '',
    `Você não sabe nada sobre a empresa sem buscar. Sempre que a mensagem pedir informação da empresa (processos, sistemas, serviços, políticas, benefícios, clientes, incidentes, pessoas, documentos), chame ${SEARCH_TOOL} antes de responder. Na dúvida, busque.`,
    direct,
  ].join('\n');
}

export function searchToolSpec(sources: KnowledgeSource[]): ToolSpec {
  return {
    type: 'function',
    function: {
      name: SEARCH_TOOL,
      description: `Busca trechos nos documentos internos da empresa (${sources.map((s) => s.name).join(', ')}). Use para qualquer pergunta que dependa de informação da empresa.`,
      parameters: {
        type: 'object',
        properties: { consulta: { type: 'string', description: 'O que buscar, em português, com os nomes e termos importantes da pergunta e da conversa (ex.: "rollback do auth-service").' } },
        required: ['consulta'],
      },
    },
  };
}

/** Histórico recente e a mensagem nova, depois das instruções. */
export function conversationMessages(history: ChatTurn[], message: string, sources: KnowledgeSource[]): ModelMessage[] {
  return [
    { role: 'system', content: systemPrompt(sources) },
    ...history.slice(-HISTORY_TURNS).map((t): ModelMessage => ({ role: t.role, content: t.content })),
    { role: 'user', content: message.trim() },
  ];
}

/**
 * Consulta de reserva, se o LLM pedir a busca sem dizer o quê: uma pergunta curta de
 * seguimento ("e o rollback?") vai junto com a pergunta anterior.
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

/**
 * Instruções que acompanham o resultado da busca: dado da empresa só dos trechos, com citação;
 * pedido geral (escrever um texto, explicar um conceito) é atendido normalmente. Em pergunta
 * de sim ou não, a regra vem antes da conclusão: o modelo (4B, sem raciocínio) escrevia "Sim"
 * antes de comparar o caso com a regra e se contradizia logo depois (ADR 016).
 */
export const ANSWER_RULES = 'Use estes trechos para responder à última mensagem, em português. Se ela pedir informação da empresa, use só o que está nos trechos e cite cada informação com o número do trecho entre colchetes, logo depois dela, por exemplo [2]; se os trechos não tiverem a resposta, diga que não encontrou isso nas fontes conectadas e não invente. Se a pergunta for de sim ou não ou depender de um valor, prazo, limite ou condição, não comece por "Sim" nem por "Não": escreva primeiro a regra como está no trecho, com a citação, e só depois conclua o que ela significa para o caso perguntado, sem acrescentar condições que o trecho não tem. Se for um pedido geral (escrever um texto, explicar um conceito), atenda normalmente e cite os trechos só se usar alguma informação deles.';

/** Resultado da ferramenta de busca, como o LLM o recebe. */
export function toolResultText(citations: Citation[]): string {
  if (!citations.length) return 'Nenhum trecho encontrado nas fontes para esta consulta. Diga que não encontrou isso nas fontes conectadas; não invente.';
  return `${ANSWER_RULES}\n\nTrechos encontrados:\n\n${citations
    .map((c) => `[${c.n}] ${c.sourceName} · ${c.docTitle} — ${c.heading}\n${c.excerpt}`).join('\n\n')}`;
}

/** Tira marcas [n] de uma resposta que não buscou: não há trecho para elas apontarem. */
export const withoutCitationMarks = (text: string) => text.replace(/\s*\[\d+(?:\s*[,;]\s*\d+)*\]/g, '');

/** Números citados na resposta, em `[2]` ou `[1, 3]`. */
export function citedNumbers(text: string): Set<number> {
  return new Set([...text.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)].flatMap((m) => m[1]!.split(/[,;]/).map((n) => Number(n.trim()))));
}

/**
 * Chat do Ollama com streaming e ferramentas (`POST /api/chat`, NDJSON). Temperatura 0 e
 * modo de raciocínio desligado nos modelos que o têm, como na geração do TCC.
 */
export class OllamaChatModel implements ChatModel {
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

  async *chat(messages: ModelMessage[], { tools, signal }: { tools?: ToolSpec[]; signal?: AbortSignal } = {}): AsyncIterable<ModelEvent> {
    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model, messages, stream: true,
        ...(tools?.length ? { tools } : {}),
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
        const event = JSON.parse(line) as { message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> } }[] }; error?: string };
        if (event.error) throw new Error(`Ollama: ${event.error}`);
        if (event.message?.content) yield { type: 'text', text: event.message.content };
        for (const tc of event.message?.tool_calls ?? []) {
          if (tc.function?.name) yield { type: 'tool', call: { function: { name: tc.function.name, arguments: tc.function.arguments ?? {} } } };
        }
      }
    }
  }
}

// Fim da palavra explícito: em JavaScript, `\b` não trata "á" como letra.
const SMALL_TALK = /^\s*(oi|ol[aá]|e a[ií]|bom dia|boa tarde|boa noite|tudo bem|obrigad[oa]|valeu|tchau)(?=$|[\s,.!?])/i;
const REWRITE = /(^|\s)(resum[aeio]\w*|reescrev\w*|traduz\w*|simplifi\w*|encurt\w*|em t[oó]picos|em uma frase|em (poucas|menos) palavras|mais curt[oa]|mais formal|mais informal)(?=$|[\s,.!?])/i;

/**
 * Mensagens que dispensam a busca: cumprimentos, agradecimentos e pedidos para transformar a
 * resposta anterior ("resuma isso", "em tópicos"). O resto passa sempre pela busca, mesmo
 * que o modelo tente responder direto: num modelo de 4B, deixar a decisão só com ele fazia
 * perguntas de seguimento serem respondidas com dados inventados.
 */
export function isConversational(message: string, history: ChatTurn[]): boolean {
  if (SMALL_TALK.test(message)) return true;
  return history.some((t) => t.role === 'assistant') && message.length <= 120 && REWRITE.test(message);
}

/**
 * Modelo simulado, determinístico e sem rede, para testes e para ver a UI sem Ollama:
 * responde a cumprimentos, busca nas fontes nas demais mensagens e cita o primeiro trecho.
 */
export class SimulatedChatModel implements ChatModel {
  readonly name = 'simulado';

  async *chat(messages: ModelMessage[], { tools }: { tools?: ToolSpec[] } = {}): AsyncIterable<ModelEvent> {
    const last = messages.at(-1)!;
    let reply: string;
    if (last.role === 'tool') {
      const first = last.content.match(/^\[(\d+)\] [^\n]*\n([^\n]*)/m);
      reply = first ? `Segundo as fontes, ${first[2]!.slice(0, 120)} [${first[1]}].` : 'Não encontrei isso nas fontes conectadas.';
    } else if (SMALL_TALK.test(last.content)) {
      reply = 'Olá! Sou o Nexo. Posso conversar e responder perguntas sobre os documentos da empresa, sempre citando a fonte. Em que posso ajudar?';
    } else if (tools?.length) {
      yield { type: 'tool', call: { function: { name: SEARCH_TOOL, arguments: { consulta: last.content } } } };
      return;
    } else {
      reply = 'Ainda não há nenhuma fonte conectada. Envie arquivos ou conecte o Google Drive ou o Confluence em Fontes.';
    }
    for (const word of reply.split(/(?<= )/)) yield { type: 'text', text: word };
  }
}
