-- =============================================================================
-- Cronograma de desenvolvimento — tabela real e fila pública (DEC-0077)
-- =============================================================================
--
-- Até aqui `apps/web/lib/cronograma-itens.ts` era um array estático no código:
-- cada entrega nova exigia editar o arquivo e fazer deploy. A página
-- `/cronograma` virou pública (sem login) e ganhou duas ações de escrita
-- (adicionar item à fila, reordenar a fila) também públicas, por decisão
-- explícita do usuário em DEC-0077 — o protótipo `docs/prototipos/
-- cronograma-fila-interativa.html` foi aprovado como especificação antes
-- deste código.
--
-- Isso muda a natureza do risco: antes só quem tinha acesso ao repositório
-- mexia nisto; a partir daqui qualquer visitante do site pode chamar a rota.
-- A defesa não é esconder a ação — é estreitar o que ela pode fazer. Por isso
-- NINGUÉM escreve na tabela direto (nem `authenticated`): a única porta pública
-- são duas funções SECURITY DEFINER com validação estrita, que não deixam
-- status mudar, item sumir, nem item fora da fila ser tocado. Trocar status,
-- apagar item ou editar o que não está em FILA continua sendo feito por mim
-- (o agente) rodando SQL direto com a service role, do mesmo jeito que hoje
-- edito o array à mão — nenhum caminho de escrita adicional foi construído
-- além do que está pedido aqui.
-- =============================================================================

-- =============================================================================
-- 1. public.cronograma_itens
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.cronograma_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  escopo TEXT NOT NULL DEFAULT '',

  status TEXT NOT NULL DEFAULT 'FILA'
    CHECK (status IN ('FILA', 'EM_EXECUCAO', 'CONCLUIDO', 'RECUSADO')),

  -- Posição manual/arrastável da fila. Só tem sentido quando status = 'FILA'
  -- (os demais status ficam com ordem NULL) — substitui o antigo número de
  -- "prioridade" fixo que existia no array estático: a fila agora é ordenada
  -- por isto, nunca recalculada a partir de um selo de prioridade.
  ordem INTEGER,

  -- Selo visual opcional que quem sugere o item pode marcar. NUNCA determina
  -- a posição na fila — isso é regra de aplicação, reforçada dentro da função
  -- de inserção abaixo (o CHECK aqui só valida o valor, não a posição).
  prioridade_desejada TEXT
    CHECK (prioridade_desejada IN ('BAIXA', 'MEDIA', 'ALTA')),

  evidencia_commit TEXT,
  motivo_recusa TEXT,

  atualizado_em DATE NOT NULL DEFAULT CURRENT_DATE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cronograma_itens IS
  'Itens do cronograma de desenvolvimento (quadro + fila pública). Escrita direta fechada para todo mundo — só via cronograma_adicionar_item_fila / cronograma_reordenar_fila (DEC-0077).';
COMMENT ON COLUMN public.cronograma_itens.ordem IS
  'Posição manual dentro da fila. Só populada quando status = FILA; NULL nos demais status.';

-- Tela do quadro filtra por status e ordena a coluna Fila por esta posição.
CREATE INDEX IF NOT EXISTS idx_cronograma_itens_status_ordem
  ON public.cronograma_itens (status, ordem);

-- -----------------------------------------------------------------------------
-- Seed: transcrição 1:1 de CRONOGRAMA_ITENS (apps/web/lib/cronograma-itens.ts)
-- no momento em que a tabela substituiu o array estático. Os 7 itens com
-- status FILA recebem ordem 1..7 na mesma ordem relativa que a antiga
-- `prioridade` (3..9) já expressava; os CONCLUIDO ficam com ordem NULL.
-- `prioridadeDesejada` não existia no array — NULL nos 15.
--
-- Idempotente pelo `WHERE NOT EXISTS`: se a migration rodar de novo numa base
-- que já tem QUALQUER linha em cronograma_itens, o bloco inteiro de INSERT é
-- pulado — mais simples que casar cada linha por chave natural (não há uma:
-- título não é UNIQUE de propósito, para não impedir dois itens com o mesmo
-- nome em momentos diferentes do projeto) e suficiente porque o seed só faz
-- sentido uma vez, na migração do array estático para a tabela.
-- -----------------------------------------------------------------------------
INSERT INTO public.cronograma_itens
  (titulo, descricao, escopo, status, ordem, prioridade_desejada, evidencia_commit, motivo_recusa, atualizado_em)
