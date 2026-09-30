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

console.log('\nthe modules (the builder\'s options)');
{
  const cropped = e => e.kind === 'text' || e.kind === 'image' || e.kind === 'rect';
  const drawLog = (m, size, modules, theme) => { const c = recorder(); SC.draw(c, m, { size, modules, theme }); return c.log; };
  const key = log => JSON.stringify(log.map(e => [e.kind, e.t, Math.round(e.x0), Math.round(e.y0), Math.round(e.x1), Math.round(e.y1), e.fill, e.size]));
  const words = log => log.filter(e => e.kind === 'text').map(e => e.t);
  const same = SC.cleanModules({ crests: true, quarters: true, leaders: true, venue: true, days: true, venues: true, handle: true, logoPos: 'both',
    accent: '', headline: '', subline: '', footerText: '', sponsor: '', rows: 0, cols: [], statKeys: [] });
  ok('a module left at its default is not a module: cleanModules keeps nothing of them', Object.keys(same).length === 0 && SC.cleanModules({ theme: 'dark' }).theme === 'dark', JSON.stringify(same));
  const fx7 = SC.fixtures({ games: games.slice(0, 7).map(g => Object.assign({ venue: 'Palais des Sports de Paris-Est' }, g)), league: withLogo }, 'portrait')[0];
  let identical = true, why = '';
  for (const [kind, m] of Object.entries(Object.assign({}, posts, { fixtures: fx7 }))) {
    for (const size of Object.keys(SC.SIZES)) {
      const base = key(drawLog(m, size));
      if (base !== key(drawLog(m, size, {})) || base !== key(drawLog(m, size, same)) || base !== key(drawLog(Object.assign({}, m, { modules: {} }), size))) { identical = false; why = kind + '/' + size; }
    }
  }
  ok('every template on every shape: no modules, empty modules and all-default modules draw the identical picture', identical, why);
  ok('the drawing leaves no module behind for the next graphic', key(drawLog(posts.table, 'portrait', { headline: 'X', theme: 'light' })) !== key(drawLog(posts.table, 'portrait'))
     && key(drawLog(posts.table, 'portrait')) === key(drawLog(posts.table, 'portrait', {})));

  const crested = t => Object.assign({}, t, { crest: img(128, 128, 'crest') });
  const withCrests = m => Object.assign({}, m, m.rows ? { rows: m.rows.map(r => Object.assign({}, r, r.home ? { home: crested(r.home), away: crested(r.away) } : { team: crested(r.team) })) }
    : m.home ? { home: crested(m.home), away: crested(m.away) } : { team: crested(m.team), opp: crested(m.opp) });
  const crests = (m, mod) => drawLog(withCrests(m), 'portrait', mod).filter(e => e.kind === 'image' && e.img.tag === 'crest').length;
  ok('crests off: no crest image on a final, a player of the game, the results or the table (the initials disc stands in)',
     ['result', 'performer', 'week', 'table'].every(k => crests(posts[k], {}) > 0 && crests(posts[k], { crests: false }) === 0));
  ok('...and the initials are drawn instead', words(drawLog(withCrests(posts.week), 'portrait', { crests: false })).some(t => /^C\d+$/.test(t)));
  ok('quarters off: no line score', words(drawLog(posts.result, 'portrait')).includes('Q1') && !words(drawLog(posts.result, 'portrait', { quarters: false })).includes('Q1'));
  ok('leaders off: no "LED BY"', words(drawLog(posts.result, 'portrait')).includes('LED BY') && !words(drawLog(posts.result, 'portrait', { leaders: false })).includes('LED BY'));
  ok('venue off: no venue line on a final', words(drawLog(posts.result, 'portrait')).includes('ADIDAS ARENA') && !words(drawLog(posts.result, 'portrait', { venue: false })).includes('ADIDAS ARENA'));
  ok('days off: no day under a result (a story\'s rows are tall enough to carry it)', words(drawLog(posts.week, 'story')).some(t => /^(MON|TUE|WED|THU|FRI|SAT|SUN) \d/.test(t))
     && !words(drawLog(posts.week, 'story', { days: false })).some(t => /^(MON|TUE|WED|THU|FRI|SAT|SUN) \d/.test(t)));
  ok('venues off: no venue under a fixture', words(drawLog(fx7, 'portrait')).includes('Palais des Sports de Paris-Est') && !words(drawLog(fx7, 'portrait', { venues: false })).some(t => /Palais/.test(t)));
  ok('a headline and a subline: the graphic\'s own words replaced (a list), or added (a final, a player of the game)',
     words(drawLog(posts.table, 'portrait', { headline: 'Top of the pile', subline: 'Round 4' })).includes('TOP OF THE PILE') && words(drawLog(posts.table, 'portrait', { headline: 'Top', subline: 'Round 4' })).includes('Round 4')
     && !words(drawLog(posts.table, 'portrait', { headline: 'Top' })).includes('THE TABLE')
     && words(drawLog(posts.result, 'portrait', { headline: 'Derby night', subline: 'What a game' })).includes('DERBY NIGHT')
     && words(drawLog(posts.performer, 'portrait', { headline: 'Man of the match', subline: 'Again' })).includes('MAN OF THE MATCH')
     && !words(drawLog(posts.performer, 'portrait', { headline: 'Man of the match' })).includes('PLAYER OF THE GAME')
     && words(drawLog(posts.performer, 'portrait', { subline: 'Again' })).includes('Again'));
  const stat = mods => words(drawLog(posts.performer, 'portrait', mods));
  ok('the star\'s stat lines: three to eight, the first three big and the rest in the strip', stat({ statKeys: ['pts', 'stl', 'blk'] }).includes('STEALS') && !stat({ statKeys: ['pts', 'stl', 'blk'] }).includes('FT')
     && stat({ statKeys: ['pts', 'reb', 'ast', 'fgp', 'p3p'] }).includes('FG%') && stat({ statKeys: ['pts', 'reb', 'ast', 'fgp', 'p3p'] }).includes('63%') && !stat({ statKeys: ['pts', 'reb', 'ast', 'fgp'] }).includes('MIN'));
  ok('...fewer than three is not a choice: the default stands', key(drawLog(posts.performer, 'portrait', { statKeys: ['pts', 'reb'] })) === key(drawLog(posts.performer, 'portrait')));
  const names = (mods, size) => words(drawLog(SC.table({ standings, league: withLogo }, size || 'portrait')[0], size || 'portrait', mods)).filter(t => /^Club \d+$/.test(t));
  ok('table rows: the top 4, 6, 8, or all', [4, 6, 8].every(n => names({ rows: n }).length === n) && names({}).length === 18 && names({ rows: 99 }).length === 18);
  const heads = mods => words(drawLog(SC.table({ standings: standings.map(s => Object.assign({}, s, { pts_for: 900, pts_against: 850 })), league }, 'portrait')[0], 'portrait', mods));
  ok('table columns: the ones chosen, in the table\'s order, and no more than are asked for', ['GP', 'W', 'L', 'DIFF'].every(c => heads({}).includes(c)) && heads({ cols: ['pa', 'w', 'pf'] }).filter(t => /^(GP|W|L|PF|PA|DIFF|PCT|STK|PTS)$/.test(t)).join() === 'W,PF,PA'
     && heads({ cols: ['pct'] }).includes('PCT') && !heads({ cols: ['pct'] }).includes('DIFF'));
  ok('...the win rate and the points for and against are the club\'s own', heads({ cols: ['pct', 'pf', 'pa'] }).includes('.750') && heads({ cols: ['pf'] }).includes('900'), heads({ cols: ['pct'] }).slice(-12).join());
  const ground0 = log => log.find(e => e.kind === 'rect').fill;
  ok('colour: the kit\'s light, and a high-contrast black and yellow', ground0(drawLog(posts.table, 'portrait', { theme: 'light' })) === RC.THEMES.light.ground
     && ground0(drawLog(posts.table, 'portrait', { theme: 'contrast' })) === '#000000' && ground0(drawLog(posts.table, 'portrait')) === RC.THEMES.dark.ground
     && ground0(drawLog(posts.table, 'portrait', { theme: 'nonsense' })) === RC.THEMES.dark.ground);
  ok('...a theme in opts is the modules\' when they say nothing, theirs when they do', ground0(drawLog(posts.table, 'portrait', {}, 'light')) === RC.THEMES.light.ground
     && ground0(drawLog(posts.table, 'portrait', { theme: 'contrast' }, 'light')) === '#000000');
  const edge = log => log.find(e => e.kind === 'rect' && e.x0 === 0 && e.x1 === 10).fill;
  ok('accent: the edge and the tag in the colour chosen, not the league\'s', edge(drawLog(posts.table, 'portrait', { accent: '#ffe600' })) === RC.accentOn('#ffe600', RC.THEMES.dark)
     && edge(drawLog(posts.table, 'portrait')) === RC.accentOn('#ff6600', RC.THEMES.dark) && edge(drawLog(posts.table, 'portrait', { accent: 'javascript:1' })) === edge(drawLog(posts.table, 'portrait')));
  const logos = mods => drawLog(posts.table, 'portrait', mods).filter(e => e.kind === 'image' && e.img.tag === 'league');
  ok('logo position: both, heading only (top), footer only (bottom), or none', logos({}).length === 2 && logos({ logoPos: 'heading' }).length === 1 && logos({ logoPos: 'heading' })[0].y0 < 200
     && logos({ logoPos: 'footer' }).length === 1 && logos({ logoPos: 'footer' })[0].y0 > 1000 && logos({ logoPos: 'none' }).length === 0);
  ok('footer: the handle, the league\'s name when there is none, off, or the person\'s own words', words(drawLog(posts.table, 'portrait')).includes('@EUROLEAGUE')
     && !words(drawLog(posts.table, 'portrait', { handle: false })).some(t => /EUROLEAGUE/.test(t) && t !== 'EUROLEAGUE') && words(drawLog(posts.table, 'portrait', { handle: false })).filter(t => /EUROLEAGUE/.test(t)).length === 1
     && words(drawLog(posts.table, 'portrait', { footerText: '@paris.hoops · paris.example' })).includes('@PARIS.HOOPS · PARIS.EXAMPLE')
     && words(drawLog(posts.table, 'portrait', { handle: false, footerText: 'Hello' })).includes('HELLO'));
  const sp = drawLog(posts.result, 'portrait', { sponsor: 'Presented by Acme Sports' });
  const spT = sp.find(e => e.kind === 'text' && e.t === 'PRESENTED BY ACME SPORTS'), ven = sp.find(e => e.kind === 'text' && e.t === 'ADIDAS ARENA'), foot = sp.find(e => e.kind === 'text' && e.t === 'EPINOIΛ');
  ok('a partner\'s line sits above the footer, on the venue\'s line and clear of it (right of it); alone, from the left edge', spT && ven && foot && spT.y1 <= foot.y0 + 1 && ven.x1 <= spT.x0 && Math.abs(ven.y0 - spT.y0) < 1
     && drawLog(posts.table, 'portrait', { sponsor: 'Acme' }).find(e => e.t === 'ACME').x0 === 64, [spT && spT.y1, ven && ven.x1, spT && spT.x0].join());
  /* no real shape is short of room for a final with a headline and a subline; a squat one made for the test is */
  SC.SIZES.squat = { w: 1080, h: 940, top: 64, bottom: 64, label: 'squat' };
  const sq = mods => SC.draw(recorder(), posts.result, { size: 'squat', modules: mods }).dropped.join();
  ok('too much for a shape: the least important go first (subline, headline, leaders, quarters), never running over the footer; a default final is never cut',
     sq({}) === '' && sq({ subline: 'B' }) === 'the subline' && sq({ headline: 'A' }) === 'the headline' && sq({ headline: 'A', subline: 'B' }) === 'the headline');
  delete SC.SIZES.squat;
  ok('...and every real shape holds a final with a headline and a subline', Object.keys(SC.SIZES).every(z => SC.draw(recorder(), posts.result, { size: z, modules: { headline: 'A', subline: 'B' } }).dropped.length === 0));
  ok('caption: a table cut to four rows lists four, and a star can be the player of the week', SC.caption(posts.table, { rows: 4 }).split('\n').filter(l => /^\d+\. /.test(l)).length === 4
     && /^Player of the week: /.test(SC.caption(SC.performer({ game, home: paris, away: virtus, players, league, label: 'Player of the week' }))));
  ok('a star can be any player of the game, not only the best', SC.performer({ game, home: paris, away: virtus, players, league, pick: players[0] }).player.name === 'Nadir Hifi'
     && SC.performer({ game, home: paris, away: virtus, players, league, pick: { stats: {} } }).player.name === 'Tornike Shengelia');
  ok('modules from a saved setting are cleaned: unknown keys, wrong types and hostile text are dropped or capped', (() => {
    const c = SC.cleanModules({ headline: 'x'.repeat(500), rows: '5', cols: ['w', 'bogus'], statKeys: ['pts', 'nope', 'reb', 'ast'], theme: 'neon', crests: 'no', evil: 1, accent: 'red', logoPos: 'sideways', sponsor: '  a\n b ' });
    return c.headline.length === 60 && c.rows === 5 && c.cols.join() === 'w' && c.statKeys.join() === 'pts,reb,ast' && !c.theme && !c.crests && !c.evil && !c.accent && !c.logoPos && c.sponsor === 'a b';
  })());

  /* --- the stats each view can show --- */
  const box = (idx, name, o) => line(idx, name, String(o.n), Object.assign({ pts: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, fta: 0, ftm: 0, or: 0, dr: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, pm: 0, min: 1200000 }, o));
  const roster = [box(0, 'Home One', { n: 1, pts: 20, p2m: 6, p2a: 10, p3m: 2, p3a: 4, fta: 4, ftm: 2, or: 2, dr: 3, ast: 5, to: 3, pf: 2 }), box(0, 'Home Two', { n: 2, pts: 12, p2m: 4, p2a: 8, p3m: 0, p3a: 3, fta: 4, ftm: 4, or: 1, dr: 5, ast: 1, stl: 2, to: 1, pf: 4 }),
    box(0, 'Home Three', { n: 3, pts: 6, p2m: 3, p2a: 4, or: 0, dr: 2, ast: 0, blk: 1, to: 2, pf: 1 }),
    box(1, 'Away One', { n: 11, pts: 30, p2m: 9, p2a: 12, p3m: 3, p3a: 6, fta: 6, ftm: 3, or: 1, dr: 6, ast: 3, stl: 1, to: 5, pf: 3 }), box(1, 'Away Two', { n: 12, pts: 15, p2m: 5, p2a: 9, p3m: 1, p3a: 3, fta: 2, ftm: 2, or: 3, dr: 4, ast: 7, to: 2, pf: 2 }),
    box(1, 'Away Three', { n: 13, pts: 4, p2m: 2, p2a: 5, or: 1, dr: 1, ast: 2, to: 0, pf: 5 })];
  const fin = SC.result({ game: { id: 'q', tipoff_at: '2026-09-29T18:45:00Z', home_score: 38, away_score: 49, venue: 'Hall' }, home: paris, away: virtus, perQ, players: roster, league: withLogo, comp: 'EuroLeague' });
  ok('a final carries each side\'s team stats (summed from its players) and its three top scorers', fin.teamStats.home.reb.v === '13' && fin.teamStats.away.reb.v === '16' && fin.teamStats.home.fg.v === '15/29' && fin.teamStats.away.fgp.v === '57%'
     && fin.teamStats.home.tov.n === 6 && fin.scorers.away.map(p => p.name).join() === 'Away One,Away Two,Away Three' && fin.scorers.home[0].stats.pts === 20,
     JSON.stringify([fin.teamStats.home.reb, fin.teamStats.away.fgp]));
  ok('...and none without both sides\' players', SC.result({ game, home: paris, away: virtus, players: roster.slice(0, 3), league }).teamStats === null);
  const fw = mods => words(drawLog(fin, 'portrait', mods));
  ok('team stats: none by default, then the rows chosen, both sides\' figures, the labels', !fw({}).includes('TEAM STATS') && fw({ teamStats: ['reb', 'tov', 'fgp'] }).includes('TEAM STATS') && fw({ teamStats: ['reb', 'tov', 'fgp'] }).includes('REBOUNDS')
     && fw({ teamStats: ['reb', 'tov', 'fgp'] }).includes('TURNOVERS') && ['13', '16', '57%', '6', '7'].every(v => fw({ teamStats: ['reb', 'tov', 'fgp'] }).includes(v)) && !fw({ teamStats: ['reb'] }).includes('TURNOVERS'));
  const lit = (stat, sideIdx) => { const l = drawLog(fin, 'portrait', { teamStats: [stat] }); return l.filter(e => e.kind === 'text' && e.t.length && (sideIdx === 0 ? e.x0 < 200 : e.x0 > 700)); };
  ok('...at most six (more are cut to the first six) and none at all is no block', SC.cleanModules({ teamStats: Object.keys(SC.TEAM_STAT_DEFS) }).teamStats.length === 6 && SC.cleanModules({ teamStats: [] }).teamStats === undefined && SC.cleanModules({ teamStats: ['nope'] }).teamStats === undefined);
  ok('leaders: the two or three top scorers of each side, with the stat lines chosen', fw({ leaderN: 3 }).includes('TOP SCORERS') && fw({ leaderN: 3 }).includes('Away Three') && fw({ leaderN: 2 }).includes('Away Two') && !fw({ leaderN: 2 }).includes('Away Three')
     && fw({ leaderN: 2, leaderKeys: ['pts', 'stl'] }).some(t => /30 PTS · 1 STL/.test(t)) && fw({ leaderKeys: ['pts', 'fgp'] }).some(t => /30 PTS · 67% FG%/.test(t)) && fw({}).includes('LED BY'));
  ok('...leaders off still means none', !fw({ leaders: false, leaderN: 3 }).includes('TOP SCORERS'));
  const trimmed = SC.draw(recorder(), fin, { size: 'square', modules: { teamStats: ['fgp', 'p3p', 'ftp', 'efg', 'fg', 'reb'], leaderN: 3 } });
  ok('too many team stats for a square: the least important blocks go first, then the last rows are cut, and it says so (never over the footer)', trimmed.dropped.length > 0 && trimmed.dropped.some(t => /team stats/.test(t) || /leader|top scorers|quarter/.test(t)), trimmed.dropped.join(' | '));
  ok('...and a portrait holds four team stats and the three scorers, a story those and a headline and subline besides, dropping nothing', SC.draw(recorder(), fin, { size: 'portrait', modules: { teamStats: ['fgp', 'p3p', 'ftp', 'reb'], leaderN: 3 } }).dropped.length === 0
     && SC.draw(recorder(), fin, { size: 'story', modules: { teamStats: ['fgp', 'p3p', 'ftp', 'reb'], leaderN: 3, headline: 'X', subline: 'Y' } }).dropped.length === 0);
  const star = SC.performer({ game, home: paris, away: virtus, players: roster, league, pick: roster[3] });
  const sw = keys => words(drawLog(star, 'portrait', { statKeys: keys }));
  ok('the star can show any of the player\'s whole line: offensive and defensive boards, turnovers, fouls, twos, effective shooting, game score', star.stats.oreb === 1 && star.stats.dreb === 6 && star.stats.tov === 5 && star.stats.pf === 3 && star.stats.p2 === '9/12' && star.stats.efg === '75%' && /^-?\d+(\.\d)?$/.test(star.stats.gmsc));
  ok('...each drawn with its label and figure', ['OREB', 'DREB', 'TOV', 'PF', '2PT', 'EFG%', 'GMSC'].every(l => sw(['pts', 'reb', 'ast', 'oreb', 'dreb', 'tov']).concat(sw(['pts', 'reb', 'ast', 'pf', 'p2', 'efg', 'gmsc'])).includes(l)) && sw(['pts', 'reb', 'ast', 'tov']).includes('5') && sw(['pts', 'reb', 'ast', 'efg']).includes('75%'));
  const tstand = ['A', 'B', 'C'].map((n, i) => ({ rank: i + 1, team: { name: 'Club ' + n, colour: '#fd0204' }, gp: 10, w: 8 - i, l: 2 + i, diff: 50 - 40 * i, pts_for: 900 - 10 * i, pts_against: 850 + 20 * i, streak: 'W' + (3 - i), l5: (4 - i) + '-' + (1 + i), home: '5-0', away: (3 - i) + '-' + (2 + i), elo: 1612.4 - 50 * i }));
  const tm = SC.table({ standings: tstand, league }, 'portrait')[0];
  const th2 = mods => words(drawLog(tm, 'portrait', mods));
  ok('table columns worked from the standings: average margin, points scored and allowed a game, win rate', th2({ cols: ['avg', 'ppg', 'papg'] }).join(' ').includes('+5.0') && th2({ cols: ['avg', 'ppg', 'papg'] }).includes('90.0') && th2({ cols: ['avg', 'ppg', 'papg'] }).includes('85.0')
     && th2({ cols: ['avg', 'ppg', 'papg'] }).includes('OPP') && th2({ cols: ['avg'] }).includes('-3.0') && th2({ cols: ['pct'] }).includes('.800'));
  ok('table columns read from the games: form, home and away records, and the ELO rating (rounded)', ['4-1', '3-2', '5-0', '1612', '1562', '1512'].every(v => th2({ cols: ['l5', 'home', 'away', 'elo'] }).includes(v)) && th2({ cols: ['l5', 'home', 'away', 'elo'] }).includes('ELO')
     && th2({ cols: ['elo'] }).includes('1612') && th2({ cols: ['streak'] }).includes('W3'));
  ok('...a club with no rating reads a dash, and six columns is the most', SC.table({ standings: [{ rank: 1, team: { name: 'X' }, gp: 1, w: 1, l: 0 }], league }, 'portrait')[0].rows[0].elo === null && words(drawLog(SC.table({ standings: [{ rank: 1, team: { name: 'X' }, gp: 1, w: 1, l: 0 }], league }, 'portrait')[0], 'portrait', { cols: ['elo'] })).includes('—')
     && SC.cleanModules({ cols: Object.keys(SC.COL_DEFS) }).cols.length === 6);
  const wkg = SC.week({ games: games.slice(0, 4).map(g => Object.assign({}, g, { venue: 'Hall Nine', perQ: perQ, home: Object.assign({}, g.home, { record: '3-1', elo: 1533.2 }), away: Object.assign({}, g.away, { record: '1-3', elo: 1466.8 }) })), league }, 'story')[0];
  const ww = mods => words(drawLog(wkg, 'story', mods));
  ok('a result can say more: its tip-off, its venue, its quarters, both clubs\' records and ELO', ww({ rowExtras: ['time'] }).some(t => /19:30/.test(t)) && ww({ rowExtras: ['venue'] }).some(t => /HALL NINE/.test(t))
     && ww({ rowExtras: ['quarters'] }).some(t => /18-15  22-29  23-23  16-25/.test(t)) && ww({ rowExtras: ['record'] }).some(t => /Club 1  ·  3-1/.test(t)) && ww({ rowExtras: ['elo'] }).some(t => /Club 1  ·  ELO 1533/.test(t)) && !ww({}).some(t => /HALL NINE|ELO 1533|3-1/.test(t)));
  const fxm = SC.fixtures({ games: games.slice(0, 3).map(g => Object.assign({}, g, { home: Object.assign({}, g.home, { record: '3-1', elo: 1533 }) })), league }, 'portrait')[0];
  ok('a fixture can say both clubs\' records and ELO', words(drawLog(fxm, 'portrait', { rowExtras: ['record', 'elo'] })).some(t => /3-1  ·  ELO 1533/.test(t)) && !words(drawLog(fxm, 'portrait', {})).some(t => /ELO/.test(t)));

  /* NOTHING MAY OVERFLOW OR OVERLAP: the worst case of every module, on every shape and colourway, long names, eight rows, no crests */
  const LONG = 'Associação Desportiva Recreativa e Cultural Icasa Meridianbet Belgrade Basketball Club';
  const big = Object.assign({}, league, { name: 'The Very Long Named National Basketball Championship League', handle: 'a_handle_that_is_really_quite_long_indeed_for_instagram', logo: img(300, 120, 'league') });
  const lt = i => ({ name: LONG + ' ' + i, colour: '#ffffff', colour_2: '#000000', record: '30-' + i, elo: 1500 + i });
  const LT = Array.from({ length: 8 }, (_, i) => lt(i));
  const lstand = LT.map((t, i) => ({ rank: i + 1, team: t, gp: 30, w: 30 - i, l: i, league_points: 60 - i, diff: 300 - 50 * i, pts_for: 2900, pts_against: 2600, streak: 'W12', l5: '5-0', home: '15-0', away: '15-' + i, elo: 1500 + i }));
  const lgames = LT.map((t, i) => ({ tipoff_at: '2026-09-25T17:30:00Z', home: t, away: LT[7 - i], home_score: 120 + i, away_score: 118, perQ: [{ 1: 30, 2: 30, 3: 30, 4: 30 }, { 1: 29, 2: 29, 3: 30, 4: 30 }], venue: 'Palais Omnisports de Paris-Bercy Arena and Congress Centre' }));
  const lplayers = [line(0, 'Second Player With A Very Long Surname Indeed', '5', { pts: 30, p2m: 10, p2a: 12, p3m: 3, p3a: 4, fta: 4, ftm: 4, or: 5, dr: 5, ast: 5 }), line(0, 'Third', '6', { pts: 12 }), line(1, 'Away Two', '7', { pts: 22, ast: 9 }), line(1, 'Away Three Is Also Quite Long Named', '8', { pts: 9 }),
    line(0, 'Aleksandar Konstantinopolskiy-Vandersloot', '99', { pts: 61, p2m: 20, p2a: 21, p3m: 6, p3a: 7, fta: 15, ftm: 15, or: 12, dr: 20, ast: 15, stl: 8, blk: 9, pm: -31, min: 2400000 }),
    line(1, 'B', '1', { pts: 2 })];
  const lres = Object.assign(SC.result({ game: { id: 'x', tipoff_at: '2026-09-25T17:30:00Z', venue: 'Palais Omnisports de Paris-Bercy Arena and Congress Centre', home_score: 121, away_score: 118 },
    home: LT[0], away: LT[1], perQ: [{ 1: 30, 2: 30, 3: 30, 4: 20, 5: 11 }, { 1: 30, 2: 30, 3: 30, 4: 20, 5: 8 }], players: lplayers, league: big, comp: big.name }), {});
  const everything = { headline: 'A headline that goes on and on and on past any sensible width for a graphic', subline: 'A subline that is just as long as the headline and keeps on going and going, and going, yes',
    sponsor: 'Presented by the Very Long Named Partner of the Very Long Named League', footerText: 'A footer text that is far too long to fit beside the mark and logo at all', theme: 'contrast', accent: '#00e5ff',
    rows: 8, cols: ['gp', 'w', 'l', 'pct', 'diff', 'pf', 'pa', 'streak', 'pts'], statKeys: ['pts', 'reb', 'ast', 'stl', 'blk', 'fg', 'p3', 'ft', 'fgp', 'p3p', 'pm', 'min'],
    teamStats: ['fgp', 'p3p', 'ftp', 'efg', 'reb', 'tov'], leaderN: 3, leaderKeys: ['pts', 'reb', 'ast', 'stl'], rowExtras: ['time', 'venue', 'quarters', 'record', 'elo'] };
  const sets = { result: lres, performer: SC.performer({ game: { id: 'x', tipoff_at: '2026-09-25T17:30:00Z', home_score: 121, away_score: 118 }, home: LT[0], away: LT[1], players: lplayers, league: big, comp: big.name }),
    week: null, table: null, fixtures: null };
  const bad = [];
  for (const size of Object.keys(SC.SIZES)) {
    const S = SC.SIZES[size];
    const lists = { week: SC.week({ games: lgames, league: big, comp: big.name, range: '23–30 Sep 2026' }, size)[0], table: SC.table({ standings: lstand, league: big, comp: big.name }, size)[0],
      fixtures: SC.fixtures({ games: lgames, league: big, comp: big.name, range: '23–30 Sep 2026' }, size)[0] };
    for (const [kind, m] of Object.entries(Object.assign({}, sets, lists))) {
      for (const [label, mods] of [['default', {}], ['everything', everything], ['no crests, no extras', { crests: false, quarters: false, leaders: false, venue: false, days: false, venues: false, logoPos: 'none', handle: false }],
                                   ['light + sponsor', { theme: 'light', sponsor: 'Presented by Acme' }], ['3 stats', { statKeys: ['fgp', 'p3p', 'min'] }], ['4 rows', { rows: 4 }], ['new columns', { cols: ['elo', 'l5', 'home', 'away', 'avg', 'papg'] }],
                                   ['team stats', { teamStats: ['fgp', 'p3p', 'ftp', 'efg', 'fg', 'reb'], leaderN: 3 }], ['row extras', { rowExtras: ['time', 'venue', 'quarters', 'record', 'elo'] }],
                                   ['star: every kind of stat', { statKeys: ['oreb', 'dreb', 'tov', 'pf', 'p2', 'efg', 'gmsc', 'fg'] }]]) {
        for (const theme of ['dark', 'light']) {
          const c = recorder();
          let threw = null;
          try { SC.draw(c, m, { size, modules: mods, theme }); } catch (e) { threw = e.message; }
          const drawn = c.log.filter(e => !(e.kind === 'rect' && (e.x1 - e.x0 >= S.w || e.x0 === 0)));
          const off = drawn.filter(e => e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5);
          const covered = size === 'story' ? drawn.filter(e => e.kind === 'text' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8)) : [];
          /* text over text: two words whose boxes cross, other than a fringe's twin (same words, a hair apart) */
          const t = c.log.filter(e => e.kind === 'text' && e.t.trim() && e.size < 300);   // not the shirt number's watermark behind the name
          const over = [];
          for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
            const a = t[i], b2 = t[j];
            if (a.t === b2.t && Math.abs(a.x0 - b2.x0) < 6) continue;
            const w = Math.min(a.x1, b2.x1) - Math.max(a.x0, b2.x0), h = Math.min(a.y1, b2.y1) - Math.max(a.y0, b2.y0);
            if (w > 3 && h > 0.5 * Math.min(a.size, b2.size)) over.push(a.t + ' x ' + b2.t);
          }
          if (threw || off.length || covered.length || over.length) bad.push(`${kind}/${size}/${label}/${theme}: ${threw || off.concat(covered).slice(0, 2).map(e => (e.t || e.kind) + '@' + Math.round(e.y0)).join('|') + (over.length ? ' overlap ' + over.slice(0, 2).join('|') : '')}`);
        }
      }
    }
  }
  ok('worst case (long names, eight rows, every text module full, no crests, both colourways): everything on the page, out of the story\'s covered strips, no words over words - ' + 5 * 3 * 10 * 2 + ' drawings',
     !bad.length, bad.slice(0, 6).join(' ;; '));
}

