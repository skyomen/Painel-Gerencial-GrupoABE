-- =============================================================================
-- Teste das regras de classificação e dos agregados
-- =============================================================================
--
--   pnpm test:sql          (sobe o Postgres local do profile "tools")
--
-- Roda contra um Postgres vazio, não contra o Supabase. As funções de auth/RLS
-- viram stubs: auth.uid() NULL simula o service_role, que é quem roda o ETL.
--
-- Os números esperados foram conferidos contra
-- `apps/web/lib/calc-metricas-carteira.ts` com as MESMAS linhas — é essa
-- igualdade que o teste protege. Se alguém alterar a view (012) e um KPI mudar
-- sem querer, ele reprova aqui em vez de reprovar na tela do credor.
-- =============================================================================

-- Este arquivo APAGA o schema public. A trava abaixo existe para que um
-- copiar-e-colar distraído no SQL Editor do Supabase não derrube produção.
DO $guard$
BEGIN
  IF current_database() <> 'painel_abe' THEN
    RAISE EXCEPTION
      'Recusado: este teste apaga o schema public e só roda no Postgres local (banco painel_abe). Banco atual: %',
      current_database();
  END IF;
END $guard$;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS BOOLEAN
  LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS UUID
  LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END $$;

CREATE TABLE public.tenants (id UUID PRIMARY KEY, nome TEXT NOT NULL);
CREATE TABLE public.credores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  razao_social TEXT NOT NULL
);
CREATE TABLE public.usuarios (
  id UUID PRIMARY KEY, tenant_id UUID, ativo BOOLEAN DEFAULT true, papel TEXT
);
CREATE TABLE public.carteira_snapshot (
  id BIGSERIAL PRIMARY KEY,
  credor_id UUID NOT NULL REFERENCES public.credores (id) ON DELETE CASCADE,
  sistema_origem TEXT NOT NULL,
  processo TEXT,
  data_inclusao DATE,
  data_repasse DATE,
  valor_original_titulo NUMERIC(15, 2) DEFAULT 0,
  valor_pago NUMERIC(15, 2) DEFAULT 0,
  valor_saldo_devedor NUMERIC(15, 2) DEFAULT 0,
  tipo TEXT,
  status TEXT,
  visao_geral_carteira TEXT,
  uf TEXT,
  sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.tenants VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant Teste');
INSERT INTO public.credores VALUES
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'Credor Teste');

\ir ../migrations/012_carteira_classificada.sql
\ir ../migrations/013_agregados_dashboard.sql
\ir ../migrations/014_alinhar_calcular_metricas.sql
\ir ../migrations/015_agregado_por_classe.sql
\ir ../migrations/016_refresh_todos.sql

-- ---------------------------------------------------------------------------
-- Cada linha existe para exercitar um ramo da classificação.
-- Período do teste: março/2026.
-- ---------------------------------------------------------------------------
INSERT INTO public.carteira_snapshot
  (credor_id, sistema_origem, processo, data_inclusao, data_repasse,
   valor_original_titulo, valor_pago, valor_saldo_devedor, tipo, status,
   visao_geral_carteira, uf, idade_dias)
VALUES
  -- borderô normal no período
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P1','2026-03-10',NULL,
   1000,0,0,NULL,'Ativo','Em cobrança','SP',45),

  -- repasse de processo ANTIGO: inclusão fora do período, repasse dentro.
  -- Separa "carteira inteira" (o que a tela mostra) de "coorte" (o que a
  -- migration 005 fazia). Se alguém reintroduzir o JOIN com a coorte,
  -- recebido_abe cai para 0 e o teste reprova.
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P2','2025-11-05','2026-03-15',
   500,300,200,'Pagamento Final','Ativo','Acordo com pagamento','SP',200),

  -- pagamento direto pelo TIPO
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P3','2026-03-02','2026-03-20',
   800,800,0,'Pagamento Direto Final','Ativo','Acordo a receber','RJ',15),

  -- pagamento direto pelo STATUS, com tipo vazio
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P4','2026-03-03','2026-03-21',
   600,600,0,'','Pagto. Direto','Quebra de Acordo','RJ',95),

  -- valor_pago zero: fora dos recebimentos, dentro do borderô
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P5','2026-03-04','2026-03-22',
   400,0,400,'Pagamento Final','Ativo','Em cobranca','MG',300),

  -- tipo em MINÚSCULAS: a comparação é case-sensitive e NÃO deve contar
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P6','2026-03-05','2026-03-23',
   700,700,0,'pagamento final','Ativo','Em cobrança','MG',20),

  -- devolvidos, com e sem acento
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P7','2026-03-06',NULL,
   900,0,0,NULL,'Incobrável','','BA',400),
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P8','2026-03-07',NULL,
   300,0,0,NULL,'nao processado','','BA',10),

  -- ativo com inclusão fora do período: saldo ativo não filtra por data
  ('22222222-2222-2222-2222-222222222222','ABE_WEB','P9','2025-01-10',NULL,
   2000,0,1500,NULL,'ativo','Em cobrança','SP',500);

