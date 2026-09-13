/* ============================================================================
   THE EVENTS PANEL ON THE PROFILES — epinoia/sitpanel.js, and the two pages
   that draw it (p/ and t/).

   The panel reads nothing but the flat season keys of the events contract
   (ev_<situation>_<stat>, evd_ for a club's defence). So the rows here are
   fabricated WITH those keys, by a helper that works every rate from counts the
   way the contract says — 0-100, one place, from summed counts, per game over
   ev_gp, null with no coverage — and then, when epinoia/season.js is loadable,
   the same counts are stored as per-game `stats.sit` lines, rolled up by the
   real season.js, and every key the panel read is held equal to what season.js
   produced. A panel reading a key the season rows do not carry fails there.

   What is asserted, with numbers worked by hand:
     the six situations in order, for a player and a club
     a club's Defence reads evd_ keys only, and the toggle works through render()
     percentile chips only with 3+ qualifying rows, a defence ranking low-is-good
     a tapped row's Rim / Mid / 3PT tiles, free throws and turnovers
     the assisted / unassisted block
     the empty state, and "from N of M games"
     no NaN / undefined anywhere, every name escaped
     both pages load the module (?v=<version>) and call it inside its own try

     node supabase/tests/sitpanel.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const Panel = require(path.join(ROOT, 'epinoia', 'sitpanel.js'));

let pass = 0, fail = 0, skip = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };

/* ---- the contract's arithmetic, written out independently of season.js ---- */
const SK = ['all', 'second', 'transition', 'offTo', 'ato', 'half'];
const LABELS = ['All shots', 'Second chance', 'Transition', 'Off turnovers', 'After timeout', 'Half court'];
const FIELDS = ['pts', 'fgm', 'fga', 'p3m', 'p3a', 'rimM', 'rimA', 'midM', 'midA', 'ftm', 'fta', 'tov', 'ch'];
const AFIELDS = ['fgm', 'pts', 'p3m', 'rimM', 'midM'];
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
const dv = (a, b) => (b ? a / b : null);
const pct = (a, b) => { const r = dv(a, b); return r == null ? null : r * 100; };

/* one situation's counts from its made / attempted by zone */
function line(rimM, rimA, midM, midA, p3m, p3a, ftm, fta, tov, extraCh) {
  const fgm = rimM + midM + p3m, fga = rimA + midA + p3a;
  return { pts: 2 * (rimM + midM) + 3 * p3m + ftm, fgm, fga, p3m, p3a, rimM, rimA, midM, midA, ftm, fta, tov,
           ch: fga + tov + (extraCh || 0) };
}
const scale = (c, m) => { const o = {}; FIELDS.forEach(f => { o[f] = c[f] * m; }); return o; };
const zeros = () => { const o = {}; FIELDS.forEach(f => { o[f] = 0; }); return o; };
const blankSits = () => { const s = {}; SK.forEach(k => { s[k] = zeros(); }); return s; };

/* made baskets split assisted / unassisted, from the side's all-shots makes */
function groupsOf(all) {
  const aRim = Math.round(all.rimM * 0.6), aMid = Math.round(all.midM * 0.5), a3 = Math.round(all.p3m * 0.8);
  const g = (rimM, midM, p3m) => ({ fgm: rimM + midM + p3m, pts: 2 * (rimM + midM) + 3 * p3m, p3m, rimM, midM });
  return { ast: g(aRim, aMid, a3), unast: g(all.rimM - aRim, all.midM - aMid, all.p3m - a3) };
}

