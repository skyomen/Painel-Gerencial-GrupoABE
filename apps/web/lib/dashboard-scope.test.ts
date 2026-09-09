import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDashboardScope } from './dashboard-scope.ts';

describe('resolveDashboardScope', () => {
  it('sem credorId → painel do próprio tenant', () => {
    assert.deepEqual(resolveDashboardScope('SUPER_ADMIN', null), { type: 'proprio' });
    assert.deepEqual(resolveDashboardScope('ADMIN_CREDOR', undefined), { type: 'proprio' });
    assert.deepEqual(resolveDashboardScope('VIEWER', '   '), { type: 'proprio' });
  });

  it('SUPER_ADMIN com credorId → pré-visualização do credor', () => {
    assert.deepEqual(resolveDashboardScope('SUPER_ADMIN', ' abc-123 '), {
      type: 'credor',
      credorId: 'abc-123',
    });
  });

  it('credor tentando ver outro credor → negado', () => {
    for (const papel of ['ADMIN_CREDOR', 'OPERADOR', 'VIEWER', '', null]) {
      assert.deepEqual(resolveDashboardScope(papel, 'abc-123'), { type: 'negado' });
    }
  });
});
