/**
 * Visão da diretoria: a MESMA tela do dashboard, com todos os credores somados
 * e um filtro para isolar um. Só SUPER_ADMIN.
 */

import type { DashboardPayload } from './dashboard-types';

export interface DiretoriaFiltros {
  /** Vazio/null = consolidado de todos os credores. */
  credorId: string | null;
  uf: string;
  de: string;
  ate: string;
}

export interface DiretoriaCredorOpcao {
  id: string;
  razaoSocial: string;
}

export interface DiretoriaResponse {
  /** Idêntico ao do credor — a tela não sabe a diferença. */
  payload: DashboardPayload;
  credores: DiretoriaCredorOpcao[];
  opcoesUf: string[];
  filtros: DiretoriaFiltros;
  /** Do credor MAIS atrasado: é essa a idade real do consolidado. */
  maisAntigoSincronizadoEm: string | null;
  /** Distingue "nada sincronizado ainda" de "o filtro não achou nada". */
  temAgregados: boolean;
}

/**
 * Efetividade é razão, e razão NÃO é aditiva: somar a efetividade de cada
 * credor dá um número sem significado. O certo é sempre dividir os totais.
 */
export function calcularEfetividade(recebido: number, enviado: number): number {
  if (!enviado) return 0;
  return Math.round((recebido / enviado) * 1000) / 10;
}
