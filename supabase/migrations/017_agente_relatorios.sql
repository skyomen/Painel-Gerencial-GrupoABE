-- =============================================================================
-- Agente de relatórios — configuração global, auditoria e cofre da chave
-- =============================================================================
--
-- O credor vai poder perguntar em linguagem natural sobre a própria carteira.
-- Quem responde é um modelo de terceiro, e isso muda a natureza do risco: até
-- aqui um bug mostrava número errado; a partir daqui um descuido manda dado de
-- credor para fora da casa, ou deixa alguém de fora ler a chave que paga a
-- conta. As três estruturas deste arquivo existem por causa disso.
--
-- Por que ENUM e não tabela de catálogo: `tipo_relatorio_ia` é a FRONTEIRA DE
-- SEGURANÇA da DEC-0069 — é a lista fechada do que o agente tem direito de
-- consultar. Em tabela, ampliar a fronteira seria um INSERT que um admin faz
-- pela tela, sem revisão e sem rastro de código. Em ENUM, ampliar exige
-- migration: alguém escreve, alguém revisa, fica no git. O incômodo é o ponto.
--
-- Por que a config é linha única e global: provedor, modelo, tom, proibições e
-- rodapé são política da casa, não preferência de cliente. Credor nenhum
-- escolhe o tom com que o Grupo ABE fala com ele.
--
-- Por que o Vault: este é o PRIMEIRO uso de Vault neste repositório, e o bloco
-- do fim define o padrão para os próximos. A chave do provedor nunca encosta em
-- coluna de texto, em log, em `.md` nem no navegador. A tabela guarda o UUID do
-- segredo e os quatro últimos dígitos — o bastante para a tela dizer "chave
-- ...a1b2 atualizada em tal dia" e nada além disso.
--
-- Nenhuma regra de negócio aqui: cálculo de carteira continua em 012/013.
-- =============================================================================

