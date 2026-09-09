/**
 * Sincroniza dados do ABE WEB → Supabase (tabela dashboard_carteira).
 *
 * Uso:
 *   pnpm sync:abeweb              # sync completo (forçado)
 *   pnpm sync:abeweb:check        # só verifica alterações (~2s/credor)
 *   pnpm sync:abeweb:incremental  # sync só se houve mudança
 *   pnpm sync:abeweb --credor=<uuid>  # um credor específico
 *
 * Sincroniza todo credor que tenha código de cliente. `--com-responsavel`
 * restringe aos que já têm login, que era a regra anterior.
 *
 * ABEWEB_SYNC_CONCORRENCIA (padrão 1) controla quantos credores correm em
 * paralelo. Acima de 1, as consultas pesam ao mesmo tempo no SQL Server de
 * produção e os logs se intercalam.
 */

import { createClient } from '@supabase/supabase-js';
import { runAbeWebSync } from './lib/sync-credor-engine.mjs';

const DEMO = process.argv.includes('--demo');
const CHECK_ONLY = process.argv.includes('--check');
const INCREMENTAL = process.argv.includes('--incremental');
const FORCE = process.argv.includes('--force');
const CREDOR_ID =
  process.argv
    .find((a) => a.startsWith('--credor='))
    ?.split('=')[1]
    ?.trim() || null;
const COM_RESPONSAVEL = process.argv.includes('--com-responsavel');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

runAbeWebSync(db, {
  credorId: CREDOR_ID,
  exigirResponsavel: COM_RESPONSAVEL,
  checkOnly: CHECK_ONLY,
  incremental: INCREMENTAL,
  force: FORCE,
  demo: DEMO,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
