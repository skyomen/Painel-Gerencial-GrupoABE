# Blueprint de Estrutura — SaaS Multi-Perfil (Nível Produção)

> **Adaptação deste repositório (Grupo ABE)**  
> Este blueprint continua válido como **checklist de princípios**.  
> A stack canônica do Painel ABE é **Next.js + Supabase + Vercel** (não Spring Boot).  
> Ver [`AGENTS.md`](AGENTS.md) e [`docs/adr/0006-blueprint-adaptacao-supabase.md`](docs/adr/0006-blueprint-adaptacao-supabase.md).  
> Não implementar Spring/Compose “full stack” sem ADR novo que substitua o 0006.

> **Objetivo deste documento**  
> Servir como **especificação obrigatória** para:
> 1. **Criar** um novo SaaS do zero com estrutura parruda, segura e organizada.
> 2. **Auditar** um projeto existente e dizer se ele se adequa (gap analysis).
> 3. Orientar **qualquer IA** a implementar sem inventar atalhos inseguros.
>
> **Inspiração estrutural:** AvantPay (Next.js + Spring Boot + Docker + multi-perfil + BFF).  
> **Não** copia regras de negócio do AvantPay. Copia o **modelo de engenharia**.

---

## 0. Como usar este documento (para humanos e IAs)

### 0.1 Se a tarefa for CRIAR um projeto novo

A IA deve:

1. Ler este arquivo **inteiro** antes de gerar código.
2. Seguir as seções como **checklist obrigatório** (não opcional).
3. Entregar um sistema que:
   - Clone → configure → `docker compose up` → abre no browser.
   - Tem **LOGIN**.
   - Após login redireciona para uma **página autenticada** (não precisa ser dashboard).
   - Tem **dois perfis** com **rotas isoladas**:
     - `ADMIN` → área `/admin/*`
     - `APP_USER` (ex.: operador/tenant) → área `/app/*`
   - Não vaza dados entre perfis/tenants.
4. Nunca hardcodar secrets reais. Usar `.env.example` + variáveis de ambiente.
5. Nunca commitar `.env`, chaves, dumps com PII, nem credenciais.

### 0.2 Se a tarefa for AUDITAR um projeto existente

A IA deve produzir um relatório com:

| Item do blueprint | Status | Evidência (arquivo/linha) | Risco | Ação |
|-------------------|--------|---------------------------|-------|------|
| … | ✅ / ⚠️ / ❌ | … | Baixo/Médio/Alto/Crítico | … |

No final: **nota de adequação (0–100)** + **plano de adaptação priorizado**.

### 0.3 Princípios não negociáveis

1. **Separação frontend / backend** (repos ou pastas com Git/CI independentes).
2. **Backend é a única fonte de verdade de autorização** (UI só esconde; API bloqueia).
3. **Cookies HttpOnly** para sessão (não armazenar JWT em `localStorage`).
4. **Isolamento por perfil e, se multi-tenant, por tenant**.
5. **Docker Compose** para ambiente local reproduzível.
6. **Migrations versionadas** de banco (nunca “alter table” manual sem versionamento).
7. **Secrets só via ambiente**.
8. **Least privilege** — cada usuário só vê o mínimo necessário.
9. **Fail closed** — na dúvida, negar acesso.
10. **Observabilidade mínima** — healthcheck, logs sem PII/senha/token.

---

## 1. Visão da arquitetura-alvo

```
┌─────────────────────────────────────────────────────────────────┐
│                        WORKSPACE LOCAL                           │
│  meu-saas/                                                       │
│  ├── AGENTS.md / este blueprint                                  │
│  ├── docker-compose.yml                                          │
│  ├── apps-web/          ← Frontend (Next.js)  [repo Git]         │
│  └── apps-api/          ← Backend (Spring Boot) [repo Git]       │
└─────────────────────────────────────────────────────────────────┘

Browser
  │
  ▼
Next.js (UI + BFF /api/core/*)
  │  - Guard de rota por role (edge/proxy)
  │  - Nunca fala direto com DB
  ▼
Spring Boot API
  │  - Auth JWT (cookie)
  │  - Autorização por role (+ permissões opcionais)
  │  - Tenant context (se multi-tenant)
  ▼
PostgreSQL  (+ Mailhog local)  (+ fila opcional: Kafka/Redis)
```

### 1.1 Por que Docker?

