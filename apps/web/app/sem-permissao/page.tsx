'use client';

import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

export default function SemPermissaoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <Logo href="/login" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-soft">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldOff className="h-6 w-6" />
          </span>
          <h1 className="mt-4 font-display text-xl font-semibold text-foreground">Sem permissão</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Você está autenticado, mas não tem acesso a esta área. Se acredita que isso é um erro,
            fale com o administrador da plataforma.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
            >
              Ir para o painel
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground"
            >
              Trocar de conta
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
