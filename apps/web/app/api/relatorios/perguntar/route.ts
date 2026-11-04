import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveDashboardScope } from '@/lib/dashboard-scope';
import { createClient } from '@/lib/supabase/server';
import { adminDb } from '@/lib/server/admin-auth';
import {
  criarClienteOpenAI,
  responderPergunta,
  type ContextoPergunta,
  type SistemaOrigem,
  type SupabaseLike,
} from '@/lib/relatorios-ia';
import {
  carregarChaveApi,
  carregarConfigAgente,
  contarPerguntasDoDia,
  estimarCustoBrl,
  excedeuCota,
  hojeIsoSaoPaulo,
  inteiroDaQuery,
  primeiroDiaMesesAtrasSaoPaulo,
  registrarAuditoria,
  resumirResposta,
} from '@/lib/server/agente-relatorios';

/**
 * Construtor de relatórios com IA — a rota que o credor usa.
 *
 * O escopo do credor é travado aqui, no servidor, antes de o modelo ver
 * qualquer coisa: o `tenant_id` e o `credor_id` saem da sessão, nunca do corpo
 * da requisição. O modelo recebe um escopo já resolvido e não tem como ampliá-lo.
 */

const MAX_CARACTERES_PERGUNTA = 500;
/** Janela padrão quando o cliente não manda período: o mês corrente e os cinco anteriores. */
const MESES_PADRAO = 5;

const LIMITE_HISTORICO_PADRAO = 10;
const LIMITE_HISTORICO_MAX = 50;

interface CredorRelatorioRow {
  id: string;
  tenant_id: string;
  razao_social: string;
  cod_cliente_principal: string | null;
  abe_delphi_cliente_id: string | null;
  codigos_cliente: { cod_cliente: string; rotulo: string | null }[];
}

interface ContextoSessao {
  supabase: SupabaseClient;
  userId: string;
  tenantId: string;
  credor: CredorRelatorioRow;
}

/**
 * Guard de sessão + escopo, replicando `/api/dashboard`.
 *
 * `credorId` continua aceito e continua restrito ao SUPER_ADMIN: o `AGENTS.md`
 * documenta `/dashboard?credorId=` como política de suporte — o admin precisa
 * ver a tela exatamente como o credor vê para atender um chamado. A autorização
 * não está na UI: `resolveDashboardScope` nega para todos os outros papéis, e a
 * RLS nega de novo embaixo. Mantido de propósito, não por inércia.
 */
async function resolverSessao(
  credorIdSolicitado: string | null,
): Promise<ContextoSessao | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ title: 'Sessão expirada.' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('tenant_id, papel, ativo')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.ativo) {
    return NextResponse.json({ title: 'Perfil não encontrado.' }, { status: 403 });
  }

  const scope = resolveDashboardScope(profile.papel, credorIdSolicitado);

  if (scope.type === 'negado') {
    return NextResponse.json({ title: 'Você não tem permissão para esta ação.' }, { status: 403 });
  }

  const credorSelect = supabase.from('credores').select(
    `id, tenant_id, razao_social, cod_cliente_principal, abe_delphi_cliente_id,
       codigos_cliente ( cod_cliente, rotulo )`,
  );

  const { data: credor } =
    scope.type === 'credor'
      ? await credorSelect.eq('id', scope.credorId).maybeSingle()
      : await credorSelect.eq('tenant_id', profile.tenant_id).maybeSingle();

  const credorRow = credor as CredorRelatorioRow | null;

  if (!credorRow) {
    return NextResponse.json({ title: 'Credor não encontrado.' }, { status: 404 });
  }

  return {
    supabase,
    userId: user.id,
    // Na prévia do SUPER_ADMIN o tenant é o do credor visitado, não o do admin.
    tenantId: credorRow.tenant_id ?? profile.tenant_id,
    credor: credorRow,
  };
}

function textoDaPergunta(body: unknown): string | null {
  const bruto = (body as { pergunta?: unknown } | null)?.pergunta;
  if (typeof bruto !== 'string') return null;
  const pergunta = bruto.trim();
  if (pergunta.length === 0 || pergunta.length > MAX_CARACTERES_PERGUNTA) return null;
  return pergunta;
}

function stringOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/**
 * Traduz o corpo HTTP para o `ContextoPergunta` que o planejador espera.
 *
 * O corpo fala em `contexto.periodo` / `sistemaOrigem` / `uf` porque é o que a
 * tela tem na mão (os filtros do dashboard); o planejador fala em
 * `periodoAtual` / `sistemaOrigemAtual` / `ufAtual` porque para ele isso é
 * "onde o usuário está olhando agora", e não um comando. A tradução é aqui.
 *
 * Sem contexto no corpo: mês corrente mais os cinco anteriores, todos os
 * sistemas, sem UF. `hoje` vem do servidor de propósito — o modelo não tem
 * relógio confiável, e data errada aqui vira número errado na tela.
 */
function resolverContexto(body: unknown, pergunta: string): ContextoPergunta {
  const bruto = (body as { contexto?: Record<string, unknown> } | null)?.contexto ?? {};
  const periodoBruto = (bruto.periodo ?? {}) as Record<string, unknown>;

  return {
    pergunta,
    periodoAtual: {
      inicio: stringOuNulo(periodoBruto.inicio) ?? primeiroDiaMesesAtrasSaoPaulo(MESES_PADRAO),
      fim: stringOuNulo(periodoBruto.fim) ?? hojeIsoSaoPaulo(),
    },
    sistemaOrigemAtual: (stringOuNulo(bruto.sistemaOrigem) ?? 'TODOS') as SistemaOrigem,
    ufAtual: stringOuNulo(bruto.uf),
    hoje: hojeIsoSaoPaulo(),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { title: 'Corpo da requisição inválido (JSON esperado).' },
      {
        status: 400,
      },
    );
  }

  const sessao = await resolverSessao(stringOuNulo((body as { credorId?: unknown })?.credorId));
  if (sessao instanceof NextResponse) return sessao;

  const pergunta = textoDaPergunta(body);
  if (!pergunta) {
    return NextResponse.json(
      {
        title: 'Pergunta inválida.',
        codigo: 'PERGUNTA_INVALIDA',
        errors: [`A pergunta precisa ter entre 1 e ${MAX_CARACTERES_PERGUNTA} caracteres.`],
      },
      { status: 400 },
    );
  }

  const db = adminDb();
  const config = await carregarConfigAgente(db);

  if (!config.ativo) {
    return NextResponse.json(
      { title: 'O agente de relatórios está desativado.', codigo: 'AGENTE_DESATIVADO' },
      { status: 503 },
    );
  }

  const chave = await carregarChaveApi(db);
  if (!chave) {
    return NextResponse.json(
      { title: 'Chave de API não configurada.', codigo: 'CHAVE_AUSENTE' },
      { status: 503 },
    );
  }

  const usadas = await contarPerguntasDoDia(db, sessao.tenantId);
  if (excedeuCota(usadas, config.limitePerguntasCredorDia)) {
    return NextResponse.json(
      {
        title: 'Limite diário de perguntas atingido.',
        codigo: 'LIMITE_DIARIO_EXCEDIDO',
        limite: config.limitePerguntasCredorDia,
        usadas,
      },
      { status: 429 },
    );
  }

  const contexto = resolverContexto(body, pergunta);
  const escopo = {
    tenantId: sessao.tenantId,
    credorId: sessao.credor.id,
    razaoSocial: sessao.credor.razao_social,
  };

  const comecou = Date.now();

  try {
    const resultado = await responderPergunta({
      contexto,
      config,
      cliente: criarClienteOpenAI(chave),
      escopo,
      // Cliente com a sessão do usuário, não o `service_role`: o escopo já está
      // travado acima, e a RLS fica como segunda barreira entre a leitura de
      // dados e a carteira de outro credor. Defesa em profundidade de graça.
      //
      // PENDENTE (lado da lib): mesmo com `SupabaseLike` afrouxado, atribuir um
      // `SupabaseClient` real a ele ainda estoura o limite de profundidade do
      // TS (TS2589) — comparar o `then` do PostgrestFilterBuilder com o de
      // `ConsultaSupabase` expande genérico sem fim. Enquanto `executarPlano`
      // não receber `SupabaseClient` direto (o padrão de `lib/carteira-fetch.ts`,
      // com o dublê castado no teste), a ponte é este cast.
      supabase: sessao.supabase as unknown as SupabaseLike,
      credor: sessao.credor,
    });

    const duracaoMs = Date.now() - comecou;

    if (!resultado.ok) {
      // Rejeitada não é erro do sistema: o credor perguntou algo fora do
      // catálogo. Fica na auditoria (inclusive o plano bruto, para melhorar o
      // prompt depois) e não consome cota.
      await registrarAuditoria(db, {
        tenantId: sessao.tenantId,
        credorId: sessao.credor.id,
        usuarioId: sessao.userId,
        perguntaTexto: pergunta,
        planoExecutado: {
          codigo: resultado.codigo,
          motivo: resultado.motivo,
          detalhes: resultado.detalhes,
          planoBruto: resultado.planoBruto,
        },
        respostaResumo: resumirResposta(resultado.motivo),
        status: 'REJEITADO',
        tipoRelatorio: null,
        modelo: config.modelo,
        tokensEntrada: null,
        tokensSaida: null,
        custoEstimadoBrl: null,
        duracaoMs,
      });

      return NextResponse.json(
        {
          title: 'Não consegui transformar essa pergunta em um relatório do catálogo.',
          codigo: 'PLANO_INVALIDO',
          detalhes: resultado.detalhes,
        },
        { status: 422 },
      );
    }

    const auditoriaId = await registrarAuditoria(db, {
      tenantId: sessao.tenantId,
      credorId: sessao.credor.id,
      usuarioId: sessao.userId,
      perguntaTexto: pergunta,
      planoExecutado: resultado.plano,
      respostaResumo: resumirResposta(resultado.resposta.textoResposta),
      status: 'OK',
      tipoRelatorio: resultado.plano.tipoRelatorio,
      modelo: config.modelo,
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      custoEstimadoBrl: estimarCustoBrl(resultado.tokensEntrada, resultado.tokensSaida),
      duracaoMs: Date.now() - comecou,
    });

    return NextResponse.json({
      auditoriaId,
      pergunta,
      plano: resultado.plano,
      resposta: resultado.resposta,
    });
  } catch (err) {
    console.error('[relatorios/perguntar POST]', err);

    await registrarAuditoria(db, {
      tenantId: sessao.tenantId,
      credorId: sessao.credor.id,
      usuarioId: sessao.userId,
      perguntaTexto: pergunta,
      planoExecutado: {},
      // Só a mensagem, nunca o erro cru: o objeto do SDK pode carregar o header
      // de autorização, e auditoria é tabela lida por humano.
      respostaResumo: resumirResposta(err instanceof Error ? err.message : 'Erro desconhecido.'),
      status: 'ERRO',
      tipoRelatorio: null,
      modelo: config.modelo,
      tokensEntrada: null,
      tokensSaida: null,
      custoEstimadoBrl: null,
      duracaoMs: Date.now() - comecou,
    });

    return NextResponse.json(
      { title: 'Falha ao consultar o provedor de IA.', codigo: 'FALHA_PROVEDOR' },
      { status: 502 },
    );
  }
}

