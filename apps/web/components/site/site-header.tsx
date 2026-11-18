import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

const NAV = [
  { label: 'Visão 360º', href: '#visao' },
  { label: 'Recursos', href: '#recursos' },
  { label: 'Fontes', href: '#fontes' },
  { label: 'Segurança', href: '#seguranca' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Logo height={56} />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="relative rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="sheen group inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-300 hover:shadow-glow"
          >
            Acessar painel
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
