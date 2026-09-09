import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  codigosDoCredor,
  credorTemCodigo,
  filtrarElegiveis,
  resumirDescartados,
} from './elegibilidade.mjs';

const comWeb = { id: 'a', tenant_id: 't1', razao_social: 'Com WEB', cod_cliente_principal: '749' };
const soDelphi = {
  id: 'b',
  tenant_id: 't2',
  razao_social: 'Só Delphi',
  abe_delphi_cliente_id: '55',
};
const soFilial = {
  id: 'c',
  tenant_id: 't3',
  razao_social: 'Só filial',
  codigos_cliente: [{ cod_cliente: '900' }],
};
const semNada = { id: 'd', tenant_id: 't4', razao_social: 'Sem código' };
const vazios = {
  id: 'e',
  tenant_id: 't5',
  razao_social: 'Só espaços',
  cod_cliente_principal: '   ',
  codigos_cliente: [{ cod_cliente: '' }],
};

describe('codigosDoCredor', () => {
  it('junta os três sistemas sem repetir', () => {
    const credor = {
      cod_cliente_principal: '749',
      abe_delphi_cliente_id: '55',
      codigos_cliente: [{ cod_cliente: '900' }, { cod_cliente: '749' }],
    };
    assert.deepEqual(codigosDoCredor(credor), ['749', '55', '900']);
  });

  it('espaço em branco não é código', () => {
    assert.deepEqual(codigosDoCredor(vazios), []);
    assert.equal(credorTemCodigo(vazios), false);
  });
});

describe('filtrarElegiveis', () => {
  const todos = [comWeb, soDelphi, soFilial, semNada, vazios];

  it('padrão: entra quem tem código em qualquer sistema', () => {
    const r = filtrarElegiveis(todos);
    assert.deepEqual(
      r.map((c) => c.id),
      ['a', 'b', 'c'],
      'credor só com código no Delphi ou só em filial precisa entrar',
    );
  });

  it('regra antiga continua disponível', () => {
    const r = filtrarElegiveis(todos, {
      exigirResponsavel: true,
      tenantsComResponsavel: new Set(['t1']),
    });
    assert.deepEqual(
      r.map((c) => c.id),
      ['a'],
    );
  });

  it('ter responsável não basta: sem código não há o que buscar', () => {
    const r = filtrarElegiveis([semNada], {
      exigirResponsavel: true,
      tenantsComResponsavel: new Set(['t4']),
    });
    assert.deepEqual(r, []);
  });
});

describe('resumirDescartados', () => {
  it('separa quem caiu por falta de código de quem caiu por falta de login', () => {
    const todos = [comWeb, soDelphi, semNada];
    const elegiveis = filtrarElegiveis(todos, {
      exigirResponsavel: true,
      tenantsComResponsavel: new Set(['t1']),
    });

    const { semCodigo, semResponsavel } = resumirDescartados(todos, elegiveis);
    assert.deepEqual(semCodigo, ['Sem código']);
    assert.deepEqual(semResponsavel, ['Só Delphi']);
  });
});
