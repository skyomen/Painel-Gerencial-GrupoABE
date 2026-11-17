# 06 — Segurança e LGPD

> Este é o documento mais importante da Fase 0. O sistema será **acessado pela internet por terceiros
> (credores)** e lida com **dados pessoais e financeiros de devedores**. Segurança e LGPD são
> requisitos de produto, não "extras".

## 6.1 Modelo de ameaças (resumo STRIDE)

| Ameaça | Exemplo no nosso contexto | Mitigação principal |
|--------|---------------------------|---------------------|
| **Spoofing** | Alguém se passa por um credor | Supabase Auth, sessão SSR, tokens gerenciados |
| **Tampering** | Alterar dados em trânsito/repouso | TLS, RLS, auditoria |
| **Repudiation** | Negar que executou uma transferência | Audit log imutável (quem/quando/IP) |
| **Information Disclosure** | Vazar CPF/dívida de um devedor | RLS, mascaramento, isolamento de tenant |
| **Denial of Service** | Derrubar o portal | Rate limit Vercel/Supabase, degradação graciosa |
| **Elevation of Privilege** | Operador virar admin / ver outro tenant | RBAC + RLS, negar por padrão |

## 6.2 Isolamento de tenant (multicamada)

O maior risco de um SaaS multiempresa é **um credor ver dados de outro**. Defesa em profundidade:

1. **No perfil:** `tenant_id` vem de `public.usuarios`, vinculado ao usuário autenticado.
2. **Na aplicação:** Route Handlers e queries filtram por tenant; admin usa service role com validação explícita.
3. **No banco (RLS):** **Row-Level Security** no PostgreSQL garante que, mesmo com bug na aplicação, uma sessão anon só enxergue linhas do seu tenant.

Exemplo de política RLS (implementado em `001_initial_schema.sql`):

```sql
ALTER TABLE public.credores ENABLE ROW LEVEL SECURITY;

CREATE POLICY credores_tenant_read ON public.credores
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());
```

Políticas para `SUPER_ADMIN` usam função `is_super_admin()` com `SECURITY DEFINER`.

### Exceções ao modelo de tenant

Três tabelas fogem do padrão "`tenant_id` + RLS por credor":

| Tabela | Tenant? | Leitura | Escrita |
|--------|---------|---------|---------|
| `agente_relatorios_config` | Não | Só `SUPER_ADMIN` (policy `agente_relatorios_config_super_admin_all`) — sem `anon`/`authenticated` | Só `SUPER_ADMIN` / `service_role` |
| `agente_relatorios_perguntas` | Sim (`tenant_id`) | Tenant-scoped (policy `agente_relatorios_perguntas_tenant_read`) + `SUPER_ADMIN` | Só `service_role`, dentro da rota, depois do guard de autenticação — sem `INSERT`/`UPDATE`/`DELETE` para `anon`/`authenticated` |
| `cronograma_itens` | Não | Pública (policy `cronograma_itens_public_read`, `USING (true)`) — página `/cronograma` sem login | Pública, mas só via duas funções `SECURITY DEFINER` — sem `INSERT`/`UPDATE`/`DELETE` direto para `anon`/`authenticated` (DEC-0077) |

- **`agente_relatorios_config`** — linha única de configuração do agente de relatórios com IA (provedor, modelo, tom de voz, proibições, cota diária e o ponteiro `api_key_secret_id` da chave no Supabase Vault). Nunca teve `tenant_id`: é política da casa, não do credor. A migration revoga explicitamente `anon` e `authenticated`, mesmo sem GRANT anterior sobre esta tabela.
- **`agente_relatorios_perguntas`** — auditoria de toda pergunta feita ao agente (aprovada ou recusada). Leitura por tenant; a gravação é só pelo `service_role`, chamado pela rota `/api/relatorios/perguntar` depois de autenticar o usuário — nunca pelo navegador, para não permitir forjar o rastro de auditoria.
- **`cronograma_itens`** — pública de propósito (DEC-0077): a página `/cronograma` não exige login, e o usuário decidiu que adicionar item à fila e reordená-la também ficam sem login nem senha, mesmo nível de acesso da leitura. A defesa não é esconder a ação, é estreitar o que ela pode fazer: ninguém escreve na tabela direto, nem `authenticated` — a única escrita pública passa por duas funções `SECURITY DEFINER` com validação estrita, `public.cronograma_adicionar_item_fila` (sempre insere com `status = 'FILA'`, sempre no fim da fila, nunca aceita `status` ou `id`) e `public.cronograma_reordenar_fila` (só aceita o conjunto exato de ids hoje em `FILA` — não remove item, não traz item de fora, não toca item fora da fila). Ambas revogam `PUBLIC`, `anon` e `authenticated` e depois concedem `EXECUTE` só a `anon`/`authenticated`, nunca ao `INSERT`/`UPDATE`/`DELETE` direto da tabela.

As duas funções que tocam o Supabase Vault (`public.agente_relatorios_definir_chave`, `public.agente_relatorios_obter_chave`) seguem o mesmo padrão de fechamento: `SECURITY DEFINER` com `REVOKE ALL FROM PUBLIC, anon, authenticated` e `GRANT EXECUTE` só para `service_role` — a chave do provedor de IA nunca é alcançável por uma sessão `anon`/`authenticated`, nem por uma chamada de RPC do PostgREST.

## 6.3 Autenticação

