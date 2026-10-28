import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { healthServer } from '../src/health.js';

test('liveness stays up as transport readiness changes', async () => {
  let ready = false;
  const server = healthServer(() => ready);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/readyz')).status, 503);
    ready = true;
    assert.equal((await fetch(base + '/readyz')).status, 200);
    ready = false;
    assert.equal((await fetch(base + '/readyz')).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
