'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import {
  Download,
  Filter,
  History,
  Loader2,
  MapPin,
  Send,
  Sparkles,
  Calendar,
  FileText,
} from 'lucide-react';
import { CredorShell } from '@/components/dashboard/credor-shell';
import { FilterField, selectClass, inputClass } from '@/components/dashboard/global-filters';
import { KpiSection } from '@/components/dashboard/kpi-section';
/**
 * O Recharts sozinho pesa mais que o resto desta tela inteira, e a tela abre
 * numa caixa de pergunta — o gráfico só existe depois da primeira resposta.
 * Carregá-lo sob demanda tira ~130 kB do caminho de abertura.
 */
const GraficoResposta = dynamic(
  () => import('@/components/relatorios/grafico-resposta').then((m) => m.GraficoResposta),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-border bg-surface sm:h-72">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    ),
  },
);
import { LoadingScreen } from '@/components/ui/loading-screen';
import { toApiError, type ApiError } from '@/lib/api-client';
import { isSuperAdmin, type AuthUser } from '@/lib/auth';
import { UFS_BR } from '@/lib/estado-uf';
import {
  listarPerguntasRecentes,
  perguntarRelatorio,
  MAX_CARACTERES_PERGUNTA,
  type ContextoPergunta,
  type PerguntaRecente,
  type RespostaPergunta,
} from '@/lib/relatorios-api';
import { nomeArquivoCsv, tabelaParaCsv } from '@/lib/relatorios-visualizacao';

/**
 * Construtor de Relatórios com IA — a tela do credor.
 *
 * Implementa `docs/prototipos/relatorios-com-ia.html` (protótipo validado em
 * 2026-11-04 e congelado como especificação). Duas diferenças deliberadas em
 * relação a ele, e as duas porque o protótipo tinha dado fictício:
 *
 * 1. O gráfico é genérico por tipo de relatório (DEC-0071) — "Carteira ativa"
 *    chega por UF, não como evolução mensal.
 * 2. O filtro "Empresa / filial" do protótipo não existe: o credor é resolvido
 *    pelo servidor a partir da sessão e não é escolha de tela. No lugar dele
 *    ficam período e UF, que o contrato da rota de fato aceita.
 *
 * O período fica vazio de propósito: quem decide a janela padrão é a rota
 * (mês corrente mais cinco). Repetir a conta aqui criaria uma segunda definição
 * de "últimos seis meses", e as duas discordariam em todo primeiro dia do mês.
 */
export default function RelatoriosPage() {
  return (
    <Suspense fallback={<LoadingScreen message="Carregando relatórios…" />}>
      <RelatoriosContent />
    </Suspense>
  );
}

/** Uma sugestão por tipo do catálogo — todas respondíveis hoje, nenhuma promessa. */
const SUGESTOES = [
  'Quanto da minha carteira ainda está em aberto?',
  'Quanto foi enviado para cobrança nos últimos meses?',
  'Como estão os acordos fechados?',
  'Quais títulos foram devolvidos e por qual motivo?',
  'Compare o enviado e o recebido mês a mês',
  'Em que faixa de idade da dívida a cobrança rende mais?',
];

interface FiltrosConsulta {
  inicio: string;
  fim: string;
  uf: string;
}

const FILTROS_INICIAIS: FiltrosConsulta = {
  inicio: '',
  fim: '',
  uf: 'todos',
};

function RelatoriosContent() {
  const searchParams = useSearchParams();
  const credorIdParam = searchParams.get('credorId');

  return (
    <CredorShell
      titulo="Relatórios"
      subtitulo="Pergunte em português — a IA monta a tabela e o gráfico"
      banner="Pergunte em português o que você quer ver — a IA monta a tabela, o gráfico e a explicação, sempre com os mesmos dados e cálculos do seu painel."
    >
      {(user) => <Construtor user={user} credorIdParam={credorIdParam} />}
    </CredorShell>
  );
}

