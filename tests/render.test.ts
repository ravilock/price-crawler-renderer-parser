import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { renderPage } from '../src/render.js';

test('bounded evidence, redirects and denied destinations', async () => {
  let blockedHits = 0;
  const blocked = http.createServer((_req, res) => { blockedHits++; res.end('secret'); });
  await new Promise<void>(resolve => blocked.listen(0, '127.0.0.1', resolve));
  const blockedPort = (blocked.address() as { port: number }).port;
  const source = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: `http://127.0.0.1:${blockedPort}/secret` }); res.end(); return; }
    res.end(`<html><head><title>Widget</title><meta name="description" content="${'x'.repeat(6000)}"></head><body><img src="http://127.0.0.1:${blockedPort}/secret"><span>R$ 12,34</span></body></html>`);
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
  const admit = async (url: string) => new URL(url).origin === origin;
  try {
    const evidence = await renderPage({ url: `${origin}/product`, deadlineMs: 5000, maxNetworkRequests: 10, admit });
    assert.equal(evidence.page_title, 'Widget');
    assert.ok(evidence.page_description.length <= 5000);
    assert.ok(evidence.fields.length <= 500);
    assert.equal('html' in evidence, false);
    assert.equal(blockedHits, 0);
    const redirected = await renderPage({ url: `${origin}/redirect`, deadlineMs: 5000, maxNetworkRequests: 10, admit });
    assert.equal(redirected.outcome, 'blocked');
    assert.equal(blockedHits, 0);
  } finally {
    await Promise.all([new Promise<void>(resolve => source.close(() => resolve())), new Promise<void>(resolve => blocked.close(() => resolve()))]);
  }
});
