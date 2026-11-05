/**
 * O que estes testes seguram: a promessa da DEC-0071 de que o gráfico se adapta
 * ao formato que CADA tipo de relatório devolve, em vez de assumir a linha
 * temporal do protótipo fictício. Um gráfico que ignora o formato recebido não
 * quebra — ele desenha algo plausível e errado, que é pior.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PontoSerie } from './relatorios-ia/executor.ts';
import {
  formatarMarcaEixo,
  formatarValorSerie,
  montarEspecGrafico,
  nomeArquivoCsv,
  tabelaParaCsv,
} from './relatorios-visualizacao.ts';

/** Série como o executor monta para CARTEIRA_ATIVA: por UF, não por mês. */
const SERIE_UF: PontoSerie[] = [
  { periodo: 'SP', rotulo: 'SP', ativo: 412000, enviado: 120000, recebido: 44000 },
  { periodo: 'MG', rotulo: 'MG', ativo: 207000, enviado: 80000, recebido: 21000 },
];

const SERIE_MESES: PontoSerie[] = [
  { periodo: '2026-09-01', rotulo: 'Set/26', enviado: 495000, recebido: 201000 },
  { periodo: '2026-10-01', rotulo: 'Out/26', enviado: 512000, recebido: 207000 },
];

const SERIE_CLASSES: PontoSerie[] = [
  { periodo: 'Acordo a receber', rotulo: 'Acordo a receber', quantidade: 12 },
  { periodo: 'Quebra de acordo', rotulo: 'Quebra de acordo', quantidade: 3 },
];

const SERIE_FAIXAS: PontoSerie[] = [
  { periodo: '0-30', rotulo: '0-30', enviado: 100, recebido: 40, efetividade: 40 },
];

describe('montarEspecGrafico — forma por tipo de relatório (DEC-0071)', () => {
  it('BORDERO e POSICAO_MENSAL são série no tempo → linha', () => {
    assert.equal(montarEspecGrafico('BORDERO', SERIE_MESES)?.forma, 'linha');
    assert.equal(montarEspecGrafico('POSICAO_MENSAL', SERIE_MESES)?.forma, 'linha');
  });

  it('CARTEIRA_ATIVA vem por UF — categoria, não linha do tempo', () => {
    const espec = montarEspecGrafico('CARTEIRA_ATIVA', SERIE_UF);
    assert.equal(espec?.forma, 'barra');
    assert.deepEqual(
      espec?.series.map((s) => s.chave),
      ['ativo', 'enviado', 'recebido'],
    );
  });

  it('ACORDOS e BAIXAS são categorias → barra', () => {
    assert.equal(montarEspecGrafico('ACORDOS', SERIE_CLASSES)?.forma, 'barra');
    assert.equal(montarEspecGrafico('BAIXAS', SERIE_CLASSES)?.forma, 'barra');
  });
});

describe('montarEspecGrafico — uma unidade por eixo', () => {
  it('havendo R$ e %, o gráfico fica com o R$ e deixa o % para a tabela', () => {
    const espec = montarEspecGrafico('CLASSIFICACAO_IDADE', SERIE_FAIXAS);
    assert.equal(espec?.unidade, 'MOEDA');
    assert.deepEqual(
      espec?.series.map((s) => s.chave),
      ['enviado', 'recebido'],
    );
  });

  it('sem valor em R$, a unidade é a da primeira série', () => {
    const espec = montarEspecGrafico('ACORDOS', SERIE_CLASSES);
    assert.equal(espec?.unidade, 'QUANTIDADE');
    assert.equal(espec?.legendaEixo, 'Quantidade de processos');
  });

  it('cada série ganha uma cor da marca, sem repetir entre vizinhas', () => {
    const espec = montarEspecGrafico('POSICAO_MENSAL', SERIE_MESES);
    assert.equal(espec?.series.length, 2);
    assert.notEqual(espec?.series[0].cor, espec?.series[1].cor);
  });
});

describe('montarEspecGrafico — nada para desenhar', () => {
  it('série vazia devolve null (a tela mostra "sem dados", não um eixo vazio)', () => {
    assert.equal(montarEspecGrafico('CARTEIRA_ATIVA', []), null);
  });

  it('ponto só com rótulo, sem número, também devolve null', () => {
    const serie = [{ periodo: 'SP', rotulo: 'SP' }] as unknown as PontoSerie[];
    assert.equal(montarEspecGrafico('CARTEIRA_ATIVA', serie), null);
  });
});

describe('formatação dos valores', () => {
  it('moeda usa a mesma formatação do resto do painel', () => {
    assert.equal(formatarValorSerie(1234.5, 'MOEDA').replace(/\s/g, ' '), 'R$ 1.234,50');
  });

  it('percentual e quantidade saem em pt-BR', () => {
    assert.equal(formatarValorSerie(40, 'PERCENTUAL'), '40%');
    assert.equal(formatarValorSerie(1500, 'QUANTIDADE'), '1.500');
  });

  it('a marca do eixo abrevia e omite o R$ — a legenda já diz a unidade', () => {
    assert.equal(formatarMarcaEixo(450000, 'MOEDA'), '450 mil');
    assert.equal(formatarMarcaEixo(2500000, 'MOEDA'), '2,5 mi');
    assert.equal(formatarMarcaEixo(0, 'MOEDA'), '0');
  });

  it('marca de eixo em % e em quantidade não muda', () => {
    assert.equal(formatarMarcaEixo(40, 'PERCENTUAL'), '40%');
    assert.equal(formatarMarcaEixo(1500, 'QUANTIDADE'), '1.500');
  });
});

describe('tabelaParaCsv', () => {
  it('usa ; como separador (Excel pt-BR) e CRLF entre linhas', () => {
    const csv = tabelaParaCsv({
      colunas: ['Mês', 'Enviado'],
      linhas: [['Out/26', 'R$ 512.000,00']],
    });
    assert.equal(csv, 'Mês;Enviado\r\nOut/26;R$ 512.000,00');
  });

  it('escapa aspas, ponto e vírgula e quebra de linha', () => {
    const csv = tabelaParaCsv({
      colunas: ['A'],
      linhas: [['diz "oi"; e pula\nlinha']],
    });
    assert.equal(csv, 'A\r\n"diz ""oi""; e pula\nlinha"');
  });

  it('célula nula vira campo vazio, nunca a palavra null', () => {
    const csv = tabelaParaCsv({ colunas: ['A', 'B'], linhas: [[null, 3]] });
    assert.equal(csv, 'A;B\r\n;3');
  });
});

describe('nomeArquivoCsv', () => {
  it('nome previsível, em minúsculas e com a data do dia', () => {
    assert.equal(
      nomeArquivoCsv('POSICAO_MENSAL', new Date('2026-11-05T12:00:00Z')),
      'relatorio-posicao-mensal-2026-11-05.csv',
    );
  });
});
