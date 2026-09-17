/* ============================================================================
   AN EMBED WEARS THE PAGE IT IS ON.

   Three pieces, each tested in the language it runs in:

     embed.js          on a club's site: reads the page's light or dark from the
                       background actually behind the embed, its brand colour from
                       theme-color / a primary-colour variable / its links, and
                       sends them again when the page changes; what the snippet
                       says outright wins, and data-colourway="off" turns it off
     teamcolour.js     on Epinoia's own pages: the league's or club's colours and
                       the reader's light/dark, sent to every embed frame on the page
     embed/theme.js    inside every embed: applies what its own parent sends (and
                       nothing any other frame sends), readable on either ground

   Plus the strip's league name, bottom left, linking to the league's page.

     node supabase/tests/embed-colourway.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) + ' , wanted ' + JSON.stringify(want));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ inside an embed --- */
function embed(url, opts = {}) {
  const attrs = { body: {}, html: {} }, props = {}, posted = [], listeners = {};
  const node = which => ({
    setAttribute: (k, v) => { attrs[which][k] = String(v); },
    removeAttribute: k => { delete attrs[which][k]; },
    getAttribute: k => (k in attrs[which] ? attrs[which][k] : null),
  });
  const kids = [];
  const body = Object.assign(node('body'), {
    style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } },
    appendChild: c => { kids.push(c); return c; }, scrollHeight: 132
  });
  const parent = { postMessage: (m) => posted.push(m) };
  const ctx = {
    console, setTimeout, URLSearchParams, location: { search: new URL(url).search },
    localStorage: { getItem: () => opts.stored || null, setItem: () => {} },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    document: {
      readyState: 'interactive', body, documentElement: node('html'),
      querySelector: s => (s === '.ep-strip' && opts.strip ? { appendChild: c => kids.push(c) } : null),
      createElement: () => ({ addEventListener() {}, setAttribute() {}, hidden: false, className: '', textContent: '', title: '' }),
      addEventListener() {}
    },
    parent
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'teamcolour.js'), ctx);
  vm.runInContext(read('epinoia', 'embed', 'theme.js'), ctx);
  const message = (data, source = parent) => (listeners.message || []).forEach(f => f({ data, source }));
  return { props, attrs, posted, kids, message, ctx };
}