SELECT * FROM (VALUES
  (
    'Estrutura inicial do monorepo',
    'Primeira versão: admin, cadastro de credores e dashboard do cliente.',
    E'Primeiro commit do projeto: monorepo pnpm com API NestJS (Prisma/PostgreSQL), frontend Next.js, painel admin, dashboard do credor, autenticação JWT própria e CI no GitHub Actions.\nEssa arquitetura (NestJS + Prisma + JWT) foi substituída pouco depois pela migração para Supabase — fica registrada aqui como o ponto de partida real do projeto, não como o que está em produção hoje.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, 'f22b8a9', NULL::TEXT, DATE '2026-06-24'
  ),
  (
    'Migração da stack para Supabase',
    'Saída do backend NestJS legado — Auth, Postgres e RLS do Supabase viraram a base de tudo (ADR-0001, ADR-0003).',
    E'Troca completa da camada de dados e autenticação: NestJS + Prisma + JWT próprio saem; entram Supabase Auth, Postgres com Row Level Security e Route Handlers do Next.js fazendo o papel do backend administrativo.\n`apps/api` e toda a infraestrutura NestJS foram removidos; `supabase/` passou a concentrar migrations e seed. Decisão registrada em ADR-0001 (stack tecnológico) e ADR-0003 (identidade e autenticação).',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '8f42e68', NULL::TEXT, DATE '2026-06-24'
  ),
  (
    'Estabilização do primeiro deploy na Vercel',
    'Build quebrando, CSP bloqueando o login, tela em branco em produção — 4 correções no mesmo dia até o deploy ficar estável.',
    E'Quatro correções no primeiro dia de produção, uma atrás da outra:\n— Formatação Prettier e ajustes de CI em todo o monorepo.\n— Tipo `fotoUrl` faltando no mapeamento de credor, quebrando o build (erro TS2339).\n— Build `standalone` do Docker vazando para o deploy da Vercel — corrigido com `vercel.json` próprio para monorepo e documentação de variáveis de ambiente.\n— Content-Security-Policy bloqueando a tela de login, deixando a página em branco em produção.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '024e679', NULL::TEXT, DATE '2026-06-24'
  ),
  (
    'Grupo de códigos no admin, dashboard ABE WEB e hardening de segurança',
    'Credor passa a ter vários códigos de cliente agrupados; dashboard ganha a origem ABE WEB; reforço de segurança geral.',
    E'Edição de credor refeita com navegador por código (seções de cadastro, comercial e setor), cada seção salva de forma independente com feedback visual próprio — antes era um formulário único que salvava tudo junto.\nDashboard ganha métricas vindas da origem ABE WEB, além do legado Delphi. Validação server-side e proteção de rotas reforçadas no middleware; scripts de sincronização (ETL) do sistema legado adicionados.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '87e5a78', NULL::TEXT, DATE '2026-06-26'
  ),
  (
    'Regra única de cálculo e visão consolidada da diretoria',
    'Uma função só de cálculo para todo o sistema (fim da divergência entre dashboard e diretoria) e o painel consolidado de todos os credores.',
    E'A mesma classificação (em cobrança, pagamento direto, faixas de idade) estava escrita em cinco arquivos, em três linguagens — e duas delas discordavam entre si: o TypeScript somava todos os repasses do período, a RPC do banco só os de processos incluídos no mesmo período.\nA view `carteira_classificada` (migration 012) virou a ÚNICA fonte da regra de negócio; todo o resto apenas soma, filtrando pelas colunas que a view já classifica. Fundação que permitiu escalar de "um credor" para o consolidado da diretoria sem duplicar lógica.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, 'f9ad4f5', NULL::TEXT, DATE '2026-09-09'
  ),
  (
    'Botão de atualizar com recálculo de todos os credores',
    'Uma chamada só reprocessa os agregados de todos os credores, em vez de um de cada vez.',
    E'Duas ações separadas, de propósito, para não confundir "rápido" com "atualizado de verdade":\n— "Recalcular indicadores": segundos, refaz os agregados a partir do que já está sincronizado — é o botão principal.\n— "Sincronizar com ABE WEB e Delphi": minutos, alcança um SQL Server on-premises — fica no menu, com o custo de tempo avisado. Não cabe numa função serverless com timeout de segundos.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '50aa87a', NULL::TEXT, DATE '2026-09-09'
  ),
  (
    'Filtro de credor com seleção múltipla na diretoria',
    'A diretoria passa a filtrar vários credores ao mesmo tempo, não só um por vez.',
    E'O filtro da diretoria passa a aceitar um, vários ou todos os credores de uma vez.\nNão usa `<select multiple>` nativo — exige Ctrl+clique, perde a seleção inteira num clique desatento, e não comporta busca com dezenas de credores. Componente próprio com checkbox real dentro de um painel com busca. Lista vazia volta ao consolidado (todos), em vez de zerar a tela.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '89d220f', NULL::TEXT, DATE '2026-09-09'
  ),
  (
    'Ajuste de CI: .env efêmero no cron de sincronização ABE WEB',
    'O workflow de sync passa a gerar suas próprias variáveis de ambiente antes de rodar, sem depender de segredo fixo no runner.',
    E'O cron diário de sincronização com ABE WEB falhava todo dia com "node: .env: not found" (exit code 9) — o workflow injetava os segredos como env vars do passo, mas `node --env-file=.env` exige um arquivo físico no disco.\nCorrigido gravando um `.env` efêmero a partir das env vars já presentes no início do passo, e apagando em seguida.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '9fce3f7', NULL::TEXT, DATE '2026-11-04'
  ),
  (
    'Protótipo do Construtor de Relatórios com IA validado e congelado',
    'Protótipo com dado sintético aprovado pelo usuário e congelado como especificação antes do código — método do projeto.',
    E'Protótipo HTML com dado sintético (`docs/prototipos/relatorios-com-ia.html`) validado pelo usuário e congelado como especificação ANTES de qualquer linha de código real — é o método deste projeto para telas novas, não um passo opcional.\nServiu de contrato para o backend e o frontend construídos em seguida; divergências em relação a ele (quando houve) ficaram documentadas como pendência, não como decisão silenciosa.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '275fe4a', NULL::TEXT, DATE '2026-11-04'
  ),
  (
    'Backend do Construtor de Relatórios com IA',
    'Config global, chave da OpenAI no Supabase Vault, cota diária e auditoria de toda pergunta.',
    E'Pipeline de execução, na ordem da DEC-0069: `pedirPlano → validarPlano → (reprovado, PARA AQUI) → executarPlano`. A IA escolhe só o tipo de relatório e os filtros de período/UF/sistema — nunca vê nome de credor, nunca monta SQL, nunca decide de quem é o dado.\nConfig global do agente (modelo, tom de voz, catálogo habilitado) numa linha só; chave da OpenAI gravada no Supabase Vault via RPC, nunca em coluna de texto; cota diária de perguntas por credor; auditoria de toda pergunta, aprovada ou recusada. Migration 017.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '5bf5d3c', NULL::TEXT, DATE '2026-11-04'
  ),
  (
    'Frontend do Construtor de Relatórios com IA',
    'Credor pergunta em português sobre a própria carteira; a IA monta o plano, a rota valida e devolve cards, gráfico e tabela com os mesmos cálculos do dashboard.',
    E'Tela `/dashboard/relatorios`: o credor pergunta em português e recebe cards, gráfico e tabela — os MESMOS cálculos do dashboard normal, nunca uma segunda implementação da mesma conta.\nTela `/admin/configuracoes` para o super admin trocar a chave da OpenAI, ligar/desligar o agente, ver auditoria e custo do mês. Duas divergências deliberadas do protótipo (sem filtro de filial — o credor é resolvido pelo servidor; sem selo "novo" no menu) ficaram registradas como pendência para o usuário decidir, não implementadas por conta própria.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '30ba856', NULL::TEXT, DATE '2026-11-05'
  ),
  (
    'Correção: prévia de SUPER_ADMIN perdia o cliente no menu',
    'O menu lateral descartava o credorId da prévia ao navegar para Relatórios, devolvendo "Credor não encontrado".',
    E'O menu lateral (`NavCredor`, compartilhado por `/dashboard` e `/dashboard/relatorios`) montava os links do menu com o caminho cru, sem propagar o `?credorId=` da prévia de SUPER_ADMIN.\nAo clicar em "Relatórios" a partir da prévia de um cliente, o parâmetro se perdia, a rota passava a resolver o escopo pelo tenant do próprio admin (que não é credor) e devolvia 404 "Credor não encontrado". Corrigido com uma função `comCredorId()` usada nos três lugares que montam esse link (menu, logo, "voltar ao painel").',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '1fa4958', NULL::TEXT, DATE '2026-11-05'
  ),
  (
    'Datas da tela de relatórios = mínimo/máximo real da base',
    'Início/fim já vêm preenchidos com o intervalo de dados que o credor realmente tem, e o filtro de sistema de origem saiu da tela.',
    E'Busca o menor e maior `competencia` que o credor tem nas 4 tabelas de métricas mensais (bordero, repasse, classe, faixa) e usa como valor inicial dos campos de data, em vez do default genérico de "mês atual + 5 anteriores".\nFiltro de sistema de origem removido da tela (a API mantém o campo, default TODOS). Implementado e verificado (typecheck, lint, 127 testes).',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, '2417753', NULL::TEXT, DATE '2026-11-17'
  ),
  (
    'Cronograma de desenvolvimento (esta página)',
    'Página estática no próprio projeto, com visão geral, quadro, linha do tempo e lista — editada diretamente, sem passar por publicação externa.',
    E'Começou como Claude Artifact (link único, banco compartilhado, sem necessidade de login) e foi migrada para arquivo estático do próprio projeto por pedido do usuário — iteração mais rápida, sem publish/round-trip externo a cada ajuste.\nDado mantido à mão no array `ITENS` deste arquivo, a partir do `git log` real do repositório — cada entrega nova exige uma edição manual aqui.',
    'CONCLUIDO', NULL::INTEGER, NULL::TEXT, 'e694d77', NULL::TEXT, DATE '2026-11-17'
  ),
  -- A partir daqui: itens hoje em FILA (prioridade 3..9 → ordem 1..7, mesma
  -- ordem relativa) e o item em EM_EXECUCAO (sem ordem — não está na fila).
  (
    'Quadro de relatórios arrastável (BI self-service)',
    'Credor monta o próprio painel arrastando widgets (cartão, gráfico, tabela) sobre o Construtor de Relatórios já existente.',
    E'Proposta registrada em `vault/PROPOSTA-quadro-de-relatorios-arrastavel.md`: credor monta o próprio painel arrastando widgets (cartão, barra, pizza, tabela) sobre o Construtor de Relatórios já existente, com a IA pré-preenchendo um widget por pergunta em vez de uma resposta fechada.\nMVP recomendado: 3 tipos de widget, grid só com reordenar (sem resize livre), um widget por pergunta. Ainda sem protótipo nem decisão de arquitetura de persistência — não iniciado.',
    'FILA', 1, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-05'
  ),
  (
    'Sincronização real do Delphi (ETL) e regra de deduplicação com ABE WEB',
    'Hoje é stub — o ETL só loga "conector ainda não implementado". Doc e ADR descrevem Delphi como se já sincronizasse em produção.',
    E'`jobs/etl-abe.mjs` trata `ABE_DELPHI` como stub (só ABE_WEB está implementado); existe apenas um script de teste de conectividade (`scripts/test-abedelphi-connection.mjs`), nenhum importador de dados de verdade.\nContradição a corrigir: `docs/09-roadmap-e-fase-0.md` e o ADR-0005 descrevem o acesso ao Delphi como já validado e sincronizando (checklist marcado `[x]`) — não bate com o código real.\nAntes de implementar, decidir a regra de deduplicação entre ABE WEB e Delphi: se o mesmo credor tiver dívida nos dois bancos, somar os dois dobra o faturamento na tela da diretoria (risco registrado na run `2026-09-09-fechamento-com-prova-e-commit.md`). Também valida com a equipe ABE a forma de detecção de mudança no SQL Server 2005 (coluna de controle ou triggers) antes de construir o ETL.',
    'FILA', 2, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-17'
  ),
  (
    'Papel próprio de "Diretoria" (somente leitura)',
    'Hoje SUPER_ADMIN é o único papel com alcance sobre todos os tenants — a diretoria usa um papel que também cadastra e administra usuários.',
    E'`apps/web/app/api/diretoria/route.ts` já registra isso como pendência: um papel próprio de diretoria, só leitura, sem cadastro nem gestão de usuários, seria mais correto que emprestar o SUPER_ADMIN para esse uso.\nDecisão em aberto em `vault/PROPOSTA-cronograma-de-desenvolvimento-para-diretoria.md` ("Quem é diretor no sistema?") — definir o papel, seu alcance exato e se substitui o uso atual do SUPER_ADMIN na visão consolidada.',
    'FILA', 3, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-17'
  ),
  (
    'Telas pendentes do menu do credor (Carteira, Busca de devedor, Usuários)',
    'Esses itens aparecem no menu do credor com link morto (`href: null`) — a tela ainda não foi construída.',
    E'`apps/web/components/dashboard/nav-credor.tsx`: "Carteira", "Busca de devedor" e "Usuários" (e "Configurações" do credor) estão no array `NAV_CREDOR` com `href: null`, visíveis no menu mas sem destino.\nEscopar cada tela individualmente quando entrar em desenvolvimento — este item cobre o levantamento do que cada uma precisa mostrar e a ordem de construção.',
    'FILA', 4, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-17'
  ),
  (
    'Vitrine de relatórios SQL importados dos sistemas legados',
    'Anunciada em Configurações como "em breve" — importar consultas SQL já usadas nos sistemas legados como "planos" pré-validados adicionais.',
    E'`apps/web/app/api/admin/configuracoes/route.ts`: item `ITEM_VITRINE_SQL` com `disponivel: false` e descrição "Ainda não implementado", hoje só visível como anúncio em `/admin/configuracoes`.\nIdeia original: importar as consultas SQL reais dos relatórios já usados nos sistemas legados (Delphi/ABE WEB) como planos pré-validados adicionais ao Construtor de Relatórios com IA.',
    'FILA', 5, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-17'
  ),
  (
    'Preço do token de IA para o custo do agente deixar de ficar zerado',
    'A tela de Configurações mostra custo R$ 0,00 porque o preço do token nunca foi definido — não é o custo real.',
    E'`apps/web/app/admin/configuracoes/page.tsx`: o custo do agente de IA aparece zerado porque o preço do token ainda não foi definido; as perguntas já feitas foram registradas sem valor estimado.\nDefinir o preço (por modelo/fornecedor usado) e recalcular o custo das perguntas já auditadas, para a tela deixar de subestimar o gasto real do agente.',
    'FILA', 6, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-17'
  ),
  (
    'Cronograma interativo: atualizar, renomear status, adicionar e reordenar a fila',
    'Botão de atualizar com hora da última atualização, "Em execução" vira "Em desenvolvimento", "+" para adicionar item ao fim da fila, arrastar para reordenar a fila e colapsar/expandir as colunas.',
    E'Pedidos explícitos do usuário, puxados para desenvolvimento em 2026-11-17 — cada um é um pedido próprio, listado aqui para não ficar escondido numa descrição genérica:\n1. Botão "Atualizar" no painel principal: busca os dados mais recentes e mostra "Última atualização: HH:mm:ss".\n2. Rótulo "Em execução" passa a ser "Em desenvolvimento" em toda a página (badge, coluna do quadro, linha do tempo).\n3. Botão "+" no cabeçalho da coluna Fila: abre modal (título, descrição, escopo) e adiciona o item sempre no FIM da fila — mesmo que o usuário marque prioridade alta no formulário, a posição não muda sozinha.\n4. Arrastar um card para reordenar a fila manualmente (dentro da coluna Fila).\n5. Colapsar/expandir cada coluna do quadro (Fila, Em desenvolvimento, Concluído) clicando no cabeçalho dela.\nAcesso de escrita (adicionar e reordenar) decidido como público, sem login nem senha — DEC-0077, risco aceito explicitamente pelo usuário. Por exigir persistência (os itens hoje são um array estático no código, sem banco por trás), este array vai precisar migrar para uma tabela no Supabase antes do "+" e do drag funcionarem de verdade em produção.\nSeguindo o método do projeto: protótipo com dado sintético primeiro (`docs/prototipos/cronograma-fila-interativa.html`), aprovado pelo usuário como especificação, só depois o código real (migration + API + frontend).',
    'EM_EXECUCAO', NULL::INTEGER, NULL::TEXT, NULL::TEXT, NULL::TEXT, DATE '2026-11-17'
  )
) AS seed (titulo, descricao, escopo, status, ordem, prioridade_desejada, evidencia_commit, motivo_recusa, atualizado_em)
WHERE NOT EXISTS (SELECT 1 FROM public.cronograma_itens LIMIT 1);

