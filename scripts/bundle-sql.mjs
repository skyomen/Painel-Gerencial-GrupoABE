/**
 * Gera supabase/APLICAR_NO_SUPABASE.sql a partir das migrations.
 *
 *   pnpm sql:bundle
 *
 * O arquivo gerado é o que se cola no SQL Editor do Supabase. Ele é DERIVADO:
 * edite as migrations, nunca o bundle — rode isto de novo depois.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const PARTES = [
  ['012_carteira_classificada.sql', 'A REGRA — classificação da carteira (o único lugar com regra de negócio)'],
  ['013_agregados_dashboard.sql', 'AS TABELAS — agregados do dashboard + RLS + recálculo incremental'],
  ['014_alinhar_calcular_metricas.sql', 'A RPC — calcular_metricas_credor reescrita sobre a view'],
  ['015_agregado_por_classe.sql', 'AS CLASSES — acordos e baixas por categoria, para a tela da diretoria'],
  ['016_refresh_todos.sql', 'O BOTÃO — recálculo de todos os credores numa chamada só'],
];

const hoje = new Date().toISOString().slice(0, 10);

const cabecalho = `-- =============================================================================
-- APLICAR NO SUPABASE — SQL Editor
-- =============================================================================
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute UMA VEZ.
-- Gerado em ${hoje} a partir de supabase/migrations/012, 013 e 014.
-- ARQUIVO DERIVADO: edite as migrations, não este. Depois rode: pnpm sql:bundle
--
-- É SEGURO reexecutar: tabelas usam IF NOT EXISTS, políticas têm DROP antes do
-- CREATE, e funções e view usam OR REPLACE. Nenhum dado é apagado.
--
-- O QUE ISTO FAZ
--   1. Adiciona carteira_snapshot.idade_dias (nula até o ETL preencher).
--   2. Cria a view carteira_classificada — daqui em diante, a ÚNICA fonte das
--      regras de negócio (o que é "em cobrança", o que é "pagamento direto",
--      as faixas de idade). Antes disso a mesma regra estava escrita em cinco
--      arquivos, em três linguagens, e duas delas discordavam.
--   3. Cria as tabelas de agregado, com RLS, e a função de recálculo.
--   4. Reescreve calcular_metricas_credor sobre a view, acabando com a
--      divergência de \`recebido_abe\`.
--
-- MUDANÇA DE NÚMERO ESPERADA
--   calcular_metricas_credor deixa de restringir os repasses à coorte do
--   borderô. Ela passa a devolver o mesmo que a tela sempre mostrou; antes,
--   quando o app caía nela (falha de leitura da carteira), o número saía menor.
--
-- VALIDAÇÃO
--   Estes três blocos foram exercitados contra um Postgres 16 com dados que
--   cobrem cada ramo da classificação, e as 12 medidas bateram exatamente com
--   apps/web/lib/calc-metricas-carteira.ts. Para repetir:  pnpm test:sql
--
-- DEPOIS DE APLICAR
--   Os agregados nascem VAZIOS. Eles só se preenchem quando o ETL passar a
--   chamar refresh_agregados_credor(credor_id) — ainda não faz. Nada na tela
--   muda por causa disso; nada quebra.
-- =============================================================================

`;

const corpo = PARTES.map(([arquivo, titulo], i) => {
  const sql = readFileSync(join(raiz, 'supabase', 'migrations', arquivo), 'utf8');
  return (
    `\n\n-- #############################################################################\n` +
    `-- PARTE ${i + 1} de ${PARTES.length} — ${titulo}\n` +
    `-- origem: supabase/migrations/${arquivo}\n` +
    `-- #############################################################################\n\n` +
    sql
  );
}).join('');

const destino = join(raiz, 'supabase', 'APLICAR_NO_SUPABASE.sql');
const saida = cabecalho + corpo.replace(/^\n+/, '');
writeFileSync(destino, saida, 'utf8');

console.log(`gerado: supabase/APLICAR_NO_SUPABASE.sql (${saida.split('\n').length} linhas)`);
