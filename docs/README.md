# Painel Gerencial Grupo ABE

> Documentação técnica do projeto. O faseamento nominal (0 a 4, ver item 09) não aconteceu de
> forma sequencial: o projeto já passou da Fase 1 (MVP) e já entrega pedaços da Fase 4
> (Construtor de Relatórios com IA), sem que as Fases 2 e 3 tenham sido formalmente fechadas —
> ver a nota de reconciliação em [09 — Roadmap](09-roadmap-e-fase-0.md).

## ⭐ Comece aqui (desenvolvedores)

**[GUIA-DO-PROJETO.md](GUIA-DO-PROJETO.md)** — documento vivo com estrutura do código, como rodar, o que está pronto vs. mock, convenções e “onde mexer”. **Leia antes de alterar qualquer coisa.**

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend + Route Handlers | Next.js 15 (`apps/web`) — **Vercel** |
| Backend de dados | **Supabase** (PostgreSQL + Auth + RLS) |
| Schema | `supabase/migrations/` |
| Backend | Supabase + Route Handlers (`apps/web/app/api/admin`) |

## O que é este projeto

Um **portal SaaS** que consolida, em uma única interface, a régua de cobrança hoje espalhada por
quatro sistemas (Avantpay, ABE Interno/Delphi, ABEWeb e Acordo Seguro). Será **vendido e acessado
externamente** por clientes credores, o que exige um padrão elevado de **segurança**, **isolamento
de dados (multi-tenant)**, **conformidade com a LGPD** e **resiliência a falhas**.

## Como ler esta documentação

Leia na ordem. Cada resumo abaixo traz os **fatos centrais** do documento — não apenas "do que ele
fala" — para quem só ler este README já sair sabendo o essencial. Clique no link quando precisar do
detalhe completo (a RPC exata, o SQL inteiro, a árvore de pastas etc.).

### 01 — [Visão, Escopo e Glossário](01-visao-e-escopo.md)

- Problema: cobrança fragmentada em 4 sistemas; credor precisa entrar em vários sites para ver a
  situação de um devedor.
- Visão: portal único, multiempresa, login único, régua consolidada (preventivo → ativa → acordo →
  baixa), busca por CPF/CNPJ nas 4 fontes, área admin para transferir/pausar com rastreabilidade.
- Fora de escopo por enquanto: substituir os sistemas de origem, disparar cobrança pelo portal, app
  mobile nativo, BI avançado/data lake.
- Papéis (RBAC): Super Admin (plataforma), Admin do Credor, Operador do Credor, Visualizador —
  sempre escopados ao tenant do usuário.
- As 4 fontes: Avantpay (preventivo), ABE Interno/Delphi (ativa/jurídico, legado SQL Server 2005),
  ABEWeb (ativa), Acordo Seguro (acordos, via webhook).
- Glossário fixa os termos usados nos outros documentos (tenant, modelo canônico, roll rate, RLS,
  idempotência etc.) — consulte ali antes de perguntar "o que é X".

### 02 — [Arquitetura Geral](02-arquitetura-geral.md)

- Estilo: modular em camadas, orientado a integração — não é monolito acoplado ao legado nem
  microserviços completos. Backend de aplicação vive no Next.js (Route Handlers + Supabase); workers
  de integração são um componente separado (futuro). Decisão em [ADR-0002](adr/0002-monolito-modular-vs-microservicos.md).
- Visão de contêineres: Vercel (edge/TLS/CDN) → Next.js 15 (páginas + Route Handlers) → Supabase
  (Auth + PostgreSQL/RLS) ← workers de integração (futuro) ← agente on-premise ← sistemas de origem.
- 4 fluxos principais documentados: autenticação/sessão, consulta do credor (cliente anon + RLS),
  operação administrativa (`SUPER_ADMIN` + service role) e sincronização de entrada (futuro).
- Tabela de decisões macro com link para cada ADR (0001 a 0005).

### 03 — [Arquitetura de Dados e Integração](03-arquitetura-de-dados.md)