console.log('\n-- inside the embed (embed/theme.js)');
{
  const e = embed('https://x/embed/strip/?theme=dark&accent=%23c8102e&bg=%23111418', { strip: true });
  eq('the URL\'s theme is applied to <body> and <html>', [e.attrs.body['data-theme'], e.attrs.html['data-theme']], [undefined, undefined]);
  ok('...its accent is painted as a surface, an ink and a colour for text on it',
     /^#[0-9a-f]{6}$/.test(e.props['--ep-accent']) && /^#[0-9a-f]{6}$/.test(e.props['--ep-accent-ink']) && ['#04100b', '#ffffff'].includes(e.props['--ep-on-accent']), JSON.stringify(e.props));
  eq('...and its ground', e.props['--ep-ground'], '#111418');
  ok('it asks its host for the colourway once it is up', e.posted.some(m => m && m.epinoiaEmbed === 'colourway?'));
  ok('the strip\'s switch sits on the bar, not in a corner', e.kids.some(k => k.className === 'ep-theme'));

  e.message({ epinoiaEmbed: 'colourway', theme: 'light', accent: '#ffd700', accent2: '#000080', ground: '#ffffff' });
  eq('a message from its own parent switches it to light', [e.attrs.body['data-theme'], e.attrs.html['data-theme']], ['light', 'light']);
  eq('...takes the new ground', e.props['--ep-ground'], '#ffffff');
  const TC = e.ctx.EpinoiaTeamColour;
  ok('...and a gold accent is darkened until it reads on white', TC.contrast(e.props['--ep-accent-ink'], '#f3faf6') >= 4.5, e.props['--ep-accent-ink']);
  ok('...hiding the reader\'s switch, since the page now speaks for itself', e.kids.find(k => k.className === 'ep-theme').hidden === true);

  e.message({ epinoiaEmbed: 'colourway', theme: 'dark', accent: 'red;background:url(x)' }, { postMessage() {} });
  eq('a message from any other frame is ignored', e.attrs.body['data-theme'], 'light');
  e.message({ epinoiaEmbed: 'colourway', theme: 'dark', accent: 'red;background:url(x)', accent2: null, ground: null });
  ok('an accent that is not hex never reaches a style: the embed falls back to its own',
     !('--ep-accent' in e.props) && !('--ep-ground' in e.props) && e.attrs.body['data-theme'] === undefined, JSON.stringify(e.props));
}
{
  const e = embed('https://x/embed/table/?kind=standings', { stored: 'dark' });
  eq('with no host speaking, the reader\'s own choice still stands', e.attrs.body['data-theme'], undefined);
  ok('...and the switch for the box score, table and shop is in the corner', e.kids.some(k => k.className === 'ep-theme fixed'));
}

/* ------------------------------------------------------------ a club's site --- */
console.log('\n-- on a club\'s site (embed.js)');
function clubSite(dataset, page = {}) {
  const posted = [], listeners = {}, observers = [];
  const frames = [];
  const bg = page.bg || 'rgb(17, 20, 24)';
  const container = { nodeType: 1, parentElement: null, appendChild: f => { frames.push(f); f.parentElement = container; } };
  const scriptParent = { nodeType: 1, parentElement: null, insertBefore: (f) => { frames.push(f); f.parentElement = scriptParent; } };
  const styleOf = n => {
    if (n === 'root') return { getPropertyValue: k => (page.vars || {})[k] || '' };
    if (n && n.isLink) return { color: page.link || 'rgb(0, 0, 238)' };
    return { backgroundColor: (n === container || n === scriptParent) ? bg : 'rgba(0, 0, 0, 0)' };
  };
  const me = { src: 'https://epinoia.test/epinoia/embed.js', dataset, parentNode: scriptParent, parentElement: scriptParent, nextSibling: null };
  const ctx = {
    console, setTimeout, URL,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: n => styleOf(n === ctx.document.documentElement ? 'root' : n),
    MutationObserver: function (cb) { this.observe = () => observers.push(cb); },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    document: {
      currentScript: me, documentElement: {}, body: {},
      querySelector: s => (s.startsWith('#') ? container : (s.includes('a[href]') ? { isLink: true } : null)),
      querySelectorAll: s => (s.includes('theme-color') && page.themeColor ? [{ getAttribute: k => (k === 'content' ? page.themeColor : null) }] : []),
      createElement: () => {
        const f = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, cb) { (this.on = this.on || {})[t] = cb; },
                    contentWindow: { postMessage: (m, o) => posted.push([m, o]) } };
        return f;
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'embed.js'), ctx);
  const frame = frames[0];
  return { frame, url: frame && new URL(frame.src), posted, listeners, observers, ctx };
}
{
  const s = clubSite({ epinoia: 'strip', league: 'bcb', into: '#strip' }, { bg: 'rgb(17, 20, 24)', themeColor: '#c8102e' });
  eq('a dark site gets a dark embed, on its own background, in its theme-color',
     [s.url.searchParams.get('theme'), s.url.searchParams.get('bg'), s.url.searchParams.get('accent')], ['dark', '#111418', '#c8102e']);
  s.frame.on.load();
  const m = s.posted[s.posted.length - 1];
  ok('...and is told again once it has loaded, only at our own origin',
     m && m[0].epinoiaEmbed === 'colourway' && m[0].theme === 'dark' && m[1] === 'https://epinoia.test', JSON.stringify(m));
  ok('...watching the page for a change of clothes', s.observers.length >= 1);
}
{
  const s = clubSite({ epinoia: 'standings', league: 'bcb' }, { bg: 'rgb(255, 255, 255)', vars: { '--wp--preset--color--primary': '#1e73be' } });
  eq('a white WordPress site gets a light embed in its primary colour',
     [s.url.searchParams.get('theme'), s.url.searchParams.get('accent'), s.url.searchParams.get('kind')], ['light', '#1e73be', 'standings']);
}
{
  const s = clubSite({ epinoia: 'strip', league: 'bcb' }, { bg: 'rgb(255, 255, 255)', link: 'rgb(51, 51, 51)' });
  eq('grey links are not a brand colour: the embed keeps its own', s.url.searchParams.get('accent'), null);
}
{
  const s = clubSite({ epinoia: 'strip', league: 'bcb', theme: 'dark', accent: '#00ff00' }, { bg: 'rgb(255, 255, 255)', themeColor: '#c8102e' });
  eq('what the snippet says outright wins, and a dark embed on a white page keeps its own ground',
     [s.url.searchParams.get('theme'), s.url.searchParams.get('accent'), s.url.searchParams.get('bg')], ['dark', '#00ff00', null]);
}
{
  const s = clubSite({ epinoia: 'strip', league: 'bcb', colourway: 'off' }, { bg: 'rgb(17, 20, 24)', themeColor: '#c8102e' });
  eq('data-colourway="off" reads nothing and watches nothing',
     [s.url.searchParams.get('theme'), s.url.searchParams.get('accent'), s.observers.length], [null, null, 0]);
}

