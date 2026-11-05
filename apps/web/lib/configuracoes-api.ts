/**
 * Cliente da tela de configuração do agente (`/api/admin/configuracoes`) e do
 * histórico de auditoria (`/api/admin/relatorios/auditoria`). Só SUPER_ADMIN.
 *
 * GET e PUT devolvem o MESMO shape — a rota diz isso explicitamente — então a
 * tela recarrega o estado inteiro da resposta do próprio PUT em vez de pedir de
 * novo. Um segundo GET depois de salvar é uma janela em que a tela mostra um
 * valor que o servidor já não tem.
 *
 * `apiKey` entra no mesmo patch das demais chaves, mas só isso: ela é escrita e
 * nunca lida. O que volta do servidor é `chaveMascarada` (quatro dígitos), e é
 * só isso que esta tela chega a conhecer.
 */

import { apiFetch } from './api-client';
import type { ConfigAgente, TomDeVoz } from './relatorios-ia/config';
import type { TipoRelatorio } from './relatorios-ia/catalogo';

export type { ConfigAgente, TipoRelatorio, TomDeVoz };

/** Item do catálogo como a rota o devolve — inclui a vitrine `disponivel: false`. */
export interface ItemCatalogoConfig {
  id: string;
  rotulo: string;
  descricao: string;
  disponivel: boolean;
}

export interface UsoMensal {
  mesReferencia: string;
  perguntas: number;
  custoEstimadoBrl: number;
  alertaCustoMensalBrl: number;
  percentual: number;
}

export interface ConfiguracoesResponse {
  config: ConfigAgente;
  catalogo: ItemCatalogoConfig[];
  uso: UsoMensal;
}

/** Patch parcial: campo ausente fica como está no banco. */
export interface PatchConfiguracoes {
  provedor?: string;
  modelo?: string;
  ativo?: boolean;
  tomDeVoz?: TomDeVoz;
  idioma?: string;
  proibicoes?: string[];
  rodapeObrigatorio?: string;
  limitePerguntasCredorDia?: number;
  alertaCustoMensalBrl?: number;
  catalogoHabilitado?: TipoRelatorio[];
  apiKey?: string;
}

export interface LinhaAuditoria {
  id: string;
  tenantId: string;
  credorId: string | null;
  usuarioId: string;
  perguntaTexto: string;
  tipoRelatorio: string | null;
  status: string;
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  /** `null` enquanto o preço do token não estiver definido — nunca zero. */
  custoEstimadoBrl: number | null;
  duracaoMs: number | null;
  criadoEm: string;
}

export function getConfiguracoes(): Promise<ConfiguracoesResponse> {
  return apiFetch<ConfiguracoesResponse>('/admin/configuracoes');
}

export function salvarConfiguracoes(patch: PatchConfiguracoes): Promise<ConfiguracoesResponse> {
  return apiFetch<ConfiguracoesResponse>('/admin/configuracoes', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function listarAuditoria(
  limite = 20,
  offset = 0,
): Promise<{ total: number; perguntas: LinhaAuditoria[] }> {
  const params = new URLSearchParams({ limite: String(limite), offset: String(offset) });
  return apiFetch<{ total: number; perguntas: LinhaAuditoria[] }>(
    `/admin/relatorios/auditoria?${params.toString()}`,
  );
}
