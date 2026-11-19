import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  toCronogramaExclusaoDTO,
  toCronogramaItemDTO,
  type CronogramaExclusaoRow,
  type CronogramaItemRow,
} from '@/lib/server/cronograma';

type Params = { params: Promise<{ id: string }> };

interface DeleteBody {
  nome?: unknown;
  motivo?: unknown;
}

interface PatchBody {
  status?: unknown;
}

/**
 * DELETE/PATCH /api/cronograma/itens/:id — excluir e mover item do
 * cronograma (DEC-0078). Públicas, sem checagem de sessão, mesmo nível de
 * confiança do DEC-0077: quem decide o que é aceitável são as RPCs
 * `cronograma_excluir_item_pagina` e `cronograma_mover_item_pagina`
 * (migration 019) — nome autorizado, motivo obrigatório, status válido e
 * `criado_via_pagina = TRUE` são todos checados lá, não aqui. Esta rota só
 * repassa o corpo e traduz o erro, mesmo padrão de `POST /api/cronograma/itens`.
 *
 * Cliente `anon` de propósito, igual às outras rotas de `/api/cronograma` —
 * é o que exercita o GRANT EXECUTE dado a `anon` nas funções.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  if (typeof body.nome !== 'string' || typeof body.motivo !== 'string') {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('cronograma_excluir_item_pagina', {
    p_id: id,
    p_nome: body.nome,
    p_motivo: body.motivo,
  });

  if (error) {
    // Mensagem da exceção do Postgres já é clara o bastante para a tela
    // (nome fora da lista, motivo vazio, item não encontrado/não elegível)
    // — não precisa reescrever, nem duplicar a lista de nomes aqui.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const exclusao = toCronogramaExclusaoDTO(data as CronogramaExclusaoRow);

  return NextResponse.json({ exclusao }, { status: 200 });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  if (typeof body.status !== 'string') {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('cronograma_mover_item_pagina', {
    p_id: id,
    p_status: body.status,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const item = toCronogramaItemDTO(data as CronogramaItemRow);

  return NextResponse.json({ item }, { status: 200 });
}
