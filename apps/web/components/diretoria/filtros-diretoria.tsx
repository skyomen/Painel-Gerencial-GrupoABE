'use client';

import { Building2, Calendar, Filter, MapPin } from 'lucide-react';
import type { DiretoriaCredorOpcao, DiretoriaFiltros } from '@/lib/diretoria-types';
import { SelecaoCredores } from '@/components/diretoria/selecao-credores';

/**
 * Filtros da diretoria. O de credor é o que diferencia esta tela da do credor:
 * vazio mostra todos somados, escolhido isola um.
 *
 * Numa linha só, acima dos gráficos.
 */
export function FiltrosDiretoria({
  filtros,
  credores,
  opcoesUf,
  onChange,
}: {
  filtros: DiretoriaFiltros;
  credores: DiretoriaCredorOpcao[];
  opcoesUf: string[];
  onChange: (patch: Partial<DiretoriaFiltros>) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Filter className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Filtros</h2>
        <span className="text-xs text-muted-foreground">
          {filtros.credorIds.length === 0
            ? `Somando ${credores.length} credores`
            : filtros.credorIds.length === 1
              ? 'Mostrando 1 credor'
              : `Somando ${filtros.credorIds.length} de ${credores.length} credores`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Credor" icon={Building2}>
          <SelecaoCredores
            credores={credores}
            selecionados={filtros.credorIds}
            onChange={(credorIds) => onChange({ credorIds })}
          />
        </Campo>

        <Campo label="Data inicial" icon={Calendar}>
          <input
            type="date"
            value={filtros.de}
            onChange={(e) => onChange({ de: e.target.value })}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </Campo>

        <Campo label="Data final" icon={Calendar}>
          <input
            type="date"
            value={filtros.ate}
            onChange={(e) => onChange({ ate: e.target.value })}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </Campo>

        <Campo label="Estado" icon={MapPin}>
          <select
            value={filtros.uf}
            onChange={(e) => onChange({ uf: e.target.value })}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="todos">Todos os estados</option>
            {opcoesUf.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </Campo>
      </div>
    </section>
  );
}

function Campo({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Filter;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
    </label>
  );
}
