/* ============================================================================
   STARS — the league page's podium moved into epinoia/stars.js, and HOME's
   best performing players across every league built on it (roadmap Phase 3).

   PARITY FIRST. fixtures/stars-bcb.json was captured from the live BCB league
   page BEFORE the move: home.js's own stars() lifted out of the file and run
   against the anon API, with its inputs (games, teams, box-score rows, player
   names) and its outputs (ids, order, BPM to 1 dp, the head rows and cards as
   markup, and the month's winner handed to merchandise). This runs the NEW
   home.js stars(), lifted the same way, on those rows offline, and every output
   has to come out the same.

   The saved player lines hold only the fifteen stat keys stars.js now asks the
   server for (the capture proved those reproduce the whole lines' numbers); the
   team lines are whole, and are served here through the same trimmed select the
   page now uses, so the trim on both is covered too.

   Then what only HOME does: leagues computed apart and merged, one row per
   player with his best BPM, a withheld minor dropped rather than drawn as
   "Player", the anchor query's filters, and the ten-minute cache.

     node supabase/tests/stars.test.mjs
   ============================================================================ */
process.env.TZ = 'Europe/London';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FX = JSON.parse(readFileSync(path.join(ROOT, 'supabase', 'tests', 'fixtures', 'stars-bcb.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- a DOM just big enough for the cards (the capture used the same one) ---- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.children = []; this._style = new Map(); this._ls = {};
    const self = this;
    this.style = { setProperty(k, v) { self._style.set(k, String(v)); }, getPropertyValue(k) { return self._style.get(k) || ''; } };
    this.classList = {
      _get() { return (self.attrs.get('class') || '').split(/\s+/).filter(Boolean); },
      _set(l) { self.attrs.set('class', l.join(' ')); },
      add(...c) { const l = this._get(); c.forEach(x => { if (!l.includes(x)) l.push(x); }); this._set(l); },
      remove(...c) { if (!self.attrs.has('class')) return; this._set(this._get().filter(x => !c.includes(x))); },
      contains(c) { return this._get().includes(c); },
      toggle(c, force) { const on = force === undefined ? !this.contains(c) : !!force; on ? this.add(c) : this.remove(c); return on; }
    };
  }
  set className(v) { this.attrs.set('class', String(v)); } get className() { return this.attrs.get('class') || ''; }
  set href(v) { this.attrs.set('href', String(v)); } get href() { return this.attrs.get('href'); }
  set type(v) { this.attrs.set('type', String(v)); }
  set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); } get hidden() { return this.attrs.has('hidden'); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  set textContent(v) { this.children = v == null || v === '' ? [] : [String(v)]; }
  get textContent() { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  appendChild(n) { this.children.push(n); return n; }
  append(...n) { n.forEach(x => this.children.push(x)); }
  addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); }
  click() { (this._ls.click || []).forEach(f => f({ target: this })); }
  querySelector() { return null; }
  get outerHTML() {
    const a = [...this.attrs].map(([k, v]) => ' ' + k + '="' + escA(v) + '"').join('');
    const st = this._style.size ? ' style="' + escA([...this._style].map(([k, v]) => k + ': ' + v + ';').join(' ')) + '"' : '';
    const t = this.tagName.toLowerCase();
    return '<' + t + a + st + '>' + this.children.map(c => typeof c === 'string' ? esc(c) : c.outerHTML).join('') + '</' + t + '>';
  }
}
globalThis.window = globalThis;
globalThis.document = { readyState: 'loading', addEventListener() {}, createElement: t => new El(t),
  querySelector: () => null, body: null, documentElement: new El('html') };

window.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
window.EpinoiaBPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
(0, eval)(readFileSync(path.join(ROOT, 'epinoia', 'teamcolour.js'), 'utf8'));
const ST = require(path.join(ROOT, 'epinoia', 'stars.js'));
window.EpinoiaStars = ST;

const IN = FX.inputs, OUT = FX.outputs;
const gameIdsIn = u => { const m = /game_id=in\.\(([^)]*)\)/.exec(u); return new Set(m ? m[1].split(',') : []); };

/* a row as the trimmed select returns it: stats folded out into s_ columns */
const aliased = (row, keys) => {
  const o = {};
  Object.keys(row).forEach(k => { if (k !== 'stats') o[k] = row[k]; });
  keys.forEach(k => { const v = row.stats ? row.stats[k] : undefined; o['s_' + k] = v === undefined ? null : v; });
  return o;
};

