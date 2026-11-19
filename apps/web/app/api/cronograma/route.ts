import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  toCronogramaExclusaoDTO,
  toCronogramaItemDTO,
  type CronogramaExclusaoRow,
  type CronogramaItemRow,
} from '@/lib/server/cronograma';

/**
 * GET /api/cronograma — leitura pública (DEC-0077), sem checagem de sessão.
 *
 * Cliente `anon` de propósito: é o que de fato exercita a policy de SELECT
 * público criada na migration 018, em vez de contornar a RLS com a service
 * role.
 *
 * Também devolve `exclusoes` — histórico público de exclusões de itens
 * criados pela página (DEC-0078, migration 019), pela mesma policy de
 * leitura pública aplicada em `cronograma_exclusoes`.
 */
export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('cronograma_itens')
    .select(
      'id, titulo, descricao, escopo, status, ordem, prioridade_desejada, evidencia_commit, motivo_recusa, atualizado_em, criado_em, criado_via_pagina',
    );

  if (error) {
    console.error('[cronograma GET]', error);
    return NextResponse.json({ error: 'Erro ao listar os itens do cronograma.' }, { status: 500 });
  }

  const { data: exclusoesData, error: exclusoesError } = await supabase
    .from('cronograma_exclusoes')
    .select('id, item_id, item_titulo, nome, motivo, excluido_em')
    .order('excluido_em', { ascending: false });

  if (exclusoesError) {
    console.error('[cronograma GET exclusoes]', exclusoesError);
    return NextResponse.json(
      { error: 'Erro ao listar o histórico de exclusões do cronograma.' },
      { status: 500 },
    );
  }

  const itens = ((data ?? []) as CronogramaItemRow[]).map(toCronogramaItemDTO);
  const exclusoes = ((exclusoesData ?? []) as CronogramaExclusaoRow[]).map(toCronogramaExclusaoDTO);

  return NextResponse.json({ itens, exclusoes });
}
