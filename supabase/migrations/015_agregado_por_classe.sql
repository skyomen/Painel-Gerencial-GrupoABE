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
