/* ============================================================================
   THE LAZY SDK LOADER (config.js epinoiaSdk) FINDS THE SDK BESIDE config.js, whatever folder the page is in.

   It used to ask for "vendor/supabase.js" relative to the DOCUMENT: from /epinoia/p/ that is /epinoia/p/vendor/supabase.js, a 404, so on
   the player page a signed-in platform administrator never got a client, never passed the whoami gate, and was never offered the
   "edit links" panel (reported 2026-09-27). The team page has a static ../vendor/supabase.js tag, which is why it worked there.

     node supabase/tests/sdk-path.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const configjs = readFileSync(path.join(ROOT, 'epinoia', 'config.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

/* the page: a config.js tag with the given src, and a document that records the script the loader adds */
function page(configSrc, extraConfig) {
  const added = [];
  const sandbox = {
    addEventListener() {}, matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null },
    document: {
      documentElement: { setAttribute() {} },
      querySelector: sel => (configSrc && /config\.js/.test(sel) ? { getAttribute: () => configSrc } : null),
      createElement: () => { const s = { addEventListener() {}, set src(v) { added.push(v); this._s = v; }, get src() { return this._s; } }; return s; },
      head: { appendChild() {} }, documentElement2: null
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(configjs, sandbox);
  if (extraConfig) Object.assign(sandbox.EPINOIA_CONFIG, extraConfig);
  sandbox.document.head.appendChild = () => {};
  sandbox.document.documentElement.appendChild = () => {};
  const p = sandbox.epinoiaSdk();
  p.catch(() => {});
  return added;
}

console.log('where the SDK is asked for');
ok('a page one folder down (the player page): ../vendor/supabase.js, beside ../config.js, with the same stamp', page('../config.js?v=500')[0] === '../vendor/supabase.js?v=500');
ok('a page two folders down (../../config.js): ../../vendor/supabase.js', page('../../config.js?v=500')[0] === '../../vendor/supabase.js?v=500');
ok('a page beside the folder (config.js): vendor/supabase.js, as before', page('config.js?v=7')[0] === 'vendor/supabase.js?v=7');
ok('an absolute src is followed as it is', page('https://x.test/epinoia/config.js?v=9')[0] === 'https://x.test/epinoia/vendor/supabase.js?v=9');
ok('an unstamped tag gives an unstamped path', page('../config.js')[0] === '../vendor/supabase.js');
ok('a path set in the configuration still wins', page('../config.js?v=1', { sdkPath: '/cdn/supabase.js' })[0] === '/cdn/supabase.js?v=1');
ok('no config.js tag to read from: the old default, relative to the page', page(null)[0] === 'vendor/supabase.js');

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
