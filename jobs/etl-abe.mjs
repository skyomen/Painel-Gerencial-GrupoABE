/**
 * ETL — Sistemas legados → Supabase (carteira_snapshot + metricas_cache)
 *
 * Executar de forma ASSÍNCRONA (nunca no carregamento do usuário):
 *   pnpm etl:abe              # todos os credores ativos
 *   pnpm etl:abe --credor ID  # um credor
 *
 * Hoje implementado: ABE_WEB (query 749).
 * Stubs: ABE_DELPHI, AVANTPAY, ACORDOSEGURO (conectar quando houver credenciais).
 */

import { createClient } from '@supabase/supabase-js';
import {
  closePool,
  fetchAllAbeWebRowsAtivos,
  getAbeWebPool,
  getSyncDateRange,
} from '../scripts/lib/abeweb.mjs';
import {
  refreshAgregados,
  refreshMetricasCache,
  upsertCarteiraSnapshot,
} from '../scripts/lib/carteira-snapshot.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const credorFilter = process.argv.find((a) => a.startsWith('--credor='))?.split('=')[1];

if (!url || !serviceKey) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchDadosSistemaLegado(sistema, clienteId, dateRange) {
  switch (sistema) {
    case 'ABE_WEB':
      if (!process.env.ABEWEB_DB_HOST) {
        throw new Error('ABEWEB_DB_* não configurado');
      }
      return fetchAllAbeWebRowsAtivos(clienteId, dateRange);
    case 'ABE_DELPHI':
    case 'AVANTPAY':
    case 'ACORDOSEGURO':
      console.warn(`  [ETL] ${sistema}: conector ainda não implementado — ignorando`);
      return null;
    default:
      throw new Error(`Sistema desconhecido: ${sistema}`);
  }
}

export async function sincronizarCredorSistema(credorId, sistema, clienteId, dateRange) {
  console.log(`[ETL] ${sistema} · credor ${credorId} · cliente ${clienteId}`);

  const rows = await fetchDadosSistemaLegado(sistema, clienteId, dateRange);
  if (rows === null) return;

  await upsertCarteiraSnapshot(db, credorId, sistema, rows);
  await refreshMetricasCache(db, credorId, dateRange, sistema);
  await refreshAgregados(db, credorId, sistema);
}

export async function runETL() {
  const dateRange = getSyncDateRange();
  console.log(`[ETL] Período sync: ${dateRange.dataInicial} → ${dateRange.dataFinal}`);

  let query = db
    .from('credores')
    .select(
      'id, tenant_id, razao_social, cod_cliente_principal, abe_cliente_id, abe_delphi_cliente_id, avantpay_cliente_id, acordoseguro_id',
    )
    .not('cod_cliente_principal', 'is', null);

  if (credorFilter) query = query.eq('id', credorFilter);

  const { data: credores, error } = await query;
  if (error) throw error;
  if (!credores?.length) {
    console.log('[ETL] Nenhum credor com cod_cliente_principal');
    return;
  }

  if (process.env.ABEWEB_DB_HOST) await getAbeWebPool();

  try {
    for (const credor of credores) {
      console.log(`\n[ETL] ${credor.razao_social} (${credor.id})`);
      const abeId = credor.abe_cliente_id ?? credor.cod_cliente_principal;

      if (abeId) {
        await sincronizarCredorSistema(credor.id, 'ABE_WEB', abeId, dateRange);
        if (credor.abe_delphi_cliente_id) {
          await sincronizarCredorSistema(
            credor.id,
            'ABE_DELPHI',
            credor.abe_delphi_cliente_id,
            dateRange,
          );
        }
      }
      if (credor.avantpay_cliente_id) {
        await sincronizarCredorSistema(
          credor.id,
          'AVANTPAY',
          credor.avantpay_cliente_id,
          dateRange,
        );
      }
      if (credor.acordoseguro_id) {
        await sincronizarCredorSistema(
          credor.id,
          'ACORDOSEGURO',
          credor.acordoseguro_id,
          dateRange,
        );
      }

      await refreshMetricasCache(db, credor.id, dateRange, 'TODOS');
      // p_sistema null recalcula os agregados de TODOS os sistemas do credor.
      await refreshAgregados(db, credor.id, null);
    }
  } finally {
    await closePool();
  }

  console.log('\n[ETL] Concluído');
}

runETL().catch((err) => {
  console.error(err);
  process.exit(1);
});
