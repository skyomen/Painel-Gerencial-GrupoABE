/**
 * Executa um plano JÁ VALIDADO e devolve números.
 *
 * Duas regras moldam este arquivo inteiro:
 *
 * 1. NUNCA recalcular KPI. Toda conta sai de `calc-metricas-carteira`, da RPC
 *    `calcular_metricas_credor` ou de `payload-de-agregados` — as mesmas
 *    funções que desenham o dashboard e a tela da diretoria. Uma segunda
 *    implementação do mesmo KPI é o bug da migration 014 (duas definições de
 *    `recebido_abe` que discordavam), e ele não vai nascer de novo aqui.
 *
 * 2. ISOLAMENTO EM DOIS NÍVEIS. A diretoria consolida todos os credores com o
 *    client admin; aqui é o contrário. Todo SELECT leva `.eq('credor_id', ...)`
 *    com o id que o SERVIDOR resolveu, E roda no client RLS do usuário que a
 *    rota passou — nunca service role. Um nível é o cinto, o outro é o
 *    suspensório: se a policy falhar, o filtro segura; se o filtro falhar, a
 *    policy segura.
 *
 * O plano não tem — e não pode ter — campo de dono. O dono vem em `escopo`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatBRL } from '@/lib/format-currency';
import { fetchCarteiraSnapshot } from '@/lib/carteira-fetch';
import { calcularMetricasCarteira } from '@/lib/calc-metricas-carteira';
import type { MetricasCredorRpc } from '@/lib/apply-metricas-rpc';
import {
  filtrar,
  montarAcordos,
  montarBaixas,
  montarEnviadoRecebido,
  montarFaixas,
  montarKpis,
  montarUf,
  type Agregados,
} from '@/lib/payload-de-agregados';
import type { PlanoDeConsulta, SistemaOrigem } from './plano';

/** Escopo do dado. SEMPRE resolvido pelo servidor, nunca pelo plano. */
export interface EscopoExecucao {
  tenantId: string;
  credorId: string;
  razaoSocial: string;
}

/** Linha de `credores` que a rota já buscou. Só o que o executor precisa. */
export interface CredorParaExecucao {
  id: string;
  razao_social?: string | null;
  cod_cliente_principal?: string | null;
  abe_delphi_cliente_id?: string | null;
}

export interface CardResposta {
  label: string;
  valor: string;
}

export interface TabelaResposta {
  colunas: string[];
  linhas: (string | number | null)[][];
}

export type PontoSerie = { periodo: string; rotulo: string } & Record<string, string | number>;

export interface DadosRelatorio {
  cards: CardResposta[];
  tabela: TabelaResposta;
  serieGrafico: PontoSerie[];
}

export interface ErroSupabase {
  message?: string;
  code?: string;
}

interface RespostaSupabase {
  data: unknown[] | null;
  error: ErroSupabase | null;
}

/**
 * Fatia mínima do filter builder do PostgREST: encadeia `.eq()` e resolve como
 * promessa. O `SupabaseClient` real é estruturalmente compatível com isto, e um
 * dublê de teste cabe nas três linhas abaixo — é esse o ponto de ter interface
 * em vez de depender do tipo do pacote.
 */
export interface ConsultaSupabase extends PromiseLike<RespostaSupabase> {
  eq(coluna: string, valor: string): ConsultaSupabase;
}

/** Fatia mínima do client Supabase. É o client RLS do usuário, nunca o admin. */
export interface SupabaseLike {
  from(tabela: string): { select(colunas: string): ConsultaSupabase };
  rpc(
    funcao: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroSupabase | null }>;
}

/**
 * `sistemaOrigem` do plano → valor da coluna `sistema_origem` nos agregados.
 * O CHECK da migration 004 grava 'ABE_DELPHI'; o filtro da tela chama de
 * 'DELPHI'. `null` = sem recorte.
 */
const COLUNA_SISTEMA: Record<SistemaOrigem, string | null> = {
  ABE_WEB: 'ABE_WEB',
  DELPHI: 'ABE_DELPHI',
  TODOS: null,
};

const COLS_BORDERO =
  'credor_id, competencia, uf, bordero_valor, bordero_qtd, idade_soma, idade_qtd';
const COLS_REPASSE = 'credor_id, competencia, uf, recebido_abe, pagamento_direto';
const COLS_POSICAO = 'credor_id, uf, ativo_saldo_devedor, ativo_qtd';
const COLS_CLASSE =
  'credor_id, competencia, uf, tipo_classe, classe, valor_original, saldo, qtd_processos';
const COLS_FAIXA = 'credor_id, competencia, uf, faixa_idade, bordero_valor, recebido_valor';

interface LinhaFaixa {
  credor_id: string;
  competencia: string;
  uf: string;
  faixa_idade: string;
  bordero_valor: string | number | null;
  recebido_valor: string | number | null;
}

