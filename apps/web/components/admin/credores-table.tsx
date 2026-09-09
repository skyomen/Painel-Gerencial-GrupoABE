'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { LayoutDashboard, Pencil, Search, UserX, X } from 'lucide-react';
import { SortableTableHead } from '@/components/admin/sortable-table-head';
import { TablePagination } from '@/components/admin/table-pagination';
import { useDataTable } from '@/hooks/use-data-table';
import type { Credor } from '@/lib/admin-api';
import { buildGrupoCodigos } from '@/lib/credor-codigos';
import { formatCnpj } from '@/lib/admin-labels';
import { type CredorQuickFilter, filterCredores } from '@/lib/credor-search';

const PAGE_SIZE = 25;
const thBase = 'px-4 py-3.5';
const tdBase = 'px-4 py-3.5 align-middle';

type CredorSortKey = 'razaoSocial' | 'cnpj' | 'codigos' | 'responsavel' | 'cidade' | 'status';

const QUICK_FILTERS: { id: CredorQuickFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'com-responsavel', label: 'Com responsável' },
  { id: 'sem-responsavel', label: 'Sem responsável' },
];

function getCredorSortValue(c: Credor, key: CredorSortKey): string | number {
  switch (key) {
    case 'razaoSocial':
      return c.razaoSocial;
    case 'cnpj':
      return Number(c.cnpj?.replace(/\D/g, '') || 0);
    case 'codigos':
      return Number(c.codClientePrincipal ?? c.abeDelphiClienteId ?? 0);
    case 'responsavel':
      return c.responsavel?.nome ?? c.responsavel?.email ?? 'zzz';
    case 'cidade':
      return c.cidade && c.estado ? `${c.cidade}/${c.estado}` : '';
    case 'status':
      return c.tenantStatus;
  }
}

