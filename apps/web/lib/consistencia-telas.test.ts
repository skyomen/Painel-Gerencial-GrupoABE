/**
 * A tela do credor e a da diretoria filtrada por aquele credor têm de mostrar
 * O MESMO NÚMERO.
 *
 * São dois caminhos independentes:
 *   credor    → carteira_snapshot → calc-metricas-carteira.ts (em memória)
 *   diretoria → agregados         → payload-de-agregados.ts
 *
 * A classificação é comum (a view), mas a montagem foi escrita duas vezes.
 * Enquanto as duas existirem, só um teste como este garante que concordam —
 * e divergência aqui é do pior tipo: dois números plausíveis, na mesma
 * ferramenta, contando histórias diferentes sobre o mesmo credor.
 *
 * Precisa do Postgres local (`pnpm docker:tools`). Sem Docker, o teste é
 * PULADO em vez de falhar — mas então ele não está provando nada, e o skip
 * aparece na saída de propósito.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { calcularMetricasCarteira } from './calc-metricas-carteira.ts';
import { filtrar, montarDashboardDeAgregados, type Agregados } from './payload-de-agregados.ts';
import {
  CREDOR_TESTE,
  fixtureComoInsert,
  LINHAS_FIXTURE,
  PERIODO_TESTE,
} from './fixture-carteira.ts';

const CONTAINER = 'abe-postgres';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'painel_abe',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function bancoDisponivel(): boolean {
  try {
    psql('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Recria o cenário no banco e devolve os agregados como o app os leria. */
function prepararAgregados(): { ag: Agregados; faixas: unknown[] } {
  psql(`DELETE FROM public.carteira_snapshot WHERE credor_id = '${CREDOR_TESTE}'`);
  psql(fixtureComoInsert());
  psql(`SELECT public.refresh_agregados_credor('${CREDOR_TESTE}'::uuid, NULL)`);

  const ler = (tabela: string, colunas: string) =>
    JSON.parse(
      psql(
        `SELECT COALESCE(json_agg(t), '[]'::json) FROM (
           SELECT ${colunas} FROM public.${tabela} WHERE credor_id = '${CREDOR_TESTE}'
         ) t`,
      ),
    );

  return {
    ag: {
      bordero: ler(
        'metricas_mensais_bordero',
        'credor_id, competencia::text, uf, bordero_valor, bordero_qtd, idade_soma, idade_qtd',
      ),
      repasse: ler(
        'metricas_mensais_repasse',
        'credor_id, competencia::text, uf, recebido_abe, pagamento_direto',
      ),
      posicao: ler('metricas_posicao', 'credor_id, uf, ativo_saldo_devedor, ativo_qtd'),
      classe: ler(
        'metricas_mensais_classe',
        'credor_id, competencia::text, uf, tipo_classe, classe, valor_original, saldo, qtd_processos',
      ),
    },
    faixas: ler(
      'metricas_mensais_faixa',
      'credor_id, competencia::text, uf, faixa_idade, bordero_valor, recebido_valor',
    ),
  };
}

