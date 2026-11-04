import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONFIG_PADRAO,
  mapearConfig,
  mascararChave,
  validarEntradaConfig,
  type LinhaConfigAgente,
} from './config.ts';

describe('mascararChave', () => {
  it('monta o formato exato do protótipo', () => {
    assert.equal(mascararChave('A1b2'), `sk-${'•'.repeat(12)}A1b2`);
    assert.equal(mascararChave('A1b2'), 'sk-••••••••••••A1b2');
  });

  it('sem quatro dígitos não inventa máscara', () => {
    assert.equal(mascararChave(null), null);
    assert.equal(mascararChave(undefined), null);
    assert.equal(mascararChave(''), null);
    assert.equal(mascararChave('   '), null);
  });
});

describe('mapearConfig', () => {
  it('não deixa a chave nem o ponteiro do Vault escaparem', () => {
    const linha: LinhaConfigAgente = {
      provedor: 'OPENAI',
      modelo: 'gpt-5',
      ativo: true,
      api_key_secret_id: '11111111-1111-1111-1111-111111111111',
      api_key_ultimos4: 'A1b2',
      api_key_atualizada_em: '2026-11-03T12:14:00Z',
      tom_de_voz: 'DIRETO',
      idioma: 'pt-BR',
      proibicoes: ['Afirmar um valor sem citar período e fonte'],
      rodape_obrigatorio: 'Sujeito a conferência.',
      limite_perguntas_credor_dia: '30',
      alerta_custo_mensal_brl: '1500.00',
      catalogo_habilitado: ['BORDERO', 'ACORDOS', 'NAO_EXISTE'],
    };

    const cfg = mapearConfig(linha);

    assert.equal(cfg.chaveConfigurada, true);
    assert.equal(cfg.chaveMascarada, 'sk-••••••••••••A1b2');
    assert.equal(cfg.tomDeVoz, 'DIRETO');
    // NUMERIC/INTEGER chegam como string pelo PostgREST.
    assert.equal(cfg.limitePerguntasCredorDia, 30);
    assert.equal(cfg.alertaCustoMensalBrl, 1500);
    // Tipo fora do ENUM é descartado, não propagado.
    assert.deepEqual(cfg.catalogoHabilitado, ['BORDERO', 'ACORDOS']);

    const serializado = JSON.stringify(cfg);
    assert.ok(!serializado.includes('11111111-1111'), 'o UUID do segredo não pode sair daqui');
    assert.ok(!serializado.includes('api_key'), 'nenhum campo cru de chave pode sair daqui');
  });

  it('linha sem chave reporta chave não configurada', () => {
    const cfg = mapearConfig({ provedor: 'OPENAI', modelo: 'gpt-5', ativo: false });
    assert.equal(cfg.chaveConfigurada, false);
    assert.equal(cfg.chaveMascarada, null);
    assert.equal(cfg.tomDeVoz, CONFIG_PADRAO.tomDeVoz);
    assert.deepEqual(cfg.catalogoHabilitado, CONFIG_PADRAO.catalogoHabilitado);
  });
});

describe('validarEntradaConfig', () => {
  it('a apiKey sai separada e nunca entra em valores', () => {
    const r = validarEntradaConfig({ apiKey: 'sk-chave-de-verdade-1234', ativo: true });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.apiKey, 'sk-chave-de-verdade-1234');
    assert.deepEqual(r.valores, { ativo: true });
    assert.ok(
      !JSON.stringify(r.valores).includes('sk-chave'),
      'a chave não pode viajar dentro do UPDATE de coluna',
    );
  });

  it('apiKey curta é rejeitada', () => {
    const r = validarEntradaConfig({ apiKey: 'sk-123' });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.detalhes.some((d) => d.includes('apiKey')));
  });

  it('campo desconhecido é rejeitado, nunca ignorado', () => {
    const r = validarEntradaConfig({ ativo: true, singleton: false, atualizadoPor: 'eu' });
    assert.equal(r.ok, false);
    if (r.ok) return;

    const d = r.detalhes.join(' | ');
    assert.ok(d.includes('singleton'));
    assert.ok(d.includes('atualizadoPor'));
  });

  it('PATCH parcial: campo ausente não vira default', () => {
    const r = validarEntradaConfig({ modelo: ' gpt-5-mini ' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.valores, { modelo: 'gpt-5-mini' });
  });

  it('traduz camelCase para as colunas snake_case', () => {
    const r = validarEntradaConfig({
      tomDeVoz: 'FORMAL',
      rodapeObrigatorio: 'Sujeito a conferência.',
      limitePerguntasCredorDia: 30,
      alertaCustoMensalBrl: 1500,
      catalogoHabilitado: ['BORDERO', 'BORDERO', 'ACORDOS'],
      proibicoes: [' Nada de SQL '],
    });

    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.valores, {
      tom_de_voz: 'FORMAL',
      rodape_obrigatorio: 'Sujeito a conferência.',
      limite_perguntas_credor_dia: 30,
      alerta_custo_mensal_brl: 1500,
      catalogo_habilitado: ['BORDERO', 'ACORDOS'],
      proibicoes: ['Nada de SQL'],
    });
  });

  it('recusa valores fora de faixa e tipos errados', () => {
    const casos: [string, unknown][] = [
      ['provedor', 'ANTHROPIC'],
      ['modelo', '   '],
      ['ativo', 'sim'],
      ['tomDeVoz', 'IRÔNICO'],
      ['idioma', ''],
      ['proibicoes', 'nada de SQL'],
      ['rodapeObrigatorio', ''],
      ['limitePerguntasCredorDia', 0],
      ['limitePerguntasCredorDia', 1001],
      ['limitePerguntasCredorDia', 3.5],
      ['alertaCustoMensalBrl', -1],
      ['catalogoHabilitado', []],
      ['catalogoHabilitado', ['USUARIOS']],
    ];

    for (const [campo, valor] of casos) {
      const r = validarEntradaConfig({ [campo]: valor });
      assert.equal(r.ok, false, `${campo}=${JSON.stringify(valor)} não pode passar`);
    }
  });

  it('corpo que não é objeto é rejeitado', () => {
    for (const v of [null, 'ativo', 7, [1, 2]]) {
      assert.equal(validarEntradaConfig(v).ok, false);
    }
  });
});
