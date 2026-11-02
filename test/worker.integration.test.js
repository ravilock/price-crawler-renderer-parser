import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { installRenderWorker } from '../src/worker.js';

const broker = process.env.RENDERER_TEST_RABBITMQ_URL;
test('renderer uses broker fetch and publishes a bounded page result', { skip: !broker, timeout: 30000 }, async () => {
  let connection;
  for (let attempt = 0; attempt < 100; attempt++) { try { connection = await amqp.connect(broker); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  assert.ok(connection, 'broker did not start');
  const workerChannel = await connection.createChannel(); const fixture = await connection.createChannel(); const controller = new AbortController();
  try {
    await fixture.assertQueue('page.parsed.v1', { durable: true });
    await fixture.assertQueue('network.fetch.requested.v1', { durable: true });
    await fixture.consume('network.fetch.requested.v1', message => {
      const request = JSON.parse(message.content.toString('utf8'));
      const result = { message_id: randomUUID(), message_type: 'network.fetch.result', schema_version: 1, occurred_at: new Date().toISOString(), organization_id: request.organization_id, correlation_id: request.correlation_id, causation_id: request.message_id, payload: { status: 'ok', http_status: 200, content_type: 'text/html', location: '', body_base64: Buffer.from('<html><title>Fixture product</title></html>').toString('base64') } };
      fixture.sendToQueue(message.properties.replyTo, Buffer.from(JSON.stringify(result)), { correlationId: request.correlation_id }); fixture.ack(message);
    });
    await installRenderWorker(connection, workerChannel, 'render.page.requested.v1', 'test', controller.signal);
    const id = randomUUID(); const org = randomUUID(); const corr = randomUUID();
    const job = { message_id: id, message_type: 'render.page.requested', schema_version: 1, occurred_at: new Date().toISOString(), organization_id: org, correlation_id: corr, payload: { crawl_request_id: randomUUID(), source_domain_id: randomUUID(), url: 'https://store.example/item', deadline_ms: 10000, max_network_requests: 10, adapter_version: '1' } };
    fixture.sendToQueue('render.page.requested.v1', Buffer.from(JSON.stringify(job)));
    let output;
    for (let i = 0; i < 150; i++) { const message = await fixture.get('page.parsed.v1', { noAck: true }); if (message) { output = JSON.parse(message.content.toString('utf8')); break; } await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.ok(output); assert.equal(output.organization_id, org); assert.equal(output.causation_id, id); assert.equal(output.payload.page_title, 'Fixture product');
    fixture.sendToQueue('render.page.requested.v1', Buffer.from(JSON.stringify({ ...job, schema_version: 2 })));
    let rejected; for (let i = 0; i < 100; i++) { rejected = await fixture.get('render.page.requested.v1.dead', { noAck: true }); if (rejected) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.ok(rejected, 'unsupported version was not dead-lettered');
  } finally { controller.abort(); await workerChannel.close().catch(() => {}); await fixture.close().catch(() => {}); await connection.close().catch(() => {}); }
});
