'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Eye,
  FileInput,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { isSuperAdmin, logout, me, type AuthUser } from '@/lib/auth';
import type { ApiError } from '@/lib/api-client';
import { fetchDashboard } from '@/lib/dashboard-api';
import {
  mergeOpcoesFiltro,
  normalizarFiltros,
  OPCOES_FILTRO_PADRAO,
} from '@/lib/dashboard-filters';
import { EMPTY_DASHBOARD_PAYLOAD } from '@/lib/dashboard-empty';
import {
  FILTROS_INICIAIS,
  type CredorPreview,
  type DashboardPayload,
  type FiltrosDashboard,
} from '@/lib/dashboard-types';
import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { FormattedDate } from '@/components/ui/formatted-date';
import { UserAvatar } from '@/components/ui/user-avatar';
import { GlobalFilters } from '@/components/dashboard/global-filters';
import { KpiSection } from '@/components/dashboard/kpi-section';
import { CarteiraDonut, ComposicaoAtores } from '@/components/dashboard/charts/carteira-charts';
import {
  AnaliseGeografica,
  EfetividadeIdadeChart,
  EnviadoRecebidoChart,
  FaixaIdadeChart,
} from '@/components/dashboard/charts/periodo-charts';
import { AcordosTable, BaixasTable } from '@/components/dashboard/detail-tables';

