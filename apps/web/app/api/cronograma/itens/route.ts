import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toCronogramaItemDTO, type CronogramaItemRow } from '@/lib/server/cronograma';

interface PostBody {
  titulo?: unknown;
  descricao?: unknown;
  escopo?: unknown;
  prioridadeDesejada?: unknown;
}

/**
 * POST /api/cronograma/itens — adiciona item à fila. Pública, sem checagem de
 * sessão (DEC-0077): o que mantém a ação "segura o suficiente" é a RPC
 * `cronograma_adicionar_item_fila` (migration 018), não esta rota — ela só
 * repassa o corpo e traduz a resposta.
 *
 * Cliente `anon` de propósito, igual ao GET: é o que exercita o GRANT EXECUTE
 * dado a `anon` na função, em vez de pular essa checagem com a service role.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const titulo = typeof body.titulo === 'string' ? body.titulo : undefined;
  const descricao = typeof body.descricao === 'string' ? body.descricao : undefined;

  if (!titulo || !descricao) {
    return NextResponse.json({ error: 'Título e descrição são obrigatórios.' }, { status: 400 });
  }

  const escopo = typeof body.escopo === 'string' ? body.escopo : undefined;
  const prioridadeDesejada =
    typeof body.prioridadeDesejada === 'string' ? body.prioridadeDesejada : undefined;

  const supabase = await createClient();

  // A função retorna `public.cronograma_itens` (uma linha, não SETOF) — o
  // PostgREST já devolve `data` como o objeto único, sem precisar de
  // `.single()` (que é para quando o retorno vem como array de uma linha).
  const { data, error } = await supabase.rpc('cronograma_adicionar_item_fila', {
    p_titulo: titulo,
    p_descricao: descricao,
    p_escopo: escopo ?? null,
    p_prioridade_desejada: prioridadeDesejada ?? null,
  });

  if (error) {
    // Mensagem da exceção do Postgres já é clara o bastante para a tela
    // (ver RAISE EXCEPTION na RPC) — não precisa reescrever.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const item = toCronogramaItemDTO(data as CronogramaItemRow);

  return NextResponse.json({ item }, { status: 201 });
}
