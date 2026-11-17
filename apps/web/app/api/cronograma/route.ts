import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toCronogramaItemDTO, type CronogramaItemRow } from '@/lib/server/cronograma';

/**
 * GET /api/cronograma — leitura pública (DEC-0077), sem checagem de sessão.
 *
 * Cliente `anon` de propósito: é o que de fato exercita a policy de SELECT
 * público criada na migration 018, em vez de contornar a RLS com a service
 * role.
 */
export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('cronograma_itens')
    .select(
      'id, titulo, descricao, escopo, status, ordem, prioridade_desejada, evidencia_commit, motivo_recusa, atualizado_em, criado_em',
    );

  if (error) {
    console.error('[cronograma GET]', error);
    return NextResponse.json({ error: 'Erro ao listar os itens do cronograma.' }, { status: 500 });
  }

  const itens = ((data ?? []) as CronogramaItemRow[]).map(toCronogramaItemDTO);

  return NextResponse.json({ itens });
}
