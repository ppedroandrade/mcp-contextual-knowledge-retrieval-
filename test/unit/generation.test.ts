import { describe, expect, it, vi } from 'vitest';
import { createGlobalVectorRetriever } from '../../src/approaches/b-rag.js';
import { createPerSourceRetriever } from '../../src/approaches/c-per-source.js';
import { runGeneration, summarizeGeneration, type GenerationResult } from '../../src/bench/generation.js';
import type { Hit, Question, SourceName } from '../../src/core/types.js';
import { buildCorpus } from '../../src/corpus/generate.js';
import { generateAnswer, parseAnswer } from '../../src/generation/answer.js';
import { OllamaChatProvider } from '../../src/generation/ollama.js';
import { ABSTENTION, buildMessages, CONTEXT_UNITS, PROMPT_SHA256, SYSTEM_PROMPT } from '../../src/generation/prompt.js';
import type { ChatMessage } from '../../src/generation/provider.js';
import { SimulatedProvider } from '../../src/generation/simulated.js';
import { HashEmbedder } from '../../src/indexing/embeddings.js';
import { ingest } from '../../src/indexing/ingest.js';
import { MemoryVectorStore } from '../../src/indexing/vector-store.js';
import { parseSource } from '../../src/sources/index.js';

const hit = (unitId: string, source: SourceName = 'docs', text = `texto de ${unitId}`): Hit =>
  ({ chunkId: unitId, unitId, docId: unitId.split('#')[0]!, source, text, score: 1 });

describe('prompt', () => {
  it('é fixo: mudar o prompt exige atualizar este teste de propósito', () => {
    expect(PROMPT_SHA256).toBe('0b3770f3f86a975713e156319d570d77470cfc276769319413dced7e263d76db');
  });

  it('monta as instruções fixas, os trechos na ordem da recuperação e a pergunta', () => {
    const [system, user] = buildMessages('Qual é a causa?', [hit('INC-1#causa', 'incidents'), hit('T-1#resolucao', 'tickets')]);
    expect(system).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(user!.content).toBe(
      'Trechos:\n\n[INC-1#causa] (fonte: Registros de incidentes)\ntexto de INC-1#causa\n\n' +
      '[T-1#resolucao] (fonte: Chamados de suporte)\ntexto de T-1#resolucao\n\nPergunta: Qual é a causa?',
    );
  });

  it('pede a frase exata de abstenção', () => {
    expect(SYSTEM_PROMPT).toContain(ABSTENTION);
  });
});

describe('parseAnswer', () => {
  const ctx = ['A#x', 'B#y', 'C#z'];

  it('lê citações válidas, várias no mesmo colchete, sem repetir', () => {
    const p = parseAnswer('Foi o firewall [B#y]. O cliente foi avisado [A#x; B#y] e [C#z, A#x].', ctx);
    expect(p.citedUnitIds).toEqual(['B#y', 'A#x', 'C#z']);
    expect(p.invalidCitations).toEqual([]);
    expect(p.abstained).toBe(false);
  });

  it('separa citações de trechos que não estavam no contexto', () => {
    expect(parseAnswer('Resposta [A#x] [Z#w] [nota sem id].', ctx).invalidCitations).toEqual(['Z#w']);
  });

  it('reconhece a abstenção com ou sem acento, aspas ou negrito', () => {
    for (const t of [ABSTENTION, 'nao sei: faltam dados', '"Não sei."', '**Não sei**: os trechos não dizem.', `A documentação não descreve a causa. ${ABSTENTION}`]) {
      expect(parseAnswer(t, ctx).abstained, t).toBe(true);
    }
    expect(parseAnswer('O time não sei se mantém [A#x].', ctx).abstained).toBe(false);
  });
});

describe('generateAnswer', () => {
  it('entrega ao LLM só os primeiros trechos e devolve citações e contexto', async () => {
    const seen: ChatMessage[][] = [];
    const llm = new SimulatedProvider((m) => { seen.push(m); return 'Resposta [u2#a] [u9#a].'; });
    const hits = Array.from({ length: 8 }, (_, i) => hit(`u${i}#a`));
    const a = await generateAnswer(llm, 'pergunta?', hits);
    expect(a.contextUnitIds).toEqual(['u0#a', 'u1#a', 'u2#a', 'u3#a', 'u4#a']);
    expect(CONTEXT_UNITS).toBe(5);
    expect(seen[0]![1]!.content).not.toContain('u5#a');
    expect(a.citedUnitIds).toEqual(['u2#a']);
    expect(a.invalidCitations).toEqual(['u9#a']);
  });
});

