/**
 * Monta o `DashboardPayload` — o MESMO que a tela do credor consome — a partir
 * das tabelas de agregado.
 *
 * É isto que permite a visão da diretoria ser a mesma tela: os componentes não
 * sabem se estão desenhando um credor ou a soma de todos; muda só quantas
 * linhas de agregado entraram na conta.
 *
 * Funções puras, testadas sem banco.
 */

import { formatBRL } from './format-currency';
import type {
  AcordoLinha,
  BaixaLinha,
  DashboardPayload,
  EfetividadeIdade,
  EnviadoRecebidoMes,
  FaixaIdadeComparativo,
  KpiItem,
  RoscaItem,
  UfMetrica,
} from './dashboard-types';

export interface AgBordero {
  credor_id: string;
  competencia: string;
  uf: string;
  bordero_valor: number | string | null;
  bordero_qtd: number | null;
  idade_soma: number | string | null;
  idade_qtd: number | null;
}

export interface AgRepasse {
  credor_id: string;
  competencia: string;
  uf: string;
  recebido_abe: number | string | null;
  pagamento_direto: number | string | null;
}

export interface AgPosicao {
  credor_id: string;
  uf: string;
  ativo_saldo_devedor: number | string | null;
  ativo_qtd: number | null;
}

export interface AgClasse {
  credor_id: string;
  competencia: string;
  uf: string;
  tipo_classe: 'acordo' | 'devolucao';
  classe: string;
  valor_original: number | string | null;
  saldo: number | string | null;
  qtd_processos: number | null;
}

export interface Agregados {
  bordero: AgBordero[];
  repasse: AgRepasse[];
  posicao: AgPosicao[];
  classe: AgClasse[];
}

