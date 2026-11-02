import { chromium } from 'playwright';
import { installNetworkInterception } from './network.js';

// The admit hook exists solely for loopback fixture tests. Production callers
// must supply crawler-mediated fetch; the browser never makes direct requests.
async function loopbackFixtureFetch(url, maxBytes, admit) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !(await admit(url))) throw new Error('fixture request denied');
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('fixture response too large');
  return { status: 'ok', http_status: response.status, content_type: response.headers.get('content-type') || '', location: response.headers.get('location') || '', body_base64: Buffer.from(bytes).toString('base64') };
}
export async function renderPage({ url, deadlineMs, maxNetworkRequests, fetchThroughCrawler, admit, signal, launchBrowser }) {
  if (typeof url !== 'string' || url.length > 2048 || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120000 || !Number.isInteger(maxNetworkRequests) || maxNetworkRequests < 1 || maxNetworkRequests > 100) throw new Error('invalid render request');
  let fetcher = fetchThroughCrawler;
  if (!fetcher && typeof admit === 'function' && process.env.NODE_TEST_CONTEXT) fetcher = (target, limit) => loopbackFixtureFetch(target, limit, admit);
  if (typeof fetcher !== 'function') throw new Error('crawler fetch required');
  const launch = launchBrowser || (options => chromium.launch(options));
  const browser = await launch({ headless: true, timeout: deadlineMs, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  let context;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; if (context) void context.close(); else void browser.close(); }, deadlineMs);
  try {
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    let blockedNavigation = false;
    let finalURL = url;
    let page;
    await installNetworkInterception(context, fetcher, { maxRequests: maxNetworkRequests, onBlocked: () => { blockedNavigation = true; }, onFinal: (target, request) => { if (page && request.frame() === page.mainFrame()) finalURL = target; } });
    page = await context.newPage();
    context.on('page', popup => { void popup.close(); });
    const abort = () => { void context.close(); };
    if (signal?.aborted) return { outcome: 'blocked', page_title: '', page_description: '', fields: [] };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      let destination = url;
      let response;
      for (let hop = 0; hop < 6; hop++) {
        response = await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: deadlineMs });
        if (!response || response.status() < 300 || response.status() >= 400) break;
        const location = response.headers().location;
        if (!location || hop === 5) throw new Error('invalid redirect');
        destination = new URL(location, destination).href;
      }
      if (blockedNavigation) return { outcome: 'blocked', page_title: '', page_description: '', fields: [] };
      if (response && response.status() >= 400) return { outcome: response.status() === 404 ? 'unsupported' : 'failed', http_status: response.status(), page_title: '', page_description: '', fields: [] };
      const result = await page.evaluate(() => {
        const title = document.title.slice(0, 1000);
        const description = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').slice(0, 5000);
        const names = { 'product:price:amount': 'price', 'product:price:currency': 'currency', 'product:availability': 'availability', 'product:payment_method': 'payment_method', 'og:title': 'title', 'og:description': 'description' };
        const fields = Array.from(document.querySelectorAll('meta[property],meta[name]')).slice(0, 500).map(node => { const source = (node.getAttribute('property') || node.getAttribute('name') || '').slice(0, 190); return { name: names[source.toLowerCase()] || source, raw_value: (node.getAttribute('content') || '').slice(0, 1024), evidence_ref: 'meta:' + source, source_kind: 'meta' }; });
        const structured_data = [];
        for (const node of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 100)) { const text = node.textContent || ''; if (text.length > 32768) continue; try { const value = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) structured_data.push(value); } catch { /* malformed evidence is ignored */ } }
        return { outcome: 'partial', page_title: title, page_description: description, fields, structured_data };
      });
      return { ...result, final_url: finalURL, http_status: response?.status() || null };
    } catch { return { outcome: timedOut || signal?.aborted ? 'failed' : 'blocked', page_title: '', page_description: '', fields: [] }; }
    finally { signal?.removeEventListener('abort', abort); }
  } finally {
    clearTimeout(timeout);
    if (context) await context.close().catch(() => {});
    await browser.close();
  }
}
