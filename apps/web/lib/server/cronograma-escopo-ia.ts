/**
 * Geração de escopo com IA para o botão "Escopar com IA" do modal público
 * "Adicionar à fila" (`/cronograma`, DEC-0079).
 *
 * Isolamento deliberado: este módulo REUTILIZA (import, leitura, nada mais)
 * `carregarConfigAgente`/`carregarChaveApi` de `@/lib/server/agente-relatorios`
 * — a mesma chave/config do Construtor de Relatórios, sem criar uma segunda —
 * mas NÃO toca em `@/lib/relatorios-ia/*` nem generaliza `criarClienteOpenAI`
 * (`lib/relatorios-ia/planner.ts`). O Construtor de Relatórios já está em
 * produção com credores reais; esta função copia o mesmo padrão de chamada ao
 * SDK (import dinâmico de `openai`, `responses.create`, `store: false`, saída
 * estruturada via `text.format = { type: 'json_schema', ... }`, sem
 * `temperature` — confirmado contra `node_modules/openai` 7.50.0, igual
 * `planner.ts` já documenta) de propósito isolado, para que nenhuma mudança
 * nesta entrega menor possa regredir o que já está no ar.
 */

export interface EntradaEscopoIA {
  titulo: string;
  descricao: string;
  escopoRascunho: string;
}

export class ErroProvedorEscopoIA extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroProvedorEscopoIA';
  }
}

export async function gerarEscopoComIA(
  entrada: EntradaEscopoIA,
  apiKey: string,
  modelo: string,
): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const cliente = new OpenAI({ apiKey });

  const sistema = [
    'Você ajuda a escrever o campo "Escopo" de um item do cronograma de desenvolvimento de um',
    'sistema. Dado o título, a descrição curta e um rascunho de escopo já escrito por quem está',
    'sugerindo o item, reescreva e complete o escopo: seja preciso, técnico e objetivo, mantendo',
    'a ideia original do rascunho.',
    '',
    'Não invente requisito, decisão de arquitetura, prazo ou tecnologia que não esteja implícito',
    'no que foi escrito. Não adicione saudação nem comentário fora do próprio texto do escopo.',
    'Responda em português do Brasil.',
  ].join('\n');

  const usuario = [
    `Título: ${entrada.titulo}`,
    `Descrição curta: ${entrada.descricao}`,
    '',
    'Rascunho de escopo:',
    entrada.escopoRascunho,
  ].join('\n');

  const resposta = await cliente.responses.create({
    model: modelo,
    instructions: sistema,
    input: usuario,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'escopo_gerado',
        strict: true,
        schema: {
          type: 'object',
          properties: { escopo: { type: 'string' } },
          required: ['escopo'],
          additionalProperties: false,
        },
      },
    },
  });

  const texto = resposta.output_text?.trim() ?? '';
  if (!texto) {
    throw new ErroProvedorEscopoIA('O provedor não devolveu nenhum escopo.');
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroProvedorEscopoIA('O provedor devolveu um escopo que não é JSON válido.');
  }

  const escopo = (bruto as { escopo?: unknown })?.escopo;
  if (typeof escopo !== 'string' || escopo.trim() === '') {
    throw new ErroProvedorEscopoIA('O provedor devolveu um escopo vazio.');
  }

  return escopo.trim();
}
