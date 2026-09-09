import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideRouteGuard } from './route-guards.ts';

describe('decideRouteGuard', () => {
  it('sem sessão em rota protegida → login', () => {
    assert.deepEqual(decideRouteGuard('/admin/credores', undefined, null), {
      type: 'redirect',
      to: '/login',
    });
    assert.deepEqual(decideRouteGuard('/dashboard', undefined, null), {
      type: 'redirect',
      to: '/login',
    });
  });

  it('ADMIN_CREDOR em /admin → sem-permissao', () => {
    assert.deepEqual(
      decideRouteGuard('/admin/credores', 'u1', { papel: 'ADMIN_CREDOR', ativo: true }),
      { type: 'redirect', to: '/sem-permissao' },
    );
  });

  it('SUPER_ADMIN em /admin → allow', () => {
    assert.deepEqual(
      decideRouteGuard('/admin/credores', 'u1', { papel: 'SUPER_ADMIN', ativo: true }),
      { type: 'allow' },
    );
  });

  it('SUPER_ADMIN em /dashboard → allow (suporte)', () => {
    assert.deepEqual(decideRouteGuard('/dashboard', 'u1', { papel: 'SUPER_ADMIN', ativo: true }), {
      type: 'allow',
    });
  });

  it('ADMIN_CREDOR logado em /login → dashboard', () => {
    assert.deepEqual(decideRouteGuard('/login', 'u1', { papel: 'ADMIN_CREDOR', ativo: true }), {
      type: 'redirect',
      to: '/dashboard',
    });
  });

  it('SUPER_ADMIN logado em /login → admin', () => {
    assert.deepEqual(decideRouteGuard('/login', 'u1', { papel: 'SUPER_ADMIN', ativo: true }), {
      type: 'redirect',
      to: '/admin/credores',
    });
  });

  it('usuário inativo → login', () => {
    assert.deepEqual(
      decideRouteGuard('/dashboard', 'u1', { papel: 'ADMIN_CREDOR', ativo: false }),
      { type: 'redirect', to: '/login' },
    );
  });
});
