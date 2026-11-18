import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-surface/40">
      <div className="container flex flex-col items-center justify-between gap-6 py-10 sm:flex-row">
        <Logo href={null} height={220} />

        <p className="text-center text-sm text-muted-foreground sm:text-right">
          © {new Date().getFullYear()} Grupo ABE. Acesso restrito, monitorado e auditado.
          <br className="hidden sm:block" />
          <span className="text-muted-foreground/70">
            Desenvolvido por MK Solutions · Conforme LGPD
          </span>
        </p>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/login" className="transition-colors hover:text-foreground">
            Entrar
          </Link>
          <span className="h-4 w-px bg-border" />
          <a href="#seguranca" className="transition-colors hover:text-foreground">
            Privacidade
          </a>
        </div>
      </div>
    </footer>
  );
}
