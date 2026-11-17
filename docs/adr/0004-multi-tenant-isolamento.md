# ADR-0004 — Estratégia multi-tenant e isolamento

Status: Aceito
Data: 2026-06-18

## Contexto
O produto é vendido a vários credores. O maior risco é **um tenant acessar dados de outro**, o que
seria crítico para LGPD e reputação. Precisamos equilibrar isolamento forte com custo e simplicidade
operacional na fase inicial.

## Decisão
Adotar **banco único, schema compartilhado, com `tenant_id` em todas as tabelas** e
**Row-Level Security (RLS)** no PostgreSQL como reforço no nível do banco. A aplicação injeta o
`tenant_id` (vindo do token) no contexto da conexão; o RLS impede acesso cruzado mesmo em caso de bug
na aplicação.

## Consequências
**Positivas**
- Custo eficiente e simples de operar no início.
- Isolamento em profundidade: aplicação **e** banco.
- Onboarding de novo tenant sem provisionar infraestrutura nova.

**Negativas**
- Exige disciplina: toda tabela com `tenant_id`, toda sessão com contexto setado, testes de isolamento.
- "Noisy neighbor": um tenant muito grande pode impactar outros (mitigável com índices, limites e,
  no futuro, particionamento ou banco dedicado para grandes contas).

## Alternativas consideradas
- **Schema por tenant:** isolamento maior, porém migrações e operação mais complexas com muitos tenants.
- **Banco por tenant:** isolamento máximo, custo e operação altos. Reservado para contas enterprise futuras.
