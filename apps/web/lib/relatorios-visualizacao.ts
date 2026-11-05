/**
 * Como a resposta do agente vira gráfico e arquivo — a parte que dá para testar
 * sem navegador.
 *
 * DEC-0071 em código: o gráfico é GENÉRICO por tipo de relatório. Ele lê a forma
 * de `serieGrafico` e decide o que desenhar; não existe aqui nenhuma suposição
 * de "sempre linha temporal ABE WEB x Delphi", que é o layout que só existia no
 * protótipo com dado fictício. "Carteira ativa" chega como quebra por UF e tem
 * de desenhar bem assim.
 *
 * A regra de unidade vale igual: série em R$ e série em % não dividem o mesmo
 * eixo. Duas unidades num eixo só produzem uma barra de 0,3 px ao lado de uma
 * de 300 px, e quem lê conclui a coisa errada sobre o próprio dinheiro.
 */

import { formatBRL } from './format-currency';
import type { PontoSerie } from './relatorios-ia/executor';
import type { TipoRelatorio } from './relatorios-ia/catalogo';

/** Chaves que o executor usa para rotular o ponto; nunca são série. */
const CHAVES_EIXO = ['periodo', 'rotulo'] as const;

export type UnidadeSerie = 'MOEDA' | 'PERCENTUAL' | 'QUANTIDADE';

export interface SerieGrafico {
  /** Chave dentro do ponto (`enviado`, `recebido`, `ativo`, …). */
  chave: string;
  /** O que a legenda mostra. */
  rotulo: string;
  cor: string;
}

export interface EspecGrafico {
  /** Linha para série no tempo, barra para série por categoria. */
  forma: 'linha' | 'barra';
  series: SerieGrafico[];
  unidade: UnidadeSerie;
  /** Texto curto sob o título, dizendo a unidade e o eixo. */
  legendaEixo: string;
}

/**
 * Os dois únicos tipos cujo eixo X é tempo. Os outros quatro devolvem
 * categorias (UF, classificação, motivo, faixa de idade) e barra lê melhor —
 * ligar categorias com uma linha sugere continuidade que não existe.
 */
const TIPOS_TEMPORAIS: readonly TipoRelatorio[] = ['BORDERO', 'POSICAO_MENSAL'];

/** Rótulo e unidade de cada chave que o executor pode devolver. */
const CHAVES_CONHECIDAS: Record<string, { rotulo: string; unidade: UnidadeSerie }> = {
  ativo: { rotulo: 'Saldo ativo', unidade: 'MOEDA' },
  enviado: { rotulo: 'Enviado', unidade: 'MOEDA' },
  recebido: { rotulo: 'Recebido', unidade: 'MOEDA' },
  quantidade: { rotulo: 'Processos', unidade: 'QUANTIDADE' },
  efetividade: { rotulo: 'Efetividade', unidade: 'PERCENTUAL' },
};

/**
 * Paleta da marca, na ordem do protótipo congelado: azul institucional e
 * dourado. `success`/`warning` ficam de fora de propósito — são cores de
 * estado, e reaproveitá-las como "série 3" faz um gráfico dizer que um valor é
 * bom ou ruim quando ele é só o terceiro.
 */
const CORES = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--gold-soft))'];

function unidadeDaChave(chave: string): UnidadeSerie {
  return CHAVES_CONHECIDAS[chave]?.unidade ?? 'QUANTIDADE';
}

function rotuloDaChave(chave: string): string {
  return CHAVES_CONHECIDAS[chave]?.rotulo ?? chave;
}

/** Chaves numéricas do primeiro ponto, na ordem em que o executor as montou. */
function chavesNumericas(serie: PontoSerie[]): string[] {
  const ponto = serie[0];
  if (!ponto) return [];
  return Object.keys(ponto).filter(
    (k) => !(CHAVES_EIXO as readonly string[]).includes(k) && typeof ponto[k] === 'number',
  );
}

const LEGENDA_POR_UNIDADE: Record<UnidadeSerie, string> = {
  MOEDA: 'Valores em R$',
  PERCENTUAL: 'Valores em %',
  QUANTIDADE: 'Quantidade de processos',
};

