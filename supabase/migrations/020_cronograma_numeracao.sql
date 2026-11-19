-- =============================================================================
-- Cronograma: numeração permanente e crescente dos itens
-- =============================================================================
--
-- O usuário passou a se referir a cada item do cronograma por número ("fale
-- item 20") em vez de só pelo título. Esta migration cria essa numeração —
-- permanente, nunca reatribuída depois de criada, e sem nenhuma relação com
-- `ordem` (que é só a posição visual/arrastável dentro da coluna FILA e pode
-- mudar a qualquer momento).
--
-- Backfill: por que a ordem vem da migration 018, não de `criado_em`.
-- -----------------------------------------------------------------------
-- Os 21 itens do seed original (migration 018) foram inseridos numa ÚNICA
-- instrução SQL, então todos têm `criado_em` quase idêntico — ordenar por
-- `criado_em` embaralha esses 21 entre si. A ordem correta é a da própria
-- lista de VALUES da migration 018, que segue a cronologia real do projeto
-- (confirmado cruzando manualmente contra os ids reais do banco antes de
-- escrever esta migration). Os itens inseridos depois (via service role ou
-- pelo botão "+" da página) têm timestamps individuais e reais, então para
-- esses `criado_em` já ordena certo — por isso só o backfill explícito abaixo
-- usa a lista fixa de ids; qualquer item que sobrar sem número cai no
-- fallback por `criado_em`.
--
-- Depois do backfill, todo item NOVO ganha número automático sozinho: o
-- DEFAULT nextval(...) definido no fim deste arquivo cobre tanto a inserção
-- feita pela tela/service role quanto a RPC pública do botão "+"
-- (`cronograma_adicionar_item_fila`, migrations 018/019), que faz INSERT sem
-- listar a coluna `numero`.
-- =============================================================================

ALTER TABLE public.cronograma_itens
  ADD COLUMN IF NOT EXISTS numero INTEGER;

COMMENT ON COLUMN public.cronograma_itens.numero IS
  'Número permanente e crescente para referência humana ("item 20") — atribuído uma vez na criação, nunca reatribuído depois. Não confundir com `ordem`, que é a posição visual/arrastável dentro da FILA e pode mudar a qualquer momento.';

-- Backfill: ordem real do projeto (ver comentário de cabeçalho), não criado_em.
UPDATE public.cronograma_itens AS ci
   SET numero = v.numero
  FROM (VALUES
    ('8a9b2682-d851-40ea-88f1-c0c765f8b4b1'::uuid, 1),
    ('6eaa7c61-a35c-45c9-89a7-b281f92d8745'::uuid, 2),
    ('dff1ccc9-ed08-4bf4-8e68-e9b638d92b83'::uuid, 3),
    ('ad6f4d13-d564-42b0-9e8a-a855a9d480df'::uuid, 4),
    ('eea21bdb-e106-46ee-8d8a-a31e1fd22061'::uuid, 5),
    ('075a3e2a-a278-4853-b186-44dd64f7383a'::uuid, 6),
    ('4277cc21-6469-467f-a2e8-d68da05538a8'::uuid, 7),
    ('1fe25778-3466-44f8-8ee2-9eec17c64c0c'::uuid, 8),
    ('bad53b15-d989-45d6-ba1a-9d592afad3b8'::uuid, 9),
    ('ce3659a9-eb98-4851-94bf-4a6d11fda547'::uuid, 10),
    ('0345469a-c150-45a7-9a3e-4bb4891b33ed'::uuid, 11),
    ('d2394a01-7d8f-4e39-9149-ef544c9e0f2b'::uuid, 12),
    ('14a1a85e-2ea9-4149-a688-38ebec4043ec'::uuid, 13),
    ('ec851fd9-a95f-48df-844c-80e57d002ddc'::uuid, 14),
    ('b432af36-fa4b-43bb-bd00-a19468be51ed'::uuid, 15),
    ('a24b8efc-26fb-422f-a917-a350680dcce4'::uuid, 16),
    ('7aeefcc3-f328-43af-bc53-2a97ac77be19'::uuid, 17),
    ('34f51ae5-87bd-4c4e-adac-f05de7d7c67e'::uuid, 18),
    ('ea8ccf6a-a9ea-4392-b973-5b9240b9eb66'::uuid, 19),
    ('9993ed85-929c-49cc-b7fa-ec5e00766b87'::uuid, 20),
    ('952b86aa-8946-4e24-8123-dffd7a0113f4'::uuid, 21),
    ('5dc15af0-516b-4f45-993e-77e909224567'::uuid, 22),
    ('c252c464-5182-4344-b7e4-640ed0a12be4'::uuid, 23),
    ('f28612a9-180f-48e2-94bd-2131b05bb6ab'::uuid, 24),
    ('9d50d0bc-7266-4d38-ae27-b81e45b78312'::uuid, 25),
    ('dc9afae3-bba1-4a82-a727-9c3b8f3a680f'::uuid, 26)
  ) AS v(id, numero)
 WHERE ci.id = v.id;

-- Qualquer item que não bateu com a lista acima (criado entre a hora em que
-- fiz o levantamento e a hora em que esta migration rodar) ainda fica sem
-- número pela lista — cobre com criado_em como fallback, só para não deixar
-- NULL, já numerando a partir do que a lista acima já ocupou.
UPDATE public.cronograma_itens
   SET numero = sub.novo_numero
  FROM (
    SELECT id, (SELECT COALESCE(MAX(numero), 0) FROM public.cronograma_itens) +
           ROW_NUMBER() OVER (ORDER BY criado_em) AS novo_numero
      FROM public.cronograma_itens
     WHERE numero IS NULL
  ) AS sub
 WHERE public.cronograma_itens.id = sub.id;

ALTER TABLE public.cronograma_itens
  ALTER COLUMN numero SET NOT NULL;

ALTER TABLE public.cronograma_itens
  ADD CONSTRAINT cronograma_itens_numero_unique UNIQUE (numero);

CREATE SEQUENCE IF NOT EXISTS public.cronograma_itens_numero_seq
  OWNED BY public.cronograma_itens.numero;

SELECT setval(
  'public.cronograma_itens_numero_seq',
  (SELECT MAX(numero) FROM public.cronograma_itens)
);

ALTER TABLE public.cronograma_itens
  ALTER COLUMN numero SET DEFAULT nextval('public.cronograma_itens_numero_seq');
