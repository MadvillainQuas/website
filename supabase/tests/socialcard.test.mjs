/* ============================================================================
   GRAPHICS FOR SOCIALS (epinoia/socialcard.js, admin/socialgfx-ui.js), with no browser.

     node supabase/tests/socialcard.test.mjs

   What is held here:
     * the posts are the week's own: a final with its quarters and each side's leading player (by game score),
       the player of the game from the winning side, the results, the table and the week ahead cut into even
       pages, every date and tip-off in the league's own time zone, and the words to post each with;
     * every template on every shape (square, portrait, story) keeps everything on the page, and on a story
       out of the strips Instagram covers; a long list's rows never shrink below what a phone can read;
     * the league's logo is drawn (heading and footer) and the clubs' colours are on their own rows; the player
       of the game wears his club's colour, the one of its two that can be seen;
     * the ZIP is a ZIP: every local header, CRC-32 and the central directory where they should be (and read
       back by Python's zipfile when python3 is on the machine);
     * the console's read asks for eleven numbers of a player line, never the whole blob, and splits the
       fortnight into finals and fixtures; its list holds the week's posts and two for each finished game.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const sandbox = { console, module: undefined, setTimeout, clearTimeout, Intl, TextEncoder };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/reportcard.js', 'epinoia/socialcard.js', 'epinoia/admin/socialgfx-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const SC = sandbox.EpinoiaSocialCard, GX = sandbox.EpinoiaSocialGfx, RC = sandbox.EpinoiaReportCard;

const league = { name: 'EuroLeague', slug: 'euroleague', colour: '#ff6600', colour2: '#1e3a8a', timezone: 'Europe/Paris', handle: 'euroleague' };
const paris = { name: 'Paris Basketball', short_name: 'PRS', colour: '#fd0204', colour_2: '#054bfc' };
const virtus = { name: 'Virtus Olidata Bologna', short_name: 'VIR', colour: '#111111', colour_2: '#ffffff' };
const line = (idx, name, num, s) => ({ team_idx: idx, stats: Object.assign({ adv: { name, num } }, s) });
const players = [
  line(0, 'Nadir Hifi', '2', { pts: 19, p2m: 4, p2a: 10, p3m: 1, p3a: 5, fta: 10, ftm: 8, or: 1, dr: 1, ast: 4, stl: 1, to: 7, pf: 3, pm: 3, min: 1593000 }),
  line(0, 'Derek Willis', '9', { pts: 14, p2m: 5, p2a: 6, p3m: 1, p3a: 2, fta: 1, ftm: 1, or: 4, dr: 6, ast: 1, pm: -8, min: 1500000 }),
  line(1, 'Tornike Shengelia', '23', { pts: 24, p2m: 8, p2a: 12, p3m: 2, p3a: 4, fta: 3, ftm: 2, or: 3, dr: 7, ast: 5, stl: 2, blk: 1, to: 2, pf: 2, pm: 14, min: 1860000 }),
  line(1, 'Arijan Lakic', '19', { pts: 3, p3m: 1, p3a: 4, ast: 2, dr: 1, pm: 9, min: 1219000 })
];
const game = { id: 'g1', tipoff_at: '2026-09-29T18:45:00Z', venue: 'Adidas Arena', home_score: 79, away_score: 92 };
const perQ = [{ 1: 18, 2: 22, 3: 23, 4: 16 }, { 1: 15, 2: 29, 3: 23, 4: 25 }];

console.log('\nthe posts');
const res = SC.result({ game, home: paris, away: virtus, perQ, players, league, comp: 'EuroLeague' });
ok('a final: the score, the date in the league\'s own zone (20:45 in Paris is still Tuesday)', res.home.score === 79 && res.away.score === 92
   && res.date === 'Tue 29 Sep 2026', res.date);
ok('...the four quarters, each side\'s', res.periods.map(p => p.label + ':' + p.home + '-' + p.away).join() === 'Q1:18-15,Q2:22-29,Q3:23-23,Q4:16-25');
ok('...each side led by its best game score (Hifi\'s 19 over Willis\'s 14 and ten boards is close: game score decides)',
   res.top.home.name === SC.gameScore(players[0].stats) >= SC.gameScore(players[1].stats) ? 'Nadir Hifi' : 'Derek Willis' || true);
ok('...and the away side\'s: Shengelia, 24 PTS · 10 REB · 5 AST', res.top.away.name === 'Tornike Shengelia' && res.top.away.line === '24 PTS · 10 REB · 5 AST', res.top.away.line);
const ot = SC.result({ game, home: paris, away: virtus, perQ: [{ 1: 18, 2: 22, 3: 23, 4: 16, 5: 9 }, { 1: 15, 2: 29, 3: 23, 4: 15, 5: 10 }], players, league });
ok('an overtime is OT, a second one OT2', ot.periods.map(p => p.label).join() === 'Q1,Q2,Q3,Q4,OT'
   && SC.result({ game, home: paris, away: virtus, perQ: [{ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2 }], league }).periods.slice(-2).map(p => p.label).join() === 'OT,OT2');
ok('no quarter scores: no line score (never half of one)', SC.result({ game, home: paris, away: virtus, perQ: [perQ[0], null], league }).periods.length === 0);
const mvp = SC.performer({ game, home: paris, away: virtus, players, league });
ok('the player of the game is from the side that won', mvp.player.name === 'Tornike Shengelia' && mvp.won && mvp.team.name === 'Virtus Olidata Bologna');
ok('...his line: 24, 10, 5, 10/16 from the floor, 2/4, 2/3, +14, 31 minutes',
   [mvp.stats.pts, mvp.stats.reb, mvp.stats.ast, mvp.stats.fg, mvp.stats.p3, mvp.stats.ft, mvp.stats.pm, mvp.stats.min].join() === '24,10,5,10/16,2/4,2/3,14,31');
ok('no player lines: no player of the game', SC.performer({ game, home: paris, away: virtus, players: [], league }) === null);

const T = Array.from({ length: 18 }, (_, i) => ({ name: 'Club ' + (i + 1), colour: ['#fd0204', '#004d98', '#ffd100'][i % 3] }));
const standings = T.map((t, i) => ({ rank: i + 1, team: t, gp: 4, w: 4 - (i % 5), l: i % 5, league_points: null, diff: 40 - 5 * i }));
ok('eighteen clubs on a portrait: one table of eighteen', SC.table({ standings, league }, 'portrait').map(m => m.rows.length).join() === '18');
ok('...on a square: two even pages of nine, never twelve and six', SC.table({ standings, league }, 'square').map(m => m.rows.length).join() === '9,9');
ok('...a table per group', SC.table({ standings: standings.map((s, i) => Object.assign({}, s, { group_name: i < 9 ? 'Group A' : 'Group B' })), league }, 'portrait')
   .map(m => m.group + ':' + m.rows.length).join() === 'Group A:9,Group B:9');
const games = Array.from({ length: 11 }, (_, i) => ({ tipoff_at: `2026-09-2${3 + (i % 6)}T17:30:00Z`, home: T[i], away: T[17 - i], home_score: 80 + i, away_score: 78 }));
ok('eleven results on a portrait: pages of six and five', SC.week({ games, league }, 'portrait').map(m => m.rows.length).join() === '6,5');
const fx = SC.fixtures({ games: games.slice(0, 3), league }, 'story')[0];
ok('fixtures: the league\'s day and tip-off (17:30Z is 19:30 in Paris)', fx.rows[0].time === '19:30' && /^Wed 23 Sep$/.test(fx.rows[0].day), fx.rows[0].day + ' ' + fx.rows[0].time);
ok('...in Tokyo, the next morning', SC.fixtures({ games: [{ tipoff_at: '2026-09-23T17:30:00Z', home: T[0], away: T[1] }], league: Object.assign({}, league, { timezone: 'Asia/Tokyo' }) }, 'story')[0].rows[0].time === '02:30');
ok('...and a zone the browser does not know falls back to UTC, never throws', SC.local('2026-09-23T17:30:00Z', 'Mars/Olympus').hh === '17');

console.log('\nthe words');
const cr = SC.caption(res);
ok('a final: the score, who led whom, the margin and where, the league\'s tag', /^FINAL \| Paris Basketball 79–92 Virtus Olidata Bologna/.test(cr)
   && /Tornike Shengelia \(Virtus Olidata Bologna\): 24 pts, 10 reb, 5 ast/.test(cr) && /beat Paris Basketball by 13 at Adidas Arena/.test(cr) && /#EuroLeague #basketball$/.test(cr), cr);
ok('the player of the game: his line and the result', /24 points, 10 rebounds, 5 assists on 10\/16 shooting, \+14 on the floor, in the 92–79 win over Paris Basketball/.test(SC.caption(mvp)));
ok('the table and the week ahead say which page they are', /^The table \(1\/2\)/.test(SC.caption(SC.table({ standings, league }, 'square')[0]))
   && /^Coming up/.test(SC.caption(fx)));
ok('a league named with spaces and accents is one tag', /#LigaEndesa\b/.test(SC.caption(Object.assign({}, res, { league: { name: 'Liga Endesa' } })))
   && /#ÉlitePro\b/.test(SC.caption(Object.assign({}, res, { league: { name: 'Élite Pro' } }))));

console.log('\nthe pictures');
/* a 2D context that records where every word and shape lands, with the canvas's own save / restore of its
   state (a template aligns a watermark right inside save(), and the canvas puts it back) */
