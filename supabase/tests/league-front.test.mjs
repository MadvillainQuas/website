/* ============================================================================
   A LEAGUE'S FRONT PAGE SHOWS ONE COMPETITION AT A TIME, AND SAYS WHICH.

   /epinoia/?l=<slug> summarises the season in two embeds — the table and the
   leaders — and they showed whichever competition the embed happened to pick
   first. A league is not one competition: it is a league, a cup, a trophy and
   its playoffs, and there was no way to see the cup's table or its leading
   scorers without leaving the page (asked for 2026-09-18).

   So the two share one row of buttons. What this file holds:

     1. the buttons are drawn from the competitions actually being PLAYED
        (comps.js), not from every competition on record
     2. the principal one is chosen, which is what the page already showed
     3. choosing one re-points BOTH embeds and the link out of each card, so
        "open ›" opens what is on screen
     4. a league with one competition gets no buttons at all
     5. the embed understands the parameter the buttons send it

     node supabase/tests/league-front.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

/* ------------------------------------------------------------- the fixture ---
   splash() run for real against a fake document: it is the ordering and the
   URLs that matter, and neither is visible in the source. */
const src = rd('epinoia', 'home.js');
const SPLASH = src.slice(src.indexOf('/* which competition the two embeds are showing'),
                         src.indexOf('/* The section numbers are a reading aid'));

