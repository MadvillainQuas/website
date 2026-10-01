/* ============================================================================
   THE FRONT OFFICE'S WIN MODEL (epinoia/t/fomodel.js, F3; docs/what-wins-model.md §12, §16 WP5, addendum A.1/A.2),
   with no browser.

     node supabase/tests/ww-fomodel.test.mjs
     WW_FO_FILES=<dir> node supabase/tests/ww-fomodel.test.mjs    also draws the panel from <dir>/fo.json and club.json
                                                                   (e.g. the builder's --local output for another league)

   What is held here:
     * KEYMAP is winmodel's; the fixtures (supabase/tests/fixtures/ww-fo: a real fo file, a real club file, a refusal)
       pass EpinoiaWinModel.validate;
     * the ledger: the core contributions at both ends sum to the factor-expected margin Σ b (x_off − x_def) (1e-6),
       each one b(x − μ) at offence and −b(x − μ) at defence; wins per 30 from σ_pred (never σ_acc);
     * the needs: only moves that add wins, sorted by wins, five at most, each the §7.5 sum over the fixtures (or G
       games against an average side); the simulator's numbers replace them when given; the depth chart's NEED words;
     * the losses: every game's parts add up to its margin, and the waterfall of each loss ends on it;
     * a refusal draws no numbers (members: the memlock placeholder; sign-in: a link; none / rate / layout: the words);
     * gmModel through KEYMAP; depth.gm with it orders by |wins| and keeps the selection; the depth chart from the
       `pos` file (A.1): the 1.4 / 1.4 pair puts the slightly higher player at the 2, and no stints falls back;
     * the Front office path: team.js's frontOffice() calls seasonGames, never D.events and never seasonLogs, and
       seasonLogs is exactly as it was; t/index.html has F3 after the GM's view, the scripts before team.js, the
       sheets before legibility.css and the frontoffice pack;
     * every block draws well-formed HTML with no NaN, every chart builds through the chart kit with role, title and
       desc; the Worker's ops run with the arguments mount() sends;
     * the words: es and ja frontoffice packs with the same keys and patterns, no core phrase repeated, and every
       line the panel, the depth chart and the GM's view write translates (with the chart kit's own words);
     * ?wi= round trips; the status line and RECALCULATE as on What wins.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const FIX = path.join(ROOT, 'supabase/tests/fixtures/ww-fo');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`); };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

/* the page's scripts in one sandbox, as the team page loads them */
const sandbox = { console, module: undefined, Math, Date, JSON, URLSearchParams, btoa, atob };
sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox;
const cx = vm.createContext(sandbox);
for (const f of ['season.js', 'winstats.js', 'winsim.js', 'vizkit.js', 't/depth.js', 't/fomodel.js']) vm.runInContext(read(EP, f), cx, { filename: f });
const F = sandbox.EpinoiaFoModel, X = sandbox.EpinoiaDepth, Sim = sandbox.EpinoiaWinSim, VK = sandbox.EpinoiaVizKit, WS = sandbox.EpinoiaWinStats;
const WM = fs.existsSync(path.join(EP, 'winmodel.js')) ? require(path.join(EP, 'winmodel.js')) : null;

const load = (dir, f) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const fo = load(FIX, 'fo.json'), club = load(FIX, 'club.json'), refusal = load(FIX, 'refusal.json');
const TID = club.team.id;
const others = fo.teams.filter(t => t.id !== TID);
const FIXTURES = others.slice(0, 5).map((o, i) => ({ id: 'fx' + i, home_team_id: i % 2 ? o.id : TID, away_team_id: i % 2 ? TID : o.id, tipoff_at: '2026-10-1' + i + 'T18:00:00Z' }));

/* ------------------------------------------------------------------ the files --- */
console.log('\nthe files and KEYMAP');
ok('fomodel.js loads in node without a document and exports §14\'s interface',
   !!F && ['view', 'ledger', 'needs', 'gmModel', 'mount'].every(k => typeof F[k] === 'function') && ['verdict', 'ledger', 'needs', 'slots', 'squad', 'losses', 'next', 'whatIf'].every(k => typeof F.html[k] === 'function'));
if (WM) ok('KEYMAP is winmodel\'s', JSON.stringify(F.KEYMAP) === JSON.stringify(WM.KEYMAP));
else ok('KEYMAP covers the GM\'s measures (winmodel.js absent)', Object.keys(F.KEYMAP).every(k => X.MEASURES.some(m => m[0] === k)));
ok('...every KEYMAP measure is one of depth.js\'s MEASURES', Object.keys(F.KEYMAP).every(k => X.MEASURES.some(m => m[0] === k)));
ok('the fixtures: an fo file, a club file of a club in it, and a refusal', fo && fo.scope === 'fo' && club && club.scope === 'club' && fo.teams.some(t => t.id === TID) && refusal && refusal.ok === false);
if (WM && WM.validate) {
  const pf = WM.validate(fo, 'fo'), pc = WM.validate(club, 'club');
  ok('fixtures/ww-fo/fo.json passes EpinoiaWinModel.validate', !pf.length, pf.slice(0, 3).join(' | '));
  ok('fixtures/ww-fo/club.json passes EpinoiaWinModel.validate', !pc.length, pc.slice(0, 3).join(' | '));
}
ok('the fo file is within §15\'s 100 KB and the club file within 25 KB', JSON.stringify(fo).length <= 100000 && JSON.stringify(club).length <= 25000);