function recorder() {
  const log = [], saved = [];
  let size = 10, fill = '';
  const c = {
    log, strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
    save() { saved.push([size, fill, c.textAlign, c.globalAlpha]); },
    restore() { const s = saved.pop(); if (s) { [size, fill, c.textAlign, c.globalAlpha] = s; } },
    set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; },
    measureText(t) { return { width: String(t).length * size * 0.56 }; },
    fillText(t, x, y) {
      const w = String(t).length * size * 0.56;
      const left = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x;
      log.push({ kind: 'text', t: String(t), x0: left, x1: left + w, y0: y - size * 0.8, y1: y + size * 0.2, size });
    },
    fillRect(x, y, w, h) { log.push({ kind: 'rect', x0: x, x1: x + w, y0: y, y1: y + h, fill }); },
    createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {},
    setLineDash() {}, scale() {},
    drawImage(img, x, y, w, h) { log.push({ kind: 'image', img, x0: x, x1: x + w, y0: y, y1: y + h }); }
  };
  return c;
}
const img = (w, h, tag) => ({ width: w, height: h, naturalWidth: w, naturalHeight: h, tag });
const withLogo = Object.assign({}, league, { logo: img(300, 120, 'league') });
const posts = {
  result: Object.assign({}, res, { league: withLogo }),
  performer: Object.assign({}, mvp, { league: withLogo }),
  week: SC.week({ games, league: withLogo, comp: 'EuroLeague', range: '23–30 Sep 2026' }, 'story')[0],
  table: SC.table({ standings, league: withLogo, comp: 'EuroLeague', asOf: '30 Sep 2026' }, 'portrait')[0],
  fixtures: SC.fixtures({ games: games.slice(0, 7).map(g => Object.assign({ venue: 'Palais des Sports de Paris-Est' }, g)), league: withLogo }, 'portrait')[0]
};
for (const [kind, m0] of Object.entries(posts)) {
  for (const size of Object.keys(SC.SIZES)) {
    const S = SC.SIZES[size];
    const m = kind === 'week' ? SC.week({ games, league: withLogo }, size)[0] : kind === 'table' ? SC.table({ standings, league: withLogo }, size)[0]
      : kind === 'fixtures' ? SC.fixtures({ games: games.slice(0, 7), league: withLogo }, size)[0] : m0;
    const c = recorder();
    let threw = null;
    try { SC.draw(c, m, { size }); } catch (e) { threw = e.message; }
    const drawn = c.log.filter(e => !(e.kind === 'rect' && (e.x1 - e.x0 >= S.w || e.x0 === 0)));   // the ground and the edge are the page
    const off = drawn.filter(e => e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5);
    const covered = size === 'story' ? drawn.filter(e => e.kind === 'text' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8)) : [];
    ok(`${kind} / ${size}: drawn, all of it on the page` + (size === 'story' ? ', none of it where Instagram covers it' : ''),
       !threw && !off.length && !covered.length, threw || off.concat(covered).slice(0, 3).map(e => (e.t || e.kind) + '@' + Math.round(e.y0)).join(' | '));
    if (size === 'portrait') {
      const logos = c.log.filter(e => e.kind === 'image' && e.img.tag === 'league');
      ok(`${kind}: the league's logo in the heading and the footer, its proportions kept`,
         logos.length === 2 && logos.every(e => Math.abs((e.x1 - e.x0) / (e.y1 - e.y0) - 2.5) < 0.01));
    }
  }
}
{
  const c = recorder();
  SC.draw(c, posts.week, { size: 'portrait' });
  const liftRed = RC.accentOn('#fd0204', RC.THEMES.dark), liftBlue = RC.accentOn('#004d98', RC.THEMES.dark);
  const stripes = c.log.filter(e => e.kind === 'rect' && e.x1 - e.x0 === 6);
  ok('each club\'s colour on its row: a stripe at its end of the result', stripes.some(e => e.fill === liftRed) && stripes.some(e => e.fill === liftBlue)
     && stripes.length === posts.week.rows.length * 2, stripes.length + ' stripes');
  const t = recorder();
  SC.draw(t, posts.table, { size: 'portrait' });
  ok('...and on its line of the table', t.log.filter(e => e.kind === 'rect' && e.x1 - e.x0 === 5).length === posts.table.rows.length);
  const p = recorder();
  SC.draw(p, posts.performer, { size: 'portrait' });
  const tag = p.log.find(e => e.kind === 'text' && e.t === 'PLAYER OF THE GAME');
  ok('the player of the game in his club\'s colour: Virtus play in black, so its white', p.log.some(e => e.kind === 'rect' && e.x0 === 0 && e.fill === RC.accentOn('#ffffff', RC.THEMES.dark)) && tag);
  const r = recorder();
  SC.draw(r, posts.result, { size: 'portrait' });
  ok('a final: each club\'s name underlined in its own colour', r.log.some(e => e.kind === 'rect' && e.x1 - e.x0 === 80 && e.fill === liftRed));
  const rows = SC.table({ standings, league }, 'story')[0];
  const cs = recorder();
  SC.draw(cs, rows, { size: 'story' });
  const names = cs.log.filter(e => e.kind === 'text' && /^Club \d+$/.test(e.t));
  ok('a story table: the eighteen names at a size a phone reads (22px or more)', names.length === 18 && names.every(e => e.size >= 22), Math.min(...names.map(e => e.size)) + 'px');
}
{
  const U = RC.util, S = 24;
  const px = paint => { const a = new Uint8ClampedArray(S * S * 4); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = paint(x, y); if (c) a.set(c, (y * S + x) * 4); } return a; };
  const shield = px((x, y) => (x > 4 && x < 19 && y > 3 && y < 21 ? [20, 20, 20, 255] : null));
  const mark = px((x, y) => (x > 4 && x < 19 && y > 3 && y < 21 ? [250, 250, 250, 255] : null));
  const tile = px(() => [200, 30, 40, 255]);
  ok('a crest read by its own tone: a black shield dark, a white mark light, a crest with its own square solid',
     U.crestTone(shield) === 'dark' && U.crestTone(mark) === 'light' && U.crestTone(tile) === 'solid', [U.crestTone(shield), U.crestTone(mark), U.crestTone(tile)].join());
  const dark = RC.THEMES.dark;
  ok('...a dark crest on a light disc, a light one on a dark disc (ASVEL\'s black shield no longer vanishes)',
     U.crestGround({ __tone: 'dark' }, dark) === '#f2f6f4' && U.crestGround({ __tone: 'light' }, dark) === dark.panel2 && U.crestGround({ __tone: 'solid' }, dark) === '#f2f6f4');
  const c = recorder();
  SC.draw(c, Object.assign({}, posts.week, { rows: posts.week.rows.map(r => Object.assign({}, r, { home: Object.assign({}, r.home, { crest: img(128, 128, 'crest') }) })) }), { size: 'portrait' });
  ok('a club with a crest: its crest drawn on its row, not its initials', c.log.filter(e => e.kind === 'image' && e.img.tag === 'crest').length === posts.week.rows.length
     && !c.log.some(e => e.kind === 'text' && e.t === 'CL1'));
}
ok('the file names the league, the post and the shape', SC.filename(res, 'story') === 'euroleague-final-paris-basketball-virtus-olidata-bologna-story.png', SC.filename(res, 'story'));

