import { describeOllamaModel } from '../core/ollama.js';
import { tokenize } from '../core/text.js';

/** Gera vetores para textos. Todas as abordagens vetoriais usam o mesmo `Embedder`. */
export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
  /** Metadados para o registro do ambiente (modelo, digest). */
  describe(): Promise<Record<string, unknown>>;
}

export function l2normalize(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Embeddings do Ollama (`POST /api/embed`), em lotes. Os vetores são normalizados para que
 * a distância de cosseno e o produto interno deem a mesma ordem.
 */
export class OllamaEmbedder implements Embedder {
  readonly name: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly batchSize = 32,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `ollama:${model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const res = await this.fetchFn(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts.slice(i, i + this.batchSize) }),
      });
      if (!res.ok) throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { embeddings?: number[][] };
      if (!body.embeddings || body.embeddings.length !== Math.min(this.batchSize, texts.length - i)) {
        throw new Error('Ollama devolveu um número de embeddings diferente do enviado');
      }
      out.push(...body.embeddings.map(l2normalize));
    }
    return out;
  }

  async describe() {
    return { embedder: 'ollama', ...(await describeOllamaModel(this.baseUrl, this.model, this.fetchFn)) };
  }
}

/**
 * Embedding por hashing de termos (bag-of-words projetado). Determinístico e sem rede:
 * serve para testes e para rodar o pipeline sem o Ollama. **Não é semântico** e não deve
 * ser usado nos resultados do experimento.
 */
export class HashEmbedder implements Embedder {
  readonly name: string;

  constructor(readonly dim = 256) {
    this.name = `hash:${dim}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dim).fill(0);
      for (const tok of tokenize(t)) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 16777619);
        v[(h >>> 0) % this.dim]! += (h & 1) === 0 ? 1 : -1;
      }
      return l2normalize(v);
    });
  }

  async describe() {
    return { embedder: 'hash', dim: this.dim, warning: 'não semântico; só para testes' };
  }
}