| Função | Explicação |
|--------|------------|
| Local | Sobe API + UI + DB (+ mail/fila) com um comando |
| Paridade | Dev ≈ CI ≈ staging (mesmas imagens/serviços) |
| Onboarding | Novo dev: clonar + compose = ambiente |
| Produção | Imagens buildadas; orquestração (Compose/K8s/ECS) usa as mesmas imagens |

**Docker não substitui o código.** Código fica nos repos; Docker **empacota e executa**.

### 1.2 Por que front separado do back?

- Deploys independentes
- Commits limpos por responsabilidade
- Escalabilidade distinta (UI estática/SSR vs API)
- Fronteira de segurança clara: browser nunca toca o banco

---

## 2. Organização de repositórios e Git

### 2.1 Estrutura de pastas (obrigatória)

```
meu-saas/                          ← pasta workspace (NÃO precisa ser Git)
├── SAAS-STRUCTURE-BLUEPRINT.md    ← este arquivo
├── AGENTS.md                      ← regras para IA/devs do workspace
├── README.md                      ← como subir em 5 minutos
├── docker-compose.yml             ← orquestra tudo (contextos ./apps-web e ./apps-api)
├── .env.example                   ← variáveis sem segredos reais
├── apps-web/                      ← Git próprio
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   └── ...
└── apps-api/                      ← Git próprio
    ├── Dockerfile
    ├── build.gradle / pom.xml
    ├── src/main/java/...
    └── src/main/resources/db/changelog/
```

### 2.2 Regras Git

- **Nunca** inicializar Git na pasta raiz do workspace se houver dois repos.
- Commits de UI **somente** em `apps-web`.
- Commits de API/DB **somente** em `apps-api`.
- Feature full-stack = **dois commits/PRs**.
- Branch de trabalho do desenvolvedor (ex.: `meykson` / `feature/nome`).
- Proteger `main`/`master`/`develop` com PR + review.
- `.gitignore` deve excluir: `.env`, `*.pem`, `node_modules`, `build/`, `.next/`, dumps.

### 2.3 Mensagens de commit

- Foco no **porquê**.
- Escopo claro: `web:` ou `api:` no prefixo ajuda.

---

## 3. Stack recomendada (equivalente “parruda” ao AvantPay)

| Camada | Tecnologia recomendada | Alternativa aceitável |
|--------|------------------------|------------------------|
| Frontend | **Next.js (App Router) + React** | Nuxt / Remix (desde que mantenha BFF) |
| Estilo | CSS Modules / Tailwind (consistente) | — |
| HTTP client | Axios ou fetch tipado | — |
| Backend | **Spring Boot 3 + Java 17+** | NestJS / .NET — desde que camadas e security equivalentes |
| Auth | JWT em cookie HttpOnly + refresh | Session server-side (também ok) |
| Hash de senha | **Argon2** (preferencial) ou bcrypt custo alto | — |
| Banco | **PostgreSQL** | — |
| Migrations | **Liquibase** ou Flyway | Obrigatório um dos dois |
| E-mail local | MailHog / Mailpit | — |
| Fila (opcional fase 2) | Kafka ou RabbitMQ/Redis Streams | Só se houver caso real |
| Container | Docker + Compose | — |
| Testes | Vitest/Jest (web) + JUnit (api) | — |

> **Fase 1 (MVP estrutural):** Web + API + Postgres + Mail + Docker.  
> **Fase 2:** Fila, multi-tenant avançado, observabilidade, CI completo.

---

## 4. Modelos de usuário e rotas (OBRIGATÓRIO)

### 4.1 Dois perfis mínimos

| Role | Prefixo de rota UI | Home pós-login | Propósito |
|------|--------------------|----------------|-----------|
| `ADMIN` | `/admin/*` | `/admin/home` (ou `/admin/overview`) | Visão plataforma / backoffice |
| `APP_USER` | `/app/*` | `/app/home` (pode **não** ser dashboard) | Visão do cliente/operador do produto |

> Nomes podem mudar (`CREDOR`, `TENANT_ADMIN`, etc.), mas a **isolamento por prefixo** é obrigatória.

### 4.2 Telas mínimas (MVP)

**Públicas**
- `/` — Login
- `/sem-permissao` — acesso negado
- (opcional) `/esqueci-senha`

**Autenticadas APP_USER**
- `/app/home` — primeira página após login (lista, boas-vindas, ou área principal — **não precisa ser dashboard com gráficos**)

**Autenticadas ADMIN**
- `/admin/home` — primeira página admin

### 4.3 Regras de roteamento (fail closed)

