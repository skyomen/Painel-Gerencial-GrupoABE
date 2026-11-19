import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminDb } from '@/lib/server/admin-auth';
import { carregarChaveApi, carregarConfigAgente } from '@/lib/server/agente-relatorios';
import { ErroProvedorEscopoIA, gerarEscopoComIA } from '@/lib/server/cronograma-escopo-ia';

/**
 * POST /api/cronograma/escopar-ia — botão "Escopar com IA" do modal público
 * "Adicionar à fila" (DEC-0079). Pública, sem checagem de sessão, igual às
 * outras rotas de `/api/cronograma`.
 *
 * A RPC `cronograma_registrar_geracao_escopo_ia` (migration 021) decide se
 * ainda há vaga no limite diário GLOBAL (30/dia, fixo na função) ANTES de
 * qualquer chamada ao provedor de IA — se o limite já estourou, nem gasta uma
 * chamada tentando. Reaproveita a MESMA chave/config do Construtor de
 * Relatórios (migration 017, `carregarConfigAgente`/`carregarChaveApi`); não
 * existe tabela de auditoria para esta ação (fora do escopo desta entrega).
 */

const TITULO_MAX = 120;
const DESCRICAO_MAX = 160;
const ESCOPO_MIN = 30;
const ESCOPO_MAX = 2000;

interface EscoparIaBody {
  titulo?: unknown;
  descricao?: unknown;
  escopo?: unknown;
}

function stringValidada(valor: unknown, min: number, max: number): string | null {
  if (typeof valor !== 'string') return null;
  const aparado = valor.trim();
  if (aparado.length < min || aparado.length > max) return null;
  return aparado;
}

export async function POST(request: Request) {
  let body: EscoparIaBody;
  try {
    body = (await request.json()) as EscoparIaBody;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const titulo = stringValidada(body.titulo, 1, TITULO_MAX);
  if (!titulo) {
    return NextResponse.json(
      { error: `Título deve ter entre 1 e ${TITULO_MAX} caracteres.` },
      { status: 400 },
    );
  }

  const descricao = stringValidada(body.descricao, 1, DESCRICAO_MAX);
  if (!descricao) {
    return NextResponse.json(
      { error: `Descrição deve ter entre 1 e ${DESCRICAO_MAX} caracteres.` },
      { status: 400 },
    );
  }

  const escopo = stringValidada(body.escopo, ESCOPO_MIN, ESCOPO_MAX);
  if (!escopo) {
    return NextResponse.json(
      { error: `Escopo deve ter entre ${ESCOPO_MIN} e ${ESCOPO_MAX} caracteres.` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error: limiteError } = await supabase.rpc('cronograma_registrar_geracao_escopo_ia');
  if (limiteError) {
    return NextResponse.json({ error: limiteError.message }, { status: 429 });
  }

  const db = adminDb();
  const config = await carregarConfigAgente(db);
  if (!config.ativo) {
    return NextResponse.json({ error: 'O assistente de IA está desativado.' }, { status: 503 });
  }

  const chave = await carregarChaveApi(db);
  if (!chave) {
    return NextResponse.json({ error: 'Chave de API não configurada.' }, { status: 503 });
  }

  try {
    const escopoGerado = await gerarEscopoComIA(
      { titulo, descricao, escopoRascunho: escopo },
      chave,
      config.modelo,
    );
    return NextResponse.json({ escopo: escopoGerado });
  } catch (err) {
    if (err instanceof ErroProvedorEscopoIA) {
      console.error('[cronograma/escopar-ia POST]', err.message);
    } else {
      console.error('[cronograma/escopar-ia POST]', err);
    }
    return NextResponse.json({ error: 'Falha ao consultar o provedor de IA.' }, { status: 502 });
  }
}
