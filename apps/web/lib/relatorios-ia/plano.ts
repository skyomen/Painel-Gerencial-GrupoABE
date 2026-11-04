/**
 * O plano de consulta — e o portão que o valida antes de qualquer execução.
 *
 * DEC-0069: o modelo nunca gera SQL, nunca toca tabela e nunca decide de quem é
 * o dado. Ele devolve ESTE objeto e nada mais. `tenant_id` e `credor_id` vêm do
 * servidor, num parâmetro separado — por isso não existe campo de dono aqui, e
 * por isso a validação é por LISTA BRANCA em todos os níveis.
 *
 * A lista branca é o ponto de segurança, não a conveniência: rejeitar só os
 * campos que a gente lembrou de proibir (`tenantId`, `credorId`, `sql`,
 * `tabela`) protege contra a injeção de ontem. Aceitar só os três campos
 * conhecidos protege contra a de amanhã também.
 *
 * O validador devolve SEMPRE um objeto novo. Repassar por referência o objeto
 * que veio do modelo deixaria as chaves extras viajando junto, invisíveis, para
 * dentro do executor.
 */

import { UFS_BR } from '@/lib/estado-uf';
import { ehTipoRelatorio, TIPOS_RELATORIO, type TipoRelatorio } from './catalogo';

export const SISTEMAS_ORIGEM = ['ABE_WEB', 'DELPHI', 'TODOS'] as const;
export type SistemaOrigem = (typeof SISTEMAS_ORIGEM)[number];

export interface PlanoDeConsulta {
  tipoRelatorio: TipoRelatorio;
  /** Datas ISO 'YYYY-MM-DD'. */
  periodo: { inicio: string; fim: string };
  filtros: { uf: string | null; sistemaOrigem: SistemaOrigem };
}

export type ResultadoValidacao =
  | { ok: true; plano: PlanoDeConsulta }
  | { ok: false; motivo: string; detalhes: string[] };

/** Janela máxima de consulta. Acima disso é extração de base, não relatório. */
export const JANELA_MAXIMA_MESES = 36;

const CHAVES_RAIZ = ['tipoRelatorio', 'periodo', 'filtros'] as const;
const CHAVES_PERIODO = ['inicio', 'fim'] as const;
const CHAVES_FILTROS = ['uf', 'sistemaOrigem'] as const;

