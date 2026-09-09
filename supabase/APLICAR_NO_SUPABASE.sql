-- =============================================================================
-- APLICAR NO SUPABASE — SQL Editor
-- =============================================================================
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute UMA VEZ.
-- Gerado em 2026-09-09 a partir de supabase/migrations/012, 013 e 014.
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
--      divergência de `recebido_abe`.
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

-- #############################################################################
-- PARTE 1 de 4 — A REGRA — classificação da carteira (o único lugar com regra de negócio)
-- origem: supabase/migrations/012_carteira_classificada.sql
-- #############################################################################

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


-- #############################################################################
-- PARTE 2 de 4 — AS TABELAS — agregados do dashboard + RLS + recálculo incremental
-- origem: supabase/migrations/013_agregados_dashboard.sql
-- #############################################################################

-- =============================================================================
-- Agregados do dashboard — SÓ SOMAM. Nenhuma regra de negócio aqui.
-- =============================================================================
--
-- Toda classificação vem de `carteira_classificada` (migration 012). Se você
-- encontrar um LIKE '%acordo%' ou um LOWER(status) neste arquivo, é bug: a
-- regra escapou do único lugar onde ela deve morar.
--
-- carteira_snapshot continua sendo a fonte da verdade linha a linha, e é o que
-- permite recalcular quando a regra mudar. Estas tabelas existem por um motivo
-- só: a visão consolidada da diretoria soma TODOS os credores, e varrer milhões
-- de linhas a cada carga não escala.
--
-- Por que TRÊS tabelas e não uma: as medidas têm eixos de tempo diferentes.
--   · borderô, devolvidos e acordos → mês da DATA DE INCLUSÃO
--   · recebido e pagamento direto   → mês da DATA DE REPASSE
--   · saldo ativo                   → SEM data (posição atual da carteira)
-- Uma tabela única com uma coluna `competencia` somaria eixos distintos na
-- mesma linha, que é como se produz número plausível e errado.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.metricas_mensais_bordero (
  credor_id UUID NOT NULL REFERENCES public.credores (id) ON DELETE CASCADE,
  sistema_origem TEXT NOT NULL,
  competencia DATE NOT NULL,
  uf TEXT NOT NULL DEFAULT '',

  bordero_valor NUMERIC(15, 2) NOT NULL DEFAULT 0,
  bordero_qtd INTEGER NOT NULL DEFAULT 0,

  devolvido_nao_processado NUMERIC(15, 2) NOT NULL DEFAULT 0,
  devolvido_nao_estabelecido NUMERIC(15, 2) NOT NULL DEFAULT 0,
  devolvido_incobavel NUMERIC(15, 2) NOT NULL DEFAULT 0,

  acordo_com_pagamento NUMERIC(15, 2) NOT NULL DEFAULT 0,
  acordo_a_receber NUMERIC(15, 2) NOT NULL DEFAULT 0,
  em_cobranca NUMERIC(15, 2) NOT NULL DEFAULT 0,
  quebra_de_acordo NUMERIC(15, 2) NOT NULL DEFAULT 0,

  -- Soma e contagem, não AVG: média de médias não é média, e o consolidado da
  -- diretoria precisa somar estas duas colunas entre credores para dividir no fim.
  idade_soma BIGINT NOT NULL DEFAULT 0,
  idade_qtd INTEGER NOT NULL DEFAULT 0,

  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- `faixa_idade` NÃO entra aqui: a idade é por título e um processo pode ter
  -- vários, com faixas diferentes. Na chave, ela quebraria bordero_qtd — a soma
  -- dos COUNT(DISTINCT processo) das células contaria o mesmo processo duas
  -- vezes. A faixa ganha tabela própria, sem contagem de processos.
  PRIMARY KEY (credor_id, sistema_origem, competencia, uf)
);