/* the flat keys of one prefix, exactly as the contract names them */
function keysOf(pre, gp, sits, groups, side, ftAst) {
  const o = {}; o[pre + 'gp'] = gp;
  const cov = gp > 0;
  const T = v => (cov ? v : null), PG = v => (cov ? r1(v / gp) : null), RT = (a, b) => (cov ? r1(pct(a, b)) : null);
  const A = sits.all;
  SK.forEach(K => {
    const c = sits[K], b = pre + K + '_';
    o[b + 'pts'] = T(c.pts); o[b + 'ppg'] = PG(c.pts); o[b + 'pts_sh'] = RT(c.pts, A.pts);
    o[b + 'fgm'] = T(c.fgm); o[b + 'fga'] = T(c.fga); o[b + 'fgm_pg'] = PG(c.fgm); o[b + 'fga_pg'] = PG(c.fga);
    o[b + 'fga_sh'] = RT(c.fga, A.fga); o[b + 'fg_pct'] = RT(c.fgm, c.fga); o[b + 'efg'] = RT(c.fgm + 0.5 * c.p3m, c.fga);
    o[b + 'rimM'] = T(c.rimM); o[b + 'rimA'] = T(c.rimA); o[b + 'rim_apg'] = PG(c.rimA); o[b + 'rim_pct'] = RT(c.rimM, c.rimA); o[b + 'rim_sh'] = RT(c.rimA, c.fga);
    o[b + 'midM'] = T(c.midM); o[b + 'midA'] = T(c.midA); o[b + 'mid_apg'] = PG(c.midA); o[b + 'mid_pct'] = RT(c.midM, c.midA); o[b + 'mid_sh'] = RT(c.midA, c.fga);
    o[b + 'p3m'] = T(c.p3m); o[b + 'p3a'] = T(c.p3a); o[b + 'p3_apg'] = PG(c.p3a); o[b + 'p3_pct'] = RT(c.p3m, c.p3a); o[b + 'p3_sh'] = RT(c.p3a, c.fga);
    o[b + 'ftm'] = T(c.ftm); o[b + 'fta'] = T(c.fta); o[b + 'fta_pg'] = PG(c.fta); o[b + 'ft_pct'] = RT(c.ftm, c.fta);
    o[b + 'tov'] = T(c.tov); o[b + 'tov_pg'] = PG(c.tov);
    if (side) {
      o[b + 'ch'] = T(c.ch); o[b + 'ch_pg'] = PG(c.ch); o[b + 'ppp'] = cov ? r2(dv(c.pts, c.ch)) : null;
      o[b + 'freq'] = RT(c.ch, A.ch); o[b + 'tov_pct'] = RT(c.tov, c.ch);
    }
  });
  ['ast', 'unast'].forEach(G => {
    const g = groups[G], b = pre + G + '_';
    o[b + 'fgm'] = T(g.fgm); o[b + 'pts'] = T(g.pts); o[b + 'p3m'] = T(g.p3m); o[b + 'rimM'] = T(g.rimM); o[b + 'midM'] = T(g.midM);
    o[b + 'fgm_pg'] = PG(g.fgm); o[b + 'pts_pg'] = PG(g.pts); o[b + 'ppb'] = cov ? r2(dv(g.pts, g.fgm)) : null;
    o[b + 'rim_sh'] = RT(g.rimM, g.fgm); o[b + 'mid_sh'] = RT(g.midM, g.fgm); o[b + 'p3_sh'] = RT(g.p3m, g.fgm);
  });
  const a = groups.ast, u = groups.unast;
  o[pre + 'ast_sh'] = RT(a.fgm, a.fgm + u.fgm);
  o[pre + 'rim_astp'] = RT(a.rimM, a.rimM + u.rimM);
  o[pre + 'mid_astp'] = RT(a.midM, a.midM + u.midM);
  o[pre + 'p3_astp'] = RT(a.p3m, a.p3m + u.p3m);
  if (side) { o[pre + 'ftast'] = T(ftAst); o[pre + 'ftast_pg'] = PG(ftAst); }
  return o;
}

/* a plausible season, varied by i */
function sitsFor(i, m) {
  const s = {
    all:        line(11 + i, 20 + 2 * i, 6 + (i % 3), 15 + i, 6 + (i % 4), 18 + (i * 3) % 7, 9 + (i % 3), 12 + i, 8 + (i % 5), 4),
    second:     line(3 + (i % 2), 5 + (i % 3), 1, 3 + (i % 2), 1 + (i % 2), 3 + (i % 3), 2, 3, 1 + (i % 2), 1),
    transition: line(2 + (i % 3), 4 + (i % 3), 0, 1, 1, 2 + (i % 2), 1, 2, 1, 0),
    offTo:      line(2, 4 + (i % 2), 1, 2, i % 3, 3, 1, 1, 0, 1),
    ato:        line(1, 2, 0, 1 + (i % 2), i % 2, 2, 0, 0, 1, 0),
    half:       line(6 + (i % 2), 10 + i, 4, 10 + (i % 3), 3, 10 + (i % 4), 4, 6, 4 + (i % 3), 2)
  };
  if (m && m !== 1) SK.forEach(k => { s[k] = scale(s[k], m); });
  return s;
}

function playerRow(id, gp, evgp, sits) {
  const S = evgp > 0 ? sits : blankSits();
  return Object.assign({ id, gp }, keysOf('ev_', evgp, S, groupsOf(S.all), false));
}
function teamRow(id, gp, evgp, off, evdgp, def, ftAst) {
  const O = evgp > 0 ? off : blankSits(), D = evdgp > 0 ? def : blankSits();
  return Object.assign({ id, gp },
    keysOf('ev_', evgp, O, groupsOf(O.all), true, evgp > 0 ? ftAst : 0),
    keysOf('evd_', evdgp, D, groupsOf(D.all), true, evdgp > 0 ? ftAst + 1 : 0));
}

/* a field of 12 players: ten covered (two of them partly), two from before the splits */
const players = Array.from({ length: 12 }, (_, i) =>
  i >= 10 ? playerRow('p' + i, 6, 0, null) : playerRow('p' + i, 8 + (i % 3 === 0 ? 2 : 0), 8, sitsFor(i, 1)));
const teams = Array.from({ length: 12 }, (_, i) =>
  i >= 10 ? teamRow('t' + i, 9, 0, null, 0, null, 0) : teamRow('t' + i, 10, 10, sitsFor(i, 3), 10, sitsFor(11 - i, 3), 2 + i));

