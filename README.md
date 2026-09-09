# Painel Gerencial Grupo ABE

Portal SaaS que consolida, em uma única interface, a régua de cobrança hoje espalhada por quatro
sistemas (Avantpay, ABE Interno/Delphi, ABEWeb e Acordo Seguro). Acessado externamente por clientes
credores, com foco em **segurança**, **isolamento multi-tenant**, **conformidade LGPD** e
**resiliência**.

> 📚 **Comece pela documentação:** [`docs/GUIA-DO-PROJETO.md`](docs/GUIA-DO-PROJETO.md) · [`AGENTS.md`](AGENTS.md) · [`supabase/README.md`](supabase/README.md)

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 15 + TypeScript + Tailwind |
| Backend / Banco / Auth | **Supabase** (PostgreSQL + Auth + RLS) |
| Admin / Auth API | Next.js Route Handlers (`/api/admin/*`, `/api/auth/*`) |
| Deploy frontend | Vercel |
| Workers de integração | TypeScript (fase futura) |
| Monorepo | pnpm workspaces + Turborepo |

> **Blueprint:** `SAAS-STRUCTURE-BLUEPRINT.md` descreve princípios de SaaS. Neste repo a stack
> equivalente é Supabase (não Spring). Detalhes: [ADR-0006](docs/adr/0006-blueprint-adaptacao-supabase.md).

## Estrutura do repositório

```text
apps/
  web/       # frontend + Route Handlers (Next.js)
  workers/   # workers de integração com as fontes (fase futura)
packages/
  canonical-model/  # tipos/enums do modelo de dados (compartilhado)
  config/           # configurações compartilhadas (ESLint)
supabase/    # migrations SQL, seed, documentação do banco
docs/        # documentação técnica + ADRs
AGENTS.md    # regras para IAs e desenvolvedores
```

## Começar a desenvolver

### Na máquina (pnpm)

```bash
corepack enable
pnpm install
cp .env.example .env
# Preencha NEXT_PUBLIC_SUPABASE_* e SUPABASE_SERVICE_ROLE_KEY (Dashboard Supabase → API)
# Execute as migrations em supabase/migrations/ no SQL Editor do Supabase
pnpm db:seed
pnpm dev
```

### Com Docker (app local ≠ produção)

```bash
cp .env.example .env   # preencher Supabase
pnpm docker:up         # http://localhost:3000
pnpm docker:down
```

| Ambiente | Como roda |
|----------|-----------|
| **Local** | `pnpm dev` **ou** `pnpm docker:up` |
| **Produção** | **Vercel** + Supabase (não é este Compose) |
| Teste prod-like | `pnpm docker:prod-like` (imagem standalone) |

- Frontend: <http://localhost:3000>
- Health: <http://localhost:3000/api/health>
- Login: <http://localhost:3000/login>

Veja o [guia de contribuição](CONTRIBUTING.md) e [`supabase/README.md`](supabase/README.md).

## Documentação

| Documento | Assunto |
|-----------|---------|
| [AGENTS.md](AGENTS.md) | Regras para IA/devs (rotas, proibições, stack) |
| [supabase/README](supabase/README.md) | Setup Supabase, seed, RLS |
| [docs/GUIA-DO-PROJETO](docs/GUIA-DO-PROJETO.md) | Guia vivo para quem altera código |
| [docs/VERCEL-DEPLOY](docs/VERCEL-DEPLOY.md) | Deploy na Vercel |
| [ADR-0006](docs/adr/0006-blueprint-adaptacao-supabase.md) | Blueprint × Supabase |
| [docs/10](docs/10-modelo-tenant-usuarios-credores.md) | Modelo tenant, credores e usuários |
| [docs/README](docs/README.md) | Índice técnico completo |

## Status

**Fase 0 — Fundação.** Stack Supabase + Next.js operacional. Próximo: Fase 1 (MVP carteira).

## Licença

Software proprietário — MK Solutions / Grupo ABE. Todos os direitos reservados.