- Princípio central: os sistemas de origem continuam sendo a fonte da verdade; o portal só tem uma
  **réplica de leitura** consolidada no Supabase PostgreSQL, em modelo canônico, com `tenant_id` +
  RLS em toda tabela e sincronização idempotente.
- Schema já em produção e bem além do inicial — ver a seção "Tabelas" do documento para a contagem
  exata de migrations e a lista completa; núcleo é `tenants` / `usuarios` / `credores` /
  `codigos_cliente`.
- Carteira e métricas: `carteira_snapshot` é a fonte da verdade linha a linha para todo recálculo;
  `dashboard_carteira`, `metricas_cache` e as tabelas `metricas_mensais_*`/`metricas_posicao` são
  agregados derivados dela. `carteira_classificada` é uma **view** (não tabela) — única fonte das
  regras de classificação da carteira; todo agregado e toda RPC de métricas filtram por ela.
- Agente de relatórios com IA tem duas tabelas: `agente_relatorios_config` (config global, sem
  `tenant_id`, sem acesso de `anon`/`authenticated`) e `agente_relatorios_perguntas` (auditoria de
  toda pergunta feita, leitura por tenant).
- `cronograma_itens` guarda os itens da página pública `/cronograma`, sem `tenant_id`, leitura
  pública.
- Entidades de negócio (devedor, título, interação, pagamento, acordo, audit_log) ainda são
  **planejadas para a Fase 1+**, não existem hoje.
- Legado SQL Server 2005: agente on-premise lê incrementos e empurra para o Supabase; o portal
  **nunca** consulta o legado em tempo real ([ADR-0005](adr/0005-acesso-legado-sql2005.md)).
- Idempotência via chave natural `sistema_origem` + `id_externo`; webhooks deduplicados por
  `event_id`; consistência é eventual (UI mostra "atualizado há X min").

### 04 — [Backend e APIs](04-backend.md)

- Stack: Next.js 15 (Route Handlers) + Supabase + `@supabase/ssr`, validação com Zod, tipos
  compartilhados em `@abe/canonical-model`. Decisão em [ADR-0001](adr/0001-stack-tecnologico.md).
- Padrão de camadas: Route Handler (valida sessão/papel) → `lib/server/*` (regra de negócio) →
  Supabase (Postgres + RLS + Auth).
- Regras invioláveis: toda query respeita tenant (RLS + filtro explícito); toda entrada é validada
  na borda; `SUPABASE_SERVICE_ROLE_KEY` só no servidor; CPF/CNPJ nunca sai sem mascaramento.
- Endpoints hoje implementados são só os administrativos: `GET/POST /api/admin/credores`,
  `GET /api/admin/credores/:id`, `PATCH .../responsavel`, `GET/POST /api/admin/usuarios`,
  `PATCH /api/admin/usuarios/:id` — todos exigem `SUPER_ADMIN`.
- Endpoints de carteira/busca/transferência (`/api/carteira/kpis`, `/api/devedores/busca`,
  `/api/admin/acoes/transferir`) ainda estão na lista de **planejados**, não implementados.
- Autenticação: `lib/auth.ts` chama `signInWithPassword`, busca perfil em `public.usuarios`; Route
  Handlers admin usam `requireSuperAdmin()` + `adminDb()` (service role); `tenant_id` nunca vem do
  corpo do request.
- Erros sempre `{ title, status }` em português, sem vazar stack/SQL; code review obrigatório
  (mínimo 1 aprovação) + Conventional Commits.

### 05 — [Frontend](05-frontend.md)

- Descreve a stack **recomendada** e a estrutura de telas do MVP original (Next.js App Router + TS,
  Tailwind/shadcn, TanStack Query, Zustand, Recharts/visx, React Hook Form + Zod, TanStack Table,
  next-intl, Vitest/Playwright) — é o desenho de referência, não um inventário do que já foi
  construído (para o estado real das telas, ver o GUIA-DO-PROJETO.md e o código).