CREATE TABLE IF NOT EXISTS public.metricas_mensais_faixa (
  credor_id UUID NOT NULL REFERENCES public.credores (id) ON DELETE CASCADE,
  sistema_origem TEXT NOT NULL,
  competencia DATE NOT NULL,
  uf TEXT NOT NULL DEFAULT '',
  faixa_idade TEXT NOT NULL,

  bordero_valor NUMERIC(15, 2) NOT NULL DEFAULT 0,
  recebido_valor NUMERIC(15, 2) NOT NULL DEFAULT 0,

  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credor_id, sistema_origem, competencia, uf, faixa_idade)
);

CREATE TABLE IF NOT EXISTS public.metricas_mensais_repasse (
  credor_id UUID NOT NULL REFERENCES public.credores (id) ON DELETE CASCADE,
  sistema_origem TEXT NOT NULL,
  competencia DATE NOT NULL,
  uf TEXT NOT NULL DEFAULT '',

  recebido_abe NUMERIC(15, 2) NOT NULL DEFAULT 0,
  pagamento_direto NUMERIC(15, 2) NOT NULL DEFAULT 0,

  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credor_id, sistema_origem, competencia, uf)
);

-- Sem competência de propósito: o cálculo de hoje soma o saldo de tudo que está
-- 'Ativo' sem filtro de data (calc-metricas-carteira.ts:112). Dar competência a
-- ele mudaria o KPI na tela.
CREATE TABLE IF NOT EXISTS public.metricas_posicao (
  credor_id UUID NOT NULL REFERENCES public.credores (id) ON DELETE CASCADE,
  sistema_origem TEXT NOT NULL,
  uf TEXT NOT NULL DEFAULT '',

  ativo_saldo_devedor NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ativo_qtd INTEGER NOT NULL DEFAULT 0,

  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credor_id, sistema_origem, uf)
);

-- Consolidado da diretoria: soma por competência sem passar pelo credor.
CREATE INDEX IF NOT EXISTS idx_bordero_competencia
  ON public.metricas_mensais_bordero (competencia);
CREATE INDEX IF NOT EXISTS idx_repasse_competencia
  ON public.metricas_mensais_repasse (competencia);