describe('SimulatedProvider', () => {
  it('cita o primeiro trecho ou, sem trechos, diz que não sabe', async () => {
    const llm = new SimulatedProvider();
    expect((await generateAnswer(llm, 'p?', [hit('A#x'), hit('B#y')])).text).toBe('Resposta simulada [A#x].');
    expect((await generateAnswer(llm, 'p?', [])).abstained).toBe(true);
  });
});

describe('OllamaChatProvider', () => {
  const chatResponse = { message: { content: '  Resposta [A#x].  ' }, done_reason: 'stop', prompt_eval_count: 120, eval_count: 9, load_duration: 2_500_000 };
  const fakeOllama = (capabilities: string[]) => vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const path = String(url).replace('http://o', '');
    if (path === '/api/show') return new Response(JSON.stringify({ capabilities }));
    if (path === '/api/chat') return new Response(JSON.stringify(chatResponse));
    if (path === '/api/tags') return new Response(JSON.stringify({ models: [{ name: 'm:4b', digest: 'abc' }] }));
    if (path === '/api/version') return new Response(JSON.stringify({ version: '0.40.13' }));
    return new Response(JSON.stringify({ models: [{ name: 'm:4b', size_vram: 0 }] }));
  });
  const messages: ChatMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];

  it('pede temperatura 0, semente, contexto e limite fixos, sem streaming', async () => {
    const f = fakeOllama(['completion']);
    const c = await new OllamaChatProvider('http://o', 'm:4b', { numCtx: 4096, numPredict: 256, seed: 7 }, f as unknown as typeof fetch).complete(messages);
    const chat = f.mock.calls.find(([u]) => String(u).endsWith('/api/chat'))!;
    expect(JSON.parse(String(chat[1]!.body))).toEqual({
      model: 'm:4b', messages, stream: false,
      options: { temperature: 0, seed: 7, num_ctx: 4096, num_predict: 256 },
    });
    expect(c).toEqual({ text: 'Resposta [A#x].', promptTokens: 120, outputTokens: 9, loadMs: 2.5, truncated: false });
  });

  it('desliga o modo de raciocínio nos modelos que o têm', async () => {
    const f = fakeOllama(['completion', 'thinking']);
    const llm = new OllamaChatProvider('http://o', 'm:4b', undefined, f as unknown as typeof fetch);
    await llm.complete(messages);
    await llm.complete(messages);
    const chats = f.mock.calls.filter(([u]) => String(u).endsWith('/api/chat'));
    expect(chats.map(([, init]) => JSON.parse(String(init!.body)).think)).toEqual([false, false]);
    expect(f.mock.calls.filter(([u]) => String(u).endsWith('/api/show'))).toHaveLength(1);
  });

  it('marca a resposta cortada pelo limite de tokens', async () => {
    const f = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).endsWith('/api/show') ? { capabilities: [] } : { ...chatResponse, done_reason: 'length' })));
    expect((await new OllamaChatProvider('http://o', 'm', undefined, f as unknown as typeof fetch).complete(messages)).truncated).toBe(true);
  });

  it('recusa um prompt que pode não caber no contexto, em vez de deixar o Ollama truncar', async () => {
    const f = fakeOllama([]);
    const llm = new OllamaChatProvider('http://o', 'm', { numCtx: 1024, numPredict: 512, seed: 1 }, f as unknown as typeof fetch);
    await expect(llm.complete([{ role: 'user', content: 'x'.repeat(300) }])).rejects.toThrow(/num_ctx = 1024/);
    expect(f).not.toHaveBeenCalled();
  });

  it('falha com mensagem clara quando o Ollama devolve erro', async () => {
    const bad = (async () => new Response('model not found', { status: 404 })) as unknown as typeof fetch;
    await expect(new OllamaChatProvider('http://o', 'x', undefined, bad).complete(messages)).rejects.toThrow(/404/);
  });

  it('descreve modelo, digest, opções e o modo de raciocínio', async () => {
    const f = fakeOllama(['thinking']);
    expect(await new OllamaChatProvider('http://o', 'm:4b', { numCtx: 4096, numPredict: 256, seed: 7 }, f as unknown as typeof fetch).describe()).toEqual({
      llm: 'ollama', model: 'm:4b', digest: 'abc', ollamaVersion: '0.40.13', sizeVram: 0,
      options: { temperature: 0, numCtx: 4096, numPredict: 256, seed: 7 }, thinkingDisabled: true,
    });
  });
});

