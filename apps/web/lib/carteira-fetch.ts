import type { SupabaseClient } from '@supabase/supabase-js';
import type { CarteiraSnapshotRow } from '@/lib/calc-metricas-carteira';
import { normalizeEstadoUf } from '@/lib/estado-uf';

const CARTEIRA_COLS =
  'processo, data_inclusao, data_repasse, valor_original_titulo, valor_pago, valor_saldo_devedor, tipo, status, visao_geral_carteira';

function isMissingUfColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return error.code === '42703' || msg.includes('carteira_snapshot.uf') || msg.includes('"uf"');
}

/**
 * Tamanho da página de leitura. O PostgREST corta a resposta no `max-rows` do
 * projeto (1000 por padrão em vários projetos Supabase), e um SELECT sem
 * paginação devolveria só a primeira fatia — sem erro, sem aviso, com KPI
 * calculado sobre parte da carteira.
 */
const PAGE_SIZE = 1000;

/** Trava de segurança: 2 milhões de linhas por credor já é anomalia, não carteira. */
const MAX_PAGES = 2000;

async function fetchPaginado(
  supabase: SupabaseClient,
  credorId: string,
  cols: string,
): Promise<{ rows: CarteiraSnapshotRow[]; error: { message?: string; code?: string } | null }> {
  const rows: CarteiraSnapshotRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('carteira_snapshot')
      .select(cols)
      .eq('credor_id', credorId)
      // Ordem estável: sem ORDER BY o PostgREST não garante que as páginas não se repitam.
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { rows, error };

    const lote = (data ?? []) as unknown as CarteiraSnapshotRow[];
    rows.push(...lote);

    if (lote.length < PAGE_SIZE) return { rows, error: null };
  }

  console.warn(
    `[carteira_snapshot] credor ${credorId} passou de ${MAX_PAGES * PAGE_SIZE} linhas; leitura interrompida`,
  );
  return { rows, error: null };
}

/** Carrega carteira_snapshot; se coluna `uf` ainda não existir, faz fallback sem ela. */
export async function fetchCarteiraSnapshot(
  supabase: SupabaseClient,
  credorId: string,
): Promise<CarteiraSnapshotRow[]> {
  const first = await fetchPaginado(supabase, credorId, `${CARTEIRA_COLS}, uf`);

  if (!first.error) return first.rows;

  if (isMissingUfColumn(first.error)) {
    const fallback = await fetchPaginado(supabase, credorId, CARTEIRA_COLS);
    if (fallback.error) {
      console.error('[carteira_snapshot]', fallback.error);
      return [];
    }
    return fallback.rows;
  }

  console.error('[carteira_snapshot]', first.error);
  return [];
}

/** Propaga UF por processo (borderoIndice + linhas que já tenham uf). */
export function enrichCarteiraUf(
  rows: CarteiraSnapshotRow[],
  ufPorProcesso: Map<string, string>,
): CarteiraSnapshotRow[] {
  const procUf = new Map(ufPorProcesso);

  for (const row of rows) {
    const proc = row.processo ?? '';
    const uf = normalizeEstadoUf(row.uf);
    if (proc && uf) procUf.set(proc, uf);
  }

  return rows.map((row) => {
    const proc = row.processo ?? '';
    const uf = procUf.get(proc) ?? normalizeEstadoUf(row.uf);
    return { ...row, uf: uf || null };
  });
}

export function buildUfPorProcessoFromIndice(
  indice: Array<{ p?: string; uf?: string }> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of indice ?? []) {
    const uf = normalizeEstadoUf(row.uf);
    if (row.p && uf) map.set(row.p, uf);
  }
  return map;
}
