import type { DashboardPayload, DashboardResponse } from './dashboard-types';

export const EMPTY_DASHBOARD_PAYLOAD: DashboardPayload = {
  kpiBordero: [],
  kpiFinanceiro: [],
  kpiCarteiraAtiva: [],
  tabelaAcordos: [],
  tabelaBaixas: [],
  carteiraRosca: [],
  enviadoRecebidoMensal: [],
  efetividadePorIdade: [],
  faixaIdadeComparativo: [],
  metricasUf: [],
  composicaoAtores: [],
};

export function emptyDashboardResponse(): DashboardResponse {
  return {
    fonte: 'vazio',
    sincronizadoEm: null,
    payload: EMPTY_DASHBOARD_PAYLOAD,
  };
}
