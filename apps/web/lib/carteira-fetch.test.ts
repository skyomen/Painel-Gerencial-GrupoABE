import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchCarteiraSnapshot } from './carteira-fetch.ts';

type Chamada = { from: number; to: number; cols: string };

/**
 * Dublê do PostgREST: respeita `range` e corta em `maxRows`, que é o
 * comportamento que fazia a leitura sem paginação devolver só a primeira fatia.
 */
function fakeSupabase(totalLinhas: number, maxRows = 1000, ufIndisponivel = false) {
  const chamadas: Chamada[] = [];

  const client = {
    from() {
      let cols = '';
      let de = 0;
      let ate = Number.MAX_SAFE_INTEGER;

      const builder = {
        select(c: string) {
          cols = c;
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          de = from;
          ate = to;
          return builder;
        },
        then(resolve: (r: { data: unknown[] | null; error: unknown }) => void) {
          if (ufIndisponivel && cols.includes('uf')) {
            resolve({
              data: null,
              error: { code: '42703', message: 'column carteira_snapshot.uf does not exist' },
            });
            return;
          }
          chamadas.push({ from: de, to: ate, cols });
          const limite = Math.min(ate - de + 1, maxRows);
          const linhas = [];
          for (let i = de; i < Math.min(de + limite, totalLinhas); i++) {
            linhas.push({ processo: `P${i}`, valor_original_titulo: 1 });
          }
          resolve({ data: linhas, error: null });
        },
      };
      return builder;
    },
  };

  return { client, chamadas };
}

describe('fetchCarteiraSnapshot', () => {
  it('lê além do teto de linhas do PostgREST', async () => {
    const { client, chamadas } = fakeSupabase(2500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchCarteiraSnapshot(client as any, 'credor-1');

    assert.equal(rows.length, 2500, 'a carteira inteira precisa chegar, não só a 1ª página');
    assert.equal(chamadas.length, 3, '2500 linhas = 3 páginas de 1000');
    assert.deepEqual(
      chamadas.map((c) => c.from),
      [0, 1000, 2000],
    );
  });

  it('para na primeira página incompleta', async () => {
    const { client, chamadas } = fakeSupabase(400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchCarteiraSnapshot(client as any, 'credor-1');

    assert.equal(rows.length, 400);
    assert.equal(chamadas.length, 1, 'página incompleta encerra a leitura');
  });

  it('carteira vazia não gera segunda página', async () => {
    const { client, chamadas } = fakeSupabase(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchCarteiraSnapshot(client as any, 'credor-1');

    assert.deepEqual(rows, []);
    assert.equal(chamadas.length, 1);
  });

  it('sem a coluna uf, repagina no fallback em vez de truncar', async () => {
    const { client, chamadas } = fakeSupabase(1500, 1000, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchCarteiraSnapshot(client as any, 'credor-1');

    assert.equal(rows.length, 1500);
    assert.ok(
      chamadas.every((c) => !c.cols.includes('uf')),
      'o fallback não pode pedir a coluna ausente',
    );
  });
});
