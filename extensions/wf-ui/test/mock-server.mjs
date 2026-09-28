/**
 * Mock wf-ui server for testing
 *
 * Exports startServer/stopServer that mimic the real server's API
 * but use a simple HTTP server without the complex workflow logic.
 */

import http from 'node:http';

let activeServer = null;

export function startServer(opts = {}) {
  const host = opts.host || '127.0.0.1';
  const port = opts.port || 0;
  const token = opts.token || 'mock-token';

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${host}:${port}`);

      if (url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          uptime: 1.234,
          version: 'mock-server',
        }));
      } else if (url.pathname === '/api/project') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'mock-project',
          root: opts.projectRoot || process.cwd(),
        }));
      } else if (url.pathname === '/api/sessions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sessions: [
            { id: 'session-1', status: 'running' },
            { id: 'session-2', status: 'idle' },
          ],
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });

    server.listen(port, host, () => {
      activeServer = server;
      const actualPort = server.address().port;
      resolve({
        server,
        port: actualPort,
        token,
        url: `http://${host}:${actualPort}/`,
      });
    });

    server.on('error', reject);
  });
}

export function stopServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => {
      activeServer = null;
      resolve();
    });
  });
}
