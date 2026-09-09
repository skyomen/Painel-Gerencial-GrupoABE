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