/* ============================================================ 1. PARITY === */
console.log('\nleague page parity (BCB, captured ' + FX.captured_at + ')');
{
  const home = readFileSync(path.join(ROOT, 'epinoia', 'home.js'), 'utf8');
  const a = home.indexOf('async function stars()');
  const b = home.indexOf('/* ------------------------------------------------------ the shop window', a);
  ok('home.js still has stars() before the shop window', a > 0 && b > a);
  const src = home.slice(a, b);
  ok('home.js draws the stars through EpinoiaStars', /ST\.render\(/.test(src) && /ST\.computeWindow\(/.test(src));
  ok('...and no longer asks statsForGames once per window', !/statsForGames/.test(src));

  const requests = [];
  const D = {
    all: async u => {
      requests.push(u);
      const ids = gameIdsIn(u);
      if (u.startsWith('player_game_stats')) {
        ok('player lines are asked for by the trimmed select', u.includes('select=' + ST.PLAYER_SEL));
        return IN.player_game_stats.filter(r => ids.has(r.game_id)).map(r => aliased(r, ST.PLAYER_KEYS));
      }
      if (u.startsWith('team_game_stats')) {
        ok('team lines are asked for by the trimmed select', u.includes('select=' + ST.TEAM_SEL));
        return IN.team_game_stats.filter(r => ids.has(r.game_id)).map(r => aliased(r, ST.TEAM_KEYS));
      }
      throw new Error('unexpected ' + u);
    },
    playerMeta: async ids => { requests.push('meta:' + ids.length); const o = {}; ids.forEach(id => { if (IN.meta[id]) o[id] = IN.meta[id]; }); return o; }
  };
  window.EpinoiaData = D;
  const api = async p => {
    requests.push(p);
    if (p.startsWith('games?')) return IN.games.slice();
    if (p.startsWith('teams?')) return IN.teams.slice();
    throw new Error('unexpected ' + p);
  };
  const host = new El('div');
  const sec = new El('section'); sec.querySelector = s => (s === '#stars' ? host : null);
  const $ = s => (s === '#starsSec' ? sec : null);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const run = new Function('D', '$', 'el', 'LEAGUE', 'api', 'leagueCompetitions',
    src + '\nreturn stars;');
  const stars = run(D, $, el, FX.league, api, async () => ['comp']);
  const star = await stars();

  const html = host.children.map(c => c.outerHTML);
  ok('the same number of blocks (head, podium, top ten) as before', html.length === OUT.html.length,
     html.length + ' vs ' + OUT.html.length);
  OUT.html.forEach((h, i) => ok('block ' + (i + 1) + ' markup is identical', html[i] === h,
    'got  ' + String(html[i]).slice(0, 240) + '\n          want ' + h.slice(0, 240)));

  /* ids, order and BPM from the module directly, window by window */
  OUT.windows.forEach(w => {
    const W = ST.WINDOWS.find(x => x.key === w.key);
    const ids = new Set(w.games);
    const games = IN.games.filter(g => ids.has(g.id));
    const agg = ST.computeWindow(IN.player_game_stats, IN.team_game_stats, games);
    const top = ST.pick(agg.players, W, 10);
    ok(w.key + ': the same ten players in the same order',
       JSON.stringify(top.map(p => p.id)) === JSON.stringify(w.ids));
    ok(w.key + ': the same BPM to one place',
       JSON.stringify(top.map(p => Number(p.bpm).toFixed(1))) === JSON.stringify(w.bpm),
       top.map(p => Number(p.bpm).toFixed(1)).join(',') + ' vs ' + w.bpm.join(','));
  });

  const merch = star ? Object.assign({}, star, { team: star.team ? star.team.id : null }) : null;
  ok("merchandise gets the same month's winner", JSON.stringify(merch) === JSON.stringify(OUT.merch),
     JSON.stringify(merch) + '\n          want ' + JSON.stringify(OUT.merch));

  const boxReqs = requests.filter(u => /_game_stats/.test(u));
  ok('one box-score fetch for both windows (one player and one team request)', boxReqs.length === 2, boxReqs.length + ' requests');
  ok('one playerMeta call for both windows', requests.filter(u => u.startsWith('meta:')).length === 1);

  /* THE TOGGLE. Ranks four to ten start hidden, the head opens and closes them. */
  const [head, , list] = host.children;
  ok('ranks four to ten start hidden', list.hidden === true);
  head.click();
  ok('the head opens them', list.hidden === false && head.classList.contains('open') &&
     head.children[2].getAttribute('aria-expanded') === 'true' && head.children[2].textContent === 'top 3');
  head.click();
  ok('...and closes them again', list.hidden === true && !head.classList.contains('open') && head.children[2].textContent === 'top 10');
}

/* ======================================================= 2. ACROSS LEAGUES === */
console.log('\nper league, then merged');
const monthW = ST.WINDOWS.find(w => w.key === 'month');
const LA = { id: 'la', slug: 'bcb', name: 'British Championship Basketball' };
const LB = { id: 'lb', slug: 'slb', name: 'Super League' };
/* league B: the same games and the same players under new game and team ids, with one
   player's scoring lifted so his B row beats his A row, and one player's cut so it does not */
const monthIds = new Set(OUT.windows.find(w => w.key === 'month').games);
const gamesA = IN.games.filter(g => monthIds.has(g.id)).map(g => Object.assign({}, g, { _lg: LA }));
const gamesB = gamesA.map(g => Object.assign({}, g, { id: g.id + '-b', home_team_id: g.home_team_id + '-b', away_team_id: g.away_team_id + '-b', _lg: LB }));
const upId = OUT.windows.find(w => w.key === 'month').ids[4];
const pgsB = IN.player_game_stats.filter(r => monthIds.has(r.game_id)).map(r => {
  const s = Object.assign({}, r.stats);
  if ((r.player_uuid || r.player_id) === upId) { s.pts = (s.pts || 0) + 12; s.ast = (s.ast || 0) + 4; }
  return Object.assign({}, r, { game_id: r.game_id + '-b', stats: s });
});
const tgsB = IN.team_game_stats.filter(r => monthIds.has(r.game_id)).map(r => Object.assign({}, r, { game_id: r.game_id + '-b' }));
const leagueOf = g => g._lg;

const aloneA = ST.computeWindow(IN.player_game_stats, IN.team_game_stats, gamesA, { leagueOf });
const both = ST.computeWindow(IN.player_game_stats.concat(pgsB), IN.team_game_stats.concat(tgsB), gamesA.concat(gamesB), { leagueOf });
const aRows = new Map(aloneA.players.map(p => [p.id, p]));
const bothA = both.players.filter(p => p._league === LA);
ok('league A computed beside league B gives exactly its own numbers (bpm, obpm, dbpm)',
   bothA.length === aloneA.players.length &&
   bothA.every(p => { const q = aRows.get(p.id); return q && q.bpm === p.bpm && q.obpm === p.obpm && q.dbpm === p.dbpm && q.ppg === p.ppg; }));
ok('every row is tagged with its league', both.players.every(p => p._league === LA || p._league === LB));
ok('a player in both leagues has a row in each before the pick',
   both.players.filter(p => p.id === upId).length === 2);

const merged = ST.pick(both.players, monthW, 10);
ok('after the pick each player appears once', new Set(merged.map(p => p.id)).size === merged.length);
const upRows = both.players.filter(p => p.id === upId);
const best = upRows.reduce((x, y) => (y.bpm > x.bpm ? y : x));
const kept = merged.find(p => p.id === upId);
ok('...with his best BPM row and that row\'s league', kept && kept.bpm === best.bpm && kept._league === LB,
   kept ? kept.bpm + ' ' + kept._league.id : 'not in the ten');
ok('the merged ten are in BPM order', merged.every((p, i) => i === 0 || merged[i - 1].bpm >= p.bpm));

/* the league tag on a card */
{
  const p = kept;
  const r = { meta: { [p.id]: { name: 'Test Player', slug: 'test-player' } }, teamsById: { [p._teamId]: { id: p._teamId, name: 'Club FC', colour: '#123456' } } };
  const c = ST.card(r, p, 0, false, { base: '../', league: p._league });
  ok('a HOME card opens the player page one folder up', c.getAttribute('href') === '../p/?p=test-player');
  const team = c.children[1].children[0].children[1].textContent;
  ok('a HOME card reads "Club · League"', team === 'Club FC · Super League', team);
  const r2 = Object.assign({}, r);
  const c2 = ST.card(r2, Object.assign({}, p, { _league: LA }), 0, false, { base: '../', league: LA });
  ok('a long league name goes by its initials', c2.children[1].children[0].children[1].textContent === 'Club FC · BCB');
  ok('...and the full name stays in the label', /British Championship Basketball/.test(c2.getAttribute('aria-label')));
}

/* ============================================================ 3. global() === */
console.log('\nHOME: global()');
{
  const store = new Map();
  globalThis.sessionStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const anchor = gamesA[0].tipoff_at;
  const withEmbed = g => Object.assign({}, g, { competition_id: 'c', competitions: { seasons: { leagues: g._lg } } });
  const allGames = gamesA.concat(gamesB).map(withEmbed).sort((x, y) => (x.tipoff_at < y.tipoff_at ? 1 : -1));
  const teamsAll = IN.teams.concat(IN.teams.map(t => Object.assign({}, t, { id: t.id + '-b' })));
  const minor = OUT.windows.find(w => w.key === 'month').ids[0];
  const seen = [];
  window.EpinoiaData = {
    get: async u => { seen.push(u); if (u.startsWith('games?select=tipoff_at')) return [{ tipoff_at: anchor }]; throw new Error(u); },
    all: async u => {
      seen.push(u);
      const ids = gameIdsIn(u);
      if (u.startsWith('games?')) return allGames;
      if (u.startsWith('player_game_stats')) return IN.player_game_stats.concat(pgsB).filter(r => ids.has(r.game_id)).map(r => aliased(r, ST.PLAYER_KEYS));
      if (u.startsWith('team_game_stats')) return IN.team_game_stats.concat(tgsB).filter(r => ids.has(r.game_id)).map(r => aliased(r, ST.TEAM_KEYS));
      if (u.startsWith('teams?')) { const m = /id=in\.\(([^)]*)\)/.exec(u); const s = new Set(m[1].split(',')); return teamsAll.filter(t => s.has(t.id)); }
      throw new Error(u);
    },
    /* the minor's row is withheld, as players_read does for an anonymous reader */
    playerMeta: async ids => { seen.push('meta:' + ids.length); const o = {}; ids.forEach(id => { if (id !== minor && IN.meta[id]) o[id] = IN.meta[id]; }); return o; }
  };

  const now = new Date('2026-09-17T09:00:00Z');
  const res = await ST.global({ base: '../', now });
  const aq = seen[0];
  ok('the anchor is the latest final with a competition, at or before now',
     /status=eq\.final/.test(aq) && /competition_id=not\.is\.null/.test(aq) &&
     aq.includes('tipoff_at=lte.' + encodeURIComponent(now.toISOString())) && /order=tipoff_at\.desc/.test(aq) && /limit=1/.test(aq));
  ok('the window games drop test games (competitions!inner)', seen.some(u => u.startsWith('games?') && /competitions!inner\(seasons!inner\(leagues!inner\(/.test(u)));
  ok('global returns both windows and the anchor', res.month && res.week && res.anchor === anchor);
  ok('names were asked for up to twenty a window, in one call', seen.filter(u => u.startsWith('meta:')).length === 1);
  ['month', 'week'].forEach(k => {
    const row = res[k];
    ok(k + ': ten players', row.top.length === 10, String(row.top.length));
    ok(k + ': the withheld minor is dropped, not drawn as "Player"', !row.top.some(p => p.id === minor));
    ok(k + ': every card has a name and a slug', row.top.every(p => row.meta[p.id] && row.meta[p.id].slug && row.meta[p.id].name !== 'Player'));
    ok(k + ': each player once', new Set(row.top.map(p => p.id)).size === row.top.length);
    ok(k + ': both leagues counted', row.leagues === 2);
  });

  const host = new El('div');
  ST.render(host, [res.month, res.week], { base: '../' });
  const out = host.children.map(c => c.outerHTML).join('');
  ok('rendered HOME rows link one folder up and carry the league', /href="\.\.\/p\/\?p=/.test(out) && / · (BCB|Super League)</.test(out));
  ok('no card is named Player', !/star-name">Player</.test(out));
  ok('the head says how many leagues', /· 2 leagues ·/.test(out));

  const before = seen.length;
  const again = await ST.global({ base: '../', now });
  const extra = seen.slice(before);
  ok('a second visit inside ten minutes makes no box-score request', extra.length === 1 && extra[0].startsWith('games?select=tipoff_at'), extra.join(' | '));
  ok('...and draws the same rows', JSON.stringify(again.month.top) === JSON.stringify(res.month.top) && again.week.w === ST.WINDOWS[1]);

  /* nothing final anywhere */
  window.EpinoiaData.get = async () => [];
  const none = await ST.global({ now });
  ok('no finals at all: no rows and no anchor', none.week === null && none.month === null && none.anchor === null);
}

/* ======================================================= 4. HOME's section === */
console.log('\nHOME: stars-home.js and stars.css');
{
  const sh = readFileSync(path.join(ROOT, 'epinoia', 'home', 'stars-home.js'), 'utf8');
  ok("stars-home.js registers 'stars'", /register\(\s*'stars'/.test(sh));
  ok('...through EpinoiaStars.global with the page base', /\.global\(\s*\{\s*base:\s*ctx\.base/.test(sh));
  ok('...and says so when no league has finals in the window', /class(Name)?[^\n]*empty/.test(sh) || /'empty'/.test(sh));
  const css = readFileSync(path.join(ROOT, 'epinoia', 'home', 'stars.css'), 'utf8');
  ok('the top-ten list stays closed on a phone ([hidden] wins in stars.css)', /\.starmore\[hidden\]\{display:none( !important)?\}/.test(css));
  ok('the phone rails snap card to card', /scroll-snap-type:x mandatory/.test(css));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
