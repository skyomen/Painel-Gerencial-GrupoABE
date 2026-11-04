/**
 * Configuração global do agente (tabela `public.agente_relatorios_config`,
 * linha única, migration 017).
 *
 * Duas responsabilidades, e as duas existem por causa da chave de API:
 *
 * 1. `mapearConfig` traduz a linha crua para o que PODE sair daqui. A chave
 *    nunca está na linha (o Vault guarda o texto; a tabela guarda o ponteiro e
 *    quatro dígitos), e mesmo assim esta função só deixa passar o mascarado.
 *
 * 2. `validarEntradaConfig` separa a `apiKey` do resto. Ela sai num campo
 *    próprio, fora de `valores`, porque `valores` vai para um UPDATE de coluna
 *    e a chave tem de ir para a RPC `agente_relatorios_definir_chave`. Se ela
 *    pudesse viajar dentro de `valores`, um dia iria — e viraria texto plano
 *    numa coluna.
 *
 * PATCH parcial: campo ausente fica como está; campo desconhecido é rejeitado
 * com detalhe, nunca ignorado em silêncio.
 */

import { ehTipoRelatorio, TIPOS_RELATORIO, type TipoRelatorio } from './catalogo';

export type TomDeVoz = 'FORMAL' | 'CONSULTIVO' | 'DIRETO';

const TONS: readonly TomDeVoz[] = ['FORMAL', 'CONSULTIVO', 'DIRETO'];
const PROVEDORES: readonly string[] = ['OPENAI'];

