import amqp from 'amqplib';
import { setTimeout as delay } from 'node:timers/promises';
import { healthServer } from './health.js';

function seconds(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^[0-9]+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3600) throw new Error(`${name} must be between 1 and 3600`);
  return Number(raw) * 1000;
}
const url = process.env.RABBITMQ_URL;
if (!url) throw new Error('RABBITMQ_URL is required');
const timeout = seconds('READINESS_TIMEOUT_SECONDS', 120);
const initial = seconds('RECONNECT_INITIAL_DELAY_SECONDS', 1);
const maximum = seconds('RECONNECT_MAX_DELAY_SECONDS', 30);
if (initial > maximum) throw new Error('initial reconnect delay must not exceed maximum');
const address = process.env.HTTP_ADDR || ':8080';
const split = address.lastIndexOf(':');
const port = Number(address.slice(split + 1));
const host = address.slice(0, split) || '0.0.0.0';
if (split < 0 || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid HTTP_ADDR');
const queue = process.env.RENDER_QUEUE || 'render.page.requested.v1';
const controller = new AbortController();
let ready = false;
let connected = false;
let connection;
let failed = false;
const server = healthServer(() => ready);
server.listen(port, host);
const startupTimer = setTimeout(() => {
  if (!connected) {
    console.error('renderer-parser RabbitMQ readiness timed out');
    failed = true;
    controller.abort();
  }
}, timeout);

async function run() {
  let backoff = initial;
  while (!controller.signal.aborted) {
    try {
      connection = await amqp.connect(url, { timeout: 5000 });
      connection.on('error', () => {});
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      await channel.assertQueue(queue, { durable: true });
      await channel.prefetch(1);
      if (controller.signal.aborted) { await connection.close(); break; }
      ready = true;
      connected = true;
      clearTimeout(startupTimer);
      backoff = initial;
      console.log('renderer-parser transport ready; extraction handler is not configured');
      await new Promise(resolve => {
        const finish = () => {
          connection.removeListener('close', finish);
          channel.removeListener('close', finish);
          controller.signal.removeEventListener('abort', finish);
          resolve();
        };
        connection.once('close', finish);
        channel.once('close', finish);
        controller.signal.addEventListener('abort', finish, { once: true });
        if (controller.signal.aborted) finish();
      });
      ready = false;
      await connection.close().catch(() => {});
    } catch {
      ready = false;
      if (connection) await connection.close().catch(() => {});
    } finally {
      connection = undefined;
    }
    if (!controller.signal.aborted) {
      try { await delay(backoff, undefined, { signal: controller.signal }); } catch { /* shutdown */ }
      backoff = Math.min(backoff * 2, maximum);
    }
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => controller.abort());
try {
  await run();
} finally {
  clearTimeout(startupTimer);
  ready = false;
  await new Promise(resolve => server.close(resolve));
}
if (failed) process.exitCode = 1;