-- =============================================================================
-- RLS — na mesma migration que cria as tabelas, nunca depois.
-- Um agregado sem política é o caminho mais curto para um credor ver o número
-- de outro, e a tela da diretoria é exatamente onde isso apareceria.
-- =============================================================================
ALTER TABLE public.metricas_mensais_bordero ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metricas_mensais_faixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metricas_mensais_repasse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metricas_posicao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bordero_super_admin_all ON public.metricas_mensais_bordero;
CREATE POLICY bordero_super_admin_all ON public.metricas_mensais_bordero
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS bordero_tenant_read ON public.metricas_mensais_bordero;
CREATE POLICY bordero_tenant_read ON public.metricas_mensais_bordero
  FOR SELECT USING (
    credor_id IN (SELECT c.id FROM public.credores c
                   WHERE c.tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS faixa_super_admin_all ON public.metricas_mensais_faixa;
CREATE POLICY faixa_super_admin_all ON public.metricas_mensais_faixa
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS faixa_tenant_read ON public.metricas_mensais_faixa;
CREATE POLICY faixa_tenant_read ON public.metricas_mensais_faixa
  FOR SELECT USING (
    credor_id IN (SELECT c.id FROM public.credores c
                   WHERE c.tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS repasse_super_admin_all ON public.metricas_mensais_repasse;
CREATE POLICY repasse_super_admin_all ON public.metricas_mensais_repasse
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS repasse_tenant_read ON public.metricas_mensais_repasse;
CREATE POLICY repasse_tenant_read ON public.metricas_mensais_repasse
  FOR SELECT USING (
    credor_id IN (SELECT c.id FROM public.credores c
                   WHERE c.tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS posicao_super_admin_all ON public.metricas_posicao;
CREATE POLICY posicao_super_admin_all ON public.metricas_posicao
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS posicao_tenant_read ON public.metricas_posicao;
CREATE POLICY posicao_tenant_read ON public.metricas_posicao
  FOR SELECT USING (
    credor_id IN (SELECT c.id FROM public.credores c
                   WHERE c.tenant_id = public.current_tenant_id())
  );

GRANT SELECT ON public.metricas_mensais_bordero TO authenticated;
GRANT SELECT ON public.metricas_mensais_faixa TO authenticated;
GRANT SELECT ON public.metricas_mensais_repasse TO authenticated;
GRANT SELECT ON public.metricas_posicao TO authenticated;

-- =============================================================================
-- Recálculo incremental. Chamado ao fim do sync de cada credor.
--
-- Tabela e não MATERIALIZED VIEW porque o REFRESH de uma view é global:
-- sincronizar um credor recalcularia os cem.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.refresh_agregados_credor(
  p_credor_id UUID,
  p_sistema TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Só o ETL (service_role, sem auth.uid) e o super admin recalculam.
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para recalcular agregados do credor %', p_credor_id;
  END IF;

  DELETE FROM public.metricas_mensais_bordero
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_mensais_faixa
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_mensais_repasse
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_posicao
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);

  INSERT INTO public.metricas_mensais_bordero (
    credor_id, sistema_origem, competencia, uf,
    bordero_valor, bordero_qtd,
    devolvido_nao_processado, devolvido_nao_estabelecido, devolvido_incobavel,
    acordo_com_pagamento, acordo_a_receber, em_cobranca, quebra_de_acordo,
    idade_soma, idade_qtd
  )
  SELECT
    credor_id, sistema_origem, competencia_inclusao, uf_norm,
    COALESCE(SUM(valor_original_titulo), 0),
    COUNT(DISTINCT processo),

    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_devolucao = 'nao_processado'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_devolucao = 'nao_estabelecido'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_devolucao = 'incobravel'), 0),

    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'acordo_com_pagamento'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'acordo_a_receber'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'em_cobranca'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'quebra_de_acordo'), 0),

    COALESCE(SUM(idade_dias) FILTER (WHERE idade_dias > 0), 0),
    COUNT(*) FILTER (WHERE idade_dias > 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_inclusao IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4;

  INSERT INTO public.metricas_mensais_faixa (
    credor_id, sistema_origem, competencia, uf, faixa_idade,
    bordero_valor, recebido_valor
  )
  SELECT
    credor_id, sistema_origem, competencia_inclusao, uf_norm, faixa_idade,
    COALESCE(SUM(valor_original_titulo), 0),
    COALESCE(SUM(valor_pago), 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_inclusao IS NOT NULL
    AND faixa_idade IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4, 5;

  -- Eixo = data_repasse, e SEM junção com a coorte do borderô: segue
  -- calc-metricas-carteira.ts, que soma os repasses do período independente de
  -- quando o processo entrou ("carteira inteira — USERELATIONSHIP Power BI").
  INSERT INTO public.metricas_mensais_repasse (
    credor_id, sistema_origem, competencia, uf, recebido_abe, pagamento_direto
  )
  SELECT
    credor_id, sistema_origem, competencia_repasse, uf_norm,
    COALESCE(SUM(valor_pago) FILTER (WHERE classe_pagamento = 'recebido_abe'), 0),
    COALESCE(SUM(valor_pago) FILTER (WHERE classe_pagamento = 'pagamento_direto'), 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_repasse IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4;

  INSERT INTO public.metricas_posicao (
    credor_id, sistema_origem, uf, ativo_saldo_devedor, ativo_qtd
  )
  SELECT
    credor_id, sistema_origem, uf_norm,
    COALESCE(SUM(valor_saldo_devedor), 0),
    COUNT(*)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND is_ativo
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_agregados_credor(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_agregados_credor(UUID, TEXT) TO service_role;


-- #############################################################################
-- PARTE 3 de 4 — A RPC — calcular_metricas_credor reescrita sobre a view
-- origem: supabase/migrations/014_alinhar_calcular_metricas.sql
-- #############################################################################

-- =============================================================================
-- calcular_metricas_credor — reescrita sobre carteira_classificada
-- =============================================================================
--
-- Duas mudanças, e nenhuma delas é de regra: a regra saiu daqui.
--
-- 1) Classificação vem da view (migration 012). Antes, cada medida repetia o
--    encadeamento de LIKE/NOT LIKE por conta própria.
--
-- 2) `recebido` deixa de fazer INNER JOIN com a coorte do borderô.
--
--    Havia DUAS definições do mesmo KPI, e elas discordavam:
--
--    · apps/web/lib/calc-metricas-carteira.ts (o caminho normal) soma os
--      repasses do período independente de quando o processo entrou. O
--      comentário é explícito: "Recebimentos: Data Repasse no intervalo
--      (carteira inteira — USERELATIONSHIP Power BI)". Ele replica o
--      relatório de referência.
--
--    · esta função, na migration 005, contava só os repasses de processos
--      incluídos no mesmo período.
--
--    Um credor com pagamento de processo antigo aparecia com `recebido_abe`
--    diferente conforme o caminho executado — e os dois executam: o route
--    handler cai na RPC quando `fetchCarteiraSnapshot` devolve lista vazia, o
--    que acontece tanto com carteira vazia (aí tudo é zero e ninguém nota)
--    quanto quando a LEITURA FALHA e a função retorna `[]` após logar o erro.
--    Nesse segundo caso a RPC roda com dados presentes e mostra outro número.
--
--    A coorte continua no borderô, onde ela é o próprio conceito: borderô é o
--    que ENTROU no período.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calcular_metricas_credor(
  p_credor_id UUID,
  p_data_inicio DATE,
  p_data_fim DATE,
  p_sistema TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  resultado JSONB;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin()
     AND NOT EXISTS (
       SELECT 1
       FROM public.credores c
       JOIN public.usuarios u ON u.tenant_id = c.tenant_id
       WHERE c.id = p_credor_id
         AND u.id = auth.uid()
         AND u.ativo = true
     ) THEN
    RAISE EXCEPTION 'Acesso negado ao credor %', p_credor_id;
  END IF;

  WITH bordero AS (
    SELECT *
    FROM public.carteira_classificada
    WHERE credor_id = p_credor_id
      AND data_inclusao IS NOT NULL
      AND data_inclusao BETWEEN p_data_inicio AND p_data_fim
      AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  ),
  pagamentos AS (
    SELECT *
    FROM public.carteira_classificada
    WHERE credor_id = p_credor_id
      AND data_repasse IS NOT NULL
      AND data_repasse BETWEEN p_data_inicio AND p_data_fim
      AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  ),
  -- Saldo ativo é posição, não período: o TypeScript soma tudo que está 'Ativo'
  -- sem olhar data. Filtrar por período aqui mudaria o KPI da tela.
  ativos AS (
    SELECT *
    FROM public.carteira_classificada
    WHERE credor_id = p_credor_id
      AND is_ativo
      AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  )
  SELECT jsonb_build_object(
    'bordero_total', COALESCE((SELECT SUM(valor_original_titulo) FROM bordero), 0),
    'bordero_qtd',   COALESCE((SELECT COUNT(DISTINCT processo) FROM bordero), 0),

    'recebido_abe', COALESCE((
      SELECT SUM(valor_pago) FROM pagamentos WHERE classe_pagamento = 'recebido_abe'), 0),
    'pagamento_direto', COALESCE((
      SELECT SUM(valor_pago) FROM pagamentos WHERE classe_pagamento = 'pagamento_direto'), 0),

    'devolvido_nao_processado', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_devolucao = 'nao_processado'), 0),
    'devolvido_nao_estabelecido', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_devolucao = 'nao_estabelecido'), 0),
    'devolvido_incobavel', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_devolucao = 'incobravel'), 0),

    'acordo_com_pagamento', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_acordo = 'acordo_com_pagamento'), 0),
    'acordo_a_receber', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_acordo = 'acordo_a_receber'), 0),
    'em_cobranca', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_acordo = 'em_cobranca'), 0),
    'quebra_de_acordo', COALESCE((
      SELECT SUM(valor_original_titulo) FROM bordero
       WHERE classe_acordo = 'quebra_de_acordo'), 0),

    'ativo_saldo_devedor', COALESCE((SELECT SUM(valor_saldo_devedor) FROM ativos), 0)
  )
  INTO resultado;

  RETURN resultado;