/** NUMERIC do Postgres chega como string pelo PostgREST; somar string concatena. */
function n(valor: number | string | null | undefined): number {
  const v = typeof valor === 'number' ? valor : Number(valor ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function pct(parte: number, todo: number): number {
  if (!todo) return 0;
  return Math.round((parte / todo) * 1000) / 10;
}

function fmtNumero(valor: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(valor));
}

/** Rótulos exatos das classes, como a tela sempre mostrou. */
const ROTULO_ACORDO: Record<string, string> = {
  acordo_com_pagamento: 'Acordo com pagamento',
  acordo_a_receber: 'Acordo a receber',
  em_cobranca: 'Em cobrança',
  quebra_de_acordo: 'Quebra de Acordo',
};

const ROTULO_DEVOLUCAO: Record<string, string> = {
  nao_processado: 'Não processado',
  nao_estabelecido: 'Não Estabelecido',
  incobravel: 'Incobrável',
};

const DEFINICAO_DEVOLUCAO: Record<string, string> = {
  'Não processado': 'Título devolvido sem processamento',
  'Não Estabelecido': 'Devedor não localizado ou não estabelecido',
  Incobrável: 'Devolvido conforme status no ABE WEB',
};

/** Ordem fixa: a cor de cada fatia segue a categoria, nunca o tamanho dela. */
const ORDEM_ROSCA: { classe: string; label: string; cor: string }[] = [
  { classe: 'acordo_com_pagamento', label: 'Acordo com pagamento', cor: 'var(--serie-1, #2a78d6)' },
  { classe: 'acordo_a_receber', label: 'Acordo a receber', cor: 'var(--serie-2, #eb6834)' },
  { classe: 'em_cobranca', label: 'Em cobrança', cor: 'var(--serie-3, #1baf7a)' },
  { classe: 'quebra_de_acordo', label: 'Quebra de Acordo', cor: 'var(--serie-4, #eda100)' },
];

export interface FiltroAgregado {
  /** Vazio = todos os credores (visão da diretoria). */
  credorId?: string | null;
  uf?: string | null;
  de?: string | null;
  ate?: string | null;
}

function passaFiltro(
  linha: { credor_id: string; uf: string; competencia?: string },
  filtro: FiltroAgregado,
): boolean {
  if (filtro.credorId && linha.credor_id !== filtro.credorId) return false;
  if (filtro.uf && filtro.uf !== 'todos' && linha.uf !== filtro.uf) return false;
  if (linha.competencia) {
    if (filtro.de && linha.competencia < filtro.de) return false;
    if (filtro.ate && linha.competencia > filtro.ate) return false;
  }
  return true;
}

export function filtrar(agregados: Agregados, filtro: FiltroAgregado): Agregados {
  return {
    bordero: agregados.bordero.filter((l) => passaFiltro(l, filtro)),
    repasse: agregados.repasse.filter((l) => passaFiltro(l, filtro)),
    // Posição não tem competência: é o saldo de hoje, não do período.
    posicao: agregados.posicao.filter((l) => passaFiltro(l, filtro)),
    classe: agregados.classe.filter((l) => passaFiltro(l, filtro)),
  };
}

function totais(ag: Agregados) {
  const enviado = ag.bordero.reduce((s, l) => s + n(l.bordero_valor), 0);
  const processos = ag.bordero.reduce((s, l) => s + n(l.bordero_qtd), 0);
  const idadeSoma = ag.bordero.reduce((s, l) => s + n(l.idade_soma), 0);
  const idadeQtd = ag.bordero.reduce((s, l) => s + n(l.idade_qtd), 0);
  const recebido = ag.repasse.reduce((s, l) => s + n(l.recebido_abe), 0);
  const direto = ag.repasse.reduce((s, l) => s + n(l.pagamento_direto), 0);
  const saldoAtivo = ag.posicao.reduce((s, l) => s + n(l.ativo_saldo_devedor), 0);
  const qtdAtivo = ag.posicao.reduce((s, l) => s + n(l.ativo_qtd), 0);

  return {
    enviado,
    processos,
    // Média de idade sai de soma÷contagem. Média de médias não é média.
    idadeMedia: idadeQtd ? idadeSoma / idadeQtd : 0,
    recebido,
    direto,
    saldoAtivo,
    qtdAtivo,
  };
}

export function montarKpis(ag: Agregados): {
  kpiBordero: KpiItem[];
  kpiFinanceiro: KpiItem[];
  kpiCarteiraAtiva: KpiItem[];
} {
  const t = totais(ag);

  return {
    kpiBordero: [
      { rotulo: 'Valor enviado', valor: formatBRL(t.enviado), detalhe: 'Borderô do período' },
      {
        rotulo: 'Processos',
        valor: fmtNumero(t.processos),
        detalhe: 'Processos distintos enviados à cobrança',
      },
      {
        rotulo: 'Idade média no envio',
        valor: `${fmtNumero(t.idadeMedia)} dias`,
        detalhe: 'Do vencimento até o cadastro',
      },
    ],
    kpiFinanceiro: [
      { rotulo: 'Recebido pela ABE', valor: formatBRL(t.recebido), detalhe: 'Repasses do período' },
      {
        rotulo: 'Pagamento direto',
        valor: formatBRL(t.direto),
        detalhe: 'Pago direto ao credor',
      },
      {
        // Dos totais, nunca a média das efetividades.
        rotulo: 'Efetividade',
        valor: `${pct(t.recebido, t.enviado).toLocaleString('pt-BR')}%`,
        detalhe: 'Recebido / enviado',
      },
    ],
    kpiCarteiraAtiva: [
      { rotulo: 'Saldo ativo', valor: formatBRL(t.saldoAtivo), detalhe: 'Em negociação' },
      { rotulo: 'Processos ativos', valor: fmtNumero(t.qtdAtivo), detalhe: 'Processos ativos' },
      {
        rotulo: 'Ticket médio',
        valor: formatBRL(t.qtdAtivo ? t.saldoAtivo / t.qtdAtivo : 0),
        detalhe: 'Saldo ativo / processos ativos',
      },
    ],
  };
}

export function montarEnviadoRecebido(ag: Agregados): EnviadoRecebidoMes[] {
  const mapa = new Map<string, EnviadoRecebidoMes>();
  const pega = (competencia: string) => {
    let m = mapa.get(competencia);
    if (!m) {
      m = { mes: competencia, enviado: 0, recebido: 0 };
      mapa.set(competencia, m);
    }
    return m;
  };

  for (const l of ag.bordero) pega(l.competencia).enviado += n(l.bordero_valor);
  // Eixo de tempo próprio: um mês pode receber sem ter enviado nada.
  for (const l of ag.repasse) pega(l.competencia).recebido += n(l.recebido_abe);

  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

export function montarUf(ag: Agregados): UfMetrica[] {
  const mapa = new Map<string, UfMetrica>();
  const pega = (uf: string) => {
    let u = mapa.get(uf);
    if (!u) {
      u = { uf, enviado: 0, recebido: 0, efetividade: 0, ativo: 0, devolvido: 0 };
      mapa.set(uf, u);
    }
    return u;
  };

  for (const l of ag.bordero) if (l.uf) pega(l.uf).enviado += n(l.bordero_valor);
  for (const l of ag.repasse) if (l.uf) pega(l.uf).recebido += n(l.recebido_abe);
  for (const l of ag.posicao) if (l.uf) pega(l.uf).ativo += n(l.ativo_saldo_devedor);
  for (const l of ag.classe) {
    if (l.uf && l.tipo_classe === 'devolucao') pega(l.uf).devolvido += n(l.valor_original);
  }

  for (const u of mapa.values()) u.efetividade = pct(u.recebido, u.enviado);
  return [...mapa.values()].sort((a, b) => b.enviado - a.enviado);
}

export function montarAcordos(ag: Agregados): AcordoLinha[] {
  const mapa = new Map<string, { qtd: number; original: number; saldo: number }>();

  for (const l of ag.classe) {
    if (l.tipo_classe !== 'acordo') continue;
    const atual = mapa.get(l.classe) ?? { qtd: 0, original: 0, saldo: 0 };
    atual.qtd += n(l.qtd_processos);
    atual.original += n(l.valor_original);
    atual.saldo += n(l.saldo);
    mapa.set(l.classe, atual);
  }

  return ORDEM_ROSCA.map(({ classe }) => {
    const v = mapa.get(classe);
    if (!v || (v.original === 0 && v.saldo === 0)) return null;
    return {
      metrica: ROTULO_ACORDO[classe] ?? classe,
      quantidade: v.qtd,
      // Saldo quando existe, senão o original — como a tela sempre mostrou.
      valor: formatBRL(v.saldo > 0 ? v.saldo : v.original),
    };
  }).filter((l): l is AcordoLinha => l !== null);
}

export function montarBaixas(ag: Agregados): BaixaLinha[] {
  const mapa = new Map<string, { qtd: number; valor: number }>();

  for (const l of ag.classe) {
    if (l.tipo_classe !== 'devolucao') continue;
    const atual = mapa.get(l.classe) ?? { qtd: 0, valor: 0 };
    atual.qtd += n(l.qtd_processos);
    atual.valor += n(l.valor_original);
    mapa.set(l.classe, atual);
  }

  return [...mapa.entries()]
    .filter(([, v]) => v.valor > 0)
    .map(([classe, v]) => {
      const motivo = ROTULO_DEVOLUCAO[classe] ?? classe;
      return {
        motivo,
        definicao: DEFINICAO_DEVOLUCAO[motivo] ?? 'Devolvido conforme status no ABE WEB',
        quantidade: v.qtd,
        valor: formatBRL(v.valor),
      };
    });
}

export function montarRosca(ag: Agregados): RoscaItem[] {
  const porClasse = new Map<string, number>();
  for (const l of ag.classe) {
    if (l.tipo_classe !== 'acordo') continue;
    porClasse.set(l.classe, (porClasse.get(l.classe) ?? 0) + n(l.valor_original));
  }

  const total = [...porClasse.values()].reduce((s, v) => s + v, 0);
  if (!total) return [];

  // A cor vem da posição fixa da categoria; filtrar não repinta as demais.
  return ORDEM_ROSCA.filter(({ classe }) => (porClasse.get(classe) ?? 0) > 0).map(
    ({ classe, label, cor }) => ({
      label,
      pct: pct(porClasse.get(classe) ?? 0, total),
      cor,
    }),
  );
}

export function montarFaixas(
  faixas: {
    faixa_idade: string;
    bordero_valor: number | string | null;
    recebido_valor: number | string | null;
  }[],
): { efetividadePorIdade: EfetividadeIdade[]; faixaIdadeComparativo: FaixaIdadeComparativo[] } {
  const ORDEM = ['0-30', '31-60', '61-90', '91-180', '180+'];
  const LABEL: Record<string, string> = {
    '0-30': '0-30d',
    '31-60': '31-60d',
    '61-90': '61-90d',
    '91-180': '91-180d',
    '180+': '180+d',
  };

  const mapa = new Map<string, { enviado: number; recebido: number }>();
  for (const f of faixas) {
    const atual = mapa.get(f.faixa_idade) ?? { enviado: 0, recebido: 0 };
    atual.enviado += n(f.bordero_valor);
    atual.recebido += n(f.recebido_valor);
    mapa.set(f.faixa_idade, atual);
  }

  const presentes = ORDEM.filter((f) => mapa.has(f));

  return {
    efetividadePorIdade: presentes.map((f) => ({
      idade: LABEL[f] ?? f,
      efetividade: pct(mapa.get(f)!.recebido, mapa.get(f)!.enviado),
    })),
    faixaIdadeComparativo: presentes.map((f) => {
      const v = mapa.get(f)!;
      return {
        faixa: LABEL[f] ?? f,
        enviado: v.enviado,
        recebido: v.recebido,
        media: v.enviado ? v.recebido / v.enviado : 0,
      };
    }),
  };
}

export function montarDashboardDeAgregados(
  ag: Agregados,
  faixas: Parameters<typeof montarFaixas>[0],
): DashboardPayload {
  const { kpiBordero, kpiFinanceiro, kpiCarteiraAtiva } = montarKpis(ag);
  const { efetividadePorIdade, faixaIdadeComparativo } = montarFaixas(faixas);
  const t = totais(ag);

  return {
    kpiBordero,
    kpiFinanceiro,
    kpiCarteiraAtiva,
    tabelaAcordos: montarAcordos(ag),
    tabelaBaixas: montarBaixas(ag),
    carteiraRosca: montarRosca(ag),
    enviadoRecebidoMensal: montarEnviadoRecebido(ag),
    efetividadePorIdade,
    faixaIdadeComparativo,
    metricasUf: montarUf(ag),
    composicaoAtores: t.enviado
      ? [
          {
            id: 'abe',
            nome: 'ABE',
            descricao: 'ABE WEB',
            valor: formatBRL(t.enviado),
            pct: 100,
            logo: '/sources/ponteiro-mouse/ABE.svg',
          },
        ]
      : [],
  };
}
