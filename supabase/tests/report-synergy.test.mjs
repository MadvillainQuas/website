/* ============================================================================
   SYNERGY IN THE REPORTS, AST% ON THE SITUATION CARDS, RAPM KEPT (0228).

   A made-up player's Synergy profile (synergy.js over a small CSV in the scraper's layout) drawn by report.js:
     - his row gets the drives left / right at the rim, mid-range and three (FG%, share of the shots) and what his man shot
       attacking him face-up and posting him up; nothing for a player with no file;
     - the drives are a category of their own (DRIVES L/R), each pair tinted against his drives in ALL directions - never
       against this season's RIM% / MID% / 3PT% (the file is several seasons) - and never a word of comparison on it; the better
       side's number green, the worse red; a group with nothing in it is not drawn;
     - the left / right chart: PPP the heaviest row in the colour of the shot each side leans on, the marks at his drives in all
       directions, the better side's numbers green;
     - the situation card's AST%: the share of its baskets that were assisted, and each kind's;
     - migration 0228 (PGlite): Synergy read and written by platform administrators only; RAPM read by anyone, written by them.

     node supabase/tests/report-synergy.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400) : '')); } };

const S = globalThis.EpinoiaSynergy = require(path.join(ROOT, 'epinoia', 'synergy.js'));
const E = require(path.join(ROOT, 'epinoia', 'report.js'));

/* a player, in the scraper's columns: three spot-up drives, an isolation's (split and overall) and the defence */
const HEAD = 'Player,Player ID,Seasons scraped,Side,Play Type,Sub 1,Sub 2,Sub 3,Sub 4,Seasons with data,POSS,PTS,FG MADE,FG ATT,TO%,2 FG MADE,2 FG ATT,3 FG MADE,3FG ATT,FTA/FGA';
const R = (side, p, poss, pts, fgm, fga, f3m, f3a, to) => ['Ann Ace', 'a1', '2026-2027 Club - League + 2025-2026 Other - League', side, p[0], ...p.slice(1).concat(['', '', '', '']).slice(0, 4),
  2, poss, pts, fgm, fga, to, fgm - f3m, fga - f3a, f3m, f3a, '0.2'].join(',');
const CSV = [HEAD,
  R('offense', ['Spot Up'], 100, 100, 40, 90, 20, 50, 5),
  R('offense', ['Spot Up', 'Drives Left'], 30, 36, 14, 24, 2, 4, 10),
  R('offense', ['Spot Up', 'Drives Left', 'To Basket'], 18, 24, 11, 17, 0, 0, 0),
  R('offense', ['Spot Up', 'Drives Left', 'Dribble Jumper'], 9, 12, 3, 7, 2, 4, 0),
  R('offense', ['Spot Up', 'Drives Right'], 20, 14, 5, 14, 0, 2, 20),
  R('offense', ['Spot Up', 'Drives Right', 'To Basket'], 8, 6, 3, 8, 0, 0, 0),
  R('offense', ['Spot Up', 'Drives Right', 'Dribble Jumper'], 8, 8, 2, 6, 0, 2, 0),
  R('offense', ['Spot Up', 'Drives Straight'], 10, 10, 4, 8, 0, 0, 10),
  R('offense', ['Spot Up', 'Drives Straight', 'To Basket'], 8, 8, 4, 8, 0, 0, 0),
  R('defense', ['Isolation'], 20, 18, 7, 16, 2, 5, 5),
  R('defense', ['Post-Up'], 10, 12, 5, 8, 0, 0, 10),
  R('defense', ['Spot Up', 'Drives Left'], 6, 6, 3, 6, 0, 0, 0)].join('\n');
const prof = S.pack(S.fromText(CSV));

console.log('a row and its Synergy');
const row = { id: 'a1', rim_pct: 80, mid_pct: 10, p3_pct: 90 };      // this season's own figures: never the baseline
E.synergyOnRow(row, prof);
{
  const all = prof.offense.drives.all;
  ok('drives in all directions are the baseline, worked by synergy.js: 60 drives, the rim 18 of 33', all.poss === 60 && all.shots.rim.m === 18 && all.shots.rim.a === 33, [all.poss, all.shots.rim]);
  ok('his row: each side\'s rim, mid-range and three FG% and share of the shots, the attempts behind them, and the baseline',
     row.drv_l_rim_fg === 64.7 && row.drv_r_rim_fg === 37.5 && row.drv_l_rim_att === 70.8 && row.drv_l_rim_n === 17 && row.drv_all_rim_fg === 54.5
     && row.drv_l_3_fg === 50 && row.drv_r_3_fg === 0 && row.drv_r_3_n === 2, row);
  ok('...and what his man shot at him: face-up (the isolation and the spot-up drive) and posting him up',
     row.syn_fu_efg === Math.round(10 * 100 * (7 + 3 + 0.5 * 2) / (16 + 6)) / 10 && row.syn_post_efg === 62.5, [row.syn_fu_efg, row.syn_post_efg]);
  const none = { id: 'b' };
  E.synergyOnRow(none, null);
  ok('a player with no file gets nothing on his row', Object.keys(none).join() === 'id');
}

