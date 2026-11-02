import { randomUUID } from 'node:crypto';
import { renderPage } from './render.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validate(raw) {
  if (!Buffer.isBuffer(raw) || raw.length > 1048576) throw new Error('invalid envelope');
  const e = JSON.parse(raw.toString('utf8')); const p = e.payload;
  if (!e || e.message_type !== 'render.page.requested' || e.schema_version !== 1 || !uuid.test(e.message_id) || !uuid.test(e.organization_id) || !uuid.test(e.correlation_id) || !p || !uuid.test(p.crawl_request_id) || !uuid.test(p.source_domain_id) || typeof p.url !== 'string' || p.url.length > 2048 || !Number.isInteger(p.deadline_ms) || p.deadline_ms < 1000 || p.deadline_ms > 120000 || !Number.isInteger(p.max_network_requests) || p.max_network_requests < 1 || p.max_network_requests > 100 || typeof p.adapter_version !== 'string' || p.adapter_version.length > 100) throw new Error('invalid render request');
  let target; try { target = new URL(p.url); } catch { throw new Error('invalid URL'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('invalid URL');
  const allowedEnvelope = new Set(['message_id', 'message_type', 'schema_version', 'occurred_at', 'organization_id', 'correlation_id', 'causation_id', 'idempotency_key', 'payload']);
  const allowedPayload = new Set(['crawl_request_id', 'source_domain_id', 'url', 'deadline_ms', 'max_network_requests', 'adapter_version', 'approved_origins', 'fields_to_extract']);
  if ((e.causation_id && !uuid.test(e.causation_id)) || (e.idempotency_key && (typeof e.idempotency_key !== 'string' || e.idempotency_key.length > 200)) || (p.approved_origins && (!Array.isArray(p.approved_origins) || p.approved_origins.length > 20 || p.approved_origins.some(v => typeof v !== 'string'))) || (p.fields_to_extract && (!Array.isArray(p.fields_to_extract) || p.fields_to_extract.length > 100 || p.fields_to_extract.some(v => typeof v !== 'string' || v.length > 100)))) throw new Error('invalid optional fields');
  if (Object.keys(e).some(k => !allowedEnvelope.has(k)) || Object.keys(p).some(k => !allowedPayload.has(k)) || !Number.isFinite(Date.parse(e.occurred_at))) throw new Error('unknown fields');
  return e;
}
async function crawlerFetch(connection, identity, job, target, maxBytes, signal) {
  if (signal.aborted) throw new Error('render cancelled');
  const channel = await connection.createConfirmChannel();
  let timer;
  let cancelled;
  try {
    const queue = await channel.assertQueue('', { exclusive: true, autoDelete: true });
    const id = randomUUID(); const deadline = Math.min(30000, Math.max(1, job.payload.deadline_ms));
    const request = { message_id: id, message_type: 'network.fetch.requested', schema_version: 1, occurred_at: new Date().toISOString(), organization_id: job.organization_id, correlation_id: job.correlation_id, causation_id: job.message_id, payload: { crawl_request_id: job.payload.crawl_request_id, source_domain_id: job.payload.source_domain_id, url: target, max_bytes: maxBytes, deadline_ms: deadline } };
    const reply = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('network request timed out')), deadline);
      cancelled = () => { clearTimeout(timer); reject(new Error('render cancelled')); };
      signal.addEventListener('abort', cancelled, { once: true });
      channel.consume(queue.queue, message => {
        if (!message || message.properties.correlationId !== job.correlation_id) return;
        try {
          if (message.content.length > 1048576) throw new Error('oversized reply');
          const e = JSON.parse(message.content.toString('utf8'));
          if (e.message_type !== 'network.fetch.result' || e.schema_version !== 1 || e.organization_id !== job.organization_id || e.correlation_id !== job.correlation_id || e.causation_id !== id) throw new Error('invalid reply');
          clearTimeout(timer); signal.removeEventListener('abort', cancelled); resolve(e.payload);
        } catch (error) { clearTimeout(timer); signal.removeEventListener('abort', cancelled); reject(error); }
      }, { noAck: true }).catch(reject);
    });
    reply.catch(() => {});
    await new Promise((resolve, reject) => { channel.sendToQueue('network.fetch.requested.v1', Buffer.from(JSON.stringify(request)), { persistent: true, mandatory: true, userId: identity, correlationId: job.correlation_id, replyTo: queue.queue, messageId: id }, error => error ? reject(error) : resolve()); });
    return await reply;
  } finally { clearTimeout(timer); if (cancelled) signal.removeEventListener('abort', cancelled); await channel.close().catch(() => {}); }
}
export async function installRenderWorker(connection, channel, queue, identity, signal) {
  await channel.assertExchange('price.dead-letter', 'direct', { durable: true });
  await channel.assertQueue(queue + '.dead', { durable: true });
  await channel.bindQueue(queue + '.dead', 'price.dead-letter', queue + '.dead');
  await channel.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': 'price.dead-letter', 'x-dead-letter-routing-key': queue + '.dead' } });
  await channel.prefetch(1);
  await channel.consume(queue, async message => {
    if (!message) return;
    let job;
    try { job = validate(message.content); if (message.properties.correlationId && message.properties.correlationId !== job.correlation_id) throw new Error('correlation mismatch'); } catch { channel.reject(message, false); return; }
    const jobAbort = new AbortController();
    const timer = setTimeout(() => jobAbort.abort(), job.payload.deadline_ms);
    const stop = () => jobAbort.abort(); signal.addEventListener('abort', stop, { once: true }); channel.once('close', stop);
    try {
      const page = await renderPage({ url: job.payload.url, deadlineMs: job.payload.deadline_ms, maxNetworkRequests: job.payload.max_network_requests, signal: jobAbort.signal, fetchThroughCrawler: (url, limit) => crawlerFetch(connection, identity, job, url, limit, jobAbort.signal) });
      const result = { message_id: randomUUID(), message_type: 'page.parsed', schema_version: 1, occurred_at: new Date().toISOString(), organization_id: job.organization_id, correlation_id: job.correlation_id, causation_id: job.message_id, payload: { crawl_request_id: job.payload.crawl_request_id, requested_url: job.payload.url, final_url: page.final_url || job.payload.url, outcome: page.outcome, observed_at: new Date().toISOString(), parser_version: '1', http_status: page.http_status || null, page_title: page.page_title, page_description: page.page_description, fields: page.fields, structured_data: page.structured_data || [] } };
      while (Buffer.byteLength(JSON.stringify(result)) > 900000 && result.payload.structured_data.length) result.payload.structured_data.pop();
      while (Buffer.byteLength(JSON.stringify(result)) > 900000 && result.payload.fields.length) result.payload.fields.pop();
      if (Buffer.byteLength(JSON.stringify(result)) > 900000) throw new Error('page result exceeds limit');
      const publisher = await connection.createConfirmChannel();
      try { await new Promise((resolve, reject) => { publisher.once('return', () => reject(new Error('page result unroutable'))); publisher.sendToQueue('page.parsed.v1', Buffer.from(JSON.stringify(result)), { persistent: true, mandatory: true, userId: identity, correlationId: job.correlation_id, messageId: result.message_id }, error => error ? reject(error) : resolve()); }); } finally { await publisher.close().catch(() => {}); }
      channel.ack(message);
    } catch { await channel.close().catch(() => {}); }
    finally { clearTimeout(timer); jobAbort.abort(); signal.removeEventListener('abort', stop); channel.removeListener('close', stop); }
  }, { noAck: false });
}