- Telas do MVP descritas: Cockpit (seletor multi-CNPJ, KPIs, régua/funil clicável, listagem com
  documento mascarado, indicador de frescor por fonte), Busca unificada + linha do tempo,
  Financeiro, Admin — Gestão de Fluxo (transferência com confirmação dupla).
- Segurança no frontend: cookies `HttpOnly`/`Secure`/`SameSite=Strict` (nunca token em
  `localStorage`), CSP estrita, sanitização de HTML dinâmico, proteção CSRF, nenhum segredo no
  bundle do cliente — e o frontend **nunca decide permissão**, só reflete o que o backend autoriza.
- Performance: code splitting por rota, TanStack Query com cache/paginação por cursor, gráficos só
  consomem dados agregados (views materializadas), nunca dado bruto.
- Cliente de API: a ideia é gerar os tipos a partir do OpenAPI do backend para não haver "drift" de
  contrato entre front e back.

### 06 — [Segurança e LGPD](06-seguranca-e-lgpd.md)

- Documento mais importante da Fase 0 — o sistema é acessado pela internet por terceiros e lida com
  dado pessoal/financeiro de devedores.
- Isolamento de tenant em 3 camadas (defesa em profundidade): perfil (`tenant_id` em
  `public.usuarios`), aplicação (filtro explícito nas queries/Route Handlers) e banco
  (**Row-Level Security** — mesmo com bug na aplicação, uma sessão `anon` só vê linhas do seu tenant).
- Três tabelas fogem do padrão `tenant_id` + RLS por credor, cada uma com seu próprio motivo e
  trava: `agente_relatorios_config` (política da casa, sem tenant, só `SUPER_ADMIN`/`service_role`,
  revoga `anon`/`authenticated` explicitamente), `agente_relatorios_perguntas` (leitura por tenant,
  gravação só pelo `service_role` dentro da rota, nunca pelo navegador — não dá para forjar o
  rastro de auditoria) e `cronograma_itens` (pública de propósito, DEC-0077 — a escrita pública não
  é direta na tabela, passa só por duas funções `SECURITY DEFINER` bem restritas:
  `cronograma_adicionar_item_fila`, que só insere no fim da fila com `status = 'FILA'`, e
  `cronograma_reordenar_fila`, que só aceita o conjunto exato de ids hoje em `FILA`).
- A chave do provedor de IA (Supabase Vault) só é alcançável por duas funções `SECURITY DEFINER`
  que concedem `EXECUTE` exclusivamente a `service_role` — nunca por sessão `anon`/`authenticated`
  nem por chamada de RPC via PostgREST.
- Auth via Supabase Auth (`@supabase/ssr`); **sem `senha_hash` em `public.usuarios`**; MFA suportado
  e recomendado para admins (ainda não obrigatório).
- RBAC: `SUPER_ADMIN`, `ADMIN_CREDOR`, `OPERADOR`, `VIEWER` — nega por padrão.
- Chaves: `NEXT_PUBLIC_SUPABASE_ANON_KEY` pode ir ao browser; `SUPABASE_SERVICE_ROLE_KEY` é
  servidor-only, nunca em `NEXT_PUBLIC_*`, nunca commitada (scan via gitleaks na CI).
- Traz o modelo de ameaças STRIDE, o mapeamento OWASP Top 10 e um checklist de go-live (RLS testado,
  MFA, headers de segurança, CPF/CNPJ mascarado, scan de segredos, isolamento A×B testado).

### 07 — [Infraestrutura e DevOps](07-infraestrutura-e-devops.md)

- Infra 100% gerenciada (PaaS), sem servidores ou IaC próprios: Vercel (frontend + Route Handlers),
  Supabase (Postgres + Auth + backups), GitHub (repo + Actions).
- Regra de chaves: `anon` pode ir ao browser; `service_role` só no servidor; segredos de integrações
  futuras ficam em variável de ambiente da Vercel ou no Supabase Vault, nunca no repositório.
