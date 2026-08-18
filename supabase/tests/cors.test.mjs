/* ============================================================================
   A PREFLIGHT THAT REFUSES A HEADER THE CALLER SENDS IS A DEAD BUTTON.

   Finalising a game failed from the browser every single time, and the message
   was "network error: Failed to fetch" — which is what you also get when the
   wifi is off, so it read as flakiness rather than a fault. It was neither.

   The scorer sent three headers: content-type, authorization and apikey. The
   finalise-game function's CORS policy named the first two. A browser will not
   make a cross-origin request until a preflight has cleared EVERY header it
   intends to send, so the real POST was never made; the promise rejected
   before anything left the machine. curl worked perfectly throughout, because
   only a browser enforces this — which is exactly why it survived so long.

   Every other function on the platform already listed apikey. This one did
   not, and nothing checked. So:

     1. every function's Access-Control-Allow-Headers must cover every header
        the browser code actually sends to it, matched caller-by-caller from
        the real source rather than against a list somebody remembered to
        update;
     2. the method must be allowed too;
     3. and OPTIONS must be answered before any authentication, or the
        preflight gets a 401 that a browser reads as a refusal.

     node supabase/tests/cors.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const FUNCS = path.join(ROOT, 'supabase', 'functions');
const WEB = path.join(ROOT, 'epinoia');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* ---- what each function allows -------------------------------------------- */
const allowed = new Map();     // name -> { headers:Set, methods:Set, src }
for (const name of readdirSync(FUNCS, { withFileTypes: true })
       .filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name)) {
  const file = path.join(FUNCS, name, 'index.ts');
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  const hdr = (src.match(/'Access-Control-Allow-Headers':\s*'([^']*)'/) || [])[1] || '';
  const mth = (src.match(/'Access-Control-Allow-Methods':\s*'([^']*)'/) || [])[1] || '';
  allowed.set(name, {
    headers: new Set(hdr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
    methods: new Set(mth.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)),
    src
  });
}
ok('the functions were found', allowed.size > 0, String(allowed.size));

/* ---- what the browser actually sends -------------------------------------- */
/* Walk every client file, find each fetch to /functions/v1/<name>, and read the
   headers out of that call's own object. Matched from the source so a header
   added later is checked without anybody remembering this file exists. */
function walk(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'vendor' || d.name === 'node_modules') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p));
    else if (d.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const calls = [];
for (const file of walk(WEB)) {
  const src = readFileSync(file, 'utf8');
  const re = /functions\/v1\/([a-z0-9-]+)'/g;
  let m;
  while ((m = re.exec(src))) {
    const chunk = src.slice(m.index, m.index + 700);
    const headerBlock = (chunk.match(/headers:\s*\{([\s\S]*?)\}/) || [])[1] || '';
    /* A header KEY sits at the start of the object or straight after a comma.
       Anchoring on that matters: `session.access_token : ''` inside a ternary
       in a header VALUE otherwise reads as a header called access_token, and
       the test invents failures nobody can fix. */
    const headers = new Set();
    headerBlock.replace(/(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:/g,
      (_, a, b, c) => { headers.add(String(a || b || c).toLowerCase()); return ''; });
    const method = (chunk.match(/method:\s*'([A-Z]+)'/) || [])[1] || 'GET';
    calls.push({ fn: m[1], file: path.relative(ROOT, file).replace(/\\/g, '/'),
                 headers, method });
  }
}
ok('the browser callers were found', calls.length > 0, String(calls.length));

/* Headers a browser sends without being asked never appear in a preflight's
   Access-Control-Request-Headers, so they need no permission. */
const FREE = new Set(['accept', 'accept-language', 'content-language']);

for (const c of calls) {
  const a = allowed.get(c.fn);
  if (!a) { ok(`${c.fn} exists for ${c.file}`, false, 'no supabase/functions/' + c.fn); continue; }

  const missing = [...c.headers].filter(h => !FREE.has(h) && !a.headers.has(h));
  ok(`${c.fn} ← ${c.file} : every header it sends is allowed`,
     missing.length === 0,
     missing.length ? 'not permitted by the function: ' + missing.join(', ') +
       '\n          a browser refuses the preflight and the fetch rejects with ' +
       '"Failed to fetch"' : '');

  ok(`${c.fn} ← ${c.file} : ${c.method} is allowed`,
     a.methods.has(c.method) || c.method === 'GET',
     'allows ' + [...a.methods].join(', '));
}

/* ---- preflight before authentication -------------------------------------- */
for (const [name, a] of allowed) {
  const optIdx = a.src.search(/req\.method\s*===\s*'OPTIONS'/);
  if (optIdx < 0) { ok(`${name} answers OPTIONS`, false, 'no OPTIONS branch'); continue; }
  const authIdx = a.src.search(/getUser\(|sign in first|401/);
  ok(`${name}: OPTIONS is answered before any auth check`,
     authIdx < 0 || optIdx < authIdx,
     'auth at ' + authIdx + ', OPTIONS at ' + optIdx);
}

/* ---- the specific regression ---------------------------------------------- */
{
  const a = allowed.get('finalise-game');
  ok('finalise-game permits apikey — the header whose absence broke every '
     + 'attempt to finish a game from a browser',
     !!a && a.headers.has('apikey'), a && [...a.headers].join(', '));
  const boot = readFileSync(path.join(WEB, 'score', 'bootstrap.js'), 'utf8');
  const call = boot.slice(boot.indexOf("functions/v1/finalise-game"),
                          boot.indexOf("functions/v1/finalise-game") + 400);
  ok('...and the scorer no longer sends it, so the fix does not wait on a deploy',
     !/apikey/i.test(call), call.replace(/\s+/g, ' ').slice(0, 160));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
