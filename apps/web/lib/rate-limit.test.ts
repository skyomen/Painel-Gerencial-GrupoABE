import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { checkRateLimit, resetRateLimitBuckets } from './server/rate-limit.ts';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimitBuckets();
  });

  it('permite até o limite e depois bloqueia', () => {
    const key = 'login:test@example.com';
    for (let i = 0; i < 3; i++) {
      assert.equal(checkRateLimit(key, { limit: 3, windowMs: 60_000 }).ok, true);
    }
    const blocked = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.retryAfterSec >= 1);
    }
  });
});
