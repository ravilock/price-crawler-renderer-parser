import amqp from 'amqplib';

const url = process.env.RABBITMQ_URL;
if (!url) throw new Error('RABBITMQ_URL is required');
const connection = await amqp.connect(url);
const channel = await connection.createChannel();
const queue = process.env.RENDER_QUEUE || 'render.page.requested.v1';
await channel.assertQueue(queue, { durable: true });
channel.prefetch(1);
console.log(`renderer worker ready on ${queue}; Playwright extraction handler is not configured`);
