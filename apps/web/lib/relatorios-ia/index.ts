/**
 * Construtor de Relatórios com IA — ponto de entrada da biblioteca.
 *
 * A rota chama `responderPergunta` e mais nada. A ordem abaixo é o desenho da
 * DEC-0069 em código, e não é negociável:
 *
 *   pedirPlano → validarPlano → (inválido ⇒ PARA AQUI) → executarPlano → texto
 *
 * O "para aqui" é o item que importa. Entre o modelo e o banco existe um
 * portão, e plano reprovado não chega a encostar em `supabase`: nenhuma query,
 * nenhuma RPC, nenhum byte lido. O escopo (`tenant`/`credor`) entra só no passo
 * de execução, vindo do servidor — nunca do plano.
 */

export {
  CATALOGO,
  TIPOS_RELATORIO,
  ehTipoRelatorio,
  type ItemCatalogo,
  type TipoRelatorio,
} from './catalogo';

export {
  ESQUEMA_PLANO_JSON,
  JANELA_MAXIMA_MESES,
  SISTEMAS_ORIGEM,
  validarPlano,
  type PlanoDeConsulta,
  type ResultadoValidacao,
  type SistemaOrigem,
} from './plano';

export {
  CONFIG_PADRAO,
  mapearConfig,
  mascararChave,
  validarEntradaConfig,
  type ConfigAgente,
  type LinhaConfigAgente,
  type ResultadoEntradaConfig,
  type TomDeVoz,
} from './config';

export {
  ErroProvedorPlano,
  criarClienteOpenAI,
  montarPromptPlano,
  pedirPlano,
  type ClientePlano,
  type ContextoPergunta,
  type SaidaPlanoBruto,
} from './planner';

export {
  executarPlano,
  type CardResposta,
  type ConsultaSupabase,
  type CredorParaExecucao,
  type DadosRelatorio,
  type ErroSupabase,
  type EscopoExecucao,
  type PontoSerie,
  type SupabaseLike,
  type TabelaResposta,
} from './executor';

export {
  montarTextoResposta,
  montarTransparencia,
  respostaContemValorFinanceiro,
  type RespostaRelatorio,
  type Transparencia,
} from './resposta';

import { validarPlano, type PlanoDeConsulta } from './plano';
import { pedirPlano, type ClientePlano, type ContextoPergunta } from './planner';
import {
  executarPlano,
  type CredorParaExecucao,
  type EscopoExecucao,
  type SupabaseLike,
} from './executor';
import { montarTextoResposta, montarTransparencia, type RespostaRelatorio } from './resposta';
import type { ConfigAgente } from './config';

export type ResultadoPergunta =
  | {
      ok: true;
      resposta: RespostaRelatorio;
      plano: PlanoDeConsulta;
      tokensEntrada: number;
      tokensSaida: number;
    }
  | {
      ok: false;
      codigo: 'PLANO_INVALIDO';
      motivo: string;
      detalhes: string[];
      planoBruto: unknown;
    };

export async function responderPergunta(args: {
  contexto: ContextoPergunta;
  config: ConfigAgente;
  cliente: ClientePlano;
  /** Resolvido pelo servidor. Nunca lido do plano. */
  escopo: EscopoExecucao;
  /** Client RLS do usuário. Nunca service role. */
  supabase: SupabaseLike;
  credor: CredorParaExecucao;
}): Promise<ResultadoPergunta> {
  const { contexto, config, cliente, escopo, supabase, credor } = args;

  const { planoBruto, tokensEntrada, tokensSaida } = await pedirPlano(contexto, config, cliente);

  const validacao = validarPlano(planoBruto, { catalogoHabilitado: config.catalogoHabilitado });

  // Portão. Daqui para trás nada tocou o banco, e com plano reprovado nada vai
  // tocar: devolvemos o bruto para a auditoria registrar o que foi recusado.
  if (!validacao.ok) {
    return {
      ok: false,
      codigo: 'PLANO_INVALIDO',
      motivo: validacao.motivo,
      detalhes: validacao.detalhes,
      planoBruto,
    };
  }

  const plano = validacao.plano;
  const dados = await executarPlano({ plano, escopo, supabase, credor });

  return {
    ok: true,
    plano,
    tokensEntrada,
    tokensSaida,
    resposta: {
      textoResposta: montarTextoResposta({ plano, dados, config, escopo }),
      cards: dados.cards,
      tabela: dados.tabela,
      serieGrafico: dados.serieGrafico,
      transparencia: montarTransparencia(plano, escopo),
      plano,
    },
  };
}
