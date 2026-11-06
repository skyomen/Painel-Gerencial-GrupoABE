/**
 * Dado real — todo o histórico de commits do repositório (git log completo,
 * 15 commits em 2026-11-05) + os itens em andamento/fila. Idêntico ao que
 * estava em `apps/web/public/cronograma.html` (removido — esta página o
 * substitui) e ao protótipo aprovado `docs/prototipos/cronograma-redesign.html`.
 *
 * `descricao` é o resumo do card; `escopo` é o texto completo do modal (o que
 * é a tarefa e como foi/será executada) — mantido à mão a cada atualização.
 * Commits de estabilização do mesmo dia (formatação, build da Vercel, CSP)
 * ficam agrupados num item só para o cronograma não virar ruído — nenhum
 * commit fica de fora, só agrupado.
 */

export type CronogramaStatus = 'FILA' | 'EM_EXECUCAO' | 'CONCLUIDO' | 'RECUSADO';

export interface CronogramaItem {
  titulo: string;
  descricao: string;
  escopo: string;
  status: CronogramaStatus;
  prioridade?: number;
  evidenciaCommit?: string;
  atualizadoEm: string;
  motivoRecusa?: string;
}

export const CRONOGRAMA_ITENS: CronogramaItem[] = [
  {
    titulo: 'Estrutura inicial do monorepo',
    descricao: 'Primeira versão: admin, cadastro de credores e dashboard do cliente.',
    escopo:
      'Primeiro commit do projeto: monorepo pnpm com API NestJS (Prisma/PostgreSQL), frontend Next.js, painel admin, dashboard do credor, autenticação JWT própria e CI no GitHub Actions.\n' +
      'Essa arquitetura (NestJS + Prisma + JWT) foi substituída pouco depois pela migração para Supabase — fica registrada aqui como o ponto de partida real do projeto, não como o que está em produção hoje.',
    status: 'CONCLUIDO',
    evidenciaCommit: 'f22b8a9',
    atualizadoEm: '2026-06-24',
  },
  {
    titulo: 'Migração da stack para Supabase',
    descricao:
      'Saída do backend NestJS legado — Auth, Postgres e RLS do Supabase viraram a base de tudo (ADR-0001, ADR-0003).',
    escopo:
      'Troca completa da camada de dados e autenticação: NestJS + Prisma + JWT próprio saem; entram Supabase Auth, Postgres com Row Level Security e Route Handlers do Next.js fazendo o papel do backend administrativo.\n' +
      '`apps/api` e toda a infraestrutura NestJS foram removidos; `supabase/` passou a concentrar migrations e seed. Decisão registrada em ADR-0001 (stack tecnológico) e ADR-0003 (identidade e autenticação).',
    status: 'CONCLUIDO',
    evidenciaCommit: '8f42e68',
    atualizadoEm: '2026-06-24',
  },
  {
    titulo: 'Estabilização do primeiro deploy na Vercel',
    descricao:
      'Build quebrando, CSP bloqueando o login, tela em branco em produção — 4 correções no mesmo dia até o deploy ficar estável.',
    escopo:
      'Quatro correções no primeiro dia de produção, uma atrás da outra:\n' +
      '— Formatação Prettier e ajustes de CI em todo o monorepo.\n' +
      '— Tipo `fotoUrl` faltando no mapeamento de credor, quebrando o build (erro TS2339).\n' +
      '— Build `standalone` do Docker vazando para o deploy da Vercel — corrigido com `vercel.json` próprio para monorepo e documentação de variáveis de ambiente.\n' +
      '— Content-Security-Policy bloqueando a tela de login, deixando a página em branco em produção.',
    status: 'CONCLUIDO',
    evidenciaCommit: '024e679',
    atualizadoEm: '2026-06-24',
  },
  {
    titulo: 'Grupo de códigos no admin, dashboard ABE WEB e hardening de segurança',
    descricao:
      'Credor passa a ter vários códigos de cliente agrupados; dashboard ganha a origem ABE WEB; reforço de segurança geral.',
    escopo:
      'Edição de credor refeita com navegador por código (seções de cadastro, comercial e setor), cada seção salva de forma independente com feedback visual próprio — antes era um formulário único que salvava tudo junto.\n' +
      'Dashboard ganha métricas vindas da origem ABE WEB, além do legado Delphi. Validação server-side e proteção de rotas reforçadas no middleware; scripts de sincronização (ETL) do sistema legado adicionados.',
    status: 'CONCLUIDO',
    evidenciaCommit: '87e5a78',
    atualizadoEm: '2026-06-26',
  },
  {
    titulo: 'Regra única de cálculo e visão consolidada da diretoria',
    descricao:
      'Uma função só de cálculo para todo o sistema (fim da divergência entre dashboard e diretoria) e o painel consolidado de todos os credores.',
    escopo:
      'A mesma classificação (em cobrança, pagamento direto, faixas de idade) estava escrita em cinco arquivos, em três linguagens — e duas delas discordavam entre si: o TypeScript somava todos os repasses do período, a RPC do banco só os de processos incluídos no mesmo período.\n' +
      'A view `carteira_classificada` (migration 012) virou a ÚNICA fonte da regra de negócio; todo o resto apenas soma, filtrando pelas colunas que a view já classifica. Fundação que permitiu escalar de "um credor" para o consolidado da diretoria sem duplicar lógica.',
    status: 'CONCLUIDO',
    evidenciaCommit: 'f9ad4f5',
    atualizadoEm: '2026-09-09',
  },
  {
    titulo: 'Botão de atualizar com recálculo de todos os credores',
    descricao:
      'Uma chamada só reprocessa os agregados de todos os credores, em vez de um de cada vez.',
    escopo:
      'Duas ações separadas, de propósito, para não confundir "rápido" com "atualizado de verdade":\n' +
      '— "Recalcular indicadores": segundos, refaz os agregados a partir do que já está sincronizado — é o botão principal.\n' +
      '— "Sincronizar com ABE WEB e Delphi": minutos, alcança um SQL Server on-premises — fica no menu, com o custo de tempo avisado. Não cabe numa função serverless com timeout de segundos.',
    status: 'CONCLUIDO',
    evidenciaCommit: '50aa87a',
    atualizadoEm: '2026-09-09',
  },
  {
    titulo: 'Filtro de credor com seleção múltipla na diretoria',
    descricao: 'A diretoria passa a filtrar vários credores ao mesmo tempo, não só um por vez.',
    escopo:
      'O filtro da diretoria passa a aceitar um, vários ou todos os credores de uma vez.\n' +
      'Não usa `<select multiple>` nativo — exige Ctrl+clique, perde a seleção inteira num clique desatento, e não comporta busca com dezenas de credores. Componente próprio com checkbox real dentro de um painel com busca. Lista vazia volta ao consolidado (todos), em vez de zerar a tela.',
    status: 'CONCLUIDO',
    evidenciaCommit: '89d220f',
    atualizadoEm: '2026-09-09',
  },
  {
    titulo: 'Ajuste de CI: .env efêmero no cron de sincronização ABE WEB',
    descricao:
      'O workflow de sync passa a gerar suas próprias variáveis de ambiente antes de rodar, sem depender de segredo fixo no runner.',
    escopo:
      'O cron diário de sincronização com ABE WEB falhava todo dia com "node: .env: not found" (exit code 9) — o workflow injetava os segredos como env vars do passo, mas `node --env-file=.env` exige um arquivo físico no disco.\n' +
      'Corrigido gravando um `.env` efêmero a partir das env vars já presentes no início do passo, e apagando em seguida.',
    status: 'CONCLUIDO',
    evidenciaCommit: '9fce3f7',
    atualizadoEm: '2026-11-04',
  },
  {
    titulo: 'Protótipo do Construtor de Relatórios com IA validado e congelado',
    descricao:
      'Protótipo com dado sintético aprovado pelo usuário e congelado como especificação antes do código — método do projeto.',
    escopo:
      'Protótipo HTML com dado sintético (`docs/prototipos/relatorios-com-ia.html`) validado pelo usuário e congelado como especificação ANTES de qualquer linha de código real — é o método deste projeto para telas novas, não um passo opcional.\n' +
      'Serviu de contrato para o backend e o frontend construídos em seguida; divergências em relação a ele (quando houve) ficaram documentadas como pendência, não como decisão silenciosa.',
    status: 'CONCLUIDO',
    evidenciaCommit: '275fe4a',
    atualizadoEm: '2026-11-04',
  },
  {
    titulo: 'Backend do Construtor de Relatórios com IA',
    descricao:
      'Config global, chave da OpenAI no Supabase Vault, cota diária e auditoria de toda pergunta.',
    escopo:
      'Pipeline de execução, na ordem da DEC-0069: `pedirPlano → validarPlano → (reprovado, PARA AQUI) → executarPlano`. A IA escolhe só o tipo de relatório e os filtros de período/UF/sistema — nunca vê nome de credor, nunca monta SQL, nunca decide de quem é o dado.\n' +
      'Config global do agente (modelo, tom de voz, catálogo habilitado) numa linha só; chave da OpenAI gravada no Supabase Vault via RPC, nunca em coluna de texto; cota diária de perguntas por credor; auditoria de toda pergunta, aprovada ou recusada. Migration 017.',
    status: 'CONCLUIDO',
    evidenciaCommit: '5bf5d3c',
    atualizadoEm: '2026-11-04',
  },
  {
    titulo: 'Frontend do Construtor de Relatórios com IA',
    descricao:
      'Credor pergunta em português sobre a própria carteira; a IA monta o plano, a rota valida e devolve cards, gráfico e tabela com os mesmos cálculos do dashboard.',
    escopo:
      'Tela `/dashboard/relatorios`: o credor pergunta em português e recebe cards, gráfico e tabela — os MESMOS cálculos do dashboard normal, nunca uma segunda implementação da mesma conta.\n' +
      'Tela `/admin/configuracoes` para o super admin trocar a chave da OpenAI, ligar/desligar o agente, ver auditoria e custo do mês. Duas divergências deliberadas do protótipo (sem filtro de filial — o credor é resolvido pelo servidor; sem selo "novo" no menu) ficaram registradas como pendência para o usuário decidir, não implementadas por conta própria.',
    status: 'CONCLUIDO',
    evidenciaCommit: '30ba856',
    atualizadoEm: '2026-11-05',
  },
  {
    titulo: 'Correção: prévia de SUPER_ADMIN perdia o cliente no menu',
    descricao:
      'O menu lateral descartava o credorId da prévia ao navegar para Relatórios, devolvendo "Credor não encontrado".',
    escopo:
      'O menu lateral (`NavCredor`, compartilhado por `/dashboard` e `/dashboard/relatorios`) montava os links do menu com o caminho cru, sem propagar o `?credorId=` da prévia de SUPER_ADMIN.\n' +
      'Ao clicar em "Relatórios" a partir da prévia de um cliente, o parâmetro se perdia, a rota passava a resolver o escopo pelo tenant do próprio admin (que não é credor) e devolvia 404 "Credor não encontrado". Corrigido com uma função `comCredorId()` usada nos três lugares que montam esse link (menu, logo, "voltar ao painel").',
    status: 'CONCLUIDO',
    evidenciaCommit: '1fa4958',
    atualizadoEm: '2026-11-05',
  },
  {
    titulo: 'Datas da tela de relatórios = mínimo/máximo real da base',
    descricao:
      'Início/fim já vêm preenchidos com o intervalo de dados que o credor realmente tem, e o filtro de sistema de origem saiu da tela.',
    escopo:
      'Busca o menor e maior `competencia` que o credor tem nas 4 tabelas de métricas mensais (bordero, repasse, classe, faixa) e usa como valor inicial dos campos de data, em vez do default genérico de "mês atual + 5 anteriores".\n' +
      'Filtro de sistema de origem removido da tela (a API mantém o campo, default TODOS). Implementado e verificado (typecheck, lint, 127 testes) nesta sessão.',
    status: 'EM_EXECUCAO',
    prioridade: 1,
    atualizadoEm: '2026-11-05',
  },
  {
    titulo: 'Cronograma de desenvolvimento (esta página)',
    descricao:
      'Página estática no próprio projeto, com visão geral, quadro, linha do tempo e lista — editada diretamente, sem passar por publicação externa.',
    escopo:
      'Começou como Claude Artifact (link único, banco compartilhado, sem necessidade de login) e foi migrada para arquivo estático do próprio projeto por pedido do usuário — iteração mais rápida, sem publish/round-trip externo a cada ajuste.\n' +
      'Dado mantido à mão no array `ITENS` deste arquivo, a partir do `git log` real do repositório — cada entrega nova exige uma edição manual aqui.',
    status: 'EM_EXECUCAO',
    prioridade: 2,
    atualizadoEm: '2026-11-05',
  },
  {
    titulo: 'Quadro de relatórios arrastável (BI self-service)',
    descricao:
      'Credor monta o próprio painel arrastando widgets (cartão, gráfico, tabela) sobre o Construtor de Relatórios já existente.',
    escopo:
      'Proposta registrada em `vault/PROPOSTA-quadro-de-relatorios-arrastavel.md`: credor monta o próprio painel arrastando widgets (cartão, barra, pizza, tabela) sobre o Construtor de Relatórios já existente, com a IA pré-preenchendo um widget por pergunta em vez de uma resposta fechada.\n' +
      'MVP recomendado: 3 tipos de widget, grid só com reordenar (sem resize livre), um widget por pergunta. Ainda sem protótipo nem decisão de arquitetura de persistência — não iniciado.',
    status: 'FILA',
    prioridade: 3,
    atualizadoEm: '2026-11-05',
  },
];