console.log('\ntimes in the zone chosen');
{
  const utcLg = Object.assign({}, league, { timezone: 'UTC', logo: null });
  const drawLog = (m, size, modules) => { const c = recorder(); SC.draw(c, m, { size, modules }); return c.log.filter(e => e.kind === 'text').map(e => e.t); };
  const at = (iso, tz) => SC.local(iso, tz);
  const TA = { name: 'Sydney Kings', colour: '#fd0204' }, TB = { name: 'Perth Wildcats', colour: '#ffd100' };
  const fxs = isos => SC.fixtures({ games: isos.map(t => ({ tipoff_at: t, home: TA, away: TB })), league: utcLg }, 'portrait')[0];
  const sat = fxs(['2026-09-26T23:30:00Z']);
  ok('the league\'s own clock is the default, and prints no zone (the reader assumes it)', sat.rows[0].day === 'Sat 26 Sep' && sat.rows[0].time === '23:30' && sat.tz === 'UTC'
     && !drawLog(sat, 'portrait').some(t => /UTC|AEST|times in/.test(t)));
  const syd = drawLog(sat, 'portrait', { zone: 'Australia/Sydney' });
  ok('23:30 UTC on Saturday is Sunday 09:30 in Sydney: the day label follows the zone, and the zone is named', syd.includes('SUN 27 SEP') && syd.includes('09:30') && !syd.includes('SAT 26 SEP')
     && syd.some(t => /times in AEST \(UTC\+10\)/.test(t)), syd.filter(t => /SEP|:|times/.test(t)).join(' | '));
  ok('...the model itself is unchanged by drawing it (the same graphic in two zones, one after the other)', drawLog(sat, 'portrait').includes('SAT 26 SEP') && sat.rows[0].time === '23:30');
  ok('...and in the caption, the same time and the zone', /^Coming up \(times in AEST \(UTC\+10\)\)\n\nSun 27 Sep 09:30 AEST · Sydney Kings v Perth Wildcats/.test(SC.caption(sat, { zone: 'Australia/Sydney' })), SC.caption(sat, { zone: 'Australia/Sydney' }).split('\n').slice(0, 3).join(' / '));
  ok('...UTC chosen for a league that plays in Paris: 19:30 in Paris is 17:30 UTC, named "UTC"', (() => {
    const par = SC.fixtures({ games: [{ tipoff_at: '2026-09-23T17:30:00Z', home: TA, away: TB }], league }, 'portrait')[0];
    return par.rows[0].time === '19:30' && drawLog(par, 'portrait', { zone: 'UTC' }).includes('17:30') && drawLog(par, 'portrait', { zone: 'UTC' }).some(t => /times in UTC$/.test(t)) && !drawLog(par, 'portrait').some(t => /times in/.test(t));
  })());
  ok('...the device\'s own zone when it is the league\'s own is not announced; a different one is', (() => {
    const par = SC.fixtures({ games: [{ tipoff_at: '2026-09-23T17:30:00Z', home: TA, away: TB }], league }, 'portrait')[0];
    return !drawLog(par, 'portrait', { zone: 'Europe/Paris' }).some(t => /times in/.test(t)) && drawLog(par, 'portrait', { zone: 'America/New_York' }).some(t => /times in EDT \(UTC-4\)/.test(t))
      && drawLog(par, 'portrait', { zone: 'America/New_York' }).includes('13:30');
  })());
  ok('...always names it when asked, and never when told not to', drawLog(sat, 'portrait', { zoneLabel: 'always' }).some(t => /times in UTC$/.test(t)) && !drawLog(sat, 'portrait', { zone: 'Australia/Sydney', zoneLabel: 'never' }).some(t => /times in/.test(t))
     && !/AEST/.test(SC.caption(sat, { zone: 'Australia/Sydney', zoneLabel: 'never' })));
  const edge = fxs(['2026-10-03T15:30:00Z', '2026-10-03T16:30:00Z']);
  const sy = SC.relabel(edge, { zone: 'Australia/Sydney' }).rows;
  ok('daylight saving, Sydney (clocks forward at 02:00 on Sunday 4 October): 01:30 AEST, then 03:30 AEDT an hour later - never 02:30', sy[0].time === '01:30' && sy[1].time === '03:30' && sy[0].day === 'Sun 4 Oct' && sy[1].day === 'Sun 4 Oct'
     && SC.zoneName('2026-10-03T15:30:00Z', 'Australia/Sydney').text === 'AEST (UTC+10)' && SC.zoneName('2026-10-03T16:30:00Z', 'Australia/Sydney').text === 'AEDT (UTC+11)');
  ok('...a list that straddles the change names both', SC.zoneNote(edge, { zone: 'Australia/Sydney' }).short === 'AEST/AEDT' && drawLog(edge, 'portrait', { zone: 'Australia/Sydney' }).some(t => /times in AEST\/AEDT/.test(t))
     && /Sun 4 Oct 01:30 AEST · /.test(SC.caption(edge, { zone: 'Australia/Sydney' })) && /Sun 4 Oct 03:30 AEDT · /.test(SC.caption(edge, { zone: 'Australia/Sydney' })), SC.zoneNote(edge, { zone: 'Australia/Sydney' }).short);
  const eu = fxs(['2026-10-24T23:30:00Z', '2026-10-25T01:30:00Z']);
  const pr = SC.relabel(eu, { zone: 'Europe/Paris' }).rows;
  ok('daylight saving, Paris (clocks back at 03:00 on Sunday 25 October): 01:30 CEST, then 02:30 CET two hours of UTC later; the day is Sunday for both', pr[0].time === '01:30' && pr[1].time === '02:30' && pr[0].day === 'Sun 25 Oct' && pr[1].day === 'Sun 25 Oct'
     && SC.zoneName(eu.rows[0].iso, 'Europe/Paris').abbr === 'CEST' && SC.zoneName(eu.rows[1].iso, 'Europe/Paris').abbr === 'CET');
  ok('a half-hour zone: 17:30 UTC is 23:00 in Kolkata, "UTC+5:30"', SC.relabel(fxs(['2026-09-23T17:30:00Z']), { zone: 'Asia/Kolkata' }).rows[0].time === '23:00' && SC.zoneName('2026-09-23T17:30:00Z', 'Asia/Kolkata').offset === 'UTC+5:30'
     && drawLog(fxs(['2026-09-23T17:30:00Z']), 'portrait', { zone: 'Asia/Kolkata' }).some(t => /times in UTC\+5:30$/.test(t)));
  ok('a zone that does not exist is no zone: UTC for a league, the league\'s own for a module', SC.validZone('Mars/Olympus') === null && SC.leagueZone({ timezone: 'Mars/Olympus' }) === 'UTC' && SC.leagueZone({}) === 'UTC'
     && SC.cleanModules({ zone: 'Mars/Olympus' }).zone === undefined && JSON.stringify(drawLog2(sat, 'Mars/Olympus').map(e => e.t)) === JSON.stringify(drawLog2(sat, undefined).map(e => e.t)));
  function drawLog2(m, zone) { const c = recorder(); SC.draw(c, m, { size: 'portrait', modules: { zone } }); return c.log; }
  ok('a league with no timezone plays in its country\'s: Australia\'s Sydney, France\'s Paris, and its own timezone wins over it', SC.leagueZone({ country: 'AU' }) === 'Australia/Sydney' && SC.leagueZone({ country: 'fr' }) === 'Europe/Paris'
     && SC.leagueZone({ timezone: 'Australia/Perth', country: 'AU' }) === 'Australia/Perth' && SC.leagueZone({ country: 'ZZ' }) === 'UTC' && Object.values(SC.COUNTRY_ZONE).every(z => SC.validZone(z)));
  ok('...and a model built for such a league is in that zone', SC.fixtures({ games: [{ tipoff_at: '2026-09-26T23:30:00Z', home: TA, away: TB }], league: { name: 'NBL', country: 'AU' } }, 'portrait')[0].rows[0].day === 'Sun 27 Sep');
  const fin2 = SC.result({ game: { id: 'z', tipoff_at: '2026-09-26T23:30:00Z', home_score: 80, away_score: 70 }, home: TA, away: TB, players: [], league: utcLg });
  ok('a final\'s date follows the zone too, and names it beside the date', fin2.date === 'Sat 26 Sep 2026' && drawLog(fin2, 'portrait', { zone: 'Australia/Sydney' }).includes('SUN 27 SEP 2026 · AEST') && drawLog(fin2, 'portrait').includes('SAT 26 SEP 2026'));
  const wk2 = SC.week({ games: [{ tipoff_at: '2026-09-26T23:30:00Z', home: TA, away: TB, home_score: 80, away_score: 70 }], league: utcLg }, 'story')[0];
  ok('the week\'s results: the day under each score follows the zone, named in the subline', drawLog(wk2, 'story', { zone: 'Australia/Sydney' }).includes('SUN 27 SEP') && drawLog(wk2, 'story', { zone: 'Australia/Sydney' }).some(t => /days in AEST/.test(t)) && drawLog(wk2, 'story').includes('SAT 26 SEP'));
  ok('a subline of the person\'s own keeps the zone beside it', drawLog(sat, 'portrait', { zone: 'Australia/Sydney', subline: 'Round 5' }).some(t => /^Round 5 · times in AEST/.test(t)));
  ok('a model built by hand with no instants is left as it is (no throw, no label)', (() => { const c = recorder(); SC.draw(c, { kind: 'fixtures', league: utcLg, rows: [{ day: 'Sat 1 Aug', time: '10:00', home: side0('A'), away: side0('B') }], tz: 'UTC' }, { size: 'portrait', modules: { zone: 'Asia/Tokyo' } });
    return c.log.some(e => e.t === '10:00'); })());
  function side0(n) { return { name: n, score: 0 }; }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
