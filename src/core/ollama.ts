/**
 * Modelo, digest e versão do servidor Ollama, para o registro do ambiente. `sizeVram` é
 * quanto do modelo está na GPU no momento do registro (0 = só CPU; null = modelo não
 * carregado) e explica a latência.
 */
export async function describeOllamaModel(baseUrl: string, model: string, fetchFn: typeof fetch = fetch) {
  const get = async <T>(path: string) => (await (await fetchFn(`${baseUrl}${path}`)).json()) as T;
  const [tags, version, ps] = await Promise.all([
    get<{ models?: { name: string; digest: string }[] }>('/api/tags'),
    get<{ version?: string }>('/api/version'),
    get<{ models?: { name: string; size_vram: number }[] }>('/api/ps'),
  ]);
  const isModel = (x: { name: string }) => x.name === model || x.name === `${model}:latest`;
  return {
    model,
    digest: tags.models?.find(isModel)?.digest ?? null,
    ollamaVersion: version.version ?? null,
    sizeVram: ps.models?.find(isModel)?.size_vram ?? null,
  };
}
