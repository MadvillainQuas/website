/* ============================================================================
   WHAT A PHONE CAN ACTUALLY READ — the three reading requests of 2026-09-18.

     1. the league homepage's games rows show the club's letters on a phone, not
        two letters of its name and a full stop (home.js teamName + initials.js,
        the fixture query, and the width the stylesheet swaps them at)
     2. the news cards take the whole row on a phone: one card, a headline at
        16px, a standfirst, and a byline that is not cut in half (kit/news.css)
     3. "leagues ›" in the phone's menu sheet moves the rail along; it does not
        throw the reader out of the menu (nav.js)

     node supabase/tests/phone-reading.test.mjs
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

/* a stylesheet's rules, with the comments taken out and whitespace flattened */
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
/* every @media block, braces counted rather than guessed: { query, body, at } in source order,
   plus the stylesheet with all of them taken out (the rules that apply at any width) */
const atMedia = css => {
  const out = [];
  let base = '', from = 0, at;
  while ((at = css.indexOf('@media', from)) >= 0) {
    let i = css.indexOf('{', at), depth = 0, start = i + 1;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && !--depth) break;
    }
    if (i >= css.length) break;
    out.push({ query: css.slice(at + 6, start - 1).trim(), body: css.slice(start, i), at });
    base += css.slice(from, at);
    from = i + 1;
  }
  return { blocks: out, base: base + css.slice(from) };
};
/* the block at this width that is about `needle` — a page can have several at the same width */
const media = (css, query, needle) => {
  const hits = atMedia(css).blocks.filter(b => b.query === query &&
    (needle == null || b.body.includes(needle)));
  return hits.length ? hits[hits.length - 1].body : '';
};
const noMedia = css => atMedia(css).base;
/* what a selector is given inside a block (the last declaration of that property wins) */
const decl = (block, selector, prop) => {
  const re = new RegExp('(^|[},])\\s*([^{}]*?' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '[^{}]*?)\\{([^{}]*)\\}', 'g');
  let m, out = null;
  while ((m = re.exec(block))) {
    const hit = m[2].split(',').some(s => s.trim() === selector);
    if (!hit) continue;
    const p = new RegExp(prop + '\\s*:\\s*([^;}]+)').exec(m[3]);
    if (p) out = p[1].trim();
  }
  return out;
};