console.log('\nthe DRIVES L/R category');
{
  const g = E.TPL.players.guard, i = g.findIndex(x => x[0] === 'SHOT PROFILE'), d = g.findIndex(x => /DRIVES L\/R/.test(x[0]));
  ok('a category of its own, straight after the shot profile', d === i + 1 && !g[i][1].some(k => /^drv_/.test(k)));
  const field = [row, { id: 'z' }];
  const Rk = E.ranker(field, g[d][1]);
  const html = E.groupCellsHTML(g[d][1], row, Rk);
  ok('six cells, each with both sides, L then R', (html.match(/rp-cell rp-cell2/g) || []).length === 6 && (html.match(/<small>L<\/small>/g) || []).length === 6 && (html.match(/<small>R<\/small>/g) || []).length === 6);
  const feet = (html.match(/rp-cell-p">[^<]*/g) || []).map(x => x.slice(11));
  ok('no words of comparison on them (no "v RIM%", no "vs", nothing about this season): the footers are samples only', feet.length === 6 && feet.every(t => /^\d+ · \d+ (att|shots)$/.test(t)), feet);
  ok('...under each, its sample: the attempts behind each FG% (rim: 17 left, 8 right), each side\'s drive shots behind the shares (24, 15)',
     /DRIVE L\/R RIM FG%[\s\S]*?rp-cell-p">17 · 8 att</.test(html) && /DRIVE L\/R RIM ATT%[\s\S]*?rp-cell-p">24 · 14 shots</.test(html), html.match(/rp-cell-p">[^<]*/g));
  const rim = html.slice(html.indexOf('DRIVE L/R RIM FG%'), html.indexOf('DRIVE L/R RIM ATT%'));
  ok('the rim pair against his drives in all directions (54.5), not his RIM% (80): left 64.7 tinted above it, right 37.5 below it',
     /<i data-b="4" class="up"><small>L<\/small>64\.7<\/i>/.test(rim) && /<i data-b="1" class="dn"><small>R<\/small>37\.5<\/i>/.test(rim), rim);
  const three = html.slice(html.indexOf('DRIVE L/R 3FG%'), html.indexOf('DRIVE L/R 3 ATT%'));
  ok('...the better side green and the worse red - but not on fewer than three attempts (right\'s 2 threes say nothing)', !/class="(up|dn)"/.test(three) && /2 att|4 · 2 att/.test(three), three);
  const att = html.slice(html.indexOf('DRIVE L/R RIM ATT%'), html.indexOf('DRIVE L/R MID FG%'));
  ok('...a share of the shots is a tendency: neither side green or red', !/class="(up|dn)"/.test(att), att);
  const empty = E.groupsOn(g, { id: 'b' });
  ok('a player with no file: the category is not drawn at all, the rest of his card is', !empty.some(x => /DRIVES/.test(x[0])) && empty.length === g.length - 1);
  const rows = E.groupRowsHTML(E.TPL.main.guard.find(x => /DRIVES/.test(x[0]))[1], row, Rk);
  ok('the season line draws the same pairs as rows, without a reference column', (rows.match(/rp-st rp-st2/g) || []).length === 6 && !/RIM% \d/.test(rows));
}

console.log('\nthe defence');
{
  const g = E.TPL.main.guard.find(x => /DEFENCE/.test(x[0]))[1];
  ok('attacked face-up and post-D eFG% in every position\'s defence, both sets', ['main', 'players'].every(set => ['guard', 'wing', 'big'].every(p =>
    E.TPL[set][p].some(x => /DEFENCE|RIM PROTECTION/.test(x[0]) && x[1].includes('syn_fu_efg') && x[1].includes('syn_post_efg')))));
  const cells = E.groupCellsHTML(g, row, E.ranker([row], g));
  ok('...drawn where he has them, lower is better against 52.5: face-up 50.0 green-ish, post-D 62.5 red', /ATTACKED FACE-UP eFG%<\/span><b class="rp-cell-v">50\.0/.test(cells) && /data-b="1"[^>]*><span class="rp-cell-l"[^>]*>POST-D eFG%/.test(cells), cells.match(/<div class="rp-cell[^>]*><span class="rp-cell-l"[^>]*>(ATTACKED|POST)[^<]*/g));
  const without = E.groupCellsHTML(g, { id: 'b', stl_pct: 2 }, E.ranker([row], g));
  ok('...and are not there at all for a player with no file', !/FACE-UP|POST-D/.test(without));
}

console.log('\nthe left / right chart');
{
  const html = E.driveChartHTML(prof);
  ok('four rows: PPP (the heaviest), % POSS, eFG%, TO%', (html.match(/rp-drv-r/g) || []).length === 4 && /rp-drv-r main"><span class="sd l">/.test(html) && /PPP/.test(html) && /% POSS/.test(html) && /TO%/.test(html));
  ok('PPP in the colour of the shot each side leans on (both lean on the rim: red, not the grey of level)', (html.match(/background:rgb\(/g) || []).length >= 2 && !/background:rgb\(170,178,174\)/.test(html));
  ok('the better side\'s numbers green, the worse red: left 1.20 PPP and 10.0 TO% better than right 0.70 and 20.0', /<b class="up">1\.20<\/b>/.test(html) && /<b class="dn">0\.70<\/b>/.test(html) && /<b class="up">10\.0<\/b>/.test(html) && /<b class="dn">20\.0<\/b>/.test(html), html.match(/<b[^>]*>[^<]*<\/b>/g));
  ok('...the share of his possessions is a tendency: neither coloured', !/<b class="(up|dn)">\d+\.\d%<\/b>/.test(html));
  ok('the dashed marks are his drives in all directions (PPP 1.00), not a fixed 1.0', (html.match(/<u style=/g) || []).length === 6 && /PPP 1\.00/.test(html));
  ok('no file: no chart', E.driveChartHTML(null) === '' && E.driveChartHTML({ offense: { drives: {} } }) === '');
  const mix = E.directionMixHTML(prof);
  ok('where each side\'s drives end: the shares of the shots in flex parts', /flex:0 0 70\.8%/.test(mix) && /Left/.test(mix) && /Right/.test(mix), mix.slice(0, 200));
}

console.log('\nAST% on a situation card');
{
  const A = { pts: 20, fga: 10, fgm: 6, p3m: 1, fta: 0, ftm: 0, tov: 1, chances: 12, astd: 4, astPct: 4 / 6, shots: [], types: [], scorers: [],
    zones: { rim: { a: 5, m: 3, x: 2 }, mid: { a: 2, m: 1, x: 0 }, three: { a: 3, m: 2, x: 2 } } };
  const h = E.sitCardHTML(A, { key: 'half' });
  ok('the card: 67% AST%, 4 of its 6 baskets, the rim 2/3, mid-range 0/1, three 2/2', /rp-sit-a1"><b>67%<\/b><span>AST%/.test(h) && /4 of its 6 baskets were assisted/.test(h) && /67%<\/b><small>2\/3/.test(h) && /100%<\/b><small>2\/2/.test(h), h.slice(h.indexOf('rp-sit-a'), h.indexOf('rp-sit-a') + 400));
  const p = E.sitCardHTML(A, { key: 'half', player: true });
  ok('...on a player\'s own card it is THEIR baskets, and says so', /<span>Assisted<\/span>/.test(p) && /4 of their 6 baskets/.test(p));
  ok('...nothing made, no panel', !/rp-sit-a/.test(E.sitCardHTML(Object.assign({}, A, { fgm: 0, astPct: null }), { key: 'half' })));
  const src = read('epinoia', 'situations.js');
  ok('situations.js marks each made shot assisted or not, and counts them by zone', /ast: astd/.test(src) && /b\.astd\+\+; b\.zones\[z\]\.x\+\+/.test(src) && /astPct: b\.fgm \? b\.astd \/ b\.fgm : null/.test(src));
}

console.log('\nthe fonts');
{
  const css = read('epinoia', 'kit', 'report.css');
  ok('every report page sets the two pixel faces to the clean sans', /\.rp-pg\{ --f-micro:'Archivo'[^}]*--f-score:'Archivo'/.test(css));
}

console.log('\nPRIME REPORT and RAPM kept');
{
  const src = read('epinoia', 'report.js');
  ok('the panel has PRIME REPORT before the downloads (not the class the mailer clicks)', /mk\('PRIME REPORT', 'prime'/.test(src) && src.indexOf("mk('PRIME REPORT'") < src.indexOf("mk('Download PDF', 'pri'"));
  ok('...primed on opening with ?prime=1 (downloads too) or for the mailer (EPINOIA_RP_PRIME, which takes the PDF itself)', /q\.get\('prime'\) === '1' \|\| !!root\.EPINOIA_RP_PRIME/.test(src) && /prime\(q\.get\('prime'\) === '1' && !root\.EPINOIA_RP_BOT\)/.test(src));
  ok('RAPM is read from the database (report_rapm) when this browser has none, and kept there when worked out; the mailer gets it on the page', /report_rapm\?key=eq\./.test(src) && /from\('report_rapm'\)\.upsert/.test(src) && /root\.__rpRapm = \{ key, games, m \}/.test(src));
}

console.log('\nmigration 0228');
{
  let PGlite;
  try { ({ PGlite } = await import(pathToFileURL(path.join(ROOT, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href)); } catch { PGlite = null; }
  if (!PGlite) console.log('  SKIP  the database part: @electric-sql/pglite is not installed');
  else {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.teams (id uuid primary key, name text); create table public.players (id uuid primary key);
      create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.padmin', true), 'no') = 'yes' $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;`);
    let applied = true;
    try { for (let i = 0; i < 2; i++) { await db.exec(read('supabase', 'migrations', '0221_report_mail.sql')); await db.exec(read('supabase', 'migrations', '0228_reports_manager.sql')); } } catch (e) { applied = e.message; }
    ok('0228 applies on 0221, twice', applied === true, applied);
    const P1 = '00000000-0000-0000-0000-000000000001', U = '00000000-0000-0000-0000-0000000000a1';
    await db.exec(`insert into public.players values ('${P1}'); insert into auth.users values ('${U}');`);
    const as = async (who, sql) => {
      await db.exec(`reset role; set test.padmin = '${who === 'admin' ? 'yes' : 'no'}'; set test.uid = '${who === 'anon' ? '' : U}'; set role ${who === 'anon' ? 'anon' : 'authenticated'};`);
      try { return (await db.query(sql)).rows; } catch (e) { return 'ERR ' + e.message; } finally { await db.exec('reset role'); }
    };
    const put = await as('admin', `insert into public.synergy_profiles (player_id, profile, source_name) values ('${P1}', '{"v":1}', 'Ann Ace') returning player_id`);
    ok('a platform administrator keeps a Synergy profile', Array.isArray(put) && put.length === 1, put);
    const fan = await as('fan', `select * from public.synergy_profiles`), anon = await as('anon', `select * from public.synergy_profiles`);
    ok('...nobody else reads one (licensed data): a signed-in member sees none, an anonymous reader is refused', Array.isArray(fan) && fan.length === 0 && /permission denied/.test(anon), [fan, anon]);
    const w = await as('fan', `insert into public.report_rapm (key, games, m) values ('10-abc', 10, '[]')`);
    const a = await as('admin', `insert into public.report_rapm (key, games, m) values ('10-abc', 10, '[["x", 1.2, -0.4]]') returning key`);
    const r = await as('anon', `select key, games from public.report_rapm`);
    ok('RAPM: written by a platform administrator (not a member), read by anyone', /row-level security/.test(String(w)) && Array.isArray(a) && Array.isArray(r) && r[0].key === '10-abc', [w, a, r]);
    await db.exec(`insert into public.teams values ('00000000-0000-0000-0000-0000000000c1', 'Club'); insert into public.report_mail_subs (id, email, team_id) values ('00000000-0000-0000-0000-0000000000b1', 'a@b.co', '00000000-0000-0000-0000-0000000000c1');`);
    const z = (await db.query(`select player_zip from public.report_mail_subs`)).rows[0];
    let logged = true; try { await db.exec(`insert into public.report_mail_log (sub_id, kind, ref) values ('00000000-0000-0000-0000-0000000000b1', 'players', '2026-10-04')`); } catch (e) { logged = e.message; }
    ok('every address is sent its players\' reports unless turned off, and that email is logged as its own kind', z.player_zip === true && logged === true, [z, logged]);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
