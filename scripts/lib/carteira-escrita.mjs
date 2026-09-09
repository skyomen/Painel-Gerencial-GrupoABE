/**
 * Escrita da carteira no Supabase — dois caminhos, mesma semântica.
 *
 * O caminho REST (delete + insert em lotes via PostgREST) tem dois defeitos que
 * só aparecem com volume:
 *
 *   · JANELA DE VAZIO — entre o DELETE e o fim dos INSERTs, o credor tem zero
 *     linhas. Quem abrir o painel exatamente ali vê carteira vazia, e não há
 *     erro nenhum para investigar depois.
 *   · LENTIDÃO — 20 mil linhas em lotes de 500 são 40 requisições HTTP; 4
 *     milhões seriam 8 mil. É o que transformaria o sync em uma madrugada.
 *
 * O caminho COPY resolve os dois: DELETE e carga acontecem na MESMA transação
 * (leitores continuam vendo a carteira anterior até o COMMIT) e o `COPY FROM
 * STDIN` é ordens de magnitude mais rápido que inserir por HTTP.
 *
 * Para ligá-lo:
 *   1. pnpm add pg
 *   2. SUPABASE_DB_URL no .env — Supabase → Project Settings → Database →
 *      Connection string → URI (a de "Session pooler" serve; use a senha do
 *      banco, não a service_role key).
 *
 * Sem uma das duas, o sync segue pelo REST e apenas avisa. Nada quebra: é a
 * mesma escrita, mais lenta e com a janela aberta.
 */

import { comandoCopy, linhasParaCopy } from './copy-tsv.mjs';

const BATCH_REST = 500;

/** Decide o caminho sem tentar conectar — testável e sem efeito colateral. */
export function escolherCaminhoEscrita({ temDriver, temUrl }) {
  if (!temUrl) return { caminho: 'rest', motivo: 'SUPABASE_DB_URL não configurada' };
  if (!temDriver) return { caminho: 'rest', motivo: 'pacote `pg` não instalado' };
  return { caminho: 'copy', motivo: null };
}

/** Carrega o `pg` sob demanda. Ausente não é erro — é o caminho REST. */
async function carregarPg() {
  try {
    const mod = await import('pg');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function escreverPorCopy(pg, url, credorId, sistemaOrigem, linhas, log) {
  const { default: copyFrom } = await import('pg-copy-streams').catch(() => ({ default: null }));

  const cliente = new pg.Client({
    connectionString: url,
    // O pooler do Supabase exige TLS e apresenta certificado próprio.
    ssl: { rejectUnauthorized: false },
  });

  await cliente.connect();

  try {
    await cliente.query('BEGIN');
    await cliente.query(
      'DELETE FROM public.carteira_snapshot WHERE credor_id = $1 AND sistema_origem = $2',
      [credorId, sistemaOrigem],
    );

    if (linhas.length) {
      if (copyFrom) {
        // Caminho rápido de verdade: fluxo direto para o servidor.
        const stream = cliente.query(copyFrom.from(comandoCopy()));
        stream.write(linhasParaCopy(linhas));
        stream.end();
        await new Promise((resolve, reject) => {
          stream.on('finish', resolve);
          stream.on('error', reject);
        });
      } else {
        // Sem `pg-copy-streams`, ainda vale a pena: INSERT parametrizado em
        // lote, dentro da MESMA transação — perde a velocidade do COPY, mas
        // mantém a janela fechada, que é o defeito mais grave.
        await inserirParametrizado(cliente, linhas);
        log?.(`    (sem pg-copy-streams: INSERT em transação, mais lento que COPY)`);
      }
    }

    await cliente.query('COMMIT');
    return linhas.length;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function inserirParametrizado(cliente, linhas) {
  const { COLUNAS_CARTEIRA } = await import('./copy-tsv.mjs');
  const POR_INSERT = 500;

  for (let i = 0; i < linhas.length; i += POR_INSERT) {
    const chunk = linhas.slice(i, i + POR_INSERT);
    const valores = [];
    const marcadores = chunk.map((linha, l) => {
      const base = l * COLUNAS_CARTEIRA.length;
      COLUNAS_CARTEIRA.forEach((coluna) => valores.push(linha[coluna] ?? null));
      return `(${COLUNAS_CARTEIRA.map((_, c) => `$${base + c + 1}`).join(', ')})`;
    });

    await cliente.query(
      `INSERT INTO public.carteira_snapshot (${COLUNAS_CARTEIRA.join(', ')}) VALUES ${marcadores.join(', ')}`,
      valores,
    );
  }
}

async function escreverPorRest(db, credorId, sistemaOrigem, linhas, log) {
  const { error: delErr } = await db
    .from('carteira_snapshot')
    .delete()
    .eq('credor_id', credorId)
    .eq('sistema_origem', sistemaOrigem);

  if (delErr) throw delErr;

  for (let i = 0; i < linhas.length; i += BATCH_REST) {
    const chunk = linhas.slice(i, i + BATCH_REST);
    const { error } = await db.from('carteira_snapshot').insert(chunk);
    if (error) throw error;
    log?.(
      `    carteira_snapshot ${sistemaOrigem}: lote ${Math.floor(i / BATCH_REST) + 1} (+${chunk.length})`,
    );
  }

  return linhas.length;
}

/**
 * Grava a carteira do credor, substituindo o que havia daquele sistema.
 * Escolhe COPY-em-transação quando disponível; senão, REST.
 */
export async function escreverCarteira(db, credorId, sistemaOrigem, linhas, log = console.log) {
  const url = process.env.SUPABASE_DB_URL?.trim() || null;
  const pg = url ? await carregarPg() : null;

  const { caminho, motivo } = escolherCaminhoEscrita({
    temDriver: Boolean(pg),
    temUrl: Boolean(url),
  });

  if (caminho === 'copy') {
    const total = await escreverPorCopy(pg, url, credorId, sistemaOrigem, linhas, log);
    log?.(`    carteira_snapshot ${sistemaOrigem}: ${total} registros (transação)`);
    return total;
  }

  log?.(`    carteira_snapshot ${sistemaOrigem}: caminho REST — ${motivo}`);
  const total = await escreverPorRest(db, credorId, sistemaOrigem, linhas, log);
  log?.(`    carteira_snapshot ${sistemaOrigem}: ${total} registros`);
  return total;
}
