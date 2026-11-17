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
 * As 5 interações novas da visão Quadro vêm do protótipo aprovado
 * `docs/prototipos/cronograma-fila-interativa.html` — referência exata de
 * comportamento: botão Atualizar com hora real, rótulo "Em desenvolvimento",
 * "+" para adicionar item ao fim da fila, arrastar para reordenar a fila e
 * colapsar/expandir cada coluna. O dado agora vem de `/api/cronograma`
 * (ver `lib/cronograma-itens.ts`), não mais de um array estático.
 *
 * Como esta página não vive mais sob `/admin`, não tem o `AdminShell` ao
 * redor — o cabeçalho abaixo é mínimo e standalone (logo + título), em vez
 * do hero escuro que o `AdminShell` desenhava via `pageMeta()`.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
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
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import {
  type CronogramaItem,
  type CronogramaPrioridadeDesejada,
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
    rotulo: 'Em desenvolvimento',
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

const PRIORIDADE_DESEJADA_ROTULO: Record<CronogramaPrioridadeDesejada, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
};

/** Colunas do quadro — RECUSADO fica numa seção própria, fora do quadro. */
const COLUNAS_QUADRO: CronogramaStatus[] = ['FILA', 'EM_EXECUCAO', 'CONCLUIDO'];

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

function fmtHora(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rotuloMes(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${MESES_LONGOS[d.getMonth()]} de ${d.getFullYear()}`;
}

async function fetchCronograma(): Promise<CronogramaItem[]> {
  const res = await fetch('/api/cronograma');
  if (!res.ok) throw new Error(`Não foi possível carregar o cronograma (${res.status}).`);
  const data = await res.json();
  return Array.isArray(data?.itens) ? (data.itens as CronogramaItem[]) : [];
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

function PrioridadeDesejadaBadge({ valor }: { valor: CronogramaPrioridadeDesejada }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
      <Flag className="h-3 w-3" />
      Prioridade desejada: {PRIORIDADE_DESEJADA_ROTULO[valor]}
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

  // ----- Carregamento dos dados (interação 1 cobre o refresh manual) -----
  const [itens, setItens] = useState<CronogramaItem[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const novos = await fetchCronograma();
        if (!cancelado) {
          setItens(novos);
          setErroCarregar(null);
        }
      } catch (e) {
        if (!cancelado) {
          setErroCarregar(
            e instanceof Error ? e.message : 'Não foi possível carregar o cronograma.',
          );
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function handleAtualizar() {
    setAtualizando(true);
    try {
      const novos = await fetchCronograma();
      setItens(novos);
      setErroCarregar(null);
      setUltimaAtualizacao(new Date());
    } catch (e) {
      setErroCarregar(e instanceof Error ? e.message : 'Não foi possível atualizar o cronograma.');
    } finally {
      setAtualizando(false);
    }
  }

  // ----- Colapsar/expandir colunas do quadro (interação 5) -----
  const [colunaColapsada, setColunaColapsada] = useState<Record<CronogramaStatus, boolean>>({
    FILA: false,
    EM_EXECUCAO: false,
    CONCLUIDO: false,
    RECUSADO: false,
  });
  function alternarColuna(statusId: CronogramaStatus) {
    setColunaColapsada((prev) => ({ ...prev, [statusId]: !prev[statusId] }));
  }

  // ----- Arrastar para reordenar a fila (interação 4) -----
  const draggedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverBefore, setDragOverBefore] = useState(true);

  async function patchFilaOrdem(ids: string[]) {
    try {
      const res = await fetch('/api/cronograma/fila-ordem', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error('fila-ordem respondeu com erro');
    } catch {
      // Resync simples com o servidor — sem retry nem fila de novas tentativas.
      try {
        const novos = await fetchCronograma();
        setItens(novos);
      } catch {
        // Mantém o estado local otimista; a próxima atualização manual tenta de novo.
      }
    }
  }

  function reordenarFila(movidoId: string, alvoId: string, antesDoAlvo: boolean) {
    setItens((prev) => {
      if (!prev) return prev;
      const fila = prev
        .filter((i) => i.status === 'FILA')
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      const outros = prev.filter((i) => i.status !== 'FILA');
      const movido = fila.find((i) => i.id === movidoId);
      if (!movido) return prev;

      const semMovido = fila.filter((i) => i.id !== movidoId);
      const alvoIdx = semMovido.findIndex((i) => i.id === alvoId);
      if (alvoIdx === -1) semMovido.push(movido);
      else semMovido.splice(antesDoAlvo ? alvoIdx : alvoIdx + 1, 0, movido);

      const novaFila = semMovido.map((item, idx) => ({ ...item, ordem: idx + 1 }));
      void patchFilaOrdem(novaFila.map((i) => i.id));
      return [...novaFila, ...outros];
    });
  }

  // ----- Modal "Adicionar à fila" (interação 3) -----
  const [addModalAberto, setAddModalAberto] = useState(false);
  const [addTitulo, setAddTitulo] = useState('');
  const [addDescricao, setAddDescricao] = useState('');
  const [addEscopo, setAddEscopo] = useState('');
  const [addPrioridade, setAddPrioridade] = useState<CronogramaPrioridadeDesejada | ''>('');
  const [addEnviando, setAddEnviando] = useState(false);
  const [addErro, setAddErro] = useState<string | null>(null);

  function abrirAddModal() {
    setAddTitulo('');
    setAddDescricao('');
    setAddEscopo('');
    setAddPrioridade('');
    setAddErro(null);
    setAddModalAberto(true);
  }
  function fecharAddModal() {
    setAddModalAberto(false);
    setAddErro(null);
  }

  async function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    const titulo = addTitulo.trim();
    const descricao = addDescricao.trim();
    if (!titulo || !descricao) return;

    setAddEnviando(true);
    setAddErro(null);
    try {
      const res = await fetch('/api/cronograma/itens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo,
          descricao,
          escopo: addEscopo.trim() || undefined,
          prioridadeDesejada: addPrioridade || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAddErro(
          (data && typeof data.error === 'string' && data.error) ||
            'Não foi possível adicionar o item.',
        );
        return;
      }
      const novoItem = data?.item as CronogramaItem | undefined;
      if (novoItem) {
        setItens((prev) => (prev ? [...prev, novoItem] : [novoItem]));
      }
      setAddModalAberto(false);
    } catch {
      setAddErro('Não foi possível adicionar o item. Verifique sua conexão.');
    } finally {
      setAddEnviando(false);
    }
  }

  // ----- Dados derivados -----
  const ativos = useMemo(() => (itens ?? []).filter((i) => i.status !== 'RECUSADO'), [itens]);
  const recusados = useMemo(() => (itens ?? []).filter((i) => i.status === 'RECUSADO'), [itens]);

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

  const aindaSemDados = carregando && !itens;
  const falhaSemDados = !carregando && !itens && erroCarregar;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo href="/login" height={220} priority />
          <div className="text-right">
            <h1 className="font-display text-base font-semibold text-foreground sm:text-lg">
              Cronograma
            </h1>
            <p className="text-xs text-muted-foreground">Desenvolvimento do Painel Gerencial</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        {aindaSemDados ? (
          <section className="flex items-center justify-center gap-2 rounded-3xl border border-border bg-card p-10 text-sm text-muted-foreground shadow-soft">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando cronograma...
          </section>
        ) : falhaSemDados ? (
          <section className="flex flex-col items-center gap-3 rounded-3xl border border-danger/30 bg-danger/10 p-10 text-center text-sm text-danger shadow-soft">
            <p>{erroCarregar}</p>
            <button
              type="button"
              onClick={handleAtualizar}
              disabled={atualizando}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary/40 hover:text-primary disabled:cursor-default disabled:opacity-75"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? 'animate-spin' : ''}`} />
              Tentar de novo
            </button>
          </section>
        ) : (
          <>
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
                    rotulo="Em desenvolvimento"
                    n={emExecucao}
                    colorClass="text-primary"
                  />
                  <StatTile
                    icon={Clock}
                    rotulo="Na fila"
                    n={fila}
                    colorClass="text-muted-foreground"
                  />
                </div>
              </div>
            </section>

            {erroCarregar && (
              <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs text-danger">
                {erroCarregar}
              </p>
            )}

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

                {/* Interação 1: Atualizar + "Última atualização" */}
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs text-muted-foreground">
                      {total} {total === 1 ? 'item' : 'itens'}
                    </span>
                    <button
                      type="button"
                      onClick={handleAtualizar}
                      disabled={atualizando}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-default disabled:opacity-75"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? 'animate-spin' : ''}`} />
                      {atualizando ? 'Atualizando...' : 'Atualizar'}
                    </button>
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground/80">
                    {ultimaAtualizacao
                      ? `Última atualização: ${fmtHora(ultimaAtualizacao)}`
                      : 'Última atualização: —'}
                  </span>
                </div>
              </div>

              {view === 'board' && (
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {COLUNAS_QUADRO.map((statusId) => {
                    const lista = ativos
                      .filter((i) => i.status === statusId)
                      .sort((a, b) => {
                        if (statusId === 'FILA') return (a.ordem ?? 0) - (b.ordem ?? 0);
                        return a.atualizadoEm < b.atualizadoEm ? 1 : -1;
                      });
                    const colapsada = colunaColapsada[statusId];

                    return (
                      <div
                        key={statusId}
                        className="flex flex-col gap-2.5 rounded-2xl border border-border bg-muted/40 p-3"
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={!colapsada}
                          onClick={() => alternarColuna(statusId)}
                          onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              alternarColuna(statusId);
                            }
                          }}
                          className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-1 py-1 hover:bg-card/60"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <ChevronDown
                              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                                colapsada ? '-rotate-90' : ''
                              }`}
                            />
                            <h2 className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                              {STATUS_INFO[statusId].rotulo}
                            </h2>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                              {lista.length}
                            </span>
                            {statusId === 'FILA' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  abrirAddModal();
                                }}
                                aria-label="Adicionar item à fila"
                                title="Adicionar item à fila"
                                className="inline-flex h-[1.65rem] w-[1.65rem] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-transform hover:scale-105 hover:opacity-90"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {!colapsada &&
                          (lista.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                              Nada aqui no momento.
                            </div>
                          ) : statusId === 'FILA' ? (
                            lista.map((item) => (
                              <FilaCard
                                key={item.id}
                                item={item}
                                isDragging={draggingId === item.id}
                                dragOverPosition={
                                  dragOverId === item.id
                                    ? dragOverBefore
                                      ? 'before'
                                      : 'after'
                                    : null
                                }
                                draggedRef={draggedRef}
                                onDragStartItem={() => setDraggingId(item.id)}
                                onDragEndItem={() => {
                                  setDraggingId(null);
                                  setDragOverId(null);
                                }}
                                onDragOverItem={(antes) => {
                                  setDragOverId(item.id);
                                  setDragOverBefore(antes);
                                }}
                                onDragLeaveItem={() => {
                                  setDragOverId((cur) => (cur === item.id ? null : cur));
                                }}
                                onDropItem={() => {
                                  const movidoId = draggingId;
                                  const antes = dragOverBefore;
                                  setDragOverId(null);
                                  if (movidoId && movidoId !== item.id) {
                                    reordenarFila(movidoId, item.id, antes);
                                  }
                                }}
                                isAnyDragging={draggingId !== null}
                                onAbrir={() => setItemAberto(item)}
                              />
                            ))
                          ) : (
                            lista.map((item) => (
                              <button
                                key={item.id}
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
                          ))}
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
                            key={item.id}
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
                      key={item.id}
                      className="border-t border-dashed border-border pt-3 text-[12.5px] text-muted-foreground first:border-0 first:pt-0"
                    >
                      <b className="text-foreground">{item.titulo} </b>
                      {item.motivoRecusa ? `— ${item.motivoRecusa}` : ''}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
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
              {itemAberto.prioridadeDesejada && (
                <PrioridadeDesejadaBadge valor={itemAberto.prioridadeDesejada} />
              )}
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

      {/* ===== Interação 3: modal "Adicionar à fila" (mesmo estilo do modal de escopo) ===== */}
      {addModalAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharAddModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-modal-titulo"
            className="w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-card"
            style={{ maxHeight: '85vh' }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3
                id="add-modal-titulo"
                className="font-display text-lg font-semibold text-foreground"
              >
                Adicionar item à fila
              </h3>
              <button
                type="button"
                onClick={fecharAddModal}
                aria-label="Fechar"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="add-titulo"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Título
                </label>
                <input
                  id="add-titulo"
                  type="text"
                  value={addTitulo}
                  onChange={(e) => setAddTitulo(e.target.value)}
                  placeholder="Ex.: Exportar relatório em PDF"
                  required
                  maxLength={120}
                  className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary/60 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="add-descricao"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Descrição curta
                </label>
                <input
                  id="add-descricao"
                  type="text"
                  value={addDescricao}
                  onChange={(e) => setAddDescricao(e.target.value)}
                  placeholder="Resumo de uma linha para o card"
                  required
                  maxLength={160}
                  className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary/60 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="add-escopo"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Escopo
                </label>
                <textarea
                  id="add-escopo"
                  value={addEscopo}
                  onChange={(e) => setAddEscopo(e.target.value)}
                  placeholder="O que é a tarefa e como deve ser feita — aparece no modal do item depois de criado."
                  className="min-h-[4.5rem] w-full resize-y rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary/60 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="add-prioridade"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Prioridade desejada{' '}
                  <span className="normal-case font-normal tracking-normal text-muted-foreground/70">
                    (opcional — só um registro visual, não muda a posição)
                  </span>
                </label>
                <select
                  id="add-prioridade"
                  value={addPrioridade}
                  onChange={(e) =>
                    setAddPrioridade(e.target.value as CronogramaPrioridadeDesejada | '')
                  }
                  className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary/60 focus:outline-none"
                >
                  <option value="">Sem preferência</option>
                  <option value="BAIXA">Baixa</option>
                  <option value="MEDIA">Média</option>
                  <option value="ALTA">Alta</option>
                </select>
              </div>

              <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
                O item entra sempre no <b className="text-foreground">fim da coluna Fila</b>,
                independente da prioridade escolhida acima. Para mudar a posição, arraste o card
                depois de criado.
              </p>

              {addErro && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {addErro}
                </p>
              )}

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={fecharAddModal}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={addEnviando}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-default disabled:opacity-75"
                >
                  {addEnviando ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Adicionar à fila
                </button>
              </div>
            </form>
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

/**
 * Card da coluna FILA — arrastável (interação 4). O clique abre o modal de
 * escopo, mas só quando não houve um drag de verdade: `draggedRef` vira
 * `true` no dragstart e é consumido (resetado) no click, igual ao protótipo.
 */
function FilaCard({
  item,
  isDragging,
  isAnyDragging,
  dragOverPosition,
  draggedRef,
  onDragStartItem,
  onDragEndItem,
  onDragOverItem,
  onDragLeaveItem,
  onDropItem,
  onAbrir,
}: {
  item: CronogramaItem;
  isDragging: boolean;
  isAnyDragging: boolean;
  dragOverPosition: 'before' | 'after' | null;
  draggedRef: MutableRefObject<boolean>;
  onDragStartItem: () => void;
  onDragEndItem: () => void;
  onDragOverItem: (antesDoAlvo: boolean) => void;
  onDragLeaveItem: () => void;
  onDropItem: () => void;
  onAbrir: () => void;
}) {
  // Feedback imediato ao pressionar o mouse — antes mesmo do dragstart nativo
  // disparar (ou mesmo que não chegue a disparar, num clique normal).
  const [pressionando, setPressionando] = useState(false);

  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      data-id={item.id}
      onMouseDown={() => setPressionando(true)}
      onMouseUp={() => setPressionando(false)}
      onDragStart={(e) => {
        draggedRef.current = true;
        setPressionando(false);
        try {
          e.dataTransfer.setData('text/plain', item.id);
        } catch {
          // alguns navegadores restringem setData fora de certos contextos — ok ignorar
        }
        e.dataTransfer.effectAllowed = 'move';
        onDragStartItem();
      }}
      onDragEnd={() => {
        setPressionando(false);
        onDragEndItem();
      }}
      onDragOver={(e) => {
        if (!isAnyDragging || isDragging) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverItem(e.clientY - rect.top < rect.height / 2);
      }}
      onDragLeave={onDragLeaveItem}
      onDrop={(e) => {
        e.preventDefault();
        onDropItem();
      }}
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onAbrir();
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAbrir();
        }
      }}
      className={`relative flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card p-3.5 shadow-soft transition-[transform,box-shadow,border-color,opacity] duration-150 ease-spring hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        isDragging
          ? 'cursor-grabbing opacity-60 shadow-card outline outline-2 outline-dashed outline-primary/50 motion-safe:scale-[1.03] motion-safe:-rotate-1'
          : pressionando
            ? 'shadow-card motion-safe:scale-[1.015]'
            : ''
      } ${dragOverPosition === 'before' ? 'shadow-[inset_0_2px_0_0_hsl(var(--primary))]' : ''} ${
        dragOverPosition === 'after' ? 'shadow-[inset_0_-2px_0_0_hsl(var(--primary))]' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ${STATUS_INFO.FILA.dot}`}
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
        {item.prioridadeDesejada && <PrioridadeDesejadaBadge valor={item.prioridadeDesejada} />}
      </div>
    </div>
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
          <div key={item.id}>
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
