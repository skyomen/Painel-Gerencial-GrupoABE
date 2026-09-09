import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapComLimite } from './concorrencia.mjs';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

describe('mapComLimite', () => {
  it('respeita o teto de simultaneidade', async () => {
    let emVoo = 0;
    let pico = 0;

    await mapComLimite([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await espera(5);
      emVoo--;
    });

    assert.equal(pico, 3, `teto era 3, chegou a ${pico} — sobrecarregaria o SQL Server`);
  });

  it('mantém a ordem da entrada, não a de conclusão', async () => {
    // O primeiro item demora mais; ainda assim tem de sair na posição 0.
    const r = await mapComLimite([30, 1, 1], 3, async (ms) => {
      await espera(ms);
      return ms;
    });

    assert.deepEqual(
      r.map((x) => x.valor),
      [30, 1, 1],
    );
  });

  it('uma falha não derruba as outras', async () => {
    const r = await mapComLimite([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('credor quebrado');
      return n * 10;
    });

    assert.deepEqual(r[0], { ok: true, valor: 10 });
    assert.equal(r[1].ok, false);
    assert.equal(r[1].erro.message, 'credor quebrado');
    assert.deepEqual(r[2], { ok: true, valor: 30 });
  });

  it('limite inválido não paralisa nem explode', async () => {
    for (const limite of [0, -3, NaN, undefined]) {
      const r = await mapComLimite([1, 2], limite, async (n) => n);
      assert.equal(r.length, 2, `limite ${limite} deixou tarefas sem rodar`);
    }
  });

  it('lista vazia não cria trabalhador', async () => {
    let chamou = false;
    const r = await mapComLimite([], 4, async () => {
      chamou = true;
    });
    assert.deepEqual(r, []);
    assert.equal(chamou, false);
  });

  it('cada item roda uma vez só', async () => {
    const vistos = [];
    await mapComLimite([...Array(20).keys()], 5, async (n) => {
      vistos.push(n);
    });
    assert.equal(new Set(vistos).size, 20);
    assert.equal(vistos.length, 20);
  });
});