-- ---------------------------------------------------------------------------
-- 1. A RPC precisa devolver exatamente o que o TypeScript devolve.
-- ---------------------------------------------------------------------------
DO $$
DECLARE m JSONB;
BEGIN
  m := public.calcular_metricas_credor(
         '22222222-2222-2222-2222-222222222222'::uuid,
         '2026-03-01'::date, '2026-03-31'::date, NULL);

  ASSERT (m->>'bordero_total')::numeric = 4700, 'bordero_total: ' || (m->>'bordero_total');
  ASSERT (m->>'bordero_qtd')::int = 7, 'bordero_qtd: ' || (m->>'bordero_qtd');

  -- Só o P2. O P6 ('pagamento final' minúsculo) não conta, e o P5 tem pago = 0.
  ASSERT (m->>'recebido_abe')::numeric = 300, 'recebido_abe: ' || (m->>'recebido_abe');

  -- P3 pelo tipo (800) + P4 pelo status com tipo vazio (600).
  ASSERT (m->>'pagamento_direto')::numeric = 1400, 'pagamento_direto: ' || (m->>'pagamento_direto');

  ASSERT (m->>'devolvido_incobavel')::numeric = 900, 'devolvido_incobavel';
  ASSERT (m->>'devolvido_nao_processado')::numeric = 300, 'devolvido_nao_processado';
  ASSERT (m->>'devolvido_nao_estabelecido')::numeric = 0, 'devolvido_nao_estabelecido';

  -- P2 tem 'Acordo com pagamento', mas entrou em nov/2025: acordo é do borderô.
  ASSERT (m->>'acordo_com_pagamento')::numeric = 0, 'acordo_com_pagamento';
  ASSERT (m->>'acordo_a_receber')::numeric = 800, 'acordo_a_receber';

  -- P1 (1000) + P5 'Em cobranca' sem acento (400) + P6 (700).
  ASSERT (m->>'em_cobranca')::numeric = 2100, 'em_cobranca: ' || (m->>'em_cobranca');
  ASSERT (m->>'quebra_de_acordo')::numeric = 600, 'quebra_de_acordo';

  -- P2 (200) + P5 (400) + P9 (1500). O P9 entrou em 2025 e conta assim mesmo.
  ASSERT (m->>'ativo_saldo_devedor')::numeric = 2100, 'ativo_saldo_devedor: ' || (m->>'ativo_saldo_devedor');

  RAISE NOTICE 'OK  RPC bate com o TypeScript (12 medidas)';
END $$;

-- ---------------------------------------------------------------------------
-- 2. O cubo precisa bater com a RPC. Se divergir, a divergência volta.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v NUMERIC; q INT;
BEGIN
  PERFORM public.refresh_agregados_credor('22222222-2222-2222-2222-222222222222'::uuid, NULL);

  SELECT SUM(bordero_valor), SUM(bordero_qtd) INTO v, q
    FROM public.metricas_mensais_bordero WHERE competencia = '2026-03-01';
  ASSERT v = 4700, 'cubo bordero_valor: ' || v;
  ASSERT q = 7, 'cubo bordero_qtd: ' || q;

  SELECT SUM(em_cobranca) INTO v
    FROM public.metricas_mensais_bordero WHERE competencia = '2026-03-01';
  ASSERT v = 2100, 'cubo em_cobranca: ' || v;

  SELECT SUM(recebido_abe) INTO v
    FROM public.metricas_mensais_repasse WHERE competencia = '2026-03-01';
  ASSERT v = 300, 'cubo recebido_abe: ' || v;

  SELECT SUM(pagamento_direto) INTO v
    FROM public.metricas_mensais_repasse WHERE competencia = '2026-03-01';
  ASSERT v = 1400, 'cubo pagamento_direto: ' || v;

  SELECT SUM(ativo_saldo_devedor) INTO v FROM public.metricas_posicao;
  ASSERT v = 2100, 'cubo ativo_saldo_devedor: ' || v;

  RAISE NOTICE 'OK  cubo bate com a RPC';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Faixas de idade, nos cortes de scripts/lib/abeweb.mjs:297.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v NUMERIC;
