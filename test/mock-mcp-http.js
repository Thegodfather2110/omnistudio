'use strict';
/** A tiny REMOTE MCP server (Streamable HTTP) for the tests: bearer auth, a session id, JSON and SSE answers. */
const http = require('http');

const TOKEN = 'remote-secret-token';
const TOOLS = [
  { name: 'echo', description: 'Echo the text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'delete_all', description: 'Deletes everything.', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
  { name: 'slow', description: 'Takes a long time.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
];

function createHttpMock(port) {
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry = { method: req.method, auth: req.headers.authorization || '', session: req.headers['mcp-session-id'] || '', version: req.headers['mcp-protocol-version'] || '', body: null };
      try { entry.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch {}
      log.push(entry);
      if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>not an MCP endpoint</html>'); }
      if (entry.auth !== 'Bearer ' + TOKEN) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized: bad token'); }
      if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
      const msg = entry.body;
      if (!msg || msg.id === undefined) { res.writeHead(202); return res.end(); }
      const json = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') {
        res.setHeader('Mcp-Session-Id', 'sess-42');
        return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'remote-demo', version: '2.0.0' } });
      }
      if (msg.method === 'tools/list') {
        // answered as an SSE stream, with a server notification first, to cover that path
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } }) + '\n\n');
        return res.end('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }) + '\n\n');
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: a } = msg.params;
        if (name === 'echo') return json({ content: [{ type: 'text', text: 'echo: ' + a.text }] });
        if (name === 'delete_all') return json({ content: [{ type: 'text', text: 'everything deleted' }] });
        if (name === 'slow') return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool: ' + name } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ log, token: TOKEN, close: () => { server.closeAllConnections && server.closeAllConnections(); server.close(); } })));
}

module.exports = { createHttpMock, TOKEN };
