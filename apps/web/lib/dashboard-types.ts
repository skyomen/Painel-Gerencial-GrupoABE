/** Tipos do payload do dashboard (mock ou sync ABE WEB → Supabase). */

export interface FiltrosDashboard {
  codCliente: string;
  loteEnvio: string;
  /** ISO YYYY-MM-DD */
  dataInicio: string;
  /** ISO YYYY-MM-DD */
  dataFinal: string;
  uf: string;
}

export interface KpiItem {
  rotulo: string;
  valor: string;
  detalhe?: string;
}

export interface AcordoLinha {
  metrica: string;
  quantidade: number;
  valor: string;
}

export interface BaixaLinha {
  motivo: string;
  definicao: string;
  quantidade: number;
  valor: string;
}

export interface RoscaItem {
  label: string;
  pct: number;
  cor: string;
}

export interface EnviadoRecebidoMes {
  mes: string;
  enviado: number;
  recebido: number;
}

export interface EfetividadeIdade {
  idade: string;
  efetividade: number;
}

export interface FaixaIdadeComparativo {
  faixa: string;
  enviado: number;
  recebido: number;
  media: number;
}

export interface UfMetrica {
  uf: string;
  enviado: number;
  recebido: number;
  efetividade: number;
  ativo: number;
  devolvido: number;
}

export interface AtorComposicao {
  id: string;
  nome: string;
  descricao: string;
  valor: string;
  pct: number;
  logo: string;
  detalhe?: Record<string, string>;
}

export interface OpcaoFiltro {
  value: string;
  label: string;
  /** Agrupa lotes por mês ou por dia (estilo Power BI). */
  grupo?: 'mes' | 'dia';
}

export interface BorderoIndiceItem {
  d: string;
  p: string;
  v: number;
  uf: string;
  i: number;
  s: string;
  vis: string;
}

export interface DashboardMeta {
  codCliente?: string;
  periodo?: { dataInicial: string; dataFinal: string };
  datasBordero?: {
    min: string | null;
    max: string | null;
    minIso: string | null;
    maxIso: string | null;
    /** Última Data Repasse na carteira (para exibição). */
    maxRepasseIso?: string | null;
    maxInclusaoIso?: string | null;
  };
  loteRankMap?: Record<string, number>;
  totalLinhasBordero?: number;
  processosBordero?: number;
}

export interface DashboardPayload {
  kpiBordero: KpiItem[];
  kpiFinanceiro: KpiItem[];
  kpiCarteiraAtiva: KpiItem[];
  tabelaAcordos: AcordoLinha[];
  tabelaBaixas: BaixaLinha[];
  carteiraRosca: RoscaItem[];
  enviadoRecebidoMensal: EnviadoRecebidoMes[];
  efetividadePorIdade: EfetividadeIdade[];
  faixaIdadeComparativo: FaixaIdadeComparativo[];
  metricasUf: UfMetrica[];
  composicaoAtores: AtorComposicao[];
  opcoesCodCliente?: OpcaoFiltro[];
  opcoesLote?: OpcaoFiltro[];
  opcoesUf?: OpcaoFiltro[];
  borderoIndice?: BorderoIndiceItem[];
  meta?: DashboardMeta;
}

/** Credor visitado quando o SUPER_ADMIN abre o painel de um credor (prévia). */
export interface CredorPreview {
  id: string;
  razaoSocial: string;
}

export interface DashboardResponse {
  fonte: 'abeweb' | 'vazio';
  sincronizadoEm: string | null;
  payload: DashboardPayload;
  filtrosAplicados?: Pick<FiltrosDashboard, 'dataInicio' | 'dataFinal'>;
  credorPreview?: CredorPreview;
}

export const FILTROS_INICIAIS: FiltrosDashboard = {
  codCliente: 'todos',
  loteEnvio: 'todos',
  dataInicio: '',
  dataFinal: '',
  uf: 'todos',
};
