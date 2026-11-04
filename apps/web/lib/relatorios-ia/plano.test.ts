import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ESQUEMA_PLANO_JSON, validarPlano } from './plano.ts';
import { TIPOS_RELATORIO, type TipoRelatorio } from './catalogo.ts';

const TODOS = [...TIPOS_RELATORIO] as TipoRelatorio[];

function base(extra: Record<string, unknown> = {}) {
  return {
    tipoRelatorio: 'CARTEIRA_ATIVA',
    periodo: { inicio: '2026-05-01', fim: '2026-10-31' },
    filtros: { uf: null, sistemaOrigem: 'TODOS' },
    ...extra,
  };
}

function detalhesDe(r: ReturnType<typeof validarPlano>): string[] {
  return r.ok ? [] : r.detalhes;
}

describe('validarPlano — catálogo', () => {
  it('tipoRelatorio fora do catálogo é rejeitado', () => {
    for (const tipo of ['USUARIOS', 'SQL_LIVRE', '', null, 42]) {
      const r = validarPlano(base({ tipoRelatorio: tipo }), { catalogoHabilitado: TODOS });
      assert.equal(r.ok, false, `${JSON.stringify(tipo)} não pode passar`);
      assert.ok(detalhesDe(r).some((d) => d.includes('tipoRelatorio')));
    }
  });

  it('tipo válido mas não habilitado é rejeitado', () => {
    const r = validarPlano(base({ tipoRelatorio: 'BAIXAS' }), {
      catalogoHabilitado: ['CARTEIRA_ATIVA', 'BORDERO'],
    });
    assert.equal(r.ok, false);
    assert.ok(detalhesDe(r).some((d) => d.includes('não está habilitado')));
  });

  it('tipo habilitado passa', () => {
    const r = validarPlano(base(), { catalogoHabilitado: ['CARTEIRA_ATIVA'] });
    assert.equal(r.ok, true);
  });
});

describe('validarPlano — lista branca de campos', () => {
  it('rejeita campo de dono enxertado na raiz', () => {
    const r = validarPlano(
      base({ tenantId: 'outro-tenant', credorId: 'outro-credor', sql: 'select * from usuarios' }),
      { catalogoHabilitado: TODOS },
    );

    assert.equal(r.ok, false);
    const d = detalhesDe(r).join(' | ');
    assert.ok(d.includes('tenantId'), 'tenantId tem de aparecer nos detalhes');
    assert.ok(d.includes('credorId'), 'credorId tem de aparecer nos detalhes');
    assert.ok(d.includes('sql'), 'sql tem de aparecer nos detalhes');
  });

  it('rejeita campo desconhecido dentro de periodo e de filtros', () => {
    const comPeriodo = validarPlano(
      base({ periodo: { inicio: '2026-05-01', fim: '2026-10-31', tabela: 'carteira_snapshot' } }),
      { catalogoHabilitado: TODOS },
    );
    assert.equal(comPeriodo.ok, false);
    assert.ok(detalhesDe(comPeriodo).some((d) => d.includes('periodo') && d.includes('tabela')));

    const comFiltros = validarPlano(
      base({ filtros: { uf: null, sistemaOrigem: 'TODOS', credorId: 'x' } }),
      { catalogoHabilitado: TODOS },
    );
    assert.equal(comFiltros.ok, false);
    assert.ok(detalhesDe(comFiltros).some((d) => d.includes('filtros') && d.includes('credorId')));
  });

  it('rejeita entrada que não é objeto', () => {
    for (const v of [null, 'plano', 42, ['CARTEIRA_ATIVA']]) {
      assert.equal(validarPlano(v, { catalogoHabilitado: TODOS }).ok, false);
    }
  });
});

