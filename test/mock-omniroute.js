'use strict';
/** Tiny fake OmniRoute used by the tests (and handy for trying the UI without real credits). */
const http = require('http');

const KEY = 'sk-test-key';
const MODELS = ['my-fast-combo', 'my-coder-combo', 'openai/gpt-4o', 'anthropic/claude-sonnet', 'no-params-model', 'video-combo', 'good-coder', 'good-writer', 'weak-model', 'evil-agent', 'chatty-agent', 'approval-agent', 'lead-planner', 'reviewer-model', 'empty-agent', 'conn-remote', 'conn-local', 'conn-bad', 'conn-loop', 'conn-slow', 'conn-plain'];
const STATE = { ddgQueries: [] };


/* ----- scripted behaviours used by the agent / team / benchmark tests ----- */
const tool = (name, attrs, body) => {
  const a = Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${v}"`).join('');
  return body === undefined ? `<tool name="${name}"${a}/>` : `<tool name="${name}"${a}>\n${body}\n</tool>`;
};

function textOf(m) {
  return typeof m.content === 'string' ? m.content : '';
}

const PLAN = {
  summary: 'A tiny calculator project',
  tasks: [
    { id: 't1', title: 'Write calc.js', description: 'Write calc.js that prints the sum of 1,2,3.', capability: 'coding', depends_on: [], deliverables: ['calc.js'], acceptance: ['node calc.js prints 6'] },
    { id: 't2', title: 'Write README.md', description: 'Write README.md explaining the calculator.', capability: 'writing', depends_on: [], deliverables: ['README.md'], acceptance: ['mentions calc.js'] },
  ],
};

function agentReply(body) {
  const msgs = body.messages;
  const user0 = textOf(msgs.find((m) => m.role === 'user') || {});
  const step = msgs.filter((m) => m.role === 'assistant').length;
  const model = body.model;
  if (model === 'empty-agent') return '';
  if (model === 'chatty-agent') return 'The answer is 42, no tools needed.';
  if (model === 'evil-agent') {
    return [
      'Cleaning up.\n' + tool('shell', {}, 'rm -rf /'),
      tool('write_file', { path: '../../escape.txt' }, 'pwned'),
      tool('read_file', { path: '/etc/passwd' }),
      tool('shell', {}, 'cat ../../config.json'),
      tool('finish', {}, 'finished'),
    ][Math.min(step, 4)];
  }
  if (model === 'approval-agent') return step === 0 ? 'Running it.\n' + tool('shell', {}, 'echo approved-ok') : tool('finish', {}, 'ran the command');
  if (/YOUR TASK: t1/.test(user0)) {
    const fixed = /REVIEWER REJECTED/.test(user0);
    return [
      'Writing the file.\n' + tool('write_file', { path: 'calc.js' }, `console.log([1, 2, 3].reduce((a, b) => a + b, 0));${fixed ? ' // fixed' : ''}`),
      tool('shell', {}, 'node calc.js'),
      tool('finish', {}, 'wrote calc.js and ran it: prints 6'),
    ][Math.min(step, 2)];
  }
  if (/YOUR TASK: t2/.test(user0)) return step === 0 ? tool('write_file', { path: 'README.md' }, '# Calc\nRun `node calc.js`.') : tool('finish', {}, 'wrote README.md');
  if (/YOUR TASK: integrate/.test(user0)) return step === 0 ? tool('list_files', { path: '.' }) : tool('finish', {}, 'All parts present and consistent.');
  return [
    'Creating a file.\n' + tool('write_file', { path: 'hello.txt' }, 'hello'),
    tool('shell', {}, 'node -e "console.log(21*2)"'),
    tool('finish', {}, 'Created hello.txt and computed 42'),
  ][Math.min(step, 2)];
}


