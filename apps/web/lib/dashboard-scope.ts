/**
 * Escopo do dashboard: o credor cujo painel será montado.
 *
 * Sem `credorId`, cada usuário vê o painel do próprio tenant.
 * Com `credorId`, o SUPER_ADMIN pré-visualiza o painel de qualquer credor —
 * exatamente a visão que o responsável do credor tem ao entrar. A UI só oferece
 * o atalho; a autorização vale aqui e na RLS.
 */

export type DashboardScope =
  | { type: 'proprio' }
  | { type: 'credor'; credorId: string }
  | { type: 'negado' };

export function resolveDashboardScope(
  papel: string | null | undefined,
  credorIdParam: string | null | undefined,
): DashboardScope {
  const credorId = credorIdParam?.trim();
  if (!credorId) return { type: 'proprio' };
  if (papel !== 'SUPER_ADMIN') return { type: 'negado' };
  return { type: 'credor', credorId };
}
