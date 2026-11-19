/**
 * Tipos compartilhados do Cronograma de desenvolvimento.
 *
 * O dado deixou de ser um array estático neste arquivo: agora mora na tabela
 * semeada por `supabase/migrations/018_cronograma_itens.sql` e é servido por
 * `/api/cronograma` (GET para listar, POST para adicionar item à fila, PATCH
 * em `/api/cronograma/fila-ordem` para reordenar a fila). Este arquivo guarda
 * só os tipos usados pela página em `apps/web/app/cronograma/page.tsx`.
 */

export type CronogramaStatus = 'FILA' | 'EM_EXECUCAO' | 'CONCLUIDO' | 'RECUSADO';

export type CronogramaPrioridadeDesejada = 'BAIXA' | 'MEDIA' | 'ALTA';

export interface CronogramaItem {
  id: string;
  titulo: string;
  descricao: string;
  escopo: string;
  status: CronogramaStatus;
  /** @deprecated Não ordena mais a fila — ver `ordem`. Mantido só por compatibilidade. */
  prioridade?: number;
  ordem?: number | null;
  prioridadeDesejada?: CronogramaPrioridadeDesejada | null;
  evidenciaCommit?: string | null;
  atualizadoEm: string;
  motivoRecusa?: string | null;
  /**
   * TRUE só para itens inseridos pelo botão "+" da própria página
   * (DEC-0078) — único caso em que a tela oferece mover por drag entre
   * colunas e excluir. Itens oficiais do roadmap (seed da migration 018)
   * vêm com FALSE e não ganham essas ações.
   */
  criadoViaPagina: boolean;
}

/**
 * Entrada do histórico público de exclusões (DEC-0078) — exibida sempre
 * visível abaixo do quadro, mesmo vazia.
 */
export interface CronogramaExclusao {
  id: string;
  itemTitulo: string;
  nome: string;
  motivo: string;
  excluidoEm: string;
}