/* Connectors: scripted assistant that uses connector tools (names are <connector-id>.<tool>) */
function connectorReply(body) {
  const step = body.messages.filter((m) => m.role === 'assistant' && /<tool /.test(textOf(m))).length;
  const lastUser = textOf([...body.messages].reverse().find((m) => m.role === 'user') || {});
  const model = body.model;
  if (model === 'conn-remote') {
    return [
      'Let me echo that.\n' + tool('remote-demo.echo', {}, '{"text": "hi there"}'),
      tool('remote-demo.delete_all', {}, '{}'),
      'FINAL after tools. Last result seen: ' + lastUser.replace(/\s+/g, ' ').slice(0, 120),
    ][Math.min(step, 2)];
  }
  if (model === 'conn-local') {
    return [
      tool('local-mock.show_env', {}, '{"name": "CONNECTOR_SECRET"}'),
      tool('local-mock.analyze_binary', {}, '{"path": "/tmp/x.bin"}'),
      'LOCAL FINAL: ' + lastUser.replace(/\s+/g, ' ').slice(0, 120),
    ][Math.min(step, 2)];
  }
  if (model === 'conn-bad') {
    return [
      tool('remote-demo.no_such', {}, '{}'),
      tool('remote-demo.echo', {}, '{broken'),
      tool('remote-demo.echo', {}, '{}'),
      'Recovered from every mistake.',
    ][Math.min(step, 3)];
  }
  if (model === 'conn-loop') return tool('remote-demo.echo', {}, '{"text": "again"}');
  if (model === 'conn-slow') return step === 0 ? tool('remote-demo.slow', {}, '{}') : 'never reached';
  if (model === 'conn-plain') return 'No tools needed: the answer is 42. TOOLS_IN_PROMPT=' + (/TOOLS \(name/.test(textOf(body.messages[0])) ? 'yes' : 'no');
  return 'ok';
}

/* REA: scripted tool-calling analyst */
function reaReply(body) {
  const step = body.messages.filter((m) => m.role === 'assistant' && /<tool /.test(textOf(m))).length;
  const model = body.model;
  if (model === 'rea-agent') {
    return [
      'Loading the target.\n' + tool('analyze_binary', {}, '{"path": "/tmp/target.bin"}'),
      tool('save_report', {}, '# Findings\n\nThe target has 3 functions.'),
      tool('finish', {}, 'The binary has 3 functions and its entry point is 0x1000.'),
    ][Math.min(step, 2)];
  }
  if (model === 'rea-bad') {
    return [
      tool('no_such_tool', {}, '{}'),
      tool('analyze_binary', {}, '{not json'),
      tool('analyze_binary', {}, '{}'),
      tool('fail_tool', {}, '{}'),
      tool('big_tool', {}, '{}'),
      tool('finish', {}, 'Recovered from every mistake.'),
    ][Math.min(step, 5)];
  }
  if (model === 'rea-slow') return step === 0 ? tool('slow_tool', {}, '{"ms": 60000}') : tool('finish', {}, 'never reached');
  if (model === 'rea-prose') return 'I can answer without any tools: it is a calculator.';
  return tool('finish', {}, 'ok');
}

const GOOD = {
  twosum: '```js\nfunction solve(nums, target) {\n  const seen = new Map();\n  for (let j = 0; j < nums.length; j++) {\n    if (seen.has(target - nums[j])) return [seen.get(target - nums[j]), j];\n    seen.set(nums[j], j);\n  }\n  return null;\n}\n```',
  substring: '```js\nfunction solve(s) {\n  let best = 0, start = 0; const last = new Map();\n  for (let i = 0; i < s.length; i++) {\n    if (last.has(s[i]) && last.get(s[i]) >= start) start = last.get(s[i]) + 1;\n    last.set(s[i], i); best = Math.max(best, i - start + 1);\n  }\n  return best;\n}\n```',
  trains: 'The first train is 90 km ahead at 10:30; closing speed is 30 km/h, so 3 hours.\nFINAL: 13:30',
  sum: 'Multiples of 3 sum to 6633, of 5 to 4100, of 15 to 1365.\nFINAL: 9368',
  json: '{"city":"Lisbon","rank":3,"tags":["coastal","historic","hilly"]}',
  write: 'Meet the bottle that keeps your water ice cold for a full 24 hours, whether you are hiking a ridge, sitting in traffic, or sweating through a gym session. Its double-walled steel body locks in the chill while the outside stays dry to the touch, so nothing leaks into your bag. The wide mouth fits ice cubes and is easy to clean, and the leak-proof lid snaps shut with one hand. Choose a colour you love, fill it in the morning, and enjoy a crisp, refreshing sip long after lunch, dinner and the evening commute have passed.',
  web: '```html\n<!doctype html><html><head><style>.plans{display:flex;gap:1rem}@media (max-width:600px){.plans{flex-direction:column}}</style></head><body><div class="plans"><div>Starter $5 <button>Buy</button></div><div>Pro $15 <button>Buy</button></div><div>Team $40 <button>Buy</button></div></div></body></html>\n```',
  review: 'Bugs: the loop uses i <= arr.length, an off-by-one that reads arr[arr.length] (undefined) and makes the sum NaN. Also an empty array divides by zero.',
};

function probeReply(prompt, model) {
  const weak = model === 'weak-model';
  if (/solve\(nums, target\)/.test(prompt)) return weak ? '```js\nfunction solve(){ return 1 }\n```' : GOOD.twosum;
  if (/longest substring/.test(prompt)) return weak ? 'I am not sure.' : GOOD.substring;
  if (/catch the first/.test(prompt)) return weak ? 'FINAL: 12:00' : GOOD.trains;
  if (/divisible by 3 or by 5/.test(prompt)) return weak ? 'FINAL: 100' : GOOD.sum;
  if (/ONLY a JSON object/.test(prompt)) return weak ? 'Sure! Here you go: {"city":"x"}' : GOOD.json;
  if (/product description/.test(prompt)) return weak ? '- bottle\n- cold' : GOOD.write;
  if (/pricing section/.test(prompt)) return weak ? 'no html' : GOOD.web;
  if (/list every bug/.test(prompt)) return weak ? 'Looks fine to me.' : GOOD.review;
  return null;
}

const reviewState = {};

function createMock(port = 20199) {
  const videoJobs = {};
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    // ---- search providers + a web page (no OmniRoute auth) ----
    const hit = [{ title: 'Alpha result', link: `http://localhost:${port}/page/article`, snippet: 'First snippet about alpha.' }, { title: 'Beta result', link: 'https://example.org/beta', snippet: 'Second snippet.' }];
    if (url.pathname === '/serper') {
      if (req.headers['x-api-key'] !== 'serper-key') return send(403, { message: 'bad key' });
      return send(200, { organic: hit });
    }
    if (url.pathname === '/serpapi') return send(url.searchParams.get('api_key') === 'serpapi-key' ? 200 : 401, url.searchParams.get('api_key') === 'serpapi-key' ? { organic_results: hit } : { error: 'Invalid API key' });
    if (url.pathname === '/brave') return send(200, { web: { results: hit.map((h) => ({ title: '<b>' + h.title + '</b>', url: h.link, description: h.snippet })) } });
    if (url.pathname === '/searxng/search') return send(200, { results: hit.map((h) => ({ title: h.title, url: h.link, content: h.snippet })) });
    if (url.pathname === '/ddg') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      return req.on('end', () => {
        STATE.ddgQueries.push(new URLSearchParams(raw).get('q') || url.searchParams.get('q') || '');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/one?a=1&b=2')}&rut=abc">First &amp; <b>result</b></a><a class="result__snippet" href="x">A snippet &quot;here&quot;</a></div><div class="result"><a class="result__a" href="https://example.net/two">Second</a><a class="result__snippet" href="x">Another</a></div></body></html>`);
      });
    }
    if (url.pathname === '/page/article') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Alpha &amp; Omega</title><style>.x{color:red}</style></head><body><nav>menu</nav><h1>Main heading</h1><p>The alpha protocol launched in 2026.</p><script>alert(1)</script><ul><li>one</li><li>two</li></ul></body></html>');
    }
    if (url.pathname === '/page/redirect-private') {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' });
      return res.end();
    }
    if ((req.headers.authorization || '') !== 'Bearer ' + KEY) return send(401, { error: { message: 'Invalid API key' } });

    if (url.pathname === '/v1/models') return send(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', owned_by: id.includes('combo') ? 'combo' : 'provider' })) });
    if (url.pathname === '/api/combos') return send(200, { combos: [{ name: 'my-fast-combo' }, { name: 'my-coder-combo' }] });

    if (url.pathname === '/files/clip.mp4') {
      const data = Buffer.from('fake-mp4-bytes-'.repeat(50));
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length });
      return res.end(data);
    }

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}

      if (url.pathname === '/v1/chat/completions') {
        if (body.model === 'no-params-model' && ('reasoning_effort' in body || 'top_p' in body)) return send(400, { error: { message: 'unsupported parameter' } });
        if (body.model === 'broken') return send(500, { error: { message: 'upstream exploded' } });
        const last = [...body.messages].reverse().find((m) => m.role === 'user');
        const prompt = typeof last?.content === 'string' ? last.content : 'ok';
        const system = body.messages.find((m) => m.role === 'system')?.content || '';
        let answer;
        let scripted = null;
        if (/ECHO_SYSTEM/.test(prompt)) scripted = 'SYSTEM>>' + system;
        else if (/autonomous engineer/.test(system)) scripted = agentReply(body);
        else if (/^conn-/.test(body.model)) scripted = connectorReply(body);
        else if (/reverse-engineering analyst/.test(system)) scripted = reaReply(body);
        else if (/project planner/.test(system)) scripted = JSON.stringify(PLAN);
        else if (/strict, fair reviewer/.test(system)) {
          const u = textOf(body.messages[body.messages.length - 1]);
          const bad = /Write calc\.js/.test(u) && !/\/\/ fixed/.test(u);
          scripted = bad ? '{"verdict":"fail","score":4,"issues":["Add a comment marking the file as fixed"]}' : '{"verdict":"pass","score":9,"issues":[]}';
        } else if (/strict evaluator/.test(system)) scripted = '8';
        else if (/You write skill files/.test(system)) scripted = '---\nname: Drafted skill\ndescription: made by the mock\n---\n\n# Drafted\nBe concise.';
        else scripted = probeReply(prompt, body.model);
        if (scripted !== null) answer = scripted;
        else if (/app builder/i.test(system)) {
          answer = 'Here is your counter app.\n\n```html file=index.html\n<!doctype html><html><head><title>Counter</title></head><body><button id="b">+1</button><span id="n"></span><script src="app.js"></script></body></html>\n```\n\n```js file=app.js\nvar n = Number(localStorage.getItem("count") || 0);\ndocument.getElementById("n").textContent = n;\ndocument.getElementById("b").onclick = function () { n++; localStorage.setItem("count", String(n)); document.getElementById("n").textContent = n; };\n```\n\nTry clicking the button, then reload.';
        } else if (/index\.html|website builder/i.test(system) || /build .*(site|page)/i.test(prompt)) {
          answer = 'Sure! Here is your site.\n\n```html file=index.html\n<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello from ' + body.model + '</h1><script src="app.js"></script></body></html>\n```\n\n```css file=style.css\nbody{font-family:sans-serif}\n```\n\n```js file=app.js\nconsole.log("hi")\n```\n\nI hope this helps!';
        } else {
          answer = `Sure! I think this is the answer to "${prompt}" from ${body.model} (temp ${body.temperature}).\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\nI hope this helps!`;
        }
        if (!body.stream) {
          return send(200, { id: 'c1', choices: [{ index: 0, message: { role: 'assistant', content: answer, reasoning_content: 'thinking hard' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunks = [{ reasoning_content: 'Let me think. ' }, { reasoning_content: 'Done thinking.' }, ...answer.match(/[\s\S]{1,12}/g).map((c) => ({ content: c }))];
        let i = 0;
        const timer = setInterval(() => {
          if (i < chunks.length) res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: chunks[i++] }] }) + '\n\n');
          else {
            res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 20, total_tokens: 25 } }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            clearInterval(timer);
          }
        }, 5);
        res.on('close', () => clearInterval(timer));
        return;
      }

      if (url.pathname === '/v1/videos/generations' && req.method === 'POST') {
        const id = 'job' + Object.keys(videoJobs).length;
        videoJobs[id] = { polls: 0 };
        return send(200, { id, status: 'queued' });
      }
      const poll = url.pathname.match(/^\/v1\/videos\/generations\/(job\d+)$/);
      if (poll) {
        const job = videoJobs[poll[1]];
        job.polls++;
        if (job.polls < 2) return send(200, { id: poll[1], status: 'processing' });
        return send(200, { id: poll[1], status: 'completed', data: [{ url: `http://localhost:${port}/files/clip.mp4` }] });
      }
      send(404, { error: { message: 'not found: ' + url.pathname } });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { createMock, KEY, STATE };

if (require.main === module) createMock(Number(process.env.MOCK_PORT) || 20199).then(() => console.log('Mock OmniRoute on http://localhost:' + (process.env.MOCK_PORT || 20199) + '/v1  key: ' + KEY));
