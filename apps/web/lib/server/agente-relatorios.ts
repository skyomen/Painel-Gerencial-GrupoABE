/**
 * Helpers de servidor do agente de relatórios.
 *
 * Tudo aqui toca o banco pelo `service_role` (`adminDb()`), porque a 017 não dá
 * GRANT de `agente_relatorios_config` a `authenticated` e as duas RPCs do cofre
 * só são executáveis por `service_role`. O guard de autenticação acontece ANTES,
 * no Route Handler; este módulo assume que ele já passou.
 *
 * O mapeamento da linha de config para `ConfigAgente` NÃO mora aqui: é
 * `mapearConfig`, em `@/lib/relatorios-ia`, e é lá que está a regra de o que
 * pode sair da tabela (a chave mascarada e nada mais). Este módulo só busca a
 * linha e entrega para ela.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONFIG_PADRAO,
  mapearConfig,
  type ConfigAgente,
  type LinhaConfigAgente,
  type TipoRelatorio,
} from '@/lib/relatorios-ia';

/**
 * O mínimo do cliente Supabase que estes helpers usam. Um `Pick` em vez do
 * `SupabaseClient` inteiro para que o teste possa passar um dublê à mão sem
 * reimplementar cem métodos.
 */
export type AdminDbLike = Pick<SupabaseClient, 'from' | 'rpc'>;

export type StatusAuditoria = 'OK' | 'ERRO' | 'REJEITADO';

export interface EntradaAuditoria {
  tenantId: string;
  credorId: string | null;
  usuarioId: string;
  perguntaTexto: string;
  planoExecutado: unknown;
  respostaResumo: string | null;
  status: StatusAuditoria;
  tipoRelatorio: TipoRelatorio | null;
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoEstimadoBrl: number | null;
  duracaoMs: number | null;
}

export interface UsoMensal {
  mesReferencia: string;
  perguntas: number;
  custoEstimadoBrl: number;
  alertaCustoMensalBrl: number;
  percentual: number;
}

const TABELA_CONFIG = 'agente_relatorios_config';
const TABELA_PERGUNTAS = 'agente_relatorios_perguntas';

/**
 * O fuso é fixo e não vem de configuração: a cota diária é uma promessa
 * comercial feita ao credor brasileiro ("30 perguntas por dia"), e o dia dele
 * vira à meia-noite de São Paulo, não à meia-noite do datacenter.
 */
const FUSO_BR = 'America/Sao_Paulo';

// =============================================================================
// Janelas de tempo no fuso civil brasileiro
// =============================================================================

interface ParedeBR {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const FORMATADOR_BR = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_BR,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Relógio de parede em São Paulo para um instante qualquer. */
function paredeBR(instante: Date): ParedeBR {
  const partes = FORMATADOR_BR.formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const achado = partes.find((p) => p.type === tipo)?.value ?? '0';
    return Number.parseInt(achado, 10);
  };
  // `hourCycle` h23 em en-CA devolve 24 à meia-noite em alguns runtimes; 24 e 0
  // são o mesmo instante, e normalizar aqui evita um off-by-one de um dia.
  const hora = valor('hour');
  return {
    ano: valor('year'),
    mes: valor('month'),
    dia: valor('day'),
    hora: hora === 24 ? 0 : hora,
    minuto: valor('minute'),
    segundo: valor('second'),
  };
}

/** Quanto o relógio de parede de São Paulo está adiantado em relação ao UTC, em ms. */
function deslocamentoMs(instante: Date): number {
  const p = paredeBR(instante);
  const comoSeFosseUtc = Date.UTC(
    p.ano,
    p.mes - 1,
    p.dia,
    p.hora,
    p.minuto,
    p.segundo,
    instante.getUTCMilliseconds(),
  );
  return comoSeFosseUtc - instante.getTime();
}