/* ------------------------------------------------------------ Epinoia's pages --- */
console.log('\n-- on Epinoia\'s own pages (teamcolour.js)');
function ourPage(bodyClass, vars, light) {
  const ctx = {
    console, setTimeout,
    getComputedStyle: () => ({ getPropertyValue: k => vars[k] || '' }),
    document: { readyState: 'complete', body: null,
                documentElement: { getAttribute: k => (k === 'data-theme' && light ? 'light' : null) } },
  };
  ctx.window = ctx; ctx.top = {};                  /* not top-level: the page's own sync stays off here */
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'teamcolour.js'), ctx);
  ctx.document.body = { classList: { contains: c => c === bodyClass } };
  return ctx.EpinoiaTeamColour.colourway();
}
eq('a league-themed page sends the league\'s colours and its light/dark',
   ourPage('league-themed', { '--league-a': ' #275994', '--league-b': '#1d2f6f' }, true),
   { epinoiaEmbed: 'colourway', theme: 'light', accent: '#275994', accent2: '#1d2f6f' });
eq('a club\'s page sends the club\'s', ourPage('themed', { '--team-a': '#c8102e', '--team-b': '#ffffff' }, false),
   { epinoiaEmbed: 'colourway', theme: 'dark', accent: '#c8102e', accent2: '#ffffff' });
eq('the platform\'s own pages send no colours, so embeds keep theirs', ourPage('', {}, false),
   { epinoiaEmbed: 'colourway', theme: 'dark', accent: null, accent2: null });

/* ------------------------------------------------------------------ wiring --- */
console.log('\n-- wiring');
const stripHtml = read('epinoia', 'embed', 'strip', 'index.html');
const stripJs = read('epinoia', 'embed', 'strip', 'strip.js');
const css = read('epinoia', 'kit', 'embed.css');
ok('every embed loads the colour maths before its theme', ['strip', 'table', 'game', 'merch'].every(k => {
  const h = read('epinoia', 'embed', k, 'index.html');
  return h.indexOf('teamcolour.js') > 0 && h.indexOf('teamcolour.js') < h.indexOf('theme.js');
}));
ok('no embed script sets its own theme or accent any more', ['strip/strip.js', 'table/table.js', 'game/game.js', 'merch/merch.js']
   .every(f => !/setProperty\('--ep-accent'|body\.setAttribute\('data-theme'|dataset\.theme = 'light'/.test(read('epinoia', 'embed', ...f.split('/')))));
ok('text in the accent uses its readable ink', /\.tm\.win \.abbr\{ color:var\(--ep-accent-ink, var\(--ep-accent\)\) \}/.test(css));
ok('the strip names its league bottom left, as a link', /id="leagueLink" hidden/.test(stripHtml) && /\.ep-league\{\s*position:absolute; left:12px; bottom:6px/.test(css));
ok('...to the league\'s own page, in the page on Epinoia and a new tab on a club\'s site',
   /new URL\('\.\.\/\.\.\/\?l=' \+ encodeURIComponent\(l\.slug\), location\.href\)/.test(stripJs) && /a\.target = ours \? '_top' : '_blank'/.test(stripJs));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