const NAV = [
  { label: 'Visão geral', icon: LayoutDashboard, active: true },
  { label: 'Carteira', icon: Wallet },
  { label: 'Busca de devedor', icon: Search },
  { label: 'Relatórios', icon: BarChart3 },
  { label: 'Usuários', icon: Users },
  { label: 'Configurações', icon: Settings },
];

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingScreen message="Carregando seu painel…" />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** Prévia do painel de um credor — só o SUPER_ADMIN consegue usar (API valida). */
  const credorIdParam = searchParams.get('credorId');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [redirecionando, setRedirecionando] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosDashboard>(FILTROS_INICIAIS);
  const [dados, setDados] = useState<DashboardPayload>(EMPTY_DASHBOARD_PAYLOAD);
  const [fonte, setFonte] = useState<'abeweb' | 'vazio'>('vazio');
  const [sincronizadoEm, setSincronizadoEm] = useState<string | null>(null);
  const [carregandoDados, setCarregandoDados] = useState(false);
  const [opcoesFiltro, setOpcoesFiltro] = useState(OPCOES_FILTRO_PADRAO);
  const [credorPreview, setCredorPreview] = useState<CredorPreview | null>(null);
  /**
   * Datas que a API resolveu (mín. inclusão → hoje) quando o usuário não escolheu nenhuma.
   * Ficam FORA de `filtros` de propósito: gravá-las lá disparava uma segunda busca
   * em toda abertura do painel, porque o efeito depende de `filtros`.
   */
  const [datasAplicadas, setDatasAplicadas] = useState<{
    dataInicio: string;
    dataFinal: string;
  } | null>(null);

  /** A tela responde na hora; a busca espera o usuário parar de mexer. */
  const filtrosBusca = useDebouncedValue(filtros, 350);

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => {
        setRedirecionando(true);
        router.replace('/login');
      })
      .finally(() => setCarregando(false));
  }, [router]);

  /** Credor só vê o próprio painel: o parâmetro é ignorado fora do SUPER_ADMIN. */
  const credorId = user && isSuperAdmin(user) ? credorIdParam : null;
  const emPrevia = Boolean(credorId);

  useEffect(() => {
    if (!user) return;

    let cancelado = false;
    setCarregandoDados(true);

    fetchDashboard(filtrosBusca, credorId)
      .then((res) => {
        if (cancelado) return;
        setDados(res.payload);
        setFonte(res.fonte);
        setSincronizadoEm(res.sincronizadoEm);
        setCredorPreview(res.credorPreview ?? null);
        setDatasAplicadas(res.filtrosAplicados ?? null);

        const opcoes = mergeOpcoesFiltro(res.payload);
        setOpcoesFiltro(opcoes);

        // Só corrige seleção que deixou de existir no snapshot (ex.: UF que sumiu do lote).
        setFiltros((prev) => {
          const patch = normalizarFiltros(prev, opcoes);
          return Object.keys(patch).length ? { ...prev, ...patch } : prev;
        });
      })
      .catch(() => {
        if (cancelado) return;
        setDados(EMPTY_DASHBOARD_PAYLOAD);
        setFonte('vazio');
        setSincronizadoEm(null);
        setCredorPreview(null);
      })
      .finally(() => {
        if (!cancelado) setCarregandoDados(false);
      });

    return () => {
      cancelado = true;
    };
  }, [user, filtrosBusca, credorId]);

  async function handleLogout() {
    try {
      await logout();
    } catch (err) {
      void (err as ApiError);
    } finally {
      router.replace('/login');
    }
  }

  function atualizarFiltros(patch: Partial<FiltrosDashboard>) {
    setFiltros((prev) => ({ ...prev, ...patch }));
  }

  /** Data vazia significa "use o padrão"; nos campos mostramos o que a API resolveu. */
  const filtrosExibidos = useMemo<FiltrosDashboard>(
    () => ({
      ...filtros,
      dataInicio: filtros.dataInicio || datasAplicadas?.dataInicio || '',
      dataFinal: filtros.dataFinal || datasAplicadas?.dataFinal || '',
    }),
    [filtros, datasAplicadas],
  );

  /** Usuário mexeu e a busca ainda não saiu — o painel na tela é o de antes. */
  const buscaPendente = filtros !== filtrosBusca;

  if (carregando || redirecionando || !user) {
    return (
      <LoadingScreen message={redirecionando ? 'Redirecionando…' : 'Carregando seu painel…'} />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card transition-transform duration-300 ease-spring lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <Logo href="/dashboard" />
          <button
            type="button"
            onClick={() => setMenuAberto(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Menu
          </p>
          {NAV.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                item.active
                  ? 'bg-primary text-primary-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <item.icon
                className={`h-5 w-5 transition-transform duration-200 ${
                  item.active ? '' : 'group-hover:scale-110'
                }`}
              />
              {item.label}
              {item.active && <ChevronRight className="ml-auto h-4 w-4" />}
            </button>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-4">
          {emPrevia && (
            <Link
              href="/admin/credores"
              className="flex w-full items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar para credores
            </Link>
          )}
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
            <UserAvatar nome={user.nome} fotoUrl={user.fotoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{user.nome}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              aria-label="Sair"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {menuAberto && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* CONTEÚDO */}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMenuAberto(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden min-w-0 flex-1 sm:block">
            <h1 className="truncate font-display text-lg font-semibold text-foreground">
              {emPrevia
                ? (credorPreview?.razaoSocial ?? 'Painel do credor')
                : 'Dashboard Inteligente'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {emPrevia
                ? 'Prévia — exatamente o que o credor vê ao entrar'
                : 'Visão 360º · ABE · AvantPay · Acordo Seguro'}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                fonte === 'abeweb'
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-muted-foreground/30 bg-muted text-muted-foreground'
              }`}
            >
              <Radio className={`h-3 w-3 ${fonte === 'abeweb' ? 'animate-pulse' : ''}`} />
              {fonte === 'abeweb'
                ? sincronizadoEm
                  ? `ABE WEB · ${new Date(sincronizadoEm).toLocaleString('pt-BR')}`
                  : 'ABE WEB'
                : 'Aguardando sincronização'}
            </span>
            {(carregandoDados || buscaPendente) && (
              <span className="text-xs text-muted-foreground">Atualizando…</span>
            )}
            <ThemeToggle />
          </div>
        </header>

        <main className="space-y-6 p-4 sm:p-6">
          {emPrevia && (
            <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-sm text-foreground">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  Você está vendo o painel de{' '}
                  <strong className="font-semibold">
                    {credorPreview?.razaoSocial ?? 'credor selecionado'}
                  </strong>{' '}
                  como o credor vê. Somente leitura.
                </span>
              </p>
              <Link
                href="/admin/credores"
                className="inline-flex w-fit shrink-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Sair da prévia
              </Link>
            </section>
          )}

          {/* Boas-vindas */}
          <section className="bg-brand relative overflow-hidden rounded-3xl border border-primary-deep/40 p-6 shadow-card sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-20 [background-size:32px_32px]" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
            <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium text-primary-foreground/80">
                  <FormattedDate />
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold text-primary-foreground sm:text-3xl">
                  {emPrevia
                    ? (credorPreview?.razaoSocial ?? 'Painel do credor')
                    : `Olá, ${user.nome.split(' ')[0]}`}
                </h2>
                <p className="mt-1 max-w-xl text-primary-foreground/85">
                  Panorama consolidado da carteira — do borderô recebido à efetividade por UF.
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium text-primary-foreground backdrop-blur">
                {emPrevia ? <Eye className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {emPrevia ? 'Visão do credor' : papelLabel(user.papel)}
              </span>
            </div>
          </section>

          {/* Filtros globais */}
          <GlobalFilters
            filtros={filtrosExibidos}
            opcoesCodCliente={opcoesFiltro.codCliente}
            opcoesLote={opcoesFiltro.lote}
            opcoesUf={opcoesFiltro.uf}
            datasDisponiveis={dados.meta?.datasBordero}
            onChange={atualizarFiltros}
          />

          {fonte === 'vazio' && (
            <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
              <p className="font-display text-lg font-semibold text-foreground">
                Nenhum dado sincronizado ainda
              </p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                {emPrevia
                  ? 'Este credor ainda não tem carteira sincronizada com o ABE WEB. Confira os códigos de cliente no cadastro e aguarde a próxima sincronização.'
                  : 'Os indicadores aparecerão aqui após a primeira sincronização com o ABE WEB. Se você acabou de receber acesso, aguarde alguns minutos ou entre em contato com o suporte.'}
              </p>
            </section>
          )}

          {/* Borderô */}
          <KpiSection
            titulo="Recebimento do credor (Borderô)"
            subtitulo="Valor enviado, processos e idade média no envio"
            icon={FileInput}
            kpis={dados.kpiBordero}
          />

          <KpiSection
            titulo="Resultado financeiro"
            subtitulo="ABE vs pagamento direto · efetividade geral"
            icon={TrendingUp}
            kpis={dados.kpiFinanceiro}
          />

          <KpiSection
            titulo="Carteira ativa em negociação"
            subtitulo="Processos em tratativa e ticket médio"
            icon={Handshake}
            kpis={dados.kpiCarteiraAtiva}
          />

          <section className="grid gap-4 lg:grid-cols-2">
            <CarteiraDonut segmentos={dados.carteiraRosca} />
            <ComposicaoAtores atores={dados.composicaoAtores} />
          </section>

          {/* Gráficos período */}
          <section className="grid gap-4 lg:grid-cols-2">
            <EnviadoRecebidoChart dados={dados.enviadoRecebidoMensal} />
            <EfetividadeIdadeChart dados={dados.efetividadePorIdade} />
          </section>

          <FaixaIdadeChart dados={dados.faixaIdadeComparativo} />

          {/* Tabelas acordos + baixas */}
          <section className="grid gap-4 lg:grid-cols-2">
            <AcordosTable linhas={dados.tabelaAcordos} />
            <BaixasTable linhas={dados.tabelaBaixas} />
          </section>

          {/* Geográfico */}
          <AnaliseGeografica dados={dados.metricasUf} />
        </main>
      </div>
    </div>
  );
}

function papelLabel(papel: string): string {
  const map: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN_CREDOR: 'Admin do Credor',
    OPERADOR: 'Operador',
    VIEWER: 'Visualizador',
  };
  return map[papel] ?? papel;
}
