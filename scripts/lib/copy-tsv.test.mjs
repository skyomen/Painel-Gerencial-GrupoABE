import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COLUNAS_CARTEIRA,
  comandoCopy,
  escaparCopy,
  linhaParaCopy,
  linhasParaCopy,
} from './copy-tsv.mjs';

const BARRA = String.fromCharCode(92);
const NULO = BARRA + 'N';
const TAB = '\t';

describe('escaparCopy', () => {
  it('null e undefined viram nulo do COPY; string vazia NÃO', () => {
    // Confundir os dois faz `tipo` virar '' onde deveria ser nulo — e a
    // classificação de pagamento direto olha justamente `tipo = ''`.
    assert.equal(escaparCopy(null), NULO);
    assert.equal(escaparCopy(undefined), NULO);
    assert.equal(escaparCopy(''), '');
  });

  it('TAB dentro do texto não pode virar separador', () => {
    assert.equal(escaparCopy('ACME' + TAB + 'LTDA'), 'ACME' + BARRA + 'tLTDA');
  });

  it('quebra de linha não pode criar uma linha nova', () => {
    assert.equal(escaparCopy('linha1\nlinha2'), 'linha1' + BARRA + 'nlinha2');
    assert.equal(escaparCopy('a\r\nb'), 'a' + BARRA + 'r' + BARRA + 'nb');
  });

  it('contrabarra é escapada antes das outras, sem duplicar', () => {
    assert.equal(escaparCopy('C:' + BARRA + 'temp'), 'C:' + BARRA + BARRA + 'temp');
    // Se a ordem estivesse trocada, o texto "\t" viraria TAB escapado em vez
    // de duas contrabarras seguidas de "t".
    assert.equal(escaparCopy('a' + BARRA + 'tb'), 'a' + BARRA + BARRA + 'tb');
  });

  it('número e zero passam como texto, sem virar nulo', () => {
    assert.equal(escaparCopy(0), '0');
    assert.equal(escaparCopy(1234.56), '1234.56');
  });
});

describe('linhaParaCopy', () => {
  it('segue a ordem das colunas e marca ausentes como nulo', () => {
    const campos = linhaParaCopy({
      credor_id: 'c1',
      sistema_origem: 'ABE_WEB',
      processo: '99',
    }).split(TAB);

    assert.equal(campos.length, COLUNAS_CARTEIRA.length);
    assert.equal(campos[0], 'c1');
    assert.equal(campos[1], 'ABE_WEB');
    assert.equal(campos[2], '99');
    assert.equal(campos[3], NULO, 'data_inclusao ausente tem de ser nulo, não vazio');
  });

  it('texto com TAB não desalinha as colunas seguintes', () => {
    const campos = linhaParaCopy({
      credor_id: 'c1',
      sistema_origem: 'ABE_WEB',
      status: 'Ativo',
      visao_geral_carteira: 'Em' + TAB + 'cobrança',
      uf: 'SP',
    }).split(TAB);

    assert.equal(campos.length, COLUNAS_CARTEIRA.length, 'o TAB do texto virou separador');
    assert.equal(campos[COLUNAS_CARTEIRA.indexOf('uf')], 'SP', 'a UF saiu do lugar');
  });
});

describe('linhasParaCopy', () => {
  it('lista vazia não gera linha em branco', () => {
    assert.equal(linhasParaCopy([]), '');
    assert.equal(linhasParaCopy(null), '');
  });

  it('termina em LF, como o COPY espera', () => {
    const saida = linhasParaCopy([{ credor_id: 'a' }, { credor_id: 'b' }]);
    assert.ok(saida.endsWith('\n'));
    assert.equal(saida.trimEnd().split('\n').length, 2);
  });
});

describe('comandoCopy', () => {
  it('nomeia as colunas — nunca posicional', () => {
    // Sem a lista explícita, acrescentar uma coluna na tabela desalinha tudo.
    const cmd = comandoCopy();
    assert.ok(cmd.includes('(credor_id, sistema_origem,'));
    assert.ok(cmd.endsWith('FROM STDIN'));
  });
});
