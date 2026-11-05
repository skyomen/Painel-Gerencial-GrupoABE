'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import {
  BarChart3,
  LayoutDashboard,
  Search,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * O menu do credor, em um lugar só.
 *
 * Antes ele era um array dentro de `app/dashboard/page.tsx`. Com a segunda tela
 * do credor (`/dashboard/relatorios`) o array passaria a existir duas vezes, e
 * dois menus que deveriam ser o mesmo divergem no dia em que alguém mexe num
 * deles — o item novo aparece numa tela e some na outra, sem erro nenhum.
 *
 * `href: null` é o item previsto e ainda não construído. Ele continua visível,
 * como estava, mas não finge navegar: quem clica não é levado a um 404.
 */
export interface ItemNavCredor {
  label: string;
  icon: LucideIcon;
  /** `null` enquanto a tela não existir. */
  href: string | null;
}

export const NAV_CREDOR: ItemNavCredor[] = [
  { label: 'Visão geral', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Carteira', icon: Wallet, href: null },
  { label: 'Busca de devedor', icon: Search, href: null },
  { label: 'Relatórios', icon: BarChart3, href: '/dashboard/relatorios' },
  { label: 'Usuários', icon: Users, href: null },
  { label: 'Configurações', icon: Settings, href: null },
];

/**
 * `/dashboard` só fica ativo na raiz: sem isto, `startsWith` deixaria "Visão
 * geral" aceso também em `/dashboard/relatorios`, com dois itens realçados.
 */
function estaAtivo(href: string | null, pathname: string): boolean {
  if (!href) return false;
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname.startsWith(href);
}

const BASE =
  'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200';
const ATIVO = 'bg-primary text-primary-foreground shadow-soft';
const INATIVO = 'text-muted-foreground hover:bg-muted hover:text-foreground';

export function NavCredor({
  pathname,
  onNavegar,
}: {
  pathname: string;
  /** Fecha a gaveta no celular depois do clique. */
  onNavegar?: () => void;
}) {
  return (
    <>
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Menu
      </p>
      {NAV_CREDOR.map((item) => {
        const ativo = estaAtivo(item.href, pathname);
        const classe = `${BASE} ${ativo ? ATIVO : INATIVO}`;
        const icone = (
          <item.icon
            className={`h-5 w-5 transition-transform duration-200 ${
              ativo ? '' : 'group-hover:scale-110'
            }`}
          />
        );

        if (!item.href) {
          return (
            <button
              key={item.label}
              type="button"
              disabled
              aria-disabled="true"
              title="Em breve"
              className={`${classe} cursor-default`}
            >
              {icone}
              {item.label}
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide opacity-60">
                Em breve
              </span>
            </button>
          );
        }

        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavegar}
            aria-current={ativo ? 'page' : undefined}
            className={classe}
          >
            {icone}
            {item.label}
            {ativo && <ChevronRight className="ml-auto h-4 w-4" />}
          </Link>
        );
      })}
    </>
  );
}
