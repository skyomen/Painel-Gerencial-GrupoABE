/**
 * Executa tarefas com um teto de simultaneidade.
 *
 * O sync era serial em três níveis (credor → código → página). Com um credor
 * funcionava; com cem, vira horas. Mas paralelismo aqui não é grátis: são
 * consultas pesadas contra o SQL Server de PRODUÇÃO, o mesmo que a operação usa
 * o dia inteiro. Por isso o padrão é baixo e o teto é explícito, não "todas de
 * uma vez".
 */

/**
 * Roda `tarefa` sobre `itens` com no máximo `limite` em voo.
 *
 * Uma falha não cancela as demais: o resultado traz `{ ok, valor }` ou
 * `{ ok: false, erro }` por item, na ordem da entrada. Num sync de cem
 * credores, um credor com problema não pode derrubar os noventa e nove.
 */
export async function mapComLimite(itens, limite, tarefa) {
  const lista = [...(itens ?? [])];
  const teto = Math.max(1, Math.floor(limite) || 1);
  const resultados = new Array(lista.length);
  let proximo = 0;

  async function trabalhador() {
    for (;;) {
      const indice = proximo++;
      if (indice >= lista.length) return;
      try {
        resultados[indice] = { ok: true, valor: await tarefa(lista[indice], indice) };
      } catch (erro) {
        resultados[indice] = { ok: false, erro };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(teto, lista.length) }, trabalhador));
  return resultados;
}

/**
 * Coletor de log por tarefa.
 *
 * Com execução concorrente, `console.log` direto intercala as linhas de vários
 * credores e o relatório fica ilegível. Cada tarefa escreve no seu próprio
 * buffer e despeja tudo junto no fim.
 */
export function criarLog(titulo) {
  const linhas = [];
  return {
    escrever: (texto) => linhas.push(texto),
    despejar: () => {
      if (titulo) console.log(titulo);
      for (const linha of linhas) console.log(linha);
    },
  };
}
