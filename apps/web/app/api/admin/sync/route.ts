import { NextResponse } from 'next/server';
import { adminDb, jsonError, requireSuperAdmin } from '@/lib/server/admin-auth';
import { checkRateLimit } from '@/lib/server/rate-limit';

/**
 * Botão de atualizar do painel. Duas ações, porque são coisas diferentes:
 *
 *   recalcular   — refaz os agregados a partir do que JÁ está em
 *                  carteira_snapshot. Roda inteiro dentro do Postgres, leva
 *                  segundos. NÃO busca dado novo no legado.
 *
 *   sincronizar  — busca dado novo no ABE WEB / Delphi. Isso leva MINUTOS e
 *                  precisa alcançar um SQL Server on-premises, duas coisas que
 *                  uma função serverless não faz: o tempo limite é de segundos
 *                  e o banco não é público. Por isso a rota não executa o sync
 *                  — ela dispara o workflow do GitHub Actions, que roda numa
 *                  máquina com tempo e rede para isso.
 *
 * Tentar rodar o sync aqui daria timeout no meio da carga, deixando a carteira
 * pela metade — pior que não ter botão.
 */

const LIMITE = { limit: 5, windowMs: 5 * 60 * 1000 };

function chaveDoUsuario(userId: string): string {
  return `sync:${userId}`;
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  // Recalcular varre a carteira inteira; disparar workflow consome cota do CI.
  const limite = checkRateLimit(chaveDoUsuario(auth.userId), LIMITE);
  if (!limite.ok) {
    return NextResponse.json(
      { title: `Aguarde ${limite.retryAfterSec}s antes de atualizar de novo.` },
      { status: 429, headers: { 'Retry-After': String(limite.retryAfterSec) } },
    );
  }

  let acao: string;
  try {
    const body = (await request.json()) as { acao?: string };
    acao = body.acao ?? 'recalcular';
  } catch {
    acao = 'recalcular';
  }

  if (acao === 'recalcular') return recalcular();
  if (acao === 'sincronizar') return sincronizar();

  return jsonError('Ação desconhecida.', 400);
}

async function recalcular() {
  const db = adminDb();
  const { data, error } = await db.rpc('refresh_agregados_todos');

  if (error) {
    console.error('[admin/sync recalcular]', error);
    // A função pode não existir ainda: a migration 016 é recente.
    const faltaMigration = error.message?.includes('refresh_agregados_todos');
    return jsonError(
      faltaMigration
        ? 'Função de recálculo ausente no banco. Aplique supabase/APLICAR_NO_SUPABASE.sql.'
        : 'Erro ao recalcular os indicadores.',
      faltaMigration ? 409 : 500,
    );
  }

  // A RPC devolve SETOF; o tipo gerado não conhece as colunas desta função.
  type Retorno = { credores_recalculados: number; duracao_ms: number };
  const linha = (Array.isArray(data) ? data[0] : data) as Retorno | undefined;
  const credores = linha?.credores_recalculados ?? 0;

  return NextResponse.json({
    acao: 'recalcular',
    credores,
    duracaoMs: linha?.duracao_ms ?? 0,
    mensagem:
      credores === 0
        ? 'Nenhum credor tem carteira sincronizada ainda — não há o que recalcular.'
        : `Indicadores recalculados para ${credores} credor(es).`,
  });
}

/**
 * Dispara `workflow_dispatch` no GitHub Actions.
 *
 * Precisa de GITHUB_SYNC_TOKEN (escopo `actions:write` no repositório) e
 * GITHUB_SYNC_REPO ("dono/repo"). Sem eles, responde explicando o que falta —
 * em vez de fingir que sincronizou.
 */
async function sincronizar() {
  const token = process.env.GITHUB_SYNC_TOKEN?.trim();
  const repo = process.env.GITHUB_SYNC_REPO?.trim();
  const workflow = process.env.GITHUB_SYNC_WORKFLOW?.trim() || 'sync-abeweb-cron.yml';
  const ref = process.env.GITHUB_SYNC_REF?.trim() || 'main';

  if (!token || !repo) {
    return NextResponse.json(
      {
        title: 'Sincronização com o legado não está configurada.',
        errors: [
          !repo ? 'Falta GITHUB_SYNC_REPO (formato dono/repositorio).' : null,
          !token ? 'Falta GITHUB_SYNC_TOKEN com permissão actions:write.' : null,
          'O sync busca dados no SQL Server on-premises e leva minutos — ele roda no GitHub Actions, não nesta função.',
          'Enquanto isso: rode `pnpm sync:abeweb` no terminal, ou use "Recalcular indicadores".',
        ].filter((e): e is string => e !== null),
      },
      { status: 409 },
    );
  }

  const resposta = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    },
  );

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    // Nunca ecoar o corpo cru: pode conter detalhe do token ou do repositório.
    console.error('[admin/sync workflow]', resposta.status, corpo.slice(0, 300));

    const motivo =
      resposta.status === 404
        ? 'Workflow ou repositório não encontrado — confira GITHUB_SYNC_REPO e se o arquivo do workflow está commitado.'
        : resposta.status === 401 || resposta.status === 403
          ? 'Token sem permissão para disparar o workflow (precisa de actions:write).'
          : 'O GitHub recusou o disparo.';

    return jsonError(motivo, 502);
  }

  return NextResponse.json({
    acao: 'sincronizar',
    mensagem:
      'Sincronização disparada no GitHub Actions. Leva alguns minutos; os indicadores se atualizam ao final.',
  });
}