interface LinhaHistorico {
  id: string;
  pergunta_texto: string;
  criado_em: string;
  tipo_relatorio: string | null;
  status: string;
  usuarios: { nome: string | null } | { nome: string | null }[] | null;
}

function nomeDoUsuario(linha: LinhaHistorico): string | null {
  const bruto = Array.isArray(linha.usuarios) ? linha.usuarios[0] : linha.usuarios;
  return bruto?.nome ?? null;
}

/** Histórico recente do credor — a seção "Perguntas recentes" da tela. */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;

  const sessao = await resolverSessao(searchParams.get('credorId'));
  if (sessao instanceof NextResponse) return sessao;

  const limite = inteiroDaQuery(
    searchParams.get('limite'),
    LIMITE_HISTORICO_PADRAO,
    1,
    LIMITE_HISTORICO_MAX,
  );

  // Client com a sessão do usuário: a policy `tenant_read` da 017 já isola.
  // O `.eq('tenant_id')` explícito existe porque para o SUPER_ADMIN a RLS
  // libera tudo — sem ele, a prévia de um credor mostraria o histórico da casa
  // inteira numa tela que diz "suas perguntas recentes".
  const { data, error } = await sessao.supabase
    .from('agente_relatorios_perguntas')
    .select('id, pergunta_texto, criado_em, tipo_relatorio, status, usuarios ( nome )')
    .eq('tenant_id', sessao.tenantId)
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (error) {
    console.error('[relatorios/perguntar GET]', error);
    return NextResponse.json(
      { title: 'Erro ao carregar o histórico de perguntas.' },
      {
        status: 500,
      },
    );
  }

  const perguntas = ((data ?? []) as unknown as LinhaHistorico[]).map((linha) => ({
    id: linha.id,
    perguntaTexto: linha.pergunta_texto,
    usuarioNome: nomeDoUsuario(linha),
    criadoEm: linha.criado_em,
    tipoRelatorio: linha.tipo_relatorio,
    status: linha.status,
  }));

  return NextResponse.json({ perguntas });
}
