import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'scripts', 'onboard-credor.mjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Dispara backfill + sync do ABE WEB em background após cadastro de responsável.
 * Não bloqueia a resposta da API; falhas são logadas no processo filho.
 */
export function scheduleCredorOnboard(credorId: string): void {
  if (!process.env.ABEWEB_DB_HOST?.trim()) {
    console.info(`[onboard] ABEWEB não configurado — sync do credor ${credorId} omitido`);
    return;
  }

  const root = findRepoRoot();
  const script = path.join(root, 'scripts', 'onboard-credor.mjs');
  const args = ['--env-file', path.join(root, '.env'), script, `--credor=${credorId}`];

  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });

  child.unref();
  console.info(`[onboard] Sync agendado em background para credor ${credorId}`);
}
