import { apiFetch } from './api-client';
import type { DashboardResponse, FiltrosDashboard } from './dashboard-types';

/** `credorId` só é aceito para SUPER_ADMIN — prévia do painel de um credor. */
export function fetchDashboard(
  filtros: FiltrosDashboard,
  credorId?: string | null,
): Promise<DashboardResponse> {
  const params = new URLSearchParams({
    codCliente: filtros.codCliente,
    loteEnvio: filtros.loteEnvio,
    uf: filtros.uf,
  });
  if (filtros.dataInicio) params.set('dataInicio', filtros.dataInicio);
  if (filtros.dataFinal) params.set('dataFinal', filtros.dataFinal);
  if (credorId) params.set('credorId', credorId);

  return apiFetch(`/dashboard?${params.toString()}`);
}
