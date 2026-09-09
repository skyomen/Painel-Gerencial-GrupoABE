/**
 * Motor compartilhado de sync ABE WEB → Supabase.
 * Usado por sync-abeweb-dashboard.mjs, onboard-credor.mjs e CI.
 */

import {
  attachOpcoesFiltro,
  buildOpcoesLote,
  buildOpcoesUf,
  closePool,
  fetchAllAbeWebRows,
  fetchAllAbeWebRowsAtivos,
  filterBorderoByUf,
  filterCarteiraByUf,
  getAbeWebPool,
  getSyncDateRange,
  mapRowsToPayload,
} from './abeweb.mjs';
import {
  refreshAgregados,
  refreshMetricasCache,
  upsertCarteiraSnapshot,
} from './carteira-snapshot.mjs';
import { checkAbeWebChanges } from './sync-check.mjs';
import { mapComLimite } from './concorrencia.mjs';
import { codigosDoCredor, filtrarElegiveis, resumirDescartados } from './elegibilidade.mjs';
import {
  getSyncState,
  markSyncCheck,
  markSyncError,
  markSyncStart,
  markSyncSuccess,
} from './sync-state.mjs';

function demoPayload() {
  return {
    kpiBordero: [],
    kpiFinanceiro: [],
    kpiCarteiraAtiva: [],
    tabelaAcordos: [],
    tabelaBaixas: [],
    carteiraRosca: [],
    enviadoRecebidoMensal: [],
    efetividadePorIdade: [],
    faixaIdadeComparativo: [],
    metricasUf: [],
    composicaoAtores: [],
  };
}

