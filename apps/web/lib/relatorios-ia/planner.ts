/**
 * A única parte do sistema que fala com o provedor de IA.
 *
 * O que sai daqui para fora da casa: a pergunta do usuário, a data de hoje, os
 * filtros que ele já tinha na tela e a descrição do catálogo. O que NÃO sai:
 * nome do credor, `tenant_id`, `credor_id`, número, linha de carteira — nada.
 * O modelo escolhe um tipo de relatório e um recorte, e só.
 *
 * O que entra: um JSON que ainda não vale nada até passar por `validarPlano`.
 *
 * `ClientePlano` é interface para o teste injetar dublê. Nenhum teste deste
 * módulo abre rede.
 */

import { ESQUEMA_PLANO_JSON, SISTEMAS_ORIGEM, type SistemaOrigem } from './plano';
import { CATALOGO, type TipoRelatorio } from './catalogo';
import type { ConfigAgente } from './config';

export interface ContextoPergunta {
  pergunta: string;
  periodoAtual: { inicio: string; fim: string };
  sistemaOrigemAtual: SistemaOrigem;
  ufAtual: string | null;
  /** 'YYYY-MM-DD' — vem do servidor; o modelo não tem relógio confiável. */
  hoje: string;
}

export interface SaidaPlanoBruto {
  planoBruto: unknown;
  tokensEntrada: number;
  tokensSaida: number;
}

export interface ClientePlano {
  gerarPlano(prompt: {
    sistema: string;
    usuario: string;
    modelo: string;
    esquema: Record<string, unknown>;
  }): Promise<SaidaPlanoBruto>;
}

/** Erro de comunicação/forma com o provedor. Erro de CONTEÚDO é do validador. */
export class ErroProvedorPlano extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroProvedorPlano';
  }
}

/**
 * Adapter OpenAI, API `responses` (SDK openai 7.50.0).
 *
 * Confirmado no `node_modules/openai` desta instalação, não assumido:
 * `client.responses.create` recebe a saída estruturada em
 * `text.format = { type:'json_schema', name, schema, strict }` — PLANO, sem o
 * envelope `json_schema: {...}` do Chat Completions. O texto volta em
 * `response.output_text` e os tokens em `usage.input_tokens` /
 * `usage.output_tokens`.
 *
 * Sem `temperature`: os modelos de raciocínio da linha gpt-5 recusam o
 * parâmetro, e um plano estruturado não tem o que ganhar com sorteio.
 *
 * `store: false`: a pergunta do credor não fica hospedada no provedor.
 *
 * O import é dinâmico de propósito — assim o pacote só é carregado quando
 * alguém de fato vai chamar o provedor, e o barril (`index.ts`) continua
 * importável num teste sem rede e sem SDK aquecido.
 */
export function criarClienteOpenAI(apiKey: string): ClientePlano {
  return {
    async gerarPlano({ sistema, usuario, modelo, esquema }) {
      const { default: OpenAI } = await import('openai');
      const cliente = new OpenAI({ apiKey });

      const resposta = await cliente.responses.create({
        model: modelo,
        instructions: sistema,
        input: usuario,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'plano_de_consulta',
            strict: true,
            schema: esquema,
          },
        },
      });

      const texto = resposta.output_text?.trim() ?? '';
      if (!texto) {
        throw new ErroProvedorPlano('O provedor não devolveu nenhum plano.');
      }

      let planoBruto: unknown;
      try {
        planoBruto = JSON.parse(texto);
      } catch {
        throw new ErroProvedorPlano('O provedor devolveu um plano que não é JSON válido.');
      }

      return {
        planoBruto,
        tokensEntrada: resposta.usage?.input_tokens ?? 0,
        tokensSaida: resposta.usage?.output_tokens ?? 0,
      };
    },
  };
}

function listarCatalogo(habilitado: readonly TipoRelatorio[]): string {
  return habilitado
    .map((id) => `- ${id} (${CATALOGO[id].rotulo}): ${CATALOGO[id].descricao}`)
    .join('\n');
}

export function montarPromptPlano(
  ctx: ContextoPergunta,
  config: ConfigAgente,
): { sistema: string; usuario: string } {
  const sistema = [
    'Você é um roteador de relatórios do Grupo ABE. Seu único trabalho é traduzir a',
    'pergunta de um cliente em um PLANO DE CONSULTA estruturado.',
    '',
    'Limites do seu papel, sem exceção:',
    '- Você escolhe apenas o tipo de relatório e os filtros de período, UF e sistema de origem.',
    '- Você NÃO tem acesso a dados, tabelas, consultas SQL nem ao nome do credor.',
    '- Você NUNCA decide de quem é o dado: o escopo do cliente é resolvido pelo servidor,',
    '  fora do seu alcance, e não existe campo de cliente neste plano.',
    '- Você não calcula, não estima e não escreve texto de resposta. Os números e a',
    '  explicação são produzidos depois, pelo sistema, a partir do plano que você devolver.',
    '- Devolva somente o JSON do plano, exatamente no esquema pedido. Qualquer campo fora',
    '  do esquema faz o plano inteiro ser recusado antes de qualquer execução.',
    '',
    'Catálogo habilitado — escolha exatamente um:',
    listarCatalogo(config.catalogoHabilitado),
    '',
    'Regras de preenchimento:',
    `- Datas no formato YYYY-MM-DD. A janela não pode passar de 36 meses.`,
    '- Se a pergunta não pedir outro período, repita o período que já está na tela.',
    '- uf: sigla de duas letras maiúsculas quando a pergunta citar um estado; caso contrário, null.',
    `- sistemaOrigem: um de ${SISTEMAS_ORIGEM.join(', ')}. Use TODOS quando a pergunta não`,
    '  distinguir o sistema onde o título nasceu.',
    `- Idioma de referência do cliente: ${config.idioma}.`,
  ].join('\n');

  const usuario = [
    `Hoje é ${ctx.hoje}.`,
    `Período selecionado na tela: ${ctx.periodoAtual.inicio} a ${ctx.periodoAtual.fim}.`,
    `Sistema de origem selecionado na tela: ${ctx.sistemaOrigemAtual}.`,
    `UF selecionada na tela: ${ctx.ufAtual ?? 'nenhuma (todas)'}.`,
    '',
    'Pergunta do cliente:',
    ctx.pergunta,
  ].join('\n');

  return { sistema, usuario };
}

export async function pedirPlano(
  ctx: ContextoPergunta,
  config: ConfigAgente,
  cliente: ClientePlano,
): Promise<SaidaPlanoBruto> {
  const { sistema, usuario } = montarPromptPlano(ctx, config);

  return cliente.gerarPlano({
    sistema,
    usuario,
    modelo: config.modelo,
    esquema: ESQUEMA_PLANO_JSON,
  });
}