/* ------------------------------------------------------------------ the ledger --- */
console.log('\nthe ledger (block 2)');
const L = F.ledger(fo, TID);
const T = fo.teams.find(t => t.id === TID);
{
  ok('the four factors at both ends', L && L.core.length === 8 && ['c_efg', 'c_tovp', 'c_orebp', 'c_ftmr'].every(k => L.core.filter(r => r.k === k).length === 2));
  let byHand = 0;
  ['c_efg', 'c_tovp', 'c_orebp', 'c_ftmr'].forEach(k => { byHand += fo.value[k].b * (T.f[k].off - T.f[k].def); });
  ok('core contributions sum to the factor-expected margin Σ b(x_off − x_def) (1e-6)', near(L.sum, byHand) && near(L.expected, byHand), L.sum + ' vs ' + byHand);
  ok('...each b(x − μ) at offence and −b(x − μ) at defence', L.core.every(r => near(r.pts, (r.end === 'def' ? -1 : 1) * fo.value[r.k].b * (T.f[r.k][r.end] - fo.value[r.k].lg), 1e-9)));
  ok('...each interval holds its point', L.core.concat(L.levers).every(r => r.lo <= r.pts + 1e-12 && r.pts <= r.hi + 1e-12));
  ok('wins per 30 from σ_pred: 30(Φ(pts/σ) − ½)', L.core.every(r => near(r.wins30, 30 * (WS.normCdf(r.pts / fo.sigmaPred) - 0.5), 1e-9)) && L.sigma === fo.sigmaPred);
  ok('the levers are §12\'s eight, both ends, never added to the four factors', L.levers.every(r => F.LEVERS.includes(r.k)) && L.levers.length >= 8);
  const tg = F.targetOf(fo.value.c_tovp, 'off');
  ok('the target is the league\'s P75 in the better direction (TOV%: lower on offence is P25)', tg && tg.v === fo.value.c_tovp.p25.off && tg.up === false);
}

/* ------------------------------------------------------------------ the needs --- */
console.log('\nthe needs (block 3)');
{
  const mus = F.fixtureMus(fo, TID, FIXTURES);
  ok('fixtures: one expected margin each (Elo with the league\'s home edge), in date order', mus.length === 5 && mus.every(m => Number.isFinite(m.mu) && m.p > 0 && m.p < 1) &&
     mus.every((m, i) => !i || mus[i - 1].at <= m.at));
  const N = F.needs(fo, TID, { fixtures: FIXTURES });
  const all = F.needs(fo, TID, { fixtures: FIXTURES, all: true });
  ok('needs sorted by wins, five at most', N.length > 0 && N.length <= 5 && N.every((n, i) => !i || N[i - 1].wins >= n.wins));
  ok('...only moves that add wins, toward the target', all.every(n => n.delta > 0 && n.wins > 0));
  ok('...each the §7.5 sum over the fixtures: Σ Φ((μ + δ)/σ) − Φ(μ/σ)', N.every(n => near(n.wins, mus.reduce((a, f) => a + WS.normCdf((f.mu + n.delta) / fo.sigmaPred) - WS.normCdf(f.mu / fo.sigmaPred), 0), 1e-9)));
  ok('...and no factor whose value is not distinguishable from 0', all.every(n => !(fo.value[n.k].lo < 0 && fo.value[n.k].hi > 0)));
  const none = F.needs(fo, TID, { fixtures: [] });
  ok('no fixtures left: G games against an average side', none.length > 0 && none.every(n => n.perSeason && near(n.wins, fo.lg.G * (WS.normCdf(n.delta / fo.sigmaPred) - 0.5), 1e-9)));
  const key = N[0].key, simd = F.needs(fo, TID, { fixtures: FIXTURES, sim: { [key]: { dWin: 0.5, se: 0.01 } }, all: true });
  ok('a calibrated simulator\'s Δ win replaces the margin model for its factor', simd.find(n => n.key === key).src === 'sim' && near(simd.find(n => n.key === key).wins, 2.5, 1e-9) && simd[0].key === key);
  ok('...the depth chart\'s NEED sentence where KEYMAP maps one', all.filter(n => ['c_efg:off', 'c_tovp:off', 'dff_ftr'].includes(n.key) || n.key === 'c_ftmr:def').every(n => n.need === X.NEED[n.key === 'c_ftmr:def' ? 'dff_ftr' : n.key === 'c_efg:off' ? 'ff_efg' : 'ff_tov']));
}

/* ------------------------------------------------------------------ the losses --- */
console.log('\nthe losses (block 6)');
{
  const parts = ['quality', 'making', 'tovp', 'orebp', 'ftmr', 'other', 'garbage'];
  ok('every club game: m = xm + Σ parts (the file\'s four significant figures)', club.games.every(g => near(g.xm + parts.reduce((a, k) => a + g.parts[k], 0), g.m, 0.02)),
     club.games.map(g => (g.xm + parts.reduce((a, k) => a + g.parts[k], 0) - g.m).toFixed(3)).filter(x => Math.abs(+x) > 0.02).join(','));
  const vmv = F.view({ fo, club, team: { id: TID }, fixtures: FIXTURES });
  ok('the last ten losses, newest first', vmv.losses.list.length === Math.min(10, club.games.filter(g => g.m < 0).length) && vmv.losses.list.every((g, i, a) => g.m < 0 && (!i || a[i - 1].d >= g.d)));
  ok('...each loss\'s waterfall ends on its margin', vmv.losses.list.every((g, i) => { const b = VK.waterfall(vmv.charts['loss' + i].data, { W: 760 }); return near(b.total, g.m, 0.02) && near(b.total, g.total, 1e-9); }));
  ok('"you lose when" names only parts whose interval is below 0', vmv.losses.lose.length === club.losses.mean.filter(p => p.k !== 'expected' && p.hi < 0).length);
}

