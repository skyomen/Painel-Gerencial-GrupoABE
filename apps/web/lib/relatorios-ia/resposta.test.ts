import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  montarTextoResposta,
  montarTransparencia,
  respostaContemValorFinanceiro,
} from './resposta.ts';
import { CONFIG_PADRAO, type ConfigAgente } from './config.ts';
import type { DadosRelatorio, EscopoExecucao } from './executor.ts';
import type { PlanoDeConsulta } from './plano.ts';

const ESCOPO: EscopoExecucao = {
  tenantId: 'tenant-1',
  credorId: 'credor-1',
  razaoSocial: 'Construtora Horizonte Ltda',
};

const PLANO: PlanoDeConsulta = {
  tipoRelatorio: 'CARTEIRA_ATIVA',
  periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
  filtros: { uf: null, sistemaOrigem: 'TODOS' },
};

const COM_DINHEIRO: DadosRelatorio = {
  cards: [
    { label: 'Carteira ativa', valor: 'R$ 719.000,00' },
    { label: 'Dados sincronizados até', valor: '03/11 09:14' },
  ],
  tabela: { colunas: ['UF', 'Saldo ativo'], linhas: [['SP', 'R$ 719.000,00']] },
  serieGrafico: [{ periodo: 'SP', rotulo: 'SP', ativo: 719000 }],
};

const SEM_DINHEIRO: DadosRelatorio = {
  cards: [
    { label: 'Efetividade 0-30d', valor: '42,5%' },
    { label: 'Dados sincronizados até', valor: '—' },
  ],
  tabela: { colunas: ['Faixa', 'Efetividade'], linhas: [['0-30d', '42,5%']] },
  serieGrafico: [],
};

function cfg(extra: Partial<ConfigAgente> = {}): ConfigAgente {
  return { ...CONFIG_PADRAO, ...extra };
}

describe('montarTransparencia', () => {
  it('monta os cinco campos no formato do protótipo', () => {
    const t = montarTransparencia(PLANO, ESCOPO);

    assert.equal(t.fonte, 'calc-metricas-carteira');
    assert.equal(t.credor, 'Construtora Horizonte Ltda (escopo travado pela sua sessão)');
    assert.equal(t.periodo, '01/05/2026–31/10/2026');
    assert.equal(t.periodo, '01/05/2026–31/10/2026');
    assert.equal(t.sistemas, 'ABE WEB + Delphi');
    assert.equal(t.aviso, 'Nenhum dado de outro credor foi lido para responder esta pergunta.');
  });

  it('o rótulo de sistemas segue o plano', () => {
    const web = montarTransparencia(
      { ...PLANO, filtros: { uf: null, sistemaOrigem: 'ABE_WEB' } },
      ESCOPO,
    );
    assert.equal(web.sistemas, 'ABE WEB');

    const delphi = montarTransparencia(
      { ...PLANO, filtros: { uf: null, sistemaOrigem: 'DELPHI' } },
      ESCOPO,
    );
    assert.equal(delphi.sistemas, 'Delphi');
  });

  it('a fonte sai do catálogo, não do executor', () => {
    const agregado = montarTransparencia({ ...PLANO, tipoRelatorio: 'BORDERO' }, ESCOPO);
    assert.equal(agregado.fonte, 'payload-de-agregados');
  });
});

describe('respostaContemValorFinanceiro', () => {
  it('acha R$ em card e em célula de tabela', () => {
    assert.equal(respostaContemValorFinanceiro(COM_DINHEIRO), true);
    assert.equal(respostaContemValorFinanceiro(SEM_DINHEIRO), false);

    assert.equal(
      respostaContemValorFinanceiro({
        ...SEM_DINHEIRO,
        tabela: { colunas: ['x'], linhas: [['R$ 10,00']] },
      }),
      true,
    );
  });
});

