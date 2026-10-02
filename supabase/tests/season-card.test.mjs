/* ============================================================================
   THE CLUB'S SEASON CARD, ONE COMPETITION AT A TIME (t/team.js record / drawRec / recLinked, kit/clubhero.css; 2026-10-02).

     node supabase/tests/season-card.test.mjs

   Liverpool's card read 0-0, rank 3, while the club stood at 0-2: it took the first standings row of any competition
   (limit 1), and Liverpool has three 2026-27 rows (the Championship, the Cup and an empty "Super League Basketball Men").
   What is held here, on the card's own code run against Liverpool's and London Lions' shapes:
     * a button for each competition of the season the club has a game in, named as a reader names it (SLB, SLB Cup,
       EuroCup: seasonbar.js compLabels); none for a competition with no game; one competition is named, not a button;
     * the default is the competition with the most finished games, a league before a cup;
     * the numbers are the competition's table, and where the table has no row or has not caught up with the finished
       games, the games themselves (no rank then); rank, win% and streak are dashes before a game;
     * a linked side's competitions of the same season are added when it is the same squad (two shared players at
       least, a third of the smaller squad) -- London Lions' EuroCup side, not its Division One side, nor a women's side;
     * the season line stays across the top, and the stylesheet lays the buttons under it.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d).slice(0, 400) : '')); } };

const TJS = rd('epinoia', 't', 'team.js'), CSS = rd('epinoia', 'kit', 'clubhero.css');
const from = TJS.indexOf('const REC = { cards: [], at: null, chosen: false };');
const to = TJS.indexOf('/* ------------------------------------------------------------ team stats --- */');
ok('the card\'s code is where this test looks for it', from > 0 && to > from);
const BLOCK = TJS.slice(from, to);

/* ---- a small stand-in for the page ---- */
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.own = ''; this.dataset = {}; this.attrs = {}; this.parent = null;
    const n = this; this.classList = { add: (...c) => c.forEach(x => { if (!n.has(x)) n.className = (n.className + ' ' + x).trim(); }),
      remove: (...c) => { n.className = n.className.split(/\s+/).filter(x => c.indexOf(x) < 0).join(' '); }, contains: x => n.has(x) }; }
  has(c) { return this.className.split(/\s+/).indexOf(c) >= 0; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  get firstChild() { return this.children[0] || null; }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  all(pred) { return [].concat(pred(this) ? [this] : [], ...this.children.map(c => c.all(pred))); }
}
const REC_HOST = new Node('div');

/* ---- the data: the Liverpool and London Lions of 2026-10-02 ---- */
const SLB = { name: 'Super League Basketball Men', slug: 'slb-men', initials: null };
const LIV = 'liv', LON = 'lon', EURO = 'lon-euro', D1 = 'lon-d1', WOMEN = 'lon-w';
const g = (comp, status, day, home, away, hs, as) => ({ competition_id: comp, status, tipoff_at: '2026-' + day + 'T18:00:00Z',
  home_team_id: home, away_team_id: away, home_score: hs, away_score: as });