const BAD = /NaN|undefined|Infinity|\bnull\b|\[object/;
const rowOf = (h, k) => { const m = h.match(new RegExp('<tr class="[^"]*" data-sp-open="' + k + '">[\\s\\S]*?</tr>')); return m ? m[0] : ''; };
const figs = tr => [...tr.matchAll(/<td class="sp-fig">([^<]*)(?:<span class="sp-pct b(\d)"[^>]*>(\d+)<\/span>)?<\/td>/g)]
  .map(m => ({ v: m[1], band: m[2] == null ? null : +m[2], p: m[3] == null ? null : +m[3] }));
const detailOf = h => { const m = h.match(/<tr class="sp-detail">[\s\S]*?<\/tr>/); return m ? m[0] : ''; };

/* ---- 1. the six situations, in order --------------------------------------- */
console.log('\nthe six situations, in the contract\'s order');
{
  const hp = Panel.html({ kind: 'player', row: players[1], field: players, name: 'Ada Stone' });
  const ht = Panel.html({ kind: 'team', row: teams[1], field: teams, name: 'Leeds Force' });
  for (const [who, h] of [['player', hp], ['team', ht]]) {
    const keys = [...h.matchAll(/<tr class="[^"]*" data-sp-open="(\w+)">/g)].map(m => m[1]);
    const labels = [...h.matchAll(/<button type="button" class="sp-open"[^>]*>([^<]+)<\/button>/g)].map(m => m[1]);
    ok(who + ': six rows, all / second / transition / offTo / ato / half', JSON.stringify(keys) === JSON.stringify(SK), keys.join(','));
    ok(who + ': labelled All shots ... Half court', JSON.stringify(labels) === JSON.stringify(LABELS), labels.join(','));
    ok(who + ': no row open until one is tapped', !/sp-detail/.test(h) && !/aria-expanded="true"/.test(h));
  }
  const headP = (hp.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1] || '';
  const headT = (ht.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1] || '';
  const cols = s => [...s.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);
  ok('player columns: PTS/G, %PTS, FG M-A/G, eFG%, shot mix', JSON.stringify(cols(headP)) === JSON.stringify(['Situation', 'PTS/G', '%PTS', 'FG M-A/G', 'eFG%', 'Shot mix']), cols(headP).join(' | '));
  ok('team columns add CH/G, FREQ, PPP', JSON.stringify(cols(headT)) === JSON.stringify(['Situation', 'PTS/G', '%PTS', 'CH/G', 'FREQ', 'PPP', 'FG M-A/G', 'eFG%', 'Shot mix']), cols(headT).join(' | '));
  const p1 = players[1];
  const all = rowOf(hp, 'all');
  ok('the All shots row prints its per-game points, share, made-attempted and eFG%',
     all.includes('<td>' + p1.ev_all_ppg.toFixed(1) + '</td><td>100.0</td>') &&
     all.includes('<td>' + p1.ev_all_fgm_pg.toFixed(1) + '-' + p1.ev_all_fga_pg.toFixed(1) + '</td>') &&
     figs(all)[0].v === p1.ev_all_efg.toFixed(1), all.slice(0, 400));
  ok('the shot mix names every zone beside its swatch',
     /<span><i class="sp-sw z-rim"><\/i>Rim \d+<\/span><span><i class="sp-sw z-mid"><\/i>Mid \d+<\/span><span><i class="sp-sw z-three"><\/i>3PT \d+<\/span>/.test(all));
  const t1 = teams[1];
  const tall = rowOf(ht, 'second');
  ok('a club row prints chances a game, frequency and points per chance',
     tall.includes('<td>' + t1.ev_second_ch_pg.toFixed(1) + '</td><td>' + t1.ev_second_freq.toFixed(1) + '</td>') &&
     figs(tall)[0].v === t1.ev_second_ppp.toFixed(2), tall.slice(0, 500));
}

/* ---- 2. a club's defence reads evd_ ---------------------------------------- */
console.log('\na club\'s Defence is what opponents did, read from evd_ keys');
{
  const seen = new Set();
  const spy = row => new Proxy(row, { get(t, k) { if (typeof k === 'string') seen.add(k); return t[k]; } });
  const row = teams[2];
  seen.clear();
  SK.concat([null]).forEach(open => Panel.html({ kind: 'team', row: spy(row), field: teams, name: 'Hull', side: 'def', open }));
  const defRead = [...seen].filter(k => /^evd?_/.test(k));
  ok('defence reads evd_ keys (only the offence coverage count from ev_)',
     defRead.length > 50 && defRead.every(k => k.startsWith('evd_') || k === 'ev_gp'), defRead.filter(k => !k.startsWith('evd_')).join(','));
  seen.clear();
  SK.concat([null]).forEach(open => Panel.html({ kind: 'team', row: spy(row), field: teams, name: 'Hull', side: 'off', open }));
  const offRead = [...seen].filter(k => /^evd?_/.test(k));
  ok('offence reads ev_ keys (only the defence coverage count from evd_)',
     offRead.length > 50 && offRead.every(k => k.startsWith('ev_') || k === 'evd_gp'), offRead.filter(k => !k.startsWith('ev_')).join(','));

  const hd = Panel.html({ kind: 'team', row, field: teams, name: 'Hull', side: 'def' });
  ok('defence prints the evd_ numbers', figs(rowOf(hd, 'all'))[1].v === row.evd_all_efg.toFixed(1) && row.evd_all_efg !== row.ev_all_efg,
     figs(rowOf(hd, 'all'))[1].v + ' vs ' + row.evd_all_efg);
  ok('defence is labelled as opponents, with the Defence tab on',
     /Opponents against <b>Hull<\/b>/.test(hd) && /class="ep-tab on" role="tab" aria-selected="true" data-sp-side="def">Defence</.test(hd));
  ok('the player panel has no offence / defence toggle', !/data-sp-side/.test(Panel.html({ kind: 'player', row: players[0], field: players })));

  /* render(): the toggle and the one-open-row rule, through a host that records its listener */
  const host = { innerHTML: '', handlers: [], addEventListener(t, f) { if (t === 'click') this.handlers.push(f); },
    contains: () => true, querySelector: () => null };
  const click = (attr, val) => host.handlers.forEach(f => f({ target: { closest: sel => (sel === '[' + attr + ']' ? { getAttribute: () => val } : null) } }));
  const handle = Panel.render({ host, kind: 'team', row, field: teams, name: 'Hull' });
  ok('render() draws into the host and listens once', !!handle && host.handlers.length === 1 && /data-side="off"/.test(host.innerHTML));
  click('data-sp-side', 'def');
  ok('tapping Defence redraws from evd_', /data-side="def"/.test(host.innerHTML) && figs(rowOf(host.innerHTML, 'all'))[1].v === row.evd_all_efg.toFixed(1));
  click('data-sp-open', 'second');
  ok('tapping a row opens it', /<tr class="sp-row on" data-sp-open="second">/.test(host.innerHTML) && (host.innerHTML.match(/sp-detail/g) || []).length === 1);
  click('data-sp-open', 'ato');
  ok('tapping another row closes the first: one open at a time',
     /data-sp-open="ato"/.test(host.innerHTML) && /<tr class="sp-row on" data-sp-open="ato">/.test(host.innerHTML) &&
     !/<tr class="sp-row on" data-sp-open="second">/.test(host.innerHTML) && (host.innerHTML.match(/class="sp-detail"/g) || []).length === 1);
  Panel.render({ host, kind: 'team', row, field: teams, name: 'Hull' });
  ok('a second render on the same host keeps the open row and the side', /<tr class="sp-row on" data-sp-open="ato">/.test(host.innerHTML) && /data-side="def"/.test(host.innerHTML) && host.handlers.length === 1);
  click('data-sp-open', 'ato');
  ok('tapping the open row closes it', !/sp-detail/.test(host.innerHTML));
}

/* ---- 3. percentile chips ---------------------------------------------------- */
console.log('\npercentiles: three qualifying rows or no chip, a defence ranking low-is-good');
{
  /* everything under the floors: thin volume on every key the chips pool by */
  const thin = r => { const o = Object.assign({}, r);
    Object.keys(o).forEach(k => { if (/_(fga|ch|rimA|midA|p3a)$/.test(k) && o[k] != null) o[k] = 1; }); return o; };
  const runs = [['local ranking', null]];
  let Season = null;
  try { Season = require(path.join(ROOT, 'epinoia', 'season.js')); } catch (e) { console.log('  (season.js did not load: ' + e.message + ')'); }
  if (Season && typeof Season.percentiles === 'function') runs.push(['EpinoiaSeason.percentiles', Season]);

  for (const [how, SE] of runs) {
    if (SE) globalThis.EpinoiaSeason = SE; else delete globalThis.EpinoiaSeason;
    const pSub = players[3];
    const two = [pSub, players[4]].concat(players.slice(5, 10).map(thin), players.slice(10));
    const three = [pSub, players[4], players[5]].concat(players.slice(6, 10).map(thin), players.slice(10));
    ok(how + ': two qualifying players -> no chip anywhere', !/sp-pct/.test(Panel.html({ kind: 'player', row: pSub, field: two, open: 'second' })));
    const h3 = Panel.html({ kind: 'player', row: pSub, field: three, open: 'second' });
    ok(how + ': three qualifying players -> chips', /sp-pct/.test(h3) && figs(rowOf(h3, 'all'))[0].p != null);
    const thinSub = thin(pSub);
    ok(how + ': a row under the floor itself gets no chip, however many others qualify',
       !/sp-pct/.test(Panel.html({ kind: 'player', row: thinSub, field: [thinSub].concat(players.slice(4, 10)) })));

    /* hand-ranked: eFG% 50 / 55 / 60 among three clubs */
    const mk = (id, off, def) => Object.assign({}, teams[0], { id, ev_all_efg: off, evd_all_efg: def });
    const A = mk('A', 60, 50), B = mk('B', 55, 55), C = mk('C', 50, 60);
    const club = [A, B, C].concat(teams.slice(10));
    const eff = (row, side) => figs(rowOf(Panel.html({ kind: 'team', row, field: club, side }), 'all'))[1];
    ok(how + ': offence, the best eFG% is the 100th percentile, the worst the 0th', eff(A, 'off').p === 100 && eff(C, 'off').p === 0 && eff(B, 'off').p === 50,
       [eff(A, 'off').p, eff(B, 'off').p, eff(C, 'off').p].join(','));
    ok(how + ': defence, the LOWEST eFG% allowed is the 100th percentile', eff(A, 'def').p === 100 && eff(C, 'def').p === 0,
       [eff(A, 'def').p, eff(C, 'def').p].join(','));
    ok(how + ': bands follow the percentile (100 top band, 0 bottom)', eff(A, 'def').band === 3 && eff(C, 'def').band === 0);
    ok(how + ': a defence chip says less allowed ranks higher', /less allowed ranks higher/.test(Panel.html({ kind: 'team', row: A, field: club, side: 'def' })));
    const twoClubs = [A, B].concat(teams.slice(10));
    ok(how + ': two qualifying clubs -> no chip', !/sp-pct/.test(Panel.html({ kind: 'team', row: A, field: twoClubs })));
  }
  delete globalThis.EpinoiaSeason;
}

/* ---- 4. the breakdown under a tapped row ------------------------------------ */
console.log('\na tapped row: Rim / Mid / 3PT, free throws, turnovers');
{
  /* second chance over 5 games: rim 3-6, mid 1-4, 3PT 2-5, FT 4-6, 3 turnovers */
  const S = sitsFor(0, 1);
  S.second = line(3, 6, 1, 4, 2, 5, 4, 6, 3, 2);
  const row = playerRow('me', 5, 5, S);
  const field = [row].concat(players.slice(0, 10));
  const d = detailOf(Panel.html({ kind: 'player', row, field, name: 'Ada', open: 'second' }));
  const tiles = [...d.matchAll(/<div class="sp-tl">(?:<i class="sp-sw z-\w+"><\/i>)?([^<]+)<\/div>/g)].map(m => m[1]);
  ok('tiles Rim, Mid, 3PT, then free throws and turnovers', JSON.stringify(tiles) === JSON.stringify(['Rim', 'Mid', '3PT', 'Free throws', 'Turnovers']), tiles.join(','));
  const tileOf = label => (d.split('<div class="sp-tile').find(t => t.includes('</i>' + label + '</div>') || t.includes('">' + label + '</div>')) || '');
  const want = [['Rim', '0.6-1.2', '50.0%', '40.0%'], ['Mid', '0.2-0.8', '25.0%', '26.7%'], ['3PT', '0.4-1.0', '40.0%', '33.3%']];
  want.forEach(([z, mapg, fg, share]) => {
    const t = tileOf(z);
    ok(z + ': ' + mapg + ' a game, FG ' + fg + ', ' + share + ' of the attempts',
       t.includes('<div class="sp-tv">' + mapg + '<small>per game</small>') && t.includes('FG <b>' + fg + '</b>') && t.includes('<b>' + share + '</b> of the attempts'), t);
  });
  ok('free throws 0.8-1.2 a game at 66.7%', tileOf('Free throws').includes('0.8-1.2<small>') && tileOf('Free throws').includes('FT <b>66.7%</b>'), tileOf('Free throws'));
  ok('turnovers 0.6 a game', tileOf('Turnovers').includes('<div class="sp-tv">0.6<small>'), tileOf('Turnovers'));
  ok('the breakdown names its situation', d.includes('Second chance, by zone'));
  ok('the tapped row is marked open for assistive tech', /data-sp-open="second"><th scope="row" class="sp-k"><button type="button" class="sp-open" aria-expanded="true">/.test(Panel.html({ kind: 'player', row, field, open: 'second' })));
  const td = detailOf(Panel.html({ kind: 'team', row: teams[4], field: teams, open: 'ato' }));
  ok('a club\'s breakdown spans all nine columns and gives turnovers as a share of possessions after a timeout',
     /<td colspan="9">/.test(td) && new RegExp('<b>' + teams[4].ev_ato_tov_pct.toFixed(1) + '%</b> of possessions').test(td), td.slice(-300));
}

/* ---- 5. assisted and unassisted --------------------------------------------- */
console.log('\nassisted and unassisted baskets');
{
  /* 16 makes over 5 games: assisted rim 5 / mid 2 / 3PT 3 (10 makes, 23 pts), unassisted rim 3 / mid 2 / 3PT 1 (6, 13) */
  const S = sitsFor(0, 1);
  S.all = line(8, 14, 4, 10, 4, 12, 5, 7, 6, 0);
  const row = Object.assign(playerRow('as', 5, 5, S),
    keysOf('ev_', 5, S, { ast: { fgm: 10, pts: 23, p3m: 3, rimM: 5, midM: 2 }, unast: { fgm: 6, pts: 13, p3m: 1, rimM: 3, midM: 2 } }, false));
  const h = Panel.html({ kind: 'player', row, field: [row] });
  const blk = (h.match(/<div class="sp-ast">[\s\S]*$/) || [''])[0];
  const lines = blk.split('<div class="sp-aline">').slice(1);
  ok('two lines, Assisted then Unassisted', lines.length === 2 && /<b>Assisted<\/b>/.test(lines[0]) && /<b>Unassisted<\/b>/.test(lines[1]));
  ok('assisted: 2.0 made a game, 62.5% of baskets, 2.30 pts per basket',
     lines[0].includes('<em>2.0</em> made per game') && lines[0].includes('<em>62.5%</em> of baskets') && lines[0].includes('<em>2.30</em> pts per basket'), lines[0]);
  ok('unassisted: 1.2 made a game, 37.5% of baskets, 2.17 pts per basket',
     lines[1].includes('<em>1.2</em> made per game') && lines[1].includes('<em>37.5%</em> of baskets') && lines[1].includes('<em>2.17</em> pts per basket'), lines[1]);
  ok('assisted makes by zone: Rim 50, Mid 20, 3PT 30', /Rim 50<\/span>.*Mid 20<\/span>.*3PT 30<\/span>/.test(lines[0]));
  ok('unassisted makes by zone: Rim 50, Mid 33, 3PT 17', /Rim 50<\/span>.*Mid 33<\/span>.*3PT 17<\/span>/.test(lines[1]));
  ok('the bars are as long as the makes: unassisted 60% of assisted', lines[0].includes('style="width:100.0%"') && lines[1].includes('style="width:60.0%"'));
  const ztr = [...blk.matchAll(/<tr><th scope="row" class="sp-k"><i class="sp-sw z-\w+"><\/i>(\w+)<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map(m => m.slice(1).join(' | '));
  ok('per zone: share of makes assisted beside FG% and eFG% from all attempts',
     JSON.stringify(ztr) === JSON.stringify(['Rim | 62.5% | 57.1% | 57.1%', 'Mid | 50.0% | 40.0% | 40.0%', '3PT | 75.0% | 33.3% | 50.0%']), ztr.join(' / '));
  ok('the note says why eFG% is per zone', blk.includes('A missed shot has no assist, so eFG% is given per zone for all attempts.'));
}

/* ---- 6. coverage ------------------------------------------------------------ */
console.log('\ncoverage: nothing yet, some of the games, all of them');
{
  const EMPTY = 'No event splits yet — they fill in as games are finalised.';
  const none = Panel.html({ kind: 'player', row: players[10], field: players, name: 'Old Timer' });
  ok('ev_gp 0 -> the empty state, no table', none.includes(EMPTY) && !/<table/.test(none), none);
  const nul = Object.assign({}, players[10], { ev_gp: null });
  ok('ev_gp null -> the empty state', Panel.html({ kind: 'player', row: nul, field: players }).includes(EMPTY));
  ok('no season row at all -> the empty state', Panel.html({ kind: 'player', row: null, field: players }).includes(EMPTY) &&
     Panel.html({ kind: 'team' }).includes(EMPTY));
  ok('a club with neither end covered -> the empty state, no toggle', Panel.html({ kind: 'team', row: teams[10], field: teams }).includes(EMPTY) &&
     !/data-sp-side/.test(Panel.html({ kind: 'team', row: teams[10], field: teams })));
  const part = playerRow('part', 5, 3, sitsFor(2, 1));
  const hp = Panel.html({ kind: 'player', row: part, field: players, name: 'Bea' });
  ok('ev_gp 3 of gp 5 -> "from 3 of 5 games"', hp.includes('from 3 of 5 games'));
  ok('full coverage -> "8 games", no "from"', /<b>Cy<\/b> · 8 games<\/p>/.test(Panel.html({ kind: 'player', row: players[1], field: players, name: 'Cy' })));
  const tPart = teamRow('tp', 7, 4, sitsFor(1, 3), 4, sitsFor(2, 3), 1);
  ok('a club: "from 4 of 7 games" on both sides', Panel.html({ kind: 'team', row: tPart, field: teams }).includes('from 4 of 7 games') &&
     Panel.html({ kind: 'team', row: tPart, field: teams, side: 'def' }).includes('from 4 of 7 games'));
  ok('the page note rides along, escaped', Panel.html({ kind: 'team', row: tPart, field: teams, note: 'Cup <i>' }).includes(' · Cup &lt;i&gt;</p>'));
  ok('coverage() gives the page the same words', Panel.coverage(part, 'player').text === 'from 3 of 5 games' && Panel.coverage(players[10], 'player').gp === 0);
}

/* ---- 7. nothing leaks ------------------------------------------------------- */
console.log('\nno NaN, no undefined, every name escaped');
{
  let bad = [];
  const check = (label, h) => { if (BAD.test(h)) bad.push(label + ': ' + h.match(BAD)[0]); };
  players.forEach(r => [null].concat(SK).forEach(open => check(r.id + ' ' + open, Panel.html({ kind: 'player', row: r, field: players, name: 'X', open }))));
  teams.forEach(r => ['off', 'def'].forEach(side => [null].concat(SK).forEach(open =>
    check(r.id + ' ' + side + ' ' + open, Panel.html({ kind: 'team', row: r, field: teams, name: 'X', side, open })))));
  /* a row carrying only a coverage count and nothing else */
  check('bare', Panel.html({ kind: 'team', row: { id: 'z', gp: 3, ev_gp: 3 }, field: [], open: 'half' }));
  check('bare player', Panel.html({ kind: 'player', row: { id: 'z', gp: 3, ev_gp: 2 }, open: 'all' }));
  ok('every row, both kinds, both ends, every row open', bad.length === 0, bad.slice(0, 5).join(' ; '));
  const bare = Panel.html({ kind: 'player', row: { id: 'z', gp: 3, ev_gp: 2 }, open: 'all' });
  ok('a row with no numbers prints dashes and "no shots"', bare.includes('—') && bare.includes('no shots'));

  const nasty = 'Flo <b>Ray</b> & "O\'Neil"';
  const hp = Panel.html({ kind: 'player', row: players[2], field: players, name: nasty });
  const ht = Panel.html({ kind: 'team', row: teams[2], field: teams, name: nasty, side: 'def' });
  const safe = 'Flo &lt;b&gt;Ray&lt;/b&gt; &amp; &quot;O&#39;Neil&quot;';
  ok('a player\'s name is escaped', hp.includes(safe) && !hp.includes('<b>Ray</b>'));
  ok('a club\'s name is escaped', ht.includes(safe) && !ht.includes('<b>Ray</b>'));
}

/* ---- 8. the pages ----------------------------------------------------------- */
console.log('\nboth profiles load the panel and draw it inside their own try');
{
  const V = rd('epinoia', 'version.txt').trim();
  const phtml = rd('epinoia', 'p', 'index.html'), thtml = rd('epinoia', 't', 'index.html');
  const pjs = rd('epinoia', 'p', 'player.js'), tjs = rd('epinoia', 't', 'team.js');
  const sjs = rd('epinoia', 'sitpanel.js');
  ok('version is 244, as the pages are stamped', V === '244', V);
  for (const [who, h, own] of [['p/index.html', phtml, 'player.js'], ['t/index.html', thtml, 'team.js']]) {
    const css = h.indexOf('<link rel="stylesheet" href="../kit/sitpanel.css?v=' + V + '">');
    const js = h.indexOf('<script src="../sitpanel.js?v=' + V + '" defer></script>');
    const mine = h.indexOf('<script src="' + own + '?v=' + V + '" defer></script>');
    ok(who + ': links kit/sitpanel.css?v=' + V, css > 0 && css < h.indexOf('</head>'));
    ok(who + ': loads ../sitpanel.js?v=' + V + ' before ' + own, js > 0 && mine > js);
  }
  const lp = phtml.indexOf('<h2>League percentile</h2>'), ev = phtml.indexOf('<div class="sec" id="eventsSec">'), se = phtml.indexOf('<h2>Season</h2>');
  ok('p/index.html: an Events section, 02, between League percentile and Season',
     lp > 0 && ev > lp && se > ev &&
     /<div class="sec" id="eventsSec">\s*<div class="sec-h"><span class="idx">02<\/span><h2>Events<\/h2><span class="note" id="eventsNote"><\/span><\/div>\s*<div id="events"><\/div>\s*<\/div>/.test(phtml));
  const idx = [...phtml.matchAll(/<span class="idx">([^<]+)<\/span><h2>([^<]+)<\/h2>/g)].map(m => m[1] + ' ' + m[2]);
  ok('p/index.html: later sections renumbered', JSON.stringify(idx) === JSON.stringify(['01 League percentile', '02 Events', '03 Season', '04 Game log', '04b On video', '05 On the floor with']), idx.join(' / '));
  ok('p/index.html: the 05 section closes as a div and the shot chart as a section',
     /<div id="withpanel"><\/div>\s*<\/div>\s*<!--[^>]*-->\s*<section class="card">[\s\S]*?<div id="shotchart"><\/div>\s*<\/section>/.test(phtml));

  /* the call sits inside a try whose catch is its own, not boot's */
  const insideTry = (src, call) => {
    const at = src.indexOf(call);
    if (at < 0) return false;
    const t = src.lastIndexOf('try {', at);
    const c = src.indexOf('} catch', at);
    return t > 0 && c > at && src.slice(t, at).indexOf('} catch') === -1 && c - t < 1200;
  };
  const scope = pjs.slice(pjs.indexOf('const paintScope = async kind =>'), pjs.indexOf('if (kinds.length > 1)'));
  ok('player.js: paintScope calls EpinoiaSitPanel.render after paintBars, inside its own try',
     scope.indexOf('paintBars(mine, field);') > 0 && scope.indexOf('EpinoiaSitPanel.render') > scope.indexOf('paintBars(mine, field);') &&
     insideTry(scope, 'EpinoiaSitPanel.render(') && /kind: 'player', row: mine, field/.test(scope));
  const stats = tjs.slice(tjs.indexOf('async function teamStats(team, kind)'), tjs.indexOf('async function zoneStats('));
  ok('team.js: teamStats renders the panel after the shot zones and before the squad, inside its own try',
     stats.indexOf("'shot zones'") > 0 && stats.indexOf('EpinoiaSitPanel.render') > stats.indexOf("'shot zones'") &&
     stats.indexOf('EpinoiaSitPanel.render') < stats.indexOf('T.render(') && insideTry(stats, 'EpinoiaSitPanel.render(') &&
     /kind: 'team', row: mine, field: S\.teams/.test(stats) && /el\('div', 'ffhead', 'events'\)/.test(stats));
  const guard = /innerHTML\s*=\s*[^;]*\b(p\.name|player\.name|team\.name|\.display_name)\b/;
  const offenders = [['sitpanel.js', sjs], ['player.js', pjs], ['team.js', tjs]]
    .flatMap(([n, s]) => s.split(';').filter(st => guard.test(st)).map(st => n + ': ' + st.trim().slice(0, 80)));
  ok('the CI user-text guard finds nothing in the three files', offenders.length === 0, offenders.join(' ; '));
  ok('sitpanel.js builds no DOM from a name property', !/\.name\b/.test(sjs.replace(/opts\.name|O\.name/g, '')), (sjs.match(/.{20}\.name\b.{10}/) || [''])[0]);
}

/* ---- 9. the contract, against the real season rollup -------------------------- */
console.log('\nevery key the panel reads is one season.js writes, with the same value');
{
  let Season = null;
  try { Season = require(path.join(ROOT, 'epinoia', 'season.js')); } catch (e) { Season = null; }
  if (!Season || !Array.isArray(Season.SIT_FIELDS) || typeof Season.players !== 'function') {
    skip++; console.log('  SKIP  season.js has no SIT_FIELDS yet; the cross-check waits for it');
  } else {
    ok('season.js SIT_FIELDS / SIT_AFIELDS are the contract\'s', JSON.stringify(Season.SIT_FIELDS) === JSON.stringify(FIELDS) &&
       JSON.stringify(Season.SIT_AFIELDS) === JSON.stringify(AFIELDS));
    /* five games, splits on the first three; the whole season's counts on game 1 */
    const offS = sitsFor(3, 3), defS = sitsFor(6, 3), plS = sitsFor(4, 1);
    const offG = groupsOf(offS.all), defG = groupsOf(defS.all), plG = groupsOf(plS.all);
    const arr = (c, list) => list.map(f => c[f]);
    const teamSit = (S, G, ftAst) => { const o = { v: 1 }; SK.forEach(k => { o[k] = arr(S[k], FIELDS); });
      o.ast = arr(G.ast, AFIELDS); o.unast = arr(G.unast, AFIELDS); o.ftAst = ftAst; return o; };
    const plSit = () => { const o = { v: 1 }; SK.forEach(k => { o[k] = arr(plS[k], FIELDS.slice(0, 12)); });
      o.ast = arr(plG.ast, AFIELDS); o.unast = arr(plG.unast, AFIELDS); return o; };
    const games = {}, tgs = [], pgs = [];
    for (let g = 1; g <= 5; g++) {
      const id = 'g' + g;
      games[id] = { id, home_team_id: 'A', away_team_id: 'B', home_score: 80, away_score: 70 };
      const covered = g <= 3;
      tgs.push({ game_id: id, team_idx: 0, stats: Object.assign({ adv: { pts: 80 } }, covered ? { sit: g === 1 ? teamSit(offS, offG, 4) : { v: 1 } } : {}) });
      tgs.push({ game_id: id, team_idx: 1, stats: Object.assign({ adv: { pts: 70 } }, covered ? { sit: g === 1 ? teamSit(defS, defG, 2) : { v: 1 } } : {}) });
      pgs.push({ game_id: id, player_uuid: 'P', team_idx: 0, stats: Object.assign({ min: 1200000, pts: 10 }, g === 1 ? { sit: plSit() } : {}) });
    }
    const sp = (Season.players(pgs, tgs) || []).find(r => r.id === 'P');
    const st = (Season.teams(tgs, games) || []).find(r => r.id === 'A');
    if (!sp || !st || !('ev_gp' in sp) || !('evd_gp' in st)) {
      ok('season.js writes ev_ keys on player rows and evd_ keys on team rows', false, 'player row ' + !!sp + ', team row ' + !!st);
    } else {
      const fp = playerRow('P', sp.gp, 3, plS), ft = teamRow('A', st.gp, 3, offS, 3, defS, 4);
      /* the defence's free-throw assists are the opponent's own: 2 */
      ft.evd_ftast = 2; ft.evd_ftast_pg = r1(2 / 3);
      const readBy = (kind, row, sides) => {
        const seen = new Set();
        const spy = new Proxy(row, { get(t, k) { if (typeof k === 'string') seen.add(k); return t[k]; } });
        sides.forEach(side => [null].concat(SK).forEach(open => Panel.html({ kind, row: spy, field: [row], side, open })));
        return [...seen].filter(k => /^evd?_/.test(k));
      };
      const diff = (read, mine, real) => read.filter(k => !(k in real) || real[k] !== mine[k]).map(k => k + ': season ' + real[k] + ', contract ' + mine[k]);
      const rp = readBy('player', fp, ['off']), rt = readBy('team', ft, ['off', 'def']);
      ok('coverage: 3 of 5 games at both ends', sp.ev_gp === 3 && st.ev_gp === 3 && st.evd_gp === 3, [sp.ev_gp, st.ev_gp, st.evd_gp].join(','));
      const dp = diff(rp, fp, sp), dt = diff(rt, ft, st);
      ok('player: the ' + rp.length + ' keys the panel reads are season.js\'s, value for value', dp.length === 0, dp.slice(0, 6).join(' ; '));
      ok('team: the ' + rt.length + ' keys the panel reads are season.js\'s, value for value', dt.length === 0, dt.slice(0, 6).join(' ; '));
      ok('the panel draws the real season rows cleanly', !BAD.test(Panel.html({ kind: 'player', row: sp, field: [sp], open: 'second' })) &&
         !BAD.test(Panel.html({ kind: 'team', row: st, field: [st], side: 'def', open: 'ato' })));
    }
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
process.exit(fail ? 1 : 0);