function node(t, c, x) {
  const n = { tag: t, kids: [], attrs: {}, listeners: {}, _text: x == null ? '' : String(x) };
  n.cls = new Set(c ? String(c).split(/\s+/).filter(Boolean) : []);
  n.classList = { add: k => n.cls.add(k), contains: k => n.cls.has(k),
                  remove: k => n.cls.delete(k), toggle: (k, v) => (v ? n.cls.add(k) : n.cls.delete(k)) };
  n.appendChild = k => { n.kids.push(k); return k; };
  n.append = (...ks) => ks.forEach(k => n.appendChild(k));
  n.before = () => {};
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = k => (k === 'src' ? (n.src == null ? null : String(n.src)) : (n.attrs[k] == null ? null : n.attrs[k]));
  n.addEventListener = (t2, fn) => { (n.listeners[t2] = n.listeners[t2] || []).push(fn); };
  n.click = () => (n.listeners.click || []).forEach(fn => fn());
  Object.defineProperty(n, 'className', {
    get() { return [...n.cls].join(' '); },
    set(v) { n.cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  });
  Object.defineProperty(n, 'textContent', {
    get() { return n._text + n.kids.map(k => k.textContent).join(''); },
    set(v) { n._text = v == null ? '' : String(v); n.kids.length = 0; }
  });
  return n;
}

function run(fields) {
  const host = node('div');
  const scrolled = [];
  const ctx = {
    /* the wheel and drag pass-through is real events on a real frame; here it is only
       counted, so the test can say every card was given it */
    scrollThrough: (link, frame) => scrolled.push([link, frame]),
    console, Promise, String, encodeURIComponent, JSON,
    document: {
      documentElement: { getAttribute: () => 'dark' },
      createElement: t => node(t)
    },
    $: sel => (sel === '#leagues' ? host : null),
    el: node,
    LEAGUE: { id: 'lg1', slug: 'bcb', name: 'British Championship Basketball' },
    KIND_LABEL: { league: 'league', cup: 'cup', trophy: 'trophy' },
    embedLook: () => '&theme=dark',
    seasonFields: () => Promise.resolve(fields)
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SPLASH + '\nglobalThis.__go = splash();', ctx);
  const find = (n, cls, out = []) => { if (n.cls && n.cls.has(cls)) out.push(n);
    (n.kids || []).forEach(k => find(k, cls, out)); return out; };
  /* THE CHIPS OF THE PICKER, not every .ep-chip on the page: the two "Full …"
     links under the cards wear the same class and are not a choice of competition. */
  const picker = () => find(host, 'gpick')[0] || null;
  return {
    host, picker, scrolled,
    chips: () => (picker() ? find(picker(), 'ep-chip') : []),
    frames: () => find(host, 'embedframe'),
    hits: () => find(host, 'embedhit')
  };
}

const COMP = (id, name, kind) => ({ id, name, kind, games: 4, teams: new Set(['a', 'b']) });
const TWO = { main: COMP('c-lg', 'BCB 2026-2027', 'league'),
              all: [COMP('c-cup', 'BCB Trophy 2027', 'trophy'), COMP('c-lg', 'BCB 2026-2027', 'league')] };

/* ---------------------------------------------------------- 1. the buttons --- */
console.log('\n1. one row of buttons, above both cards');
{
  const r = run(TWO);
  await r.host && await new Promise(s => setTimeout(s, 0));    // the fields promise settles
  eq('one button per competition being played',
     r.chips().map(c => c.textContent), ['BCB 2026-2027league', 'BCB Trophy 2027trophy']);
  eq('the principal one first, and chosen', r.chips().map(c => c.cls.has('on')), [true, false]);
  eq('...and said out loud for a screen reader',
     r.chips().map(c => c.attrs['aria-pressed']), ['true', 'false']);
  ok('each says what kind of competition it is',
     r.chips().every(c => c.kids.some(k => k.cls.has('kind'))));
  ok('they sit above the two cards, because they govern both', (() => {
    const kids = r.host.kids;
    return kids[0] && kids[0].cls.has('gpick') && kids[1] && kids[1].cls.has('splitgrid');
  })());
  ok('the buttons are buttons, not links that would navigate',
     r.chips().length > 0 && r.chips().every(c => c.tag === 'button' && c.type === 'button'));
  ok('each card\'s link still lets its table scroll underneath (a wheel or a drag is not a tap)',
     r.hits().length === 2 && r.scrolled.length === 2 &&
     r.hits().every(h => r.scrolled.some(([l, f]) => l === h && r.frames().indexOf(f) >= 0)));
}

/* ------------------------------------------------- 2. what choosing one does --- */
console.log('\n2. choosing one moves both embeds and both links');
{
  const r = run(TWO);
  await new Promise(s => setTimeout(s, 0));
  eq('the table and the leaders both open on the principal competition',
     r.frames().map(f => f.src),
     ['embed/table/?l=bcb&kind=standings&n=200&theme=dark&c=c-lg',
      'embed/table/?l=bcb&kind=leaders&stat=ppg&n=30&theme=dark&c=c-lg']);
  eq('...and so does the way out of each card',
     r.hits().map(a => a.attrs.href || a.href),
     ['l/?l=bcb&c=c-lg', 'l/?l=bcb&c=c-lg#leaders']);

  r.chips()[1].click();
  eq('choosing the trophy moves both embeds', r.frames().map(f => f.src),
     ['embed/table/?l=bcb&kind=standings&n=200&theme=dark&c=c-cup',
      'embed/table/?l=bcb&kind=leaders&stat=ppg&n=30&theme=dark&c=c-cup']);
  eq('...and both links, so "open ›" opens what is on screen',
     r.hits().map(a => a.attrs.href || a.href),
     ['l/?l=bcb&c=c-cup', 'l/?l=bcb&c=c-cup#leaders']);
  eq('the chosen button is the lit one', r.chips().map(c => c.cls.has('on')), [false, true]);
  eq('the leaders link keeps its anchor AFTER the competition',
     (r.hits()[1].attrs.href || r.hits()[1].href).endsWith('#leaders'), true);
}

/* --------------------------------------------- 3. when there is no choice --- */
console.log('\n3. a league with nothing to choose between');
{
  const one = { main: COMP('c-lg', 'BCB 2026-2027', 'league'), all: [COMP('c-lg', 'BCB 2026-2027', 'league')] };
  const r = run(one);
  await new Promise(s => setTimeout(s, 0));
  eq('one competition: no buttons at all', r.chips().length, 0);
  eq('...and the embeds are exactly what they always were',
     r.frames().map(f => f.src),
     ['embed/table/?l=bcb&kind=standings&n=200&theme=dark',
      'embed/table/?l=bcb&kind=leaders&stat=ppg&n=30&theme=dark']);

  const none = run(null);
  await new Promise(s => setTimeout(s, 0));
  eq('a read that failed leaves the page as it was, with no buttons',
     [none.chips().length, none.frames().length], [0, 2]);

  /* a competition with entries and no fixtures is not a view of anything */
  const unplayed = { main: COMP('c-lg', 'BCB 2026-2027', 'league'),
                     all: [COMP('c-lg', 'BCB 2026-2027', 'league')] };
  const u = run(unplayed);
  await new Promise(s => setTimeout(s, 0));
  eq('only the ones being played are offered', u.chips().length, 0);
  ok('...which is comps.js\'s own rule, not a second one here',
     /const played = \[\.\.\.byId\.values\(\)\]\.filter\(c => c\.games > 0\);/.test(rd('epinoia', 'comps.js')) &&
     /seasonFields\(LEAGUE\.id\)\.then\(F => \{\s*\n\s*const played = \(F && F\.all\) \|\| \[\];/.test(src));
}

/* ------------------------------------------- 4. the embed understands it --- */
console.log('\n4. the parameter the buttons send is the one the embed reads');
{
  const embed = rd('epinoia', 'embed', 'table', 'table.js');
  ok('the embed scopes itself by ?c=', /D\.context\(leagueSlug, qp\.get\('c'\)\)/.test(embed));
  ok('the league page reads the same parameter', /qp\.get\('c'\)/.test(rd('epinoia', 'l', 'league.js')));
  ok('and data.js resolves it to a competition of that league',
     /const comp = comps\.find\(c => c\.id === compId\) \|\| comps\[0\] \|\| null;/.test(rd('epinoia', 'data.js')));
  ok('the row is styled by the stylesheet the games picker already uses',
     /\.gpick\{/.test(rd('epinoia', 'index.html')) && /picker = el\('div', 'gpick'\)/.test(src));
  ok('an iframe is only re-pointed when the URL actually changes',
     /if \(card\.frame\.getAttribute\('src'\) !== want\) card\.frame\.src = want;/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