async function upsertSnapshot(db, tenantId, codCliente, periodo, loteEnvio, uf, payload, label) {
  const json = JSON.stringify(payload);
  const mb = (json.length / (1024 * 1024)).toFixed(2);
  console.log(`    gravando snapshot ${label ?? codCliente} (${mb} MB)…`);
  const t0 = performance.now();
  const { error } = await db.from('dashboard_carteira').upsert(
    {
      tenant_id: tenantId,
      cod_cliente: codCliente,
      periodo,
      lote_envio: loteEnvio,
      uf,
      payload,
      sincronizado_em: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,cod_cliente,periodo,lote_envio,uf' },
  );
  if (error) throw error;
  console.log(
    `    snapshot ${label ?? codCliente} ✓ (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
}

function buildOpcoesCodCliente(codigos, razaoSocial) {
  const opcoes = [{ value: 'todos', label: 'Todos os códigos' }];
  for (const cod of codigos) {
    opcoes.push({ value: cod, label: `${cod} — ${razaoSocial || `Cliente ${cod}`}` });
  }
  return opcoes;
}

async function syncDashboardVariants(
  db,
  tenantId,
  codCliente,
  borderoRows,
  carteiraRows,
  dateRange,
  razaoSocial,
  opcoesCodCliente,
) {
  const opcoesUf = buildOpcoesUf(borderoRows);
  const opcoesLote = buildOpcoesLote(borderoRows);
  const opcoes = { opcoesCodCliente, opcoesUf, opcoesLote };

  const buildPayload = (bordero, carteira, storeIndice) =>
    attachOpcoesFiltro(
      mapRowsToPayload(bordero, codCliente, razaoSocial, dateRange, carteira, { storeIndice }),
      opcoes,
    );

  await upsertSnapshot(
    db,
    tenantId,
    codCliente,
    'ano_atual',
    'todos',
    'todos',
    buildPayload(borderoRows, carteiraRows, true),
    `${codCliente}/base`,
  );

  for (const { value: uf } of opcoesUf) {
    if (uf === 'todos') continue;
    await upsertSnapshot(
      db,
      tenantId,
      codCliente,
      'ano_atual',
      'todos',
      uf,
      buildPayload(filterBorderoByUf(borderoRows, uf), filterCarteiraByUf(carteiraRows, uf), false),
      `${codCliente}/UF-${uf}`,
    );
  }

  console.log(`    snapshots: 1 base + ${opcoesUf.length - 1} UF`);
}

async function syncDemoVariants(db, tenantId, codCliente, payload, opcoesCodCliente) {
  payload.opcoesCodCliente = opcoesCodCliente;
  payload.opcoesUf = payload.opcoesUf ?? [{ value: 'todos', label: 'Todos os estados' }];
  payload.opcoesLote = payload.opcoesLote ?? [{ value: 'todos', label: 'Todos os lotes' }];
  await upsertSnapshot(db, tenantId, codCliente, 'ano_atual', 'todos', 'todos', payload);
}

async function runCheck(db, pool, tenantId, cod) {
  const state = await getSyncState(db, tenantId, cod);
  const since = state?.ultimo_bordero_ts ?? state?.ultima_sucesso ?? null;
  const result = await checkAbeWebChanges(pool, cod, since);
  await markSyncCheck(db, tenantId, cod, result);
  return result;
}

async function syncOneCliente(db, credor, cod, dateRange, opcoesCodCliente, pool) {
  const t0 = performance.now();
  await markSyncStart(db, credor.tenant_id, cod);

  try {
    console.log(`  Cliente ${cod} — borderô (Data Inclusão):`);
    const borderoRows = await fetchAllAbeWebRows(cod, dateRange);
    console.log(`  Cliente ${cod} — carteira completa (pagamentos + ativos):`);
    const carteiraRows = await fetchAllAbeWebRowsAtivos(cod, dateRange);

    await syncDashboardVariants(
      db,
      credor.tenant_id,
      cod,
      borderoRows,
      carteiraRows,
      dateRange,
      credor.razao_social,
      opcoesCodCliente,
    );

    const duracaoMs = Math.round(performance.now() - t0);
    await markSyncSuccess(db, credor.tenant_id, cod, {
      linhasBordero: borderoRows.length,
      linhasCarteira: carteiraRows.length,
      duracaoMs,
    });

    return { borderoRows, carteiraRows };
  } catch (err) {
    await markSyncError(db, credor.tenant_id, cod, err);
    throw err;
  }
}

/**
 * Credores elegíveis: quem tem código de cliente em algum sistema.
 *
 * Antes exigia ADMIN_CREDOR ativo, o que fazia sentido enquanto o painel era o
 * único consumidor. A visão da diretoria soma TODOS os credores, e um credor
 * sem login vira buraco no total — não ausência. `exigirResponsavel` mantém a
 * regra antiga para quem precisar dela.
 */
export async function fetchCredoresParaSync(
  db,
  { credorId = null, exigirResponsavel = false } = {},
) {
  let query = db.from('credores').select(
    `id, tenant_id, cod_cliente_principal, abe_delphi_cliente_id, razao_social,
       codigos_cliente ( cod_cliente, rotulo )`,
  );

  if (credorId) query = query.eq('id', credorId);

  const { data: credores, error } = await query;
  if (error) throw error;
  if (!credores?.length) return [];

  let tenantsComResponsavel = new Set();

  if (exigirResponsavel) {
    const { data: responsaveis, error: respError } = await db
      .from('usuarios')
      .select('tenant_id')
      .eq('papel', 'ADMIN_CREDOR')
      .eq('ativo', true);

    if (respError) throw respError;
    tenantsComResponsavel = new Set((responsaveis ?? []).map((u) => u.tenant_id));
  }

  const elegiveis = filtrarElegiveis(credores, { exigirResponsavel, tenantsComResponsavel });

  // Dizer QUEM ficou de fora e por quê — um total menor que o esperado, sem
  // motivo no log, é o tipo de coisa que ninguém investiga.
  const { semCodigo, semResponsavel } = resumirDescartados(credores, elegiveis);
  if (semCodigo.length) {
    console.log(`Sem código de cliente (${semCodigo.length}): ${semCodigo.join(', ')}`);
  }
  if (semResponsavel.length) {
    console.log(`Sem responsável (${semResponsavel.length}): ${semResponsavel.join(', ')}`);
  }

  return elegiveis;
}

export async function runAbeWebSync(db, options = {}) {
  const {
    credorId = null,
    exigirResponsavel = false,
    /**
     * Acima de 1 as consultas correm em paralelo contra o SQL Server de
     * PRODUÇÃO e os logs de credores diferentes se intercalam. Padrão 1: quem
     * acelera decide conscientemente, medindo o impacto no legado.
     */
    concorrencia = Number(process.env.ABEWEB_SYNC_CONCORRENCIA ?? 1),
    checkOnly = false,
    incremental = false,
    force = false,
    demo = false,
  } = options;

  if (!demo && !process.env.ABEWEB_DB_HOST) {
    throw new Error('ABEWEB_DB_* não configurado no .env. Use --demo ou preencha as credenciais.');
  }

  const dateRange = getSyncDateRange();
  const pageSize = process.env.ABEWEB_PAGE_SIZE ?? 2000;
  console.log(`Modo: ${checkOnly ? 'check' : incremental ? 'incremental' : 'completo'}`);
  console.log(
    `Período ABE WEB: ${dateRange.dataInicial} → ${dateRange.dataFinal} · pageSize=${pageSize}`,
  );

  const credores = await fetchCredoresParaSync(db, { credorId, exigirResponsavel });

  if (!credores.length) {
    if (credorId) {
      console.log(`Credor ${credorId} não encontrado ou sem código de cliente. Sync ignorado.`);
    } else {
      console.log('Nenhum credor com código de cliente. Sync ignorado.');
    }
    return { sincronizados: 0, ignorados: 0 };
  }

  let pool = null;

  /** @returns 'sincronizado' | 'ignorado' */
  async function sincronizarCredor(credor) {
    const codigos = codigosDoCredor(credor);
    if (!codigos.length) {
      console.log(`Ignorando ${credor.razao_social}: sem código de cliente`);
      return 'ignorado';
    }

    const opcoesCodCliente = buildOpcoesCodCliente(codigos, credor.razao_social);

    console.log(
      `\n${credor.razao_social} (tenant ${credor.tenant_id}, códigos ${codigos.join(', ')})`,
    );

    if (demo) {
      const payload = demoPayload();
      await syncDemoVariants(db, credor.tenant_id, 'todos', payload, opcoesCodCliente);
      for (const cod of codigos) {
        await syncDemoVariants(db, credor.tenant_id, cod, payload, opcoesCodCliente);
      }
      return 'sincronizado';
    }

    if (checkOnly || (incremental && !force)) {
      let algumPendente = false;
      for (const cod of codigos) {
        const tCheck = performance.now();
        const chk = await runCheck(db, pool, credor.tenant_id, cod);
        console.log(
          `  check ${cod}: ${chk.motivo} (${chk.novosProcessos} proc / ${chk.novosRepasses} rep) · ${((performance.now() - tCheck) / 1000).toFixed(1)}s`,
        );
        if (chk.precisaSync) algumPendente = true;
      }
      if (checkOnly || !algumPendente) {
        if (checkOnly) console.log('  → fim do check (sem sync completo)');
        else console.log('  → sem alterações, sync ignorado');
        return 'ignorado';
      }
      console.log('  → alterações detectadas, iniciando sync completo…');
    }

    let allBordero = [];
    let allCarteira = [];

    for (const cod of codigos) {
      const { borderoRows, carteiraRows } = await syncOneCliente(
        db,
        credor,
        cod,
        dateRange,
        opcoesCodCliente,
        pool,
      );
      allBordero = allBordero.concat(borderoRows);
      allCarteira = allCarteira.concat(carteiraRows);
    }

    if (allBordero.length > 0 || allCarteira.length > 0) {
      console.log(`  Snapshot consolidado (todos):`);
      await syncDashboardVariants(
        db,
        credor.tenant_id,
        'todos',
        allBordero,
        allCarteira,
        dateRange,
        credor.razao_social,
        opcoesCodCliente,
      );
    }

    if (allCarteira.length > 0) {
      console.log(`  ETL carteira_snapshot (credor ${credor.id}):`);
      await upsertCarteiraSnapshot(db, credor.id, 'ABE_WEB', allCarteira);
      await refreshMetricasCache(db, credor.id, dateRange, 'TODOS');
      // Agregados por último: dependem das linhas já gravadas acima.
      await refreshAgregados(db, credor.id, 'ABE_WEB');
    }

    return 'sincronizado';
  }

  let sincronizados = 0;
  let ignorados = 0;
  const falhas = [];

  try {
    if (!demo) pool = await getAbeWebPool();

    if (concorrencia > 1) {
      console.log(`Concorrência ${concorrencia} — logs de credores diferentes vão se intercalar.`);
    }

    const resultados = await mapComLimite(credores, concorrencia, sincronizarCredor);

    resultados.forEach((r, i) => {
      if (!r.ok) {
        // Uma falha não derruba as outras: num sync de cem credores, um credor
        // com problema não pode impedir os noventa e nove.
        falhas.push({ credor: credores[i].razao_social, erro: r.erro });
        return;
      }
      if (r.valor === 'sincronizado') sincronizados++;
      else ignorados++;
    });
  } finally {
    if (!demo) await closePool();
  }

  if (falhas.length) {
    console.error(`\n${falhas.length} credor(es) falharam:`);
    for (const f of falhas) console.error(`  ${f.credor}: ${f.erro?.message ?? f.erro}`);
  }

  console.log(demo ? '\nSync demo OK' : '\nSync ABE WEB OK');
  console.log(
    `Sincronizados: ${sincronizados} · Ignorados: ${ignorados} · Falhas: ${falhas.length}`,
  );

  // Sai com erro se TUDO falhou: o cron do CI não pode passar em verde
  // anunciando "OK" numa rodada que não gravou nada.
  if (falhas.length && sincronizados === 0) {
    throw new Error(`Sync falhou para todos os ${falhas.length} credores`);
  }

  return { sincronizados, ignorados, falhas: falhas.length };
}
