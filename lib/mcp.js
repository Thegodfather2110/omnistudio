'use strict';
/**
 * A small MCP (Model Context Protocol) client for stdio servers. Zero dependencies.
 * It spawns the server, speaks newline-delimited JSON-RPC 2.0, and offers: start(), listTools(), callTool(), close().
 * Used by the REA tab, but it knows nothing about REA: any MCP stdio server works.
 */
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const PROTOCOL_VERSION = '2025-06-18';
const STDERR_KEEP = 6000;

/** Split `-y rea-agents "my arg"` into ['-y', 'rea-agents', 'my arg']. */
function splitArgs(input) {
  if (Array.isArray(input)) return input.map(String);
  const out = [];
  let cur = '', quote = '', has = false;
  for (const ch of String(input || '')) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** The child gets the normal environment minus anything that looks like a secret. */
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/key|token|secret|passw|credential/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

function abortError() {
  return Object.assign(new Error('stopped'), { name: 'AbortError' });
}

class McpClient {
  constructor({ command, args, cwd, env }) {
    this.command = String(command || '').trim();
    this.args = splitArgs(args);
    this.cwd = cwd || undefined;
    this.extraEnv = env && typeof env === 'object' ? env : {}; // secrets the user typed for this one server (API tokens, ...)
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.exited = false;
    this.exitInfo = '';
    this.serverInfo = null;
    this.tools = null;
    this._starting = null;
  }

  get alive() { return !!this.child && !this.exited; }

  stderrTail() { return this.stderr.trim().slice(-2000); }

  start() {
    if (!this._starting) {
      this._starting = this._start().catch((e) => { this.close(); this._starting = null; throw e; });
    }
    return this._starting;
  }

  async _start() {
    if (!this.command) throw new Error('No command set. Enter the command that starts the MCP server.');
    const args = IS_WIN ? this.args.map((a) => (/\s/.test(a) && !/^".*"$/.test(a) ? `"${a}"` : a)) : this.args;
    let child;
    try {
      child = spawn(this.command, args, { cwd: this.cwd, env: { ...childEnv(), ...this.extraEnv }, stdio: ['pipe', 'pipe', 'pipe'], shell: IS_WIN, windowsHide: true });
    } catch (e) {
      throw new Error(`Could not start “${this.command}”: ${e.message}`);
    }
    this.child = child;
    const failAll = (err) => { for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); };
    child.on('error', (e) => {
      this.exited = true;
      this.exitInfo = e.code === 'ENOENT' ? `Command not found: ${this.command}. Is it installed and on your PATH?` : e.message;
      failAll(new Error(this.exitInfo));
    });
    child.on('exit', (code, sig) => {
      this.exited = true;
      this.exitInfo = this.exitInfo || `The server exited (${sig || 'code ' + code})${this.stderrTail() ? ':\n' + this.stderrTail() : ''}`;
      failAll(new Error(this.exitInfo));
    });
    child.stdin.on('error', () => {});
    child.stderr.on('data', (d) => { this.stderr = (this.stderr + d.toString('utf8')).slice(-STDERR_KEEP); });
    child.stdout.on('data', (d) => this._onData(d.toString('utf8')));

    // the first run of `npx` may download the package, so be generous
    const init = await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'omnistudio', version: '1.3.0' } }, { timeoutMs: 180000 });
    this.serverInfo = { ...(init && init.serverInfo), protocolVersion: init && init.protocolVersion };
    this.notify('notifications/initialized');
  }

  _write(obj) {
    if (!this.alive) throw new Error(this.exitInfo || 'The server is not running.');
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  notify(method, params) {
    try { this._write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); } catch {}
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // servers sometimes print logs to stdout; ignore them
      this._onMessage(msg);
    }
  }

  _onMessage(msg) {
    if (msg && msg.id !== undefined && (msg.result !== undefined || msg.error) && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'MCP error'), { code: msg.error.code }));
      else p.resolve(msg.result);
      return;
    }
    if (msg && msg.method && msg.id !== undefined) {
      // a request from the server: answer politely, we support nothing optional
      try {
        if (msg.method === 'ping') this._write({ jsonrpc: '2.0', id: msg.id, result: {} });
        else this._write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not supported by OmniStudio' } });
      } catch {}
    }
  }

  request(method, params, { timeoutMs = 60000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      let id;
      try {
        id = this.nextId++;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' });
          reject(new Error(`The server did not answer “${method}” within ${Math.round(timeoutMs / 1000)} s.`));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this._write({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
      } catch (e) {
        if (id !== undefined && this.pending.has(id)) { clearTimeout(this.pending.get(id).timer); this.pending.delete(id); }
        return reject(e);
      }
      if (signal) {
        signal.addEventListener('abort', () => {
          const p = this.pending.get(id);
          if (!p) return;
          this.pending.delete(id);
          clearTimeout(p.timer);
          this.notify('notifications/cancelled', { requestId: id, reason: 'stopped by the user' });
          reject(abortError());
        }, { once: true });
      }
    });
  }

  async listTools() {
    await this.start();
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, { timeoutMs: 60000 });
      tools.push(...((r && r.tools) || []));
      cursor = r && r.nextCursor;
      if (!cursor) break;
    }
    this.tools = tools;
    return tools;
  }

  async callTool(name, args, { signal, timeoutMs = 600000 } = {}) {
    await this.start();
    return this.request('tools/call', { name, arguments: args || {} }, { signal, timeoutMs });
  }

  close() {
    const child = this.child;
    this.exited = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Connection closed')); }
    this.pending.clear();
    if (!child) return;
    try { child.stdin.end(); } catch {}
    try {
      if (IS_WIN && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    } catch {}
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    t.unref();
  }
}

/** Turn a tools/call result into plain text for a model. */
function resultText(result) {
  const parts = [];
  for (const c of (result && result.content) || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image') parts.push(`[image omitted: ${c.mimeType || 'image'}]`);
    else if (c.type === 'resource' && c.resource) parts.push(c.resource.text !== undefined ? c.resource.text : `[resource ${c.resource.uri || ''}]`);
    else if (c.type === 'resource_link') parts.push(`[resource link ${c.uri || ''}]`);
    else if (c.type) parts.push(`[${c.type} content omitted]`);
  }
  if (!parts.length && result && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join('\n').trim();
}

module.exports = { McpClient, splitArgs, resultText, childEnv };
