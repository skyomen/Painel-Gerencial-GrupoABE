'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { NavCredor } from '@/components/dashboard/nav-credor';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { UserAvatar } from '@/components/ui/user-avatar';
import { FormattedDate } from '@/components/ui/formatted-date';
import { logout, me, type AuthUser } from '@/lib/auth';
import { PAPEL_LABEL } from '@/lib/admin-labels';

/**
 * Chrome das telas internas do credor — o par de `AdminShell`, para o outro
 * lado do painel.
 *
 * `children` é função e não nó porque a página precisa do usuário já
 * autenticado (papel, nome, tenant) e um segundo `me()` dentro dela seria uma
 * segunda ida ao Supabase para saber o que o shell acabou de descobrir.
 *
 * `/dashboard` continua com o shell embutido na própria página: o header dela
 * carrega estado que só ela tem (origem do dado, hora da sincronização, prévia
 * de credor). O que estas duas telas não podem ter em duplicata é o MENU, e
 * esse mora em `nav-credor.tsx`, importado pelas duas.
 */
export function CredorShell({
  titulo,
  subtitulo,
  banner,
  headerSlot,
  children,
}: {
  titulo: string;
  subtitulo: string;
  /** Frase do cartão de boas-vindas, no mesmo lugar do `/dashboard`. */
  banner: string;
  /** Selo opcional do header (origem do dado, estado do agente…). */
  headerSlot?: ReactNode;
  children: (user: AuthUser) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [redirecionando, setRedirecionando] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    me()
      .then(setUser)
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
    return <LoadingScreen message={redirecionando ? 'Redirecionando…' : 'Carregando…'} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card transition-transform duration-300 ease-spring lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <Logo href="/dashboard" />
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
          <NavCredor pathname={pathname} onNavegar={() => setMenuAberto(false)} />
        </nav>

        <div className="space-y-3 border-t border-border p-4">
          <Link
            href="/dashboard"
            className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao painel
          </Link>
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

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold text-foreground">
              {titulo}
            </h1>
            <p className="truncate text-xs text-muted-foreground">{subtitulo}</p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {headerSlot}
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
                <p className="mt-1 max-w-xl text-primary-foreground/85">{banner}</p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium text-primary-foreground backdrop-blur">
                <ShieldCheck className="h-4 w-4" />
                {PAPEL_LABEL[user.papel] ?? user.papel}
              </span>
            </div>
          </section>

          {children(user)}
        </main>
      </div>
    </div>
  );
}