END;
$function$;


-- #############################################################################
-- PARTE 4 de 4 — AS CLASSES — acordos e baixas por categoria, para a tela da diretoria
-- origem: supabase/migrations/015_agregado_por_classe.sql
-- #############################################################################

-- =============================================================================
-- Agregado por classe — o que falta para montar o dashboard a partir do cubo
-- =============================================================================
--
-- As tabelas "Acordos" e "Baixas" do dashboard mostram, por categoria:
-- quantidade de PROCESSOS distintos, valor original e saldo. O cubo de borderô
-- guarda só os valores somados, então essas duas tabelas não podiam ser
-- reconstruídas — e a visão da diretoria precisa delas.
--
-- Classes viram LINHAS, não colunas. Com colunas, cada categoria nova
-- (`acordo_judicial`, digamos) seria uma migration e uma alteração em toda
-- consulta; com linhas, é um `CASE` a mais na view 012 e nada aqui muda.
--
-- Nenhuma regra de negócio neste arquivo: `classe` vem de
-- `carteira_classificada`. Só somas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.metricas_mensais_classe (
  credor_id UUID NOT NULL REFERENCES public.credores (id) ON DELETE CASCADE,
  sistema_origem TEXT NOT NULL,
  competencia DATE NOT NULL,
  uf TEXT NOT NULL DEFAULT '',

  -- 'acordo' (visão geral da carteira) ou 'devolucao' (status).
  -- Uma linha pode contar nos DOIS: são blocos independentes no cálculo
  -- original (`if` separados, não `else if`), e juntá-los mudaria os números.
  tipo_classe TEXT NOT NULL CHECK (tipo_classe IN ('acordo', 'devolucao')),
  classe TEXT NOT NULL,

  valor_original NUMERIC(15, 2) NOT NULL DEFAULT 0,
  saldo NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- Processos distintos, não linhas: um processo com três títulos conta uma
  -- vez, como o `Set` do cálculo de hoje.
  qtd_processos INTEGER NOT NULL DEFAULT 0,

  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credor_id, sistema_origem, competencia, uf, tipo_classe, classe)
);

