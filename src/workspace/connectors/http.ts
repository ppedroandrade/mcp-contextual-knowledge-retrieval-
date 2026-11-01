/** Erro de uma API de conector, com o status HTTP (0 = falha de rede ou tempo esgotado). */
export class ConnectorHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface RequestOptions {
  /** Tentativas extras em 429, 5xx, falha de rede ou tempo esgotado. */
  retries?: number;
  timeoutMs?: number;
  /** Espera entre tentativas (ms); injetável para os testes não dormirem. */
  backoffMs?: (attempt: number) => number;
}

const DEFAULTS = { retries: 3, timeoutMs: 30_000, backoffMs: (a: number) => 500 * 2 ** a };

/**
 * `fetch` com tempo limite e novas tentativas com espera exponencial nas falhas transitórias
 * (429, 5xx, rede). Respeita `Retry-After` em segundos. Erros 4xx (exceto 429) não são
 * repetidos: credencial errada não melhora tentando de novo.
 */
export async function request(fetchFn: typeof fetch, url: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<Response> {
  const { retries, timeoutMs, backoffMs } = { ...DEFAULTS, ...opts };
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let failure: string;
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      failure = `${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`.trim();
      if (res.status !== 429 && res.status < 500) throw new ConnectorHttpError(res.status, `${new URL(url).host} respondeu ${failure}`);
    } catch (err) {
      if (err instanceof ConnectorHttpError) throw err;
      failure = err instanceof Error && err.name === 'TimeoutError' ? `tempo esgotado (${timeoutMs} ms)` : `falha de rede: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (attempt >= retries) throw new ConnectorHttpError(res?.status ?? 0, `${new URL(url).host}: ${failure} (depois de ${attempt + 1} tentativas)`);
    const retryAfter = Number(res?.headers.get('retry-after'));
    await new Promise((ok) => setTimeout(ok, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt)));
  }
}

export async function requestJson<T>(fetchFn: typeof fetch, url: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<T> {
  return (await (await request(fetchFn, url, init, opts)).json()) as T;
}