/**
 * O instante real correspondente a um horário de parede em São Paulo.
 * O segundo passo refina o deslocamento no próprio instante alvo — o Brasil não
 * tem horário de verão hoje, mas já teve, e a conta não pode depender disso.
 */
function instanteDeParedeBR(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  segundo: number,
  ms: number,
  referencia: Date,
): Date {
  const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo, ms);
  const primeiro = new Date(comoSeFosseUtc - deslocamentoMs(referencia));
  const ajustado = deslocamentoMs(primeiro);
  return new Date(comoSeFosseUtc - ajustado);
}

/**
 * Dia civil de São Paulo que contém `agora`, em ISO UTC.
 * `fim` é inclusivo (23:59:59.999 na parede) para casar com o `.lte()` da query.
 */
export function janelaDoDiaSaoPaulo(agora: Date = new Date()): { inicio: string; fim: string } {
  const p = paredeBR(agora);
  const inicio = instanteDeParedeBR(p.ano, p.mes, p.dia, 0, 0, 0, 0, agora);
  const fim = instanteDeParedeBR(p.ano, p.mes, p.dia, 23, 59, 59, 999, agora);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

/** Mês civil de São Paulo que contém `agora`, em ISO UTC, mais o rótulo `YYYY-MM`. */
export function janelaDoMesSaoPaulo(agora: Date = new Date()): {
  inicio: string;
  fim: string;
  mesReferencia: string;
} {
  const p = paredeBR(agora);
  const inicio = instanteDeParedeBR(p.ano, p.mes, 1, 0, 0, 0, 0, agora);
  const proximoAno = p.mes === 12 ? p.ano + 1 : p.ano;
  const proximoMes = p.mes === 12 ? 1 : p.mes + 1;
  const primeiroDoProximo = instanteDeParedeBR(proximoAno, proximoMes, 1, 0, 0, 0, 0, agora);
  const fim = new Date(primeiroDoProximo.getTime() - 1);
  return {
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    mesReferencia: `${p.ano}-${String(p.mes).padStart(2, '0')}`,
  };
}

/** Data civil de hoje em São Paulo, no formato `YYYY-MM-DD`. */
export function hojeIsoSaoPaulo(agora: Date = new Date()): string {
  const p = paredeBR(agora);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/**
 * Primeiro dia do mês `meses` meses atrás, em São Paulo, no formato `YYYY-MM-DD`.
 * É o começo da janela padrão quando o cliente não manda período.
 */
export function primeiroDiaMesesAtrasSaoPaulo(meses: number, agora: Date = new Date()): string {
  const p = paredeBR(agora);
  const total = p.ano * 12 + (p.mes - 1) - meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

// =============================================================================
// Configuração
// =============================================================================

/**
 * A config do agente, já mapeada. Sem linha no banco — ou leitura falha —
 * devolve `CONFIG_PADRAO`, que é o mesmo default que a 017 semeia na tabela.
 * Config ilegível não derruba a rota: o sistema segue coerente e o erro fica
 * no log.
 */
export async function carregarConfigAgente(db: AdminDbLike): Promise<ConfigAgente> {
  const { data, error } = await db.from(TABELA_CONFIG).select('*').limit(1).maybeSingle();

  if (error) {
    console.error('[agente-relatorios carregarConfigAgente]', error);
    return CONFIG_PADRAO;
  }

  if (!data) return CONFIG_PADRAO;

  return mapearConfig(data as LinhaConfigAgente);
}

/**
 * A chave do provedor, lida do Vault pela RPC `SECURITY DEFINER`.
 * `null` quando não há chave gravada — estado legítimo de sistema recém-posto no ar.
 * A chave devolvida nunca pode ser logada, serializada nem devolvida ao navegador.
 */
export async function carregarChaveApi(db: AdminDbLike): Promise<string | null> {
  const { data, error } = await db.rpc('agente_relatorios_obter_chave');

  if (error) {
    console.error('[agente-relatorios carregarChaveApi]', error);
    return null;
  }

  const chave = typeof data === 'string' ? data.trim() : '';
  return chave.length > 0 ? chave : null;
}

/**
 * Grava (ou rotaciona) a chave no Vault. A RPC também carimba
 * `api_key_secret_id`, `api_key_ultimos4` e `api_key_atualizada_em` na mesma
 * transação — por isso nenhuma rota escreve essas colunas à mão.
 */
export async function gravarChaveApi(db: AdminDbLike, chave: string): Promise<void> {
  const { error } = await db.rpc('agente_relatorios_definir_chave', { p_chave: chave });

  if (error) {
    // A mensagem do Postgres pode conter a validação ("chave curta demais"), nunca a chave.
    console.error('[agente-relatorios gravarChaveApi]', error.message);
    throw new Error(error.message || 'Falha ao gravar a chave de API no cofre.');
  }
}

// =============================================================================
// Cota diária
// =============================================================================

/**
 * Decisão minha: a cota diária conta no BANCO, não no `checkRateLimit` de
 * `@/lib/server/rate-limit`. Aquele é um mapa em memória, por instância
 * serverless — em Vercel cada node tem o seu, o contador zera a cada frio, e
 * "30 por dia" viraria "30 por dia por instância que calhar de te atender".
 * Cota que vale dinheiro precisa de um contador só, e o único que existe é a
 * própria tabela de auditoria.
 */
export async function contarPerguntasDoDia(
  db: AdminDbLike,
  tenantId: string,
  agora: Date = new Date(),
): Promise<number> {
  const { inicio, fim } = janelaDoDiaSaoPaulo(agora);

  const { count, error } = await db
    .from(TABELA_PERGUNTAS)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    // Decisão minha: `OK` e `ERRO` consomem cota; `REJEITADO` não. Pergunta que
    // nem virou plano válido não leu dado nenhum e, na maioria das vezes, foi o
    // credor tentando se fazer entender. Cobrar cota disso ensina o usuário a
    // não perguntar, que é o contrário do que a tela existe para fazer. `ERRO`
    // conta porque ali o provedor já foi chamado e a conta já correu.
    .in('status', ['OK', 'ERRO'])
    .gte('criado_em', inicio)
    .lte('criado_em', fim);

  if (error) {
    // Decisão minha: falha de contagem libera a pergunta em vez de bloquear.
    // Um soluço de infraestrutura derrubando o recurso para todo credor é pior
    // que algumas perguntas acima do teto; o alerta de custo mensal continua
    // de pé como segunda rede.
    console.error('[agente-relatorios contarPerguntasDoDia]', error);
    return 0;
  }

  return count ?? 0;
}

/** A decisão de cota, isolada do banco para poder ser testada sem dublê. */
export function excedeuCota(usadas: number, limite: number): boolean {
  if (!Number.isFinite(limite) || limite <= 0) return false;
  return usadas >= limite;
}

// =============================================================================
// Auditoria
// =============================================================================

/** Corta `texto` em no máximo `max` caracteres (reticência inclusa), sem partir palavra. */
export function resumirResposta(texto: string, max = 500): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (max <= 1) return limpo.slice(0, Math.max(0, max));
  if (limpo.length <= max) return limpo;

  const corte = limpo.slice(0, max - 1);
  const ultimoEspaco = corte.lastIndexOf(' ');
  // Só respeita a fronteira de palavra quando ela não joga fora meio resumo.
  const base = ultimoEspaco > Math.floor((max - 1) * 0.6) ? corte.slice(0, ultimoEspaco) : corte;
  return `${base.trimEnd()}…`;
}

/**
 * Grava uma linha de auditoria e devolve o id.
 *
 * Nunca lança e nunca derruba a resposta: o credor já tem o relatório na mão
 * quando esta função roda, e perder o rastro é ruim, mas estourar na cara dele
 * por causa do rastro é pior. Falha vira `console.error` e `null`.
 */
export async function registrarAuditoria(
  db: AdminDbLike,
  entrada: EntradaAuditoria,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from(TABELA_PERGUNTAS)
      .insert({
        tenant_id: entrada.tenantId,
        credor_id: entrada.credorId,
        usuario_id: entrada.usuarioId,
        pergunta_texto: entrada.perguntaTexto,
        plano_executado: entrada.planoExecutado ?? {},
        resposta_resumo: entrada.respostaResumo,
        status: entrada.status,
        tipo_relatorio: entrada.tipoRelatorio,
        modelo: entrada.modelo,
        tokens_entrada: entrada.tokensEntrada,
        tokens_saida: entrada.tokensSaida,
        custo_estimado_brl: entrada.custoEstimadoBrl,
        duracao_ms: entrada.duracaoMs,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[agente-relatorios registrarAuditoria]', error);
      return null;
    }

    return (data as { id?: string } | null)?.id ?? null;
  } catch (err) {
    console.error('[agente-relatorios registrarAuditoria]', err);
    return null;
  }
}

// =============================================================================
// Uso e custo
// =============================================================================

function comoNumero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number.parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function precoDoAmbiente(bruto: string | undefined): number | null {
  if (!bruto) return null;
  const n = Number.parseFloat(bruto);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Custo estimado em BRL de uma pergunta.
 *
 * Decisão minha: nenhuma tabela de preço fica escrita aqui. Preço de token é
 * número de fora (muda sem avisar, e ainda passa por câmbio), e chutar um valor
 * encheria o painel de custo do admin de número que parece apurado e não é.
 * Sem as duas variáveis de ambiente, a função devolve `null` — a coluna é
 * anulável justamente para poder dizer "não sei" em vez de "R$ 0,00".
 */
export function estimarCustoBrl(
  tokensEntrada: number | null,
  tokensSaida: number | null,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const precoEntrada = precoDoAmbiente(env.AGENTE_RELATORIOS_PRECO_ENTRADA_BRL_MILHAO);
  const precoSaida = precoDoAmbiente(env.AGENTE_RELATORIOS_PRECO_SAIDA_BRL_MILHAO);
  if (precoEntrada === null || precoSaida === null) return null;

  const bruto =
    ((tokensEntrada ?? 0) / 1_000_000) * precoEntrada +
    ((tokensSaida ?? 0) / 1_000_000) * precoSaida;

  // A coluna é NUMERIC(12, 4); arredondar aqui evita o Postgres arredondar depois.
  return Math.round(bruto * 10_000) / 10_000;
}

/** Teto de páginas da soma mensal. 50 mil perguntas num mês já é anomalia, não uso. */
const MAX_PAGINAS_USO = 50;
const PAGINA_USO = 1000;

/**
 * Agrega o uso do mês civil corrente (São Paulo) para o painel de custo.
 *
 * A soma é paginada porque o PostgREST corta a resposta no `max-rows` do
 * projeto: um `select` sem paginação devolveria só a primeira fatia e o custo
 * apareceria menor do que é — exatamente o erro que o alerta existe para evitar.
 */
export async function agregarUsoMensal(
  db: AdminDbLike,
  alertaCustoMensalBrl: number,
  agora: Date = new Date(),
): Promise<UsoMensal> {
  const { inicio, fim, mesReferencia } = janelaDoMesSaoPaulo(agora);

  let perguntas = 0;
  let custo = 0;

  for (let pagina = 0; pagina < MAX_PAGINAS_USO; pagina++) {
    const de = pagina * PAGINA_USO;
    const { data, error, count } = await db
      .from(TABELA_PERGUNTAS)
      .select('custo_estimado_brl', { count: 'exact' })
      .gte('criado_em', inicio)
      .lte('criado_em', fim)
      .order('criado_em', { ascending: true })
      .range(de, de + PAGINA_USO - 1);

    if (error) {
      console.error('[agente-relatorios agregarUsoMensal]', error);
      break;
    }

    const linhas = (data ?? []) as { custo_estimado_brl: number | string | null }[];
    if (pagina === 0) perguntas = count ?? linhas.length;
    for (const linha of linhas) custo += comoNumero(linha.custo_estimado_brl);

    if (linhas.length < PAGINA_USO) break;
  }

  const alerta = Number.isFinite(alertaCustoMensalBrl) ? alertaCustoMensalBrl : 0;
  const custoArredondado = Math.round(custo * 100) / 100;

  return {
    mesReferencia,
    perguntas,
    custoEstimadoBrl: custoArredondado,
    alertaCustoMensalBrl: alerta,
    percentual: alerta > 0 ? Math.round((custoArredondado / alerta) * 100) : 0,
  };
}

// =============================================================================
// Intervalo de datas disponível
// =============================================================================

export interface IntervaloDisponivel {
  inicio: string | null;
  fim: string | null;
}

/**
 * As 4 tabelas de métricas mensais do credor, todas com `competencia` e
 * `credor_id` — a mesma lista de `carregarAgregados` em
 * `lib/relatorios-ia/executor.ts`, menos `metricas_posicao` (snapshot de hoje,
 * sem `competencia`).
 */
const TABELAS_COMPETENCIA = [
  'metricas_mensais_bordero',
  'metricas_mensais_repasse',
  'metricas_mensais_classe',
  'metricas_mensais_faixa',
] as const;

/**
 * Menor e maior `competencia` que o credor realmente tem nas 4 tabelas de
 * métricas mensais. Usado só para pré-preencher os campos de data da tela —
 * metadado de UI, não cálculo de relatório. Por isso erro de uma tabela não
 * derruba a função inteira: fica no log e aquela tabela simplesmente não
 * participa da conta. Credor sem nenhuma linha em nenhuma tabela devolve
 * `{ inicio: null, fim: null }`.
 *
 * Comparação de `competencia` é lexicográfica (string `'YYYY-MM-DD'`), que já
 * é a ordem cronológica correta para esse formato.
 */
export async function obterIntervaloDisponivel(
  supabase: SupabaseClient,
  credorId: string,
): Promise<IntervaloDisponivel> {
  const consultas = TABELAS_COMPETENCIA.flatMap((tabela) => [
    supabase
      .from(tabela)
      .select('competencia')
      .eq('credor_id', credorId)
      .order('competencia', { ascending: true })
      .limit(1),
    supabase
      .from(tabela)
      .select('competencia')
      .eq('credor_id', credorId)
      .order('competencia', { ascending: false })
      .limit(1),
  ]);

  const resultados = await Promise.all(consultas);

  let inicio: string | null = null;
  let fim: string | null = null;

  resultados.forEach((resultado, i) => {
    const tabela = TABELAS_COMPETENCIA[Math.floor(i / 2)];
    const ehMinimo = i % 2 === 0;

    if (resultado.error) {
      console.error('[agente-relatorios obterIntervaloDisponivel]', tabela, resultado.error);
      return;
    }

    const linha = (resultado.data as { competencia: string }[] | null)?.[0];
    if (!linha) return;

    if (ehMinimo) {
      if (inicio === null || linha.competencia < inicio) inicio = linha.competencia;
    } else {
      if (fim === null || linha.competencia > fim) fim = linha.competencia;
    }
  });

  return { inicio, fim };
}

// =============================================================================
// Leitura de query string
// =============================================================================

/** Inteiro da query string, preso entre `minimo` e `maximo`. Lixo cai no `padrao`. */
export function inteiroDaQuery(
  bruto: string | null,
  padrao: number,
  minimo: number,
  maximo: number,
): number {
  if (bruto === null || bruto.trim() === '') return padrao;
  const n = Number.parseInt(bruto, 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(maximo, Math.max(minimo, n));
}
