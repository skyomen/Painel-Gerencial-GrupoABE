/**
 * Cliente ABE WEB (SQL Server) — query 749 com paginação completa e agregação do dashboard.
 *
 * Regras de negócio (borderô / pagamentos / devolvidos / ativos / acordos):
 * - Borderô: filtro Data Inclusão → soma Valor Original Título, conta Processo
 * - Recebido ABE: Tipo Pagamento Final|Parcial + Data Repasse no período → soma Valor Pago
 * - Pagamento direto: Tipo Pagamento Direto Final|Parcial OU (Status Pagto. Direto + Tipo vazio)
 * - Devolvidos: Status Não processado | Não Estabelecido | Incobrável → Valor Original Título
 * - Ativos: Status Ativo → Valor Saldo Devedor (TODA a carteira, sem filtro de inclusão)
 * - Acordos: Visão Geral da Carteira → Valor Original (+ Saldo quando aplicável)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEstadoUf } from './estado-uf.mjs';
import { parseBrDecimal } from './parse-br.mjs';

export { parseBrDecimal };
import sql from 'mssql';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_SIZE = Number(process.env.ABEWEB_PAGE_SIZE ?? 2000);

const TIPO_PAGAMENTO_ABE = new Set(['pagamento final', 'pagamento parcial']);
const TIPO_PAGAMENTO_DIRETO = new Set(['pagamento direto final', 'pagamento direto parcial']);

const STATUS_DEVOLVIDO = [
  { match: (s) => s === 'incobrável' || s === 'incobravel', label: 'Incobrável' },
  { match: (s) => s === 'não processado' || s === 'nao processado', label: 'Não processado' },
  {
    match: (s) => s === 'não estabelecido' || s === 'nao estabelecido',
    label: 'Não Estabelecido',
  },
];

const VISAO_ACORDOS = [
  { match: (v) => v.includes('acordo com pagamento'), label: 'Acordo com pagamento' },
  { match: (v) => v.includes('acordo a receber'), label: 'Acordo a receber' },
  { match: (v) => v.includes('em cobrança') || v.includes('em cobranca'), label: 'Em cobrança' },
  { match: (v) => v.includes('quebra de acordo'), label: 'Quebra de Acordo' },
];

const BAIXA_DEFINICOES = {
  Incobrável: 'ABE esgotou todas as etapas extrajudiciais sem êxito',
  'Não Estabelecido': 'Devedor não encontrado no endereço — constatado em visita',
  'Não processado': 'Histórico negativo + título com mais de 18 meses',
};

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LOTE = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

let poolPromise = null;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não definida no .env da raiz`);
  return value;
}

export function getSyncDateRange() {
  const year = new Date().getFullYear();
  return {
    dataInicial: process.env.ABEWEB_SYNC_DATA_INICIAL ?? `01/01/${year}`,
    dataFinal: process.env.ABEWEB_SYNC_DATA_FINAL ?? `31/12/${year}`,
  };
}

function loadCarteiraQuery({ withDateFilter = true } = {}) {
  const raw = readFileSync(join(__dirname, '../749-ABEWEB.sql'), 'utf8');
  const start = raw.indexOf('DECLARE @idClientePrincipal');
  if (start < 0) {
    throw new Error('749-ABEWEB.sql: bloco SET @idClientePrincipal não encontrado');
  }
  let query = raw.slice(start);
  if (!withDateFilter) {
    query = query
      .replace(/\s+AND\s+\(P\.DataAbertura >= CONVERT\(DATE, @DataInicial, 103\)\)/i, '')
      .replace(/\s+AND\s+\(P\.DataAbertura <= CONVERT\(DATE, @DataFinal, 103\)\)/i, '');
  }
  return query;
}

const CARTEIRA_QUERY = loadCarteiraQuery({ withDateFilter: true });
const CARTEIRA_QUERY_SEM_DATA_INCLUSAO = loadCarteiraQuery({ withDateFilter: false });

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: requireEnv('ABEWEB_DB_HOST'),
      port: Number(process.env.ABEWEB_DB_PORT ?? 1433),
      database: requireEnv('ABEWEB_DB_NAME'),
      user: requireEnv('ABEWEB_DB_USER'),
      password: requireEnv('ABEWEB_DB_PASSWORD'),
      options: {
        encrypt: true,
        trustServerCertificate: process.env.ABEWEB_DB_TRUST_CERT !== '0',
      },
      requestTimeout: Number(process.env.ABEWEB_REQUEST_TIMEOUT_MS ?? 120_000),
    });
  }
  return poolPromise;
}

export async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

async function fetchPage(idCliente, dataInicial, dataFinal, pageNumber, query) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('idCliente', sql.Int, idCliente)
    .input('DataInicial', sql.VarChar(10), dataInicial)
    .input('DataFinal', sql.VarChar(10), dataFinal)
    .input('pageNumber', sql.Int, pageNumber)
    .input('pageSize', sql.Int, PAGE_SIZE)
    .query(query);
  return result.recordset ?? [];
}

async function fetchAllPages(idCliente, dateRange, query, label) {
  const { dataInicial, dataFinal } = dateRange;
  const allRows = [];
  let pageNumber = 0;
  const t0 = performance.now();

  for (;;) {
    const pageStart = performance.now();
    const batch = await fetchPage(idCliente, dataInicial, dataFinal, pageNumber, query);
    allRows.push(...batch);
    const pageSec = ((performance.now() - pageStart) / 1000).toFixed(1);
    console.log(
      `    ${label} pág ${pageNumber + 1}: +${batch.length} (total ${allRows.length}) · ${pageSec}s`,
    );
    if (batch.length < PAGE_SIZE) break;
    pageNumber += 1;
  }

  const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`    ${label} ✓ ${allRows.length} linhas · ${pageNumber + 1} págs · ${totalSec}s total`);
  return allRows;
}

export async function getAbeWebPool() {
  return getPool();
}

function parseClienteId(codCliente) {
  const idCliente = Number.parseInt(String(codCliente), 10);
  if (!Number.isFinite(idCliente)) {
    throw new Error(`Código cliente inválido para ABE WEB: ${codCliente}`);
  }
  return idCliente;
}

/** Borderô e pagamentos — filtro Data Inclusão na query SQL. */
export async function fetchAllAbeWebRows(codCliente, dateRange = getSyncDateRange()) {
  parseClienteId(codCliente);
  return fetchAllPages(parseClienteId(codCliente), dateRange, CARTEIRA_QUERY, 'borderô');
}

