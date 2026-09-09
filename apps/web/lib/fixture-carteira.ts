/**
 * Linhas de carteira usadas pelos testes de consistência.
 *
 * Fonte ÚNICA: o mesmo conjunto vira INSERT no Postgres (caminho dos agregados)
 * e objeto em memória (caminho do credor). Se cada lado tivesse a sua cópia,
 * uma divergência entre as telas poderia ser só divergência entre as fixtures.
 */

import type { CarteiraSnapshotRow } from './calc-metricas-carteira';

export const CREDOR_TESTE = '22222222-2222-2222-2222-222222222222';
export const PERIODO_TESTE = { de: '2026-01-01', ate: '2026-12-31' };

export type LinhaFixture = CarteiraSnapshotRow & { idade_dias: number | null };

/**
 * Cada linha existe para exercitar um ramo da classificação — os mesmos casos
 * do teste SQL, mais alguns de fronteira.
 */
export const LINHAS_FIXTURE: LinhaFixture[] = [
  // borderô comum, em cobrança
  {
    processo: 'P1',
    data_inclusao: '2026-03-10',
    data_repasse: null,
    valor_original_titulo: 1000,
    valor_pago: 0,
    valor_saldo_devedor: 400,
    tipo: null,
    status: 'Ativo',
    visao_geral_carteira: 'Em cobrança',
    uf: 'SP',
    idade_dias: 45,
  },
  // repasse de processo antigo: inclusão fora do período, repasse dentro
  {
    processo: 'P2',
    data_inclusao: '2025-11-05',
    data_repasse: '2026-03-15',
    valor_original_titulo: 500,
    valor_pago: 300,
    valor_saldo_devedor: 200,
    tipo: 'Pagamento Final',
    status: 'Ativo',
    visao_geral_carteira: 'Acordo com pagamento',
    uf: 'SP',
    idade_dias: 200,
  },
  // pagamento direto pelo tipo
  {
    processo: 'P3',
    data_inclusao: '2026-03-02',
    data_repasse: '2026-03-20',
    valor_original_titulo: 800,
    valor_pago: 800,
    valor_saldo_devedor: 0,
    tipo: 'Pagamento Direto Final',
    status: 'Ativo',
    visao_geral_carteira: 'Acordo a receber',
    uf: 'RJ',
    idade_dias: 15,
  },
  // pagamento direto pelo status, com tipo vazio
  {
    processo: 'P4',
    data_inclusao: '2026-03-03',
    data_repasse: '2026-03-21',
    valor_original_titulo: 600,
    valor_pago: 600,
    valor_saldo_devedor: 0,
    tipo: '',
    status: 'Pagto. Direto',
    visao_geral_carteira: 'Quebra de Acordo',
    uf: 'RJ',
    idade_dias: 95,
  },
  // valor pago zero: fora dos recebimentos, dentro do borderô
  {
    processo: 'P5',
    data_inclusao: '2026-03-04',
    data_repasse: '2026-03-22',
    valor_original_titulo: 400,
    valor_pago: 0,
    valor_saldo_devedor: 400,
    tipo: 'Pagamento Final',
    status: 'Ativo',
    visao_geral_carteira: 'Em cobranca',
    uf: 'MG',
    idade_dias: 300,
  },
  // tipo em minúsculas: a comparação é case-sensitive e não deve contar
  {
    processo: 'P6',
    data_inclusao: '2026-03-05',
    data_repasse: '2026-03-23',
    valor_original_titulo: 700,
    valor_pago: 700,
    valor_saldo_devedor: 0,
    tipo: 'pagamento final',
    status: 'Ativo',
    visao_geral_carteira: 'Em cobrança',
    uf: 'MG',
    idade_dias: 20,
  },
  // devolvidos, com e sem acento
  {
    processo: 'P7',
    data_inclusao: '2026-03-06',
    data_repasse: null,
    valor_original_titulo: 900,
    valor_pago: 0,
    valor_saldo_devedor: 0,
    tipo: null,
    status: 'Incobrável',
    visao_geral_carteira: '',
    uf: 'BA',
    idade_dias: 400,
  },
  {
    processo: 'P8',
    data_inclusao: '2026-03-07',
    data_repasse: null,
    valor_original_titulo: 300,
    valor_pago: 0,
    valor_saldo_devedor: 0,
    tipo: null,
    status: 'nao processado',
    visao_geral_carteira: '',
    uf: 'BA',
    idade_dias: 10,
  },
  // ativo com inclusão fora do período: saldo ativo não filtra por data
  {
    processo: 'P9',
    data_inclusao: '2025-01-10',
    data_repasse: null,
    valor_original_titulo: 2000,
    valor_pago: 0,
    valor_saldo_devedor: 1500,
    tipo: null,
    status: 'ativo',
    visao_geral_carteira: 'Em cobrança',
    uf: 'SP',
    idade_dias: 500,
  },
  // segundo mês, para a série mensal ter mais de um ponto
  {
    processo: 'P10',
    data_inclusao: '2026-04-12',
    data_repasse: '2026-04-30',
    valor_original_titulo: 1200,
    valor_pago: 450,
    valor_saldo_devedor: 750,
    tipo: 'Pagamento Parcial',
    status: 'Ativo',
    visao_geral_carteira: 'Acordo a receber',
    uf: 'SP',
    idade_dias: 62,
  },
];

function sql(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') {
    return valor === '' ? "''" : 'NULL';
  }
  return `'${String(valor).replace(/'/g, "''")}'`;
}

/** INSERT com as MESMAS linhas, para o lado do banco. */
export function fixtureComoInsert(credorId = CREDOR_TESTE): string {
  const valores = LINHAS_FIXTURE.map(
    (l) =>
      `('${credorId}','ABE_WEB',${sql(l.processo)},${sql(l.data_inclusao)},${sql(l.data_repasse)},` +
      `${l.valor_original_titulo},${l.valor_pago},${l.valor_saldo_devedor},` +
      `${sql(l.tipo)},${sql(l.status)},${sql(l.visao_geral_carteira)},${sql(l.uf)},` +
      `${l.idade_dias ?? 'NULL'})`,
  ).join(',\n  ');

  return (
    `INSERT INTO public.carteira_snapshot\n` +
    `  (credor_id, sistema_origem, processo, data_inclusao, data_repasse,\n` +
    `   valor_original_titulo, valor_pago, valor_saldo_devedor, tipo, status,\n` +
    `   visao_geral_carteira, uf, idade_dias)\n` +
    `VALUES\n  ${valores};`
  );
}