describe('validarPlano — período', () => {
  it('rejeita data fora do formato ou inexistente', () => {
    for (const inicio of ['01/05/2026', '2026-5-1', '2026-02-30', '2026-13-01', '', null]) {
      const r = validarPlano(base({ periodo: { inicio, fim: '2026-10-31' } }), {
        catalogoHabilitado: TODOS,
      });
      assert.equal(r.ok, false, `${JSON.stringify(inicio)} não é data válida`);
    }
  });

  it('rejeita inicio posterior a fim', () => {
    const r = validarPlano(base({ periodo: { inicio: '2026-10-31', fim: '2026-05-01' } }), {
      catalogoHabilitado: TODOS,
    });
    assert.equal(r.ok, false);
    assert.ok(detalhesDe(r).some((d) => d.includes('posterior')));
  });

  it('rejeita janela maior que 36 meses e aceita exatamente 36', () => {
    const demais = validarPlano(base({ periodo: { inicio: '2023-01-01', fim: '2026-01-02' } }), {
      catalogoHabilitado: TODOS,
    });
    assert.equal(demais.ok, false);
    assert.ok(detalhesDe(demais).some((d) => d.includes('36 meses')));

    const limite = validarPlano(base({ periodo: { inicio: '2023-01-01', fim: '2026-01-01' } }), {
      catalogoHabilitado: TODOS,
    });
    assert.equal(limite.ok, true, '36 meses cravados continuam válidos');
  });

  it('periodo ausente é rejeitado', () => {
    const r = validarPlano({ tipoRelatorio: 'BORDERO' }, { catalogoHabilitado: TODOS });
    assert.equal(r.ok, false);
    assert.ok(detalhesDe(r).some((d) => d.includes('periodo')));
  });
});

describe('validarPlano — normalização', () => {
  it('uf vira maiúscula e ausente vira null', () => {
    const comUf = validarPlano(base({ filtros: { uf: ' sp ' } }), { catalogoHabilitado: TODOS });
    assert.equal(comUf.ok, true);
    assert.equal(comUf.ok && comUf.plano.filtros.uf, 'SP');

    const semFiltros = validarPlano(
      { tipoRelatorio: 'BORDERO', periodo: { inicio: '2026-01-01', fim: '2026-03-31' } },
      { catalogoHabilitado: TODOS },
    );
    assert.equal(semFiltros.ok, true);
    assert.deepEqual(semFiltros.ok && semFiltros.plano.filtros, {
      uf: null,
      sistemaOrigem: 'TODOS',
    });
  });

  it('uf fora das 27 é rejeitada', () => {
    const r = validarPlano(base({ filtros: { uf: 'XX' } }), { catalogoHabilitado: TODOS });
    assert.equal(r.ok, false);
    assert.ok(detalhesDe(r).some((d) => d.includes('uf')));
  });

  it('sistemaOrigem inválido é rejeitado', () => {
    const r = validarPlano(base({ filtros: { sistemaOrigem: 'AVANTPAY' } }), {
      catalogoHabilitado: TODOS,
    });
    assert.equal(r.ok, false);
  });

  it('devolve objeto novo, sem herdar referência do que veio do modelo', () => {
    const entrada = base();
    const r = validarPlano(entrada, { catalogoHabilitado: TODOS });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.notEqual(r.plano, entrada);
    assert.notEqual(r.plano.periodo, entrada.periodo);
    assert.notEqual(r.plano.filtros, entrada.filtros);
    assert.deepEqual(Object.keys(r.plano).sort(), ['filtros', 'periodo', 'tipoRelatorio']);
  });
});

describe('ESQUEMA_PLANO_JSON', () => {
  it('fecha additionalProperties e exige todos os campos em todos os níveis', () => {
    const raiz = ESQUEMA_PLANO_JSON as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { additionalProperties?: boolean; required?: string[] }>;
    };

    assert.equal(raiz.additionalProperties, false);
    assert.deepEqual(raiz.required.sort(), ['filtros', 'periodo', 'tipoRelatorio']);
    assert.equal(raiz.properties.periodo.additionalProperties, false);
    assert.deepEqual(raiz.properties.periodo.required?.sort(), ['fim', 'inicio']);
    assert.equal(raiz.properties.filtros.additionalProperties, false);
    assert.deepEqual(raiz.properties.filtros.required?.sort(), ['sistemaOrigem', 'uf']);
  });
});
