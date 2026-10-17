#!/usr/bin/env node
'use strict';
/** A tiny MCP stdio server used by the tests: stands in for REA. Usage: node mock-mcp-server.js [--log file] */
const fs = require('fs');
const logIdx = process.argv.indexOf('--log');
const LOG = logIdx > 0 ? process.argv[logIdx + 1] : '';
const log = (o) => { if (LOG) fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); };

const TOOLS_1 = [
  { name: 'analyze_binary', description: 'Load a binary and summarise it.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number' } }, required: ['path'] } },
  { name: 'slow_tool', description: 'Takes a long time.', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } },
];
const TOOLS_2 = [
  { name: 'fail_tool', description: 'Always reports an error.', inputSchema: { type: 'object', properties: {} } },
  { name: 'big_tool', description: 'Returns a lot of text and an image.', inputSchema: { type: 'object', properties: {} } },
];

// optional extra tool, only for the connectors tests: reveals an environment variable the app passed to this process
if (process.argv.includes('--env-tool')) TOOLS_1.push({ name: 'show_env', description: 'Return an environment variable.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, annotations: { readOnlyHint: true } });

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line));
  }
});

function handle(msg) {
  log({ method: msg.method, params: msg.params });
  if (msg.method === 'initialize') {
    process.stdout.write('starting up (this log line is not JSON)\n');
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-rea', version: '9.9.9' } } });
  }
  if (msg.method === 'tools/list') {
    const page2 = msg.params && msg.params.cursor === 'p2';
    return send({ jsonrpc: '2.0', id: msg.id, result: page2 ? { tools: TOOLS_2 } : { tools: TOOLS_1, nextCursor: 'p2' } });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'analyze_binary') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `Analysed ${args.path}: 3 functions, entry point 0x1000` }] } });
    if (name === 'show_env') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'env ' + args.name + '=' + (process.env[args.name] || '(unset)') }] } });
    if (name === 'slow_tool') return setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'finally done' }] } }), Number(args.ms) || 60000);
    if (name === 'fail_tool') return send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'Hopper is not running' }] } });
    if (name === 'big_tool') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'x'.repeat(30000) }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] } });
    return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool: ' + name } });
  }
  if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
}
process.stdin.on('end', () => process.exit(0));
