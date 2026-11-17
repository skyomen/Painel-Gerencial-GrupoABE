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
  };
}
