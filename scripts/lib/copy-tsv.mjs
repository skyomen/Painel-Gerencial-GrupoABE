/**
 * Serialização para `COPY ... FROM STDIN` (formato texto do Postgres).
 *
 * Módulo puro e testado à parte porque é onde erro vira dado errado em silêncio:
 * o formato texto separa campos por TAB e linhas por LF, então um TAB dentro de
 * uma razão social desloca TODAS as colunas seguintes daquela linha. O Postgres
 * não reclama — ele grava valor de uma coluna em outra.
 */

/** Ordem das colunas no COPY. A mesma lista alimenta o cabeçalho do comando. */
export const COLUNAS_CARTEIRA = [
  'credor_id',
  'sistema_origem',
  'processo',
  'data_inclusao',
  'data_repasse',
  'valor_original_titulo',
  'valor_pago',
  'valor_saldo_devedor',
  'tipo',
  'status',
  'visao_geral_carteira',
  'uf',
  'idade_dias',
  'sincronizado_em',
];

/**
 * Escapa um valor para o formato texto do COPY.
 *
 * NULL é a sequência `\N` — string vazia NÃO é null, e confundir os dois faz
 * `tipo` virar '' onde deveria ser nulo, mudando a classificação de pagamento.
 */
export function escaparCopy(valor) {
  if (valor === null || valor === undefined) return '\\N';

  return (
    String(valor)
      // A contrabarra vem primeiro: escapar depois dela duplicaria as outras.
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
  );
}

/** Uma linha do COPY, na ordem de COLUNAS_CARTEIRA. */
export function linhaParaCopy(linha) {
  return COLUNAS_CARTEIRA.map((coluna) => escaparCopy(linha[coluna])).join('\t');
}

/** Corpo completo do COPY, terminado em LF. Lista vazia devolve string vazia. */
export function linhasParaCopy(linhas) {
  if (!linhas?.length) return '';
  return linhas.map(linhaParaCopy).join('\n') + '\n';
}

/** `COPY tabela (col, col, ...) FROM STDIN` — colunas explícitas, nunca posicionais. */
export function comandoCopy(tabela = 'carteira_snapshot') {
  return `COPY public.${tabela} (${COLUNAS_CARTEIRA.join(', ')}) FROM STDIN`;
}