1. Sem cookie/token válido → redirecionar para `/` (login).
2. `APP_USER` tentando `/admin/*` → `/sem-permissao` ou redirect para `/app/home`.
3. `ADMIN` tentando `/app/*` → `/sem-permissao` ou redirect para `/admin/home` (definir uma política e manter).
4. Token expirado → login com `?session=expired`.
5. **UI guard NÃO é segurança.** API deve retornar `401/403` mesmo se alguém burlar a UI.

### 4.4 Fluxo de login

```
POST /api/auth/login { username|email, senha }
  → valida credenciais (Argon2)
  → valida status do usuário (ativo, e-mail confirmado se aplicável)
  → emite JWT
  → Set-Cookie: token (HttpOnly; Secure em prod; SameSite=Strict|Lax)
  → (opcional) Set-Cookie: csrf-token (não HttpOnly) para refresh
  → frontend redireciona:
       ADMIN     → /admin/home
       APP_USER  → /app/home
```

### 4.5 Logout

- Invalida cookie (`Max-Age=0`).
- Frontend limpa estado em memória.
- Não deixar token em storage persistente do browser.

---

## 5. Frontend — estrutura obrigatória

### 5.1 Pastas sugeridas (Next.js App Router)

```
apps-web/src/
├── app/
│   ├── (public)/
│   │   ├── page.tsx                 # LOGIN
│   │   ├── sem-permissao/page.tsx
│   │   └── ...
│   ├── (protected)/
│   │   ├── admin/
│   │   │   ├── layout.tsx           # guard ADMIN
│   │   │   └── home/page.tsx
│   │   └── app/
│   │       ├── layout.tsx           # guard APP_USER
│   │       └── home/page.tsx
│   └── api/
│       ├── core/[[...path]]/route.ts   # BFF proxy → API
│       └── logout/route.ts
├── features/auth/                   # form login, service, schema
├── lib/axios/                       # baseURL = /api/core
├── proxy.ts                         # guard de rotas (edge)
└── urls.ts                          # mapa canônico de rotas
```

### 5.2 BFF (obrigatório)

O browser **não** chama a API interna diretamente em produção/local docker com hosts internos.

- Client HTTP usa `baseURL: '/api/core'`.
- Route Handler encaminha para `process.env.API_CORE` (ex.: `http://api-core:8080`).
- Propaga `Set-Cookie`.
- Implementa refresh de token (proativo/reativo) sem expor o JWT ao JS desnecessariamente.

### 5.3 Guard de rota (proxy/middleware)

Responsabilidades:

- Ler cookie `token`.
- Decodificar claims **somente para UX/roteamento** (role, exp).
- **Nunca** tratar decode no edge como prova criptográfica final (a API valida assinatura).
- Isolar `/admin` vs `/app`.

### 5.4 O que o frontend NÃO pode fazer

- ❌ Conectar em PostgreSQL
- ❌ Guardar senha/token em `localStorage` / `sessionStorage`
- ❌ Confiar só em `if (role === 'ADMIN')` no client sem proteção de API
- ❌ Logar tokens, senhas, ou PII no console em produção
- ❌ Expor `API_CORE` interno com segredos no bundle client

---

## 6. Backend — estrutura obrigatória

### 6.1 Camadas

```
controller/     → HTTP, validação de entrada, status codes
service/        → regras de aplicação
repository/     → acesso a dados
domain/         → entidades, enums, value objects
security/       → JWT filter, UserDetails, password encoder
config/         → SecurityConfig, CORS, cookies
```

Regras:

- Controller **magro** (sem SQL, sem regra pesada).
- Service **não** retorna entidade interna crua se houver risco de oversharing — usar DTO/Query.
- Repository **não** decide autorização.

### 6.2 Security checklist (API)

| Controle | Obrigatório |
|----------|-------------|
| Password hashing Argon2/bcrypt | ✅ |
| JWT assinado com secret forte (env) | ✅ |
| Cookie HttpOnly | ✅ |
| `Secure=true` em produção + HTTPS | ✅ |
| SameSite adequado | ✅ |
| CORS explícito (sem `*` com credentials em prod) | ✅ |
| Endpoints públicos em allowlist | ✅ |
| Demais endpoints autenticados por padrão | ✅ |
| Autorização por role nos controllers (`@PreAuthorize` / equivalente) | ✅ |
| Rate limit em `/auth/login` (fase 1 simples / fase 2 gateway) | ✅ recomendado |
| Não retornar stacktrace ao client | ✅ |
| Logs sem senha/token | ✅ |
| Validação Bean Validation (`@Valid`) | ✅ |
| SQL só via parameterized queries / JPA | ✅ |
| Headers de segurança (Helmet equivalente / Spring headers) | ✅ |

