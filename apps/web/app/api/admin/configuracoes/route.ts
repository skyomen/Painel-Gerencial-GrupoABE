import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb, jsonError, requireSuperAdmin } from '@/lib/server/admin-auth';
import { AdminError } from '@/lib/server/admin-errors';
import { parseRequestJson } from '@/lib/server/admin-validators';
import { CATALOGO, TIPOS_RELATORIO, validarEntradaConfig } from '@/lib/relatorios-ia';
import {
  agregarUsoMensal,
  carregarConfigAgente,
  gravarChaveApi,
} from '@/lib/server/agente-relatorios';

/**
 * Configuração global do agente de relatórios — só SUPER_ADMIN.
 *
 * A linha de `agente_relatorios_config` é lida pelo `service_role` porque a 017
 * revoga o GRANT de `authenticated`: não existe leitura legítima dela a partir
 * de um navegador. O guard de super admin acontece antes de qualquer ida ao
 * banco, e quem decide o que pode sair da linha é `mapearConfig` — a chave
 * nunca sai inteira, só os quatro últimos dígitos já mascarados.
 */

/**
 * Sétimo item do catálogo: vitrine de tela, não capacidade.
 *
 * Ele NÃO está no enum `tipo_relatorio_ia` e o agente não tem como executá-lo —
 * ampliar a fronteira do que o agente lê exige migration revisada (DEC-0069).
 * Fica aqui só para a tela de admin anunciar o que vem depois, sempre com
 * `disponivel: false`.
 */
const ITEM_VITRINE_SQL = {
  id: 'SQL_IMPORTADO',
  rotulo: '+ relatórios SQL importados (em breve)',
  descricao: 'Ainda não implementado.',
  disponivel: false,
} as const;

/**
 * A ordem vem de `TIPOS_RELATORIO`, não de `Object.values(CATALOGO)`: a ordem
 * de chaves de um objeto depende de como alguém digitou o literal, e a tela
 * mostra esta lista. Percorrer o array fixa a ordem na mesma fonte que o ENUM.
 */
function montarCatalogo() {
  return [
    ...TIPOS_RELATORIO.map((id) => ({
      id: CATALOGO[id].id,
      rotulo: CATALOGO[id].rotulo,
      descricao: CATALOGO[id].descricao,
      disponivel: true,
    })),
    ITEM_VITRINE_SQL,
  ];
}

/** GET e PUT devolvem exatamente o mesmo shape — a tela recarrega do próprio PUT. */
async function montarResposta(db: SupabaseClient) {
  const config = await carregarConfigAgente(db);
  const uso = await agregarUsoMensal(db, config.alertaCustoMensalBrl);

  return { config, catalogo: montarCatalogo(), uso };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(await montarResposta(adminDb()));
  } catch (err) {
    if (err instanceof AdminError) {
      return jsonError(err.message, err.status);
    }
    console.error('[admin/configuracoes GET]', err);
    return jsonError('Erro ao carregar a configuração do agente.', 500);
  }
}

export async function PUT(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await parseRequestJson(request);
    const entrada = validarEntradaConfig(body);

    if (!entrada.ok) {
      return jsonError('Dados inválidos.', 400, entrada.detalhes);
    }

    const db: SupabaseClient = adminDb();

    // A chave vai para o Vault ANTES do UPDATE dos demais campos: a RPC grava
    // o segredo e o ponteiro na mesma transação, e se ela falhar a tela não
    // pode terminar dizendo que salvou. Nenhuma coluna de texto recebe a chave
    // — `validarEntradaConfig` já separou `apiKey` de `valores` justamente
    // para que ela não tenha como entrar neste patch.
    if (entrada.apiKey) {
      await gravarChaveApi(db, entrada.apiKey);
    }

    const patch: Record<string, unknown> = {
      ...entrada.valores,
      atualizado_por: auth.userId,
      atualizado_em: new Date().toISOString(),
    };

    const { error } = await db.from('agente_relatorios_config').update(patch).eq('singleton', true);

    if (error) {
      console.error('[admin/configuracoes PUT]', error);
      throw new AdminError('Erro ao salvar a configuração do agente.', 500);
    }

    return NextResponse.json(await montarResposta(db));
  } catch (err) {
    if (err instanceof AdminError) {
      return jsonError(err.message, err.status);
    }
    console.error('[admin/configuracoes PUT]', err);
    return jsonError('Erro ao salvar a configuração do agente.', 500);
  }
}

/** A tela salva campo a campo; PATCH é o mesmo handler, não uma segunda semântica. */
export const PATCH = PUT;