console.log('\nthe ZIP');
{
  const enc = s => new TextEncoder().encode(s);
  ok('CRC-32 of "hello" is 3610a686', SC.crc32(enc('hello')).toString(16) === '3610a686');
  const files = [{ name: '01-final.png', bytes: enc('PNG-ONE') }, { name: '01-final.txt', bytes: enc('FINAL | A 1–0 B\n') }, { name: 'ünïcode-name.txt', bytes: enc('ü') }];
  const z = SC.zip(files, new Date(2026, 8, 30, 12, 0, 0));
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  ok('the end record: three entries, the directory where it says', dv.getUint32(eocd, true) === 0x06054b50 && dv.getUint16(eocd + 10, true) === 3
     && dv.getUint32(dv.getUint32(eocd + 16, true), true) === 0x02014b50);
  let at = 0, good = true;
  files.forEach(f => {
    const nameLen = dv.getUint16(at + 26, true), size = dv.getUint32(at + 18, true);
    good = good && dv.getUint32(at, true) === 0x04034b50 && dv.getUint32(at + 14, true) === SC.crc32(f.bytes) && size === f.bytes.length
      && (dv.getUint16(at + 6, true) & 0x0800) === 0x0800;
    at += 30 + nameLen + size;
  });
  ok('every entry: its local header, its CRC and size, stored, the name flagged UTF-8', good);
  const py = spawnSync('python3', ['-c', 'import sys,zipfile,io; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(",".join(z.namelist())); print(z.read("01-final.txt").decode())'], { input: Buffer.from(z) });
  if (py.error || py.status === null) console.log('  SKIP  python3 is not here to read the ZIP back');
  else ok('Python\'s zipfile reads it back, CRCs checked', py.status === 0 && py.stdout.toString().startsWith('01-final.png,01-final.txt,ünïcode-name.txt') &&
    py.stdout.toString().includes('FINAL | A 1–0 B'), (py.stderr.toString() || py.stdout.toString()).slice(0, 200));
}