BEGIN
  -- P3 (15d, 800) + P8 (10d, 300) + P6 (20d, 700)
  SELECT SUM(bordero_valor) INTO v
    FROM public.metricas_mensais_faixa WHERE faixa_idade = '0-30';
  ASSERT v = 1800, 'faixa 0-30: ' || v;

  -- P4 tem 95 dias: cai em 91-180, não em 61-90.
  SELECT SUM(bordero_valor) INTO v
    FROM public.metricas_mensais_faixa WHERE faixa_idade = '91-180';
  ASSERT v = 600, 'faixa 91-180: ' || v;

  SELECT SUM(bordero_valor) INTO v
    FROM public.metricas_mensais_faixa WHERE faixa_idade = '180+';
  ASSERT v = 3800, 'faixa 180+: ' || v;

  RAISE NOTICE 'OK  faixas de idade';
END $$;

-- ---------------------------------------------------------------------------
-- 4. A view não pode furar a RLS. Sem security_invoker ela roda com os
--    privilégios do dono e devolve a carteira de qualquer credor.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = 'carteira_classificada'
       AND 'security_invoker=on' = ANY(reloptions)
  ), 'carteira_classificada precisa de security_invoker=on, senão ignora a RLS';

  RAISE NOTICE 'OK  view respeita RLS (security_invoker)';
END $$;


-- ---------------------------------------------------------------------------
-- 5. Classes por categoria — o que alimenta as tabelas Acordos e Baixas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v NUMERIC; q INT;
BEGIN
  SELECT SUM(valor_original), SUM(qtd_processos) INTO v, q
    FROM public.metricas_mensais_classe
   WHERE tipo_classe = 'acordo' AND classe = 'em_cobranca';
  -- P1 (1000) + P5 'Em cobranca' sem acento (400) + P6 (700) + P9 (2000)
  ASSERT v = 4100, 'classe em_cobranca valor: ' || v;
  ASSERT q = 4, 'classe em_cobranca processos: ' || q;

  SELECT SUM(valor_original), SUM(qtd_processos) INTO v, q
    FROM public.metricas_mensais_classe
   WHERE tipo_classe = 'devolucao' AND classe = 'incobravel';
  ASSERT v = 900, 'classe incobravel valor: ' || v;
  ASSERT q = 1, 'classe incobravel processos: ' || q;

  -- P2 tem 'Acordo com pagamento' E status 'Ativo': entra em acordo, e a
  -- devolucao dele fica vazia. Os dois blocos sao independentes.
  SELECT SUM(saldo) INTO v
    FROM public.metricas_mensais_classe
   WHERE tipo_classe = 'acordo' AND classe = 'acordo_com_pagamento';
  ASSERT v = 200, 'saldo do acordo com pagamento (P2): ' || v;

  RAISE NOTICE 'OK  classes por categoria';
END $$;


-- ---------------------------------------------------------------------------
-- 6. O botao do painel: recalcular todos numa chamada so.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD; v NUMERIC;
BEGIN
  -- Zera os agregados para provar que o recalculo realmente os refaz.
  DELETE FROM public.metricas_mensais_bordero;
  DELETE FROM public.metricas_mensais_repasse;
  DELETE FROM public.metricas_posicao;
  DELETE FROM public.metricas_mensais_classe;
  DELETE FROM public.metricas_mensais_faixa;

  SELECT * INTO r FROM public.refresh_agregados_todos();

  ASSERT r.credores_recalculados = 1, 'credores recalculados: ' || r.credores_recalculados;

  SELECT SUM(bordero_valor) INTO v FROM public.metricas_mensais_bordero
   WHERE competencia = '2026-03-01';
  ASSERT v = 4700, 'agregado nao foi refeito pelo botao: ' || COALESCE(v::text, 'nulo');

  RAISE NOTICE 'OK  recalculo de todos numa chamada';
END $$;

SELECT 'TODOS OS TESTES PASSARAM' AS resultado;
