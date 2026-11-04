import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { responderPergunta } from './index.ts';
import { CONFIG_PADRAO, type ConfigAgente } from './config.ts';
import type { ClientePlano, ContextoPergunta, SaidaPlanoBruto } from './planner.ts';
import type { CredorParaExecucao, EscopoExecucao, SupabaseLike } from './executor.ts';

/**
 * Nenhum teste deste arquivo abre rede. O provedor é um dublê e o banco é um
 * espião que conta chamadas — é com ele que se prova que um plano reprovado não
 * chega a tocar em dado nenhum.
 */

const ESCOPO: EscopoExecucao = {
  tenantId: 'tenant-do-servidor',
  credorId: 'credor-do-servidor',
  razaoSocial: 'Construtora Horizonte Ltda',
};

const CREDOR: CredorParaExecucao = {
  id: 'credor-do-servidor',
  razao_social: 'Construtora Horizonte Ltda',
};

const CONTEXTO: ContextoPergunta = {
  pergunta: 'Quanto eu enviei para cobrança entre maio e outubro?',
  periodoAtual: { inicio: '2026-05-01', fim: '2026-10-31' },
  sistemaOrigemAtual: 'TODOS',
  ufAtual: null,
  hoje: '2026-11-04',
};

interface Chamada {
  tabela: string;
  colunas: string;
  filtros: [string, string][];
}

interface ChamadaRpc {
  funcao: string;
  args: Record<string, unknown>;
}

function espiaoSupabase(dados: Record<string, unknown[]> = {}) {
  const chamadas: Chamada[] = [];
  const rpcs: ChamadaRpc[] = [];

  const client = {
    from(tabela: string) {
      const chamada: Chamada = { tabela, colunas: '', filtros: [] };

      const builder = {
        select(colunas: string) {
          chamada.colunas = colunas;
          return builder;
        },
        eq(coluna: string, valor: string) {
          chamada.filtros.push([coluna, valor]);
          return builder;
        },
        order() {
          return builder;
        },
        range() {
          return builder;
        },
        then(resolve: (r: { data: unknown[] | null; error: null }) => void) {
          chamadas.push(chamada);
          resolve({ data: dados[tabela] ?? [], error: null });
        },
      };

      return builder;
    },
    rpc(funcao: string, args: Record<string, unknown>) {
      rpcs.push({ funcao, args });
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { supabase: client as unknown as SupabaseLike, chamadas, rpcs };
}

function clienteFixo(planoBruto: unknown, tokens = { entrada: 120, saida: 40 }) {
  const prompts: { sistema: string; usuario: string; modelo: string }[] = [];

  const cliente: ClientePlano = {
    async gerarPlano({ sistema, usuario, modelo }): Promise<SaidaPlanoBruto> {
      prompts.push({ sistema, usuario, modelo });
      return { planoBruto, tokensEntrada: tokens.entrada, tokensSaida: tokens.saida };
    },
  };

  return { cliente, prompts };
}

function cfg(extra: Partial<ConfigAgente> = {}): ConfigAgente {
  return { ...CONFIG_PADRAO, ...extra };
}

/** `Intl` separa R$ do número com espaço rígido (U+00A0), não com espaço comum. */
const MIL_EM_BRL = 'R$ 1.000,00';

const AGREGADOS_BORDERO = {
  metricas_mensais_bordero: [
    {
      credor_id: 'credor-do-servidor',
      competencia: '2026-05-01',
      uf: 'SP',
      bordero_valor: 1000,
      bordero_qtd: 2,
      idade_soma: 60,
      idade_qtd: 2,
    },
  ],
  sync_state: [{ ultima_sucesso: '2026-11-03T12:14:00Z' }],
};

describe('responderPergunta — plano malicioso', () => {
  it('plano com tenantId/credorId/sql é recusado e o executor não roda', async () => {
    const { supabase, chamadas, rpcs } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'CARTEIRA_ATIVA',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: 'SP', sistemaOrigem: 'TODOS' },
      tenantId: 'outro-tenant',
      credorId: 'outro-credor',
      sql: 'select * from usuarios',
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, false);
    if (r.ok) return;

    assert.equal(r.codigo, 'PLANO_INVALIDO');
    const detalhes = r.detalhes.join(' | ');
    assert.ok(detalhes.includes('tenantId'));
    assert.ok(detalhes.includes('credorId'));
    assert.ok(detalhes.includes('sql'));

    // O espião é a prova: zero SELECT, zero RPC. Nada foi lido.
    assert.equal(chamadas.length, 0, 'plano reprovado não pode emitir nenhum SELECT');
    assert.equal(rpcs.length, 0, 'plano reprovado não pode emitir nenhuma RPC');

    // O bruto volta para a auditoria registrar o que foi recusado.
    assert.deepEqual((r.planoBruto as { credorId: string }).credorId, 'outro-credor');
  });

  it('tipo fora do catálogo também para antes do banco', async () => {
    const { supabase, chamadas, rpcs } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'LISTA_DE_USUARIOS',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, false);
    assert.equal(chamadas.length, 0);
    assert.equal(rpcs.length, 0);
  });

  it('tipo válido mas desabilitado na config também para antes do banco', async () => {
    const { supabase, chamadas } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'BAIXAS',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg({ catalogoHabilitado: ['BORDERO'] }),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.detalhes.some((d) => d.includes('não está habilitado')));
    assert.equal(chamadas.length, 0);
  });
});