/**
 * Decide o que desenhar a partir do que de fato veio na resposta.
 *
 * Série vazia devolve `null`: a tela mostra o aviso de "sem dados" em vez de um
 * eixo vazio, que parece defeito de carregamento.
 */
export function montarEspecGrafico(
  tipoRelatorio: TipoRelatorio,
  serie: PontoSerie[],
): EspecGrafico | null {
  if (serie.length === 0) return null;

  const chaves = chavesNumericas(serie);
  if (chaves.length === 0) return null;

  // Unidade dominante: havendo dinheiro, o gráfico é o do dinheiro e as demais
  // chaves ficam na tabela. Misturar R$ com % no mesmo eixo esconde uma das duas.
  const temMoeda = chaves.some((c) => unidadeDaChave(c) === 'MOEDA');
  const unidade: UnidadeSerie = temMoeda ? 'MOEDA' : unidadeDaChave(chaves[0]);

  const doGrafico = chaves.filter((c) => unidadeDaChave(c) === unidade);
  if (doGrafico.length === 0) return null;

  return {
    forma: TIPOS_TEMPORAIS.includes(tipoRelatorio) ? 'linha' : 'barra',
    unidade,
    legendaEixo: LEGENDA_POR_UNIDADE[unidade],
    series: doGrafico.map((chave, i) => ({
      chave,
      rotulo: rotuloDaChave(chave),
      cor: CORES[i % CORES.length],
    })),
  };
}

/** Formata um valor do eixo/tooltip na unidade da série. */
export function formatarValorSerie(valor: number, unidade: UnidadeSerie): string {
  if (unidade === 'MOEDA') return formatBRL(valor);
  if (unidade === 'PERCENTUAL') return `${valor.toLocaleString('pt-BR')}%`;
  return valor.toLocaleString('pt-BR');
}

/**
 * Rótulo da marca do eixo Y.
 *
 * Sem o "R$" de propósito: a unidade já está dita uma vez na legenda do
 * gráfico (`legendaEixo`), e repeti-la em cada marca estourava a largura do
 * eixo — o Recharts quebrava "R$ 600 mil" em duas linhas e cortava a marca
 * mais alta contra a borda. Defeito que só apareceu no navegador.
 */
export function formatarMarcaEixo(valor: number, unidade: UnidadeSerie): string {
  if (unidade === 'PERCENTUAL') return `${valor.toLocaleString('pt-BR')}%`;
  if (unidade === 'QUANTIDADE') return valor.toLocaleString('pt-BR');

  const absoluto = Math.abs(valor);
  if (absoluto >= 1_000_000) return `${(valor / 1_000_000).toLocaleString('pt-BR')} mi`;
  if (absoluto >= 1_000) return `${Math.round(valor / 1_000).toLocaleString('pt-BR')} mil`;
  return valor.toLocaleString('pt-BR');
}

// =============================================================================
// Exportação
// =============================================================================

export interface TabelaExportavel {
  colunas: string[];
  linhas: (string | number | null)[][];
}

/**
 * Tabela → CSV para Excel brasileiro.
 *
 * Separador `;` e BOM UTF-8 porque o Excel em pt-BR abre `,` como uma coluna só
 * e come o acento sem o BOM. O arquivo existe para ser aberto, não para passar
 * num parser ideal.
 */
export function tabelaParaCsv(tabela: TabelaExportavel): string {
  const escapar = (valor: string | number | null): string => {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  return [tabela.colunas, ...tabela.linhas]
    .map((linha) => linha.map(escapar).join(';'))
    .join('\r\n');
}

/** `relatorio-posicao-mensal-2026-11-05.csv` — nome previsível, sem espaço. */
export function nomeArquivoCsv(tipoRelatorio: string, hoje: Date = new Date()): string {
  const slug = tipoRelatorio.toLowerCase().replace(/_/g, '-');
  return `relatorio-${slug}-${hoje.toISOString().slice(0, 10)}.csv`;
}
