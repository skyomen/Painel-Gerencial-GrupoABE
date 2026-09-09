'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileInput, Handshake, Loader2, TrendingUp } from 'lucide-react';
import { apiFetch, toApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { EMPTY_DASHBOARD_PAYLOAD } from '@/lib/dashboard-empty';
import { KpiSection } from '@/components/dashboard/kpi-section';
import { CarteiraDonut, ComposicaoAtores } from '@/components/dashboard/charts/carteira-charts';
import {
  AnaliseGeografica,
  EfetividadeIdadeChart,
  EnviadoRecebidoChart,
  FaixaIdadeChart,
} from '@/components/dashboard/charts/periodo-charts';
import { AcordosTable, BaixasTable } from '@/components/dashboard/detail-tables';
import { FiltrosDiretoria } from '@/components/diretoria/filtros-diretoria';
import { BotaoSync } from '@/components/admin/botao-sync';
import type { DiretoriaFiltros, DiretoriaResponse } from '@/lib/diretoria-types';

/**
 * A mesma tela do dashboard, somando todos os credores.
 *
 * Os componentes são exatamente os do painel do credor — nenhum deles sabe se
 * está desenhando um credor ou a soma de todos. É isso que impede as duas
 * telas de divergirem com o tempo.
 */

function periodoPadrao(): { de: string; ate: string } {
  const ano = new Date().getFullYear();
  return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
}

export default function DiretoriaPage() {
  const [filtros, setFiltros] = useState<DiretoriaFiltros>({
    credorIds: [],
    uf: 'todos',
    ...periodoPadrao(),
  });
  const [resposta, setResposta] = useState<DiretoriaResponse | null>(null);
  const [carregandoInicial, setCarregandoInicial] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A tela responde na hora; a busca espera o usuário parar de mexer.
  const filtrosBusca = useDebouncedValue(filtros, 350);

  const carregar = useCallback(async (f: DiretoriaFiltros) => {
    setErro(null);
    setBuscando(true);

    const params = new URLSearchParams({ uf: f.uf, de: f.de, ate: f.ate });
    // Repetido, não separado por vírgula: razão social não entra na URL, mas
    // o formato repetido é o que o URLSearchParams devolve sem ambiguidade.
    for (const id of f.credorIds) params.append('credorIds', id);

    try {
      setResposta(await apiFetch<DiretoriaResponse>(`/diretoria?${params.toString()}`));
    } catch (err) {
      setErro(toApiError(err).title);
    } finally {
      setBuscando(false);
      setCarregandoInicial(false);
    }
  }, []);

  useEffect(() => {
    carregar(filtrosBusca);
  }, [carregar, filtrosBusca]);

  if (carregandoInicial) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (erro) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {erro}
      </p>
    );
  }

  const dados = resposta?.payload ?? EMPTY_DASHBOARD_PAYLOAD;
  const escolhidos = resposta?.credores.filter((c) => filtros.credorIds.includes(c.id)) ?? [];

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            {escolhidos.length === 0
              ? 'Todos os credores'
              : escolhidos.length === 1
                ? escolhidos[0]!.razaoSocial
                : `${escolhidos.length} credores selecionados`}
          </h2>
          <p className="text-xs text-muted-foreground">
            {escolhidos.length === 0
              ? 'Soma de todos os credores sincronizados'
              : escolhidos.length === 1
                ? 'Recorte de um credor — os mesmos indicadores do painel dele'
                : // Nomear quem entrou na conta: um total sem a lista deixa a
                  // dúvida sobre quais credores foram somados.
                  `Somando: ${escolhidos.map((c) => c.razaoSocial).join(', ')}`}
            {resposta?.maisAntigoSincronizadoEm && (
              <>
                {' · '}
                {/* A idade do consolidado é a do credor mais atrasado. */}
                sincronização mais antiga em{' '}
                {new Date(resposta.maisAntigoSincronizadoEm).toLocaleString('pt-BR')}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {buscando && <span className="text-xs text-muted-foreground">Atualizando…</span>}
          <BotaoSync onConcluido={() => carregar(filtrosBusca)} />
        </div>
      </div>

      <FiltrosDiretoria
        filtros={filtros}
        credores={resposta?.credores ?? []}
        opcoesUf={resposta?.opcoesUf ?? []}
        onChange={(patch) => setFiltros((prev) => ({ ...prev, ...patch }))}
      />

      {resposta && !resposta.temAgregados && (
        <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            Nenhum agregado calculado ainda
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            As tabelas de agregado se preenchem no próximo sync — o ETL chama{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">refresh_agregados_credor</code>{' '}
            ao terminar cada credor. Rode{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">pnpm sync:abeweb</code> e
            recarregue.
          </p>
        </section>
      )}

      {/* Daqui para baixo é literalmente a tela do credor. */}
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

      <section className="grid gap-4 lg:grid-cols-2">
        <EnviadoRecebidoChart dados={dados.enviadoRecebidoMensal} />
        <EfetividadeIdadeChart dados={dados.efetividadePorIdade} />
      </section>

      <FaixaIdadeChart dados={dados.faixaIdadeComparativo} />

      <section className="grid gap-4 lg:grid-cols-2">
        <AcordosTable linhas={dados.tabelaAcordos} />
        <BaixasTable linhas={dados.tabelaBaixas} />
      </section>

      <AnaliseGeografica dados={dados.metricasUf} />
    </>
  );
}