export interface ConfigAgente {
  provedor: string;
  modelo: string;
  ativo: boolean;
  chaveConfigurada: boolean;
  chaveMascarada: string | null;
  chaveAtualizadaEm: string | null;
  tomDeVoz: TomDeVoz;
  idioma: string;
  proibicoes: string[];
  rodapeObrigatorio: string;
  limitePerguntasCredorDia: number;
  alertaCustoMensalBrl: number;
  catalogoHabilitado: TipoRelatorio[];
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

/** Linha crua de `public.agente_relatorios_config`, em snake_case. */
export interface LinhaConfigAgente {
  id?: string;
  singleton?: boolean;
  provedor?: string | null;
  modelo?: string | null;
  ativo?: boolean | null;
  /** UUID do segredo no Vault. Nunca a chave. */
  api_key_secret_id?: string | null;
  api_key_ultimos4?: string | null;
  api_key_atualizada_em?: string | null;
  tom_de_voz?: string | null;
  idioma?: string | null;
  proibicoes?: string[] | null;
  rodape_obrigatorio?: string | null;
  /** NUMERIC/INTEGER do PostgREST pode chegar como string. */
  limite_perguntas_credor_dia?: number | string | null;
  alerta_custo_mensal_brl?: number | string | null;
  catalogo_habilitado?: string[] | null;
  atualizado_por?: string | null;
  atualizado_em?: string | null;
  criado_em?: string | null;
}

/** Defaults da migration 017, repetidos aqui para a tela ter o que mostrar antes do primeiro GET. */
export const CONFIG_PADRAO: ConfigAgente = {
  provedor: 'OPENAI',
  modelo: 'gpt-5',
  ativo: false,
  chaveConfigurada: false,
  chaveMascarada: null,
  chaveAtualizadaEm: null,
  tomDeVoz: 'CONSULTIVO',
  idioma: 'pt-BR',
  proibicoes: [
    'Afirmar um valor sem citar período e fonte',
    'Comparar o credor com outro cliente do Grupo ABE',
    'Sugerir ação jurídica ou cobrança extrajudicial',
    'Responder com valor financeiro sem o aviso "sujeito a conferência"',
  ],
  rodapeObrigatorio:
    'Os valores apresentados são calculados automaticamente e sujeitos a conferência. ' +
    'Em caso de divergência, consulte o Resultado financeiro no dashboard.',
  limitePerguntasCredorDia: 30,
  alertaCustoMensalBrl: 1500,
  catalogoHabilitado: [...TIPOS_RELATORIO],
  atualizadoEm: null,
  atualizadoPor: null,
};

/**
 * `sk-••••••••••••A1b2` — formato exato do protótipo congelado. Quatro dígitos
 * não reconstroem chave nenhuma e não autenticam em lugar nenhum; servem só
 * para a tela dizer QUAL chave está valendo.
 */
export function mascararChave(ultimos4: string | null | undefined): string | null {
  const v = (ultimos4 ?? '').trim();
  if (!v) return null;
  return `sk-${'•'.repeat(12)}${v}`;
}

function num(valor: number | string | null | undefined, padrao: number): number {
  if (valor === null || valor === undefined || valor === '') return padrao;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function tom(valor: string | null | undefined): TomDeVoz {
  return TONS.includes(valor as TomDeVoz) ? (valor as TomDeVoz) : CONFIG_PADRAO.tomDeVoz;
}

export function mapearConfig(linha: LinhaConfigAgente): ConfigAgente {
  const habilitado = (linha.catalogo_habilitado ?? []).filter(ehTipoRelatorio);

  return {
    provedor: linha.provedor?.trim() || CONFIG_PADRAO.provedor,
    modelo: linha.modelo?.trim() || CONFIG_PADRAO.modelo,
    ativo: linha.ativo === true,
    // O ponteiro do Vault basta para saber que existe chave; o texto não sai do cofre.
    chaveConfigurada: Boolean(linha.api_key_secret_id),
    chaveMascarada: mascararChave(linha.api_key_ultimos4),
    chaveAtualizadaEm: linha.api_key_atualizada_em ?? null,
    tomDeVoz: tom(linha.tom_de_voz),
    idioma: linha.idioma?.trim() || CONFIG_PADRAO.idioma,
    proibicoes: linha.proibicoes ?? [...CONFIG_PADRAO.proibicoes],
    rodapeObrigatorio: linha.rodape_obrigatorio?.trim() || CONFIG_PADRAO.rodapeObrigatorio,
    limitePerguntasCredorDia: num(
      linha.limite_perguntas_credor_dia,
      CONFIG_PADRAO.limitePerguntasCredorDia,
    ),
    alertaCustoMensalBrl: num(linha.alerta_custo_mensal_brl, CONFIG_PADRAO.alertaCustoMensalBrl),
    catalogoHabilitado: habilitado.length > 0 ? habilitado : [...CONFIG_PADRAO.catalogoHabilitado],
    atualizadoEm: linha.atualizado_em ?? null,
    atualizadoPor: linha.atualizado_por ?? null,
  };
}

export type ResultadoEntradaConfig =
  | { ok: true; valores: Partial<LinhaConfigAgente>; apiKey?: string }
  | { ok: false; detalhes: string[] };

const CAMPOS_ACEITOS = [
  'provedor',
  'modelo',
  'ativo',
  'tomDeVoz',
  'idioma',
  'proibicoes',
  'rodapeObrigatorio',
  'limitePerguntasCredorDia',
  'alertaCustoMensalBrl',
  'catalogoHabilitado',
  'apiKey',
] as const;

export function validarEntradaConfig(body: unknown): ResultadoEntradaConfig {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, detalhes: ['O corpo da requisição precisa ser um objeto JSON.'] };
  }

  const entrada = body as Record<string, unknown>;
  const detalhes: string[] = [];
  const valores: Partial<LinhaConfigAgente> = {};
  let apiKey: string | undefined;

  for (const chave of Object.keys(entrada)) {
    if (!(CAMPOS_ACEITOS as readonly string[]).includes(chave)) {
      detalhes.push(`Campo não permitido: "${chave}".`);
    }
  }

