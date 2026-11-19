-- =============================================================================
-- Cronograma: botão "Escopar com IA" no modal público — limite diário global (DEC-0079)
-- =============================================================================
--
-- O modal público "Adicionar à fila" do `/cronograma` ganha um botão que manda
-- título + descrição curta + rascunho de escopo para a MESMA chave/config do
-- Construtor de Relatórios (`agente_relatorios_config`, migration 017) — não é
-- criada nenhuma chave nem toggle novo.
--
-- Por que um limite diário GLOBAL, numa tabela separada, em vez da cota por
-- credor/dia que o Construtor de Relatórios já usa (`limite_perguntas_credor_dia`,
-- migration 017): esta página é pública, sem login e sem credor — não existe
-- `tenant_id`/`credor_id` para aplicar aquela cota aqui. Reaproveitar a mesma
-- chave sem limite nenhum abriria uma ação que consome o mesmo orçamento de IA
-- dos credores reais, sem teto algum para visitante anônimo. Apontado antes de
-- implementar e decidido explicitamente pelo usuário: limite fixo (30/dia),
-- contado numa tabela nova — não configurável pela tela, trocar o número exige
-- nova migration. Decisão completa em DEC-0079.
--
-- Mesmo padrão de validação estrita de DEC-0077/018: ninguém lê nem escreve a
-- tabela direto (nem `authenticated`) — a única porta pública é a função
-- `SECURITY DEFINER` abaixo, que só sabe contar o uso de hoje e recusar ou
-- gravar, nada além disso.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cronograma_escopo_ia_geracoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cronograma_escopo_ia_geracoes IS
  'Contador de uso do botão "Escopar com IA" no /cronograma (DEC-0079) — só guarda quando aconteceu, sem relação com nenhum item. Usado só para aplicar o limite diário global em cronograma_registrar_geracao_escopo_ia.';

ALTER TABLE public.cronograma_escopo_ia_geracoes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cronograma_escopo_ia_geracoes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cronograma_registrar_geracao_escopo_ia()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usadas_hoje INTEGER;
  v_limite CONSTANT INTEGER := 30;
BEGIN
  SELECT COUNT(*) INTO v_usadas_hoje
    FROM public.cronograma_escopo_ia_geracoes
   WHERE criado_em::date = CURRENT_DATE;

  IF v_usadas_hoje >= v_limite THEN
    RAISE EXCEPTION 'Limite diário de % gerações de escopo com IA atingido. Escreva o escopo manualmente ou tente novamente amanhã.', v_limite;
  END IF;

  INSERT INTO public.cronograma_escopo_ia_geracoes DEFAULT VALUES;
END;
$function$;

COMMENT ON FUNCTION public.cronograma_registrar_geracao_escopo_ia IS
  'Única porta pública de uso do botão "Escopar com IA" (DEC-0079). Limite diário global fixo (30/dia) porque a página é pública e não tem credor/tenant pra aplicar a cota por credor que o Construtor de Relatórios já usa.';

REVOKE ALL ON FUNCTION public.cronograma_registrar_geracao_escopo_ia()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cronograma_registrar_geracao_escopo_ia()
  TO anon, authenticated;
