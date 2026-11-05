'use client';

import type { LucideIcon } from 'lucide-react';
import { Calendar, Filter, MapPin, Package, User } from 'lucide-react';
import type { DashboardPayload, FiltrosDashboard, OpcaoFiltro } from '@/lib/dashboard-types';
import { defaultDataInicioIso, isoToBr, todayIso } from '@/lib/bordero-lote';

interface GlobalFiltersProps {
  filtros: FiltrosDashboard;
  opcoesCodCliente: OpcaoFiltro[];
  opcoesLote: OpcaoFiltro[];
  opcoesUf: OpcaoFiltro[];
  datasDisponiveis?: NonNullable<DashboardPayload['meta']>['datasBordero'];
  onChange: (patch: Partial<FiltrosDashboard>) => void;
}

export function GlobalFilters({
  filtros,
  opcoesCodCliente,
  opcoesLote,
  opcoesUf,
  datasDisponiveis,
  onChange,
}: GlobalFiltersProps) {
  const lotesMes = opcoesLote.filter((o) => o.value === 'todos' || o.grupo === 'mes');
  const lotesDia = opcoesLote.filter((o) => o.grupo === 'dia');

  const minLabel =
    datasDisponiveis?.min ?? (datasDisponiveis?.minIso ? isoToBr(datasDisponiveis.minIso) : null);
  const maxInclusao = datasDisponiveis?.maxInclusaoIso
    ? isoToBr(datasDisponiveis.maxInclusaoIso)
    : (datasDisponiveis?.max ??
      (datasDisponiveis?.maxIso ? isoToBr(datasDisponiveis.maxIso) : null));
  const maxRepasse = datasDisponiveis?.maxRepasseIso
    ? isoToBr(datasDisponiveis.maxRepasseIso)
    : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Filtros globais</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Borderô = Data Inclusão no intervalo · Recebido = Data Repasse no intervalo · padrão:{' '}
          {isoToBr(defaultDataInicioIso())} → hoje
          {minLabel && maxInclusao
            ? maxRepasse && maxRepasse !== maxInclusao
              ? ` · envios ${minLabel}–${maxInclusao}, repasses até ${maxRepasse}`
              : minLabel === maxInclusao
                ? ` · envios em ${minLabel}`
                : ` · envios ${minLabel}–${maxInclusao}`
            : ''}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FilterField
          label="Código cliente"
          icon={User}
          hint="Matriz ou filial do grupo — use Todos para consolidar"
        >
          <select
            value={filtros.codCliente}
            onChange={(e) => onChange({ codCliente: e.target.value })}
            className={selectClass}
          >
            {opcoesCodCliente.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField
          label="Data início"
          icon={Calendar}
          hint={`Padrão: ${isoToBr(defaultDataInicioIso())} · filtra pela Data Inclusão da consulta`}
        >
          <input
            type="date"
            value={filtros.dataInicio}
            max={filtros.dataFinal || todayIso()}
            onChange={(e) => onChange({ dataInicio: e.target.value })}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="Data final" icon={Calendar} hint="Padrão: hoje">
          <input
            type="date"
            value={filtros.dataFinal}
            min={filtros.dataInicio || defaultDataInicioIso()}
            max={todayIso()}
            onChange={(e) => onChange({ dataFinal: e.target.value })}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="Lote de envio" icon={Package}>
          <select
            value={filtros.loteEnvio}
            onChange={(e) => onChange({ loteEnvio: e.target.value })}
            className={selectClass}
          >
            {lotesMes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {lotesDia.length > 0 && (
              <optgroup label="Por dia">
                {lotesDia.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </FilterField>

        <FilterField
          label="Estado (UF)"
          icon={MapPin}
          hint="Filtra borderô e recebimentos por UF do devedor"
        >
          <select
            value={filtros.uf}
            onChange={(e) => onChange({ uf: e.target.value })}
            className={selectClass}
          >
            {opcoesUf.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FilterField>
      </div>
    </section>
  );
}

/**
 * Exportado para a tela de relatórios usar o MESMO campo de filtro.
 * Dois campos parecidos em duas telas da mesma área divergem na primeira
 * mexida, e o usuário lê isso como "é outra coisa".
 */
export function FilterField({
  label,
  icon: Icon,
  hint,
  children,
}: {
  label: string;
  icon: LucideIcon;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/15';

export const selectClass =
  'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/15';
