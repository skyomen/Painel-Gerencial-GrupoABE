/**
 * Guardas de rota puras (UX). A API/RLS continua sendo a fonte de verdade.
 */

export type RouteProfile = { papel: string; ativo: boolean } | null;

export type GuardDecision =
  | { type: 'allow' }
  | { type: 'redirect'; to: '/login' | '/dashboard' | '/admin/credores' | '/sem-permissao' };

export function decideRouteGuard(
  pathname: string,
  userId: string | undefined,
  profile: RouteProfile,
): GuardDecision {
  const isLoginRoute = pathname === '/login' || pathname.startsWith('/login/');
  const isAdminRoute = pathname.startsWith('/admin');
  const isDashboardRoute = pathname.startsWith('/dashboard');
  const isSemPermissao = pathname === '/sem-permissao' || pathname.startsWith('/sem-permissao/');
  const isProtected = isAdminRoute || isDashboardRoute;

  if (isProtected && !userId) {
    return { type: 'redirect', to: '/login' };
  }

  if (userId && isLoginRoute) {
    if (profile?.ativo && profile.papel === 'SUPER_ADMIN') {
      return { type: 'redirect', to: '/admin/credores' };
    }
    if (profile?.ativo) {
      return { type: 'redirect', to: '/dashboard' };
    }
    return { type: 'redirect', to: '/login' };
  }

  if (userId && isAdminRoute) {
    if (!profile?.ativo) return { type: 'redirect', to: '/login' };
    if (profile.papel !== 'SUPER_ADMIN') {
      return { type: 'redirect', to: '/sem-permissao' };
    }
  }

  if (userId && isDashboardRoute) {
    if (!profile?.ativo) return { type: 'redirect', to: '/login' };
    // SUPER_ADMIN pode abrir /dashboard (suporte) — política AGENTS.md / ADR-0006
  }

  if (isSemPermissao) {
    return { type: 'allow' };
  }

  return { type: 'allow' };
}