const GAMES = {
  [LIV]: [g('champ', 'final', '09-20', 'cal', LIV, 78, 73), g('champ', 'final', '09-27', LON, LIV, 78, 49),
          g('champ', 'scheduled', '10-04', 'man', LIV, 0, 0), g('cup', 'scheduled', '01-08', 'x', LIV, 0, 0)],
  [LON]: [g('champ', 'final', '09-20', LON, 'a', 90, 70), g('champ', 'final', '09-27', LON, LIV, 78, 49)],
  [EURO]: [g('euro', 'final', '09-30', 'b', EURO, 74, 71)],
  [D1]: [g('d1', 'final', '09-26', D1, 'c', 80, 60)],
  [WOMEN]: [g('slbw', 'final', '09-26', WOMEN, 'd', 80, 60)]
};
const STANDINGS = {
  [LIV]: [{ competition_id: 'placeholder', gp: 0, w: 0, l: 0, pts_for: 0, pts_against: 0, diff: 0, rank: 3, streak: '' },
          { competition_id: 'champ', gp: 2, w: 0, l: 2, pts_for: 122, pts_against: 156, diff: -34, rank: 10, streak: 'L2' },
          { competition_id: 'cup', gp: 0, w: 0, l: 0, pts_for: 0, pts_against: 0, diff: 0, rank: 7, streak: '' }],
  [LON]: [{ competition_id: 'champ', gp: 2, w: 2, l: 0, pts_for: 168, pts_against: 119, diff: 49, rank: 1, streak: 'W2' }],
  [EURO]: [{ competition_id: 'euro', gp: 1, w: 0, l: 1, pts_for: 71, pts_against: 74, diff: -3, rank: 20, streak: 'L1' }],
  [D1]: [], [WOMEN]: []
};
const COMP_EMBED = {
  euro: { id: 'euro', name: 'EuroCup', kind: 'league', seasons: { name: '2026-27', leagues: { name: 'EuroCup', slug: 'eurocup', initials: null } } },
  d1: { id: 'd1', name: 'NBL Division One 26-27', kind: 'league', seasons: { name: '2026-27', leagues: { name: 'NBL Division One', slug: 'nbl-d1', initials: null } } },
  slbw: { id: 'slbw', name: 'Championship 26-27', kind: 'league', seasons: { name: '2026-27', leagues: { name: 'Super League Basketball Women', slug: 'slb-women', initials: null } } }
};
/* the season's players: the EuroCup side is the SLB squad (its profiles linked to theirs), the D1 side another squad */
const PLAYERS = { [LON]: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], [EURO]: ['e1', 'e2', 'e3', 'e4', 'e9'], [D1]: ['d1', 'd2', 'd3', 'd4', 'd5'] };
const GROUP = { p1: 'G1', e1: 'G1', p2: 'G2', e2: 'G2', p3: 'G3', e3: 'G3', p4: 'G4', e4: 'G4' };
const asked = [];
function inList(q, key) { const m = new RegExp(key + '=in\\.\\(([^)]*)\\)').exec(q); return m ? m[1].split(',') : null; }
async function api(q) {
  asked.push(q);
  const team = (/team_id=eq\.([\w-]+)/.exec(q) || /home_team_id\.eq\.([\w-]+)/.exec(q) || [])[1];
  if (q.startsWith('games?')) {
    let rows = (GAMES[team] || []).slice();
    const comps = inList(q, 'competition_id');
    if (comps) rows = rows.filter(r => comps.indexOf(r.competition_id) >= 0);
    if (/competitions\(/.test(q)) rows = rows.map(r => Object.assign({}, r, { competitions: COMP_EMBED[r.competition_id] ||
      { id: r.competition_id, name: r.competition_id, kind: r.competition_id === 'cup' ? 'cup' : 'league', season_id: 'S26' } }));
    return rows;
  }
  if (q.startsWith('standings?')) { const comps = inList(q, 'competition_id') || []; return (STANDINGS[team] || []).filter(r => comps.indexOf(r.competition_id) >= 0); }
  if (q.startsWith('player_season_stats?')) return (PLAYERS[team] || []).map(player_id => ({ player_id }));
  if (q.startsWith('player_group_members?')) return (inList(q, 'player_id') || []).filter(id => GROUP[id]).map(id => ({ player_id: id, group_id: GROUP[id] }));
  throw new Error('unexpected read ' + q);
}

function page(o) {
  const sandbox = { console: { warn: () => {}, log: console.log }, window: {}, document: { createElement: t => new Node(t), querySelector: s => (s === '#rec' ? REC_HOST : null) } };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'seasonbar.js'), ctx, { filename: 'seasonbar.js' });
  sandbox.window.EpinoiaSeasonBar = sandbox.EpinoiaSeasonBar;
  REC_HOST.textContent = ''; REC_HOST.className = '';
  vm.runInContext(`
    const $ = s => document.querySelector(s);
    const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    const seasonText = n => window.EpinoiaSeasonBar.label(n);
    const KIND_LABEL = { league: 'League', cup: 'Cup', trophy: 'Trophy', playoff: 'Playoffs', friendly: 'Friendlies' };
    let ACCESS = { paywall: false };
    let SEASON_LABEL = ${JSON.stringify(o.label === undefined ? '2026/27' : o.label)};
    let SEASON_ROW = ${JSON.stringify(o.row === undefined ? null : o.row)};
    let LINKED_T = ${o.linked ? 'Promise.resolve(' + JSON.stringify({ linked: o.linked }) + ')' : 'null'};
    ${BLOCK}
    this.__card = { REC, record, drawRec, recFromGames, sameSquad, recLinked };`, ctx, { filename: 'team.js (the card)' });
  sandbox.api = api;
  return sandbox.__card;
}
const cells = () => { const o = {}; REC_HOST.children.forEach(c => { if (c.dataset.k && c.children[0] && c.children[1]) o[c.dataset.k] = c.children[0].textContent; }); return o; };
const buttons = () => REC_HOST.all(n => n.has && n.has('rec-c')).map(b => (b.has('on') ? '*' : '') + b.textContent + (b.tag === 'span' ? '(name)' : ''));
const press = label => { const b = REC_HOST.all(n => n.has && n.has('rec-c') && n.textContent === label)[0]; if (b && b.onclick) b.onclick(); return !!b; };
const settle = () => new Promise(r => setTimeout(r, 0));
const SEASON = { id: 'S26', name: '2026-27', comps: [
  { id: 'placeholder', name: 'Super League Basketball Men', kind: 'league' }, { id: 'champ', name: 'Championship 26-27', kind: 'league' },
  { id: 'cup', name: 'Cup 26-27', kind: 'cup' }] };

