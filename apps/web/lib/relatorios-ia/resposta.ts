/**
 * O texto que o credor lê — montado AQUI, nunca pelo modelo.
 *
 * DEC-0069: a IA devolve plano, não prosa. Esta separação é o que torna as
 * quatro proibições da config estruturais em vez de pedidos educados dentro de
 * um prompt:
 *
 * - "Afirmar um valor sem citar período e fonte": período e fonte entram em
 *   todo texto, por construção — não há caminho que os omita.
 * - "Comparar o credor com outro cliente do Grupo ABE": impossível. O texto só
 *   interpola números que vieram de um executor travado num único `credor_id`,
 *   e o único nome que ele conhece é o do próprio credor, vindo do escopo do
 *   servidor.
 * - "Sugerir ação jurídica ou cobrança extrajudicial": impossível. Não existe
 *   gabarito que fale de ação, prazo ou cobrança — o vocabulário desta função
 *   é fechado e está inteiro neste arquivo.
 * - "Responder com valor financeiro sem o aviso de conferência": o rodapé é
 *   anexado sempre que `respostaContemValorFinanceiro` encontra um R$.
 *
 * Um prompt pede. Um gabarito garante.
 */

import { CATALOGO } from './catalogo';
import type { PlanoDeConsulta } from './plano';
import type { ConfigAgente } from './config';
import {
  dataBr,
  type CardResposta,
  type DadosRelatorio,
  type EscopoExecucao,
  type PontoSerie,
  type TabelaResposta,
} from './executor';

export interface Transparencia {
  fonte: string;
  credor: string;
  periodo: string;
  sistemas: string;
  aviso: string;
}

export interface RespostaRelatorio {
  textoResposta: string;
  cards: CardResposta[];
  tabela: TabelaResposta;
  serieGrafico: PontoSerie[];
  transparencia: Transparencia;
  plano: PlanoDeConsulta;
}

const ROTULO_SISTEMAS: Record<PlanoDeConsulta['filtros']['sistemaOrigem'], string> = {
  TODOS: 'ABE WEB + Delphi',
  ABE_WEB: 'ABE WEB',
  DELPHI: 'Delphi',
};

export function montarTransparencia(plano: PlanoDeConsulta, escopo: EscopoExecucao): Transparencia {
  return {
    fonte: CATALOGO[plano.tipoRelatorio].fonteCalculo,
    credor: `${escopo.razaoSocial} (escopo travado pela sua sessão)`,
    // En-dash, como no protótipo: '01/05/2026–31/10/2026'.
    periodo: `${dataBr(plano.periodo.inicio)}–${dataBr(plano.periodo.fim)}`,
    sistemas: ROTULO_SISTEMAS[plano.filtros.sistemaOrigem],
    aviso: 'Nenhum dado de outro credor foi lido para responder esta pergunta.',
  };
}

/** Há valor em reais na resposta? Decide se o rodapé obrigatório entra. */
export function respostaContemValorFinanceiro(dados: DadosRelatorio): boolean {
  const temReal = (v: unknown) => typeof v === 'string' && v.includes('R$');

  if (dados.cards.some((c) => temReal(c.valor))) return true;
  return dados.tabela.linhas.some((linha) => linha.some(temReal));
}

/** A abertura muda com o tom; o conteúdo, não. Tom é forma, não permissão. */
function abertura(tom: ConfigAgente['tomDeVoz'], rotulo: string, periodo: string): string {
  switch (tom) {
    case 'FORMAL':
      return `Prezado cliente, segue o relatório de ${rotulo.toLowerCase()} referente ao período de ${periodo}.`;
    case 'DIRETO':
      return `${rotulo} — ${periodo}.`;
    case 'CONSULTIVO':
    default:
      return `Olhando a ${rotulo.toLowerCase()} no período de ${periodo}, é isto que os seus dados mostram.`;
  }
}

export function montarTextoResposta(args: {
  plano: PlanoDeConsulta;
  dados: DadosRelatorio;
  config: ConfigAgente;
  escopo: EscopoExecucao;
}): string {
  const { plano, dados, config, escopo } = args;
  const item = CATALOGO[plano.tipoRelatorio];
  const transparencia = montarTransparencia(plano, escopo);

  const partes: string[] = [abertura(config.tomDeVoz, item.rotulo, transparencia.periodo)];

  const destaques = dados.cards.filter((c) => c.label !== 'Dados sincronizados até');
  if (destaques.length > 0) {
    partes.push(destaques.map((c) => `${c.label}: ${c.valor}`).join('; ') + '.');
  } else {
    partes.push('Não há movimento registrado nesse recorte.');
  }

  if (plano.filtros.uf) {
    partes.push(`Recorte aplicado: apenas ${plano.filtros.uf}.`);
  }

  // Proibição 1 — período e fonte não são opcionais em nenhum caminho deste texto.
  partes.push(
    `Período considerado: ${transparencia.periodo}. Sistemas: ${transparencia.sistemas}. ` +
      `Fonte do cálculo: ${transparencia.fonte} — a mesma função que calcula o seu dashboard.`,
  );

  const sincronizado = dados.cards.find((c) => c.label === 'Dados sincronizados até');
  if (sincronizado) {
    partes.push(
      sincronizado.valor === '—'
        ? 'Ainda não há registro de sincronização concluída para este credor.'
        : `Dados sincronizados até ${sincronizado.valor}.`,
    );
  }

  // Proibição 4 — rodapé obrigatório sempre que houver dinheiro na resposta.
  if (respostaContemValorFinanceiro(dados)) {
    partes.push(config.rodapeObrigatorio);
  }

  return partes.join(' ');
}