- Três ambientes: local (`pnpm dev`), preview (Vercel Preview por PR) e production — cada um com
  suas próprias variáveis; nunca copiar dado real de produção para dev/staging sem anonimizar.
- CI (todo PR, `.github/workflows/ci.yml`): lint/format, **scan de segredos (gitleaks)**, testes,
  SAST + SCA, build.
- CD: merge na `main` dispara deploy automático na Vercel Production; PR gera preview deployment;
  migrations aplicadas manualmente/via script no Supabase (com backup) antes/depois do deploy;
  rollback é redeploy de uma versão anterior na Vercel.
- Branch `main` protegida: PR obrigatório, checks verdes, 1+ aprovação, sem push direto.
- Migrations SQL vivem em `supabase/migrations/`, aplicadas via SQL Editor ou Supabase CLI — **não
  há Terraform**.

### 08 — [Resiliência e Observabilidade](08-resiliencia-e-observabilidade.md)

- Princípios: falha isolada nunca derruba o portal inteiro; integrações assíncronas e desacopladas
  (futuro); idempotência em tudo que escreve; degradação graciosa em vez de erro genérico.
- Padrões previstos para as integrações (ainda futuro, não implementado hoje): timeout, retry com
  backoff exponencial + jitter, circuit breaker, bulkhead, dead-letter queue, reconciliação diária.
- Ação crítica "Transferir": requisição carrega `Idempotency-Key`, grava `comando_admin` como
  `PENDENTE`, worker executa em etapas idempotentes, falha parcial reprocessa só a etapa pendente,
  tudo auditado.
- Frescor de dado: cada fonte registra `ultima_exec` em `sync_state`; UI mostra "atualizado há X
  min"; atraso acima do limite (ex. 1h) gera aviso na UI + alerta interno.
- Observabilidade hoje é a nativa das plataformas: Vercel (runtime logs, analytics, speed insights)
  e Supabase (logs de query/Auth, reports de saúde do banco) — nunca logar CPF/CNPJ, token, senha
  ou a service role key.
- Metas (SLO) definidas: disponibilidade 99,5%, p95 do dashboard e da busca < 2s, sucesso de
  sincronização > 99%, atraso de sync < 15 min (alerta se > 1h), erro 5xx < 0,5%.
- DR: RPO conforme plano Supabase (PITR no Pro); RTO é redeploy na Vercel (minutos) + restore se
  necessário; a réplica pode sempre ser reconstruída via nova sincronização, pois a fonte da verdade
  são os sistemas de origem.

### 09 — [Roadmap e Entregáveis da Fase 0](09-roadmap-e-fase-0.md)

- O próprio documento traz uma **nota de reconciliação (2026-11-05)**: nasceu descrevendo a Fase 0
  e ficou parado nesse ponto enquanto o sistema seguia em frente — hoje o portal já tem 17
  migrations aplicadas, dashboard do credor com KPIs reais, admin completo, sincronização de
  múltiplas fontes (ABE Web e ABE Delphi via agente on-premise) e o Construtor de Relatórios com IA
  (que pela própria tabela de fases do documento é entrega de **Fase 4**). Ou seja: o faseamento
  sequencial rígido (0→1→2→3→4) não é o que aconteceu de fato.
- Faseamento nominal: 0 Fundação, 1 MVP, 2 Integrações completas, 3 Multiempresa/produto,
  4 Inteligência.
- Checklist de conclusão da Fase 0 (revisado em 2026-11-05, com evidência por item) está majoritariamente
  concluído; os dois itens em aberto são: validação de campo do acesso seguro ao SQL Server 2005
  com a equipe ABE (a arquitetura já está decidida e implementada, falta validar na prática) e a
  formalização de um plano estimado da Fase 1 (a entrega já aconteceu, mas não há documento de
  estimativa registrado).
- Também sinaliza que o índice de ADRs (`docs/adr/README.md`) está desatualizado quanto ao status
  de cada ADR — correção pendente, fora do escopo dessa revisão.