function Construtor({ user, credorIdParam }: { user: AuthUser; credorIdParam: string | null }) {
  /** Prévia de credor é política de suporte do SUPER_ADMIN; a API valida de novo. */
  const credorId = isSuperAdmin(user) ? credorIdParam : null;

  const [filtros, setFiltros] = useState<FiltrosConsulta>(FILTROS_INICIAIS);
  const [pergunta, setPergunta] = useState('');
  const [perguntando, setPerguntando] = useState(false);
  const [resultado, setResultado] = useState<RespostaPergunta | null>(null);
  const [erro, setErro] = useState<ApiError | null>(null);
  const [recentes, setRecentes] = useState<PerguntaRecente[]>([]);

  /**
   * Valor mais recente de `filtros`, sem depender do `useCallback` abaixo
   * recriar a função a cada digitação — `carregarRecentes` só recria quando
   * `credorId` muda, então o `filtros` fechado nela ficaria velho.
   */
  const filtrosRef = useRef(filtros);
  useEffect(() => {
    filtrosRef.current = filtros;
  }, [filtros]);

  /**
   * Aplica o intervalo de datas real do credor uma única vez, na primeira
   * resposta do histórico que chegar — e só se o usuário ainda não tiver
   * tocado nos campos de data. Depois disso a escolha é dele.
   */
  const jaAplicouIntervaloRef = useRef(false);

  const carregarRecentes = useCallback(() => {
    listarPerguntasRecentes(credorId)
      .then((r) => {
        setRecentes(r.perguntas);

        if (jaAplicouIntervaloRef.current) return;
        jaAplicouIntervaloRef.current = true;

        const aindaIntocado =
          filtrosRef.current.inicio === FILTROS_INICIAIS.inicio &&
          filtrosRef.current.fim === FILTROS_INICIAIS.fim;
        const { inicio, fim } = r.intervaloDisponivel;

        if (aindaIntocado && (inicio || fim)) {
          atualizarFiltros({ inicio: inicio ?? '', fim: fim ?? '' });
        }
      })
      // O histórico é apoio: falhar nele não pode apagar a resposta na tela.
      .catch(() => setRecentes([]));
  }, [credorId]);

  useEffect(carregarRecentes, [carregarRecentes]);

  function atualizarFiltros(patch: Partial<FiltrosConsulta>) {
    setFiltros((prev) => ({ ...prev, ...patch }));
  }

  async function enviar(texto: string) {
    const limpo = texto.trim();
    if (!limpo || perguntando) return;

    setPerguntando(true);
    setErro(null);

    const contexto: ContextoPergunta = {};
    if (filtros.inicio || filtros.fim) {
      contexto.periodo = {
        ...(filtros.inicio ? { inicio: filtros.inicio } : {}),
        ...(filtros.fim ? { fim: filtros.fim } : {}),
      };
    }
    if (filtros.uf !== 'todos') contexto.uf = filtros.uf;

    try {
      setResultado(await perguntarRelatorio({ pergunta: limpo, contexto, credorId }));
      carregarRecentes();
    } catch (err) {
      setErro(toApiError(err));
    } finally {
      setPerguntando(false);
    }
  }

  return (
    <>
      {/* Filtros da consulta */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Filtros da consulta</h2>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FilterField
            label="Data início"
            icon={Calendar}
            hint="Em branco: o padrão do servidor (mês atual e os cinco anteriores)"
          >
            <input
              type="date"
              value={filtros.inicio}
              max={filtros.fim || undefined}
              onChange={(e) => atualizarFiltros({ inicio: e.target.value })}
              className={inputClass}
            />
          </FilterField>

          <FilterField label="Data final" icon={Calendar} hint="Em branco: até hoje">
            <input
              type="date"
              value={filtros.fim}
              min={filtros.inicio || undefined}
              onChange={(e) => atualizarFiltros({ fim: e.target.value })}
              className={inputClass}
            />
          </FilterField>

          <FilterField label="UF" icon={MapPin} hint="Recorte por estado do devedor">
            <select
              value={filtros.uf}
              onChange={(e) => atualizarFiltros({ uf: e.target.value })}
              className={selectClass}
            >
              <option value="todos">Todas as UFs</option>
              {UFS_BR.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
      </section>

      {/* Composer */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-start gap-2">
          <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">
              O que você quer ver?
            </h2>
            <p className="text-xs text-muted-foreground">
              A IA só enxerga os dados da sua carteira — nunca os de outro credor.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(pergunta);
          }}
        >
          <input
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            maxLength={MAX_CARACTERES_PERGUNTA}
            disabled={perguntando}
            aria-label="Sua pergunta"
            placeholder="Ex.: quanto da minha carteira ainda está em aberto?"
            className="flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground shadow-soft outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={perguntando || pergunta.trim() === ''}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-deep disabled:opacity-60"
          >
            {perguntando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {perguntando ? 'Consultando…' : 'Perguntar'}
          </button>
        </form>

        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {pergunta.length}/{MAX_CARACTERES_PERGUNTA} caracteres
        </p>

        <ul className="mt-3 flex flex-wrap gap-2">
          {SUGESTOES.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setPergunta(s)}
                disabled={perguntando}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {erro && <BlocoErro erro={erro} />}

      {resultado && <BlocoResposta resultado={resultado} />}

      {!resultado && !erro && !perguntando && (
        <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            Nenhuma pergunta nesta sessão
          </p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Escreva o que você quer ver, ou use uma das sugestões acima. A resposta traz o número, a
            tabela, o gráfico e a fonte do cálculo.
          </p>
        </section>
      )}

      <BlocoHistorico perguntas={recentes} />
    </>
  );
}

function BlocoErro({ erro }: { erro: ApiError }) {
  const detalhes = erro.detalhes ?? erro.errors ?? [];

  return (
    <section
      role="alert"
      className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
    >
      <p className="font-semibold">{erro.title}</p>
      {detalhes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {detalhes.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {erro.codigo === 'PLANO_INVALIDO' && (
        <p className="mt-2 text-xs">
          Reformule citando um dos relatórios do catálogo: carteira ativa, borderô, acordos, baixas,
          posição mensal ou classificação por idade.
        </p>
      )}
    </section>
  );
}

function BlocoResposta({ resultado }: { resultado: RespostaPergunta }) {
  const { resposta, plano } = resultado;
  const { transparencia, tabela } = resposta;

  function baixarCsv() {
    const blob = new Blob(['﻿', tabelaParaCsv(tabela)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivoCsv(plano.tipoRelatorio);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="text-sm leading-relaxed text-foreground">{resposta.textoResposta}</p>
      </div>

      <KpiSection
        hideHeader
        kpis={resposta.cards.map((c) => ({ rotulo: c.label, valor: c.valor }))}
      />

      <GraficoResposta
        tipoRelatorio={plano.tipoRelatorio}
        serie={resposta.serieGrafico}
        titulo={transparencia.periodo}
      />

      {/* A tabela rola dentro do próprio quadro; a página nunca rola de lado.
          Sem o `min-w`, no celular cada valor em R$ quebra em três linhas. */}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {tabela.colunas.map((coluna) => (
                <th key={coluna} scope="col" className="px-4 py-2.5 font-semibold">
                  {coluna}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabela.linhas.length === 0 ? (
              <tr className="border-t border-border">
                <td
                  colSpan={Math.max(tabela.colunas.length, 1)}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  Sem linhas neste recorte.
                </td>
              </tr>
            ) : (
              tabela.linhas.map((linha, i) => (
                <tr key={i} className="border-t border-border">
                  {linha.map((celula, j) => (
                    <td key={j} className="px-4 py-2.5 tabular-nums text-foreground">
                      {celula ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={baixarCsv}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
        {/*
          Excel e PDF ficam visíveis e desligados: estão no protótipo e na
          conversa do usuário, e nenhum dos dois tem backend ainda. Um botão que
          parece pronto e não faz nada custa mais que um que avisa.
        */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex cursor-default items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground opacity-60"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar Excel (em breve)
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex cursor-default items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground opacity-60"
        >
          <FileText className="h-3.5 w-3.5" />
          Gerar PDF de apresentação (em breve)
        </button>
      </div>

      <details className="rounded-xl border border-border bg-muted/60 px-4 py-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
          Como a IA chegou nesse número
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Fonte: <code className="tabular-nums">{transparencia.fonte}</code> — a mesma função que o
          dashboard usa; a IA nunca recalcula por conta própria. Credor: {transparencia.credor}.
          Período: {transparencia.periodo}. Sistemas: {transparencia.sistemas}.{' '}
          {transparencia.aviso}
        </p>
      </details>
    </section>
  );
}

const STATUS_CLASSE: Record<string, string> = {
  OK: 'border-success/30 bg-success/10 text-success',
  REJEITADO: 'border-warning/30 bg-warning/10 text-warning',
  ERRO: 'border-danger/30 bg-danger/10 text-danger',
};

function BlocoHistorico({ perguntas }: { perguntas: PerguntaRecente[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" />
        Perguntas recentes
      </h3>

      {perguntas.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nenhuma pergunta registrada ainda.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {perguntas.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-1 rounded-xl px-3 py-2 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="min-w-0 truncate text-foreground">{p.perguntaTexto}</span>
              <span className="flex flex-none items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={`rounded-full border px-2 py-0.5 font-medium ${
                    STATUS_CLASSE[p.status] ?? 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {p.status}
                </span>
                <span className="tabular-nums">
                  {p.usuarioNome ? `${p.usuarioNome} · ` : ''}
                  {new Date(p.criadoEm).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
