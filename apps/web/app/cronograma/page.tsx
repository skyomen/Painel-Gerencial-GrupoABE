'use client';

/**
 * Cronograma de desenvolvimento do Painel Gerencial — rota pública.
 *
 * Movida de `/admin/cronograma` para `/cronograma` por decisão do usuário:
 * qualquer pessoa com o link acessa, sem login nenhum (não é dado sensível,
 * é o histórico de desenvolvimento do próprio sistema).
 *
 * Porta o protótipo aprovado `docs/prototipos/cronograma-redesign.html`
 * (visão geral, quadro/linha do tempo/lista, modal de escopo) para dentro do
 * app, usando os tokens reais do design system (nunca cor fixa) e os padrões
 * reais de badge (`credores-table.tsx`) e modal (`credenciais-modal.tsx`).
 *
 * Como esta página não vive mais sob `/admin`, não tem o `AdminShell` ao
 * redor — o cabeçalho abaixo é mínimo e standalone (logo + título), em vez
 * do hero escuro que o `AdminShell` desenhava via `pageMeta()`.
 */

import { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Circle,
  Clock,
  Flag,
  GitCommit,
  LayoutGrid,
  ListTodo,
  X,
} from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import {
  CRONOGRAMA_ITENS,
  type CronogramaItem,
  type CronogramaStatus,
} from '@/lib/cronograma-itens';

const STATUS_INFO: Record<
  CronogramaStatus,
  { rotulo: string; badge: string; dot: string; icon: typeof Circle }
> = {
  FILA: {
    rotulo: 'Fila',
    badge: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
    icon: Clock,
  },
  EM_EXECUCAO: {
    rotulo: 'Em execução',
    badge: 'bg-primary/10 text-primary',
    dot: 'bg-primary',
    icon: Circle,
  },
  CONCLUIDO: {
    rotulo: 'Concluído',
    badge: 'bg-success/10 text-success',
    dot: 'bg-success',
    icon: CheckCircle2,
  },
  RECUSADO: { rotulo: 'Recusado', badge: 'bg-danger/10 text-danger', dot: 'bg-danger', icon: X },
};

const MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function fmtData(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Sao_Paulo',
  });
}

function rotuloMes(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${MESES_LONGOS[d.getMonth()]} de ${d.getFullYear()}`;
}

function itensAtivos(): CronogramaItem[] {
  return CRONOGRAMA_ITENS.filter((i) => i.status !== 'RECUSADO');
}

function StatusBadge({ status }: { status: CronogramaStatus }) {
  const s = STATUS_INFO[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${s.badge}`}
    >
      {s.rotulo}
    </span>
  );
}

function PrioridadeBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
      <Flag className="h-3 w-3" />
      Prioridade {n}
    </span>
  );
}

function EvidenciaLink({ item }: { item: CronogramaItem }) {
  if (!item.evidenciaCommit) return null;
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title="Link de evidência (placeholder — aponta para o commit real na versão de produção)"
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
    >
      <GitCommit className="h-3 w-3" />#{item.evidenciaCommit}
    </a>
  );
}

type View = 'board' | 'timeline' | 'table';
type SortCol = 'titulo' | 'status' | 'prioridade' | 'atualizadoEm';

const VIEW_TABS: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'Quadro', icon: LayoutGrid },
  { id: 'timeline', label: 'Linha do tempo', icon: Clock },
  { id: 'table', label: 'Lista', icon: ListTodo },
];