describe('runGeneration', () => {
  const corpus = buildCorpus();
  const sources: SourceName[] = ['docs', 'tickets', 'incidents'];
  const questions = corpus.questions.dev;

  async function retrievers() {
    const embedder = new HashEmbedder();
    const store = new MemoryVectorStore();
    await ingest(sources.flatMap((s) => parseSource(s, corpus.files)), embedder, store);
    return [createGlobalVectorRetriever(embedder, store), createPerSourceRetriever(embedder, store, sources)];
  }

  it('mede recuperação e recuperação + geração em cada rodada, sem contar o aquecimento', async () => {
    const results = await runGeneration(await retrievers(), questions.slice(0, 4), new SimulatedProvider(), 2);
    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(r.retrievalMs).toHaveLength(2);
      expect(r.totalMs).toHaveLength(2);
      r.totalMs.forEach((t, i) => expect(t).toBeGreaterThanOrEqual(r.retrievalMs[i]!));
      expect(r.changedAnswers).toBe(0);
      expect(r.answer.contextUnitIds).toHaveLength(CONTEXT_UNITS);
    }
  });

  it('resume abstenção e citações por abordagem', async () => {
    const unanswerable = new Set(questions.filter((q) => q.type === 'unanswerable').map((q) => q.text));
    const llm = new SimulatedProvider((m) => {
      const question = m[1]!.content.split('Pergunta: ')[1]!;
      return unanswerable.has(question) ? ABSTENTION : `Resposta [${m[1]!.content.match(/^\[([^\]]+)\]/m)![1]}].`;
    });
    const pick = (type: Question['type'], n: number) => questions.filter((q) => q.type === type).slice(0, n);
    const results = await runGeneration(await retrievers(), [...pick('unanswerable', 2), ...pick('single-source', 2)], llm, 0);
    const s = summarizeGeneration(results, questions)['B-rag']!;
    expect(s).toMatchObject({ perguntas: 4, abstencaoCorreta: 1, citamTrecho: 1, citacaoInvalida: 0, truncadas: 0 });
    expect(s.latenciaTotalMs).toBeNaN();
  });

  it('separa a abstenção com e sem toda a evidência nos trechos entregues', () => {
    const q = (id: string, type: Question['type'], evidence: string[][]) => ({ id, type, evidence }) as Question;
    const r = (questionId: string, type: Question['type'], contextUnitIds: string[], abstained: boolean): GenerationResult => ({
      questionId, type, retriever: 'X', changedAnswers: 0, retrievalMs: [], totalMs: [], loadMs: [],
      answer: { text: '', contextUnitIds, abstained, citedUnitIds: [], invalidCitations: [], promptTokens: null, outputTokens: null, loadMs: null, truncated: false },
    });
    const qs = [
      q('q1', 'single-source', [['a#1']]),
      q('q2', 'multi-source', [['a#1'], ['b#1', 'b#2']]),
      q('q3', 'multi-source', [['a#1'], ['c#1']]),
      q('q4', 'unanswerable', []),
    ];
    const results = [
      r('q1', 'single-source', ['a#1'], true), // tinha a evidência e se absteve: erro do modelo
      r('q2', 'multi-source', ['b#2', 'a#1'], false), // alternativa b#2 satisfaz a segunda evidência
      r('q3', 'multi-source', ['a#1', 'x#1'], true), // faltava c#1: abster-se é o esperado
      r('q4', 'unanswerable', ['x#1'], true),
    ];
    expect(summarizeGeneration(results, qs).X).toMatchObject({
      perguntas: 4, abstencaoCorreta: 1, comEvidenciaNoContexto: 2, abstencaoComEvidencia: 0.5, abstencaoSemEvidencia: 1,
    });
  });
});
