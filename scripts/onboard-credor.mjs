/**
 * Onboarding de credor: descobre códigos no legado + sync inicial do dashboard.
 * Disparado automaticamente ao cadastrar responsável (ADMIN_CREDOR).
 *
 * Uso:
 *   pnpm onboard:credor --credor=<uuid>
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { runAbeWebSync } from './lib/sync-credor-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const CREDOR_ID = process.argv
  .find((a) => a.startsWith('--credor='))
  ?.split('=')[1]
  ?.trim();

if (!CREDOR_ID) {
  console.error('Informe --credor=<uuid>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function runScript(relativePath, extraArgs = []) {
  const scriptPath = path.join(REPO_ROOT, relativePath);
  const result = spawnSync(process.execPath, ['--env-file=.env', scriptPath, ...extraArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.warn(`[onboard] ${relativePath} terminou com código ${result.status ?? '?'}`);
  }
}

async function main() {
  const { data: credor, error } = await db
    .from('credores')
    .select('id, razao_social, cod_cliente_principal')
    .eq('id', CREDOR_ID)
    .maybeSingle();

  if (error) throw error;
  if (!credor) {
    console.error(`Credor ${CREDOR_ID} não encontrado.`);
    process.exit(1);
  }

  console.log(`\n[onboard] ${credor.razao_social} (${CREDOR_ID})`);

  if (!process.env.ABEWEB_DB_HOST?.trim()) {
    console.log('[onboard] ABEWEB_DB_HOST não configurado — sync omitido.');
    process.exit(0);
  }

  if (credor.cod_cliente_principal?.trim()) {
    console.log('[onboard] Backfill de códigos no legado…');
    runScript('scripts/backfill-codigos-cadastro.mjs', [`--credor=${CREDOR_ID}`]);
  } else {
    console.log(
      '[onboard] Sem cod_cliente_principal — rode pnpm provision:credores antes do sync.',
    );
  }

  console.log('[onboard] Sync inicial do dashboard…');
  // Sem exigir responsável: o onboard roda logo após o cadastro, e o login do
  // credor pode ainda não existir neste ponto.
  await runAbeWebSync(db, {
    credorId: CREDOR_ID,
    force: true,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