-- =============================================================================
-- 2. RLS — leitura pública, escrita direta fechada para todo mundo
-- =============================================================================
ALTER TABLE public.cronograma_itens ENABLE ROW LEVEL SECURITY;

-- Leitura é pública de propósito (DEC-0077): a página /cronograma não exige
-- login, e o quadro mostra todo status, não só o que está em FILA.
DROP POLICY IF EXISTS cronograma_itens_public_read ON public.cronograma_itens;
CREATE POLICY cronograma_itens_public_read
  ON public.cronograma_itens
  FOR SELECT
  USING (true);

GRANT SELECT ON public.cronograma_itens TO anon, authenticated;

-- Nenhum papel escreve na tabela direto — nem authenticated. A única escrita
-- pública passa pelas duas funções abaixo, que validam o que a tela pode
-- fazer (adicionar ao fim da fila, reordenar a fila) e nada além disso. Sem
-- policy de admin agora: ninguém pediu tela de admin para isto, e eu (o
-- agente) mudo status/edito item existente rodando SQL direto com a service
-- role quando o usuário pedir — não construa nenhum caminho de escrita além
-- do que está pedido aqui.
REVOKE INSERT, UPDATE, DELETE ON public.cronograma_itens FROM anon, authenticated;

-- =============================================================================
-- 3. cronograma_adicionar_item_fila — única forma pública de criar item
-- =============================================================================
--
-- Validação estrita de propósito: esta função é chamável por qualquer
-- visitante do site (DEC-0077), então o que ela aceita É o limite do estrago
-- possível. Ela só sabe inserir item NOVO, sempre com status FILA, sempre no
-- FIM da fila atual — nunca determina posição a partir da "prioridade
-- desejada" (selo visual, aplicado só pela própria pessoa que sugere, nunca
-- pela fila), nunca aceita status, nunca aceita id.
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

  -- Mesmo limite do formulário do protótipo congelado — reforçado aqui porque
  -- quem chama a RPC não precisa ser o frontend.
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

  -- Próxima posição dentre quem já está em FILA. COALESCE cobre a fila vazia
  -- (MAX de zero linhas é NULL, não zero).
  SELECT COALESCE(MAX(ordem), 0) + 1
    INTO v_proxima_ordem
    FROM public.cronograma_itens
   WHERE status = 'FILA';

  INSERT INTO public.cronograma_itens
    (titulo, descricao, escopo, status, ordem, prioridade_desejada, atualizado_em)
  VALUES (
    v_titulo,
    v_descricao,
    -- Escopo em branco cai no texto da descrição — a tela sempre tem algo
    -- para mostrar no modal de detalhe, mesmo que quem sugeriu não tenha
    -- preenchido o campo opcional.
    COALESCE(NULLIF(btrim(p_escopo), ''), v_descricao),
    'FILA',
    v_proxima_ordem,
    p_prioridade_desejada,
    CURRENT_DATE
  )
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$function$;

