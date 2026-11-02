import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { installRenderWorker } from '../src/worker.js';
const broker=process.env.RENDERER_LIVE_BROKER;
test('renderer fetches the scoped source through the live crawler RPC', { skip: !broker, timeout: 30000 }, async () => {
 const connection=await amqp.connect(broker);const channel=await connection.createChannel();const control=await connection.createChannel();const signal=new AbortController();
 try {
  await control.assertQueue('page.parsed.v1',{durable:true});await installRenderWorker(connection,channel,'render.page.requested.v1','test',signal.signal);
  const id=process.env.RENDERER_LIVE_MESSAGE||randomUUID(),corr=process.env.RENDERER_LIVE_CORRELATION||randomUUID();const job={message_id:id,message_type:'render.page.requested',schema_version:1,occurred_at:new Date().toISOString(),organization_id:process.env.RENDERER_LIVE_ORG,correlation_id:corr,payload:{crawl_request_id:process.env.RENDERER_LIVE_JOB,source_domain_id:process.env.RENDERER_LIVE_SOURCE,url:process.env.RENDERER_LIVE_URL,deadline_ms:10000,max_network_requests:10,adapter_version:'1'}};
  control.sendToQueue('render.page.requested.v1',Buffer.from(JSON.stringify(job)));
  let result;for(let i=0;i<150;i++){const message=await control.get('page.parsed.v1',{noAck:true});if(message){result=JSON.parse(message.content.toString('utf8'));break}await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(result);assert.equal(result.causation_id,id);assert.equal(result.payload.page_title,'Fixture rendered');
 } finally {signal.abort();await channel.close().catch(()=>{});await control.close().catch(()=>{});await connection.close().catch(()=>{})}
});
