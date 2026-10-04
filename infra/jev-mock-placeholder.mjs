// Placeholder jev-mock, replaced by apps/jev-mock in T2.2.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8080);

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_implemented_until_T2.2' }));
}).listen(port, '0.0.0.0', () => {
  console.log(`jev-mock placeholder listening on :${port}`);
});
