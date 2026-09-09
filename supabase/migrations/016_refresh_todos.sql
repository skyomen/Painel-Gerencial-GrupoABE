-- =============================================================================
-- Recálculo de todos os credores numa chamada só
-- =============================================================================
--
-- O botão do painel precisa disto: chamar `refresh_agregados_credor` uma vez
-- por credor a partir do app seriam N requisições HTTP, cada uma com a latência
-- do PostgREST — com cem credores, mais tempo em rede do que em cálculo, e
-- estouro do limite de tempo da função serverless.
--
-- Aqui o laço roda DENTRO do banco: uma chamada, zero round-trips.
--
-- Nenhuma regra de negócio: só chama o recálculo que já existe.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_agregados_todos()
RETURNS TABLE (credores_recalculados INTEGER, duracao_ms INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_credor RECORD;
  v_total INTEGER := 0;
  v_inicio TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para recalcular os agregados';
  END IF;

  -- Só credor que tem o que agregar. Varrer os demais gastaria tempo para
  -- gravar zero linhas.
  FOR v_credor IN
    SELECT DISTINCT credor_id FROM public.carteira_snapshot
  LOOP
    PERFORM public.refresh_agregados_credor(v_credor.credor_id, NULL);
    v_total := v_total + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_total,
    EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_inicio))::INTEGER
      + EXTRACT(SECONDS FROM (clock_timestamp() - v_inicio))::INTEGER * 1000;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_agregados_todos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_agregados_todos() TO service_role;
