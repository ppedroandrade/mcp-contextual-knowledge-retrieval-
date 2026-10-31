import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from '../corpus/generate.js';

/** Descrição do ambiente gravada junto com cada execução. */
export function environment(extra: Record<string, unknown> = {}) {
  const git = (cmd: string) => {
    try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
  };
  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'desconhecida',
    cpuCount: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    gitCommit: git('rev-parse HEAD'),
    // results/ só guarda saídas de execuções (inclusive a atual); não é código alterado.
    gitDirty: (git("status --porcelain -- . ':(exclude)results'") ?? '') !== '',
    ...extra,
  };
}

/** Grava os arquivos JSON de uma execução em `results/runs/<id>/` e devolve o diretório. */
export function saveRun(id: string, files: Record<string, unknown>): string {
  const dir = join(DATA_DIR, '..', 'results', 'runs', id);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(content, null, 2) + '\n');
  return dir;
}
