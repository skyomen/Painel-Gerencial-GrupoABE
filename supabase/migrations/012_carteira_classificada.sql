-- =============================================================================
-- carteira_classificada — O ÚNICO lugar com regra de negócio
-- =============================================================================
--
-- Antes desta view a mesma classificação estava escrita em cinco arquivos, em
-- três linguagens: no ETL (scripts/lib/abeweb.mjs), no cálculo do request
-- (apps/web/lib/calc-metricas-carteira.ts), na reagregação por filtro
-- (apply-dashboard-filtros.ts) e duas vezes em SQL. Duas delas já discordavam.
--
-- A regra se multiplicava porque CLASSIFICAR e SOMAR estavam misturados em cada
-- medida. Aqui elas se separam:
--
--   · esta view CLASSIFICA (é a única que conhece as palavras do negócio)
--   · todo o resto só SOMA, filtrando por estas colunas
--
-- Mudar o que conta como "em cobrança" é mudar UMA linha aqui, e o painel do
-- credor, os agregados e a visão da diretoria mudam juntos, por construção.
--
-- Custo: nenhum. View não materializada é expandida pelo planejador do Postgres
-- dentro da consulta — não é uma passada extra sobre os dados.
--
-- security_invoker = on é OBRIGATÓRIO: sem ele a view roda com os privilégios
-- do dono e IGNORA a RLS de carteira_snapshot, o que devolveria a carteira de
-- qualquer credor a qualquer usuário autenticado.
-- =============================================================================

-- A idade do título não existia nos fatos: o dashboard a lia do `borderoIndice`
-- do JSON (campo `i`), que é justamente o que deixou de viajar ao browser. Sem
-- ela não há como reconstruir "efetividade por faixa de idade" a partir da
-- tabela. Fica nula até o ETL passar a preenchê-la.
ALTER TABLE public.carteira_snapshot
  ADD COLUMN IF NOT EXISTS idade_dias INTEGER;

DROP VIEW IF EXISTS public.carteira_classificada;

CREATE VIEW public.carteira_classificada
WITH (security_invoker = on)
AS
SELECT
  cs.*,

  -- Competências. date_trunc devolve timestamp; o ::DATE é o que casa com as
  -- colunas `competencia` dos agregados.
  date_trunc('month', cs.data_inclusao)::DATE AS competencia_inclusao,
  date_trunc('month', cs.data_repasse)::DATE  AS competencia_repasse,

  -- '' e não NULL: esta coluna entra em chave primária, e NULL não compara
  -- por igualdade.
  COALESCE(NULLIF(TRIM(cs.uf), ''), '') AS uf_norm,

  -- ---------------------------------------------------------------------
  -- Devolução, por status. Espelha o primeiro `if/else if` de
  -- calc-metricas-carteira.ts:100. As duas grafias existem porque a origem
  -- não é consistente no acento.
  -- ---------------------------------------------------------------------
  CASE
    WHEN st IN ('não processado', 'nao processado')     THEN 'nao_processado'
    WHEN st IN ('não estabelecido', 'nao estabelecido') THEN 'nao_estabelecido'
    WHEN st IN ('incobrável', 'incobravel')             THEN 'incobravel'
  END AS classe_devolucao,

  -- ---------------------------------------------------------------------
  -- Acordo, por visão geral. Espelha o segundo `if/else if` (linha 105).
  -- É bloco independente do de cima: uma linha pode ser devolvida E ter
  -- visão de acordo, e conta nos dois.
  --
  -- LIKE e não igualdade porque o TypeScript usa `includes`. O CASE já para
  -- no primeiro que casa — é o próprio `else if`, e foi essa semântica que
  -- obrigava a escrever pilhas de NOT LIKE quando a regra vivia na medida.
  -- ---------------------------------------------------------------------
  CASE
    WHEN vis LIKE '%acordo com pagamento%' THEN 'acordo_com_pagamento'
    WHEN vis LIKE '%acordo a receber%'     THEN 'acordo_a_receber'
    WHEN vis LIKE '%em cobrança%'
      OR vis LIKE '%em cobranca%'          THEN 'em_cobranca'
    WHEN vis LIKE '%quebra de acordo%'     THEN 'quebra_de_acordo'
  END AS classe_acordo,

  -- ---------------------------------------------------------------------
  -- Pagamento, por tipo. Espelha isPagamentoAbe/isPagamentoDireto (linha 33).
  --
  -- ATENÇÃO: a comparação de `tipo` é TRIM sem LOWER — case-sensitive no
  -- original. 'pagamento final' em minúsculas NÃO conta, e mudar isso aqui
  -- alteraria o KPI. Já `status` é comparado em minúsculas, e por isso
  -- 'pagto. direto' usa `st`.
  --
  -- Linhas com valor_pago <= 0 ficam fora: o TypeScript as descarta antes de
  -- classificar (`if (pago <= 0) continue`).
  -- ---------------------------------------------------------------------
  CASE
    WHEN COALESCE(cs.valor_pago, 0) <= 0 THEN NULL
    WHEN TRIM(cs.tipo) IN ('Pagamento Final', 'Pagamento Parcial')
      THEN 'recebido_abe'
    WHEN TRIM(cs.tipo) IN ('Pagamento Direto Final', 'Pagamento Direto Parcial')
      THEN 'pagamento_direto'
    WHEN COALESCE(TRIM(cs.tipo), '') = '' AND st = 'pagto. direto'
      THEN 'pagamento_direto'
  END AS classe_pagamento,

  -- Posição da carteira. O saldo ativo é somado sem filtro de data no cálculo
  -- de hoje (calc-metricas-carteira.ts:112) — ver a nota na migration dos
  -- agregados sobre por que ele não tem competência.
  (st = 'ativo') AS is_ativo,

  -- Faixa de idade, com os cortes de scripts/lib/abeweb.mjs:297.
  CASE
    WHEN cs.idade_dias IS NULL THEN NULL
    WHEN cs.idade_dias <= 30   THEN '0-30'
    WHEN cs.idade_dias <= 60   THEN '31-60'
    WHEN cs.idade_dias <= 90   THEN '61-90'
    WHEN cs.idade_dias <= 180  THEN '91-180'
    ELSE '180+'
  END AS faixa_idade

FROM public.carteira_snapshot cs,
  -- Normaliza uma vez só, em vez de repetir LOWER(TRIM(...)) em cada ramo.
  LATERAL (
    SELECT
      LOWER(TRIM(cs.status)),
      LOWER(TRIM(cs.visao_geral_carteira))
  ) AS norm(st, vis);

COMMENT ON VIEW public.carteira_classificada IS
  'Única fonte das regras de classificação da carteira. Toda medida (agregados, '
  'RPC do dashboard, visão da diretoria) filtra por estas colunas e apenas soma. '
  'Alterar regra de negócio aqui, nunca nas medidas.';

GRANT SELECT ON public.carteira_classificada TO authenticated;
