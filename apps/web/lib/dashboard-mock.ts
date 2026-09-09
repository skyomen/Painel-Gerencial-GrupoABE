/** Dados de demonstração — apenas para desenvolvimento local (não usado em produção). */

import type { DashboardPayload, OpcaoFiltro } from './dashboard-types';

export type {
  AcordoLinha,
  BaixaLinha,
  DashboardPayload,
  DashboardResponse,
  FiltrosDashboard,
  KpiItem,
} from './dashboard-types';

export { FILTROS_INICIAIS } from './dashboard-types';

export const OPCOES_COD_CLIENTE: OpcaoFiltro[] = [
  { value: 'todos', label: 'Todos os códigos' },
  { value: '1042', label: '1042 — Matriz' },
  { value: '1043', label: '1043 — Filial SP' },
  { value: '1044', label: '1044 — Filial RJ' },
];

export const OPCOES_LOTE: OpcaoFiltro[] = [
  { value: 'todos', label: 'Todos os lotes' },
  { value: 'mes:LOTE01-JAN/26', label: 'LOTE01-JAN/26', grupo: 'mes' },
  { value: 'dia:LOTE01-15', label: 'LOTE01-15', grupo: 'dia' },
];

export const OPCOES_UF: OpcaoFiltro[] = [
  { value: 'todos', label: 'Todos os estados' },
  { value: 'SP', label: 'SP' },
  { value: 'RJ', label: 'RJ' },
  { value: 'MG', label: 'MG' },
  { value: 'RS', label: 'RS' },
  { value: 'PR', label: 'PR' },
];