### 6.3 Endpoints mínimos

```
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh          # se usar refresh
GET    /api/me                    # dados do usuário logado (sem dados sensíveis)
GET    /api/app/home-summary      # exemplo APP_USER
GET    /api/admin/home-summary    # exemplo ADMIN
GET    /actuator/health           # health (restrito em prod se necessário)
```

### 6.4 Autorização por rota de API (espelha UI)

| Endpoint prefix | Roles |
|-----------------|-------|
| `/api/admin/**` | `ADMIN` |
| `/api/app/**` | `APP_USER` (e opcionalmente `ADMIN` se política permitir) |
| `/api/auth/**` | público (exceto logout/refresh conforme desenho) |
| `/api/me` | autenticado |

Qualquer mismatch UI↔API é **bug de segurança**.

---

## 7. Banco de dados

### 7.1 Modelo mínimo (fase 1 — single DB, multi-role)

Tabelas mínimas:

```
usuario
  - id
  - email (unique)
  - senha_hash
  - nome
  - role                 # ADMIN | APP_USER
  - status               # ATIVO | INATIVO
  - email_confirmado
  - created_at
  - deleted              # soft delete opcional

# opcional logo na fase 1 se já houver “empresa/cliente”:
organizacao
  - id
  - nome
  - status

usuario_organizacao      # se APP_USER pertence a uma org
  - usuario_id
  - organizacao_id
```

### 7.2 Multi-tenant (fase 2 — padrão AvantPay-like)

Quando o negócio for SaaS B2B com isolamento forte:

1. Schema/DB **por tenant** **ou** `tenant_id` em todas as tabelas (escolher um e documentar).
2. Resolver tenant a partir do JWT (nunca do body livre sem validação).
3. Credenciais de conexão do tenant **criptografadas em repouso**.
4. Migrations **separadas**: `public` vs `tenant`.
5. Testes de isolamento: usuário A não lê dados B.

> Para o MVP deste blueprint, **multi-role já é obrigatório**.  
> Multi-tenant schema-per-tenant é **recomendado** se o negócio for B2B isolado.

### 7.3 Migrations

- Liquibase/Flyway no boot da API.
- Seeds **somente** em profile `local/dev/docker`.
- Seeds **nunca** em produção automaticamente com usuários/senhas default.

### 7.4 Soft delete

Se usar soft delete:

- Filtro global `deleted = false`.
- Uniques devem considerar soft delete (estratégia documentada).
- APIs não retornam registros deletados.

---

## 8. Docker — padrão obrigatório

### 8.1 Serviços mínimos no `docker-compose.yml`

| Serviço | Porta host sugerida | Função |
|---------|---------------------|--------|
| `web` | 3000 | Next.js |
| `api` | 8080 | Spring Boot |
| `postgres` | 5433→5432 | Banco |
| `mailhog` | 8025 (UI), 1025 (SMTP) | E-mails de dev |

### 8.2 Regras do Compose

1. Compose na **pasta pai** dos dois projetos (contextos `./apps-web` e `./apps-api`).
2. Variáveis sensíveis via env file **não commitado**.
3. Healthcheck na API (`/actuator/health` ou `/api/health`).
4. Web depende da API; API depende do Postgres healthy.
5. **Cuidado com volume bind** no frontend de produção/standalone: não sobrescrever o build (`server.js`) com o código fonte sem estratégia de dev explícita.
6. Profile/env `docker` na API para hosts internos (`postgres`, `api`, etc.).

### 8.3 Comandos canônicos

```bash
# na pasta pai
cp .env.example .env   # preencher valores locais
docker compose up -d --build

# URLs
# Web: http://localhost:3000
# API health: http://localhost:8080/actuator/health
# Mail: http://localhost:8025
```

### 8.4 README obrigatório (5 minutos)

O `README.md` raiz deve conter:

1. Pré-requisitos (Docker Desktop, Git)
2. Clone dos dois repos
3. Copiar `.env.example`
4. `docker compose up -d --build`
5. Usuários seed **somente local**
6. Como parar (`docker compose down`)

---

## 9. Segurança avançada (cirúrgico — sem falhas aceitáveis)

### 9.1 Segredos