console.log('Liverpool: three competitions in the season, two with games');
{
  const C = page({ row: SEASON });
  await C.record({ id: LIV, leagues: SLB });
  ok('a button for each competition with a game, named as a reader names it; the empty placeholder has none',
     buttons().join(' | ') === '*SLB | SLB Cup', buttons());
  const c = cells();
  ok('the Championship by default (the most finished games): 0-2, rank 10, L2, the table\'s own figures',
     c.record === '0-2' && c.rank === '10' && c.streak === 'L2' && c['pts-for'] === '122' && c['pts-against'] === '156' && c.diff === '-34', c);
  ok('...the season line across the top, then the buttons', REC_HOST.children[0].dataset.k === 'season' && REC_HOST.children[1].dataset.k === 'comps' &&
     REC_HOST.has('has-season') && REC_HOST.has('has-comps'));
  ok('...never one standings row of any competition (limit 1)', !asked.some(q => /standings\?.*limit=1/.test(q)) &&
     asked.some(q => /^standings\?team_id=eq\.liv&competition_id=in\.\((champ,cup|cup,champ)\)/.test(q)), asked.filter(q => /standings/.test(q)));
  press('SLB Cup');
  const k = cells();
  ok('pressing SLB Cup: its own figures, and before a game no rank, win% or streak',
     buttons().join(' | ') === 'SLB | *SLB Cup' && k.record === '0-0' && k.rank === '—' && k['win%'] === '—' && k.streak === '—', [buttons(), k]);
}

console.log('\nthe table behind, or missing');
{
  STANDINGS[LIV][1] = Object.assign({}, STANDINGS[LIV][1], { gp: 1, w: 0, l: 1, pts_for: 73, pts_against: 78, diff: -5, streak: 'L1' });
  const C = page({ row: SEASON });
  await C.record({ id: LIV, leagues: SLB });
  const c = cells();
  ok('a table that has not caught up with the finished games: the games themselves, and no rank',
     c.record === '0-2' && c['pts-for'] === '122' && c['pts-against'] === '156' && c.diff === '-34' && c.streak === 'L2' && c.rank === '—', c);
  STANDINGS[LIV][1] = Object.assign({}, STANDINGS[LIV][1], { gp: 2, w: 0, l: 2, pts_for: 122, pts_against: 156, diff: -34, streak: 'L2' });
  const r = C.recFromGames([g('k', 'final', '01-01', 'me', 'x', 80, 70), g('k', 'final', '01-08', 'x', 'me', 60, 65), g('k', 'final', '01-15', 'me', 'x', 50, 70),
                             g('k', 'scheduled', '01-20', 'me', 'x', 0, 0)], 'me');
  ok('...from the games: wins, losses, points both ways, the streak at the end', r.w === 2 && r.l === 1 && r.pts_for === 195 && r.pts_against === 200 &&
     r.diff === -5 && r.streak === 'L1' && r.gp === 3 && r.rank === null, r);
}

