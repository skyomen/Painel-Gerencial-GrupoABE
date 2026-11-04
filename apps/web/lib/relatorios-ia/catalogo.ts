/**
 * Catálogo fechado do agente de relatórios (DEC-0069).
 *
 * Esta lista é a FRONTEIRA: o modelo não escreve SQL, não escolhe tabela e não
 * inventa recorte — ele só aponta para um destes seis itens. Ampliar a fronteira
 * exige migration no ENUM `public.tipo_relatorio_ia` e uma entrada aqui, nos
 * dois lugares, revisadas no git. O incômodo é o ponto.
 *
 * `rotulo` vem do protótipo congelado (`docs/prototipos/relatorios-com-ia.html`,
 * seção "Catálogo de dados permitido"); divergência de texto é defeito.
 * `descricao` é o que o modelo lê para escolher o tipo certo.
 * `fonteCalculo` é o que a tela de transparência mostra — o nome do módulo que
 * calculou o número, nunca "a IA".
 */

export const TIPOS_RELATORIO = [
  'CARTEIRA_ATIVA',
  'BORDERO',
  'ACORDOS',
  'BAIXAS',
  'POSICAO_MENSAL',
  'CLASSIFICACAO_IDADE',
] as const;

export type TipoRelatorio = (typeof TIPOS_RELATORIO)[number];

export interface ItemCatalogo {
  id: TipoRelatorio;
  rotulo: string;
  descricao: string;
  fonteCalculo: string;
}

export const CATALOGO: Record<TipoRelatorio, ItemCatalogo> = {
  CARTEIRA_ATIVA: {
    id: 'CARTEIRA_ATIVA',
    rotulo: 'Carteira ativa',
    descricao:
      'Saldo devedor dos processos ainda ativos hoje, com a quebra por classificação ' +
      '(em cobrança, acordo a receber, quebra de acordo) e por UF. Use para perguntas ' +
      'sobre quanto ainda está em aberto, o que está em negociação ou onde a carteira ' +
      'está concentrada. É uma fotografia do momento, não uma série por mês.',
    fonteCalculo: 'calc-metricas-carteira',
  },
  BORDERO: {
    id: 'BORDERO',
    rotulo: 'Borderô',
    descricao:
      'O que foi ENVIADO à cobrança no período: valor, quantidade de processos ' +
      'distintos e idade média do título no envio, mês a mês. Use para perguntas ' +
      'sobre volume enviado, remessas, lotes ou quanto entrou em cobrança.',
    fonteCalculo: 'payload-de-agregados',
  },
  ACORDOS: {
    id: 'ACORDOS',
    rotulo: 'Acordos',
    descricao:
      'Processos em acordo, separados por classificação (acordo com pagamento, ' +
      'acordo a receber, em cobrança, quebra de acordo), com quantidade e valor. ' +
      'Use para perguntas sobre negociações fechadas, acordos em dia ou quebrados.',
    fonteCalculo: 'payload-de-agregados',
  },
  BAIXAS: {
    id: 'BAIXAS',
    rotulo: 'Baixas',
    descricao:
      'Títulos devolvidos ao credor e o motivo da devolução (não processado, ' +
      'não estabelecido, incobrável), com quantidade e valor. Use para perguntas ' +
      'sobre devoluções, baixas, títulos incobráveis ou devedores não localizados.',
    fonteCalculo: 'payload-de-agregados',
  },
  POSICAO_MENSAL: {
    id: 'POSICAO_MENSAL',
    rotulo: 'Posição mensal',
    descricao:
      'Enviado × recebido mês a mês, com recebido pela ABE, pagamento direto ao ' +
      'credor e efetividade do período. Use para perguntas de evolução no tempo, ' +
      'comparação entre meses, recuperação, repasse ou desempenho da cobrança.',
    fonteCalculo: 'payload-de-agregados',
  },
  CLASSIFICACAO_IDADE: {
    id: 'CLASSIFICACAO_IDADE',
    rotulo: 'Classificação por idade',
    descricao:
      'Enviado, recebido e efetividade por faixa de idade da dívida (0-30, 31-60, ' +
      '61-90, 91-180 e mais de 180 dias). Use para perguntas sobre dívida antiga, ' +
      'aging, prazo de vencimento ou em que faixa a cobrança rende mais.',
    fonteCalculo: 'payload-de-agregados',
  },
};

export function ehTipoRelatorio(v: unknown): v is TipoRelatorio {
  return typeof v === 'string' && (TIPOS_RELATORIO as readonly string[]).includes(v);
}
