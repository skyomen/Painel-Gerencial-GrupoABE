'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, LogOut, Menu, Shield, TrendingUp, Users, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { UserAvatar } from '@/components/ui/user-avatar';
import { FormattedDate } from '@/components/ui/formatted-date';
import { logout, me, isSuperAdmin, type AuthUser } from '@/lib/auth';
import { PAPEL_LABEL } from '@/lib/admin-labels';

const NAV = [
  { label: 'Diretoria', href: '/admin/diretoria', icon: TrendingUp, match: '/admin/diretoria' },
  { label: 'Credores', href: '/admin/credores', icon: Building2, match: '/admin/credores' },
  { label: 'Usuários', href: '/admin/usuarios', icon: Users, match: '/admin/usuarios' },
];

function pageMeta(pathname: string): { title: string; subtitle: string; banner: string } {
  if (pathname.startsWith('/admin/diretoria')) {
    return {
      title: 'Diretoria',
      subtitle: 'Resultado consolidado de todos os credores',
      banner: 'Visão somada da carteira — envio, recebimento e efetividade de todos os credores.',
    };
  }
  if (pathname.startsWith('/admin/credores/novo')) {
    return {
      title: 'Novo credor',
      subtitle: 'Cadastro de credor na plataforma',
      banner: 'Preencha os dados para registrar um novo credor.',
    };
  }
  if (pathname.includes('/admin/credores/') && pathname.endsWith('/editar')) {
    return {
      title: 'Editar credor',
      subtitle: 'Atualizar dados do credor',
      banner: 'Atualize as informações do credor selecionado.',
    };
  }
  if (pathname.startsWith('/admin/credores')) {
    return {
      title: 'Credores',
      subtitle: 'Gestão de credores e chaveamento de clientes',
      banner: 'Cadastre credores e vincule códigos de cliente para consolidação da carteira.',
    };
  }
  if (pathname.startsWith('/admin/usuarios/novo')) {
    return {
      title: 'Novo usuário',
      subtitle: 'Cadastro de acesso ao painel',
      banner: 'Crie um novo acesso com credor e permissão definidos.',
    };
  }
  if (pathname.includes('/admin/usuarios/') && pathname.endsWith('/editar')) {
    return {
      title: 'Editar usuário',
      subtitle: 'Permissões e dados de acesso',
      banner: 'Altere permissões, status ou senha do usuário.',
    };
  }
  if (pathname.startsWith('/admin/usuarios')) {
    return {
      title: 'Usuários',
      subtitle: 'Contas ativas e hierarquia de acesso',
      banner: 'Gerencie logins, permissões e status de acesso ao painel.',
    };
  }
  return {
    title: 'Administração',
    subtitle: 'Painel gerencial da plataforma',
    banner: 'Central de gestão do Painel Gerencial Grupo ABE.',
  };
}

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [redirecionando, setRedirecionando] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  const meta = pageMeta(pathname);

  useEffect(() => {
    me()
      .then((u) => {
        if (!isSuperAdmin(u)) {
          setRedirecionando(true);
          router.replace('/dashboard');
          return;
        }
        setUser(u);
      })
      .catch(() => {
        setRedirecionando(true);
        router.replace('/login');
      })
      .finally(() => setCarregando(false));
  }, [router]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (carregando || redirecionando || !user) {
    return (
      <LoadingScreen message={redirecionando ? 'Redirecionando…' : 'Carregando administração…'} />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card transition-transform duration-300 ease-spring lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <Logo href="/admin/credores" />
          <button
            type="button"
            onClick={() => setMenuAberto(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Administração
          </p>
          {NAV.map((item) => {
            const active = pathname.startsWith(item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuAberto(false)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-soft'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <item.icon
                  className={`h-5 w-5 transition-transform duration-200 ${
                    active ? '' : 'group-hover:scale-110'
                  }`}
                />
                {item.label}
                {active && <ChevronRight className="ml-auto h-4 w-4" />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
            <UserAvatar nome={user.nome} fotoUrl={user.fotoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{user.nome}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              aria-label="Sair"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {menuAberto && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMenuAberto(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden min-w-0 flex-1 sm:block">
            <h1 className="truncate font-display text-lg font-semibold text-foreground">
              {meta.title}
            </h1>
            <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary sm:inline-flex">
              <Shield className="h-3 w-3" />
              {PAPEL_LABEL[user.papel] ?? user.papel}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main className="space-y-6 p-4 sm:p-6">
          <section className="bg-brand relative overflow-hidden rounded-3xl border border-primary-deep/40 p-6 shadow-card sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-20 [background-size:32px_32px]" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
            <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium text-primary-foreground/80">
                  <FormattedDate />
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold text-primary-foreground sm:text-3xl">
                  Olá, {user.nome.split(' ')[0]}
                </h2>
                <p className="mt-1 max-w-xl text-primary-foreground/85">{meta.banner}</p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium text-primary-foreground backdrop-blur">
                <Shield className="h-4 w-4" />
                Plataforma ABE
              </span>
            </div>
          </section>

          {children}
        </main>
      </div>
    </div>
  );
}
