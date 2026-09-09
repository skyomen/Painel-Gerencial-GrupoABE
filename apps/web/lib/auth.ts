import { createClient } from './supabase/client';
import { apiFetch, type ApiError } from './api-client';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  nome: string;
  papel: string;
  ativo?: boolean;
  fotoUrl?: string | null;
}

export function isSuperAdmin(user: AuthUser): boolean {
  return user.papel === 'SUPER_ADMIN';
}

export function adminHomePath(user: AuthUser): '/admin/credores' | '/dashboard' {
  return isSuperAdmin(user) ? '/admin/credores' : '/dashboard';
}

export async function login(email: string, senha: string): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), senha }),
  });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } catch (err) {
    void (err as ApiError);
  }
}

export async function me(): Promise<AuthUser> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw { title: 'Sessão expirada ou credenciais inválidas.', status: 401 } satisfies ApiError;
  }

  const { data, error: profileError } = await supabase
    .from('usuarios')
    .select('id, tenant_id, email, nome, papel, ativo, foto_url')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !data) {
    await supabase.auth.signOut();
    throw { title: 'Perfil de usuário não encontrado.', status: 403 } satisfies ApiError;
  }

  if (!data.ativo) {
    await supabase.auth.signOut();
    throw {
      title: 'Conta desativada. Entre em contato com o administrador.',
      status: 403,
    } satisfies ApiError;
  }

  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    nome: data.nome,
    papel: data.papel,
    ativo: data.ativo,
    fotoUrl: data.foto_url,
  };
}