describe('responderPergunta — plano limpo', () => {
  it('executa com o escopo do SERVIDOR, nunca com o que viesse do plano', async () => {
    const { supabase, chamadas } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente, prompts } = clienteFixo({
      tipoRelatorio: 'BORDERO',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, true);
    if (!r.ok) return;

    const agregados = chamadas.filter((c) => c.tabela.startsWith('metricas_'));
    assert.equal(agregados.length, 5, 'as cinco tabelas de agregado são lidas');

    for (const c of agregados) {
      assert.deepEqual(
        c.filtros,
        [['credor_id', 'credor-do-servidor']],
        `${c.tabela} tem de ser restrita ao credor do servidor`,
      );
    }

    const sync = chamadas.find((c) => c.tabela === 'sync_state');
    assert.deepEqual(sync?.filtros, [['tenant_id', 'tenant-do-servidor']]);

    const todosOsValores = chamadas.flatMap((c) => c.filtros.map(([, v]) => v));
    assert.ok(!todosOsValores.includes('outro-credor'));
    assert.ok(!todosOsValores.includes('outro-tenant'));

    // O prompt confessa o próprio limite: o modelo não decide de quem é o dado.
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].sistema.includes('NUNCA decide de quem é o dado'));
    assert.ok(prompts[0].sistema.includes('NÃO tem acesso a dados'));
    assert.equal(prompts[0].modelo, CONFIG_PADRAO.modelo);

    assert.equal(r.tokensEntrada, 120);
    assert.equal(r.tokensSaida, 40);
  });

  it('monta cards, tabela, série e transparência a partir dos números calculados', async () => {
    const { supabase } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'BORDERO',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, true);
    if (!r.ok) return;

    const { cards, tabela, serieGrafico, transparencia, textoResposta } = r.resposta;

    assert.equal(cards.length, 4);
    assert.equal(cards[0].label, 'Valor enviado');
    assert.equal(cards[0].valor, MIL_EM_BRL);
    assert.equal(cards[3].label, 'Dados sincronizados até');
    assert.notEqual(cards[3].valor, '—');

    assert.deepEqual(tabela.colunas, ['Mês', 'Valor enviado']);
    assert.deepEqual(tabela.linhas, [['Mai/26', MIL_EM_BRL]]);
    assert.deepEqual(serieGrafico, [{ periodo: '2026-05-01', rotulo: 'Mai/26', enviado: 1000 }]);

    assert.equal(transparencia.fonte, 'payload-de-agregados');
    assert.equal(
      transparencia.credor,
      'Construtora Horizonte Ltda (escopo travado pela sua sessão)',
    );
    assert.equal(transparencia.periodo, '01/05/2026–31/10/2026');

    // O texto é do nosso gabarito, não do modelo.
    assert.ok(textoResposta.includes(MIL_EM_BRL));
    assert.ok(textoResposta.endsWith(CONFIG_PADRAO.rodapeObrigatorio));

    assert.deepEqual(r.plano, {
      tipoRelatorio: 'BORDERO',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });
  });

  it('sem sincronização registrada o 4º card é — e não uma data inventada', async () => {
    const { supabase } = espiaoSupabase({
      ...AGREGADOS_BORDERO,
      sync_state: [{ ultima_sucesso: null }],
    });
    const { cliente } = clienteFixo({
      tipoRelatorio: 'BORDERO',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, true);
    assert.equal(r.ok && r.resposta.cards[3].valor, '—');
  });

  it('CARTEIRA_ATIVA cai na RPC com o credor do servidor quando o snapshot vem vazio', async () => {
    const { supabase, rpcs } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'CARTEIRA_ATIVA',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, true);
    assert.equal(rpcs.length, 1);
    assert.equal(rpcs[0].funcao, 'calcular_metricas_credor');
    assert.equal(rpcs[0].args.p_credor_id, 'credor-do-servidor');
    assert.equal(rpcs[0].args.p_data_inicio, '2026-05-01');

    // Série por UF, nunca uma linha do tempo que a fonte não tem.
    assert.ok(r.ok && r.resposta.serieGrafico.every((p) => !p.periodo.includes('-')));
  });

  it('o recorte por sistema de origem entra no WHERE dos agregados', async () => {
    const { supabase, chamadas } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'BORDERO',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'DELPHI' },
    });

    const r = await responderPergunta({
      contexto: CONTEXTO,
      config: cfg(),
      cliente,
      escopo: ESCOPO,
      supabase,
      credor: CREDOR,
    });

    assert.equal(r.ok, true);
    for (const c of chamadas.filter((x) => x.tabela.startsWith('metricas_'))) {
      assert.deepEqual(c.filtros, [
        ['credor_id', 'credor-do-servidor'],
        // 'DELPHI' na tela é 'ABE_DELPHI' na coluna.
        ['sistema_origem', 'ABE_DELPHI'],
      ]);
    }
  });

  it('credor divergente do escopo para a execução', async () => {
    const { supabase } = espiaoSupabase(AGREGADOS_BORDERO);
    const { cliente } = clienteFixo({
      tipoRelatorio: 'BORDERO',
      periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
      filtros: { uf: null, sistemaOrigem: 'TODOS' },
    });

    await assert.rejects(
      () =>
        responderPergunta({
          contexto: CONTEXTO,
          config: cfg(),
          cliente,
          escopo: ESCOPO,
          supabase,
          credor: { id: 'credor-de-outro' },
        }),
      /Escopo inconsistente/,
    );
  });
});
