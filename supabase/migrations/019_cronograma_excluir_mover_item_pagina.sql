-- =============================================================================
-- Cronograma: excluir e mover item criado pela própria página (DEC-0078)
-- =============================================================================
--
-- DEC-0077 (migration 018) abriu só "adicionar item à fila" e "reordenar a
-- fila" ao público, fechando explicitamente qualquer outra escrita — mudar
-- status ou excluir item continuava reservado ao agente, rodando SQL direto
-- com a service role.
--
-- DEC-0078 abre duas ações novas, mas só para os itens que o próprio botão
-- "+" da página criou (não para os itens oficiais do roadmap, vindos do seed
-- da migration 018): mover por drag para EM_EXECUCAO/CONCLUIDO, e excluir.
-- Isso exige uma marca na tabela que distinga "item da página" de "item
-- oficial do roadmap" — é a coluna `criado_via_pagina` abaixo. Sem essa
-- marca, as RPCs não teriam como recusar mexer num item oficial.
--
-- "Mover" fica no mesmo nível de confiança do DEC-0077 (qualquer visitante
-- pode mover qualquer item "da página", não só quem criou) — escolha
-- explícita do usuário. "Excluir" ganha um portão a mais: a RPC só aceita um
-- nome de uma lista fixa (hardcoded aqui, não em variável de ambiente nem
-- tabela separada — trocar a lista exige nova migration) e grava um
-- histórico (`cronograma_exclusoes`) antes de apagar, para accountability
-- depois do fato — isto não é autenticação, é um portão social.
--
-- Mesmo padrão de segurança de DEC-0077/018: ninguém escreve na tabela
-- direto (nem `authenticated`) — a única porta pública são funções
-- SECURITY DEFINER com validação estrita.
-- =============================================================================

-- 1. Coluna que marca item criado pelo botão "+" da própria página
ALTER TABLE public.cronograma_itens
  ADD COLUMN IF NOT EXISTS criado_via_pagina BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.cronograma_itens.criado_via_pagina IS
  'TRUE só para itens inseridos pela função pública cronograma_adicionar_item_fila (DEC-0078). Os itens do seed (migration 018) ficam FALSE. Só itens com TRUE podem ser movidos ou excluídos pelas funções públicas abaixo.';

-- 2. cronograma_adicionar_item_fila passa a gravar criado_via_pagina = TRUE
--    (CREATE OR REPLACE preserva os grants já concedidos na migration 018 — não repita o GRANT/REVOKE)
CREATE OR REPLACE FUNCTION public.cronograma_adicionar_item_fila(
  p_titulo TEXT,
  p_descricao TEXT,
  p_escopo TEXT DEFAULT NULL,
  p_prioridade_desejada TEXT DEFAULT NULL
) RETURNS public.cronograma_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_titulo TEXT;
  v_descricao TEXT;
  v_proxima_ordem INTEGER;
  v_item public.cronograma_itens;
BEGIN
  v_titulo := btrim(p_titulo);
  v_descricao := btrim(p_descricao);

  IF v_titulo IS NULL OR v_titulo = '' THEN
    RAISE EXCEPTION 'Título não pode ser vazio';
  END IF;

  IF v_descricao IS NULL OR v_descricao = '' THEN
    RAISE EXCEPTION 'Descrição não pode ser vazia';
  END IF;

  IF length(v_titulo) > 120 THEN
    RAISE EXCEPTION 'Título não pode passar de 120 caracteres';
  END IF;

  IF length(v_descricao) > 160 THEN
    RAISE EXCEPTION 'Descrição não pode passar de 160 caracteres';
  END IF;

  IF p_prioridade_desejada IS NOT NULL
     AND p_prioridade_desejada NOT IN ('BAIXA', 'MEDIA', 'ALTA') THEN
    RAISE EXCEPTION 'Prioridade desejada inválida: use BAIXA, MEDIA ou ALTA';
  END IF;

  SELECT COALESCE(MAX(ordem), 0) + 1
    INTO v_proxima_ordem
    FROM public.cronograma_itens
   WHERE status = 'FILA';

  INSERT INTO public.cronograma_itens
    (titulo, descricao, escopo, status, ordem, prioridade_desejada, atualizado_em, criado_via_pagina)
  VALUES (
    v_titulo,
    v_descricao,
    COALESCE(NULLIF(btrim(p_escopo), ''), v_descricao),
    'FILA',
    v_proxima_ordem,
    p_prioridade_desejada,
    CURRENT_DATE,
    TRUE
  )
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$function$;

