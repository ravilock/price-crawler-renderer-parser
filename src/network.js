// All HTTP requests, including redirects, are fetched by the crawler. Browser
// service workers and direct egress must also be blocked by the caller.
export async function installNetworkInterception(context, fetchThroughCrawler, { maxRequests = 50, maxBytes = 524288, onBlocked = () => {}, onFinal = () => {} } = {}) {
  if (!context || typeof context.route !== 'function' || typeof context.routeWebSocket !== 'function' || typeof fetchThroughCrawler !== 'function' || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 524288) throw new Error('invalid network interception configuration');
  let requests = 0;
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    const resource = request.resourceType();
    if (request.method() !== 'GET' || ['image', 'media', 'font'].includes(resource)) { if (request.isNavigationRequest?.()) onBlocked(); await route.abort('blockedbyclient'); return; }
    try {
      let target = request.url();
      for (let hop = 0; hop <= 5; hop++) {
        if (++requests > maxRequests || !/^https?:\/\//i.test(target)) throw new Error('request limit or scheme denied');
        const result = await fetchThroughCrawler(target, maxBytes);
        if (!result || result.status !== 'ok' || !Number.isInteger(result.http_status) || result.http_status < 200 || result.http_status > 599 || typeof result.body_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.body_base64) || Buffer.byteLength(result.body_base64, 'base64') > maxBytes || typeof result.content_type !== 'string' || result.content_type.length > 256 || typeof result.location !== 'string' || result.location.length > 2048 || /[\r\n]/.test(result.content_type + result.location)) throw new Error('invalid crawler response');
        if (result.http_status >= 300 && result.http_status < 400) {
          if (!result.location || hop === 5) throw new Error('invalid redirect');
          target = new URL(result.location, target).href;
          continue;
        }
        if (request.isNavigationRequest?.()) onFinal(target, request);
        const headers = {};
        if (result.content_type) headers['content-type'] = result.content_type;
        await route.fulfill({ status: result.http_status, headers, body: Buffer.from(result.body_base64, 'base64') });
        return;
      }
      throw new Error('redirect limit exceeded');
    } catch { if (request.isNavigationRequest?.()) onBlocked(); await route.abort('blockedbyclient'); }
  });
}
