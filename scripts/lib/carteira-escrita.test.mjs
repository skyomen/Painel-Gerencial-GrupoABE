import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escolherCaminhoEscrita } from './carteira-escrita.mjs';

describe('escolherCaminhoEscrita', () => {
  it('sem URL, cai no REST mesmo com o driver instalado', () => {
    const r = escolherCaminhoEscrita({ temDriver: true, temUrl: false });
    assert.equal(r.caminho, 'rest');
    assert.match(r.motivo, /SUPABASE_DB_URL/);
  });

  it('sem driver, cai no REST mesmo com a URL configurada', () => {
    const r = escolherCaminhoEscrita({ temDriver: false, temUrl: true });
    assert.equal(r.caminho, 'rest');
    assert.match(r.motivo, /pg/);
  });

  it('com os dois, usa transação', () => {
    const r = escolherCaminhoEscrita({ temDriver: true, temUrl: true });
    assert.equal(r.caminho, 'copy');
    assert.equal(r.motivo, null);
  });

  it('o motivo nunca fica vazio quando cai no REST', () => {
    for (const caso of [
      { temDriver: false, temUrl: false },
      { temDriver: true, temUrl: false },
      { temDriver: false, temUrl: true },
    ]) {
      const r = escolherCaminhoEscrita(caso);
      assert.equal(r.caminho, 'rest');
      assert.ok(r.motivo?.length, 'sem motivo no log, ninguém descobre por que está lento');
    }
  });
});
