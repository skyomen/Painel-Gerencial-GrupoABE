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