describe('montarTextoResposta', () => {
  it('anexa o rodapé obrigatório quando há valor financeiro', () => {
    const texto = montarTextoResposta({
      plano: PLANO,
      dados: COM_DINHEIRO,
      config: cfg(),
      escopo: ESCOPO,
    });

    assert.ok(texto.endsWith(CONFIG_PADRAO.rodapeObrigatorio), 'o rodapé tem de fechar o texto');
    assert.ok(texto.includes('sujeitos a conferência'));
  });

  it('sem valor financeiro, o rodapé não entra', () => {
    const texto = montarTextoResposta({
      plano: { ...PLANO, tipoRelatorio: 'CLASSIFICACAO_IDADE' },
      dados: SEM_DINHEIRO,
      config: cfg(),
      escopo: ESCOPO,
    });

    assert.ok(!texto.includes(CONFIG_PADRAO.rodapeObrigatorio));
  });

  it('o rodapé usado é o da config, não um texto fixo', () => {
    const texto = montarTextoResposta({
      plano: PLANO,
      dados: COM_DINHEIRO,
      config: cfg({ rodapeObrigatorio: 'Confira no painel antes de usar.' }),
      escopo: ESCOPO,
    });

    assert.ok(texto.endsWith('Confira no painel antes de usar.'));
    assert.ok(!texto.includes(CONFIG_PADRAO.rodapeObrigatorio));
  });

  it('os três tons mudam a abertura e nada mais', () => {
    const formal = montarTextoResposta({
      plano: PLANO,
      dados: COM_DINHEIRO,
      config: cfg({ tomDeVoz: 'FORMAL' }),
      escopo: ESCOPO,
    });
    const consultivo = montarTextoResposta({
      plano: PLANO,
      dados: COM_DINHEIRO,
      config: cfg({ tomDeVoz: 'CONSULTIVO' }),
      escopo: ESCOPO,
    });
    const direto = montarTextoResposta({
      plano: PLANO,
      dados: COM_DINHEIRO,
      config: cfg({ tomDeVoz: 'DIRETO' }),
      escopo: ESCOPO,
    });

    assert.ok(formal.startsWith('Prezado cliente,'));
    assert.ok(consultivo.startsWith('Olhando a carteira ativa'));
    assert.ok(direto.startsWith('Carteira ativa — 01/05/2026–31/10/2026.'));

    assert.notEqual(formal, consultivo);
    assert.notEqual(consultivo, direto);

    // Período, fonte e rodapé são do gabarito: o tom não tira nenhum deles.
    for (const texto of [formal, consultivo, direto]) {
      assert.ok(texto.includes('01/05/2026–31/10/2026'));
      assert.ok(texto.includes('calc-metricas-carteira'));
      assert.ok(texto.includes('R$ 719.000,00'));
      assert.ok(texto.endsWith(CONFIG_PADRAO.rodapeObrigatorio));
    }
  });

  it('cita sempre período e fonte (proibição 1)', () => {
    const texto = montarTextoResposta({
      plano: { ...PLANO, tipoRelatorio: 'BORDERO', filtros: { uf: 'SP', sistemaOrigem: 'DELPHI' } },
      dados: COM_DINHEIRO,
      config: cfg(),
      escopo: ESCOPO,
    });

    assert.ok(texto.includes('Período considerado: 01/05/2026–31/10/2026'));
    assert.ok(texto.includes('Fonte do cálculo: payload-de-agregados'));
    assert.ok(texto.includes('Sistemas: Delphi'));
    assert.ok(texto.includes('apenas SP'));
  });

  it('não nomeia outro credor nem sugere ação jurídica (proibições 2 e 3)', () => {
    // Estrutural: o gabarito só conhece o escopo do servidor e um vocabulário
    // fechado. Nada vindo do modelo entra neste texto.
    const texto = montarTextoResposta({
      plano: PLANO,
      dados: COM_DINHEIRO,
      config: cfg(),
      escopo: ESCOPO,
    });

    assert.ok(!texto.includes('outro credor'));
    for (const palavra of ['protesto', 'judicial', 'advogad', 'processar', 'extrajudicial']) {
      assert.ok(!texto.toLowerCase().includes(palavra), `o gabarito não fala em "${palavra}"`);
    }
  });

  it('sem sincronização registrada, diz isso em vez de inventar data', () => {
    const texto = montarTextoResposta({
      plano: { ...PLANO, tipoRelatorio: 'CLASSIFICACAO_IDADE' },
      dados: SEM_DINHEIRO,
      config: cfg(),
      escopo: ESCOPO,
    });

    assert.ok(texto.includes('Ainda não há registro de sincronização concluída'));
  });
});
