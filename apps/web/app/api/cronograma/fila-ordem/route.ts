import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface PatchBody {
  ids?: unknown;
}

/**
 * PATCH /api/cronograma/fila-ordem — reordena a fila. Pública, sem checagem
 * de sessão (DEC-0077): quem decide se a nova ordem é aceitável é a RPC
 * `cronograma_reordenar_fila` (migration 018) — ela exige que `ids` seja
 * exatamente o conjunto hoje em FILA, nem mais nem menos. Esta rota só
 * repassa e traduz o 409 quando a RPC rejeita.
 */
export async function PATCH(request: Request) {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const ids = body.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json(
      { error: 'Campo "ids" deve ser uma lista de strings.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc('cronograma_reordenar_fila', {
    p_ids: ids as string[],
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
