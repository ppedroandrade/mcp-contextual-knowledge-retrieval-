import { normalize, tokenize } from '../core/text.js';
import { parseAnswer } from '../generation/answer.js';
import { ABSTENTION } from '../generation/prompt.js';
import type { ChatMessage, LlmProvider } from '../generation/provider.js';
import type { WorkspaceHost } from './mcp.js';
import type { ChatTurn, ChunkHit, CitationView, Conversation } from './types.js';
import type { Workspace } from './workspace.js';

/** Trechos entregues ao LLM por pergunta (o mesmo k do experimento). */
export const WORKSPACE_CONTEXT = 5;
/** Turnos anteriores enviados ao LLM, para perguntas de continuação ("e no interior?"). */
export const HISTORY_TURNS = 4;
export const MAX_QUESTION = 2000;

/**
 * Instruções do assistente do workspace. Parecidas com as do experimento (só os trechos,
 * citação do id, abstenção), mas com respostas um pouco mais longas e histórico da conversa.
 */
export const WORKSPACE_SYSTEM_PROMPT = [
  'Você é o assistente de conhecimento interno de uma empresa. Responde perguntas dos colaboradores usando somente os trechos de documentos fornecidos a cada pergunta.',
  '',
  'Regras:',
  '1. Use apenas o que está escrito nos trechos. Não use conhecimento próprio e não suponha nada.',
  '2. Cite o id de cada trecho que sustenta a resposta, entre colchetes, logo depois da informação. Exemplo: "O prazo é de 30 dias [D3#2]."',
  `3. Se os trechos não trouxerem a informação pedida, responda exatamente: "${ABSTENTION}" Nesse caso, não cite trechos.`,
  '4. Responda em português, de forma direta e clara, em no máximo 6 frases. Pode usar uma lista curta quando ajudar.',
  '5. As mensagens anteriores da conversa servem só para entender a pergunta; os fatos vêm dos trechos.',
].join('\n');

export function buildWorkspaceMessages(question: string, hits: ChunkHit[], history: ChatTurn[], sourceName: (id: string) => string): ChatMessage[] {
  const context = hits.map(({ chunk: c }) => `[${c.id}] (fonte: ${sourceName(c.sourceId)}; documento: ${c.title}${c.heading ? `; seção: ${c.heading}` : ''})\n${c.text}`).join('\n\n');
  const past = history.slice(-HISTORY_TURNS).map((t): ChatMessage => ({ role: t.role, content: t.text }));
  return [
    { role: 'system', content: WORKSPACE_SYSTEM_PROMPT },
    ...past,
    { role: 'user', content: `Trechos:\n\n${context || '(nenhum trecho encontrado)'}\n\nPergunta: ${question}` },
  ];
}

/**
 * Consulta enviada às tools. Pergunta de continuação numa conversa em andamento ("e no
 * interior?", "e para PJ?") depende da anterior: junta a última pergunta do usuário.
 * Heurística simples, sem LLM: começa com "e", "mas" ou "também", ou tem até 2 termos e não
 * começa com palavra interrogativa.
 */
export function retrievalQuery(question: string, history: ChatTurn[]): string {
  const lastUser = [...history].reverse().find((t) => t.role === 'user');
  if (!lastUser) return question;
  const q = normalize(question.trim());
  const continuation = /^(e|mas|tambem)\b/.test(q)
    || (tokenize(question).length <= 2 && !/^(qual|quais|quem|quando|onde|como|quanto|quantos|quantas|o que|por que|porque)\b/.test(q));
  return continuation ? `${lastUser.text}\n${question}` : question;
}

/**
 * Resposta extrativa, sem LLM: as frases dos trechos recuperados que mais cobrem os termos da
 * pergunta, com a citação. Cada termo pesa pelo IDF entre os trechos (termo presente em todos
 * ajuda pouco); o título da seção ("Causa raiz", "Prazo") conta inteiro e o do documento pela
 * metade. Serve para usar o app
 * sem o Ollama; não é geração.
 */
