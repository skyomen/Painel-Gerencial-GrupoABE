import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filtrar,
  montarAcordos,
  montarBaixas,
  montarDashboardDeAgregados,
  montarEnviadoRecebido,
  montarFaixas,
  montarKpis,
  montarRosca,
  montarUf,
  type Agregados,
} from './payload-de-agregados.ts';

/** Dois credores, para exercitar o consolidado e o filtro por um só. */
const ag: Agregados = {
  bordero: [
    {
      credor_id: 'c1',
      competencia: '2026-03-01',
      uf: 'SP',
      bordero_valor: '10000.00',
      bordero_qtd: 100,
      idade_soma: '3000',
      idade_qtd: 100,
    },
    {
      credor_id: 'c2',
      competencia: '2026-03-01',
      uf: 'RJ',
      bordero_valor: '2000.00',
      bordero_qtd: 10,
      idade_soma: '2000',
      idade_qtd: 10,
    },
  ],
  repasse: [
    {
      credor_id: 'c1',
      competencia: '2026-03-01',
      uf: 'SP',
      recebido_abe: '2500.00',
      pagamento_direto: '300.00',
    },
    // Mês sem envio: repasse tem eixo de tempo próprio.
    {
      credor_id: 'c2',
      competencia: '2026-05-01',
      uf: 'RJ',
      recebido_abe: '500.00',
      pagamento_direto: '0',
    },
  ],
  posicao: [
    { credor_id: 'c1', uf: 'SP', ativo_saldo_devedor: '6000.00', ativo_qtd: 60 },
    { credor_id: 'c2', uf: 'RJ', ativo_saldo_devedor: '1000.00', ativo_qtd: 5 },
  ],
  classe: [
    {
      credor_id: 'c1',
      competencia: '2026-03-01',
      uf: 'SP',
      tipo_classe: 'acordo',
      classe: 'em_cobranca',
      valor_original: '7000.00',
      saldo: '5000.00',
      qtd_processos: 70,
    },
    {
      credor_id: 'c1',
      competencia: '2026-03-01',
      uf: 'SP',
      tipo_classe: 'acordo',
      classe: 'acordo_com_pagamento',
      valor_original: '3000.00',
      saldo: '0',
      qtd_processos: 30,
    },
    {
      credor_id: 'c2',
      competencia: '2026-03-01',
      uf: 'RJ',
      tipo_classe: 'devolucao',
      classe: 'incobravel',
      valor_original: '800.00',
      saldo: '0',
      qtd_processos: 8,
    },
  ],
};

const faixas = [
  { faixa_idade: '0-30', bordero_valor: '4000.00', recebido_valor: '2000.00' },
  { faixa_idade: '180+', bordero_valor: '8000.00', recebido_valor: '1000.00' },
];

describe('montarKpis', () => {
  it('soma os dois credores e não concatena strings', () => {
    const k = montarKpis(ag);
    assert.match(k.kpiBordero[0]!.valor, /12\.000,00/);
    assert.equal(k.kpiBordero[1]!.valor, '110');
  });

  it('idade média é soma ÷ contagem, não média das médias', () => {
    // c1: 3000/100 = 30 dias · c2: 2000/10 = 200 dias
    // Média das médias daria 115. O certo é 5000/110 = 45,45 → 45.
    const k = montarKpis(ag);
    assert.equal(k.kpiBordero[2]!.valor, '45 dias');
  });

  it('efetividade sai dos totais', () => {
    // 3000 recebido / 12000 enviado = 25%
    const k = montarKpis(ag);
    assert.equal(k.kpiFinanceiro[2]!.valor, '25%');
  });

  it('ticket médio não divide por zero', () => {
    const vazio: Agregados = { bordero: [], repasse: [], posicao: [], classe: [] };
    const k = montarKpis(vazio);
    assert.match(k.kpiCarteiraAtiva[2]!.valor, /0,00/);
  });
});

describe('filtrar', () => {
  it('um credor isola, em todas as tabelas', () => {
    const so1 = filtrar(ag, { credorIds: ['c1'] });
    assert.equal(so1.bordero.length, 1);
    assert.equal(so1.repasse.length, 1);
    assert.equal(so1.posicao.length, 1);
    assert.equal(so1.classe.length, 2);

    const k = montarKpis(so1);
    assert.match(k.kpiBordero[0]!.valor, /10\.000,00/);
  });

  it('dois credores somam os dois, e só eles', () => {
    const dois = filtrar(ag, { credorIds: ['c1', 'c2'] });
    const k = montarKpis(dois);
    assert.match(k.kpiBordero[0]!.valor, /12\.000,00/, 'soma de c1 (10.000) e c2 (2.000)');
    assert.equal(k.kpiBordero[1]!.valor, '110');
  });

  it('credor inexistente na lista não traz linha nenhuma', () => {
    const nada = filtrar(ag, { credorIds: ['nao-existe'] });
    assert.equal(nada.bordero.length, 0);
    assert.equal(nada.posicao.length, 0);
  });

  it('lista VAZIA consolida todos — não zera a tela', () => {
    // Desmarcar o último credor devolve ao consolidado. "Nenhum credor" não é
    // uma escolha que alguém faça de propósito.
    const todos = filtrar(ag, { credorIds: [] });
    assert.equal(todos.bordero.length, 2);
  });

  it('sem o campo, consolida todos', () => {
    assert.equal(filtrar(ag, {}).bordero.length, 2);
  });

  it('id repetido não duplica a soma', () => {
    const repetido = filtrar(ag, { credorIds: ['c1', 'c1'] });
    assert.equal(repetido.bordero.length, 1);
    assert.match(montarKpis(repetido).kpiBordero[0]!.valor, /10\.000,00/);
  });

  it('filtro de UF alcança a posição, que não tem competência', () => {
    const sp = filtrar(ag, { uf: 'SP' });
    assert.equal(sp.posicao.length, 1);
    assert.equal(sp.posicao[0]!.credor_id, 'c1');
  });

  it('período não corta a posição — saldo ativo é de hoje, não do período', () => {
    const r = filtrar(ag, { de: '2026-04-01', ate: '2026-12-31' });
    assert.equal(r.bordero.length, 0, 'março ficou fora do período');
    assert.equal(r.posicao.length, 2, 'a posição não pode ser filtrada por competência');
  });
});

