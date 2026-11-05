# 09 — Roadmap e Entregáveis da Fase 0

> **Nota de reconciliação (2026-11-05).** Este documento nasceu descrevendo a Fase 0
> (planejamento/fundação) e ficou parado nesse ponto enquanto o sistema seguia em frente. Na
> prática, hoje o portal já tem: 17 migrations aplicadas, dashboard do credor com KPIs reais,
> admin completo (credores, usuários, diretoria, configurações), sincronização de múltiplas
> fontes (ABE WEB e ABE Delphi, via agente on-premise — ADR-0005) e o Construtor de Relatórios
> com IA (que é, pela própria definição da tabela 9.1, entrega de **Fase 4 — Inteligência**).
> Ou seja: o projeto já passou da Fase 1 (MVP) e já entrega pedaços da Fase 4, sem que as
> Fases 2 e 3 tenham sido formalmente fechadas no meio do caminho — faseamento sequencial
> rígido não é o que aconteceu de fato. O checklist abaixo (9.3) foi corrigido para refletir o
> que existe hoje; a seção 9.1/9.2 permanece como registro histórico de como a Fase 0 foi
> planejada, não como "onde o projeto está agora".

## 9.1 Visão de faseamento

| Fase | Nome | Objetivo | Resultado |
|------|------|----------|-----------|
| **0** | **Fundação** | Planejar, documentar e preparar a base | Documentação + esqueleto técnico |
| **1** | **MVP** | 1 integração real + dashboard + busca + auth | Portal usável por 1 credor piloto |
| **2** | **Integrações completas** | Conectar as 4 fontes + ações admin | Visão 360º completa |
| **3** | **Multiempresa & produto** | Onboarding self-service, planos, billing | Vendável em escala |
| **4** | **Inteligência** | Relatórios avançados, BI, previsões | Diferenciação competitiva |

## 9.2 O que é a Fase 0 (escopo desta fase)

A Fase 0 **não escreve o produto completo**. Ela cria a **fundação** sobre a qual o produto será construído.

### A) Documentação (`docs/`) — ✅ em andamento

Visão, arquitetura, dados, backend, frontend, segurança/LGPD, infra, resiliência, roadmap.

### B) Decisões registradas (ADRs) — `docs/adr/`

Stack Supabase + Next.js, estilo arquitetural, identidade, multi-tenant, acesso ao legado.

### C) Esqueleto do repositório

- Monorepo (`apps/web`, `apps/workers`, `packages/*`, `supabase/`).
- Seed em `supabase/seed.mjs`.
- Lint, format, commit hooks, Conventional Commits.
- CI base (GitHub Actions).

### D) Modelo de dados inicial

- Schema em `supabase/migrations/001_initial_schema.sql` (tenants, usuarios, credores, RLS).

### E) Baseline de segurança

- Supabase Auth + RLS.
- Service role restrita a Route Handlers admin.
- Política de mascaramento de CPF/CNPJ definida.

### F) Infraestrutura

- **Supabase** (PostgreSQL + Auth) — projeto provisionado.
- **Vercel** — deploy do `apps/web` documentado.
- Sem IaC próprio — configuração via Dashboards.

### G) Padrões e governança

- Definition of Done, padrão de PR, política de branches.

## 9.3 Checklist de conclusão da Fase 0

Revisado em 2026-11-05 contra o estado real do repositório (código, não memória) — cada item
traz a evidência que sustenta a marcação.

- [x] Documentação técnica completa em `docs/`.
- [x] Stack Supabase + Next.js + Vercel definida (ADR-0001, ADR-0003).
- [x] Schema inicial + RLS no Supabase — e muito além do "inicial": 17 migrations aplicadas
      (`supabase/migrations/001` a `017`).
- [x] Auth funcional (Supabase Auth + admin Route Handlers).
- [x] ADRs revisados e aprovados — 5 de 6 com `Status: Aceito` (0001, 0002, 0003, 0005, 0006).
      **Exceção**: ADR-0004 (multi-tenant e isolamento) segue `Status: Proposto`. O índice em
      `docs/adr/README.md` também está desatualizado (lista todas como "Proposto") e precisa
      de uma segunda correção, fora do escopo desta revisão.