CREATE INDEX IF NOT EXISTS idx_classe_competencia
  ON public.metricas_mensais_classe (competencia);

ALTER TABLE public.metricas_mensais_classe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classe_super_admin_all ON public.metricas_mensais_classe;
CREATE POLICY classe_super_admin_all ON public.metricas_mensais_classe
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS classe_tenant_read ON public.metricas_mensais_classe;
CREATE POLICY classe_tenant_read ON public.metricas_mensais_classe
  FOR SELECT USING (
    credor_id IN (SELECT c.id FROM public.credores c
                   WHERE c.tenant_id = public.current_tenant_id())
  );

GRANT SELECT ON public.metricas_mensais_classe TO authenticated;

-- =============================================================================
-- refresh_agregados_credor passa a preencher também as classes.
-- O resto do corpo é idêntico ao da migration 013.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.refresh_agregados_credor(
  p_credor_id UUID,
  p_sistema TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para recalcular agregados do credor %', p_credor_id;
  END IF;

  DELETE FROM public.metricas_mensais_bordero
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_mensais_faixa
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_mensais_repasse
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_posicao
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);
  DELETE FROM public.metricas_mensais_classe
   WHERE credor_id = p_credor_id AND (p_sistema IS NULL OR sistema_origem = p_sistema);

  INSERT INTO public.metricas_mensais_bordero (
    credor_id, sistema_origem, competencia, uf,
    bordero_valor, bordero_qtd,
    devolvido_nao_processado, devolvido_nao_estabelecido, devolvido_incobavel,
    acordo_com_pagamento, acordo_a_receber, em_cobranca, quebra_de_acordo,
    idade_soma, idade_qtd
  )
  SELECT
    credor_id, sistema_origem, competencia_inclusao, uf_norm,
    COALESCE(SUM(valor_original_titulo), 0),
    COUNT(DISTINCT processo),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_devolucao = 'nao_processado'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_devolucao = 'nao_estabelecido'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_devolucao = 'incobravel'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'acordo_com_pagamento'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'acordo_a_receber'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'em_cobranca'), 0),
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE classe_acordo = 'quebra_de_acordo'), 0),
    COALESCE(SUM(idade_dias) FILTER (WHERE idade_dias > 0), 0),
    COUNT(*) FILTER (WHERE idade_dias > 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_inclusao IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4;

  INSERT INTO public.metricas_mensais_faixa (
    credor_id, sistema_origem, competencia, uf, faixa_idade, bordero_valor, recebido_valor
  )
  SELECT
    credor_id, sistema_origem, competencia_inclusao, uf_norm, faixa_idade,
    COALESCE(SUM(valor_original_titulo), 0),
    COALESCE(SUM(valor_pago), 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_inclusao IS NOT NULL
    AND faixa_idade IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4, 5;

  INSERT INTO public.metricas_mensais_repasse (
    credor_id, sistema_origem, competencia, uf, recebido_abe, pagamento_direto
  )
  SELECT
    credor_id, sistema_origem, competencia_repasse, uf_norm,
    COALESCE(SUM(valor_pago) FILTER (WHERE classe_pagamento = 'recebido_abe'), 0),
    COALESCE(SUM(valor_pago) FILTER (WHERE classe_pagamento = 'pagamento_direto'), 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_repasse IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4;

  INSERT INTO public.metricas_posicao (
    credor_id, sistema_origem, uf, ativo_saldo_devedor, ativo_qtd
  )
  SELECT
    credor_id, sistema_origem, uf_norm,
    COALESCE(SUM(valor_saldo_devedor), 0),
    COUNT(*)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND is_ativo
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3;

  -- ---------------------------------------------------------------------
  -- Classes de ACORDO (pela visão geral da carteira).
  --
  -- A contagem só considera linha com valor original > 0, e o valor exibido
  -- na tela é o saldo quando existe — por isso as duas colunas, em vez de
  -- decidir aqui qual delas mostrar.
  -- ---------------------------------------------------------------------
  INSERT INTO public.metricas_mensais_classe (
    credor_id, sistema_origem, competencia, uf, tipo_classe, classe,
    valor_original, saldo, qtd_processos
  )
  SELECT
    credor_id, sistema_origem, competencia_inclusao, uf_norm, 'acordo', classe_acordo,
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE valor_original_titulo > 0), 0),
    COALESCE(SUM(valor_saldo_devedor) FILTER (WHERE valor_saldo_devedor > 0), 0),
    COUNT(DISTINCT processo) FILTER (WHERE valor_original_titulo > 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_inclusao IS NOT NULL
    AND classe_acordo IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4, 5, 6;

  -- ---------------------------------------------------------------------
  -- Classes de DEVOLUÇÃO (pelo status). Bloco independente do de acordo:
  -- no cálculo original são dois `if` separados, e a mesma linha pode
  -- aparecer nos dois.
  -- ---------------------------------------------------------------------
  INSERT INTO public.metricas_mensais_classe (
    credor_id, sistema_origem, competencia, uf, tipo_classe, classe,
    valor_original, saldo, qtd_processos
  )
  SELECT
    credor_id, sistema_origem, competencia_inclusao, uf_norm, 'devolucao', classe_devolucao,
    COALESCE(SUM(valor_original_titulo) FILTER (WHERE valor_original_titulo > 0), 0),
    COALESCE(SUM(valor_saldo_devedor) FILTER (WHERE valor_saldo_devedor > 0), 0),
    COUNT(DISTINCT processo) FILTER (WHERE valor_original_titulo > 0)
  FROM public.carteira_classificada
  WHERE credor_id = p_credor_id
    AND data_inclusao IS NOT NULL
    AND classe_devolucao IS NOT NULL
    AND (p_sistema IS NULL OR sistema_origem = p_sistema)
  GROUP BY 1, 2, 3, 4, 5, 6;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_agregados_credor(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_agregados_credor(UUID, TEXT) TO service_role;
