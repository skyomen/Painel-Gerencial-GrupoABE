'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AtorComposicao, RoscaItem } from '@/lib/dashboard-types';

export function CarteiraDonut({ segmentos = [] }: { segmentos?: RoscaItem[] }) {
  if (!segmentos.length) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="mb-5">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Visão geral da carteira
          </h3>
          <p className="text-sm text-muted-foreground">Distribuição percentual consolidada</p>
        </div>
        <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      </div>
    );
  }

  const total = segmentos.reduce((s, i) => s + i.pct, 0);
  let acumulado = 0;

  const partes = segmentos.map((item) => {
    const inicio = acumulado;
    acumulado += item.pct;
    return { ...item, inicio, fim: acumulado };
  });

  const gradiente = partes.map((s) => `${s.cor} ${s.inicio}% ${s.fim}%`).join(', ');

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-5">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Visão geral da carteira
        </h3>
        <p className="text-sm text-muted-foreground">Distribuição percentual consolidada</p>
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div
          className="relative h-44 w-44 shrink-0 rounded-full"
          style={{
            background: `conic-gradient(${gradiente})`,
          }}
          role="img"
          aria-label={`Carteira: ${total}% distribuída`}
        >
          <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-card text-center">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="font-display text-lg font-bold text-foreground">100%</span>
          </div>
        </div>

        <ul className="grid flex-1 gap-2 sm:grid-cols-2">
          {segmentos.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.cor }}
              />
              <span className="text-foreground">{item.label}</span>
              <span className="ml-auto font-semibold tabular-nums text-foreground">
                {item.pct}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ComposicaoAtores({ atores = [] }: { atores?: AtorComposicao[] }) {
  const [expandido, setExpandido] = useState<string | null>(null);

  if (!atores.length) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="mb-5">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Composição por ator
          </h3>
          <p className="text-sm text-muted-foreground">
            ABE consolida Delphi + ABE Web · clique para detalhar
          </p>
        </div>
        <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-5">
        <h3 className="font-display text-lg font-semibold text-foreground">Composição por ator</h3>
        <p className="text-sm text-muted-foreground">
          ABE consolida Delphi + ABE Web · clique para detalhar
        </p>
      </div>

      <div className="space-y-3">
        {atores.map((ator) => {
          const aberto = expandido === ator.id;
          return (
            <div key={ator.id} className="rounded-xl border border-border bg-surface/50">
              <button
                type="button"
                onClick={() => setExpandido(aberto ? null : ator.id)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                  <img src={ator.logo} alt="" className="h-5 w-5 object-contain" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{ator.nome}</p>
                  <p className="text-xs text-muted-foreground">{ator.descricao}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-foreground">{ator.valor}</p>
                  <p className="text-xs text-muted-foreground">{ator.pct}%</p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    aberto ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {aberto && ator.detalhe && (
                <div className="border-t border-border px-4 py-3 text-sm">
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">ABE Delphi</span>
                    <span className="font-medium text-foreground">{ator.detalhe.delphi}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">ABE Web</span>
                    <span className="font-medium text-foreground">{ator.detalhe.web}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
