import { NextResponse } from 'next/server';
import { applyDashboardFiltros, filterIndice } from '@/lib/apply-dashboard-filtros';
import { applyMetricasRpc, type MetricasCredorRpc } from '@/lib/apply-metricas-rpc';
import { calcularMetricasCarteira } from '@/lib/calc-metricas-carteira';
import {
  buildUfPorProcessoFromIndice,
  enrichCarteiraUf,
  fetchCarteiraSnapshot,
} from '@/lib/carteira-fetch';
import {
  buildLoteRankMapFromIndice,
  defaultDataInicioIso,
  normalizeIsoRange,
  todayIso,
} from '@/lib/bordero-lote';
import { normalizeEstadoUf } from '@/lib/estado-uf';
import { emptyDashboardResponse } from '@/lib/dashboard-empty';
import { resolveDashboardScope } from '@/lib/dashboard-scope';
import { buildOpcoesCodClienteDashboard, listCodigosSync } from '@/lib/credor-codigos';
import { buildOpcoesUfFromIndice } from '@/lib/dashboard-filters';
import type {
  DashboardPayload,
  DashboardResponse,
  FiltrosDashboard,
  OpcaoFiltro,
} from '@/lib/dashboard-types';
import { createClient } from '@/lib/supabase/server';

function parseFiltros(searchParams: URLSearchParams): FiltrosDashboard {
  return {
    codCliente: searchParams.get('codCliente') ?? 'todos',
    loteEnvio: searchParams.get('loteEnvio') ?? 'todos',
    dataInicio: searchParams.get('dataInicio') ?? '',
    dataFinal: searchParams.get('dataFinal') ?? '',
    uf: searchParams.get('uf') ?? 'todos',
  };
}

type ChaveSnapshot = {
  cod_cliente: string;
  periodo: string;
  lote_envio: string;
  uf: string;
};

/** Sempre carrega snapshot base (UF=todos) — filtros aplicados em memória via borderoIndice. */
function mergeOpcoesCodCliente(base: OpcaoFiltro[], extra?: OpcaoFiltro[] | null): OpcaoFiltro[] {
  const map = new Map<string, OpcaoFiltro>();
  for (const o of base) map.set(o.value, o);
  for (const o of extra ?? []) {
    if (!map.has(o.value)) map.set(o.value, o);
  }
  return [...map.values()];
}

type CredorDashboardRow = {
  id: string;
  tenant_id: string;
  cod_cliente_principal: string | null;
  abe_delphi_cliente_id: string | null;
  razao_social: string;
  codigos_cliente: { cod_cliente: string; rotulo: string | null }[];
};

function mapCredorCodigos(row: CredorDashboardRow) {
  return {
    codClientePrincipal: row.cod_cliente_principal,
    abeDelphiClienteId: row.abe_delphi_cliente_id,
    razaoSocial: row.razao_social,
    codigosCliente: (row.codigos_cliente ?? []).map((c) => ({
      id: c.cod_cliente,
      codCliente: c.cod_cliente,
      rotulo: c.rotulo,
    })),
  };
}

function chavesConsulta(
  filtros: FiltrosDashboard,
  codigosCredor: string[],
  codPrincipal: string | null,
): ChaveSnapshot[] {
  const { codCliente } = filtros;

  if (codCliente !== 'todos') {
    return [
      {
        cod_cliente: codCliente,
        periodo: 'ano_atual',
        lote_envio: 'todos',
        uf: 'todos',
      },
    ];
  }

  const codigos = [
    ...new Set([...(codPrincipal ? [codPrincipal] : []), ...codigosCredor, 'todos']),
  ];

  return codigos.map((cod) => ({
    cod_cliente: cod,
    periodo: 'ano_atual',
    lote_envio: 'todos',
    uf: 'todos',
  }));
}

/** Ignora snapshot `todos` antigo sem índice quando existe cod principal. */
function snapshotValido(
  payload: DashboardPayload,
  codCliente: string,
  codPrincipal: string | null,
): boolean {
  if (codCliente !== 'todos' || !codPrincipal) return true;
  return Boolean(payload.borderoIndice?.length);
}

/**
 * `borderoIndice` tem uma entrada por processo do ano e serve apenas ao cálculo
 * no servidor — nenhum componente o lê. Enviá-lo custava megabytes por request,
 * repetidos a cada filtro mexido.
 */
