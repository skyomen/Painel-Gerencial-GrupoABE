'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Loader2, MessageCircle, X } from 'lucide-react';

const WRAPPER =
  'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]';

const BOTAO =
  'pointer-events-auto flex w-fit items-center gap-2.5 rounded-2xl border border-border bg-card px-5 py-3.5 text-sm font-semibold text-foreground shadow-card transition-transform duration-200 ease-spring hover:scale-[1.02] motion-reduce:transition-none';

type Props = {
  label?: string;
  /** Painel pendurado acima do botão, visível só quando `aberto`. */
  painel?: ReactNode;
} & (
  | { href: string; aberto?: never; onToggle?: never; carregando?: never }
  | {
      href?: never;
      aberto: boolean;
      onToggle: () => void;
      /** Pergunta em andamento — mostra o spinner mesmo com o painel fechado. */
      carregando?: boolean;
    }
);

/**
 * Mini-dock fixo da assistente de IA — um único botão retangular (cantos
 * arredondados), com ícone e texto, minimizado, pendurado no centro-inferior
 * da tela. Toque expande o painel com o texto da pergunta (variante
 * `aberto`/`onToggle`+`painel`) ou navega até onde o chat existe (variante
 * `href`, para página sem o formulário embutido).
 *
 * Sem avatar por enquanto — usuário pediu para tirar a foto até decidir o
 * recorte definitivo (ver run 2026-11-12-widget-flutuante-assistente-ia).
 */
export function AssistenteFlutuante(props: Props) {
  const label = props.label ?? 'Precisa de ajuda?';

  return (
    <div className={WRAPPER}>
      <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-3">
        {props.aberto && props.painel}

        {props.href ? (
          <Link href={props.href} className={BOTAO} aria-label={label}>
            <MessageCircle className="h-5 w-5 flex-none text-primary" aria-hidden />
            {label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={props.onToggle}
            aria-expanded={props.aberto}
            className={BOTAO}
          >
            {props.carregando ? (
              <Loader2 className="h-5 w-5 flex-none animate-spin text-primary" aria-hidden />
            ) : props.aberto ? (
              <X className="h-5 w-5 flex-none" aria-hidden />
            ) : (
              <MessageCircle className="h-5 w-5 flex-none text-primary" aria-hidden />
            )}
            {props.carregando ? 'Consultando…' : props.aberto ? 'Fechar' : label}
          </button>
        )}
      </div>
    </div>
  );
}
