import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from '../corpus/generate.js';

/** Versão principal do Node das medições (ADR 001 e 009; `.nvmrc`; a mesma do CI). */
export const MEASUREMENT_NODE_MAJOR = 22;

/**
 * As medições de latência só rodam no Node fixado, para as rodadas serem comparáveis entre
 * si. `TCC_ALLOW_ANY_NODE=1` libera outra versão (fica registrado em `environment.json`), só
 * para testes.
 */
export function assertMeasurementNode(version = process.version, env: NodeJS.ProcessEnv = process.env): void {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (major === MEASUREMENT_NODE_MAJOR || env.TCC_ALLOW_ANY_NODE === '1') return;
  throw new Error(`as medições usam Node ${MEASUREMENT_NODE_MAJOR} (ADR 009), mas este é ${version}; use \`nvm use\` (arquivo .nvmrc) ou defina TCC_ALLOW_ANY_NODE=1 para um teste sem valor experimental`);
}

/** Descrição do ambiente gravada junto com cada execução. */
export function environment(extra: Record<string, unknown> = {}) {
  const git = (cmd: string) => {
    try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
  };
  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    nodeFixado: Number(process.version.slice(1).split('.')[0]) === MEASUREMENT_NODE_MAJOR,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'desconhecida',
    cpuCount: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    gitCommit: git('rev-parse HEAD'),
    // results/ só guarda saídas de execuções (inclusive a atual); não é código alterado.
    gitDirty: (git("status --porcelain -- . ':(exclude)results'") ?? '') !== '',
    powerSource: powerSource(),
    ...extra,
  };
}

/** No macOS, "AC Power" ou "Battery Power": na bateria o sistema pode reduzir o desempenho. */
function powerSource(): string | null {
  if (platform() !== 'darwin') return null;
  try {
    return execSync('pmset -g batt', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().match(/'([^']+)'/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Grava os arquivos JSON de uma execução em `results/runs/<id>/` e devolve o diretório. */
export function saveRun(id: string, files: Record<string, unknown>): string {
  const dir = join(DATA_DIR, '..', 'results', 'runs', id);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(content, null, 2) + '\n');
  return dir;
}