console.log('\nLondon Lions: the same squad in the EuroCup');
{
  const linked = { teams: [
    { id: LON, women: false, youth: false, league: 'Super League Basketball Men', competitions: [{ season: '2026-27', name: 'Championship 26-27' }] },
    { id: EURO, women: false, youth: false, league: 'EuroCup', league_slug: 'eurocup', competitions: [{ season: '2026-27', name: 'EuroCup' }] },
    { id: D1, women: false, youth: false, league: 'NBL Division One', competitions: [{ season: '2026-27', name: 'NBL Division One 26-27' }] },
    { id: WOMEN, women: true, youth: false, league: 'Super League Basketball Women', competitions: [{ season: '2026-27', name: 'Championship 26-27' }] }] };
  asked.length = 0;
  const C = page({ row: SEASON, linked });
  await C.record({ id: LON, leagues: SLB });
  for (let i = 0; i < 20; i++) await settle();
  ok('the EuroCup side (four of its five players are the SLB squad\'s) gets a button after the club\'s own',
     buttons().join(' | ') === '*SLB | EuroCup', buttons());
  ok('...the Division One side (no shared player) does not, and the women\'s side is never asked about',
     !asked.some(q => q.indexOf('team_id=eq.' + WOMEN) >= 0 || q.indexOf('home_team_id.eq.' + WOMEN) >= 0) &&
     asked.some(q => q.indexOf('player_season_stats?team_id=eq.' + D1) === 0), asked.filter(q => /lon-/.test(q)));
  press('EuroCup');
  const c = cells();
  ok('pressing EuroCup: the EuroCup side\'s own table', c.record === '0-1' && c.rank === '20' && c.streak === 'L1' && c.diff === '-3', c);
  ok('a squad the other side shares with it: two players and a third of the smaller squad',
     await C.sameSquad(['p1', 'p2', 'p3'].map(player_id => ({ player_id })), ['e1', 'e2', 'e9'].map(player_id => ({ player_id }))) === true &&
     await C.sameSquad(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(player_id => ({ player_id })), ['e1', 'd2', 'd3', 'd4'].map(player_id => ({ player_id }))) === false);
}

console.log('\none competition, no season read, no game');
{
  const C = page({ row: { id: 'S26', name: '2026-27', comps: [{ id: 'champ', name: 'Championship 26-27', kind: 'league' }] } });
  await C.record({ id: LON, leagues: SLB });
  ok('a club in one competition: its name on the card, not a button', buttons().join(' | ') === 'SLB(name)', buttons());
  const D = page({ row: null });
  await D.record({ id: LIV, leagues: SLB });
  ok('no season read: the competitions of the season of the club\'s latest game', buttons().join(' | ') === '*SLB | SLB Cup' && cells().record === '0-2',
     [buttons(), cells()]);
  const E = page({ row: { id: 'S27', name: '2027-28', comps: [{ id: 'none', name: 'Championship 27-28', kind: 'league' }] }, label: '2027/28' });
  await E.record({ id: LIV, leagues: SLB });
  ok('a season with no game for the club: 0-0 and nothing to press', cells().record === '0-0' && buttons().length === 0, [cells(), buttons()]);
}

console.log('\nthe stylesheet');
ok('kit/clubhero.css: the buttons across the card under the season line, the one shown pressed, a phone\'s easier to hit',
   /\[data-k="comps"\]\{grid-column:1\/-1;/.test(CSS) && /#rec \.rec-c\.on\{background:#ffe14d;/.test(CSS) &&
   /#rec\.has-season\.has-comps > div:nth-child\(-n\+6\)\{border-top:0\}/.test(CSS) && /#rec button\.rec-c\{padding:9px 12px 8px\}/.test(CSS));
ok('team.js keeps the season row and the linked sides for the card', /SEASON_ROW = o\.current \|\| null;/.test(TJS) && /SEASON_ROW = season;/.test(TJS) &&
   /LINKED_T = window\.EpinoiaLinks\.paintTeam\(team, \{ sub: \$\('#tsub'\) \}\)\.catch\(\(\) => null\);/.test(TJS) && /leagues\(id,name,slug,initials,/.test(TJS));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