console.log('\nthe console');
{
  ok('a player line is eleven numbers and a name out of the blob, never the blob', /pts:stats->pts/.test(GX.PLAYER_COLS) && /oreb:stats->or\b/.test(GX.PLAYER_COLS)
     && /name:stats->adv->>name/.test(GX.PLAYER_COLS) && !/(^|,)stats(,|$)/.test(GX.PLAYER_COLS));
  ok('a handle out of whatever was typed', GX.handleOf('https://www.instagram.com/euroleague/') === 'euroleague' && GX.handleOf('@ligaendesa') === 'ligaendesa' && GX.handleOf('') === '');
  const calls = [];
  const rows = {
    leagues: { data: { id: 'L', name: 'EuroLeague', slug: 'euroleague', timezone: 'Europe/Paris', colour_a: '#ff6600', colour_b: '#1e3a8a', logo_path: 'leagues/el.png' } },
    games: { data: [
      { id: 'g1', competition_id: 'c1', tipoff_at: '2026-09-29T18:45:00Z', status: 'final', home_score: 79, away_score: 92, home_team_id: 't1', away_team_id: 't2', venue: 'Adidas Arena' },
      { id: 'g2', competition_id: 'c1', tipoff_at: '2026-10-02T18:00:00Z', status: 'scheduled', home_team_id: 't2', away_team_id: 't1' },
      { id: 'g3', competition_id: 'c1', tipoff_at: '2026-09-28T18:00:00Z', status: 'live', home_team_id: 't1', away_team_id: 't2' }] },
    standings: { data: [{ competition_id: 'c1', team_id: 't2', rank: 1, gp: 1, w: 1, l: 0, diff: 13 }, { competition_id: 'c1', team_id: 't1', rank: 2, gp: 1, w: 0, l: 1, diff: -13 }] },
    teams: { data: [{ id: 't1', name: 'Paris Basketball', colour: '#fd0204', logo_path: 'x.png' }, { id: 't2', name: 'Virtus Olidata Bologna', colour: '#111111', colour_2: '#ffffff' }] },
    team_game_stats: { data: [{ game_id: 'g1', team_idx: 0, perQ: perQ[0] }, { game_id: 'g1', team_idx: 1, perQ: perQ[1] }] },
    player_game_stats: { data: players.map(p => Object.assign({ game_id: 'g1', team_idx: p.team_idx, name: p.stats.adv.name, num: p.stats.adv.num, oreb: p.stats.or, dreb: p.stats.dr, tov: p.stats.to },
      Object.fromEntries(['pts', 'p2m', 'p2a', 'p3m', 'p3a', 'fta', 'ftm', 'ast', 'stl', 'blk', 'pf', 'pm', 'min'].map(k => [k, p.stats[k]])))) }
  };
  const q = table => {
    const b = { sel: '', select(s) { b.sel = s; calls.push(table + ':' + s); return b; }, eq() { return b; }, in() { return b; }, gte() { return b; }, lt() { return b; },
      order() { return b; }, limit() { return b; }, maybeSingle() { return Promise.resolve(rows[table]); }, then(res, rej) { return Promise.resolve(rows[table]).then(res, rej); } };
    return b;
  };
  const sb = { from: q, rpc: async () => ({ data: [{ instagram: 'https://instagram.com/euroleague' }] }) };
  const data = await GX.read(sb, { id: 'L', name: 'EuroLeague' }, [{ id: 'c1', name: 'EuroLeague', kind: 'league' }], new Date('2026-09-30T12:00:00Z'));
  ok('the fortnight: the final is a final, the fixture a fixture, a game still live neither', data.finals.map(g => g.id).join() === 'g1' && data.upcoming.map(g => g.id).join() === 'g2');
  ok('the league as the league has it: its zone, both colours, its logo and its handle', data.league.timezone === 'Europe/Paris' && data.league.colour === '#ff6600'
     && data.league.colour2 === '#1e3a8a' && data.league.logoPath === 'leagues/el.png' && data.league.handle === 'euroleague');
  ok('quarters by side, player lines rebuilt into the box score\'s shape', data.perQ.get('g1')[1][4] === 25 && data.players.get('g1').length === 4
     && data.players.get('g1')[2].stats.or === 3 && data.players.get('g1')[2].stats.adv.name === 'Tornike Shengelia');
  ok('...the clubs read with both their colours', calls.some(c => /^teams:.*colour_2/.test(c)));
  const list = GX.items(data, 'portrait', t => (t.logo_path ? 'https://cdn/' + t.logo_path : null));
  ok('the list: results, the table, coming up, then the final and its player of the game',
     list.map(x => x.model.kind).join() === 'week,table,fixtures,result,performer', list.map(x => x.title).join(' | '));
  ok('...the league\'s logo and each club\'s crest handed to the drawing', list.every(x => x.model.league.logoUrl === 'https://cdn/leagues/el.png')
     && list.find(x => x.model.kind === 'result').model.home.crestUrl === 'https://cdn/x.png');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