export function CredoresTable({ credores }: { credores: Credor[] }) {
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<CredorQuickFilter>('todos');

  const filtered = useMemo(
    () => filterCredores(credores, query, quickFilter),
    [credores, query, quickFilter],
  );

  const { rows, page, totalPages, total, from, to, setPage, sortKey, sortDir, toggleSort } =
    useDataTable(filtered, getCredorSortValue, PAGE_SIZE, [query, quickFilter]);

  const isFiltering = query.trim().length > 0 || quickFilter !== 'todos';

  if (credores.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center shadow-soft">
        <p className="text-sm font-medium text-foreground">Nenhum credor cadastrado</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Clique em &quot;Novo credor&quot; para cadastrar o primeiro.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="space-y-3 border-b border-border bg-muted/20 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, CNPJ, código, e-mail, cidade…"
              className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-10 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              aria-label="Buscar credores"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className="shrink-0 text-xs text-muted-foreground lg:text-right">
            {isFiltering ? (
              <>
                <span className="font-medium tabular-nums text-foreground">{total}</span> de{' '}
                <span className="tabular-nums">{credores.length}</span> credores
              </>
            ) : (
              <>
                <span className="tabular-nums">{credores.length}</span> credores cadastrados
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map(({ id, label }) => {
            const active = quickFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setQuickFilter(id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="text-sm font-medium text-foreground">Nenhum credor encontrado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tente outro termo ou remova os filtros.
          </p>
          {isFiltering && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setQuickFilter('todos');
              }}
              className="mt-4 text-sm font-medium text-primary hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <SortableTableHead
                    label="Códigos"
                    align="left"
                    active={sortKey === 'codigos'}
                    direction={sortKey === 'codigos' ? sortDir : null}
                    onSort={() => toggleSort('codigos', 'number')}
                  />
                  <SortableTableHead
                    label="Credor"
                    align="left"
                    active={sortKey === 'razaoSocial'}
                    direction={sortKey === 'razaoSocial' ? sortDir : null}
                    onSort={() => toggleSort('razaoSocial', 'text')}
                  />
                  <SortableTableHead
                    label="CNPJ"
                    align="center"
                    active={sortKey === 'cnpj'}
                    direction={sortKey === 'cnpj' ? sortDir : null}
                    onSort={() => toggleSort('cnpj', 'number')}
                  />
                  <SortableTableHead
                    label="Responsável"
                    align="left"
                    active={sortKey === 'responsavel'}
                    direction={sortKey === 'responsavel' ? sortDir : null}
                    onSort={() => toggleSort('responsavel', 'text')}
                  />
                  <SortableTableHead
                    label="Cidade/UF"
                    align="center"
                    active={sortKey === 'cidade'}
                    direction={sortKey === 'cidade' ? sortDir : null}
                    onSort={() => toggleSort('cidade', 'text')}
                  />
                  <SortableTableHead
                    label="Status"
                    align="center"
                    active={sortKey === 'status'}
                    direction={sortKey === 'status' ? sortDir : null}
                    onSort={() => toggleSort('status', 'text')}
                  />
                  <th className={`${thBase} text-center font-semibold`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, index) => (
                  <tr
                    key={c.id}
                    className={`border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40 ${
                      index % 2 === 1 ? 'bg-muted/10' : ''
                    }`}
                  >
                    <td className={`${tdBase} text-left`}>
                      <CodigosCell credor={c} />
                    </td>
                    <td className={`${tdBase} text-left`}>
                      <p className="font-medium leading-snug text-foreground">{c.razaoSocial}</p>
                      {c.nomeFantasia && c.nomeFantasia !== c.razaoSocial && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{c.nomeFantasia}</p>
                      )}
                    </td>
                    <td
                      className={`${tdBase} text-center tabular-nums text-foreground whitespace-nowrap`}
                    >
                      {formatCnpj(c.cnpj)}
                    </td>
                    <td className={`${tdBase} text-left`}>
                      <ResponsavelCell credor={c} />
                    </td>
                    <td className={`${tdBase} text-center text-foreground whitespace-nowrap`}>
                      {c.cidade && c.estado ? `${c.cidade}/${c.estado}` : '—'}
                    </td>
                    <td className={`${tdBase} text-center`}>
                      <StatusBadge status={c.tenantStatus} />
                    </td>
                    <td className={`${tdBase} text-center`}>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Link
                          href={`/dashboard?credorId=${encodeURIComponent(c.id)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/15"
                          title={`Ver o painel de ${c.razaoSocial} como o credor vê`}
                        >
                          <LayoutDashboard className="h-3.5 w-3.5" />
                          Ver dashboard
                        </Link>
                        <Link
                          href={`/admin/credores/${c.id}/editar`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={total}
            from={from}
            to={to}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            itemLabelSingular="credor"
            itemLabelPlural="credores"
          />
        </>
      )}
    </div>
  );
}

function CodigosCell({ credor }: { credor: Credor }) {
  const grupo = buildGrupoCodigos(credor);
  const filiais = grupo.web.filiais.length + grupo.delphi.filiais.length;

  if (grupo.totalCodigos === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {grupo.web.matriz && (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          <span className="text-[10px] uppercase opacity-70">WEB</span>
          <span className="tabular-nums">{grupo.web.matriz}</span>
          <span className="text-[10px] opacity-80" title="Código principal">
            ★
          </span>
        </span>
      )}
      {grupo.delphi.matriz && (
        <span className="inline-flex items-start gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          <span className="text-[10px] uppercase opacity-70">Delphi</span>
          <span className="tabular-nums">{grupo.delphi.matriz}</span>
          <span className="text-[10px] opacity-80" title="Código principal">
            ★
          </span>
        </span>
      )}
      {filiais > 0 && (
        <span className="text-[11px] text-muted-foreground">+{filiais} filial(is)</span>
      )}
    </div>
  );
}

function ResponsavelCell({ credor }: { credor: Credor }) {
  if (credor.responsavel) {
    return (
      <div>
        <p className="font-medium text-foreground">{credor.responsavel.nome}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{credor.responsavel.email}</p>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
      <UserX className="h-3 w-3" />
      Pendente
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ativo = status === 'ATIVO';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
        ativo ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
      }`}
    >
      {ativo ? 'Ativo' : status}
    </span>
  );
}
