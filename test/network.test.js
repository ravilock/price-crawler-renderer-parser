import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkInterception } from '../src/network.js';

test('requests use crawler fetch and foreign redirects need another admission', async () => {
  let handler; let websocket;
  const context = { async route(_pattern, cb) { handler = cb; }, async routeWebSocket(_pattern, cb) { websocket = cb; } };
  const calls = [];
  await installNetworkInterception(context, async url => { calls.push(url); if (url.endsWith('/redirect')) return { status: 'ok', http_status: 302, content_type: '', location: 'http://private/secret', body_base64: '' }; throw new Error('denied'); });
  let response; let aborted = false;
  const makeRoute = (url, resource = 'document', method = 'GET') => ({ request: () => ({ url: () => url, resourceType: () => resource, method: () => method }), async fulfill(value) { response = value; }, async abort() { aborted = true; } });
  await handler(makeRoute('https://store/redirect')); assert.equal(response, undefined); assert.equal(aborted, true); assert.equal(calls.length, 2);
  aborted = false; await handler(makeRoute('https://store/image', 'image')); assert.equal(aborted, true); assert.equal(calls.length, 2);
  let closed = false; websocket({ close() { closed = true; } }); assert.equal(closed, true);
});

test('one-page renderer enforces its shared network request budget', async () => {
  let handler; let blocked = 0;
  const context = { async route(_pattern, callback) { handler = callback; }, async routeWebSocket() {} };
  let fetched = 0;
  await installNetworkInterception(context, async () => {
    fetched++;
    return { status: 'ok', http_status: 200, content_type: 'text/html', location: '', body_base64: Buffer.from('<title>Product</title>').toString('base64') };
  }, { maxRequests: 1, onBlocked: () => blocked++ });
  const route = url => ({
    request: () => ({ url: () => url, resourceType: () => 'document', method: () => 'GET', isNavigationRequest: () => true }),
    async fulfill() {}, async abort() { this.aborted = true; },
  });
  const first = route('https://store.example/product');
  await handler(first);
  const second = route('https://store.example/another');
  await handler(second);
  assert.equal(first.aborted, undefined);
  assert.equal(second.aborted, true);
  assert.equal(fetched, 1);
  assert.equal(blocked, 1);
});