- Decisões pendentes listadas: qual a primeira fonte a priorizar tecnicamente, onde hospedar os
  workers de integração, equipe e prazo.

### 10 — [Modelo Tenant · Credores · Usuários](10-modelo-tenant-usuarios-credores.md)

- Regra central: **um credor = um tenant** (1:1). Usuários internos da ABE ficam num tenant de
  plataforma, sem credor associado.
- Cadastrar um credor cria, numa transação só, `tenants` → `credores` → `usuarios` (papel
  `ADMIN_CREDOR`, o responsável) — nunca o contrário: criar em `/admin/usuarios` não vira credor,
  só cria admin de plataforma.
- `/admin/usuarios` só lista a equipe ABE (tenants sem credor); logins de credor não aparecem ali.
- E-mail de login é único em toda a plataforma (índice em `lower(email)`) e é diferente do e-mail
  comercial do credor (`credores.email_comercial`).
- Senha mora só no Supabase Auth — `public.usuarios` nunca guarda hash de senha.
- `paginasAcesso` no cadastro do credor controla quais módulos aparecem no menu daquele tenant.
- Erros comuns documentados: usuário criado em Auth sem linha em `usuarios` (login falha), mesmo
  e-mail em dois tenants, service role usada no browser, editar responsável fora do formulário do
  credor.
- Traz as credenciais de seed de desenvolvimento (ver o documento — não repetidas aqui) e lembra de
  trocá-las antes de produção.

### Complementos

- **[`adr/`](adr/)** — Architecture Decision Records: stack tecnológico, monólito modular vs.
  microserviços, identidade/autenticação, isolamento multi-tenant, acesso ao legado SQL Server
  2005, e adaptação do blueprint SaaS ao Supabase. O índice (`adr/README.md`) registra o status de
  cada um, mas o próprio doc 09 já aponta esse índice como desatualizado — confira o cabeçalho de
  cada ADR individual se o status exato importar para a sua decisão.
- **[ONBOARDING-EQUIPE.md](ONBOARDING-EQUIPE.md)** — guia de 5 passos para um dev novo (clone,
  `pnpm install`, variáveis de ambiente, schema + seed, `pnpm dev`); fluxo diário de Git (branch →
  commit → PR → review → merge, nunca push direto em `main`); divisão sugerida do monorepo por
  pessoa; e o passo a passo de conectar o projeto na Vercel (Root Directory `apps/web`).
- **[VERCEL-DEPLOY.md](VERCEL-DEPLOY.md)** — variáveis de ambiente obrigatórias na Vercel
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_API_BASE_URL`) e troubleshooting de erro 500: Root Directory errado, framework de
  produção divergente, `output: 'standalone'` indevido (é só para Docker, quebra a Vercel), e
  checklist para 401/403 no login/admin.
- **[`../supabase/README.md`](../supabase/README.md)** — setup do banco e Auth no Supabase.

## Princípios que guiam o projeto

1. **Segurança por padrão.** Service role só no servidor; RLS no banco.
2. **Privacidade por padrão (LGPD).** Dados pessoais tratados desde o desenho.
3. **Isolamento de tenant.** Um credor nunca acessa dado de outro — RLS + RBAC.
4. **Nunca tocar o legado em tempo real.** SQL Server 2005 → agente → Supabase.
5. **Idempotência em ações críticas.** Transferir/baixar nunca duplica.
6. **Falha isolada, não falha total.** Fonte indisponível → UI degrada com transparência.
7. **Tudo versionado e documentado.** Código, migrations SQL e decisões (ADR).

## Status

| Item | Status |
|------|--------|
| Fase | **Além da Fase 1 (MVP), com entregas de Fase 4** — ver nota de reconciliação no [item 09](09-roadmap-e-fase-0.md) |
| Stack | **Supabase + Next.js 15 + Vercel** (decidido, em produção) |
| Próximo marco | Ver pendências abertas no [item 09, seção 9.3](09-roadmap-e-fase-0.md) e o Cronograma público (`/cronograma`) |
