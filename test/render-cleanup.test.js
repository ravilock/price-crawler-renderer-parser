import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/render.js';

function fixture(mode) {
  let closedContext = 0; let closedBrowser = 0; let rejectNavigation;
  const page = { mainFrame: () => ({}), async goto() { if (mode === 'error') throw new Error('navigation failed'); if (mode === 'wait') return await new Promise((_resolve, reject) => { rejectNavigation = reject; }); return { status: () => 200 }; }, async evaluate() { return { outcome: 'partial', page_title: 'ok', page_description: '', fields: [] }; } };
  const context = { async route() {}, async routeWebSocket() {}, async newPage() { return page; }, on() {}, async close() { closedContext++; rejectNavigation?.(new Error('closed')); } };
  return { launch: async () => ({ async newContext() { return context; }, async close() { closedBrowser++; } }), counts: () => [closedContext, closedBrowser] };
}
for (const mode of ['success', 'error', 'wait']) {
  test(`render closes browser context on ${mode}`, async () => {
    const f = fixture(mode);
    await renderPage({ url: 'https://store.example/', deadlineMs: mode === 'wait' ? 20 : 1000, maxNetworkRequests: 2, fetchThroughCrawler: async () => { throw new Error('unused'); }, launchBrowser: f.launch });
    const [contexts, browsers] = f.counts(); assert.ok(contexts >= 1); assert.equal(browsers, 1);
  });
}
test('render closes browser context on cancellation', async () => {
  const f = fixture('wait'); const controller = new AbortController();
  const result = renderPage({ url: 'https://store.example/', deadlineMs: 1000, maxNetworkRequests: 2, fetchThroughCrawler: async () => { throw new Error('unused'); }, launchBrowser: f.launch, signal: controller.signal });
  setTimeout(() => controller.abort(), 20); await result;
  const [contexts, browsers] = f.counts(); assert.ok(contexts >= 1); assert.equal(browsers, 1);
});

test('rendered rate limits retain the HTTP status for retry handling', async () => {
  const context = { async route() {}, async routeWebSocket() {}, on() {}, async close() {}, async newPage() { return { mainFrame: () => ({}), async goto() { return { status: () => 429, headers: () => ({}) }; } }; } };
  const result = await renderPage({ url: 'https://store.example/', deadlineMs: 1000, maxNetworkRequests: 2, fetchThroughCrawler: async () => { throw new Error('unused'); }, launchBrowser: async () => ({ async newContext() { return context; }, async close() {} }) });
  assert.equal(result.outcome, 'failed'); assert.equal(result.http_status, 429);
});
