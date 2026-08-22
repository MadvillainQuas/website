/* A server that behaves the way a busy one does: refuses, then relents. */
import { readFileSync } from 'node:fs';
const src = readFileSync('C:/Users/Admin/Documents/website_repo/epinoia/data.js', 'utf8');

function lift(s, sig) {
  const from = s.indexOf(sig); if (from === -1) throw new Error('no ' + sig);
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return s.slice(from, j + 1); }
  }
}
const parts = ['const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);',
  'const RETRIES = 3;', 'const sleep = ms => new Promise(r => setTimeout(r, ms));',
  'const inFlight = new Map();',
  lift(src, 'async function get(path)'),
  lift(src, 'async function getCounted(path)'),
  lift(src, 'function share(path, counted)'),
  lift(src, 'async function fetchWithRetry(path, counted)')].join('\n');

let calls = [];
function build(behaviour) {
  calls = [];
  const fetchStub = async (url, opts) => {
    calls.push({ url, t: Date.now() });
    return behaviour(calls.length, opts);
  };
  return new Function('fetch', 'CFG', parts +
    '\nreturn { get, getCounted, calls: () => null };')(
      fetchStub, () => ({ supabaseUrl: 'http://x', supabaseAnonKey: 'k' }));
}
const res = (status, body = [], headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  headers: { get: h => headers[h.toLowerCase()] || null }
});

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* 1. two 429s then success */
{
  const api = build(n => n <= 2 ? res(429) : res(200, [{ a: 1 }]));
  const t0 = Date.now();
  const out = await api.get('game_events?select=seq');
  ok('two refusals then an answer still returns the answer', out.length === 1);
  ok('...after three attempts', calls.length === 3, String(calls.length));
  ok('...having actually waited between them', Date.now() - t0 >= 1100,
     (Date.now() - t0) + 'ms');
}
/* 2. Retry-After is obeyed */
{
  const api = build(n => n === 1 ? res(429, [], { 'retry-after': '1' }) : res(200, [{ a: 1 }]));
  const t0 = Date.now();
  await api.get('x?y=1');
  const waited = Date.now() - t0;
  ok('Retry-After in seconds is honoured', waited >= 950 && waited < 1600, waited + 'ms');
}
/* 3. a 400 is an answer, not a wobble */
{
  const api = build(() => res(400));
  let msg = '';
  try { await api.get('bad?filter=nonsense'); } catch (e) { msg = e.message; }
  ok('a 400 is reported straight away', /400 on bad/.test(msg), msg);
  ok('...and is not asked three more times', calls.length === 1, String(calls.length));
}
/* 4. giving up eventually */
{
  const api = build(() => res(503));
  let msg = '';
  try { await api.get('z?a=1'); } catch (e) { msg = e.message; }
  ok('a service that never relents is reported', /503/.test(msg), msg);
  ok('...after a bounded number of tries', calls.length === 4, String(calls.length));
}
/* 5. identical concurrent reads share one request */
{
  const api = build(() => res(200, [{ a: 1 }, { a: 2 }]));
  const [a, b, c] = await Promise.all([api.get('same?x=1'), api.get('same?x=1'), api.get('other?x=1')]);
  ok('two callers asking the same thing cost one request',
     calls.length === 2, calls.map(c2 => c2.url).join(' | '));
  ok('...and each gets its own array to hold', a !== b && a.length === 2 && b.length === 2);
  ok('...while a different question is still asked', c.length === 2);
}
/* 6. and the dedupe does not cache — a later ask is a fresh request */
{
  const api = build(() => res(200, [{ a: 1 }]));
  await api.get('again?x=1');
  await api.get('again?x=1');
  ok('a later read is not served from a stale answer', calls.length === 2, String(calls.length));
}
/* 7. the counted variant retries too, and reads the total */
{
  const api = build(n => n === 1 ? res(429)
    : res(206, [{ a: 1 }], { 'content-range': '0-999/2370' }));
  const r = await api.getCounted('p?offset=0&limit=1001');
  ok('the first page of a paged read retries as well', calls.length === 2);
  ok('...and still reports the total', r.total === 2370, String(r.total));
}
/* 8. a network failure, not an HTTP one */
{
  let n = 0;
  const api = new Function('fetch', 'CFG', parts + '\nreturn { get };')(
    async () => { n++; if (n < 3) throw new TypeError('Failed to fetch'); return res(200, [{}]); },
    () => ({ supabaseUrl: 'http://x', supabaseAnonKey: 'k' }));
  const out = await api.get('n?x=1');
  ok('a dropped connection is retried, not surfaced', out.length === 1 && n === 3, 'attempts ' + n);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