/* ------------------------------------------------------------------ refusals --- */
console.log('\nrefusals');
const textOf = html => html.replace(/<[^>]+>/g, ' ');
{
  const r = F.view({ reason: refusal.reason });
  const h = F.panel(r);
  ok('members: the memlock placeholder and no numbers', !r.ok && /data-memlock/.test(h) && !/\d/.test(textOf(h)));
  const s = F.panel(F.view({ reason: 'signin' }), { signin: '../signin/?next=x' });
  ok('sign-in: a link and no numbers', /href="\.\.\/signin\/\?next=x"/.test(s) && !/\d/.test(textOf(s)));
  ok('none: "the model needs 20 finished games in this league"', /The model needs 20 finished games in this league/.test(F.panel(F.view({ reason: 'none' }))));
  ok('rate: the minutes to wait', /Too many requests: try again in 30 minutes/.test(F.panel(F.view({ reason: 'rate', retryAfter: 1800 }))));
  ok('layout: being rebuilt', /being rebuilt/.test(F.panel(F.view({ reason: 'layout' }))));
  ok('no file at all: a refusal too, never an exception', F.view({}).ok === false);
}

/* ------------------------------------------------------------------ the GM and the depth chart --- */
console.log('\nthe GM\'s view and the depth chart');
{
  const g = F.gmModel(fo, TID);
  ok('gmModel: wins per 30 for each KEYMAP measure the file values', Object.keys(g.wins).length >= 8 && Object.keys(g.wins).every(k => F.KEYMAP[k] && Number.isFinite(g.wins[k])));
  const c = F.contribution(fo, T, 'c_efg', 'def');
  ok('...dff_efg = 30(Φ(−b(x_def − μ)/σ) − ½)', near(g.wins.dff_efg, 30 * (WS.normCdf(c.pts / fo.sigmaPred) - 0.5), 1e-9));
  ok('...nothing for a club not in the file', Object.keys(F.gmModel(fo, 'nobody').wins).length === 0);
  /* A.1: two guards at 1.4 on the floor together: the slightly higher one plays the 2 */
  if (WM && WM.slotMinutes) {
    const est = { a: 1.40, b: 1.41, c: 3, d: 4, e: 5, f: 2.5 };
    const r = WM.slotMinutes([{ ids: ['a', 'b', 'c', 'd', 'e'], s: 600 }, { ids: ['f', 'b', 'c', 'd', 'e'], s: 300 }], est);
    const pos = { w: 1, games: 1, min: 15, players: [...r.min].map(([id, m]) => ({ id, pos: est[id], min: m })) };
    const roster = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id.toUpperCase(), height: 195 }));
    const season = new Map(roster.map(p => [p.id, { mpg: 20, gp: 1, min: 20 }]));
    const cs = X.slotChart({ pos, roster, season, recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } });
    ok('A.1 the 1.4 / 1.4 pair: the slightly higher (1.41) is the 2 for those minutes', cs && cs.slots[0].players[0].id === 'a' && cs.slots[1].players[0].id === 'b' && near(cs.slots[1].players[0].slotMin, 10, 1e-9),
       cs && cs.slots.map(s => s.key + ':' + s.players.map(p => p.id + '/' + p.slotMin).join(',')).join(' '));
    ok('...and with no 1.40 on the floor he is the 1', cs.slots[0].players.some(p => p.id === 'b' && near(p.slotMin, 5, 1e-9)));
    ok('...each player\'s share of the position\'s minutes', cs.slots[1].players.every(p => near(p.share, p.slotMin / 15, 1e-9)) && cs.source === 'stints');
    ok('no stints: null, so the page draws the blend', X.slotChart({ pos: { players: [] }, roster }) === null && X.slotChart({ pos: null, roster }) === null &&
       X.slotChart({ pos: { players: [{ id: 'a', min: [0, 0, 0, 0, 0] }] }, roster }) === null);
    const h = X.chartHTML(cs, { link: p => '/p/?p=' + p.id });
    ok('the chart by the floor draws share bars and says where it comes from', /dc-share/.test(h) && /filled from the minutes played at it this season/.test(h) && (h.match(/class="dc-col"/g) || []).length === 5);
  }
  /* the real pos file (embedded in the club file) */
  const pos = club.pos || (fo.pos && fo.pos[TID]);
  ok('the club file carries the club\'s pos file (A.1)', pos && pos.team === TID && pos.players.length > 5 && pos.players.every(p => p.min.length === 5));
  const roster = pos.players.map((p, i) => ({ id: p.id, name: 'P' + i, num: String(i), height: 190 + i }));
  const season = new Map(pos.players.map(p => [p.id, { mpg: p.min.reduce((a, b) => a + b, 0) / pos.games, gp: pos.games, min: p.min.reduce((a, b) => a + b, 0) }]));
  const cs = X.slotChart({ pos, roster, season, recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } });
  ok('...the real one fills all five positions, each led by its biggest minutes there', cs && cs.slots.every((s, i) => s.players.length && s.players[0].slotMin === Math.max(...pos.players.map(p => p.min[i]))));
}