describe('montarEnviadoRecebido', () => {
  it('inclui mês que só teve recebimento', () => {
    const meses = montarEnviadoRecebido(ag);
    const maio = meses.find((m) => m.mes === '2026-05-01');
    assert.ok(maio, 'mês com repasse e sem envio precisa aparecer');
    assert.equal(maio.enviado, 0);
    assert.equal(maio.recebido, 500);
  });
});

describe('montarAcordos', () => {
  it('mostra o saldo quando existe, e o original quando não', () => {
    const linhas = montarAcordos(ag);
    const cobranca = linhas.find((l) => l.metrica === 'Em cobrança')!;
    const comPagamento = linhas.find((l) => l.metrica === 'Acordo com pagamento')!;

    assert.match(cobranca.valor, /5\.000,00/, 'com saldo, mostra o saldo');
    assert.match(comPagamento.valor, /3\.000,00/, 'sem saldo, cai no valor original');
  });

  it('a ordem das categorias é fixa, não segue o tamanho', () => {
    // Cor e posição seguem a categoria: filtrar não pode repintar as demais.
    const linhas = montarAcordos(ag);
    assert.deepEqual(
      linhas.map((l) => l.metrica),
      ['Acordo com pagamento', 'Em cobrança'],
    );
  });
});

describe('montarBaixas', () => {
  it('traz motivo, definição e contagem de processos', () => {
    const linhas = montarBaixas(ag);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]!.motivo, 'Incobrável');
    assert.equal(linhas[0]!.quantidade, 8);
    assert.ok(linhas[0]!.definicao.length > 0);
  });
});

describe('montarRosca', () => {
  it('percentuais sobre o total das classes de acordo', () => {
    const fatias = montarRosca(ag);
    assert.equal(fatias.length, 2);
    assert.equal(fatias.find((f) => f.label === 'Em cobrança')!.pct, 70);
    assert.equal(fatias.find((f) => f.label === 'Acordo com pagamento')!.pct, 30);
  });

  it('sem acordos, devolve vazio em vez de fatia de 0%', () => {
    assert.deepEqual(montarRosca({ ...ag, classe: [] }), []);
  });
});

describe('montarUf', () => {
  it('separa estados e calcula efetividade de cada um', () => {
    const ufs = montarUf(ag);
    const sp = ufs.find((u) => u.uf === 'SP')!;
    assert.equal(sp.enviado, 10000);
    assert.equal(sp.recebido, 2500);
    assert.equal(sp.efetividade, 25);
    assert.equal(sp.ativo, 6000);
  });

  it('devolvido vem só das classes de devolução', () => {
    const rj = montarUf(ag).find((u) => u.uf === 'RJ')!;
    assert.equal(rj.devolvido, 800);
  });
});

describe('montarFaixas', () => {
  it('mantém a ordem das faixas e omite as ausentes', () => {
    const { efetividadePorIdade } = montarFaixas(faixas);
    assert.deepEqual(
      efetividadePorIdade.map((f) => f.idade),
      ['0-30d', '180+d'],
    );
    assert.equal(efetividadePorIdade[0]!.efetividade, 50);
  });
});

describe('montarDashboardDeAgregados', () => {
  it('devolve todos os blocos que a tela consome', () => {
    const p = montarDashboardDeAgregados(ag, faixas);

    for (const bloco of [
      'kpiBordero',
      'kpiFinanceiro',
      'kpiCarteiraAtiva',
      'tabelaAcordos',
      'tabelaBaixas',
      'carteiraRosca',
      'enviadoRecebidoMensal',
      'efetividadePorIdade',
      'faixaIdadeComparativo',
      'metricasUf',
      'composicaoAtores',
    ] as const) {
      assert.ok(p[bloco], `bloco ausente: ${bloco}`);
    }
  });

  it('sem dado nenhum, não inventa ator com 100%', () => {
    const p = montarDashboardDeAgregados({ bordero: [], repasse: [], posicao: [], classe: [] }, []);
    assert.deepEqual(p.composicaoAtores, []);
  });
});