-- 3. Histórico público de exclusões (leitura pública, escrita só pela função de exclusão)
CREATE TABLE IF NOT EXISTS public.cronograma_exclusoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL,
  item_titulo TEXT NOT NULL,
  nome TEXT NOT NULL,
  motivo TEXT NOT NULL,
  excluido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cronograma_exclusoes IS
  'Histórico de exclusões públicas de itens do cronograma (DEC-0078). item_id não tem FK porque o item já foi apagado de cronograma_itens — serve só de referência.';

ALTER TABLE public.cronograma_exclusoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cronograma_exclusoes_public_read ON public.cronograma_exclusoes;
CREATE POLICY cronograma_exclusoes_public_read
  ON public.cronograma_exclusoes
  FOR SELECT
  USING (true);

GRANT SELECT ON public.cronograma_exclusoes TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cronograma_exclusoes FROM anon, authenticated;

-- 4. cronograma_mover_item_pagina — única forma pública de mudar status
CREATE OR REPLACE FUNCTION public.cronograma_mover_item_pagina(
  p_id UUID,
  p_status TEXT
) RETURNS public.cronograma_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item public.cronograma_itens;
  v_proxima_ordem INTEGER;
BEGIN
  IF p_status NOT IN ('FILA', 'EM_EXECUCAO', 'CONCLUIDO') THEN
    RAISE EXCEPTION 'Status inválido: use FILA, EM_EXECUCAO ou CONCLUIDO';
  END IF;

  SELECT * INTO v_item
    FROM public.cronograma_itens
   WHERE id = p_id
     AND criado_via_pagina = TRUE
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado ou não pode ser movido';
  END IF;

  IF p_status = 'FILA' THEN
    SELECT COALESCE(MAX(ordem), 0) + 1
      INTO v_proxima_ordem
      FROM public.cronograma_itens
     WHERE status = 'FILA';

    UPDATE public.cronograma_itens
       SET status = p_status, ordem = v_proxima_ordem, atualizado_em = CURRENT_DATE
     WHERE id = p_id
     RETURNING * INTO v_item;
  ELSE
    UPDATE public.cronograma_itens
       SET status = p_status, ordem = NULL, atualizado_em = CURRENT_DATE
     WHERE id = p_id
     RETURNING * INTO v_item;
  END IF;

  RETURN v_item;
END;
$function$;

COMMENT ON FUNCTION public.cronograma_mover_item_pagina IS
  'Única forma pública de mudar status (DEC-0078). Só aceita item com criado_via_pagina = TRUE; nunca RECUSADO.';

REVOKE ALL ON FUNCTION public.cronograma_mover_item_pagina(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cronograma_mover_item_pagina(UUID, TEXT)
  TO anon, authenticated;

-- 5. cronograma_excluir_item_pagina — única forma pública de excluir
CREATE OR REPLACE FUNCTION public.cronograma_excluir_item_pagina(
  p_id UUID,
  p_nome TEXT,
  p_motivo TEXT
) RETURNS public.cronograma_exclusoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_nome TEXT;
  v_motivo TEXT;
  v_item public.cronograma_itens;
  v_log public.cronograma_exclusoes;
BEGIN
  v_nome := btrim(p_nome);
  v_motivo := btrim(p_motivo);

  IF v_nome IS NULL OR v_nome = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório';
  END IF;

  IF lower(v_nome) NOT IN (
    'meykson', 'raphael', 'leandro', 'andrew', 'joel',
    'roberto', 'roberto grejo', 'roberto jr', 'roberto junior'
  ) THEN
    RAISE EXCEPTION 'Nome não autorizado a excluir itens';
  END IF;

  IF v_motivo IS NULL OR v_motivo = '' THEN
    RAISE EXCEPTION 'Motivo da exclusão é obrigatório';
  END IF;

  SELECT * INTO v_item
    FROM public.cronograma_itens
   WHERE id = p_id
     AND criado_via_pagina = TRUE
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado ou não pode ser excluído';
  END IF;

  INSERT INTO public.cronograma_exclusoes (item_id, item_titulo, nome, motivo)
  VALUES (v_item.id, v_item.titulo, v_nome, v_motivo)
  RETURNING * INTO v_log;

  DELETE FROM public.cronograma_itens WHERE id = p_id;

  RETURN v_log;
END;
$function$;

COMMENT ON FUNCTION public.cronograma_excluir_item_pagina IS
  'Única forma pública de excluir item (DEC-0078). Exige nome na lista fixa e motivo não vazio; só aceita item com criado_via_pagina = TRUE. Grava histórico antes de apagar.';

REVOKE ALL ON FUNCTION public.cronograma_excluir_item_pagina(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cronograma_excluir_item_pagina(UUID, TEXT, TEXT)
  TO anon, authenticated;