/* ------------------------------------------------ 1. the clubs' letters --- */
console.log('\n1. a club\'s letters in a fixture row');
{
  const home = rd('epinoia', 'home.js');

  /* teamName run for real, against a fake document, so this is its behaviour and not its text */
  const src = home.slice(home.indexOf('function teamName(team) {'), home.indexOf('function monogram(t) {'));
  ok('teamName is where it was', /^function teamName\(team\) \{/.test(src) && src.length < 1400, src.length);
  const node = (t, c, x) => {
    const n = { tag: t, text: x == null ? '' : String(x), kids: [], attrs: {}, cls: new Set() };
    if (c) String(c).split(/\s+/).filter(Boolean).forEach(k => n.cls.add(k));
    n.appendChild = k => { n.kids.push(k); return k; };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.classList = { add: k => n.cls.add(k), contains: k => n.cls.has(k) };
    return n;
  };
  const run = (team, o) => {
    const opt = o || {};
    const wanted = [];
    const ctx = {
      console, String,
      el: node,
      monogram: t => (t.short_name || '').slice(0, 3).toUpperCase() || 'ZZZ',
      LEAGUE: opt.league === undefined ? { id: 'lg1' } : opt.league,
      window: { EpinoiaInitials: opt.initials === undefined
        ? { code: t => (t.id === 'h1' ? 'YOR' : ''), want: id => wanted.push(id) }
        : opt.initials }
    };
    vm.createContext(ctx);
    vm.runInContext(src + '\nglobalThis.__out = teamName(' + JSON.stringify(team) + ');', ctx);
    return { out: ctx.__out, wanted };
  };

  const home1 = { id: 'h1', name: 'Yorkshire Dragons', short_name: 'YKD' };
  const r = run(home1);
  const full = r.out.kids.find(k => k.cls.has('full'));
  const short = r.out.kids.find(k => k.cls.has('short'));
  ok('both are written: the name, and the letters', !!full && !!short && r.out.kids.length === 2);
  eq('the name is written in full', full.text, 'Yorkshire Dragons');
  eq('the letters are the league\'s own code for that club', short.text, 'YOR');
  ok('and it is marked as one, so the stylesheet can space it', short.cls.has('is-code'));
  eq('the row still carries the full name for anyone who cannot see either', r.out.title, 'Yorkshire Dragons');
  eq('the club is keyed by id, which is how initials.js fills it in later',
     short.attrs['data-initials-team'], 'h1');
  eq('the league\'s letters are asked for', r.wanted, ['lg1']);

  const away = run({ id: 'a1', name: 'Derby Trailblazers', short_name: 'DTB' });
  eq('a club with no code yet falls back to its short name, never to nothing',
     away.out.kids.find(k => k.cls.has('short')).text, 'DTB');
  ok('...and is not passed off as a code', !away.out.kids.find(k => k.cls.has('short')).cls.has('is-code'));

  const none = run({ name: 'Placeholder' }, { initials: null });
  ok('a placeholder club with no id asks nothing and is still drawn',
     !none.wanted.length && none.out.kids.length === 2);
  eq('a missing club is a dash, not "undefined"', run({}, { initials: null }).out.kids[0].text, '—');
  ok('no league on the page asks for no letters', !run(home1, { league: null }).wanted.length);

  /* the query: without the club's id there is nothing for initials.js to key on */
  ok('the fixture query reads the clubs\' ids', /home:home_team_id\(id,name,short_name,colour,logo_path\),away:away_team_id\(id,name,short_name,colour,logo_path\)/.test(home));
  ok('every fixture row is built by teamName', (home.match(/teamName\(g\.(home|away)\)/g) || []).length === 4);

  /* the width the two are swapped at */
  const page = rd('epinoia', 'index.html');
  const css = strip(page.slice(page.indexOf('<style'), page.lastIndexOf('</style>')));
  const phone = media(css, '(max-width:560px)', '.fx .tn .full');
  ok('there is a phone block for the fixture rows', phone.length > 0);
  eq('above it the name is shown', decl(noMedia(css), '.fx .tn .short', 'display'), 'none');
  eq('on a phone the name gives way', decl(phone, '.fx .tn .full', 'display'), 'none');
  eq('...to the letters', decl(phone, '.fx .tn .short', 'display'), 'inline');
  ok('the letters are spaced as a scoreboard spaces them', /letter-spacing/.test(phone));
  ok('the row is set out for two short names and a score',
     /\.fx\{[^}]*grid-template-columns:1fr auto 1fr 54px 26px/.test(phone));
  ok('and they are big enough to read', (() => {
    const s = decl(phone, '.fx .tn', 'font-size');
    return s && parseFloat(s) >= 15;
  })(), decl(phone, '.fx .tn', 'font-size'));
  ok('the page loads initials.js', /<script src="initials\.js\?v=\d+" defer><\/script>/.test(page));
  ok('...before the scripts that paint with it', page.indexOf('initials.js') < page.indexOf('stars.js'));
}

/* ------------------------------------------------------ 2. the news cards --- */
console.log('\n2. the news cards on a phone');
{
  const css = strip(rd('epinoia', 'kit', 'news.css'));
  const phone = media(css, '(max-width:560px)');
  ok('there is a phone block', phone.length > 0);
  eq('every card takes the whole row', decl(phone, '.news-grid > .news-card', 'grid-column'), '1 / -1');
  eq('...the lead one included, so none is half a row on its own',
     decl(phone, '.news-grid > .news-card:first-child', 'grid-column'), '1 / -1');
  ok('a headline a reader can read across a room', (() => {
    const s = decl(phone, '.news-title', 'font-size');
    return s && parseFloat(s) >= 16;
  })(), decl(phone, '.news-title', 'font-size'));
  ok('the lead card is not made smaller than the rest', (() => {
    const lead = decl(phone, '.news-card:first-child .news-title', 'font-size');
    return !lead || parseFloat(lead) >= parseFloat(decl(phone, '.news-title', 'font-size'));
  })());
  eq('three lines of it, not two', decl(phone, '.news-title', '-webkit-line-clamp'), '3');
  eq('the standfirst comes back now there is room for it',
     decl(phone, '.news-grid > .news-card .news-stand', 'display'), '-webkit-box');
  ok('a match report keeps its standfirst off — the headline is the score',
     decl(phone, '.news-card.match .news-stand', 'display') === 'none');
  ok('the picture is a picture, not a stripe', (() => {
    const a = decl(phone, '.news-card .club-plate', 'aspect-ratio');
    if (!a) return false;
    const [w, h] = a.split('/').map(Number);
    return w / h <= 1.7;
  })(), decl(phone, '.news-card .club-plate', 'aspect-ratio'));
  ok('the byline and the date are given their own size, so neither is cut',
     !!decl(phone, '.news-card .club-name', 'font-size') && !!decl(phone, '.news-card .club-ed', 'font-size'));
  ok('a phone\'s block comes after the tablet\'s, so it is the one that applies',
     css.lastIndexOf('@media (max-width:560px)') > css.lastIndexOf('@media (max-width:720px)'));

  /* between 560 and 720 the cards pair up rather than going three across */
  const tablet = media(css, '(max-width:720px)');
  eq('two across on a small tablet', decl(tablet, '.news-grid > .news-card', 'grid-column'), 'span 3');
  eq('with the lead one across the top', decl(tablet, '.news-grid > .news-card:first-child', 'grid-column'), 'span 6');
  ok('and a headline bigger than the 11px it was', (() => {
    const s = decl(tablet, '.news-title', 'font-size');
    return s && parseFloat(s) >= 13;
  })(), decl(tablet, '.news-title', 'font-size'));
}

/* ------------------------------------------------------- 3. the menu rail --- */
console.log('\n3. "leagues ›" moves the rail');
{
  const nav = rd('epinoia', 'nav.js');
  ok('the row says what it is: a step through the menu, not a way out of it',
     /leaguesRow\.dataset\.railMove = '1';/.test(nav));
  ok('and it is still an anchor with somewhere to go without JavaScript',
     /const leaguesRow = el\('a', 'item'\);[\s\S]{0,120}leaguesRow\.href = root \+ 'home\/#leagues';/.test(nav));
  ok('tapping it moves the rail rather than following the link',
     /leaguesRow\.addEventListener\('click'[\s\S]{0,300}e\.preventDefault\(\);\s*setView\(country === null \? 'country' : 'root', true\);/.test(nav));

  /* the closer's own rule, run rather than read: which taps shut the sheet */
  const cond = /if \(a && nav\.contains\(a\) && ([^)]*?)\) \{/.exec(nav);
  ok('the closer has one rule about which links close the sheet', !!cond, nav.slice(nav.indexOf('drawer-open') , 0));
  const closes = a => {
    const ctx = { a, out: null };
    vm.createContext(ctx);
    vm.runInContext('out = !!(' + cond[1] + ');', ctx);
    return ctx.out;
  };
  ok('a league\'s front page still closes it — that tap goes somewhere', closes({ dataset: {} }));
  ok('"leagues ›" does not: the rail slides to the countries and the menu stays open',
     !closes({ dataset: { railMove: '1', leaguesRow: '1' } }));
  ok('the clubs row and the clubs tab are left alone as they always were',
     !closes({ dataset: { teamsRow: '1' } }) && !closes({ dataset: { teamsTab: '1' } }));

  /* the country rows below it are buttons, so the closer never sees them at all */
  ok('a country row is a button, not a link', /const row = el\('button', 'item crow'/.test(nav));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