  if ('provedor' in entrada) {
    const v = entrada.provedor;
    if (typeof v !== 'string' || !PROVEDORES.includes(v)) {
      detalhes.push(`provedor inválido: ${JSON.stringify(v)}. Hoje só existe adapter para OPENAI.`);
    } else {
      valores.provedor = v;
    }
  }

  if ('modelo' in entrada) {
    const v = entrada.modelo;
    if (typeof v !== 'string' || v.trim() === '') {
      detalhes.push('modelo inválido: informe o identificador do modelo.');
    } else {
      valores.modelo = v.trim();
    }
  }

  if ('ativo' in entrada) {
    const v = entrada.ativo;
    if (typeof v !== 'boolean') {
      detalhes.push('ativo inválido: esperado true ou false.');
    } else {
      valores.ativo = v;
    }
  }

  if ('tomDeVoz' in entrada) {
    const v = entrada.tomDeVoz;
    if (typeof v !== 'string' || !TONS.includes(v as TomDeVoz)) {
      detalhes.push(`tomDeVoz inválido: ${JSON.stringify(v)}. Esperado ${TONS.join(', ')}.`);
    } else {
      valores.tom_de_voz = v;
    }
  }

  if ('idioma' in entrada) {
    const v = entrada.idioma;
    if (typeof v !== 'string' || v.trim() === '') {
      detalhes.push('idioma inválido: informe um código de idioma, por exemplo pt-BR.');
    } else {
      valores.idioma = v.trim();
    }
  }

  if ('proibicoes' in entrada) {
    const v = entrada.proibicoes;
    if (!Array.isArray(v) || v.some((p) => typeof p !== 'string' || p.trim() === '')) {
      detalhes.push('proibicoes inválido: esperado uma lista de textos não vazios.');
    } else {
      valores.proibicoes = v.map((p) => (p as string).trim());
    }
  }

  if ('rodapeObrigatorio' in entrada) {
    const v = entrada.rodapeObrigatorio;
    if (typeof v !== 'string' || v.trim() === '') {
      detalhes.push('rodapeObrigatorio inválido: o rodapé não pode ficar vazio.');
    } else {
      valores.rodape_obrigatorio = v.trim();
    }
  }

  if ('limitePerguntasCredorDia' in entrada) {
    const v = entrada.limitePerguntasCredorDia;
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 1000) {
      detalhes.push('limitePerguntasCredorDia inválido: inteiro entre 1 e 1000.');
    } else {
      valores.limite_perguntas_credor_dia = v;
    }
  }

  if ('alertaCustoMensalBrl' in entrada) {
    const v = entrada.alertaCustoMensalBrl;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      detalhes.push('alertaCustoMensalBrl inválido: número maior ou igual a zero.');
    } else {
      valores.alerta_custo_mensal_brl = v;
    }
  }

  if ('catalogoHabilitado' in entrada) {
    const v = entrada.catalogoHabilitado;
    if (!Array.isArray(v) || v.length === 0) {
      detalhes.push('catalogoHabilitado inválido: informe ao menos um relatório do catálogo.');
    } else if (!v.every(ehTipoRelatorio)) {
      detalhes.push(
        `catalogoHabilitado inválido: só valem os tipos ${TIPOS_RELATORIO.join(', ')}.`,
      );
    } else {
      valores.catalogo_habilitado = [...new Set(v as TipoRelatorio[])];
    }
  }

  // A chave sai SEPARADA, por construção: `valores` alimenta um UPDATE de
  // coluna, e a chave só pode ir para a RPC do Vault.
  if ('apiKey' in entrada) {
    const v = entrada.apiKey;
    if (typeof v !== 'string' || v.trim().length < 8) {
      detalhes.push('apiKey inválida: a chave precisa ter ao menos 8 caracteres.');
    } else {
      apiKey = v.trim();
    }
  }

  if (detalhes.length > 0) return { ok: false, detalhes };
  return apiKey === undefined ? { ok: true, valores } : { ok: true, valores, apiKey };
}