/* ------------------------------------------------------------------ the Front office path --- */
console.log('\nthe Front office path (team.js, t/index.html)');
const TEAMJS = read(EP, 't/team.js'), HTML = read(EP, 't/index.html');
{
  const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) return ''; let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
  /* the Front office reads through depthInput (shared with the profile's depth chart) and floorMinutes (the club's lineups) */
  const fo1 = fn(TEAMJS, 'frontOffice') + fn(TEAMJS, 'depthInput') + fn(TEAMJS, 'floorMinutes');
  ok('frontOffice() calls seasonGames, never seasonLogs and never D.events', /seasonGames\(team\)/.test(fo1) && !/seasonLogs\(/.test(fo1) && !/\.events\(/.test(fo1));
  ok('...nor do the win model\'s loaders', !/\.events\(|seasonLogs\(/.test(fn(TEAMJS, 'winModelFiles') + fn(TEAMJS, 'winModel')));
  const SEASONLOGS = `function seasonLogs(team) {
  if (logsP) return logsP;
  const D = window.EpinoiaData;
  logsP = (async () => {
    const gs = await D.all(\`games?or=(home_team_id.eq.\${team.id},away_team_id.eq.\${team.id})\` +
      \`&status=eq.final&select=id,home_team_id,away_team_id,tipoff_at,period,starters,roster_snapshot\` + inSeason() +
      \`&order=tipoff_at.desc&limit=40\`);
    const evs = gs.length ? await D.events(gs.map(g => g.id)) : [];
    const byG = {}; evs.forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
    const sideOf = {}; gs.forEach(g => { sideOf[g.id] = g.home_team_id === team.id ? 0 : 1; });
    return { gs, byG, sideOf };
  })();
  logsP.catch(() => { logsP = null; });
  return logsP;
}`;
  ok('seasonLogs() is exactly as it was (the shot chart, shot clock, rotations and lineups read it)', fn(TEAMJS, 'seasonLogs') === SEASONLOGS);
  const sg = fn(TEAMJS, 'seasonGames');
  ok('seasonGames(): seasonLogs\' games query, reusing logsP when loaded, no events', sg.includes("`&status=eq.final&select=id,home_team_id,away_team_id,tipoff_at,period,starters,roster_snapshot` + inSeason() +") &&
     /if \(logsP\) return logsP\.then/.test(sg) && !/events/.test(sg));
  ok('the fo and club files through EpinoiaWinFile, then the fixtures to come (§12)', /WF\.get\(Object\.assign\(\{ scope: 'fo' \}, unit\)\)/.test(TEAMJS) && /scope: 'club', team: team\.id/.test(TEAMJS) &&
     /status=in\.\(scheduled,live\)` \+\s*`&select=id,home_team_id,away_team_id,tipoff_at` \+ inSeason\(\)/.test(TEAMJS));
  ok('F3 mounted with the Worker, RECALCULATE refreshing the fo file', /FM\.mount\(host, FM\.view\(input\), \{ input, worker: FM\.makeWorker\(\)/.test(TEAMJS) && /WF\.refresh\(Object\.assign\(\{ scope: 'fo' \}, unit\)/.test(TEAMJS));
  ok('the [data-slot] handler is wired on #wmodel too', /hostM\.addEventListener\('click', onSlot\)/.test(TEAMJS) && /hostD\.addEventListener\('click', onSlot\)/.test(TEAMJS));
  ok('depth.gm gets gmModel; the depth chart is filled from the pos file where it arrives', /model: fo && FM \? FM\.gmModel\(fo, team\.id\)/.test(TEAMJS) && /X\.slotChart\(Object\.assign\(\{ pos, gameMin \}, chartIn\)\)/.test(TEAMJS));
  ok('team.js names none of I1\'s tables beside what it read before (no game_features, lineup_stints from the Front office)', !/game_features/.test(TEAMJS));
  const fosec = HTML.slice(HTML.indexOf('id="fosec"'), HTML.indexOf('id="foshare"'));
  ok('t/index.html: F3 in #fosec after the GM\'s view, its header and note as §12', fosec.indexOf('id="gmview"') < fosec.indexOf('<span class="idx">F3</span>') &&
     /<div class="ep-hdr"><span class="idx">F3<\/span><h2>Win model<\/h2>\s*<span class="note" id="wmodelNote">what wins in this league, and what it means for the club<\/span><\/div>\s*<div id="wmodel" class="ep-card"><\/div>/.test(fosec));
  const at = s => HTML.indexOf(s);
  /* PERF-6: the win model's code is not on a plain team-page view; team.js loads it when the Front office opens */
  const noTag = ['winstats.js', 'winsim.js', 'winfile.js', 'vizkit.js', 'fomodel.js', 'vizkit.css', 'fomodel.css'].filter(f => new RegExp('(src|href)="[^"]*' + f.replace('.', '\\.') + '\\?v=').test(HTML));
  ok('...the win model\'s scripts and sheets are not in the page\'s head (loaded when the Front office first opens)', !noTag.length, noTag.join(', '));
  const lw = TEAMJS.slice(TEAMJS.indexOf('function loadWinModel'), TEAMJS.indexOf('async function winModelFiles'));
  const ord = ['../winstats.js', '../winsim.js', '../winfile.js', '../vizkit.js', "'fomodel.js'"].map(x => lw.indexOf(x));
  ok('...team.js loadWinModel: winstats, winsim, winfile, vizkit, fomodel, in order, at its own ?v=, the sheets before legibility.css, and winModelFiles waits for it',
    ord.every((x, i, a) => x > 0 && (!i || a[i - 1] < x)) && /TEAM_V/.test(lw) && /s\.async = false/.test(lw) && /insertBefore\(l, last\)/.test(lw) && /kit\/legibility\.css/.test(lw) &&
    /async function winModelFiles\(team\) \{\n\s+await loadWinModel\(\);/.test(TEAMJS));
  ok('...the fo and club files are asked for at once (Promise.all), the club\'s answer dropped when fo is refused', /Promise\.all\(\[WF\.get\(Object\.assign\(\{ scope: 'fo' \}, unit\)\), WF\.get\(Object\.assign\(\{ scope: 'club', team: team\.id \}, unit\)\)\]\)/.test(TEAMJS) &&
    /club: fo\.ok \? club : null/.test(TEAMJS));
  ok('...the packs "report go frontoffice"', /<script src="\.\.\/i18n\.js\?v=\d+" data-i18n-packs="report go frontoffice"><\/script>/.test(HTML));
  const FMJS = read(EP, 't/fomodel.js');
  ok('fomodel.js reads no table, never localStorage.setItem, and builds the Worker from its own ?v=', !/rest\/v1|game_events|game_features|player_game_stats|lineup_stints|team_game_stats/.test(FMJS) &&
     !/localStorage\.setItem/.test(FMJS) && /new root\.Worker\('\.\.\/winsim\.worker\.js\?v=' \+ ver\)/.test(FMJS) && /currentScript/.test(FMJS));
  const css = read(EP, 'kit/fomodel.css');
  ok('fomodel.css: pixel-font tracking at .2em or less, no rule copied from the kit', [...css.matchAll(/letter-spacing:\s*([\d.]+)em/g)].every(m => +m[1] <= 0.2));
}

/* ------------------------------------------------------------------ drawing --- */
console.log('\ndrawing every block');
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'col', 'source', 'wbr']);
function wellFormed(xml) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:="[^"<]*")?)*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let last = 0, m;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    if (/[<>]/.test(between) || /&(?!(amp|lt|gt|quot|#39);)/.test(between)) return 'stray text: ' + between.slice(0, 60);
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return 'mismatch at </' + m[2] + '>'; }
    else if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(m[2]);
  }
  if (/[<>]/.test(xml.slice(last))) return 'trailing';
  return stack.length ? 'unclosed ' + stack.join(',') : '';
}
const names = new Map((club.players || []).map((p, i) => [p.id, 'Player ' + String.fromCharCode(65 + i)]));
const chartWords = new Set();
function drawAll(tag, foF, clubF, fixtures) {
  const tid = clubF.team.id;
  const v = F.view({ fo: foF, club: clubF, team: { id: tid, name: clubF.team.name }, fixtures, names });
  ok(tag + ': the view is whole', v.ok && v.verdict && v.ledger && v.next && v.whatIf);
  const html = F.panel(v);
  const wf = wellFormed(html);
  ok(tag + ': the panel is well-formed HTML with no script or handler', !wf && !/<script|\son[a-z]+=/i.test(html), wf);
  ok(tag + ': no NaN, undefined or [object Object] in it', !/NaN|undefined|\[object Object\]/.test(html), (/.{0,40}(NaN|undefined|\[object Object\]).{0,40}/.exec(html) || [''])[0]);
  ok(tag + ': eight blocks, each a <details> with its summary first', (html.match(/<details class="fm-b"/g) || []).length === 8 && F.BLOCKS.every(b => new RegExp('<details class="fm-b" data-b="' + b + '"[^>]*><summary>').test(html)));
  const slots = [...html.matchAll(/data-chart="([^"]+)"/g)].map(m => m[1]);
  ok(tag + ': every chart slot has its spec', slots.length > 5 && slots.every(s => v.charts[s]));
  const problems = [];
  for (const id of Object.keys(v.charts)) {
    const spec = v.charts[id];
    for (const W of [760, 360]) {
      let b;
      try { b = VK[spec.kind](spec.data, Object.assign({}, spec.o, { W, id: 'x' + id })); } catch (e) { problems.push(id + ' threw ' + e.message); continue; }
      const w = wellFormed(b.svg);
      if (w) problems.push(id + ' ' + w);
      if (!/^<svg[^>]*role="img"/.test(b.svg) || !/<title id=/.test(b.svg) || !/<desc id=/.test(b.svg)) problems.push(id + ' without role/title/desc');
      if (/NaN|undefined|Infinity/.test(b.svg)) problems.push(id + ' NaN in svg');
      if (!b.table || !b.table.rows.length) problems.push(id + ' empty twin');
      if (W === 760) {
        [...b.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].forEach(m => chartWords.add(m[1]));
        (b.table.head || []).forEach(h => chartWords.add(h));
        b.table.rows.forEach(r => chartWords.add(String(r[0])));
        if (spec.label) chartWords.add(spec.label);
      }
    }
  }
  ok(tag + ': every chart builds through the chart kit at 760 and 360 px', !problems.length, problems.slice(0, 4).join(' | '));
  return { v, html };
}
const main = drawAll('ORLEN fixture', fo, club, FIXTURES);
const noFx = drawAll('ORLEN, no fixtures left', fo, club, []);
if (process.env.WW_FO_FILES) {
  const d = process.env.WW_FO_FILES, f2 = load(d, 'fo.json'), c2 = load(d, 'club.json');
  if (f2 && c2) drawAll(path.basename(d), f2, c2, f2.teams.filter(t => t.id !== c2.team.id).slice(0, 3).map((o, i) => ({ id: 'x' + i, home_team_id: c2.team.id, away_team_id: o.id, tipoff_at: '2026-11-0' + (i + 1) })));
}
{
  const V = main.v.verdict;
  ok('the verdict: record, Pythagorean and factor-expected wins, luck = w − factorW', V.w === club.record.w && V.pythW === club.record.pythW && near(V.luck, club.record.w - club.record.factorW, 1e-9));
  ok('...projected wins p10 ≤ p50 ≤ p90 within the games left, the distribution summing to 1', V.proj.p10 <= V.proj.p50 && V.proj.p50 <= V.proj.p90 && V.proj.p90 <= V.w + FIXTURES.length && V.proj.p10 >= V.w &&
     near(V.proj.dist.reduce((a, b) => a + b, 0), 1, 1e-12));
  ok('...one sentence: the biggest cost in wins per 30 games', /Your biggest cost is .+ on (offence|defence): about [\d.]+ wins \([\d.−-]+–[\d.−-]+\) over 30 games/.test(main.html));
  ok('the ledger prints its check', /the factor-expected margin \(check: [+−-]?[\d.]+\)/.test(main.html));
  ok('no fixtures: "no fixtures left" and needs over a season of G games', /No fixtures left to play this season/.test(noFx.html) && new RegExp('over a season of ' + fo.lg.G + ' games against an average side').test(noFx.html));
  ok('slot buttons PG..C (team.js opens the league view from them)', ['PG', 'SG', 'SF', 'PF', 'C'].every(k => main.html.includes('data-slot="' + k + '"')));
  {
    /* TC5: the exact SD path (club.slots[g][stat].sd, WP6). The real fixtures predate it; the synthetic samples carry it */
    const SF = path.join(ROOT, 'supabase/tests/fixtures/ww'), fs2 = load(SF, 'fo.sample.json'), cs2 = load(SF, 'club.sample.json');
    const clamp3 = x => Math.max(-3, Math.min(3, x)), isN = x => typeof x === 'number' && isFinite(x);
    const v2 = F.view({ fo: fs2, club: cs2, team: { id: cs2.team.id, name: cs2.team.name }, fixtures: [] });
    const rows = (v2.slots && v2.slots.rows) || [];
    const exact = rows.filter(r => cs2.slots[r.g] && cs2.slots[r.g][r.stat] && isN(cs2.slots[r.g][r.stat].sd));
    ok('slot gaps use the club file\'s exact team-SD: sd = slots[g][stat].sd, gap = (target − v) / sd (±3), pts = b × gap for a priced stat', exact.length >= 5 &&
       exact.every(r => r.sd === cs2.slots[r.g][r.stat].sd && (!isN(r.target) || r.pts === null || near(r.pts, r.b * clamp3((r.target - r.v) / r.sd), 1e-9))) &&
       exact.some(r => isN(r.pts)), exact.length + ' rows');
    const noSd = JSON.parse(JSON.stringify(cs2));
    Object.values(noSd.slots).forEach(gs => Object.values(gs).forEach(c => { delete c.sd; }));
    const fb = F.view({ fo: fs2, club: noSd, team: { id: cs2.team.id, name: cs2.team.name }, fixtures: [] }).slots.rows;
    ok('...and without it (files built before WP6) the |v − median| / |z| fallback is used instead', fb.some(r => isN(r.sd)) &&
       fb.filter(r => isN(r.sd)).every(r => { const t = (fs2.slots.targets || []).find(x => x.g === r.g && x.stat === r.stat); return t && near(r.sd, Math.abs((r.v - t.mid) / r.z), 1e-9); }));
  }
  ok('the slot gaps value only stats P1 prices alone (no share statistic)', main.v.slots.rows.filter(r => /share/.test(r.stat)).every(r => r.pts === null) && main.v.slots.gaps.length <= 2);
  ok('the status line and RECALCULATE: "Model of N games · built … · n new games since", live only with games pending',
     F.statusLine({ built: fo.built, pending: 12 }, fo, { now: Date.parse(fo.built) + 2 * 3600e3 }).line === 'Model of ' + fo.n.games + ' games · built 2 h ago · 12 new games since' &&
     F.statusLine({ pending: 12 }, fo).canRecalc && !F.statusLine({ pending: 0 }, fo).canRecalc && F.statusLine({ pending: 0 }, fo).upToDate);
  ok('the bar\'s five stages, as on What wins', F.STAGES.join() === 'check,update,download,sim,draw' && /data-fm-prog role="progressbar"/.test(main.html) && (main.html.match(/<i><\/i>/g) || []).length === 24);
  const wi = { end: 'def', vals: { efg: -2.5, secs: 1 } };
  const enc = F.encodeWi(wi), dec = F.decodeWi(enc);
  ok('?wi= round trips (base64url, ranges clamped)', /^[A-Za-z0-9_-]+$/.test(enc) && JSON.stringify(dec) === JSON.stringify(wi) && F.decodeWi(F.encodeWi({ end: 'off', vals: { efg: 99 } })).vals.efg === 5 && F.decodeWi('%%%') === null);
  const rm = F.rosterWhatIf(fo, club, { remove: club.players[0].id });
  ok('the roster what-if: removing the best guard costs margin through θ_G', rm && rm.g === club.players[0].g && rm.dBpm < 0 && rm.dMargin < 0 && rm.lo <= rm.dMargin && rm.dMargin <= rm.hi);
}

/* ------------------------------------------------------------------ the Worker's ops --- */
console.log('\nthe simulator, as mount() asks it');
{
  const A = T, B = others[0];
  const M = Sim.matchup(A.prof, B.prof, fo.lg, { home: 1, platt: null });
  const go = (op, args) => Sim.run(Sim.steps(op, args));
  const r = go('simulate', { M, n: 2000, seed: 1 });
  ok('simulate {M, n, seed}: a chance, its error and the margins', r.pWin > 0 && r.pWin < 1 && r.se > 0 && Array.isArray(r.hist) && r.hist.length > 10);
  const c = go('counterfactual', { M, edits: [{ side: 'A', end: 'off', key: 'efg', delta: 2 }], n: 2000, seed: 1, split: false });
  ok('counterfactual: +2 eFG% raises the chance and the margin', c.dWin > 0 && c.dMargin > 0);
  const avg = { off: Object.assign({}, fo.lg.rates), def: Object.assign({}, fo.lg.rates), n: 0 };
  const ca = go('counterfactual', { M: Sim.matchup(A.prof, avg, fo.lg, { home: 0 }), edits: [{ side: 'A', end: 'def', key: 'efg', delta: -2 }], n: 2000, seed: 1 });
  ok('...against an average side, on our defence: −2 eFG% allowed helps', ca.dWin > 0);
  const nd = go('needed', { M, key: 'efg', side: 'A', end: 'def', target: 0.6, n: 800, maxSteps: 8 });
  ok('needed {M, key, side, end, target}: a value in eFG% units', Number.isFinite(nd.value) && nd.value > 30 && nd.value < 70);
  const g = main.v.losses.list.find(x => x.sim), re = club.realised[g.g], op = fo.teams.find(t => t.id === g.opp);
  const sh = go('shapley', { Mexp: Sim.matchup(A.prof, op.prof, fo.lg, { home: g.h }), Mplayed: Sim.matchFrom(re.own, re.opp, fo.lg, { home: g.h }), groups: null, n: 150, seed: 1 });
  ok('shapley for a loss: six groups summing to full − base', Object.keys(sh.phi).length === 6 && near(Object.values(sh.phi).reduce((a, b) => a + b, 0), sh.full - sh.base, 1e-9));
  const by = F.neededByMargin(fo, F.DIALS[0], 'off', 50, 2, [-15, 15]);
  ok('the margin model\'s needed: +2 points of margin is 2 / b eFG%', near(by, 50 + 2 / fo.value.c_efg.b, 1e-9) && F.neededByMargin(fo, F.DIALS[4], 'off', 40, 2, [-20, 20]) === null);
}

/* ------------------------------------------------------------------ the words --- */
console.log('\nthe words (es, ja)');
const runDict = file => { const got = []; vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: { EpinoiaI18n: { register: (c, d, p) => got.push({ c, d, p }) } } }); return got; };
const i18n = require(path.join(EP, 'i18n.js'));
const PACK = {}, CORE = {}, OTHER = {};
for (const code of ['es', 'ja']) {
  const r = runDict(path.join(EP, 'i18n', code, 'frontoffice.js'));
  PACK[code] = r.length === 1 && r[0].c === code && r[0].p === 'frontoffice' ? r[0].d : null;
  CORE[code] = runDict(path.join(EP, 'i18n', code + '.js')).find(x => x.c === code && !x.p).d;
  OTHER[code] = ['report', 'go'].map(p => runDict(path.join(EP, 'i18n', code, p + '.js'))[0].d);
}
{
  ok('es and ja each register one "frontoffice" pack', !!PACK.es && !!PACK.ja);
  const ke = Object.keys(PACK.es.phrases).sort(), kj = Object.keys(PACK.ja.phrases).sort();
  ok('the same phrase keys in both (' + ke.length + ')', ke.length > 50 && JSON.stringify(ke) === JSON.stringify(kj), ke.filter(k => !kj.includes(k)).concat(kj.filter(k => !ke.includes(k))).slice(0, 5).join(' | '));
  const pe = PACK.es.patterns.map(p => String(p[0])), pj = PACK.ja.patterns.map(p => String(p[0]));
  ok('the same patterns in both (' + pe.length + '), in the same order', pe.length > 10 && JSON.stringify(pe) === JSON.stringify(pj));
  const fold = s => String(s).replace(/[\s ]+/g, ' ').trim().toLowerCase();
  const core = new Set([...Object.keys(CORE.es.phrases), ...Object.keys(CORE.ja.phrases)].map(fold));
  ok('no core phrase repeated in the pack', !ke.filter(k => core.has(fold(k))).length, ke.filter(k => core.has(fold(k))).slice(0, 5).join(' | '));
  ok('the chart kit\'s button and focus label (WP4\'s request) are in it', ['show table', 'hide table'].every(k => ke.includes(k)) && pe.some(p => /Arrow keys move between marks/.test(p)));
}
const DICT = {};
for (const code of ['es', 'ja']) {
  const parts = [CORE[code], ...OTHER[code], PACK[code]];
  DICT[code] = i18n.compile(code, Object.assign(i18n.merge(parts), { locale: CORE[code].locale, decimal: CORE[code].decimal, caseless: CORE[code].caseless, sentenceJoin: CORE[code].sentenceJoin }));
}
const tr = (code, s) => i18n.translateText(DICT[code], s, []);
const ENT = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function textsOf(html) {
  const out = [], stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] != null) { const s = ENT(m[5]).replace(/\s+/g, ' ').trim(); if (s && /[A-Za-z]/.test(s) && !stack.some(x => x.no)) out.push(s); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { while (stack.length && stack.pop().tag !== tag); continue; }
    const attrs = m[3];
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = new RegExp('\\s' + a + '="([^"]*)"').exec(attrs); if (v && /[A-Za-z]/.test(v[1]) && !/translate="no"/.test(attrs) && !stack.some(x => x.no)) out.push(ENT(v[1])); }
    if (!m[4] && !VOID.has(tag)) stack.push({ tag, no: /translate="no"/.test(attrs) || /class="[^"]*\bnotranslate\b/.test(attrs) });
  }
  return out;
}
/* every line the panel writes, in every state, and the lines mount() writes */
const lines = new Set();
[main.html, noFx.html].forEach(h => textsOf(h).forEach(s => lines.add(s)));
['members', 'signin', 'none', 'layout', 'network', 'league', 'scope'].forEach(r => textsOf(F.panel(F.view({ reason: r }))).forEach(s => lines.add(s)));
textsOf(F.panel(F.view({ reason: 'rate', retryAfter: 600 }))).forEach(s => lines.add(s));
const vmn = main.v;
const dl = F.DIALS.map(d => ({ d, cur: 50.2, v50: 47.1, v60: null }));
dl.concat(F.DIALS.map(d => ({ d, cur: 50.2, v50: null, v60: null }))).forEach(l => { lines.add(F.neededText(l, 'off')); lines.add(F.neededText(l, 'def')); });
textsOf(F.whatIfHTML(vmn, { dWin: 0.05, dMargin: 2.1, seMargin: 0.04 }, { dWin: 0.07, dMargin: 2.3, seMargin: 0.04 })).forEach(s => lines.add(s));
textsOf(F.whatIfHTML(noFx.v, null, { dWin: 0.07, dMargin: -2.3, seMargin: 0.04 })).forEach(s => lines.add(s));
[F.statusLine({ pending: 12 }, fo).line, F.statusLine({ pending: 1, built: new Date(Date.now() - 3 * 864e5).toISOString() }, fo).line, F.statusLine({ pending: 0, built: new Date().toISOString() }, fo).line,
 F.statusLine({ pending: 0, built: new Date(Date.now() - 25 * 60e3).toISOString() }, fo).line].forEach(s => lines.add(s));
/* mount()'s own messages (the bar, RECALCULATE's outcomes, the simulator's answers), as it writes them */
['Checking what has changed', 'Updating the model on the server', 'Downloading the new file (202 KB)', 'Downloading the new file', 'Re-simulating', 'Re-simulating: 40%', 'Drawing', 'Done',
 'Cancelled: anything the server had started still finishes, and is reused next time', 'Sign in to recalculate', 'Recalculating is for members',
 'Too many new games for a quick update: a full rebuild is scheduled', 'The update is queued: the next scheduled build picks these games up first',
 'Updated a few minutes ago: try again shortly', 'Joined an update already running', 'Joined an update already running: 3 new games added', 'Recalculated with 4 new games', 'Recalculated', 'Up to date',
 'Recalculate', 'Cancel', 'Working it out…', 'Simulating…', 'The simulator is not loaded', 'The simulator could not run just now', 'Not enough to work it out',
 'Chance of winning: 61% (the simulator alone: 59%)', 'Chance of winning from the margin model: 74% (the simulator alone: 62%)',
 'Simulator check: expected −7.3, at the game’s own rates −6.5', 'From the simulator, one rate at a time', 'From the margin model, one rate at a time',
 'Guards: −0.93 BPM, about −0.30 points a game (−0.53 to −0.11), 0.0 projected wins (approximate)', 'Bigs: +0.12 BPM, about +0.05 points a game (+0.01 to +0.09), +0.1 projected wins (approximate)',
 'filled from the minutes each player has played at each position', 'Members’ analysis.', 'The model could not be reached just now',
 'chance of winning', 'Chance of winning', 'Simulated final margins', 'final margin (simulated)', 'games', 'Simulator check of a loss', 'points of margin',
 'Points of margin. Arrow keys move between marks; Enter shows the table.', 'show table', 'hide table'].forEach(s => lines.add(s));
/* the depth chart by the floor and the GM's view with the model */
{
  const pos = club.pos;
  const roster = pos.players.map((p, i) => ({ id: p.id, name: 'P' + i, num: String(i), height: 190 + i }));
  const season = new Map(pos.players.map(p => [p.id, { mpg: 20, gp: pos.games, min: 400 }]));
  const cs = X.slotChart({ pos, roster, season, recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 }, out: new Set([roster[0].id]) });
  const ch = X.chartHTML(cs).replace(/<span class="dc-n">[\s\S]*?<\/span>/g, '').replace(/<span class="dc-chip[^"]*">[^<]*<\/span>/g, '');
  textsOf(ch).map(s => s.replace(/ · out: .*$/, '')).filter(s => !/^out: /.test(s)).forEach(s => lines.add(s));
  const clubs = Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, gp: 10, ortg: 100 + i, drtg: 110 - i * 0.5, net: i - 6, ff_efg: 48 + i * 0.5, dff_efg: 54 - i * 0.4, ff_tov: 12 + (i % 5), dff_tov: 13 + (i % 4),
    ff_oreb: 25 + i, dff_oreb: 28 - (i % 6), ff_ftr: 25 + (i % 7), dff_ftr: 22 + (i % 3), p3_pct: 30 + i * 0.6, ft_pct: 70 + (i % 9), rim_pct: 55 + (i % 8), pace: 68 + i, p3_share: 30 + i * 1.5, rim_share: 30 - i }));
  const gh = X.gmHTML(X.gm({ team: { id: 't2' }, teams: clubs, players: [], model: F.gmModel(fo, TID) }));
  textsOf(gh).filter(s => /wins per 30 games|ordered by what each is worth/.test(s)).forEach(s => lines.add(s));
}
for (const code of ['es', 'ja']) {
  const miss = [...lines].filter(s => tr(code, s) == null && !/^[\d\s.,:+−–%()-]+$/.test(s) && !/^[A-Z]{1,2}$/.test(s));
  ok(code + ': every line the Front office\'s model writes translates (' + lines.size + ')', !miss.length, miss.slice(0, 8).join(' | '));
  if (process.env.WW_FO_MISSING && miss.length) fs.writeFileSync(process.env.WW_FO_MISSING + '.' + code + '.json', JSON.stringify(miss, null, 1));
  const cw = [...chartWords].map(s => ENT(String(s))).filter(s => /[A-Za-z]/.test(s) && !/^[▲▼]/.test(s) && tr(code, s) == null && !/^[\d\s.,:+−–%()-]+$/.test(s) && !/^n = \d+$/.test(s));
  ok(code + ': every word handed to the charts translates (' + chartWords.size + ')', !cw.length, cw.slice(0, 8).join(' | '));
  if (process.env.WW_FO_MISSING && cw.length) fs.writeFileSync(process.env.WW_FO_MISSING + '.chart.' + code + '.json', JSON.stringify(cw, null, 1));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
