/**
 * Mapeamento snake_case (banco) → camelCase (contrato HTTP) para
 * `public.cronograma_itens`. Único lugar que conhece as duas formas, para as
 * três rotas de `/api/cronograma` não divergirem entre si na conversão.
 *
 * Contrato fixo entre backend e frontend — ver instrução da migration 018
 * (DEC-0077). Não mude os nomes dos campos aqui sem atualizar quem consome.
 */

export type CronogramaStatus = 'FILA' | 'EM_EXECUCAO' | 'CONCLUIDO' | 'RECUSADO';
export type CronogramaPrioridadeDesejada = 'BAIXA' | 'MEDIA' | 'ALTA';

export interface CronogramaItemRow {
  id: string;
  titulo: string;
  descricao: string;
  escopo: string;
  status: CronogramaStatus;
  ordem: number | null;
  prioridade_desejada: CronogramaPrioridadeDesejada | null;
  evidencia_commit: string | null;
  motivo_recusa: string | null;
  atualizado_em: string;
  criado_em: string;
  criado_via_pagina: boolean;
}

export interface CronogramaItemDTO {
  id: string;
  titulo: string;
  descricao: string;
  escopo: string;
  status: CronogramaStatus;
  ordem: number | null;
  prioridadeDesejada: CronogramaPrioridadeDesejada | null;
  evidenciaCommit: string | null;
  atualizadoEm: string;
  motivoRecusa: string | null;
  criadoViaPagina: boolean;
}

export function toCronogramaItemDTO(row: CronogramaItemRow): CronogramaItemDTO {
  return {
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao,
    escopo: row.escopo,
    status: row.status,
    ordem: row.ordem,
    prioridadeDesejada: row.prioridade_desejada,
    evidenciaCommit: row.evidencia_commit,
    atualizadoEm: row.atualizado_em,
    motivoRecusa: row.motivo_recusa,
    criadoViaPagina: row.criado_via_pagina,
  };
}

/**
 * Histórico público de exclusões de itens do cronograma (DEC-0078, migration
 * 019) — gravado pela RPC `cronograma_excluir_item_pagina` antes de apagar o
 * item. `item_id`/`itemId` não tem FK: o item já não existe mais em
 * `cronograma_itens` quando este registro é lido.
 */
export interface CronogramaExclusaoRow {
  id: string;
  item_id: string;
  item_titulo: string;
  nome: string;
  motivo: string;
  excluido_em: string;
}

export interface CronogramaExclusaoDTO {
  id: string;
  itemId: string;
  itemTitulo: string;
  nome: string;
  motivo: string;
  excluidoEm: string;
}

export function toCronogramaExclusaoDTO(row: CronogramaExclusaoRow): CronogramaExclusaoDTO {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitulo: row.item_titulo,
    nome: row.nome,
    motivo: row.motivo,
    excluidoEm: row.excluido_em,
  };
}
