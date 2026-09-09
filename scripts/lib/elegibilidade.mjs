/**
 * Quem entra no sync.
 *
 * A regra era "credor com ADMIN_CREDOR ativo", o que fazia sentido enquanto o
 * painel era o único consumidor: sem responsável, ninguém entrava para ver.
 * Com a visão consolidada da diretoria isso deixa de valer — ela soma TODOS os
 * credores, e um credor sem login vira um buraco no total, não uma ausência.
 *
 * A regra passa a ser: tem código de cliente em algum sistema. Sem código não
 * há o que buscar no legado; é a única condição que o sync realmente exige.
 *
 * Funções puras, sem banco, para poderem ser testadas sozinhas.
 */

/** Códigos de cliente do credor, sem repetição, ignorando vazios. */
export function codigosDoCredor(credor) {
  const principal = credor?.cod_cliente_principal?.trim();
  const delphi = credor?.abe_delphi_cliente_id?.trim();
  const extras = (credor?.codigos_cliente ?? []).map((c) => c?.cod_cliente?.trim()).filter(Boolean);

  return [...new Set([principal, delphi, ...extras].filter(Boolean))];
}

export function credorTemCodigo(credor) {
  return codigosDoCredor(credor).length > 0;
}

/**
 * @param credores           linhas de `credores` com `codigos_cliente` embutido
 * @param exigirResponsavel  mantém a regra antiga (só quem tem login)
 * @param tenantsComResponsavel  Set de tenant_id com ADMIN_CREDOR ativo
 */
export function filtrarElegiveis(
  credores,
  { exigirResponsavel = false, tenantsComResponsavel = new Set() } = {},
) {
  const comCodigo = (credores ?? []).filter(credorTemCodigo);

  if (!exigirResponsavel) return comCodigo;

  return comCodigo.filter((c) => tenantsComResponsavel.has(c.tenant_id));
}

/** Explica quem ficou de fora, para o log dizer o motivo em vez de só o total. */
export function resumirDescartados(credores, elegiveis) {
  const dentro = new Set(elegiveis.map((c) => c.id));
  const semCodigo = [];
  const semResponsavel = [];

  for (const c of credores ?? []) {
    if (dentro.has(c.id)) continue;
    if (!credorTemCodigo(c)) semCodigo.push(c.razao_social ?? c.id);
    else semResponsavel.push(c.razao_social ?? c.id);
  }

  return { semCodigo, semResponsavel };
}
