import { execFileSync } from 'node:child_process';

/**
 * H3, passo 4 (docs/h3-protocolo.md): conta o `git diff --numstat` de cada integração da 4ª
 * fonte a partir do commit congelado e classifica cada arquivo numa camada. Imprime JSON.
 *
 * Uso: npx tsx scripts/h3-diff.ts <commit congelado> <ref da integração customizada> <ref da integração MCP>
 */
export const LAYERS: [RegExp, string][] = [
  [/^src\/sources\/catalog\.ts$/, 'catálogo das fontes'],
  [/^src\/sources\//, 'leitor da fonte'],
  [/^src\/(approaches|generation|retrieval|api)\//, 'host'],
  [/^src\/mcp\//, 'servidor MCP'],
  [/^src\/bench\//, 'configuração do experimento'],
  [/^test\//, 'testes'],
  [/(^docs\/|\.md$)/, 'documentação'],
];

export const layerOf = (path: string) => LAYERS.find(([re]) => re.test(path))?.[1] ?? 'outros';

export function numstat(base: string, ref: string) {
  const out = execFileSync('git', ['diff', '--numstat', `${base}..${ref}`], { encoding: 'utf8' });
  const files = out.trim().split('\n').filter(Boolean).map((line) => {
    const [add, del, path] = line.split('\t') as [string, string, string];
    return { path, layer: layerOf(path), added: Number(add), removed: Number(del) };
  });
  const byLayer: Record<string, { files: number; added: number; removed: number }> = {};
  for (const f of files) {
    const l = (byLayer[f.layer] ??= { files: 0, added: 0, removed: 0 });
    l.files++; l.added += f.added; l.removed += f.removed;
  }
  const commit = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
  return {
    ref, commit, files, byLayer,
    total: { files: files.length, added: files.reduce((s, f) => s + f.added, 0), removed: files.reduce((s, f) => s + f.removed, 0) },
    hostIntocado: !files.some((f) => f.layer === 'host'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, custom, mcp] = process.argv.slice(2);
  if (!base || !custom || !mcp) throw new Error('uso: npx tsx scripts/h3-diff.ts <congelado> <customizada> <mcp>');
  console.log(JSON.stringify({ congelamento: execFileSync('git', ['rev-parse', base], { encoding: 'utf8' }).trim(), customizada: numstat(base, custom), mcp: numstat(base, mcp) }, null, 2));
}