function semIndice(payload: DashboardPayload): DashboardPayload {
  if (!payload.borderoIndice) return payload;
  const { borderoIndice: _descartado, ...resto } = payload;
  return resto;
}

function resolveDatasFiltro(filtros: FiltrosDashboard): { dataInicio: string; dataFinal: string } {
  const dataInicio = filtros.dataInicio || defaultDataInicioIso();
  const dataFinal = filtros.dataFinal || todayIso();
  return normalizeIsoRange(dataInicio, dataFinal);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ title: 'Sessão expirada.' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('tenant_id, papel, ativo')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.ativo) {
    return NextResponse.json({ title: 'Perfil não encontrado.' }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const filtros = parseFiltros(searchParams);
  const scope = resolveDashboardScope(profile.papel, searchParams.get('credorId'));

  if (scope.type === 'negado') {
    return NextResponse.json({ title: 'Você não tem permissão para esta ação.' }, { status: 403 });
  }

  const credorSelect = supabase.from('credores').select(
    `id, tenant_id, cod_cliente_principal, abe_delphi_cliente_id, razao_social,
       codigos_cliente ( cod_cliente, rotulo )`,
  );

  const { data: credor } =
    scope.type === 'credor'
      ? await credorSelect.eq('id', scope.credorId).maybeSingle()
      : await credorSelect.eq('tenant_id', profile.tenant_id).maybeSingle();

  const credorRow = credor as CredorDashboardRow | null;

  if (scope.type === 'credor' && !credorRow) {
    return NextResponse.json({ title: 'Credor não encontrado.' }, { status: 404 });
  }

  /** Na prévia do SUPER_ADMIN o tenant é o do credor visitado, não o do admin. */
  const tenantId = credorRow?.tenant_id ?? profile.tenant_id;
  const previewCredor =
    scope.type === 'credor' && credorRow
      ? { id: credorRow.id, razaoSocial: credorRow.razao_social }
      : undefined;
  const credorCodigos = credorRow ? mapCredorCodigos(credorRow) : null;
  const codigosSync = credorCodigos ? listCodigosSync(credorCodigos) : [];
  const codPrincipal = credorRow?.cod_cliente_principal?.trim() || null;

  let row: { payload: unknown; sincronizado_em: string } | null = null;

  for (const chave of chavesConsulta(filtros, codigosSync, codPrincipal)) {
    const { data, error } = await supabase
      .from('dashboard_carteira')
      .select('payload, sincronizado_em')
      .eq('tenant_id', tenantId)
      .eq('cod_cliente', chave.cod_cliente)
      .eq('periodo', chave.periodo)
      .eq('lote_envio', chave.lote_envio)
      .eq('uf', chave.uf)
      .maybeSingle();

    if (error) {
      console.error('[dashboard GET]', error);
      continue;
    }
    if (data?.payload) {
      const p = data.payload as DashboardPayload;
      if (!snapshotValido(p, chave.cod_cliente, codPrincipal)) continue;
      row = data;
      break;
    }
  }

  // Fallback: snapshot base mais recente entre códigos do credor (evita vazar snapshot de outro código)
  if (!row?.payload && codigosSync.length) {
    const { data, error } = await supabase
      .from('dashboard_carteira')
      .select('payload, sincronizado_em')
      .eq('tenant_id', tenantId)
      .in('cod_cliente', [...new Set([...(codPrincipal ? [codPrincipal] : []), ...codigosSync])])
      .eq('periodo', 'ano_atual')
      .eq('lote_envio', 'todos')
      .eq('uf', 'todos')
      .order('sincronizado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.payload) row = data;
  }

  if (!row?.payload) {
    return NextResponse.json({ ...emptyDashboardResponse(), credorPreview: previewCredor });
  }

  const payloadBruto = row.payload as DashboardPayload;

  // Snapshots antigos ou por UF podem não ter índice — tenta base consolidada
  if (!payloadBruto.borderoIndice?.length) {
    for (const cod of [codPrincipal, 'todos'].filter(Boolean)) {
      const { data: baseRow } = await supabase
        .from('dashboard_carteira')
        .select('payload')
        .eq('tenant_id', tenantId)
        .eq('cod_cliente', cod as string)
        .eq('periodo', 'ano_atual')
        .eq('lote_envio', 'todos')
        .eq('uf', 'todos')
        .maybeSingle();

      const indice = (baseRow?.payload as DashboardPayload | undefined)?.borderoIndice;
      if (indice?.length) {
        payloadBruto.borderoIndice = indice;
        payloadBruto.meta = {
          ...payloadBruto.meta,
          ...(baseRow?.payload as DashboardPayload).meta,
          datasBordero:
            payloadBruto.meta?.datasBordero ??
            (baseRow?.payload as DashboardPayload).meta?.datasBordero,
          loteRankMap:
            payloadBruto.meta?.loteRankMap ??
            (baseRow?.payload as DashboardPayload).meta?.loteRankMap,
        };
        break;
      }
    }
  }

  const datas = resolveDatasFiltro(filtros);
  const filtrosComDatas = { ...filtros, ...datas };
  const ufNorm = filtros.uf !== 'todos' ? normalizeEstadoUf(filtros.uf) : null;

  const rankMap =
    payloadBruto.meta?.loteRankMap && Object.keys(payloadBruto.meta.loteRankMap).length > 0
      ? payloadBruto.meta.loteRankMap
      : payloadBruto.borderoIndice?.length
        ? buildLoteRankMapFromIndice(payloadBruto.borderoIndice)
        : {};

  let processosBordero: Set<string> | null = null;
  if (payloadBruto.borderoIndice?.length && filtros.loteEnvio !== 'todos') {
    processosBordero = new Set(
      filterIndice(payloadBruto.borderoIndice, filtrosComDatas, rankMap, datas).map((r) => r.p),
    );
  }

  const ufPorProcesso = buildUfPorProcessoFromIndice(payloadBruto.borderoIndice);

  let metricas: MetricasCredorRpc | null = null;

  if (credor?.id) {
    const carteiraRows = await fetchCarteiraSnapshot(supabase, credor.id);

    if (carteiraRows.length) {
      const enriched = enrichCarteiraUf(carteiraRows, ufPorProcesso);
      metricas = calcularMetricasCarteira(enriched, datas.dataInicio, datas.dataFinal, {
        uf: ufNorm,
        processosBordero,
      });
    } else {
      const { data, error: rpcError } = await supabase.rpc('calcular_metricas_credor', {
        p_credor_id: credor.id,
        p_data_inicio: datas.dataInicio,
        p_data_fim: datas.dataFinal,
        p_sistema: null,
      });
      if (rpcError) console.error('[dashboard GET] calcular_metricas_credor', rpcError);
      else if (data) metricas = data as MetricasCredorRpc;
    }
  }

  let payload = metricas
    ? applyMetricasRpc(payloadBruto, metricas, { ...datas, uf: ufNorm })
    : payloadBruto;

  if (payloadBruto.borderoIndice?.length) {
    if (metricas) {
      if (ufNorm) {
        const visual = applyDashboardFiltros(payloadBruto, filtrosComDatas, { skipKpis: true });
        payload = { ...payload, metricasUf: visual.metricasUf };
      }
    } else {
      payload = applyDashboardFiltros(payloadBruto, filtrosComDatas);
    }
  } else if (metricas && ufNorm) {
    const visual = applyDashboardFiltros(payloadBruto, filtrosComDatas, { skipKpis: true });
    payload = { ...payload, metricasUf: visual.metricasUf };
  }

  if (credorCodigos) {
    const opcoesCredor = buildOpcoesCodClienteDashboard(credorCodigos);
    payload.opcoesCodCliente = mergeOpcoesCodCliente(opcoesCredor, payload.opcoesCodCliente);
  }

  // Snapshot antigo não traz opcoesUf; o cliente derivava do índice, que agora não viaja.
  if (!payload.opcoesUf || payload.opcoesUf.length <= 1) {
    const derivadas = buildOpcoesUfFromIndice(payloadBruto.borderoIndice);
    if (derivadas.length > 1) payload.opcoesUf = derivadas;
  }

  const response: DashboardResponse = {
    fonte: 'abeweb',
    sincronizadoEm: row.sincronizado_em,
    payload: semIndice(payload),
    filtrosAplicados: datas,
    credorPreview: previewCredor,
  };

  return NextResponse.json(response);
}
