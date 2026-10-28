import http from 'node:http';

// Health describes the transport connection only, not a completed render workflow.
export function healthServer(isReady) {
  return http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"alive"}');
    } else if (req.url === '/readyz') {
      const ready = isReady();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(ready ? '{"status":"ready"}' : '{"status":"degraded"}');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}
