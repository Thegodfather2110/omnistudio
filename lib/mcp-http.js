'use strict';
/**
 * MCP client for REMOTE servers over "Streamable HTTP" (the transport Claude and ChatGPT connectors use).
 * Same surface as McpClient in mcp.js (start, listTools, callTool, close, serverInfo, tools, alive), so the rest of
 * OmniStudio does not care whether a connector is a local command or a URL. Zero dependencies: Node's built-in fetch.
 *
 * Every request is a POST of one JSON-RPC message. The server answers with plain JSON or with a short SSE stream that
 * carries the answer; both are handled. A session id (Mcp-Session-Id) is remembered when the server hands one out.
 * Auth is whatever headers the user typed (for example  Authorization: Bearer <token>).  OAuth sign-in is not built in.
 */
const PROTOCOL_VERSION = '2025-06-18';

function abortError() {
  return Object.assign(new Error('stopped'), { name: 'AbortError' });
}

/** Parse "event: ...\ndata: {...}\n\n" blocks out of a growing text buffer. Returns [messages, rest]. */
function parseSse(buffer) {
  const out = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop();
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { /* keep-alive or non-JSON event */ }
  }
  return [out, rest];
}

class McpHttpClient {
  constructor({ url, headers }) {
    this.url = String(url || '').trim();
    this.headers = headers && typeof headers === 'object' ? headers : {};
    this.nextId = 1;
    this.sessionId = '';
    this.protocolVersion = PROTOCOL_VERSION;
    this.serverInfo = null;
    this.tools = null;
    this.closed = false;
    this._starting = null;
  }

  get alive() { return !this.closed; }

  stderrTail() { return ''; }

  start() {
    if (!this._starting) this._starting = this._start().catch((e) => { this._starting = null; throw e; });
    return this._starting;
  }

  async _start() {
    let u;
    try { u = new URL(this.url); } catch { throw new Error('That is not a valid URL. Use the full address, for example https://example.com/mcp'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('The URL must start with http:// or https://');
    const init = await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'omnistudio', version: '1.3.0' } }, { timeoutMs: 60000, _init: true });
    this.protocolVersion = (init && init.protocolVersion) || PROTOCOL_VERSION;
    this.serverInfo = { ...(init && init.serverInfo), protocolVersion: this.protocolVersion };
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { timeoutMs: 15000, notification: true }).catch(() => {});
  }

  _headers() {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...this.headers };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.serverInfo) h['MCP-Protocol-Version'] = this.protocolVersion;
    return h;
  }

  /** One POST. For requests it resolves with the matching JSON-RPC message. */
  async _post(message, { timeoutMs = 60000, signal, notification } = {}) {
    if (this.closed) throw new Error('Connection closed');
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    const onAbort = () => ctl.abort();
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); throw abortError(); }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      let resp;
      try {
        resp = await fetch(this.url, { method: 'POST', headers: this._headers(), body: JSON.stringify(message), signal: ctl.signal });
      } catch (e) {
        if (signal && signal.aborted) throw abortError();
        if (timedOut) throw new Error(`The server did not answer “${message.method}” within ${Math.round(timeoutMs / 1000)} s.`);
        const why = (e.cause && (e.cause.code || e.cause.message)) || e.message;
        throw new Error(`Cannot reach ${this.url}: ${why}`);
      }
      const sid = resp.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!resp.ok) {
        const text = (await resp.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        const hint = resp.status === 401 || resp.status === 403 ? ' Check the token or headers for this connector.' : resp.status === 404 && this.sessionId ? ' The session expired; press Test to reconnect.' : '';
        throw new Error(`The server answered HTTP ${resp.status}${text ? ': ' + text : ''}.${hint}`);
      }
      if (notification || resp.status === 202) { await resp.text().catch(() => ''); return null; }
      const type = (resp.headers.get('content-type') || '').toLowerCase();
      if (type.includes('text/event-stream')) {
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          let chunk;
          try { chunk = await reader.read(); } catch (e) {
            if (signal && signal.aborted) throw abortError();
            if (timedOut) throw new Error(`The server did not answer “${message.method}” within ${Math.round(timeoutMs / 1000)} s.`);
            throw e;
          }
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          const [msgs, rest] = parseSse(buf);
          buf = rest;
          const hit = msgs.find((m) => m && m.id === message.id && (m.result !== undefined || m.error));
          if (hit) { reader.cancel().catch(() => {}); return hit; }
        }
        const [msgs] = parseSse(buf + '\n\n');
        const hit = msgs.find((m) => m && m.id === message.id && (m.result !== undefined || m.error));
        if (hit) return hit;
        throw new Error('The server closed the stream without answering.');
      }
      const text = await resp.text();
      let j;
      try { j = JSON.parse(text); } catch { throw new Error('The server did not return JSON. Is this the MCP endpoint URL? Got: ' + text.replace(/\s+/g, ' ').slice(0, 120)); }
      const list = Array.isArray(j) ? j : [j];
      const hit = list.find((m) => m && m.id === message.id);
      if (!hit) throw new Error('The server answered a different request.');
      return hit;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  notify(method, params) {
    this._post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }, { timeoutMs: 10000, notification: true }).catch(() => {});
  }

  async request(method, params, { timeoutMs = 60000, signal, _init } = {}) {
    if (!_init) await this.start();
    const id = this.nextId++;
    const msg = await this._post({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, { timeoutMs, signal });
    if (msg.error) throw Object.assign(new Error(msg.error.message || 'MCP error'), { code: msg.error.code });
    return msg.result;
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
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId) {
      const h = { ...this.headers, 'Mcp-Session-Id': this.sessionId };
      fetch(this.url, { method: 'DELETE', headers: h, signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
  }
}

module.exports = { McpHttpClient, parseSse };
