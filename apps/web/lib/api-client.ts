/**
 * Cliente HTTP base para Route Handlers do Next.js (`/api/admin/*`).
 *
 * - Sessão Supabase via cookies (middleware renova tokens).
 * - Erros retornam `{ title, status, errors? }`.
 */

/** Same-origin via rewrite do Next.js — cookies httpOnly funcionam no browser. */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

export interface ApiError {
  /** Mensagem amigável e pronta para exibir ao usuário. */
  title: string;
  status: number;
  /** Lista de mensagens (ex.: erros de validação campo a campo). */
  errors?: string[];
  /** Identificador para correlacionar com os logs do servidor. */
  traceId?: string;
  /**
   * Código estável do erro, quando a rota o informa (ex.: `LIMITE_DIARIO_EXCEDIDO`).
   * A tela decide o que oferecer a partir dele; `title` continua sendo o texto lido.
   */
  codigo?: string;
  /**
   * Mesma ideia de `errors`, no nome que as rotas do agente de relatórios usam.
   * Sem este campo o motivo da recusa de um plano morria no servidor e a tela
   * só dizia "não consegui", que não ajuda ninguém a reformular a pergunta.
   */
  detalhes?: string[];
}

/** Garante que qualquer valor capturado vire um ApiError com mensagem legível. */
export function toApiError(err: unknown): ApiError {
  if (err && typeof err === 'object' && 'title' in err) {
    return err as ApiError;
  }
  return { title: 'Não foi possível concluir. Tente novamente.', status: 0 };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      credentials: 'include',
    });
  } catch {
    // Falha de rede / servidor offline (não chegou a ter resposta HTTP).
    throw {
      title: 'Não foi possível conectar ao servidor. Verifique sua conexão.',
      status: 0,
    } satisfies ApiError;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiError> | null;
    throw {
      title: body?.title ?? mensagemPorStatus(response.status),
      status: response.status,
      errors: body?.errors,
      traceId: body?.traceId,
      codigo: body?.codigo,
      detalhes: body?.detalhes,
    } satisfies ApiError;
  }

  // Respostas sem corpo (ex.: 204) não devem quebrar o parser.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json().catch(() => undefined)) as T;
}

function mensagemPorStatus(status: number): string {
  if (status === 401) return 'Sessão expirada ou credenciais inválidas.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status === 404) return 'Recurso não encontrado.';
  if (status === 429) return 'Muitas tentativas. Aguarde um momento e tente novamente.';
  if (status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
  return 'Não foi possível concluir a solicitação.';
}
