import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { EvidenceUnit, Retriever, SourceName } from '../core/types.js';
import { generateAnswer } from '../generation/answer.js';
import { CONTEXT_UNITS } from '../generation/prompt.js';
import type { LlmProvider } from '../generation/provider.js';
import { SOURCE_CATALOG } from '../sources/catalog.js';

/**
 * API da demonstração (docs/arquitetura.md, seção 4). Não tem lógica própria: chama os
 * mesmos `Retriever` e `generateAnswer` do benchmark. Fora do escopo experimental: nada do
 * que passa por aqui entra nas métricas.
 */

/** Letra da abordagem (A–D) e a descrição mostrada na UI. */
export const APPROACHES: Record<string, { label: string; description: string; generates: boolean }> = {
  A: { label: 'A · Busca textual (BM25)', description: 'Busca por palavras num índice único. Não gera resposta: mostra só os trechos.', generates: false },
  B: { label: 'B · RAG tradicional', description: 'Busca semântica num índice único com todas as fontes misturadas, e resposta do LLM.', generates: true },
  C: { label: 'C · Busca por fonte, sem MCP', description: 'Busca semântica em cada fonte separada, fusão por RRF e resposta do LLM. Controle sem protocolo.', generates: true },
  D: { label: 'D · MCP + RAG', description: 'Igual à C, mas cada fonte é uma tool de um servidor MCP descoberta pelo host com tools/list.', generates: true },
};

export interface DemoDeps {
  /** Unidades indexadas (para listar as fontes e abrir um trecho citado). */
  units: EvidenceUnit[];
  sources: SourceName[];
  /** Abordagens disponíveis, pela letra. */
  retrievers: Record<string, Retriever>;
  llm: LlmProvider | null;
  /** Descrição do modo de execução (embedder, armazenamento, LLM), mostrada na UI. */
  mode: Record<string, string>;
  /** Pasta com o front estático; `null` desliga a entrega de arquivos. */
  staticDir?: string | null;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const MAX_BODY = 16 * 1024;
const MAX_QUESTION = 500;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'corpo da requisição grande demais');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const STATIC_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Cria o tratador HTTP. Separado do `listen` para os testes chamarem sem rede externa. */
export function createDemoHandler(deps: DemoDeps) {
  const unitsById = new Map(deps.units.map((u) => [u.id, u]));
  const available = Object.keys(deps.retrievers).filter((k) => k in APPROACHES).sort();

  function sourcesPayload() {
    return deps.sources.map((source) => {
      const mine = deps.units.filter((u) => u.source === source);
      const docs = [...Map.groupBy(mine, (u) => u.docId)].map(([docId, us]) => ({
        docId, title: us[0]!.title, units: us.map((u) => ({ id: u.id, heading: u.heading })),
      }));
      return { source, ...SOURCE_CATALOG[source], documents: docs.length, unitCount: mine.length, docs };
    });
  }

  async function ask(body: unknown) {
    const { question, approach } = (body ?? {}) as { question?: unknown; approach?: unknown };
    if (typeof question !== 'string' || !question.trim()) throw new HttpError(400, 'informe a pergunta');
    if (question.length > MAX_QUESTION) throw new HttpError(400, `pergunta com mais de ${MAX_QUESTION} caracteres`);
    if (typeof approach !== 'string' || !available.includes(approach)) throw new HttpError(400, `abordagem inválida; use uma de: ${available.join(', ')}`);
    const retriever = deps.retrievers[approach]!;
    const t0 = performance.now();
    const hits = await retriever.search(question.trim(), CONTEXT_UNITS);
    const t1 = performance.now();
    const passages = hits.slice(0, CONTEXT_UNITS).map((h) => {
      const u = unitsById.get(h.unitId);
      return { unitId: h.unitId, docId: h.docId, source: h.source, sourceTitle: SOURCE_CATALOG[h.source].title, title: u?.title ?? h.docId, heading: u?.heading ?? '', text: u?.text ?? h.text, score: h.score };
    });
    let answer = null;
    if (APPROACHES[approach]!.generates && deps.llm) {
      const g = await generateAnswer(deps.llm, question.trim(), hits);
      answer = { text: g.text, citedUnitIds: g.citedUnitIds, invalidCitations: g.invalidCitations, abstained: g.abstained, truncated: g.truncated };
    }
    const t2 = performance.now();
    return { approach, retriever: retriever.name, passages, answer, timing: { retrievalMs: t1 - t0, totalMs: t2 - t0 } };
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && path === '/api/config') {
      return send(res, 200, { approaches: available.map((k) => ({ id: k, ...APPROACHES[k]!, generates: APPROACHES[k]!.generates && !!deps.llm })), mode: deps.mode });
    }
    if (req.method === 'GET' && path === '/api/sources') return send(res, 200, { sources: sourcesPayload() });
    if (req.method === 'GET' && path.startsWith('/api/units/')) {
      const u = unitsById.get(decodeURIComponent(path.slice('/api/units/'.length)));
      if (!u) throw new HttpError(404, 'trecho não encontrado');
      return send(res, 200, { ...u, sourceTitle: SOURCE_CATALOG[u.source].title });
    }
    if (req.method === 'POST' && path === '/api/ask') return send(res, 200, await ask(await readJson(req)));
    if (path.startsWith('/api/')) throw new HttpError(404, 'rota não encontrada');
    if (req.method === 'GET' && deps.staticDir) {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const ext = file.slice(file.lastIndexOf('.'));
      // Só arquivos da própria pasta, sem subpastas nem "..".
      if (/^[\w.-]+$/.test(file) && !file.startsWith('.') && STATIC_TYPES[ext]) {
        try {
          const content = readFileSync(join(deps.staticDir, file));
          res.writeHead(200, { 'content-type': `${STATIC_TYPES[ext]}; charset=utf-8` });
          return res.end(content);
        } catch {
          /* cai no 404 */
        }
      }
    }
    throw new HttpError(404, 'não encontrado');
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  };
}
