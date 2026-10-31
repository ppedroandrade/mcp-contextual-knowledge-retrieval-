import { execSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';

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
