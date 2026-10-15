/* ============================================================================
   epinoia/seasonbar.js — which seasons a reader is offered, which one they
   land on, and what a chip does when it is clicked.

   The three cases are the ones the platform actually has on 18 September 2026
   and the ones a backfill will make:

     a season drawn but not played   every league on the platform today: a full
                                     fixture list, not one result. It must be
                                     OFFERED and it must be the DEFAULT — a
                                     rule that asked "has it started?" would
                                     open every league on last season for the
                                     whole of September.
     a season with nothing in it     a competition row with no fixtures under
                                     it (BCB carries one, left by an old feed).
                                     A chip for it leads nowhere.
     older seasons                   offered, newest first, reachable by ?s=
                                     under the name a person would write.

     node supabase/tests/seasonbar.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EP = path.join(HERE, '..', '..', 'epinoia');
/* data.js owns the ?s= matching rule, and seasonbar.js delegates to it rather
   than keeping a second copy — so the page's own resolver is what is tested. */
globalThis.window = { EpinoiaData: require(path.join(EP, 'data.js')) };
const SB = require(path.join(EP, 'seasonbar.js'));

let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  — saw ' + JSON.stringify(saw))); }
};
const eq = (what, a, b) => ok(what, JSON.stringify(a) === JSON.stringify(b), a);

/* ---------------------------------------------------------------- fixture ---
   A league with four seasons: two played, this one drawn but not played, and
   one whose only competition never had a fixture filed under it. */
const SEASONS = [
  { id: 's27', name: '2027-28', starts_on: '2027-09-01' },   // rows, no games
  { id: 's26', name: '2026-27', starts_on: '2026-09-01' },   // drawn, not played
  { id: 's25', name: '2025-26', starts_on: '2025-09-01' },
  { id: 's24', name: '2024-25', starts_on: '2024-09-01' }
];
const COMPS = [
  { id: 'c27', season_id: 's27', name: 'Championship 2027-28', kind: 'league' },
  { id: 'c26', season_id: 's26', name: 'Championship 2026-27', kind: 'league' },
  { id: 'k26', season_id: 's26', name: 'Cup 2026-27', kind: 'cup' },
  { id: 'c25', season_id: 's25', name: 'Championship 2025-26', kind: 'league' },
  { id: 'c24', season_id: 's24', name: 'Championship 2024-25', kind: 'league' }
];
/* c27 is missing on purpose: entries without a fixture are not a season */
const HAS_GAMES = new Set(['c26', 'k26', 'c25', 'c24']);

/* Since 2026-10-15 (4b9fbbb15) a league is read WITH its seasons, their
   competitions and a one-row games probe each, as PostgREST embeds — one
   request where there were four. The embedded shape, as PostgREST returns it:
   each season carries `competitions`, each competition `games` (at most one). */
const embedded = played => SEASONS.map(s => Object.assign({}, s, {
  competitions: COMPS.filter(c => c.season_id === s.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => Object.assign({}, c, { games: played(c.id) ? [{ id: 'g-' + c.id }] : [] }))
}));
const EMBED_ASK = /competitions\(/;

/* the three requests the embed falls back to (an API that refuses the embed) */
const plain = (asked, leagueRow, played) => async p => {
  asked.push(p);
  if (EMBED_ASK.test(p)) throw new Error('embed refused');
  if (p.startsWith('leagues?')) return [Object.assign({}, leagueRow)];
  if (p.startsWith('seasons?')) return SEASONS.slice();
  if (p.startsWith('competitions?')) return COMPS.slice();
  if (p.startsWith('games?')) {
    const ids = (p.match(/in\.\(([^)]*)\)/) || [])[1].split(',');
    return ids.some(played) ? [{ id: 'g1' }] : [];
  }
  throw new Error('unexpected ' + p);
};

const asked = [];
const api = async p => {
  asked.push(p);
  if (p.startsWith('leagues?')) {
    const row = { id: 'lg', slug: 'demo-league', name: 'Demo League' };
    if (EMBED_ASK.test(p)) row.seasons = embedded(id => HAS_GAMES.has(id));
    return [row];
  }
  if (p.startsWith('seasons?') && EMBED_ASK.test(p)) return embedded(id => HAS_GAMES.has(id));
  if (p.startsWith('seasons?')) return SEASONS.slice();
  if (p.startsWith('competitions?')) return COMPS.slice();
  if (p.startsWith('games?')) {
    const ids = (p.match(/in\.\(([^)]*)\)/) || [])[1].split(',');
    return ids.some(id => HAS_GAMES.has(id)) ? [{ id: 'g1' }] : [];
  }
  throw new Error('unexpected ' + p);
};

/* ------------------------------------------------------------- 1. the read --- */
console.log('\n1. what the control offers');
const ctx = await SB.context(api, 'demo-league');

eq('the seasons with games in them, newest first',
   ctx.seasons.map(s => s.name), ['2026-27', '2025-26', '2024-25']);
ok('a season whose competitions have no fixtures is not offered',
   !ctx.seasons.some(s => s.id === 's27'));
eq('the current season is the default, although not a game has been played',
   ctx.season.name, '2026-27');
eq('...and its competitions come back with it, so changing season costs no read',
   ctx.comps.map(c => c.id), ['c26', 'k26']);
eq('?s= lands on the season a person would have typed',
   (await SB.context(api, 'demo-league', '2024/25')).season.name, '2024-25');
eq('...and an unknown one lands on the current season rather than an error',
   (await SB.context(api, 'demo-league', 'nonsense')).season.name, '2026-27');