-- =============================================================================
-- 1. Catálogo de relatórios — a fronteira
-- =============================================================================
--
-- Idempotente pelo bloco: `CREATE TYPE` não aceita `IF NOT EXISTS`, então a
-- repetição da migration cai no `duplicate_object` e segue em frente.
DO $$
BEGIN
  CREATE TYPE public.tipo_relatorio_ia AS ENUM (
    'CARTEIRA_ATIVA',
    'BORDERO',
    'ACORDOS',
    'BAIXAS',
    'POSICAO_MENSAL',
    'CLASSIFICACAO_IDADE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON TYPE public.tipo_relatorio_ia IS
  'Lista fechada do que o agente pode consultar (DEC-0069). Ampliar exige migration revisada, nunca INSERT pela tela.';

-- =============================================================================
-- 2. public.agente_relatorios_config — uma linha, global, sensível
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agente_relatorios_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O par UNIQUE + CHECK é o que garante a linha única: a coluna só aceita
  -- `true`, e `true` só cabe uma vez. Sem o CHECK, bastaria gravar `false` para
  -- nascer uma segunda configuração e o sistema passar a ter duas políticas.
  singleton BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT agente_relatorios_config_singleton_unico UNIQUE (singleton),
  CONSTRAINT agente_relatorios_config_singleton_true CHECK (singleton),

  -- Campo extensível por migration + adapter (DEC-0070). O MVP fala só com a
  -- OpenAI; o CHECK existe para que dado inválido não entre enquanto isso. Novo
  -- provedor = migration que amplia o CHECK junto do adapter que o implementa,
  -- e não um valor digitado numa tela que o código não sabe atender.
  provedor TEXT NOT NULL DEFAULT 'OPENAI' CHECK (provedor IN ('OPENAI')),
  modelo TEXT NOT NULL DEFAULT 'gpt-5',

  -- Nasce desligado de propósito: greenfield, ainda não existe chave gravada.
  -- Ligar sem chave só produziria erro na cara do credor.
  ativo BOOLEAN NOT NULL DEFAULT false,

  -- Ponteiro para o segredo no Vault. NUNCA a chave.
  api_key_secret_id UUID,
  -- Só para a tela confirmar QUAL chave está lá. Quatro dígitos não reconstroem
  -- nada e não valem autenticação em lugar nenhum.
  api_key_ultimos4 TEXT,
  api_key_atualizada_em TIMESTAMPTZ,

  -- Política de voz. Vem do protótipo congelado; mudar aqui muda o que o credor
  -- lê, então muda por decisão, não por palpite de quem está com a tela aberta.
  tom_de_voz TEXT NOT NULL DEFAULT 'CONSULTIVO'
    CHECK (tom_de_voz IN ('FORMAL', 'CONSULTIVO', 'DIRETO')),
  idioma TEXT NOT NULL DEFAULT 'pt-BR',

  -- As quatro proibições do protótipo congelado, na ordem e no texto aprovados.
  -- Cada uma fecha um risco concreto: número sem lastro, vazamento entre
  -- clientes, conselho jurídico que a ABE não pode dar, e valor sem a ressalva
  -- de conferência.
  proibicoes TEXT[] NOT NULL DEFAULT ARRAY[
    'Afirmar um valor sem citar período e fonte',
    'Comparar o credor com outro cliente do Grupo ABE',
    'Sugerir ação jurídica ou cobrança extrajudicial',
    'Responder com valor financeiro sem o aviso "sujeito a conferência"'
  ],

  rodape_obrigatorio TEXT NOT NULL DEFAULT
    'Os valores apresentados são calculados automaticamente e sujeitos a conferência. Em caso de divergência, consulte o Resultado financeiro no dashboard.',

  -- Teto por credor/dia: contém tanto o custo quanto o uso do agente como
  -- ferramenta de extração em massa.
  limite_perguntas_credor_dia INTEGER NOT NULL DEFAULT 30
    CHECK (limite_perguntas_credor_dia > 0),
  -- Alerta, não bloqueio: serve para avisar antes da fatura, não para derrubar
  -- o recurso no meio do mês.
  alerta_custo_mensal_brl NUMERIC(12, 2) NOT NULL DEFAULT 1500.00
    CHECK (alerta_custo_mensal_brl >= 0),

  -- Subconjunto do catálogo que está de fato ligado. O ENUM diz o que é
  -- possível; esta coluna diz o que está valendo hoje.
  catalogo_habilitado public.tipo_relatorio_ia[] NOT NULL DEFAULT ARRAY[
    'CARTEIRA_ATIVA',
    'BORDERO',
    'ACORDOS',
    'BAIXAS',
    'POSICAO_MENSAL',
    'CLASSIFICACAO_IDADE'
  ]::public.tipo_relatorio_ia[],

  -- ON DELETE SET NULL: usuário desligado não pode apagar o histórico de quem
  -- mexeu na política.
  atualizado_por UUID REFERENCES public.usuarios (id) ON DELETE SET NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agente_relatorios_config IS
  'Configuração global do agente de relatórios. Linha única. Sem acesso de authenticated: só service_role e super admin.';
COMMENT ON COLUMN public.agente_relatorios_config.api_key_secret_id IS
  'UUID do segredo em vault.secrets. A chave em si nunca é gravada aqui.';

-- Semeia a linha única com os defaults. Rodar de novo não duplica nem
-- sobrescreve o que o super admin já ajustou.
INSERT INTO public.agente_relatorios_config (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- -----------------------------------------------------------------------------
-- RLS da config — na mesma migration que cria a tabela, nunca depois.
--
-- Uma policy só, e de super admin. NÃO existe `tenant_read` aqui e NÃO há GRANT
-- para `authenticated`: esta linha é política global e carrega o ponteiro do
-- segredo; não há leitura dela que seja legítima a partir do navegador de um
-- credor. A rota `/api/relatorios/perguntar` lê esta linha pelo `service_role`
-- (que ignora RLS) DEPOIS de já ter autenticado o usuário no Route Handler, e
-- devolve ao navegador só o que é inócuo — nunca a linha crua.
--
-- O REVOKE é explícito de propósito: a 001 deu `SELECT, INSERT, UPDATE, DELETE
-- ON ALL TABLES` a `authenticated`. Aquele GRANT alcançou só as tabelas que
-- existiam naquele dia, e o repositório não tem ALTER DEFAULT PRIVILEGES — mas
-- o custo de deixar escrito é zero e o custo de depender dessa leitura é alto.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agente_relatorios_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agente_relatorios_config_super_admin_all
  ON public.agente_relatorios_config;
CREATE POLICY agente_relatorios_config_super_admin_all
  ON public.agente_relatorios_config
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

REVOKE ALL ON public.agente_relatorios_config FROM anon, authenticated;

-- =============================================================================
-- 3. public.agente_relatorios_perguntas — auditoria
-- =============================================================================
--
-- Toda pergunta fica registrada, inclusive a que foi rejeitada. Sem isto não há
-- como responder "o que o agente disse para este credor em março", nem como
-- descobrir que a conta subiu porque alguém descobriu como usar o agente para
-- extrair a base inteira.
--
-- `resposta_resumo` e não a resposta inteira: auditoria aqui é rastro, não
-- cópia de conversa.
CREATE TABLE IF NOT EXISTS public.agente_relatorios_perguntas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- `tenant_id` é o eixo do isolamento e por isso é NOT NULL: linha de
  -- auditoria sem dono não pode ser filtrada por RLS.
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- Credor pode sumir sem levar o rastro junto.
  credor_id UUID REFERENCES public.credores (id) ON DELETE SET NULL,
  usuario_id UUID NOT NULL REFERENCES public.usuarios (id) ON DELETE CASCADE,

  pergunta_texto TEXT NOT NULL,
  -- O plano que o agente de fato executou (qual relatório, quais filtros). É o
  -- que permite reproduzir um número depois que alguém reclamar dele.
  plano_executado JSONB NOT NULL DEFAULT '{}'::jsonb,
  resposta_resumo TEXT,

  status TEXT NOT NULL DEFAULT 'OK'
    CHECK (status IN ('OK', 'ERRO', 'REJEITADO')),
  tipo_relatorio public.tipo_relatorio_ia,

  -- Telemetria de custo. Anulável porque pergunta rejeitada antes de chamar o
  -- provedor não gastou token nenhum — zero mentiria sobre isso.
  modelo TEXT,
  tokens_entrada INTEGER,
  tokens_saida INTEGER,
  custo_estimado_brl NUMERIC(12, 4),
  duracao_ms INTEGER,

  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tela de histórico do credor: filtra por tenant e ordena por data desc.
CREATE INDEX IF NOT EXISTS idx_agente_perguntas_tenant_data
  ON public.agente_relatorios_perguntas (tenant_id, criado_em DESC);
-- Painel de custo do super admin: varre o período inteiro sem passar por tenant.
CREATE INDEX IF NOT EXISTS idx_agente_perguntas_data
  ON public.agente_relatorios_perguntas (criado_em DESC);

-- -----------------------------------------------------------------------------
-- RLS da auditoria — padrão da 013: super admin faz tudo, tenant só lê o seu.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agente_relatorios_perguntas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agente_relatorios_perguntas_super_admin_all
  ON public.agente_relatorios_perguntas;
CREATE POLICY agente_relatorios_perguntas_super_admin_all
  ON public.agente_relatorios_perguntas
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS agente_relatorios_perguntas_tenant_read
  ON public.agente_relatorios_perguntas;
CREATE POLICY agente_relatorios_perguntas_tenant_read
  ON public.agente_relatorios_perguntas
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());

-- Só SELECT. A escrita vem do `service_role` dentro da rota, depois do guard de
-- autenticação — quem grava a auditoria é o sistema, nunca o navegador. Dar
-- INSERT a `authenticated` permitiria forjar rastro, que é pior que não ter.
GRANT SELECT ON public.agente_relatorios_perguntas TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.agente_relatorios_perguntas
  FROM anon, authenticated;

-- =============================================================================
-- 4. Supabase Vault — primeiro uso no projeto; este bloco é o padrão
-- =============================================================================
--
-- O esquema `vault` já existe no Supabase hospedado; o CREATE SCHEMA abaixo é
-- para que a migration também rode num Postgres local recém-criado, onde a
-- extensão falharia por não achar o esquema de destino.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- -----------------------------------------------------------------------------
-- Gravar a chave. Recebe o texto, devolve o UUID do segredo — e o texto não
-- sobrevive à chamada em lugar nenhum fora do cofre.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agente_relatorios_definir_chave(p_chave TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $function$
DECLARE
  v_config_id UUID;
  v_secret_id UUID;
BEGIN
  -- Validação antes de tocar no cofre: chave vazia ou truncada é erro de
  -- digitação, e gravar uma dessas só produziria falha de autenticação depois,
  -- longe daqui, difícil de explicar.
  IF p_chave IS NULL OR btrim(p_chave) = '' THEN
    RAISE EXCEPTION 'A chave de API não pode ser vazia';
  END IF;

  IF length(btrim(p_chave)) < 8 THEN
    RAISE EXCEPTION 'A chave de API é curta demais para ser válida (mínimo 8 caracteres)';
  END IF;

  SELECT c.id, c.api_key_secret_id
    INTO v_config_id, v_secret_id
    FROM public.agente_relatorios_config c
   LIMIT 1;

  IF v_config_id IS NULL THEN
    RAISE EXCEPTION 'Configuração do agente de relatórios não encontrada';
  END IF;

  IF v_secret_id IS NOT NULL THEN
    -- Rotação: mesmo segredo, novo conteúdo. Criar outro deixaria o antigo
    -- órfão dentro do cofre, válido e sem dono.
    PERFORM vault.update_secret(
      v_secret_id,
      p_chave,
      'agente_relatorios_api_key',
      'Chave de API do agente de relatórios'
    );
  ELSE
    BEGIN
      v_secret_id := vault.create_secret(
        p_chave,
        'agente_relatorios_api_key',
        'Chave de API do agente de relatórios'
      );
    EXCEPTION
      -- O nome do segredo é único no cofre. Se a config perdeu o ponteiro mas o
      -- segredo continua lá (linha recriada, restore parcial), reatamos os dois
      -- em vez de travar para sempre num conflito de nome.
      WHEN unique_violation THEN
        SELECT s.id INTO v_secret_id
          FROM vault.secrets s
         WHERE s.name = 'agente_relatorios_api_key'
         LIMIT 1;

        IF v_secret_id IS NULL THEN
          RAISE;
        END IF;

        PERFORM vault.update_secret(
          v_secret_id,
          p_chave,
          'agente_relatorios_api_key',
          'Chave de API do agente de relatórios'
        );
    END;
  END IF;

  -- Mesma transação: ou o cofre e o ponteiro andam juntos, ou nenhum dos dois
  -- anda. Ponteiro apontando para segredo que não existe é falha silenciosa.
  UPDATE public.agente_relatorios_config
     SET api_key_secret_id = v_secret_id,
         -- `p_chave` cru, não o aparado: tem de bater com o que foi para o
         -- cofre, senão a tela mostra quatro dígitos de uma chave que não é a
         -- que está valendo.
         api_key_ultimos4 = right(p_chave, 4),
         api_key_atualizada_em = now(),
         atualizado_em = now()
   WHERE id = v_config_id;

  RETURN v_secret_id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Ler a chave. Existe para a rota montar o header do provedor, e para mais nada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agente_relatorios_obter_chave()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $function$
DECLARE
  v_secret_id UUID;
  v_chave TEXT;
BEGIN
  SELECT c.api_key_secret_id
    INTO v_secret_id
    FROM public.agente_relatorios_config c
   LIMIT 1;

  -- Sem chave configurada devolve NULL, não exceção: a rota trata isso como
  -- "agente não configurado", que é um estado legítimo de sistema greenfield.
  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.decrypted_secret
    INTO v_chave
    FROM vault.decrypted_secrets s
   WHERE s.id = v_secret_id;

  RETURN v_chave;
END;
$function$;

-- -----------------------------------------------------------------------------
-- O par SECURITY DEFINER + REVOKE é o que segura a chave.
--
-- SECURITY DEFINER sozinho é o contrário de proteção: faria qualquer sessão
-- autenticada executar a função com os privilégios do dono e ler o cofre por
-- uma chamada de RPC do PostgREST. O REVOKE de PUBLIC/anon/authenticated é o
-- que fecha essa porta — depois dele as duas funções só são alcançáveis pelo
-- `createAdminClient()` (service role), e só depois do guard de `SUPER_ADMIN`
-- feito no Route Handler.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agente_relatorios_definir_chave(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agente_relatorios_definir_chave(TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.agente_relatorios_obter_chave()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agente_relatorios_obter_chave()
  TO service_role;

-- =============================================================================
-- 5. Sem trigger de `atualizado_em` — de propósito
-- =============================================================================
--
-- A 001 tem `public.set_atualizado_em()` e três tabelas penduradas nele, então
-- o gatilho existiria de graça. Fica fora assim mesmo: quem escreve nesta
-- config é sempre uma rota de super admin, que grava `atualizado_por` e
-- `atualizado_em` no mesmo UPDATE. Duas fontes para o mesmo carimbo — o trigger
-- e a rota — só criariam divergência entre quem mexeu e quando mexeu.
-- =============================================================================
