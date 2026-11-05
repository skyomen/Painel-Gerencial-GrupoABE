/**
 * Cliente da tela de relatórios do credor (`/api/relatorios/perguntar`).
 *
 * Os tipos vêm por `import type` da própria biblioteca do agente, não de uma
 * cópia escrita à mão: contrato copiado é contrato que envelhece em silêncio,
 * e quem descobre a divergência é o credor olhando um número. `import type`
 * some na compilação, então nada do executor (Supabase, cálculo) entra no
 * bundle do navegador.
 *
 * `credorId` existe porque a rota aceita a prévia do SUPER_ADMIN, igual a
 * `/api/dashboard`. Quem autoriza é o servidor; aqui ele é só repassado.
 */

import { apiFetch } from './api-client';
import type { TipoRelatorio } from './relatorios-ia/catalogo';
import type { PlanoDeConsulta, SistemaOrigem } from './relatorios-ia/plano';
import type { RespostaRelatorio } from './relatorios-ia/resposta';

export type { PlanoDeConsulta, RespostaRelatorio, SistemaOrigem, TipoRelatorio };

/** Limite que a rota aplica no texto da pergunta — repetido para o contador da tela. */
export const MAX_CARACTERES_PERGUNTA = 500;

/** O que a tela sabe sobre "onde o usuário está olhando". Nunca um comando. */
export interface ContextoPergunta {
  periodo?: { inicio?: string; fim?: string };
  sistemaOrigem?: SistemaOrigem;
  uf?: string | null;
}

export interface RespostaPergunta {
  auditoriaId: string | null;
  pergunta: string;
  plano: PlanoDeConsulta;
  resposta: RespostaRelatorio;
}

export interface PerguntaRecente {
  id: string;
  perguntaTexto: string;
  usuarioNome: string | null;
  criadoEm: string;
  tipoRelatorio: string | null;
  status: 'OK' | 'ERRO' | 'REJEITADO' | string;
}

/** Menor e maior `competencia` que o credor realmente tem nas tabelas de métricas mensais. */
export interface IntervaloDisponivel {
  inicio: string | null;
  fim: string | null;
}

export function perguntarRelatorio(args: {
  pergunta: string;
  contexto?: ContextoPergunta;
  credorId?: string | null;
}): Promise<RespostaPergunta> {
  const body: Record<string, unknown> = { pergunta: args.pergunta };
  if (args.contexto) body.contexto = args.contexto;
  if (args.credorId) body.credorId = args.credorId;

  return apiFetch<RespostaPergunta>('/relatorios/perguntar', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listarPerguntasRecentes(
  credorId?: string | null,
  limite = 10,
): Promise<{ perguntas: PerguntaRecente[]; intervaloDisponivel: IntervaloDisponivel }> {
  const params = new URLSearchParams({ limite: String(limite) });
  if (credorId) params.set('credorId', credorId);

  return apiFetch<{ perguntas: PerguntaRecente[]; intervaloDisponivel: IntervaloDisponivel }>(
    `/relatorios/perguntar?${params.toString()}`,
  );
}
