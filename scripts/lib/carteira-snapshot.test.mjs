import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizarLinhaCarteira, parseIdadeDias } from './carteira-snapshot.mjs';

describe('parseIdadeDias', () => {
  it('aceita número e texto, que é como a 749 devolve', () => {
    assert.equal(parseIdadeDias(45), 45);
    assert.equal(parseIdadeDias('45'), 45);
    assert.equal(parseIdadeDias(' 120 '), 120);
    assert.equal(parseIdadeDias(0), 0);
  });

  it('ausente vira null, não zero', () => {
    // Zero contaria na faixa "0-30" e na média de idade — dado inventado.
    for (const v of [null, undefined, '', '   ', 'abc']) {
      assert.equal(parseIdadeDias(v), null, `valor: ${JSON.stringify(v)}`);
    }
  });

  it('idade negativa vira null', () => {
    // Título que vence depois do cadastro. Existe na origem e não é faixa etária.
    assert.equal(parseIdadeDias(-5), null);
    assert.equal(parseIdadeDias('-30'), null);
  });
});

describe('normalizarLinhaCarteira', () => {
  it('leva a idade para a linha gravada', () => {
    const linha = normalizarLinhaCarteira(
      {
        Processo: 123,
        'Data Inclusão': '10/03/2026',
        'Idade Titulo Cadastramento': '45',
        Estado: 'SP',
      },
      'credor-1',
      'ABE_WEB',
    );

    assert.equal(linha.idade_dias, 45);
    assert.equal(linha.data_inclusao, '2026-03-10');
    assert.equal(linha.processo, '123');
  });

  it('linha sem idade não trava a gravação', () => {
    const linha = normalizarLinhaCarteira({ Processo: 9 }, 'credor-1', 'ABE_WEB');
    assert.equal(linha.idade_dias, null);
  });
});
