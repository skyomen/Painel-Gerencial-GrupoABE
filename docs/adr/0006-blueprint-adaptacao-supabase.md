# ADR-0006 — Adaptação do SAAS-STRUCTURE-BLUEPRINT ao Supabase

Status: **Aceito**
Data: 2026-07-23

## Contexto

O repositório inclui `SAAS-STRUCTURE-BLUEPRINT.md`, inspirado em AvantPay (Next.js + Spring Boot +
Docker Compose com Postgres local). O Painel Gerencial Grupo ABE já opera com **Next.js + Supabase
(Auth + PostgreSQL + RLS) + Vercel**.

Seguir o blueprint **ao pé da letra** (Spring Boot + segundo Postgres “oficial”) duplicaria Auth,
brigaria com RLS e aumentaria custo operacional sem benefício de produto.

## Decisão

1. Tratar o blueprint como **checklist de princípios** (fail-closed, multi-perfil, cookies HttpOnly,
   migrations, secrets, isolamento), **não** como receita de stack.
2. Equivalências oficiais deste projeto:

| Blueprint | Equivalente ABE |
|-----------|-----------------|
| `apps-api` Spring Boot | Route Handlers Next (`/api/*`) + Supabase |
| JWT cookie próprio + Argon2 | Supabase Auth (cookies SSR `@supabase/ssr`) |
| Postgres no Compose | Supabase PostgreSQL + RLS |
| Liquibase/Flyway | `supabase/migrations/*.sql` |
| BFF `/api/core` | `/api/admin`, `/api/auth`, `/api/dashboard` |
| `/app/*` | `/dashboard` |
| `/admin/home` | `/admin/credores` |
| MailHog | Fase futura (esqueci senha) |

3. Política de cruzamento de áreas:
   - Credor **não** acessa `/admin/*` → `/sem-permissao`
   - `SUPER_ADMIN` **pode** acessar `/dashboard` (suporte)
4. Compose local permanece **opcional** (Postgres de experimento) e **não** substitui o Supabase.

## Consequências

**Positivas**

- Uma fonte de verdade (Supabase) para Auth, dados e políticas.
- Menor latência e operação (sem hop Spring).
- Princípios de segurança do blueprint preservados.

**Negativas**

- Onboarding Docker “um comando sobe tudo” não se aplica ao Auth/RLS.
- Rate limit de login é por instância (memória); reforçar no edge se houver abuso.

## Alternativas consideradas

- **Migrar para Spring + Postgres local:** rejeitada — custo alto, conflito com Supabase Auth/RLS.
- **Ignorar o blueprint:** rejeitada — princípios de isolamento e fail-closed continuam obrigatórios.