- [x] Acesso e documentação das APIs das fontes confirmados — duas fontes já sincronizando em
      produção (ABE WEB e ABE Delphi, `sistema_origem` desde a migration 004; cron em
      `.github/workflows/sync-abeweb-cron.yml`).
- [ ] Forma de acesso seguro ao SQL Server 2005 validada com a equipe ABE — a arquitetura está
      decidida e implementada (ADR-0005, aceito), mas o próprio ADR deixa em aberto: "SQL 2005
      não tem CDC moderno → detecção de mudança via coluna de controle/triggers (**validar com
      equipe ABE**)". Decisão tomada, validação de campo ainda registrada como pendente.
- [x] CI base rodando verde — `.github/workflows/ci.yml` existe e roda os mesmos comandos
      (`typecheck`, `lint`, `test`) confirmados passando nesta sessão. Não confirmei o status
      verde direto no GitHub Actions (sem `gh` CLI disponível nesta máquina) — se quiser essa
      confirmação literal, è checar a aba Actions do repositório.
- [x] Deploy Vercel em produção/preview testado — `vercel.json` na raiz e em `apps/web`,
      `docs/VERCEL-DEPLOY.md` documentando o processo.
- [x] Threat model documentado — `docs/06-seguranca-e-lgpd.md §6.1`, resumo STRIDE.
- [ ] Plano da Fase 1 (MVP) detalhado e estimado — a Fase 1 foi construída e já superada, mas
      não há evidência de que o plano em si (estimativa, não só a entrega) tenha sido
      formalizado em documento. Item de processo que ficou para trás, não bloqueador técnico.

## 9.4 Proposta de MVP (Fase 1)

Menor fatia que entrega valor:

1. **Auth** (Supabase Auth + RBAC + tenant) com 1 tenant piloto.
2. **Uma integração real** (Acordo Seguro via webhook ou Avantpay via API).
3. **Sincronização → Supabase PostgreSQL** com idempotência.
4. **Dashboard** com KPIs reais + listagem consolidada.
5. **Busca por CPF/CNPJ** (mascarada).
6. **Observabilidade e auditoria** mínimas + deploy Vercel.

## 9.5 Decisões confirmadas / pendentes

| # | Decisão | Status | Escolha |
|---|---------|--------|---------|
| 1 | Frontend + API serverless | ✅ Decidido | Next.js 15 na Vercel |
| 2 | Backend de dados | ✅ Decidido | Supabase (PostgreSQL + Auth + RLS) |
| 3 | Provedor de identidade | ✅ Decidido | Supabase Auth (ADR-0003) |
| 4 | Primeira fonte a integrar (MVP) | ⏳ Pendente | a de acesso/documentação mais fácil |
| 5 | Workers de integração (hosting) | ⏳ Pendente | Vercel Cron / processo dedicado / Edge Functions |
| 6 | Equipe e prazo | ⏳ Pendente | a definir |

## 9.6 Riscos e mitigação

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| APIs das fontes sem documentação | Atraso na integração | Validar acesso na Fase 0; começar pela mais madura |
| SQL Server 2005 (EOL) | Performance/segurança do legado | Agente on-premise → Supabase; nunca em tempo real |
| Vazamento entre tenants | Crítico (LGPD) | RLS + RBAC + testes de isolamento |
| Cobrança duplicada na transferência | Financeiro/confiança | Idempotência + reconciliação |
| Exposição da service role key | Crítico | Somente servidor; nunca `NEXT_PUBLIC_*` |
| Escopo crescer demais | Atraso | Faseamento rígido; MVP enxuto |

## 9.7 Próximos passos imediatos

1. Revisar e aprovar documentação e ADRs atualizados.
2. Confirmar primeira fonte para MVP (seção 9.5).
3. Levantar acesso/documentação das APIs das fontes.
4. Deploy Vercel em produção com variáveis Supabase.
5. Detalhar e estimar a Fase 1 (MVP).