export function extractiveAnswer(question: string, hits: ChunkHit[]): string {
  const terms = [...new Set(tokenize(question))];
  const bags = hits.map(({ chunk: c }) => new Set(tokenize(`${c.title} ${c.heading} ${c.text}`)));
  const idf = new Map(terms.map((t) => {
    const df = bags.filter((b) => b.has(t)).length;
    // Números curtos ("14", "10") casam com qualquer data ou valor: peso menor.
    return [t, df === 0 ? 0 : Math.log(1 + hits.length / df) * (/^\d{1,2}$/.test(t) ? 0.3 : 1)];
  }));
  const weight = (text: string) => { const bag = new Set(tokenize(text)); return terms.reduce((s, t) => s + (bag.has(t) ? idf.get(t)! : 0), 0); };
  const picked: { sentence: string; id: string; score: number }[] = [];
  for (const { chunk } of hits) {
    const heading = weight(chunk.heading);
    const context = heading + 0.5 * weight(chunk.title);
    for (const raw of chunk.text.split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = raw.trim().replace(/^[-•]\s*/, '');
      const own = weight(sentence);
      if (sentence.length < 12 || (own === 0 && heading === 0)) continue;
      picked.push({ sentence, id: chunk.id, score: own + context });
    }
  }
  picked.sort((a, b) => b.score - a.score);
  if (picked.length === 0) return ABSTENTION;
  // A melhor frase e, se for quase tão boa e de outro trecho, a segunda.
  const top = [picked[0]!, ...picked.slice(1).filter((p) => p.score >= 0.8 * picked[0]!.score && p.sentence !== picked[0]!.sentence).slice(0, 1)];
  return top.map((p) => `${p.sentence.replace(/[.!?]?$/, '')} [${p.id}].`).join(' ');
}

const titleFrom = (q: string) => (q.length > 60 ? `${q.slice(0, 57).trimEnd()}…` : q);

/** Conversas do workspace: recuperação pelo host MCP, resposta do LLM (ou extrativa) e citações. */
export class ChatService {
  constructor(private readonly ws: Workspace, private readonly host: WorkspaceHost, private readonly llm: LlmProvider | null) {}

  get mode() {
    return this.llm ? this.llm.name : 'extrativo (sem LLM)';
  }

  list(): Pick<Conversation, 'id' | 'title' | 'updatedAt'>[] {
    return this.ws.state.data.conversations.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Conversation | undefined {
    return this.ws.state.data.conversations.find((c) => c.id === id);
  }

  remove(id: string) {
    this.ws.state.data.conversations = this.ws.state.data.conversations.filter((c) => c.id !== id);
    this.ws.state.save();
  }

  private view(h: ChunkHit): CitationView {
    const s = this.ws.sources().find((x) => x.id === h.chunk.sourceId);
    const doc = this.ws.doc(h.chunk.docKey);
    const url = h.chunk.url ?? doc?.url;
    return {
      chunkId: h.chunk.id, sourceId: h.chunk.sourceId, sourceName: s?.name ?? h.chunk.sourceId, kind: s?.kind ?? 'upload',
      title: h.chunk.title, heading: h.chunk.heading, text: h.chunk.text, score: h.score, ...(url ? { url } : {}),
    };
  }

  async ask(conversationId: string | null, question: string): Promise<{ conversation: Conversation; turn: ChatTurn }> {
    const q = question.trim();
    if (!q) throw new Error('informe a pergunta');
    let conv = conversationId ? this.get(conversationId) : undefined;
    if (conversationId && !conv) throw new Error('conversa não encontrada');
    const now = new Date().toISOString();
    if (!conv) {
      conv = { id: this.ws.newConversationId(), title: titleFrom(q), createdAt: now, updatedAt: now, turns: [] };
      this.ws.state.data.conversations.push(conv);
    }
    const history = conv.turns;
    const t0 = performance.now();
    const query = retrievalQuery(q, history);
    const { hits, tools } = await this.host.search(query, WORKSPACE_CONTEXT);
    const t1 = performance.now();
    const context = hits.slice(0, WORKSPACE_CONTEXT);
    const text = this.llm
      ? (await this.llm.complete(buildWorkspaceMessages(q, context, history, (id) => this.ws.sources().find((s) => s.id === id)?.name ?? id))).text
      : extractiveAnswer(query, context);
    const parsed = parseAnswer(text, context.map((h) => h.chunk.id));
    const passages = context.map((h) => this.view(h));
    const turn: ChatTurn = {
      role: 'assistant', text, at: new Date().toISOString(),
      citations: parsed.abstained ? [] : parsed.citedUnitIds.map((id) => passages.find((p) => p.chunkId === id)!),
      passages, abstained: parsed.abstained, invalidCitations: parsed.invalidCitations, tools,
      timing: { retrievalMs: t1 - t0, totalMs: performance.now() - t0 },
    };
    conv.turns.push({ role: 'user', text: q, at: now }, turn);
    conv.updatedAt = turn.at;
    this.ws.state.save();
    return { conversation: conv, turn };
  }
}