COMMENT ON FUNCTION public.cronograma_adicionar_item_fila IS
  'Única forma pública de criar item (DEC-0077). Sempre FILA, sempre no fim da fila — prioridade_desejada é só selo visual, nunca posição.';

-- Função nova nasce executável por PUBLIC por padrão no Postgres. O REVOKE
-- vem primeiro e por extenso — o GRANT seguinte para anon/authenticated é
-- deliberado e explícito, não uma herança de PUBLIC que ninguém decidiu.
REVOKE ALL ON FUNCTION public.cronograma_adicionar_item_fila(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cronograma_adicionar_item_fila(TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;

-- =============================================================================
-- 4. cronograma_reordenar_fila — única forma pública de reordenar
-- =============================================================================
--
-- A validação de conjunto EXATO é o que fecha as três portas que esta função
-- não pode abrir: não dá para usá-la para tirar item da fila (ele teria que
-- sumir de p_ids, e aí o conjunto não bate), trazer item de fora para dentro
-- (ele não está no conjunto atual, não bate), ou mexer em item que não é FILA
-- (não está no conjunto atual por definição). Ela só pode embaralhar quem já
-- está lá dentro.
CREATE OR REPLACE FUNCTION public.cronograma_reordenar_fila(p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ids_recebidos UUID[];
  v_ids_atuais UUID[];
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Lista de ids não pode ser vazia';
  END IF;

  -- Normaliza (sem duplicata, ordenado) os dois lados antes de comparar —
  -- comparação de array em Postgres é posicional, não de conjunto.
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids_recebidos
    FROM unnest(p_ids) AS x;

  SELECT array_agg(id ORDER BY id) INTO v_ids_atuais
    FROM public.cronograma_itens
   WHERE status = 'FILA';

  IF v_ids_recebidos IS DISTINCT FROM v_ids_atuais THEN
    RAISE EXCEPTION 'A lista de ids não corresponde exatamente aos itens hoje em FILA';
  END IF;

  UPDATE public.cronograma_itens AS ci
     SET ordem = t.pos,
         atualizado_em = CURRENT_DATE
    FROM unnest(p_ids) WITH ORDINALITY AS t(id, pos)
   WHERE ci.id = t.id;
END;
$function$;

COMMENT ON FUNCTION public.cronograma_reordenar_fila IS
  'Única forma pública de reordenar a fila (DEC-0077). Exige conjunto EXATAMENTE igual ao que está em FILA hoje — não remove, não traz item de fora, não toca item fora da fila.';

REVOKE ALL ON FUNCTION public.cronograma_reordenar_fila(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cronograma_reordenar_fila(UUID[])
  TO anon, authenticated;