interface AgregadosDoCredor {
  ag: Agregados;
  faixas: LinhaFaixa[];
  sincronizadoEm: string | null;
}

function n(valor: number | string | null | undefined): number {
  const v = typeof valor === 'number' ? valor : Number(valor ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/** 'YYYY-MM-DD' → '01/05/2026'. */
function dataBr(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

const MESES_CURTOS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

/** Competência '2026-05-01' → 'Mai/26', como as tabelas do protótipo mostram. */
function rotuloMes(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const i = Number(mes) - 1;
  if (!MESES_CURTOS[i] || !ano) return competencia;
  return `${MESES_CURTOS[i]}/${ano.slice(2)}`;
}

/**
 * '03/11 09:14' — formato do 4º card do protótipo. Fuso de São Paulo porque é
 * onde o sync roda e onde quem lê o painel está.
 */
function dataHoraSync(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${pega('day')}/${pega('month')} ${pega('hour')}:${pega('minute')}`;
}

/** O 4º card, obrigatório em todo tipo. Sem data no banco o valor é '—', jamais uma data inventada. */
function cardSincronizacao(sincronizadoEm: string | null): CardResposta {
  return { label: 'Dados sincronizados até', valor: dataHoraSync(sincronizadoEm) };
}

async function carregarAgregados(
  supabase: SupabaseLike,
  escopo: EscopoExecucao,
  plano: PlanoDeConsulta,
): Promise<AgregadosDoCredor> {
  const sistema = COLUNA_SISTEMA[plano.filtros.sistemaOrigem];

  // Nível 1 do isolamento: o credor entra no WHERE de cada select. Nível 2 é a
  // RLS do client que a rota passou — e ela não é opcional nem substituível.
  const doCredor = (tabela: string, colunas: string) => {
    let q = supabase.from(tabela).select(colunas).eq('credor_id', escopo.credorId);
    if (sistema) q = q.eq('sistema_origem', sistema);
    return q;
  };

  const [bordero, repasse, posicao, classe, faixa, sync] = await Promise.all([
    doCredor('metricas_mensais_bordero', COLS_BORDERO),
    doCredor('metricas_mensais_repasse', COLS_REPASSE),
    doCredor('metricas_posicao', COLS_POSICAO),
    doCredor('metricas_mensais_classe', COLS_CLASSE),
    doCredor('metricas_mensais_faixa', COLS_FAIXA),
    supabase.from('sync_state').select('ultima_sucesso').eq('tenant_id', escopo.tenantId),
  ]);

  const erro =
    bordero.error ?? repasse.error ?? posicao.error ?? classe.error ?? faixa.error ?? sync.error;

  if (erro) {
    console.error('[relatorios-ia executarPlano]', erro);
    throw new Error('Não foi possível ler os agregados do credor.');
  }

  const bruto: Agregados = {
    bordero: (bordero.data ?? []) as Agregados['bordero'],
    repasse: (repasse.data ?? []) as Agregados['repasse'],
    posicao: (posicao.data ?? []) as Agregados['posicao'],
    classe: (classe.data ?? []) as Agregados['classe'],
  };

  // `filtrar` é a mesma função da diretoria: período e UF não ganham regra nova aqui.
  const ag = filtrar(bruto, {
    credorIds: [escopo.credorId],
    uf: plano.filtros.uf,
    de: plano.periodo.inicio,
    ate: plano.periodo.fim,
  });

  // A faixa não passa por `filtrar` (não é parte de `Agregados`), então repete
  // o mesmo recorte à mão — igual à rota da diretoria.
  const faixas = ((faixa.data ?? []) as LinhaFaixa[]).filter((f) => {
    if (f.credor_id !== escopo.credorId) return false;
    if (plano.filtros.uf && f.uf !== plano.filtros.uf) return false;
    return f.competencia >= plano.periodo.inicio && f.competencia <= plano.periodo.fim;
  });

  // Idade do dado = a do registro MAIS ATRASADO, como na diretoria. "Atualizado
  // agora" com uma origem parada há uma semana afirma um frescor que não existe.
  const datas = ((sync.data ?? []) as { ultima_sucesso: string | null }[])
    .map((s) => s.ultima_sucesso)
    .filter((d): d is string => Boolean(d))
    .sort();

  return { ag, faixas, sincronizadoEm: datas[0] ?? null };
}

/**
 * Carteira ativa: snapshot + `calcularMetricasCarteira`, com queda para a RPC
 * `calcular_metricas_credor` quando o snapshot vem vazio — exatamente o que a
 * rota do dashboard faz.
 *
 * O recorte por sistema de origem NÃO passa pelo snapshot: `fetchCarteiraSnapshot`
 * não lê a coluna `sistema_origem` e `calcularMetricasCarteira` não tem opção
 * para ela. Quando o plano pede um sistema específico, a conta vai pela RPC, que
 * recebe `p_sistema` e aplica o MESMO cálculo desde a migration 014 (foi ela que
 * alinhou as duas implementações). Escrever um filtro novo aqui recriaria
 * justamente a divergência que a 014 fechou.
 */
async function metricasDaCarteira(
  supabase: SupabaseLike,
  escopo: EscopoExecucao,
  plano: PlanoDeConsulta,
): Promise<MetricasCredorRpc | null> {
  const sistema = COLUNA_SISTEMA[plano.filtros.sistemaOrigem];

  const chamarRpc = async (): Promise<MetricasCredorRpc | null> => {
    const { data, error } = await supabase.rpc('calcular_metricas_credor', {
      p_credor_id: escopo.credorId,
      p_data_inicio: plano.periodo.inicio,
      p_data_fim: plano.periodo.fim,
      p_sistema: sistema,
    });
    if (error) {
      console.error('[relatorios-ia calcular_metricas_credor]', error);
      return null;
    }
    return (data ?? null) as MetricasCredorRpc | null;
  };

  if (sistema) return chamarRpc();

  const linhas = await fetchCarteiraSnapshot(
    supabase as unknown as SupabaseClient,
    escopo.credorId,
  );

  if (linhas.length === 0) return chamarRpc();

  return calcularMetricasCarteira(linhas, plano.periodo.inicio, plano.periodo.fim, {
    uf: plano.filtros.uf,
  });
}

function dadosCarteiraAtiva(
  metricas: MetricasCredorRpc | null,
  ag: Agregados,
  sincronizadoEm: string | null,
): DadosRelatorio {
  const m = metricas ?? {};
  const ufs = montarUf(ag);

  return {
    cards: [
      { label: 'Carteira ativa', valor: formatBRL(n(m.ativo_saldo_devedor)) },
      { label: 'Em cobrança', valor: formatBRL(n(m.em_cobranca)) },
      { label: 'Acordo a receber', valor: formatBRL(n(m.acordo_a_receber)) },
      { label: 'Quebra de acordo', valor: formatBRL(n(m.quebra_de_acordo)) },
      cardSincronizacao(sincronizadoEm),
    ],
    tabela: {
      colunas: ['UF', 'Saldo ativo', 'Enviado no período', 'Recebido no período', 'Efetividade'],
      linhas: ufs.map((u) => [
        u.uf,
        formatBRL(u.ativo),
        formatBRL(u.enviado),
        formatBRL(u.recebido),
        `${u.efetividade.toLocaleString('pt-BR')}%`,
      ]),
    },
    // A série é a quebra por UF, não uma linha do tempo.
    //
    // Limitação conhecida e deliberada: hoje não existe série mensal de carteira
    // ATIVA em fonte nenhuma — `metricas_posicao` é saldo de hoje e não tem
    // coluna de competência, e o snapshot é uma fotografia. Desenhar uma
    // evolução mês a mês aqui exigiria inventar o passado. Enquanto a fonte não
    // existir, esta série é por UF (ou vazia). O protótipo mostra uma evolução
    // mensal com dado fictício; implementá-la de verdade depende de uma
    // migration que passe a historiar a posição.
    serieGrafico: ufs.map((u) => ({
      periodo: u.uf,
      rotulo: u.uf,
      ativo: u.ativo,
      enviado: u.enviado,
      recebido: u.recebido,
    })),
  };
}

function dadosBordero(ag: Agregados, sincronizadoEm: string | null): DadosRelatorio {
  const { kpiBordero } = montarKpis(ag);
  const meses = montarEnviadoRecebido(ag);

  return {
    cards: [
      ...kpiBordero.slice(0, 3).map((k) => ({ label: k.rotulo, valor: k.valor })),
      cardSincronizacao(sincronizadoEm),
    ],
    tabela: {
      colunas: ['Mês', 'Valor enviado'],
      linhas: meses.map((m) => [rotuloMes(m.mes), formatBRL(m.enviado)]),
    },
    serieGrafico: meses.map((m) => ({
      periodo: m.mes,
      rotulo: rotuloMes(m.mes),
      enviado: m.enviado,
    })),
  };
}

function dadosAcordos(ag: Agregados, sincronizadoEm: string | null): DadosRelatorio {
  const linhas = montarAcordos(ag);

  return {
    cards: [
      ...linhas.slice(0, 3).map((l) => ({ label: l.metrica, valor: l.valor })),
      cardSincronizacao(sincronizadoEm),
    ],
    tabela: {
      colunas: ['Classificação', 'Processos', 'Valor'],
      linhas: linhas.map((l) => [l.metrica, l.quantidade, l.valor]),
    },
    serieGrafico: linhas.map((l) => ({
      periodo: l.metrica,
      rotulo: l.metrica,
      quantidade: l.quantidade,
    })),
  };
}

function dadosBaixas(ag: Agregados, sincronizadoEm: string | null): DadosRelatorio {
  const linhas = montarBaixas(ag);

  return {
    cards: [
      ...linhas.slice(0, 3).map((l) => ({ label: l.motivo, valor: l.valor })),
      cardSincronizacao(sincronizadoEm),
    ],
    tabela: {
      colunas: ['Motivo', 'Definição', 'Processos', 'Valor'],
      linhas: linhas.map((l) => [l.motivo, l.definicao, l.quantidade, l.valor]),
    },
    serieGrafico: linhas.map((l) => ({
      periodo: l.motivo,
      rotulo: l.motivo,
      quantidade: l.quantidade,
    })),
  };
}

function dadosPosicaoMensal(ag: Agregados, sincronizadoEm: string | null): DadosRelatorio {
  const { kpiFinanceiro } = montarKpis(ag);
  const meses = montarEnviadoRecebido(ag);

  return {
    cards: [
      ...kpiFinanceiro.slice(0, 3).map((k) => ({ label: k.rotulo, valor: k.valor })),
      cardSincronizacao(sincronizadoEm),
    ],
    tabela: {
      colunas: ['Mês', 'Enviado', 'Recebido'],
      linhas: meses.map((m) => [rotuloMes(m.mes), formatBRL(m.enviado), formatBRL(m.recebido)]),
    },
    serieGrafico: meses.map((m) => ({
      periodo: m.mes,
      rotulo: rotuloMes(m.mes),
      enviado: m.enviado,
      recebido: m.recebido,
    })),
  };
}

function dadosClassificacaoIdade(
  faixas: LinhaFaixa[],
  sincronizadoEm: string | null,
): DadosRelatorio {
  const { efetividadePorIdade, faixaIdadeComparativo } = montarFaixas(faixas);
  const efetividadePorFaixa = new Map(efetividadePorIdade.map((e) => [e.idade, e.efetividade]));

  return {
    cards: [
      ...efetividadePorIdade.slice(0, 3).map((e) => ({
        label: `Efetividade ${e.idade}`,
        valor: `${e.efetividade.toLocaleString('pt-BR')}%`,
      })),
      cardSincronizacao(sincronizadoEm),
    ],
    tabela: {
      colunas: ['Faixa de idade', 'Enviado', 'Recebido', 'Efetividade'],
      linhas: faixaIdadeComparativo.map((f) => [
        f.faixa,
        formatBRL(f.enviado),
        formatBRL(f.recebido),
        `${(efetividadePorFaixa.get(f.faixa) ?? 0).toLocaleString('pt-BR')}%`,
      ]),
    },
    serieGrafico: faixaIdadeComparativo.map((f) => ({
      periodo: f.faixa,
      rotulo: f.faixa,
      enviado: f.enviado,
      recebido: f.recebido,
      efetividade: efetividadePorFaixa.get(f.faixa) ?? 0,
    })),
  };
}

export async function executarPlano(args: {
  plano: PlanoDeConsulta;
  escopo: EscopoExecucao;
  /** Client RLS do usuário, vindo da rota. Passar service role aqui é falha de segurança. */
  supabase: SupabaseLike;
  credor: CredorParaExecucao;
}): Promise<DadosRelatorio> {
  const { plano, escopo, supabase, credor } = args;

  // A rota busca o credor e resolve o escopo em lugares diferentes. Se os dois
  // discordarem, parar é a única saída correta: executar escolheria um dos dois
  // em silêncio, e metade das vezes seria o errado.
  if (credor.id !== escopo.credorId) {
    throw new Error('Escopo inconsistente: o credor recebido não é o credor do escopo.');
  }

  const { ag, faixas, sincronizadoEm } = await carregarAgregados(supabase, escopo, plano);

  switch (plano.tipoRelatorio) {
    case 'CARTEIRA_ATIVA': {
      const metricas = await metricasDaCarteira(supabase, escopo, plano);
      return dadosCarteiraAtiva(metricas, ag, sincronizadoEm);
    }
    case 'BORDERO':
      return dadosBordero(ag, sincronizadoEm);
    case 'ACORDOS':
      return dadosAcordos(ag, sincronizadoEm);
    case 'BAIXAS':
      return dadosBaixas(ag, sincronizadoEm);
    case 'POSICAO_MENSAL':
      return dadosPosicaoMensal(ag, sincronizadoEm);
    case 'CLASSIFICACAO_IDADE':
      return dadosClassificacaoIdade(faixas, sincronizadoEm);
  }
}

/** Exportado para `resposta.ts` montar o período da transparência sem repetir a conversão. */
export { dataBr };