- **Provedor:** [Supabase Auth](https://supabase.com/docs/guides/auth) — decisão em [ADR-0003](adr/0003-identidade-autenticacao.md).
- **Implementação:** `@supabase/ssr` em `apps/web/lib/supabase/` + `lib/auth.ts`.
- **Credenciais:** armazenadas em `auth.users` — **não há `senha_hash` em `public.usuarios`**.
- **Sessão:** cookies gerenciados pelo middleware SSR; refresh automático.
- **MFA:** suportado pelo Supabase Auth — habilitar para admins em produção (recomendado).
- **Logout:** `supabase.auth.signOut()` invalida sessão.

## 6.4 Autorização (RBAC + escopo de tenant)

- Papéis: `SUPER_ADMIN`, `ADMIN_CREDOR`, `OPERADOR`, `VIEWER`.
- **Negar por padrão**: sem permissão explícita = 403.
- Route Handlers admin exigem `SUPER_ADMIN` via `requireSuperAdmin()`.
- Credores acessam apenas dados do próprio tenant (RLS + perfil).

## 6.5 Chaves e segredos

| Chave | Uso | Onde |
|-------|-----|------|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente browser + queries com RLS | Browser, server |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS — **somente operações admin validadas** | Servidor apenas |
| Segredos de integração (futuro) | APIs das fontes | Vercel env / Supabase Vault |

Regras:

- **Nunca** expor `SUPABASE_SERVICE_ROLE_KEY` no browser ou em variáveis `NEXT_PUBLIC_*`.
- **Nunca** commitar segredos — scan na CI (gitleaks).
- Rotacionar service role key se houver suspeita de vazamento.

## 6.6 Criptografia

| Onde | Como |
|------|------|
| **Em trânsito** | TLS 1.2+ (Vercel + Supabase) |
| **Em repouso** | Criptografia gerenciada pelo Supabase (PostgreSQL) |
| **Campos sensíveis** | CPF/CNPJ criptografado em coluna + hash para busca (futuro) |
| **Senhas** | Gerenciadas pelo Supabase Auth (bcrypt) — não armazenamos localmente |

## 6.7 OWASP Top 10 — mitigações

| Risco OWASP | Mitigação no projeto |
|-------------|----------------------|
| **A01 Broken Access Control** | RBAC + RLS + `requireSuperAdmin` |
| **A02 Cryptographic Failures** | TLS, Supabase encryption at rest, sem dados sensíveis em log |
| **A03 Injection** | Queries parametrizadas (Supabase client); validação de entrada |
| **A04 Insecure Design** | Threat modeling; RLS by default |
| **A05 Security Misconfiguration** | Env vars na Vercel; headers CSP no Next.js |
| **A06 Vulnerable Components** | SCA na CI; dependabot |
| **A07 Auth Failures** | Supabase Auth; sessão SSR; MFA recomendado |
| **A08 Software & Data Integrity** | Assinatura de webhooks (futuro); CI confiável |
| **A09 Logging & Monitoring Failures** | Logs Vercel + Supabase; auditoria (futuro) |
| **A10 SSRF** | Allow-list de destinos das integrações |

## 6.8 Proteções de borda (web)

- **Vercel:** HTTPS automático, proteção DDoS básica, rate limiting configurável.
- **Next.js:** Content-Security-Policy em `next.config.mjs`.
- **Headers:** HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- **CORS:** Route Handlers same-origin (`/api`) — sem CORS cross-origin desnecessário.
- **Validação de entrada** estrita; output encoding contra XSS.

## 6.9 Service role — uso seguro

A chave **service role** bypassa RLS. Regras:

1. Usar **apenas** em Route Handlers server-side (`app/api/admin/*`).
2. **Sempre** validar sessão e papel antes de qualquer operação.
3. **Nunca** importar cliente admin em componentes client-side.
4. Preferir cliente **anon** + RLS para leituras de credores quando possível.

## 6.10 Auditoria (trilha imutável — futuro)

Toda ação sensível deve gerar registro em `audit_log`:

- Quem (usuário + tenant), o quê, quando, IP, antes/depois.
- Foco: login/logout, transferir/pausar, revelar documento, mudanças de permissão.
- Retenção conforme jurídico (≥ 5 anos).

## 6.11 LGPD (Lei 13.709/2018)

### Papéis LGPD

- **Controlador:** o credor (e/ou Grupo ABE, conforme contrato).
- **Operador:** a plataforma (MK Solutions), que trata dados em nome do controlador.

### Medidas práticas

- **Mascaramento** de CPF/CNPJ na UI por padrão.
- **Minimização:** replicar apenas o necessário para exibir.
- **Anonimização/eliminação** no offboarding do credor.
- **Plano de resposta a incidentes** com notificação à ANPD quando aplicável.

## 6.12 DevSecOps

| Etapa | Controle |
|-------|----------|
| Pre-commit | Lint, format, scan de segredos |
| Pull Request | Code review, checks verdes |
| CI | SAST, SCA, testes, build |
| Runtime | Logs Vercel + Supabase Dashboard |

## 6.13 Checklist mínimo antes do go-live

- [ ] RLS ativo e testado em todas as tabelas com `tenant_id`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configurada só no servidor (Vercel).
- [ ] MFA habilitado para admins (Supabase Auth).
- [ ] Headers de segurança ativos (CSP, HSTS).
- [ ] CPF/CNPJ mascarado na UI.
- [ ] Scan de segredos e SCA passando na CI.
- [ ] Teste: credor A não vê dados do credor B.
- [ ] Política de privacidade e RoPA publicados.