export default function CronogramaPage() {
  const [view, setView] = useState<View>('board');
  const [sortCol, setSortCol] = useState<SortCol>('atualizadoEm');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [itemAberto, setItemAberto] = useState<CronogramaItem | null>(null);

  const ativos = useMemo(() => itensAtivos(), []);
  const recusados = useMemo(() => CRONOGRAMA_ITENS.filter((i) => i.status === 'RECUSADO'), []);

  const total = ativos.length;
  const concluidos = ativos.filter((i) => i.status === 'CONCLUIDO').length;
  const emExecucao = ativos.filter((i) => i.status === 'EM_EXECUCAO').length;
  const fila = ativos.filter((i) => i.status === 'FILA').length;
  const pct = total ? Math.round((concluidos / total) * 100) : 0;
  const maisRecente = ativos.reduce<string | null>(
    (acc, i) => (!acc || i.atualizadoEm > acc ? i.atualizadoEm : acc),
    null,
  );

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const itensOrdenados = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...ativos].sort((a, b) => {
      if (sortCol === 'prioridade') {
        const av = a.prioridade ?? 999;
        const bv = b.prioridade ?? 999;
        return (av - bv) * dir;
      }
      const at = (a[sortCol] || '').toString().toLowerCase();
      const bt = (b[sortCol] || '').toString().toLowerCase();
      if (at < bt) return -1 * dir;
      if (at > bt) return 1 * dir;
      return 0;
    });
  }, [ativos, sortCol, sortDir]);

  const timelineItens = useMemo(
    () =>
      ativos
        .filter((i) => i.atualizadoEm)
        .slice()
        .sort((a, b) => (a.atualizadoEm < b.atualizadoEm ? 1 : -1)),
    [ativos],
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo href="/login" height={180} priority />
          <div className="text-right">
            <h1 className="font-display text-base font-semibold text-foreground sm:text-lg">
              Cronograma
            </h1>
            <p className="text-xs text-muted-foreground">Desenvolvimento do Painel Gerencial</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        {/* ===== Visão geral ===== */}
        <section className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Progresso geral
              </p>
              <p className="mt-2 font-display text-5xl font-extrabold tabular-nums text-foreground">
                {total ? `${pct}%` : '—'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {total ? `${concluidos} de ${total} itens concluídos` : 'Nenhum item ainda'}
              </p>

              <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-700 ease-out"
                  style={{ width: `${total ? pct : 0}%` }}
                />
              </div>
              {maisRecente && (
                <p className="mt-3 text-xs text-muted-foreground/80">
                  Atualizado em {fmtData(maisRecente)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <StatTile
                icon={CheckCircle2}
                rotulo="Concluído"
                n={concluidos}
                colorClass="text-success"
              />
              <StatTile
                icon={Circle}
                rotulo="Em execução"
                n={emExecucao}
                colorClass="text-primary"
              />
              <StatTile icon={Clock} rotulo="Na fila" n={fila} colorClass="text-muted-foreground" />
            </div>
          </div>
        </section>

        {/* ===== Painel principal ===== */}
        <section className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="inline-flex w-fit gap-0.5 rounded-xl border border-border bg-muted/50 p-1"
              role="tablist"
              aria-label="Tipo de visualização"
            >
              {VIEW_TABS.map((tab) => {
                const active = view === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setView(tab.id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-card text-primary shadow-soft'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-muted-foreground">
              {total} {total === 1 ? 'item' : 'itens'}
            </span>
          </div>

          {view === 'board' && (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(['FILA', 'EM_EXECUCAO', 'CONCLUIDO'] as CronogramaStatus[]).map((statusId) => {
                const lista = ativos
                  .filter((i) => i.status === statusId)
                  .sort((a, b) => {
                    if (statusId === 'FILA') return (a.prioridade ?? 99) - (b.prioridade ?? 99);
                    return a.atualizadoEm < b.atualizadoEm ? 1 : -1;
                  });
                return (
                  <div
                    key={statusId}
                    className="flex flex-col gap-2.5 rounded-2xl border border-border bg-muted/40 p-3"
                  >
                    <div className="flex items-center justify-between px-1 pb-1">
                      <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {STATUS_INFO[statusId].rotulo}
                      </h2>
                      <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                        {lista.length}
                      </span>
                    </div>

                    {lista.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        Nada aqui no momento.
                      </div>
                    ) : (
                      lista.map((item) => (
                        <button
                          key={item.titulo}
                          type="button"
                          onClick={() => setItemAberto(item)}
                          className="block w-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 shadow-soft transition-colors hover:border-primary/40">
                            <div className="flex items-start gap-2">
                              <span
                                className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ${STATUS_INFO[statusId].dot}`}
                                aria-hidden="true"
                              />
                              <p className="font-display text-[13.5px] font-semibold leading-snug text-foreground">
                                {item.titulo}
                              </p>
                            </div>
                            <p className="line-clamp-2 pl-[15px] text-[12.5px] leading-snug text-muted-foreground">
                              {item.descricao}
                            </p>
                            <div className="flex items-center justify-between gap-2 pl-[15px] pt-1">
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {item.atualizadoEm ? fmtData(item.atualizadoEm) : ''}
                              </span>
                              {item.evidenciaCommit ? (
                                <EvidenciaLink item={item} />
                              ) : item.prioridade != null ? (
                                <PrioridadeBadge n={item.prioridade} />
                              ) : null}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {view === 'timeline' && (
            <div className="mt-5">
              {timelineItens.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nada por aqui ainda.
                </div>
              ) : (
                <TimelineView itens={timelineItens} onAbrir={setItemAberto} />
              )}
            </div>
          )}

          {view === 'table' && (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <SortHeader
                      label="Item"
                      col="titulo"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      label="Status"
                      col="status"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      label="Prioridade"
                      col="prioridade"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      label="Atualizado"
                      col="atualizadoEm"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                    <th className="px-4 py-3 font-semibold">Evidência</th>
                  </tr>
                </thead>
                <tbody>
                  {itensOrdenados.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-xs text-muted-foreground"
                      >
                        Nada por aqui ainda.
                      </td>
                    </tr>
                  ) : (
                    itensOrdenados.map((item) => (
                      <tr
                        key={item.titulo}
                        className="border-b border-border last:border-0 hover:bg-muted/40"
                      >
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => setItemAberto(item)}
                            className="block w-full px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            <p className="font-display text-[13px] font-semibold text-foreground">
                              {item.titulo}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {item.descricao}
                            </p>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {item.prioridade != null ? item.prioridade : '—'}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {item.atualizadoEm ? fmtData(item.atualizadoEm) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {item.evidenciaCommit ? <EvidenciaLink item={item} /> : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ===== Itens recusados ===== */}
        {recusados.length > 0 && (
          <details className="rounded-3xl border border-border bg-card shadow-soft">
            <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-muted-foreground sm:px-6">
              Itens recusados
            </summary>
            <div className="flex flex-col gap-3 px-5 pb-5 sm:px-6">
              {recusados.map((item) => (
                <div
                  key={item.titulo}
                  className="border-t border-dashed border-border pt-3 text-[12.5px] text-muted-foreground first:border-0 first:pt-0"
                >
                  <b className="text-foreground">{item.titulo} </b>
                  {item.motivoRecusa ? `— ${item.motivoRecusa}` : ''}
                </div>
              ))}
            </div>
          </details>
        )}
      </main>

      {/* ===== Modal de escopo ===== */}
      {itemAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setItemAberto(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cronograma-modal-titulo"
            className="w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-card"
            style={{ maxHeight: '85vh' }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3
                id="cronograma-modal-titulo"
                className="font-display text-lg font-semibold text-foreground"
              >
                {itemAberto.titulo}
              </h3>
              <button
                type="button"
                onClick={() => setItemAberto(null)}
                aria-label="Fechar"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2">
              <StatusBadge status={itemAberto.status} />
              {itemAberto.prioridade != null && <PrioridadeBadge n={itemAberto.prioridade} />}
              {itemAberto.atualizadoEm && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {fmtData(itemAberto.atualizadoEm)}
                </span>
              )}
              <EvidenciaLink item={itemAberto} />
            </div>

            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Escopo
            </p>
            <div className="space-y-2.5 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-relaxed text-foreground">
              {(itemAberto.escopo || itemAberto.descricao || 'Sem escopo registrado ainda.')
                .split('\n')
                .filter((p) => p.trim())
                .map((par, i) => (
                  <p key={i}>{par}</p>
                ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setItemAberto(null)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  rotulo,
  n,
  colorClass,
}: {
  icon: typeof Circle;
  rotulo: string;
  n: number;
  colorClass: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-muted/40 p-3.5 sm:p-4">
      <Icon className={`h-[1.1rem] w-[1.1rem] ${colorClass}`} />
      <p className="font-display text-xl font-bold tabular-nums text-foreground sm:text-2xl">{n}</p>
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
    </div>
  );
}

function SortHeader({
  label,
  col,
  sortCol,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortCol;
  sortCol: SortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
}) {
  const active = sortCol === col;
  const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th className={`px-4 py-3 font-semibold ${active ? 'text-primary' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 hover:text-primary"
      >
        {label} <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function TimelineView({
  itens,
  onAbrir,
}: {
  itens: CronogramaItem[];
  onAbrir: (item: CronogramaItem) => void;
}) {
  let mesAtual: string | null = null;
  return (
    <div className="flex flex-col">
      {itens.map((item, i) => {
        const mes = rotuloMes(item.atualizadoEm);
        const mostrarMes = mes !== mesAtual;
        mesAtual = mes;
        const isLast = i === itens.length - 1;
        const StatusIcon = item.status === 'CONCLUIDO' ? CheckCircle2 : Circle;
        const dotColorClass =
          item.status === 'CONCLUIDO'
            ? 'border-success text-success'
            : item.status === 'EM_EXECUCAO'
              ? 'border-primary text-primary'
              : 'border-muted-foreground text-muted-foreground';

        return (
          <div key={item.titulo}>
            {mostrarMes && (
              <div className="pb-2 pl-9 pt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground first:pt-0">
                {mes}
              </div>
            )}
            <div className="flex gap-3">
              <div className="relative flex w-9 flex-none flex-col items-center">
                <div
                  className={`relative mt-1 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-card ${dotColorClass}`}
                >
                  {item.status === 'EM_EXECUCAO' && (
                    <span className="absolute -inset-[5px] animate-pulse-ring rounded-full bg-primary/35" />
                  )}
                  <StatusIcon className="relative h-3.5 w-3.5" />
                </div>
                {!isLast && <div className="w-px flex-1 bg-border" />}
              </div>

              <button
                type="button"
                onClick={() => onAbrir(item)}
                className="block flex-1 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <div className="flex-1 pb-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <b className="font-display text-[13.5px] font-semibold text-foreground">
                      {item.titulo}
                    </b>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {fmtData(item.atualizadoEm)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                    {item.descricao}
                  </p>
                  <div className="mt-2 flex items-center gap-2.5">
                    <StatusBadge status={item.status} />
                    {item.evidenciaCommit ? (
                      <EvidenciaLink item={item} />
                    ) : item.prioridade != null ? (
                      <PrioridadeBadge n={item.prioridade} />
                    ) : null}
                  </div>
                </div>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