export const MOCK_DASHBOARD_PAYLOAD: DashboardPayload = {
  kpiBordero: [
    { rotulo: 'Valor total enviado', valor: 'R$ 18.400.000,00', detalhe: 'Borderô consolidado' },
    { rotulo: 'Processos enviados', valor: '12.847', detalhe: 'Quantidade de títulos' },
    { rotulo: 'Média de idade no envio', valor: '142 dias', detalhe: 'Idade média dos títulos' },
    { rotulo: 'Lotes no período', valor: '3', detalhe: 'Borderôs recebidos' },
  ],
  kpiFinanceiro: [
    { rotulo: 'Recebido pela ABE', valor: 'R$ 4.920.000,00', detalhe: 'Cobrança ativa' },
    { rotulo: 'Pagamento direto', valor: 'R$ 1.180.000,00', detalhe: 'Devedor → credor' },
    { rotulo: 'Efetividade geral', valor: '33,2%', detalhe: 'Sucesso sobre enviado' },
    { rotulo: 'Total recuperado', valor: 'R$ 6.100.000,00', detalhe: 'ABE + pagamento direto' },
  ],
  kpiCarteiraAtiva: [
    { rotulo: 'Valor em negociação', valor: 'R$ 7.280.000,00', detalhe: 'Carteira ativa' },
    { rotulo: 'Processos ativos', valor: '5.214', detalhe: 'Em tratativa' },
    { rotulo: '% sobre enviado', valor: '39,6%', detalhe: 'Participação da carteira' },
    { rotulo: 'Ticket médio', valor: 'R$ 1.396,00', detalhe: 'Por processo ativo' },
  ],
  tabelaAcordos: [
    { metrica: 'Acordos realizados', quantidade: 1847, valor: 'R$ 3.420.000,00' },
    { metrica: 'Acordos sendo pagos (parcialmente)', quantidade: 612, valor: 'R$ 1.080.000,00' },
    { metrica: 'Acordos quebrados', quantidade: 289, valor: 'R$ 520.000,00' },
    { metrica: 'Acordos firmados sem 1ª parcela paga', quantidade: 94, valor: 'R$ 178.000,00' },
  ],
  tabelaBaixas: [
    {
      motivo: 'Incobrável',
      definicao: 'ABE esgotou todas as etapas extrajudiciais sem êxito',
      quantidade: 421,
      valor: 'R$ 890.000,00',
    },
    {
      motivo: 'Não estabelecido',
      definicao: 'Devedor não encontrado no endereço — constatado em visita',
      quantidade: 187,
      valor: 'R$ 312.000,00',
    },
    {
      motivo: 'Não processado',
      definicao: 'Histórico negativo + título com mais de 18 meses',
      quantidade: 256,
      valor: 'R$ 445.000,00',
    },
  ],
  carteiraRosca: [
    { label: 'Recebido', pct: 33.2, cor: 'hsl(var(--success))' },
    { label: 'Ativo', pct: 39.6, cor: 'hsl(var(--primary))' },
    { label: 'Acordo', pct: 18.6, cor: 'hsl(var(--accent))' },
    { label: 'Incobrável', pct: 5.4, cor: 'hsl(var(--danger))' },
    { label: 'Devolvido', pct: 3.2, cor: 'hsl(var(--muted-foreground))' },
  ],
  enviadoRecebidoMensal: [
    { mes: 'Out', enviado: 1_200_000, recebido: 380_000 },
    { mes: 'Nov', enviado: 1_800_000, recebido: 520_000 },
    { mes: 'Dez', enviado: 2_100_000, recebido: 610_000 },
    { mes: 'Jan', enviado: 1_900_000, recebido: 580_000 },
    { mes: 'Fev', enviado: 2_400_000, recebido: 720_000 },
    { mes: 'Mar', enviado: 2_000_000, recebido: 690_000 },
  ],
  efetividadePorIdade: [
    { idade: '0-30d', efetividade: 68 },
    { idade: '31-60d', efetividade: 54 },
    { idade: '61-90d', efetividade: 41 },
    { idade: '91-180d', efetividade: 28 },
    { idade: '180+d', efetividade: 14 },
  ],
  faixaIdadeComparativo: [
    { faixa: '0-30', enviado: 2_100_000, recebido: 1_430_000, media: 68 },
    { faixa: '31-60', enviado: 3_400_000, recebido: 1_840_000, media: 54 },
    { faixa: '61-90', enviado: 4_200_000, recebido: 1_720_000, media: 41 },
    { faixa: '91-180', enviado: 5_800_000, recebido: 1_620_000, media: 28 },
    { faixa: '180+', enviado: 2_900_000, recebido: 410_000, media: 14 },
  ],
  metricasUf: [
    {
      uf: 'SP',
      enviado: 6_200_000,
      recebido: 2_100_000,
      efetividade: 33.9,
      ativo: 2_400_000,
      devolvido: 400_000,
    },
    {
      uf: 'RJ',
      enviado: 3_100_000,
      recebido: 900_000,
      efetividade: 29.0,
      ativo: 1_200_000,
      devolvido: 300_000,
    },
    {
      uf: 'MG',
      enviado: 2_800_000,
      recebido: 1_000_000,
      efetividade: 35.7,
      ativo: 1_100_000,
      devolvido: 200_000,
    },
    {
      uf: 'RS',
      enviado: 1_900_000,
      recebido: 700_000,
      efetividade: 36.8,
      ativo: 800_000,
      devolvido: 100_000,
    },
    {
      uf: 'PR',
      enviado: 1_600_000,
      recebido: 500_000,
      efetividade: 31.3,
      ativo: 700_000,
      devolvido: 200_000,
    },
    {
      uf: 'SC',
      enviado: 1_200_000,
      recebido: 400_000,
      efetividade: 33.3,
      ativo: 500_000,
      devolvido: 100_000,
    },
  ],
  composicaoAtores: [
    {
      id: 'abe',
      nome: 'ABE',
      descricao: 'Delphi + ABE Web',
      valor: 'R$ 13.200.000,00',
      pct: 71.7,
      logo: '/sources/ponteiro-mouse/ABE.svg',
      detalhe: { delphi: 'R$ 7.800.000,00', web: 'R$ 5.400.000,00' },
    },
    {
      id: 'acordo_seguro',
      nome: 'Acordo Seguro',
      descricao: 'Negociação digital',
      valor: 'R$ 3.100.000,00',
      pct: 16.8,
      logo: '/sources/ponteiro-mouse/Acordoseguro.svg',
    },
    {
      id: 'avantpay',
      nome: 'AvantPay',
      descricao: 'Cobrança preventiva',
      valor: 'R$ 2.100.000,00',
      pct: 11.5,
      logo: '/sources/ponteiro-mouse/Avantpay.svg',
    },
  ],
  opcoesCodCliente: OPCOES_COD_CLIENTE,
  opcoesLote: OPCOES_LOTE,
  opcoesUf: OPCOES_UF,
};

/** @deprecated Use MOCK_DASHBOARD_PAYLOAD — mantido para imports legados */
export const KPI_BORDERO = MOCK_DASHBOARD_PAYLOAD.kpiBordero;
export const KPI_FINANCEIRO = MOCK_DASHBOARD_PAYLOAD.kpiFinanceiro;
export const KPI_CARTEIRA_ATIVA = MOCK_DASHBOARD_PAYLOAD.kpiCarteiraAtiva;
export const TABELA_ACORDOS = MOCK_DASHBOARD_PAYLOAD.tabelaAcordos;
export const TABELA_BAIXAS = MOCK_DASHBOARD_PAYLOAD.tabelaBaixas;
export const CARTEIRA_ROSCA = MOCK_DASHBOARD_PAYLOAD.carteiraRosca;
export const ENVIADO_RECEBIDO_MENSAL = MOCK_DASHBOARD_PAYLOAD.enviadoRecebidoMensal;
export const EFETIVIDADE_POR_IDADE = MOCK_DASHBOARD_PAYLOAD.efetividadePorIdade;
export const FAIXA_IDADE_COMPARATIVO = MOCK_DASHBOARD_PAYLOAD.faixaIdadeComparativo;
export const METRICAS_UF = MOCK_DASHBOARD_PAYLOAD.metricasUf;
export const COMPOSICAO_ATORES = MOCK_DASHBOARD_PAYLOAD.composicaoAtores;
