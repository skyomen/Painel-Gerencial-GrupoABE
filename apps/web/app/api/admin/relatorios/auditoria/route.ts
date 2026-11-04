import { NextResponse } from 'next/server';
import { adminDb, jsonError, requireSuperAdmin } from '@/lib/server/admin-auth';
import { AdminError } from '@/lib/server/admin-errors';
import { inteiroDaQuery } from '@/lib/server/agente-relatorios';

/**
 * Histórico completo de perguntas do agente — só SUPER_ADMIN.
 *
 * É o "Ver histórico completo" da tela de admin: o rastro de todas as
 * perguntas, de todos os tenants, com a telemetria de custo. Lê pelo
 * `service_role` de propósito — a policy `tenant_read` da 017 limitaria o admin
 * ao próprio tenant, que não é o que esta tela existe para mostrar.
 *
 * A resposta não carrega `plano_executado` nem `resposta_resumo`: a listagem é
 * um índice, e despejar o plano inteiro de 200 linhas custa megabytes para
 * mostrar uma tabela. O detalhe de uma pergunta é outra tela, outra rota.
 */

const LIMITE_PADRAO = 50;
const LIMITE_MAX = 200;

const COLUNAS =
  'id, tenant_id, credor_id, usuario_id, pergunta_texto, tipo_relatorio, status, modelo, tokens_entrada, tokens_saida, custo_estimado_brl, duracao_ms, criado_em';

interface LinhaAuditoria {
  id: string;
  tenant_id: string;
  credor_id: string | null;
  usuario_id: string;
  pergunta_texto: string;
  tipo_relatorio: string | null;
  status: string;
  modelo: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_estimado_brl: number | string | null;
  duracao_ms: number | null;
  criado_em: string;
}

function comoNumeroOuNulo(valor: number | string | null): number | null {
  if (valor === null) return null;
  const n = typeof valor === 'number' ? valor : Number.parseFloat(valor);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const searchParams = new URL(request.url).searchParams;
    const limite = inteiroDaQuery(searchParams.get('limite'), LIMITE_PADRAO, 1, LIMITE_MAX);
    const offset = inteiroDaQuery(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const tenantId = searchParams.get('tenantId')?.trim() || null;

    let query = adminDb()
      .from('agente_relatorios_perguntas')
      .select(COLUNAS, { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(offset, offset + limite - 1);

    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error, count } = await query;

    if (error) {
      console.error('[admin/relatorios/auditoria GET]', error);
      throw new AdminError('Erro ao carregar o histórico do agente.', 500);
    }

    const perguntas = ((data ?? []) as unknown as LinhaAuditoria[]).map((linha) => ({
      id: linha.id,
      tenantId: linha.tenant_id,
      credorId: linha.credor_id,
      usuarioId: linha.usuario_id,
      perguntaTexto: linha.pergunta_texto,
      tipoRelatorio: linha.tipo_relatorio,
      status: linha.status,
      modelo: linha.modelo,
      tokensEntrada: linha.tokens_entrada,
      tokensSaida: linha.tokens_saida,
      custoEstimadoBrl: comoNumeroOuNulo(linha.custo_estimado_brl),
      duracaoMs: linha.duracao_ms,
      criadoEm: linha.criado_em,
    }));

    return NextResponse.json({ total: count ?? perguntas.length, perguntas });
  } catch (err) {
    if (err instanceof AdminError) {
      return jsonError(err.message, err.status);
    }
    console.error('[admin/relatorios/auditoria GET]', err);
    return jsonError('Erro ao carregar o histórico do agente.', 500);
  }
}
