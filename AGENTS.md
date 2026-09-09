# AGENTS.md — Painel Gerencial Grupo ABE

Regras para humanos e IAs que alteram este repositório.

## Stack (não negociável neste projeto)

- **Frontend + BFF:** Next.js 15 (`apps/web`) — Route Handlers em `/api/*`
- **Auth + DB + RLS:** Supabase (PostgreSQL gerenciado)
- **Deploy:** Vercel (web) + Supabase (dados/auth)
- **Sync legado:** scripts Node + GitHub Actions (`pnpm sync:abeweb`)

**Não** introduzir Spring Boot, segundo Postgres “oficial”, nem JWT em `localStorage`.  
O arquivo `SAAS-STRUCTURE-BLUEPRINT.md` é checklist de **princípios**; a adaptação desta stack está no ADR-0006.

## Perfis e rotas

| Papel | UI | API |
|-------|----|-----|
| `SUPER_ADMIN` | `/admin/*` (home: `/admin/credores`) | `/api/admin/**` |
| `ADMIN_CREDOR` / `OPERADOR` / `VIEWER` | `/dashboard` | `/api/dashboard`, `/api/metricas` |

- Sem sessão → `/login`
- Credor em `/admin/*` → `/sem-permissao`
- `SUPER_ADMIN` **pode** abrir `/dashboard` (suporte) — política documentada
- `/dashboard?credorId=<id>` = prévia do painel do credor (botão “Ver dashboard” em `/admin/credores`).
  Só `SUPER_ADMIN`; para os demais papéis a API responde 403 e o parâmetro é ignorado na UI
- UI só esconde; **API e RLS** bloqueiam de verdade

## Onde commitar o quê

Monorepo único (`pnpm` + Turborepo):

- UI / Route Handlers → `apps/web`
- Modelo compartilhado → `packages/canonical-model`
- Sync / provision → `scripts/`
- Schema → `supabase/migrations/` (nunca ALTER manual sem migration)

## Como subir (dev)

### Opção A — Node na máquina (rápido)

```bash
cp .env.example .env   # preencher Supabase + ABEWEB_*
pnpm install
# aplicar migrations no SQL Editor / CLI Supabase
pnpm db:seed
pnpm dev               # http://localhost:3000
```

### Opção B — Docker (app local isolado da produção)

```bash
cp .env.example .env   # mesmas chaves Supabase (ou projeto de staging)
pnpm docker:up         # = docker compose up --build
# http://localhost:3000  ·  health: /api/health
pnpm docker:down
```

- **Local:** container `abe-web-local` (hot reload)
- **Produção:** Vercel — **não** usa este Compose
- Teste “como produção”: `pnpm docker:prod-like`
- Postgres/Adminer opcional (experimento): `pnpm docker:tools`

Health: `GET /api/health`  
O Compose **não** substitui o Supabase (Auth/RLS continuam na nuvem).

## Proibições

1. Secrets no Git (`.env`, service role, senhas)
2. `SUPABASE_SERVICE_ROLE_KEY` no client / bundle
3. Escrita no SQL Server legado (somente SELECT)
4. Dados fake no dashboard de produção
5. Autorização só no frontend
6. Hardcode de credenciais

## Seeds

Somente ambientes locais/dev via `pnpm db:seed`. Nunca seed automático em produção com senhas default.