const UFS_VALIDAS = new Set<string>(UFS_BR);

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function chavesDesconhecidas(
  obj: Record<string, unknown>,
  permitidas: readonly string[],
  caminho: string,
): string[] {
  return Object.keys(obj)
    .filter((k) => !permitidas.includes(k))
    .map((k) => `Campo não permitido em ${caminho}: "${k}".`);
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' que existe de verdade — 2026-02-30 bate no regex e não é data. */
function ehDataIso(v: unknown): v is string {
  if (typeof v !== 'string' || !RE_DATA.test(v)) return false;
  const [ano, mes, dia] = v.split('-').map(Number);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Soma meses mantendo o dia; dia que não existe no mês destino cai no último dia dele. */
function somarMeses(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const alvoMes = mes - 1 + meses;
  const alvoAno = ano + Math.floor(alvoMes / 12);
  const normMes = ((alvoMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(alvoAno, normMes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(alvoAno, normMes, Math.min(dia, ultimoDia)));
  return d.toISOString().slice(0, 10);
}

export function validarPlano(
  entrada: unknown,
  opts: { catalogoHabilitado: readonly TipoRelatorio[] },
): ResultadoValidacao {
  const detalhes: string[] = [];

  if (!ehObjeto(entrada)) {
    return {
      ok: false,
      motivo: 'O plano devolvido não é um objeto.',
      detalhes: ['O plano precisa ser um objeto JSON com tipoRelatorio, periodo e filtros.'],
    };
  }

  detalhes.push(...chavesDesconhecidas(entrada, CHAVES_RAIZ, 'plano'));

  // --- tipo de relatório ---------------------------------------------------
  const tipo = entrada.tipoRelatorio;
  let tipoOk: TipoRelatorio | null = null;

  if (!ehTipoRelatorio(tipo)) {
    detalhes.push(
      `tipoRelatorio inválido: ${JSON.stringify(tipo)}. Esperado um de ${TIPOS_RELATORIO.join(', ')}.`,
    );
  } else if (!opts.catalogoHabilitado.includes(tipo)) {
    detalhes.push(`O relatório ${tipo} não está habilitado no catálogo desta instalação.`);
  } else {
    tipoOk = tipo;
  }

  // --- período -------------------------------------------------------------
  let inicio = '';
  let fim = '';
  const periodo = entrada.periodo;

  if (!ehObjeto(periodo)) {
    detalhes.push('periodo ausente ou inválido: esperado { inicio, fim } em YYYY-MM-DD.');
  } else {
    detalhes.push(...chavesDesconhecidas(periodo, CHAVES_PERIODO, 'periodo'));

    if (!ehDataIso(periodo.inicio)) {
      detalhes.push(`periodo.inicio inválido: ${JSON.stringify(periodo.inicio)}.`);
    } else {
      inicio = periodo.inicio;
    }

    if (!ehDataIso(periodo.fim)) {
      detalhes.push(`periodo.fim inválido: ${JSON.stringify(periodo.fim)}.`);
    } else {
      fim = periodo.fim;
    }

    if (inicio && fim) {
      if (inicio > fim) {
        detalhes.push(`periodo.inicio (${inicio}) é posterior a periodo.fim (${fim}).`);
      } else if (fim > somarMeses(inicio, JANELA_MAXIMA_MESES)) {
        detalhes.push(
          `Janela de ${inicio} a ${fim} passa do máximo de ${JANELA_MAXIMA_MESES} meses.`,
        );
      }
    }
  }

  // --- filtros -------------------------------------------------------------
  // Ausente é legítimo: significa "sem recorte". Presente com chave estranha,
  // não — é por aí que um `credorId` entraria de carona.
  let uf: string | null = null;
  let sistemaOrigem: SistemaOrigem = 'TODOS';
  const filtros = entrada.filtros;

  if (filtros !== undefined && filtros !== null) {
    if (!ehObjeto(filtros)) {
      detalhes.push('filtros inválido: esperado { uf, sistemaOrigem }.');
    } else {
      detalhes.push(...chavesDesconhecidas(filtros, CHAVES_FILTROS, 'filtros'));

      if (filtros.uf !== undefined && filtros.uf !== null && filtros.uf !== '') {
        const bruto = typeof filtros.uf === 'string' ? filtros.uf.trim().toUpperCase() : '';
        if (!UFS_VALIDAS.has(bruto)) {
          detalhes.push(
            `filtros.uf inválido: ${JSON.stringify(filtros.uf)}. Esperado uma das 27 UFs.`,
          );
        } else {
          uf = bruto;
        }
      }

      if (filtros.sistemaOrigem !== undefined && filtros.sistemaOrigem !== null) {
        const bruto = filtros.sistemaOrigem;
        if (typeof bruto !== 'string' || !(SISTEMAS_ORIGEM as readonly string[]).includes(bruto)) {
          detalhes.push(
            `filtros.sistemaOrigem inválido: ${JSON.stringify(bruto)}. Esperado ${SISTEMAS_ORIGEM.join(', ')}.`,
          );
        } else {
          sistemaOrigem = bruto as SistemaOrigem;
        }
      }
    }
  }

  if (detalhes.length > 0 || !tipoOk) {
    return {
      ok: false,
      motivo: 'O plano devolvido pelo modelo não passou na validação.',
      detalhes: detalhes.length > 0 ? detalhes : ['tipoRelatorio ausente.'],
    };
  }

  // Objeto NOVO: nada que veio do modelo atravessa por referência.
  return {
    ok: true,
    plano: {
      tipoRelatorio: tipoOk,
      periodo: { inicio, fim },
      filtros: { uf, sistemaOrigem },
    },
  };
}

/**
 * Esquema entregue ao provedor em modo estruturado.
 *
 * `additionalProperties: false` e `required` completo em todos os níveis são
 * exigência do `strict: true` da OpenAI — e, de quebra, fazem o provedor
 * recusar na origem o campo extra que o validador recusaria aqui. Duas
 * barreiras, porque a primeira é de terceiro e a segunda é nossa.
 */
export const ESQUEMA_PLANO_JSON: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tipoRelatorio', 'periodo', 'filtros'],
  properties: {
    tipoRelatorio: {
      type: 'string',
      enum: [...TIPOS_RELATORIO],
      description: 'Qual relatório do catálogo responde à pergunta.',
    },
    periodo: {
      type: 'object',
      additionalProperties: false,
      required: ['inicio', 'fim'],
      properties: {
        inicio: { type: 'string', description: 'Data inicial em YYYY-MM-DD.' },
        fim: { type: 'string', description: 'Data final em YYYY-MM-DD.' },
      },
    },
    filtros: {
      type: 'object',
      additionalProperties: false,
      required: ['uf', 'sistemaOrigem'],
      properties: {
        uf: {
          type: ['string', 'null'],
          description: 'Sigla da UF em duas letras maiúsculas, ou null para todas.',
        },
        sistemaOrigem: {
          type: 'string',
          enum: [...SISTEMAS_ORIGEM],
          description:
            'Recorte pelo sistema onde o título nasceu. TODOS quando não houver pedido explícito.',
        },
      },
    },
  },
};