/** "R$ 1.234,56" → 1234.56, para comparar número com número. */
function desformatar(texto: string): number {
  const limpo = texto
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

const temBanco = bancoDisponivel();

describe(
  'consistência entre a tela do credor e a da diretoria',
  { skip: !temBanco && 'Postgres local indisponível — rode `pnpm docker:tools`' },
  () => {
    const { ag, faixas } = temBanco
      ? prepararAgregados()
      : { ag: { bordero: [], repasse: [], posicao: [], classe: [] } as Agregados, faixas: [] };

    // Caminho da diretoria, com o MESMO recorte que a rota aplica: sem o filtro
    // de período entrariam competências de 2025, e a comparação acusaria uma
    // divergência que é do teste, não do código.
    type LinhaFaixa = {
      competencia: string;
      faixa_idade: string;
      bordero_valor: unknown;
      recebido_valor: unknown;
    };
    const faixasNoPeriodo = (faixas as LinhaFaixa[]).filter(
      (f) => f.competencia >= PERIODO_TESTE.de && f.competencia <= PERIODO_TESTE.ate,
    );

    const daDiretoria = montarDashboardDeAgregados(
      filtrar(ag, { de: PERIODO_TESTE.de, ate: PERIODO_TESTE.ate }),
      faixasNoPeriodo as Parameters<typeof montarDashboardDeAgregados>[1],
    );

    // Caminho do credor, sobre as MESMAS linhas.
    const doCredor = calcularMetricasCarteira(LINHAS_FIXTURE, PERIODO_TESTE.de, PERIODO_TESTE.ate);

    it('valor enviado (borderô) bate nos dois caminhos', () => {
      assert.equal(desformatar(daDiretoria.kpiBordero[0]!.valor), doCredor.bordero_total);
    });

    it('quantidade de processos bate', () => {
      assert.equal(
        Number(daDiretoria.kpiBordero[1]!.valor.replace(/\D/g, '')),
        doCredor.bordero_qtd,
      );
    });

    it('recebido pela ABE bate', () => {
      // O caso que separa os dois modelos: P2 teve repasse no período mas entrou
      // antes dele. Os dois caminhos precisam contá-lo igual.
      assert.equal(desformatar(daDiretoria.kpiFinanceiro[0]!.valor), doCredor.recebido_abe);
    });

    it('pagamento direto bate', () => {
      assert.equal(desformatar(daDiretoria.kpiFinanceiro[1]!.valor), doCredor.pagamento_direto);
    });

    it('saldo ativo bate', () => {
      // Some sem filtro de data nos dois lados — P9 entrou em 2025 e conta.
      assert.equal(
        desformatar(daDiretoria.kpiCarteiraAtiva[0]!.valor),
        doCredor.ativo_saldo_devedor,
      );
    });

    it('as classes de acordo batem, uma a uma', () => {
      // Compara VALOR ORIGINAL com VALOR ORIGINAL. A tabela da tela mostra o
      // SALDO quando ele existe — outra medida, e os dois caminhos tratam essa
      // diferença do mesmo jeito. Comparar a tabela com a métrica acusaria uma
      // divergência que não existe.
      const noPeriodo = filtrar(ag, { de: PERIODO_TESTE.de, ate: PERIODO_TESTE.ate }).classe;
      const original = (tipo: string, classe: string) =>
        noPeriodo
          .filter((c) => c.tipo_classe === tipo && c.classe === classe)
          .reduce((s, c) => s + Number(c.valor_original ?? 0), 0);

      assert.equal(original('acordo', 'acordo_a_receber'), doCredor.acordo_a_receber);
      assert.equal(original('acordo', 'quebra_de_acordo'), doCredor.quebra_de_acordo);
      assert.equal(original('acordo', 'em_cobranca'), doCredor.em_cobranca);
      assert.equal(original('acordo', 'acordo_com_pagamento'), doCredor.acordo_com_pagamento);
    });

    it('as devoluções batem, uma a uma', () => {
      const porMotivo = new Map(daDiretoria.tabelaBaixas.map((l) => [l.motivo, l]));

      // Aqui a tabela mostra o valor original mesmo, então dá para comparar direto.
      assert.equal(
        desformatar(porMotivo.get('Incobrável')?.valor ?? '0'),
        doCredor.devolvido_incobavel,
      );
      assert.equal(
        desformatar(porMotivo.get('Não processado')?.valor ?? '0'),
        doCredor.devolvido_nao_processado,
      );
    });

    it('a tabela de acordos mostra o saldo quando existe — nos dois caminhos', () => {
      // Não é divergência, é a regra: saldo > 0 vence o valor original.
      const porRotulo = new Map(daDiretoria.tabelaAcordos.map((l) => [l.metrica, l]));
      const saldoDeP10 = 750;
      assert.equal(desformatar(porRotulo.get('Acordo a receber')?.valor ?? '0'), saldoDeP10);
    });

    it('a série mensal soma o mesmo total do KPI', () => {
      // Um bloco não pode contar uma coisa e o KPI do topo outra.
      const somaSerie = daDiretoria.enviadoRecebidoMensal.reduce((s, m) => s + m.enviado, 0);
      assert.equal(somaSerie, doCredor.bordero_total);
    });

    it('a soma por UF fecha com o total enviado', () => {
      const somaUf = daDiretoria.metricasUf.reduce((s, u) => s + u.enviado, 0);
      assert.equal(somaUf, doCredor.bordero_total);
    });
  },
);