/** Carteira completa — sem filtro de Data Inclusão (pagamentos por repasse + ativos). */
export async function fetchAllAbeWebRowsAtivos(codCliente, dateRange = getSyncDateRange()) {
  parseClienteId(codCliente);
  return fetchAllPages(
    parseClienteId(codCliente),
    dateRange,
    CARTEIRA_QUERY_SEM_DATA_INCLUSAO,
    'ativos',
  );
}

function parseBrDate(str) {
  if (!str) return null;
  const parts = String(str).split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map((p) => Number.parseInt(p, 10));
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isDateInRange(dateStr, range) {
  const date = parseBrDate(dateStr);
  const start = parseBrDate(range.dataInicial);
  const end = parseBrDate(range.dataFinal);
  if (!date || !start || !end) return false;
  const d = startOfDay(date).getTime();
  return d >= startOfDay(start).getTime() && d <= startOfDay(end).getTime();
}

function normText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function isStatusAtivo(status) {
  return normText(status) === 'ativo';
}

function devolvidoLabel(status) {
  const s = normText(status);
  for (const rule of STATUS_DEVOLVIDO) {
    if (rule.match(s)) return rule.label;
  }
  return null;
}

function acordoLabel(visao) {
  const v = normText(visao);
  for (const rule of VISAO_ACORDOS) {
    if (rule.match(v)) return rule.label;
  }
  return null;
}

function isPagamentoAbeRow(row) {
  return TIPO_PAGAMENTO_ABE.has(normText(row.Tipo));
}

function isPagamentoDiretoRow(row) {
  const tipo = normText(row.Tipo);
  const status = String(row.Status ?? '').trim();
  if (TIPO_PAGAMENTO_DIRETO.has(tipo)) return true;
  if (tipo === '' && status.toLowerCase() === 'pagto. direto') return true;
  return false;
}

/** Pagamentos usam Data Repasse no período (equivalente USERELATIONSHIP no Power BI). */
function isPagamentoNoPeriodo(row, range) {
  const repasse = row['Data Repasse'];
  if (!repasse || String(repasse).trim() === '') return false;
  return isDateInRange(repasse, range);
}

function sumValorPago(rows, predicate, range) {
  return rows.reduce((total, row) => {
    if (!predicate(row) || !isPagamentoNoPeriodo(row, range)) return total;
    return total + parseBrDecimal(row['Valor Pago']);
  }, 0);
}

function fmtBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtNumber(n) {
  return new Intl.NumberFormat('pt-BR').format(Math.round(n));
}

function fmtPct(n) {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function idadeFaixa(idade) {
  if (idade <= 30) return '0-30';
  if (idade <= 60) return '31-60';
  if (idade <= 90) return '61-90';
  if (idade <= 180) return '91-180';
  return '180+';
}

function idadeFaixaLabel(faixa) {
  const labels = {
    '0-30': '0-30d',
    '31-60': '31-60d',
    '61-90': '61-90d',
    '91-180': '91-180d',
    '180+': '180+d',
  };
  return labels[faixa] ?? faixa;
}

/** Agrega ativos por processo (Status Ativo, sem filtro de inclusão). */
function aggregateAtivos(ativosRows) {
  const byProcesso = new Map();

  for (const row of ativosRows) {
    if (!isStatusAtivo(row.Status)) continue;
    const processo = row.Processo;
    if (processo == null) continue;

    const saldo = parseBrDecimal(row['Valor Saldo Devedor']);
    const estado = row.Estado ?? '';
    const cur = byProcesso.get(processo) ?? { processo, saldo: 0, estado };
    if (saldo > cur.saldo) cur.saldo = saldo;
    if (estado) cur.estado = estado;
    byProcesso.set(processo, cur);
  }

  return [...byProcesso.values()];
}

/** Borderô: linhas com Data Inclusão no período (query já filtra; revalidamos). */
function borderoRowsNoPeriodo(rows, range) {
  return rows.filter((row) => isDateInRange(row['Data Inclusão'], range));
}

function sumValorOriginal(rows) {
  return rows.reduce((s, row) => s + parseBrDecimal(row['Valor Original Título']), 0);
}

function distinctProcessos(rows) {
  return new Set(rows.map((r) => r.Processo).filter((p) => p != null));
}

function buildDevolvidos(borderoRows) {
  const buckets = new Map(STATUS_DEVOLVIDO.map((s) => [s.label, { qtd: new Set(), valor: 0 }]));

  for (const row of borderoRows) {
    const label = devolvidoLabel(row.Status);
    if (!label) continue;
    const valor = parseBrDecimal(row['Valor Original Título']);
    if (valor <= 0) continue;
    const bucket = buckets.get(label);
    bucket.qtd.add(row.Processo);
    bucket.valor += valor;
  }

  return [...buckets.entries()]
    .filter(([, v]) => v.valor > 0)
    .map(([motivo, v]) => ({
      motivo,
      definicao: BAIXA_DEFINICOES[motivo] ?? 'Devolvido conforme status no ABE WEB',
      quantidade: v.qtd.size,
      valor: fmtBRL(v.valor),
    }));
}

function buildAcordos(borderoRows) {
  const labels = [...new Set(VISAO_ACORDOS.map((v) => v.label))];
  const byVisao = new Map(labels.map((l) => [l, { qtd: new Set(), original: 0, saldo: 0 }]));

  for (const row of borderoRows) {
    const label = acordoLabel(row['Visão Geral da Carteira']);
    if (!label) continue;

    const valorOriginal = parseBrDecimal(row['Valor Original Título']);
    const saldo = parseBrDecimal(row['Valor Saldo Devedor']);
    const bucket = byVisao.get(label);

    if (valorOriginal > 0) {
      bucket.original += valorOriginal;
      bucket.qtd.add(row.Processo);
    }
    if (saldo > 0) bucket.saldo += saldo;
  }

  return labels
    .map((label) => {
      const b = byVisao.get(label);
      if (!b || (b.original === 0 && b.saldo === 0)) return null;
      return {
        metrica: label,
        quantidade: b.qtd.size,
        valor: fmtBRL(b.saldo > 0 ? b.saldo : b.original),
      };
    })
    .filter(Boolean);
}

function buildRosca(borderoRows, ativosAgg, recebidoAbe, pagamentoDireto, devolvidosTotal, acordosTotal) {
  const ativoSaldo = ativosAgg.reduce((s, p) => s + p.saldo, 0);
  const recebidoTotal = recebidoAbe + pagamentoDireto;

  const buckets = {
    Recebido: recebidoTotal,
    Ativo: ativoSaldo,
    Acordo: acordosTotal,
    Incobrável: 0,
    Devolvido: devolvidosTotal,
  };

  for (const row of borderoRows) {
    const label = devolvidoLabel(row.Status);
    if (label === 'Incobrável') {
      buckets.Incobrável += parseBrDecimal(row['Valor Original Título']);
    }
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;

  return [
    { label: 'Recebido', pct: Math.round((buckets.Recebido / total) * 1000) / 10, cor: 'hsl(var(--success))' },
    { label: 'Ativo', pct: Math.round((buckets.Ativo / total) * 1000) / 10, cor: 'hsl(var(--primary))' },
    { label: 'Acordo', pct: Math.round((buckets.Acordo / total) * 1000) / 10, cor: 'hsl(var(--accent))' },
    { label: 'Incobrável', pct: Math.round((buckets.Incobrável / total) * 1000) / 10, cor: 'hsl(var(--danger))' },
    { label: 'Devolvido', pct: Math.round((buckets.Devolvido / total) * 1000) / 10, cor: 'hsl(var(--muted-foreground))' },
  ];
}

/** Converte linhas brutas do ABE WEB no JSON do dashboard. */
export function mapRowsToPayload(
  rows,
  codCliente,
  razaoSocial = '',
  dateRange = getSyncDateRange(),
  carteiraCompletaRows = [],
  options = {},
) {
  const bordero = borderoRowsNoPeriodo(rows, dateRange);
  const processosBordero = distinctProcessos(bordero);

  const totalEnviado = sumValorOriginal(bordero);
  // Pagamentos: Data Repasse no período (USERELATIONSHIP) sobre toda a carteira
  const recebidoAbe = sumValorPago(carteiraCompletaRows, isPagamentoAbeRow, dateRange);
  const pagamentoDireto = sumValorPago(carteiraCompletaRows, isPagamentoDiretoRow, dateRange);
  const totalRecuperado = recebidoAbe + pagamentoDireto;

  const ativosAgg = aggregateAtivos(carteiraCompletaRows);
  const totalSaldoAtivo = ativosAgg.reduce((s, p) => s + p.saldo, 0);
  const processosAtivos = ativosAgg.length;

  const idades = bordero
    .filter((r) => processosBordero.has(r.Processo))
    .map((r) => Number(r['Idade Titulo Cadastramento']))
    .filter((n) => Number.isFinite(n));
  const idadeMedia = idades.length > 0 ? idades.reduce((a, b) => a + b, 0) / idades.length : 0;

  const mesesUnicos = new Set(
    bordero
      .map((r) => parseBrDate(r['Data Inclusão']))
      .filter(Boolean)
      .map((d) => `${d.getFullYear()}-${d.getMonth()}`),
  );

  const efetividadeGeral = totalEnviado > 0 ? (totalRecuperado / totalEnviado) * 100 : 0;
  const pctAtivo = totalEnviado > 0 ? (totalSaldoAtivo / totalEnviado) * 100 : 0;
  const ticketMedio = processosAtivos > 0 ? totalSaldoAtivo / processosAtivos : 0;

  const tabelaBaixas = buildDevolvidos(bordero);
  const tabelaAcordos = buildAcordos(bordero);

  let devolvidosSum = 0;
  for (const row of bordero) {
    if (devolvidoLabel(row.Status)) devolvidosSum += parseBrDecimal(row['Valor Original Título']);
  }

  const acordosTotal = bordero.reduce((s, row) => {
    if (!acordoLabel(row['Visão Geral da Carteira'])) return s;
    return s + parseBrDecimal(row['Valor Original Título']);
  }, 0);

  const enviadoMensalMap = new Map();
  for (const row of bordero) {
    const dt = parseBrDate(row['Data Inclusão']);
    const valor = parseBrDecimal(row['Valor Original Título']);
    if (!dt || valor <= 0) continue;
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    const cur = enviadoMensalMap.get(key) ?? { enviado: 0, mesIdx: dt.getMonth() };
    cur.enviado += valor;
    enviadoMensalMap.set(key, cur);
  }

  const recebidoMensalMap = new Map();
  for (const row of carteiraCompletaRows) {
    if (!isPagamentoNoPeriodo(row, dateRange)) continue;
    if (!isPagamentoAbeRow(row) && !isPagamentoDiretoRow(row)) continue;
    const dt = parseBrDate(row['Data Repasse']);
    const valor = parseBrDecimal(row['Valor Pago']);
    if (!dt || valor <= 0) continue;
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    const cur = recebidoMensalMap.get(key) ?? { recebido: 0, mesIdx: dt.getMonth() };
    cur.recebido += valor;
    recebidoMensalMap.set(key, cur);
  }

  const mesesKeys = [...new Set([...enviadoMensalMap.keys(), ...recebidoMensalMap.keys()])].sort();
  const enviadoRecebidoMensal = mesesKeys.slice(-6).map((key) => {
    const env = enviadoMensalMap.get(key);
    const rec = recebidoMensalMap.get(key);
    const mesIdx = env?.mesIdx ?? rec?.mesIdx ?? 0;
    return {
      mes: MESES_PT[mesIdx] ?? '?',
      enviado: env?.enviado ?? 0,
      recebido: rec?.recebido ?? 0,
    };
  });

  const processoBorderoMeta = new Map();
  for (const row of bordero) {
    const proc = row.Processo;
    if (proc == null) continue;
    const cur = processoBorderoMeta.get(proc) ?? {
      processo: proc,
      estado: row.Estado ?? '',
      valorOriginal: 0,
      idade: Number(row['Idade Titulo Cadastramento'] ?? 0),
      recebido: 0,
    };
    const vo = parseBrDecimal(row['Valor Original Título']);
    if (vo > cur.valorOriginal) cur.valorOriginal = vo;
    if (row.Estado) cur.estado = row.Estado;
    processoBorderoMeta.set(proc, cur);
  }

  for (const row of carteiraCompletaRows) {
    const proc = row.Processo;
    if (!processoBorderoMeta.has(proc)) continue;
    if (!isPagamentoNoPeriodo(row, dateRange)) continue;
    if (!isPagamentoAbeRow(row) && !isPagamentoDiretoRow(row)) continue;
    const cur = processoBorderoMeta.get(proc);
    cur.recebido += parseBrDecimal(row['Valor Pago']);
  }

  const faixaMap = new Map();
  for (const p of processoBorderoMeta.values()) {
    const fx = idadeFaixa(p.idade);
    const cur = faixaMap.get(fx) ?? { enviado: 0, recebido: 0, count: 0, efSum: 0 };
    cur.enviado += p.valorOriginal;
    cur.recebido += p.recebido;
    cur.count += 1;
    cur.efSum += p.valorOriginal > 0 ? (p.recebido / p.valorOriginal) * 100 : 0;
    faixaMap.set(fx, cur);
  }

  const faixaOrder = ['0-30', '31-60', '61-90', '91-180', '180+'];
  const faixaIdadeComparativo = faixaOrder
    .filter((fx) => faixaMap.has(fx))
    .map((fx) => {
      const v = faixaMap.get(fx);
      return {
        faixa: fx,
        enviado: v.enviado,
        recebido: v.recebido,
        media: v.count > 0 ? Math.round(v.efSum / v.count) : 0,
      };
    });

  const efetividadePorIdade = faixaOrder
    .filter((fx) => faixaMap.has(fx))
    .map((fx) => {
      const v = faixaMap.get(fx);
      return { idade: idadeFaixaLabel(fx), efetividade: v.count > 0 ? Math.round(v.efSum / v.count) : 0 };
    });

  const ufEnviado = new Map();
  for (const p of processoBorderoMeta.values()) {
    const uf = normalizeEstadoUf(p.estado || '—');
    const cur = ufEnviado.get(uf) ?? { enviado: 0, recebido: 0 };
    cur.enviado += p.valorOriginal;
    cur.recebido += p.recebido;
    ufEnviado.set(uf, cur);
  }

  const ufAtivo = new Map();
  for (const p of ativosAgg) {
    const uf = normalizeEstadoUf(p.estado || '—');
    ufAtivo.set(uf, (ufAtivo.get(uf) ?? 0) + p.saldo);
  }

  const ufDevolvido = new Map();
  for (const row of bordero) {
    if (!devolvidoLabel(row.Status)) continue;
    const uf = normalizeEstadoUf(row.Estado || '—');
    ufDevolvido.set(uf, (ufDevolvido.get(uf) ?? 0) + parseBrDecimal(row['Valor Original Título']));
  }

  const ufs = new Set([...ufEnviado.keys(), ...ufAtivo.keys(), ...ufDevolvido.keys()]);
  const metricasUf = [...ufs]
    .map((uf) => {
      const env = ufEnviado.get(uf) ?? { enviado: 0, recebido: 0 };
      return {
        uf,
        enviado: env.enviado,
        recebido: env.recebido,
        efetividade: env.enviado > 0 ? Math.round((env.recebido / env.enviado) * 1000) / 10 : 0,
        ativo: ufAtivo.get(uf) ?? 0,
        devolvido: ufDevolvido.get(uf) ?? 0,
      };
    })
    .sort((a, b) => b.enviado - a.enviado)
    .slice(0, 10);

  const carteiraRosca = buildRosca(
    bordero,
    ativosAgg,
    recebidoAbe,
    pagamentoDireto,
    devolvidosSum,
    acordosTotal,
  );

  const labelSuffix = razaoSocial ? ` — ${razaoSocial}` : '';
  const rankMap = buildLoteRankMap(bordero);
  const datasBordero = computeDatasPeriodo(bordero, carteiraCompletaRows);
  const storeIndice =
    options.storeIndice ?? process.env.ABEWEB_STORE_BORDERO_INDICE !== '0';

  return {
    ...(storeIndice ? { borderoIndice: buildBorderoIndice(bordero) } : {}),
    kpiBordero: [
      {
        rotulo: 'Valor total enviado',
        valor: fmtBRL(totalEnviado),
        detalhe: 'Soma Valor Original Título (Data Inclusão no período)',
      },
      {
        rotulo: 'Processos enviados',
        valor: fmtNumber(processosBordero.size),
        detalhe: 'Processos distintos enviados à cobrança',
      },
      {
        rotulo: 'Média de idade no envio',
        valor: `${Math.round(idadeMedia)} dias`,
        detalhe: 'Idade Título Cadastramento',
      },
      { rotulo: 'Lotes no período', valor: fmtNumber(mesesUnicos.size), detalhe: 'Meses com Data Inclusão' },
    ],
    kpiFinanceiro: [
      {
        rotulo: 'Recebido pela ABE',
        valor: fmtBRL(recebidoAbe),
        detalhe: 'Tipo Pagamento Final/Parcial · Data Repasse no período',
      },
      {
        rotulo: 'Pagamento direto',
        valor: fmtBRL(pagamentoDireto),
        detalhe: 'Tipo Pagamento Direto ou Status Pagto. Direto · Data Repasse',
      },
      {
        rotulo: 'Efetividade geral',
        valor: fmtPct(efetividadeGeral),
        detalhe: '(ABE + direto) / borderô enviado',
      },
      {
        rotulo: 'Total recuperado',
        valor: fmtBRL(totalRecuperado),
        detalhe: 'Recebido ABE + pagamento direto',
      },
    ],
    kpiCarteiraAtiva: [
      {
        rotulo: 'Valor em negociação',
        valor: fmtBRL(totalSaldoAtivo),
        detalhe: 'Status Ativo · Valor Saldo Devedor (carteira inteira)',
      },
      {
        rotulo: 'Processos ativos',
        valor: fmtNumber(processosAtivos),
        detalhe: 'Status Ativo (sem filtro de Data Inclusão)',
      },
      { rotulo: '% sobre enviado', valor: fmtPct(pctAtivo), detalhe: 'Ativo / borderô do período' },
      { rotulo: 'Ticket médio', valor: fmtBRL(ticketMedio), detalhe: 'Saldo ativo / processos ativos' },
    ],
    tabelaAcordos,
    tabelaBaixas,
    carteiraRosca,
    enviadoRecebidoMensal,
    efetividadePorIdade,
    faixaIdadeComparativo,
    metricasUf,
    composicaoAtores: [
      {
        id: 'abe',
        nome: 'ABE',
        descricao: 'ABE WEB',
        valor: fmtBRL(totalEnviado),
        pct: 100,
        logo: '/sources/ponteiro-mouse/ABE.svg',
      },
    ],
    meta: {
      codCliente,
      periodo: dateRange,
      datasBordero,
      loteRankMap: serializeLoteRankMap(rankMap),
      totalLinhasBordero: bordero.length,
      totalLinhasCarteira: carteiraCompletaRows.length,
      processosBordero: processosBordero.size,
      processosAtivos,
      recebidoAbe,
      pagamentoDireto,
      labelSuffix,
    },
  };
}

function anoMesKeyFromDate(d) {
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

function formatBrDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function toIsoDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Rank denso por AnoMesKey (equivalente _LoteNumMes no Power BI). */
export function buildLoteRankMap(borderoRows) {
  const keys = new Set();
  for (const row of borderoRows) {
    const d = parseBrDate(row['Data Inclusão']);
    if (d) keys.add(anoMesKeyFromDate(d));
  }
  const sorted = [...keys].sort((a, b) => a - b);
  const map = new Map();
  sorted.forEach((key, i) => map.set(key, i + 1));
  return map;
}

export function loteMesLabel(dataInclusaoStr, rankMap) {
  const d = parseBrDate(dataInclusaoStr);
  if (!d) return null;
  const rank = rankMap.get(anoMesKeyFromDate(d));
  if (!rank) return null;
  const yy = String(d.getFullYear()).slice(-2);
  return `LOTE${String(rank).padStart(2, '0')}-${MESES_LOTE[d.getMonth()]}/${yy}`;
}

export function loteDiaLabel(dataInclusaoStr, rankMap) {
  const d = parseBrDate(dataInclusaoStr);
  if (!d) return null;
  const rank = rankMap.get(anoMesKeyFromDate(d));
  if (!rank) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  return `LOTE${String(rank).padStart(2, '0')}-${dd}`;
}

export function computeDatasBordero(borderoRows) {
  let min = null;
  let max = null;
  for (const row of borderoRows) {
    const d = parseBrDate(row['Data Inclusão']);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) {
    return { min: null, max: null, minIso: null, maxIso: null };
  }
  return {
    min: formatBrDate(min),
    max: formatBrDate(max),
    minIso: toIsoDate(min),
    maxIso: toIsoDate(max),
  };
}

/**
 * Metadados de datas na carteira (filtro padrão: início = min inclusão, fim = hoje).
 */
export function computeDatasPeriodo(borderoRows, carteiraRows = []) {
  let minInclusao = null;
  let maxInclusao = null;
  let maxRepasse = null;

  for (const row of borderoRows) {
    const d = parseBrDate(row['Data Inclusão']);
    if (!d) continue;
    if (!minInclusao || d < minInclusao) minInclusao = d;
    if (!maxInclusao || d > maxInclusao) maxInclusao = d;
  }

  for (const row of carteiraRows) {
    const rep = parseBrDate(row['Data Repasse']);
    if (rep && (!maxRepasse || rep > maxRepasse)) maxRepasse = rep;
  }

  const hoje = new Date();

  if (!minInclusao || !maxInclusao) {
    return {
      min: null,
      max: null,
      minIso: null,
      maxIso: null,
      maxInclusaoIso: null,
      maxRepasseIso: null,
    };
  }

  return {
    min: formatBrDate(minInclusao),
    max: formatBrDate(hoje),
    minIso: toIsoDate(minInclusao),
    maxIso: toIsoDate(hoje),
    maxInclusaoIso: toIsoDate(maxInclusao),
    maxRepasseIso: maxRepasse ? toIsoDate(maxRepasse) : null,
  };
}

export function buildBorderoIndice(borderoRows) {
  return borderoRows.map((row) => {
    const dt = parseBrDate(row['Data Inclusão']);
    return {
      d: dt ? formatBrDate(dt) : String(row['Data Inclusão'] ?? ''),
      p: String(row.Processo ?? ''),
      v: parseBrDecimal(row['Valor Original Título']),
      uf: normalizeEstadoUf(row.Estado),
      i: Number(row['Idade Titulo Cadastramento']) || 0,
      s: String(row.Status ?? ''),
      vis: String(row['Visão Geral da Carteira'] ?? ''),
    };
  });
}

export function extractMesLoteKey(dataInclusaoStr) {
  const d = parseBrDate(dataInclusaoStr);
  if (!d) return null;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

export function filterBorderoByUf(rows, uf) {
  if (!uf || uf === 'todos') return rows;
  const alvo = normalizeEstadoUf(uf);
  return rows.filter((r) => normalizeEstadoUf(r.Estado) === alvo);
}

export function filterBorderoByLote(rows, lote, rankMap = buildLoteRankMap(rows)) {
  if (!lote || lote === 'todos') return rows;
  if (lote.startsWith('mes:')) {
    const alvo = lote.slice(4);
    return rows.filter((r) => loteMesLabel(r['Data Inclusão'], rankMap) === alvo);
  }
  if (lote.startsWith('dia:')) {
    const alvo = lote.slice(4);
    return rows.filter((r) => loteDiaLabel(r['Data Inclusão'], rankMap) === alvo);
  }
  return rows.filter((r) => extractMesLoteKey(r['Data Inclusão']) === lote);
}

export function filterCarteiraByUf(rows, uf) {
  if (!uf || uf === 'todos') return rows;
  const alvo = normalizeEstadoUf(uf);
  return rows.filter((r) => normalizeEstadoUf(r.Estado) === alvo);
}

export function buildOpcoesLote(borderoRows) {
  const rankMap = buildLoteRankMap(borderoRows);
  const opcoes = [{ value: 'todos', label: 'Todos os lotes' }];
  const mesLabels = new Set();
  const diaLabels = new Set();

  for (const row of borderoRows) {
    const mes = loteMesLabel(row['Data Inclusão'], rankMap);
    const dia = loteDiaLabel(row['Data Inclusão'], rankMap);
    if (mes) mesLabels.add(mes);
    if (dia) diaLabels.add(dia);
  }

  for (const label of [...mesLabels].sort()) {
    opcoes.push({ value: `mes:${label}`, label, grupo: 'mes' });
  }
  for (const label of [...diaLabels].sort()) {
    opcoes.push({ value: `dia:${label}`, label, grupo: 'dia' });
  }

  return opcoes;
}

export function serializeLoteRankMap(rankMap) {
  const out = {};
  for (const [key, rank] of rankMap.entries()) {
    out[String(key)] = rank;
  }
  return out;
}

export function buildOpcoesUf(borderoRows) {
  const opcoes = [{ value: 'todos', label: 'Todos os estados' }];
  const ufs = new Set();

  for (const row of borderoRows) {
    const uf = normalizeEstadoUf(row.Estado);
    if (uf) ufs.add(uf);
  }

  for (const uf of [...ufs].sort()) {
    opcoes.push({ value: uf, label: uf });
  }

  return opcoes;
}

export function getMesAtualLoteKey(referenceDate = new Date()) {
  const m = String(referenceDate.getMonth() + 1).padStart(2, '0');
  return `${referenceDate.getFullYear()}-${m}`;
}

export function attachOpcoesFiltro(payload, { opcoesCodCliente, opcoesUf, opcoesLote }) {
  payload.opcoesCodCliente = opcoesCodCliente;
  payload.opcoesUf = opcoesUf;
  payload.opcoesLote = opcoesLote;
  return payload;
}