- JWT secret ≥ 256 bits aleatórios, só em env.
- Chaves de criptografia distintas por propósito (cookie/JWT ≠ criptografia de campo).
- Rotacionar secrets entre ambientes (local ≠ staging ≠ prod).
- Proibir defaults tipo `changeme` em profile `prod`.

### 9.2 Proteção contra vazamento de dados

| Risco | Mitigação |
|-------|-----------|
| IDOR (acessar recurso de outro usuário) | Sempre filtrar por `userId`/`tenantId` do token |
| Mass assignment | DTO de entrada explícito; nunca bind direto na entidade |
| Oversharing | DTO de saída; nunca serializar `senha_hash` |
| Path traversal / open proxy no BFF | Allowlist de paths encaminhados |
| XSS | Escape default do React; CSP; não usar `dangerouslySetInnerHTML` sem sanitização |
| CSRF | SameSite + (recomendado) CSRF token em refresh/mutações sensíveis |
| Clickjacking | `X-Frame-Options` / CSP `frame-ancestors` |
| Enumeração de usuários no login | Mensagem genérica: “Credenciais inválidas” |
| Upload | Validar tipo/tamanho; storage fora do webroot |

### 9.3 Cookies (matriz)

| Ambiente | Secure | HttpOnly (token) | SameSite |
|----------|--------|------------------|----------|
| Local HTTP | false | true | Strict ou Lax |
| Produção HTTPS | **true** | true | Strict (ou Lax se fluxo exigir) |

### 9.4 CORS

- Produção: lista explícita de origins do front.
- Nunca `Allow-Origin: *` com `Allow-Credentials: true`.

### 9.5 Captcha / brute force

- Login: rate limit por IP + conta.
- Captcha opcional em local; recomendado em prod se houver abuso.

### 9.6 Dependências

- Lockfile commitado (`pnpm-lock` / `package-lock` / Gradle lock).
- Scans periódicos (npm audit / OWASP dependency check) no CI.

---

## 10. AGENTS.md do workspace (obrigatório para IAs)

Criar `AGENTS.md` na raiz com:

- Estrutura dos dois repos
- Branch padrão
- Onde commitar o quê
- Como subir Docker
- Proibições (secrets, git na raiz, misturar commits)
- Perfis e rotas (`/admin` vs `/app`)
- Contas seed **locais** apenas

Cursor: espelhar em `.cursor/rules/*.mdc` com `alwaysApply: true`.

---

## 11. Critérios de aceite do MVP estrutural

A IA só pode considerar “pronto” se **todos** os itens abaixo passarem:

### Funcional

- [ ] `docker compose up -d --build` sobe web+api+db
- [ ] Tela de login em `/`
- [ ] Login `admin@local.test` → `/admin/home`
- [ ] Login `user@local.test` → `/app/home`
- [ ] Admin **não** acessa conteúdo de `/app/*` (bloqueado)
- [ ] User **não** acessa conteúdo de `/admin/*` (bloqueado)
- [ ] Logout limpa sessão
- [ ] Refresh da página autenticada mantém sessão (cookie)

### Segurança

- [ ] Senha hashed (Argon2/bcrypt) — nunca plaintext
- [ ] JWT só em cookie HttpOnly
- [ ] Sem secrets commitados
- [ ] Endpoint `/api/admin/**` rejeita `APP_USER` com 403
- [ ] Endpoint `/api/app/**` rejeita `ADMIN` (ou política documentada)
- [ ] Tentativa de IDOR falha em teste automatizado básico
- [ ] Respostas de erro sem stacktrace em profile docker/prod

### Engenharia

- [ ] Migrations versionadas
- [ ] `.env.example` completo
- [ ] README de 5 minutos
- [ ] Dois repos (ou monorepo com fronteiras equivalentes + CI separado)
- [ ] Healthcheck da API

---

## 12. Seeds locais (somente Docker/dev)

Criar usuários de desenvolvimento via migration **label/context `local|docker|dev`**:

| Email | Role | Senha local sugerida |
|-------|------|----------------------|
| `admin@local.test` | ADMIN | `Admin@123` |
| `user@local.test` | APP_USER | `Admin@123` |

Regras:

- Documentar no README.
- **Proibir** esses usuários em produção (context Liquibase).
- Forçar troca de senha se um dia forem para ambiente compartilhado.

---

## 13. CI/CD mínimo

Por repositório:

**apps-web**
- lint → test → build

**apps-api**
- test → build → (opcional) security scan

Deploy:

- Build de imagem Docker por repo
- Variáveis injetadas no runtime
- Migrations no startup ou job de migrate controlado
- Sempre HTTPS no edge (ingress/load balancer)

---

## 14. O que NÃO fazer (anti-padrões)

1. Monolito front+back misturado sem fronteira clara de deploy/segurança.
2. JWT no `localStorage`.
3. Autorização só no frontend.
4. Um único usuário/role para tudo.
5. Banco sem migrations.
6. `docker compose` que só sobe a API e “torce” para o dev instalar o resto.
7. CORS `*` em produção.
8. Logs com Authorization header / senha.
9. Seed de produção com senha default.
10. Compartilhar schema/tenant sem filtro obrigatório no backend.
11. Hardcode de URL de API com secret no client bundle.
12. Volume Docker que apaga o build standalone do Next.

---

## 15. Prompt padrão para outra IA

### 15.1 Criar projeto

```text
Leia o arquivo SAAS-STRUCTURE-BLUEPRINT.md por completo.
Crie um SaaS novo seguindo 100% deste blueprint (fase 1).
Requisitos obrigatórios:
- apps-web (Next.js) + apps-api (Spring Boot 3 / Java 17)
- docker-compose na pasta pai
- Login em /
- Após login: ADMIN → /admin/home e APP_USER → /app/home
- Isolamento de rotas e endpoints
- Cookie HttpOnly + Argon2
- Seeds locais admin@local.test e user@local.test senha Admin@123
- README de 5 minutos + AGENTS.md
- Zero secrets commitados
Não implemente regras de negócio complexas; foque na estrutura, segurança e telas mínimas.
Ao final, rode a checklist da seção 11 e reporte o que passou/falhou.
```

### 15.2 Auditar projeto existente

```text
Leia SAAS-STRUCTURE-BLUEPRINT.md.
Audite o repositório atual contra cada seção.
Gere tabela: Item | Status (✅⚠️❌) | Evidência | Risco | Ação.
Feche com nota 0–100 e plano de adaptação em ordem de risco (Crítico → Alto → Médio).
Não altere código até eu pedir; só auditoria.
```

---

## 16. Roadmap após o MVP estrutural

Ordem sugerida (não pular segurança):

1. Esqueci senha + e-mail (MailHog local)
2. Gestão de usuários (admin)
3. Multi-tenant (se B2B)
4. Auditoria (login success/fail, ações sensíveis)
5. Fila/async (Kafka/Rabbit) só com caso real
6. Observabilidade (OpenTelemetry, métricas)
7. Feature flags / permissões finas (como “funcionalidades” do AvantPay)
8. Hardening prod (WAF, rate limit edge, backup DB, secrets manager)

---

## 17. Glossário rápido

| Termo | Significado |
|-------|-------------|
| BFF | Backend-for-Frontend — proxy Next que fala com a API |
| Role | Papel grosseiro (`ADMIN`, `APP_USER`) |
| Permissão/feature | Direito fino dentro do papel |
| Tenant | Cliente/organização isolada no SaaS B2B |
| Fail closed | Negar acesso se não houver prova suficiente |
| Seed | Dados iniciais só para ambiente local/dev |

---

## 18. Definição de “parrudo” neste blueprint

Um SaaS está no nível deste blueprint quando:

1. Sobe com Docker de forma reproduzível.
2. Tem fronteira clara web/api.
3. Tem auth sólida (cookie + hash moderno).
4. Tem **dois mundos de UI** isolados por role.
5. A API impõe o mesmo isolamento.
6. Banco versionado.
7. Documentação para humano e IA (`README` + `AGENTS`).
8. Não vaza dados entre perfis/tenants.
9. Está pronto para evoluir regras de negócio sem refatorar a espinha dorsal.

---

## 19. Checklist final (imprimir / colar no PR)

```
[ ] Estrutura de pastas e 2 repos
[ ] docker-compose sobe web+api+postgres(+mail)
[ ] Login funciona
[ ] Redirect por role (admin/app)
[ ] Bloqueio cruzado de áreas
[ ] /api/admin e /api/app protegidos
[ ] Senha hashed
[ ] JWT HttpOnly cookie
[ ] .env.example sem segredos reais
[ ] Migrations
[ ] Seeds só em dev/docker
[ ] README 5 minutos
[ ] AGENTS.md
[ ] Teste mínimo de isolamento
[ ] Sem secrets no Git
```

---

**Fim do blueprint.**  
Qualquer implementação que ignore as seções 4, 5.2, 6.2, 9 ou 11 está **fora de conformidade**.