/* The whole history comes with the league: one request, its games probe one
   row per competition rather than a season's worth of games to count them. */
ok('the league, its seasons, their competitions and the probes are one request',
   asked.length > 0 && asked.every(p => p.startsWith('leagues?')), asked);
ok('...the probe asks for a single game per competition',
   /seasons\.competitions\.games\.limit=1/.test(asked[0]) && /games\(id\)/.test(asked[0]), asked[0]);
ok('a second caller on the same page shares the answer rather than repeating it',
   !asked.some(p => p.startsWith('seasons?') || p.startsWith('competitions?') || p.startsWith('games?')), asked);
{
  /* a page that already holds its league row (load(), not context()) asks for
     the seasons embedded, once */
  const a2 = [];
  const o = await SB.load(async p => { a2.push(p); return embedded(id => HAS_GAMES.has(id)); }, 'lg-load');
  eq('load(): the same offer from one embedded seasons read', o.list.map(s => s.name), ['2026-27', '2025-26', '2024-25']);
  ok('...asked once, seasons with competitions and probes', a2.length === 1 && /^seasons\?/.test(a2[0]) && EMBED_ASK.test(a2[0]), a2);
}

/* An API that refuses the embed: the three requests, answering the same. */
{
  const a3 = [];
  const old = plain(a3, { id: 'lg-old', slug: 'old-league', name: 'Old League' }, id => HAS_GAMES.has(id));
  const c3 = await SB.context(old, 'old-league');
  eq('refused embed: the same seasons, newest first', c3.seasons.map(s => s.name), ['2026-27', '2025-26', '2024-25']);
  eq('...the same default', c3.season.name, '2026-27');
  eq('...the same competitions with it', c3.comps.map(c => c.id), ['c26', 'k26']);
  const plainReads = a3.filter(p => !EMBED_ASK.test(p));
  ok('...one seasons read and one competitions read for every season',
     plainReads.filter(p => p.startsWith('seasons?')).length === 1
     && plainReads.filter(p => p.startsWith('competitions?')).length === 1, a3);
  ok('...and the games probe asks for a single row', plainReads.filter(p => p.startsWith('games?'))
     .every(p => /select=id&limit=1/.test(p)), plainReads.filter(p => p.startsWith('games?')));
}

/* ------------------------------------------------------- 2. nothing played --- */
console.log('\n2. a league whose games cannot be read (members only, or brand new)');
{
  const shut = async p => {
    /* the games are refused, so every embedded probe comes back empty */
    if (p.startsWith('leagues?')) {
      const row = { id: 'lg2', slug: 'shut', name: 'Shut' };
      if (EMBED_ASK.test(p)) row.seasons = embedded(() => false);
      return [row];
    }
    if (p.startsWith('seasons?')) return SEASONS.slice();
    if (p.startsWith('competitions?')) return COMPS.slice();
    return [];                      // every probe comes back empty
  };
  const c = await SB.context(shut, 'shut');
  eq('the page still has a season to name', c.season.name, '2027-28');
  eq('...and exactly one, so the control hides itself', c.seasons.length, 1);
}

/* ----------------------------------------------------------- 3. the chips --- */
console.log('\n3. the row, and what a click does');
{
  /* the smallest document these chips need */
  const node = (tag) => {
    const n = { tag, kids: [], attrs: {}, on: {}, style: {}, hidden: false, _text: '' };
    n.ownerDocument = doc;
    n.appendChild = k => { n.kids.push(k); return k; };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.addEventListener = (t, fn) => { (n.on[t] = n.on[t] || []).push(fn); };
    n.click = () => (n.on.click || []).forEach(fn => fn({ preventDefault() {} }));
    Object.defineProperty(n, 'textContent', {
      get() { return n._text; }, set(v) { n._text = v == null ? '' : String(v); n.kids.length = 0; }
    });
    return n;
  };
  const doc = { createElement: node };
  const host = node('div'), wrap = node('div');

  let picked = null;
  const drawn = SB.mount({
    host, wrap, seasons: ctx.seasons, season: ctx.season,
    base: 'https://x/epinoia/l/?l=demo-league&c=c26#leaders',
    onPick: sn => { picked = sn; }
  });

  ok('the row is drawn', drawn === true);
  eq('one chip per season, newest first', host.kids.map(k => k.textContent),
     ['2026-27', '2025-26', '2024-25']);
  eq('the season being shown is the lit one',
     host.kids.map(k => k.className.includes(' on')), [true, false, false]);
  ok('the chips are LINKS, so a season can be copied or opened in a new tab',
     host.kids.every(k => k.tag === 'a' && typeof k.href === 'string'));
  eq('...and the link carries the season by name, on the page it is on',
     host.kids[1].href, '/epinoia/l/?l=demo-league&s=2025-26#leaders');
  ok('...with the competition dropped, because a phase belongs to one season',
     !host.kids[1].href.includes('c=c26'));

  host.kids[1].click();
  eq('clicking one hands the page that season', picked && picked.name, '2025-26');
  eq('...with the competitions to redraw from', picked && picked.comps.map(c => c.id), ['c25']);

  /* one season is not a choice */
  const solo = node('div'), soloWrap = node('div');
  const none = SB.mount({ host: solo, wrap: soloWrap, seasons: [ctx.season], season: ctx.season });
  ok('a league with one season gets no control at all',
     none === false && solo.kids.length === 0 && soloWrap.style.display === 'none');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
