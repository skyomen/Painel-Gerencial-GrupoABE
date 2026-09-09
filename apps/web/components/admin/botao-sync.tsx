'use client';

import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, CloudDownload, Loader2, RefreshCw } from 'lucide-react';
import { apiFetch, toApiError, type ApiError } from '@/lib/api-client';

/**
 * Atualizar os dados do painel.
 *
 * São duas operações diferentes, e misturá-las num botão só levaria alguém a
 * clicar em "atualizar", ver "pronto" e concluir que os dados vieram do legado
 * quando só os indicadores foram refeitos:
 *
 *   Recalcular   — segundos, refaz os indicadores do que já está no banco.
 *   Sincronizar  — minutos, busca dado novo no ABE WEB e no Delphi.
 *
 * A ação principal é a rápida; a demorada fica no menu, com o custo dito.
 */

type Resultado = { tipo: 'ok'; mensagem: string } | { tipo: 'erro'; erro: ApiError };

export function BotaoSync({ onConcluido }: { onConcluido?: () => void }) {
  const [rodando, setRodando] = useState<'recalcular' | 'sincronizar' | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  async function executar(acao: 'recalcular' | 'sincronizar') {
    setMenuAberto(false);
    setRodando(acao);
    setResultado(null);

    try {
      const r = await apiFetch<{ mensagem: string }>('/admin/sync', {
        method: 'POST',
        body: JSON.stringify({ acao }),
      });
      setResultado({ tipo: 'ok', mensagem: r.mensagem });
      if (acao === 'recalcular') onConcluido?.();
    } catch (err) {
      setResultado({ tipo: 'erro', erro: toApiError(err) });
    } finally {
      setRodando(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative flex">
        <button
          type="button"
          onClick={() => executar('recalcular')}
          disabled={rodando !== null}
          className="inline-flex items-center gap-2 rounded-l-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {rodando === 'recalcular' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {rodando === 'recalcular' ? 'Recalculando…' : 'Atualizar'}
        </button>

        <button
          type="button"
          onClick={() => setMenuAberto((v) => !v)}
          disabled={rodando !== null}
          aria-label="Mais opções de atualização"
          aria-expanded={menuAberto}
          className="inline-flex items-center rounded-r-xl border border-l-0 border-border bg-background px-2 py-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          <ChevronDown className="h-4 w-4" />
        </button>

        {menuAberto && (
          <>
            {/* Fecha ao clicar fora, sem prender o foco na página. */}
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setMenuAberto(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-xl border border-border bg-card p-1 shadow-card">
              <Opcao
                icon={RefreshCw}
                titulo="Recalcular indicadores"
                descricao="Segundos. Refaz os números a partir da carteira já sincronizada."
                onClick={() => executar('recalcular')}
              />
              <Opcao
                icon={CloudDownload}
                titulo="Sincronizar com ABE WEB e Delphi"
                descricao="Minutos. Busca dados novos no legado e recalcula ao final."
                onClick={() => executar('sincronizar')}
              />
            </div>
          </>
        )}
      </div>

      {rodando === 'sincronizar' && (
        <p className="text-xs text-muted-foreground">Disparando a sincronização…</p>
      )}

      {resultado?.tipo === 'ok' && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" />
          {resultado.mensagem}
        </p>
      )}

      {resultado?.tipo === 'erro' && (
        <div
          role="alert"
          className="max-w-md rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-3.5 w-3.5 text-warning" />
            {resultado.erro.title}
          </p>
          {/* O detalhe diz o que falta configurar — sem ele, o usuário só vê
              "não funcionou" e não tem como agir. */}
          {resultado.erro.errors?.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {resultado.erro.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Opcao({
  icon: Icon,
  titulo,
  descricao,
  onClick,
}: {
  icon: typeof RefreshCw;
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </button>
  );
}
