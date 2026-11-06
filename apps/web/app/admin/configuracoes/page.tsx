'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronRight, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import {
  FormInput,
  FormSelect,
  FormTextarea,
  SaveFeedback,
  type SaveFeedbackState,
} from '@/components/admin/form-field';
import { toApiError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format-currency';
import {
  getConfiguracoes,
  listarAuditoria,
  salvarConfiguracoes,
  type ConfiguracoesResponse,
  type LinhaAuditoria,
  type PatchConfiguracoes,
  type TipoRelatorio,
  type TomDeVoz,
} from '@/lib/configuracoes-api';

/**
 * Configuração global do agente de relatórios — só SUPER_ADMIN (o `AdminShell`
 * já barra o resto, e a rota barra de novo).
 *
 * Implementa a "visão do admin" de `docs/prototipos/relatorios-com-ia.html`.
 *
 * Duas regras moldam esta tela:
 *
 * 1. A chave de API é escrita e nunca lida. O que chega do servidor é
 *    `chaveMascarada` (quatro dígitos) — o texto fica no Supabase Vault e não
 *    tem caminho de volta até aqui. Por isso o campo nasce vazio mesmo quando
 *    há chave gravada: um input pré-preenchido anunciaria um segredo que esta
 *    tela não tem.
 * 2. Salvar manda PATCH do que MUDOU, não a configuração inteira. Reenviar
 *    tudo sobrescreveria, em silêncio, o que outro admin tivesse acabado de
 *    mexer num campo que este nem abriu.
 */
export default function ConfiguracoesPage() {
  const [dados, setDados] = useState<ConfiguracoesResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [form, setForm] = useState<PatchConfiguracoes>({});
  const [apiKey, setApiKey] = useState('');
  const [trocandoChave, setTrocandoChave] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedbackState>(null);

  /** Estado inteiro vem (e volta) do servidor; `form` é só o que foi mexido. */
  const aplicar = useCallback((resposta: ConfiguracoesResponse) => {
    setDados(resposta);
    setForm({});
    setApiKey('');
    setTrocandoChave(false);
  }, []);

  useEffect(() => {
    getConfiguracoes()
      .then(aplicar)
      .catch((err) => setErro(toApiError(err).title))
      .finally(() => setCarregando(false));
  }, [aplicar]);

  if (carregando) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {erro ?? 'Não foi possível carregar a configuração do agente.'}
      </p>
    );
  }

  const { config, catalogo, uso } = dados;
  /** O valor que a tela mostra: o editado, se houver; senão o do servidor. */
  const v = { ...config, ...form };
  const habilitados = form.catalogoHabilitado ?? config.catalogoHabilitado;
  const sujo = Object.keys(form).length > 0 || apiKey.trim() !== '';

  function mexer(patch: PatchConfiguracoes) {
    setFeedback(null);
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function alternarRelatorio(id: TipoRelatorio) {
    const ligado = habilitados.includes(id);
    if (ligado && habilitados.length === 1) {
      setFeedback({
        variant: 'error',
        message: 'Pelo menos um relatório precisa continuar habilitado.',
      });
      return;
    }
    mexer({
      catalogoHabilitado: ligado ? habilitados.filter((x) => x !== id) : [...habilitados, id],
    });
  }

  async function salvar() {
    const patch: PatchConfiguracoes = { ...form };
    if (apiKey.trim()) patch.apiKey = apiKey.trim();

    if (Object.keys(patch).length === 0) return;

    setSalvando(true);
    setFeedback(null);
    try {
      aplicar(await salvarConfiguracoes(patch));
      setFeedback({ variant: 'success', message: 'Configuração salva.' });
    } catch (err) {
      const api = toApiError(err);
      const detalhes = api.errors ?? api.detalhes ?? [];
      setFeedback({
        variant: 'error',
        message: detalhes.length > 0 ? `${api.title} ${detalhes.join(' ')}` : api.title,
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <ShieldCheck className="h-3 w-3" />
          Regra global — vale para todos os clientes do Grupo ABE
        </span>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            config.ativo
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${config.ativo ? 'bg-success' : 'bg-muted-foreground'}`}
          />
          {config.ativo ? 'Agente ativo' : 'Agente desativado'}
        </span>
      </div>

      <div className="mx-auto w-full max-w-[1280px] space-y-6">
        {/*
          Duas pilhas a partir de `xl`, e não uma coluna única mais larga: o que
          esta tela tem é formulário curto — dois selects, dois números, um
          textarea — e esticar um select até a borda da tela só afasta o rótulo
          do campo e alonga a leitura das listas. O espaço ganho vai para as
          duas pilhas lado a lado (conexão e custo de um lado, política do
          agente do outro) e para quem de fato precisa de largura: a tabela de
          auditoria, que pede 52rem e por isso fica fora da grade, na faixa
          inteira.
        */}
        <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
          {/* como o agente se conecta e quanto ele pode custar */}
          <div className="space-y-6">
            {/* ------------------------------------------------------ provedor */}
            <Secao
              titulo="Provedor de IA"
              descricao="A chave nunca é exibida nem chega ao navegador do cliente."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Provedor">
                  <FormSelect value={v.provedor} onChange={(valor) => mexer({ provedor: valor })}>
                    <option value="OPENAI">OpenAI</option>
                  </FormSelect>
                </Campo>

                <Campo rotulo="Modelo">
                  <FormInput value={v.modelo} onChange={(valor) => mexer({ modelo: valor })} />
                </Campo>

                <Campo rotulo="Chave de API" className="sm:col-span-2">
                  {config.chaveConfigurada && !trocandoChave ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <output className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {config.chaveMascarada ?? 'Chave gravada'}
                      </output>
                      <button
                        type="button"
                        onClick={() => setTrocandoChave(true)}
                        className="h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        Alterar chave
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => {
                          setFeedback(null);
                          setApiKey(e.target.value);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Cole a chave do provedor"
                        aria-label="Nova chave de API"
                        className="h-11 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-4 focus:ring-primary/15"
                      />
                      {config.chaveConfigurada && (
                        <button
                          type="button"
                          onClick={() => {
                            setApiKey('');
                            setTrocandoChave(false);
                          }}
                          className="h-11 rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  )}
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5 shrink-0" />
                    Guardada no Supabase Vault — nunca em texto plano.
                    {config.chaveAtualizadaEm &&
                      ` Atualizada em ${new Date(config.chaveAtualizadaEm).toLocaleString('pt-BR')}.`}
                  </p>
                </Campo>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3">
                <span className="text-sm font-medium text-foreground">
                  Agente de relatórios ativo para todos os clientes
                </span>
                <Interruptor
                  ligado={v.ativo}
                  rotulo="Agente de relatórios ativo para todos os clientes"
                  onChange={(ligado) => mexer({ ativo: ligado })}
                />
              </div>

              {!config.chaveConfigurada && (
                <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Sem chave gravada o agente responde 503 a qualquer pergunta, mesmo ligado.
                </p>
              )}
            </Secao>

            {/* ------------------------------------------------------- limites */}
            <Secao titulo="Limites e custo">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Perguntas por credor / dia">
                  <FormInput
                    type="number"
                    inputMode="numeric"
                    value={String(v.limitePerguntasCredorDia)}
                    onChange={(valor) => mexer({ limitePerguntasCredorDia: Number(valor) })}
                  />
                </Campo>

                <Campo rotulo="Alerta de custo mensal (R$)">
                  <FormInput
                    type="number"
                    inputMode="numeric"
                    value={String(v.alertaCustoMensalBrl)}
                    onChange={(valor) => mexer({ alertaCustoMensalBrl: Number(valor) })}
                  />
                </Campo>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">Uso em {uso.mesReferencia}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatBRL(uso.custoEstimadoBrl)} de {formatBRL(uso.alertaCustoMensalBrl)} ·{' '}
                    {uso.percentual}% · {uso.perguntas.toLocaleString('pt-BR')} perguntas
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={uso.percentual}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Custo do mês: ${uso.percentual}% do alerta`}
                >
                  <div
                    className={`h-full rounded-full ${uso.percentual >= 100 ? 'bg-danger' : 'bg-primary'}`}
                    style={{ width: `${Math.min(uso.percentual, 100)}%` }}
                  />
                </div>
                {uso.custoEstimadoBrl === 0 && uso.perguntas > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    O custo aparece zerado porque o preço do token ainda não foi definido — as
                    perguntas acima foram registradas sem valor estimado.
                  </p>
                )}
              </div>
            </Secao>
          </div>

          {/* o que ele pode dizer e quais dados enxerga */}
          <div className="space-y-6">
            {/* -------------------------------------------------------- regras */}
            <Secao
              titulo="Regras do agente"
              descricao="Aplicadas a toda pergunta, de todo credor — campos estruturados, não um texto solto, para dar pra auditar o que foi autorizado."
            >
              {/* 3fr/2fr, não 50/50: o segmentado tem três rótulos para caber e o
                  select de idioma tem um só. Meia linha sobraria para um e faltaria
                  para o outro quando o card passa a ocupar meia coluna no `xl`. */}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Campo rotulo="Tom de voz">
                  <Segmentado
                    rotulo="Tom de voz"
                    valor={v.tomDeVoz}
                    opcoes={[
                      { valor: 'FORMAL', rotulo: 'Formal' },
                      { valor: 'CONSULTIVO', rotulo: 'Consultivo' },
                      { valor: 'DIRETO', rotulo: 'Direto' },
                    ]}
                    onChange={(valor) => mexer({ tomDeVoz: valor })}
                  />
                </Campo>

                <Campo rotulo="Idioma de resposta">
                  <FormSelect value={v.idioma} onChange={(valor) => mexer({ idioma: valor })}>
                    <option value="pt-BR">Português (Brasil)</option>
                  </FormSelect>
                </Campo>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  O agente nunca pode
                </p>
                {/*
                  Lista só de leitura de propósito: cada proibição é garantida por
                  construção no montador da resposta, não por um pedido ao modelo.
                  Editá-las numa caixa de texto daria a impressão de que mudar a
                  frase muda o comportamento — e não muda.
                */}
                <ul className="space-y-2 text-sm text-foreground">
                  {v.proibicoes.map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded bg-primary text-primary-foreground"
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>

              <Campo rotulo="Rodapé obrigatório em toda resposta com valor" className="mt-4">
                <FormTextarea
                  value={v.rodapeObrigatorio}
                  onChange={(valor) => mexer({ rodapeObrigatorio: valor })}
                  rows={3}
                />
              </Campo>
            </Secao>

            {/* ------------------------------------------------------ catálogo */}
            <Secao
              titulo="Catálogo de dados permitido"
              descricao="A IA nunca recebe acesso direto às tabelas nem escreve SQL livre. Ela só monta um plano de consulta dentro deste catálogo, e todo plano roda com o mesmo isolamento por credor (RLS) do dashboard."
            >
              <ul className="flex flex-wrap gap-2">
                {catalogo.map((item) => {
                  if (!item.disponivel) {
                    return (
                      <li key={item.id}>
                        <span
                          title={item.descricao}
                          className="inline-flex cursor-default items-center rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-55"
                        >
                          {item.rotulo}
                        </span>
                      </li>
                    );
                  }

                  const ligado = habilitados.includes(item.id as TipoRelatorio);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ligado}
                        title={item.descricao}
                        onClick={() => alternarRelatorio(item.id as TipoRelatorio)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          ligado
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/30'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 rounded-full ${ligado ? 'bg-primary' : 'bg-muted-foreground/50'}`}
                        />
                        {item.rotulo}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Desligar um relatório não apaga nada: o agente passa a recusar perguntas que caiam
                nele.
              </p>
            </Secao>
          </div>
        </div>

        <Auditoria />
      </div>

      {/* Barra de salvar — fica no fim do fluxo, não flutuando sobre o conteúdo. */}
      <div className="mx-auto w-full max-w-[1280px]">
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          {feedback ? (
            <div className="min-w-0 flex-1">
              <SaveFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {sujo
                ? 'Há alterações não salvas nesta tela.'
                : config.atualizadoEm
                  ? `Última alteração em ${new Date(config.atualizadoEm).toLocaleString('pt-BR')}.`
                  : 'Nenhuma alteração registrada ainda.'}
            </p>
          )}
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !sujo}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:scale-100 disabled:opacity-60"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar configuração
          </button>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// Peças da tela
// =============================================================================

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h2 className="font-display text-base font-semibold text-foreground">{titulo}</h2>
      {descricao && (
        <p className="mb-4 mt-1 text-xs leading-relaxed text-muted-foreground">{descricao}</p>
      )}
      <div className={descricao ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

function Campo({
  rotulo,
  className = '',
  children,
}: {
  rotulo: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </label>
      {children}
    </div>
  );
}

function Interruptor({
  ligado,
  rotulo,
  onChange,
}: {
  ligado: boolean;
  rotulo: string;
  onChange: (ligado: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      onClick={() => onChange(!ligado)}
      className={`inline-flex h-6 w-11 flex-none items-center rounded-full p-0.5 transition-colors ${
        ligado ? 'justify-end bg-success' : 'justify-start bg-muted-foreground/40'
      }`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow" />
    </button>
  );
}

function Segmentado({
  rotulo,
  valor,
  opcoes,
  onChange,
}: {
  rotulo: string;
  valor: TomDeVoz;
  opcoes: { valor: TomDeVoz; rotulo: string }[];
  onChange: (valor: TomDeVoz) => void;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className="flex h-11 w-full gap-0.5 rounded-xl border border-border bg-muted/50 p-0.5"
    >
      {opcoes.map((o) => {
        const ativo = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.valor)}
            className={`flex-1 rounded-lg px-2 text-xs font-semibold transition-colors ${
              ativo
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

const STATUS_AUDITORIA: Record<string, string> = {
  OK: 'border-success/30 bg-success/10 text-success',
  REJEITADO: 'border-warning/30 bg-warning/10 text-warning',
  ERRO: 'border-danger/30 bg-danger/10 text-danger',
};

/**
 * Histórico completo, de todos os tenants. Abre embutido, não em modal: ler uma
 * lista não precisa interromper o resto da tela nem proteger foco nenhum.
 */
function Auditoria() {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<LinhaAuditoria[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    if (aberto) {
      setAberto(false);
      return;
    }

    setAberto(true);
    setCarregando(true);
    setErro(null);
    try {
      const r = await listarAuditoria(20);
      setLinhas(r.perguntas);
      setTotal(r.total);
    } catch (err) {
      setErro(toApiError(err).title);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-sm font-semibold text-foreground">Auditoria</h2>
          <p className="text-xs text-muted-foreground">
            Toda pergunta e resposta fica registrada, por credor e por usuário (LGPD).
          </p>
        </div>
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="inline-flex w-fit shrink-0 items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {aberto ? 'Ocultar histórico' : 'Ver histórico completo'}
          <ChevronRight className={`h-4 w-4 transition-transform ${aberto ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {aberto && (
        <div className="mt-4">
          {carregando && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {erro && (
            <p
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {erro}
            </p>
          )}

          {!carregando && !erro && linhas.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma pergunta registrada até agora.
            </p>
          )}

          {!carregando && !erro && linhas.length > 0 && (
            <>
              {/* `min-w` + rolagem própria: espremer sete colunas em 390px faz
                  cada célula virar uma coluna de palavras soltas. */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Quando
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Pergunta
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Relatório
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Tokens
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Custo
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Duração
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.id} className="border-t border-border align-top">
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                          {new Date(l.criadoEm).toLocaleString('pt-BR')}
                        </td>
                        <td className="max-w-[22rem] px-3 py-2.5 text-foreground">
                          {l.perguntaTexto}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {l.tipoRelatorio ?? '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
                              STATUS_AUDITORIA[l.status] ??
                              'border-border bg-muted text-muted-foreground'
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                          {l.tokensEntrada === null && l.tokensSaida === null
                            ? '—'
                            : `${l.tokensEntrada ?? 0} / ${l.tokensSaida ?? 0}`}
                        </td>
                        {/* `null` é "não há preço definido", não "custou zero". */}
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                          {l.custoEstimadoBrl === null ? '—' : formatBRL(l.custoEstimadoBrl)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                          {l.duracaoMs === null ? '—' : `${(l.duracaoMs / 1000).toFixed(1)} s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Mostrando {linhas.length} de {total.toLocaleString('pt-BR')} perguntas registradas.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
