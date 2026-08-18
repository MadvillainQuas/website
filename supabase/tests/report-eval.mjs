/* ============================================================================
   THE REPORT EVALUATOR — how good is the writing, measured rather than felt.

   Not a pass/fail test. It replays every finished game on the platform through
   the real engine, writes the report, and scores the prose on the things that
   separate a readable match report from a list of true sentences:

     COVERAGE      how much of the available statistical surface is used at
                   all. A report that never mentions assists, or free throws,
                   or who forced the turnovers, is leaving the data on the
                   floor whatever else it does well.
     DEPTH         words, sentences, and facts per report. Longer is not
                   better on its own, but a report that never exceeds four
                   sentences cannot be developed.
     COHESION      how often consecutive sentences open the same way, and how
                   often the same club name starts a sentence. This is the
                   single most reliable smell of generated prose: "Soft Club
                   won X. Soft Club won Y. Soft Club's bench…"
     REPETITION    the same number or the same passage of play described more
                   than once.

   Run it before and after a change and compare. Anything it cannot measure —
   whether a sentence is worth reading — still needs a person, which is why the
   sample output is printed at the end.

       node supabase/tests/report-eval.mjs            all finished games
       node supabase/tests/report-eval.mjs --show 2   print two reports in full
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const G = path.join(ROOT, 'epinoia', 'game');

/* the engine, the fact layer and the writer — the real ones */
const Engine = require(path.join(ROOT, 'epinoia', 'engine.js'));
globalThis.EpinoiaStory = require(path.join(G, 'story.js'));
const Story = globalThis.EpinoiaStory;
const Report = require(path.join(G, 'report.js'));

const CFG = { url: 'https://hhvofgqqadtyvcjudhjx.supabase.co',
              key: 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO' };

async function api(p) {
  const r = await fetch(CFG.url + '/rest/v1/' + p,
    { headers: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key } });
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

/* Page the log — a game runs to hundreds of events and PostgREST caps a
   response whatever limit says. */
async function fetchLog(id) {
  let out = [], from = 0;
  for (;;) {
    const page = await api(`game_events?game_id=eq.${id}` +
      `&select=seq,t,team,pid,period,clock,payload&order=seq&offset=${from}&limit=1000`);
    out = out.concat(page);
    if (page.length < 1000) break;
    from += 1000;
  }
  return out.map(r => Object.assign(
    { t: r.t, id: r.seq, seq: r.seq, period: r.period, clock: r.clock },
    r.payload || {},
    r.team != null ? { team: r.team } : {},
    r.pid != null ? { pid: r.pid } : {}));
}

/* The brief, built exactly as epinoia/game/gamefacts.js builds it. */
function brief(S, d) {
  const players = [], byId = {};
  S.teams.forEach((tm, t) => (tm.players || []).forEach(p => {
    const s = d.stats[p.id] || {};
    const fga = (s.p2a || 0) + (s.p3a || 0), den = 2 * (fga + 0.44 * (s.fta || 0));
    const row = Object.assign({}, s, { id: p.id, name: p.name, num: p.num, team: t,
      ts: den ? (s.pts || 0) / den * 100 : null });
    players.push(row); byId[p.id] = row;
  }));
  let periods = 1;
  (S.events || []).forEach(e => { if (e.period > periods) periods = e.period; });
  return {
    names: [S.teams[0].name, S.teams[1].name], score: d.score.slice(),
    players, byId, team: [d.team[0], d.team[1]],
    /* engine.js takes (game, d, t); the browser's lifted copy takes (d, t)
       and reads the scorer's global. Same maths, different closure. */
    adv: [Engine.teamAdv(S, d, 0), Engine.teamAdv(S, d, 1)],
    lineups: [Engine.lineupAgg(d, 0), Engine.lineupAgg(d, 1)],
    stints: [d.lineups[0] || [], d.lineups[1] || []],
    perQ: d.perQ, periods, events: S.events || [],
    season: S.season || null
  };
}

/* ---------------------------------------------------------------- metrics --- */
/* The statistical families a report COULD talk about. Coverage is the share of
   these that appear anywhere in the prose. */
const FAMILIES = {
  'score/margin':   /\b\d+[–-]\d+\b|margin|points/i,
  'periods':        /quarter|period|first|second|third|fourth|half/i,
  'runs':           /run\b|unanswered|spell|stretch/i,
  'shooting':       /shooting|effective field goal|from the field|true shooting|eFG/i,
  'three-point':    /three|3pt|arc|range/i,
  'free throws':    /free throw|line\b|FTr/i,
  'turnovers':      /turnover|giveaway|gave away|ball security/i,
  'rebounding':     /rebound|glass|board/i,
  'assists':        /assist|creat|passing|playmak/i,
  'defence':        /steal|block|defensive rating|defence|forced/i,
  'lineups':        /group|floor|five|lineup|combination|on court/i,
  'bench':          /bench|reserve|starters/i,
  'paint/zones':    /paint|rim|inside|mid-range|close/i,
  'pace/ratings':   /pace|possession|per 100|rating/i,
  'individuals':    /led .* with|scored \d+|filled every column|went for/i,
  'season context': /average|season|per game this|usual|career|form/i,
  'fouls':          /foul|disqualif|in trouble/i
};

function measure(rep) {
  const paras = rep.sections.flatMap(s => s.paras);
  const prose = [rep.headline, rep.standfirst].concat(paras).join(' ');
  const sentences = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 4);
  const words = prose.split(/\s+/).filter(Boolean).length;

  const covered = Object.keys(FAMILIES).filter(k => FAMILIES[k].test(prose));

  /* cohesion: how many sentences open with the same first two words as the
     previous one, and how many open with a club name */
  const opens = sentences.map(s => s.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase());
  let repeatedOpen = 0;
  for (let i = 1; i < opens.length; i++) if (opens[i] === opens[i - 1]) repeatedOpen++;
  const openCounts = {};
  opens.forEach(o => { openCounts[o] = (openCounts[o] || 0) + 1; });
  const worstOpen = Object.entries(openCounts).sort((a, b) => b[1] - a[1])[0] || ['', 0];

  /* connectives: the words that turn a list into an argument */
  const CONNECT = /\b(but|however|although|though|even so|which|because|so\b|while|whereas|after|once|by then|from there|in the end|meanwhile|still|yet)\b/gi;
  const connectives = (prose.match(CONNECT) || []).length;

  /* repetition: the same number quoted more than twice */
  const nums = (prose.match(/\b\d+(?:\.\d+)?\b/g) || []);
  const numCounts = {};
  nums.forEach(n => { numCounts[n] = (numCounts[n] || 0) + 1; });
  const overUsed = Object.entries(numCounts).filter(([, c]) => c > 2).length;

  /* DENSITY — numerals per sentence. The clearest measure of prose reading as
     a spreadsheet: "added 17, 9.5 clear of his average, 5 of 12 from the field
     for 56.4% true shooting" is four numbers in one breath, and no human match
     report does that. Two is a sentence with evidence; four is a table row.
     Also the share of sentences that are STAT-SHAPED — a name, a verb and then
     nothing but comma-separated figures. */
  const nums2 = sentences.map(x => (x.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length);
  const density = nums2.reduce((a, b) => a + b, 0) / Math.max(1, sentences.length);
  const dense = nums2.filter(n => n >= 4).length;
  const commaLists = sentences.filter(x => (x.match(/,/g) || []).length >= 3).length;
  return {
    words, sentences: sentences.length, facts: rep.facts.length,
    sections: rep.sections.length,
    coverage: covered.length, coverageOf: Object.keys(FAMILIES).length,
    covered, missing: Object.keys(FAMILIES).filter(k => covered.indexOf(k) < 0),
    repeatedOpen, worstOpen: worstOpen[0] + ' x' + worstOpen[1],
    connectives, overUsedNumbers: overUsed,
    density, denseSentences: dense, commaLists
  };
}

/* -------------------------------------------------------------------- run --- */
const show = (() => { const i = process.argv.indexOf('--show');
  return i > 0 ? (parseInt(process.argv[i + 1], 10) || 1) : 0; })();

const games = await api('games?status=eq.final&select=id,home_team_id,away_team_id' +
  ',competition_id&order=tipoff_at.desc&limit=30');

/* Season aggregates, exactly as the page loads them, so the evaluator
   measures the prose the reader actually gets rather than a version
   missing its context. */
const Season = require(path.join(ROOT, 'epinoia', 'season.js'));
require(path.join(ROOT, 'epinoia', 'bpm.js'));
async function seasonFor(games) {
  const ids = games.map(g => g.id);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
  const pgs = (await Promise.all(chunks.map(c => api(
    `player_game_stats?game_id=in.(${c.join(',')})&select=game_id,player_uuid,player_id,team_idx,stats`)))).flat();
  const tgs = (await Promise.all(chunks.map(c => api(
    `team_game_stats?game_id=in.(${c.join(',')})&select=game_id,team_idx,stats`)))).flat();
  const byId = {}; games.forEach(g => { byId[g.id] = g; });
  return { players: Season.players(pgs, tgs), teams: Season.teams(tgs, byId) };
}
const SEASON = await seasonFor(games);
if (!games.length) { console.log('no finished games to evaluate'); process.exit(0); }

const rows = [];
let shown = 0;
for (const g of games) {
  let S, d;
  try {
    const [gs] = await api(`games?id=eq.${g.id}&select=roster_snapshot,starters,tip_winner,arrow_init,period`);
    const snap = gs.roster_snapshot;
    if (!snap || !snap.teams) continue;
    const events = await fetchLog(g.id);
    if (!events.length) continue;
    S = { teams: snap.teams, starters: gs.starters || [[], []], events,
          period: gs.period || 4, clockMs: 0, phase: 'final',
          tipWinner: gs.tip_winner, arrowInit: gs.arrow_init };
    d = Engine.deriveGame(S);
  } catch (e) { continue; }

  const b = brief(S, d);
  b.season = { players: SEASON.players, teams: SEASON.teams,
               teamIndex: { [g.home_team_id]: 0, [g.away_team_id]: 1 } };
  const rep = Report.report(b);
  const m = measure(rep);
  rows.push({ id: g.id.slice(0, 8), score: b.score.join('-'), ...m });

  if (shown < show) {
    shown++;
    console.log('\n' + '='.repeat(74));
    console.log(rep.headline.toUpperCase());
    console.log(rep.standfirst);
    rep.sections.forEach(s => {
      console.log('\n-- ' + s.heading + ' --');
      s.paras.forEach(p => console.log('   ' + p));
    });
    console.log('='.repeat(74));
  }
}

if (!rows.length) { console.log('no replayable games'); process.exit(0); }

const avg = k => (rows.reduce((a, r) => a + r[k], 0) / rows.length);
console.log('\nREPORT QUALITY over ' + rows.length + ' finished games');
console.log('  words / report        ' + avg('words').toFixed(0));
console.log('  sentences / report    ' + avg('sentences').toFixed(1));
console.log('  facts found           ' + avg('facts').toFixed(1));
console.log('  sections              ' + avg('sections').toFixed(1));
console.log('  stat coverage         ' + avg('coverage').toFixed(1) + ' / ' +
            rows[0].coverageOf + '  (' +
            (avg('coverage') / rows[0].coverageOf * 100).toFixed(0) + '%)');
console.log('  connectives / report  ' + avg('connectives').toFixed(1));
console.log('  repeated openers      ' + avg('repeatedOpen').toFixed(2) + '   (lower is better)');
console.log('  over-used numbers     ' + avg('overUsedNumbers').toFixed(2) + '   (lower is better)');
console.log('  numerals / sentence   ' + avg('density').toFixed(2) + '   (lower is better)');
console.log('  4+ number sentences   ' + avg('denseSentences').toFixed(2) + '   (lower is better)');
console.log('  comma-list sentences  ' + avg('commaLists').toFixed(2) + '   (lower is better)');

/* which families are never touched, across every game — the clearest list of
   what the writer is not yet saying */
const neverCovered = Object.keys(FAMILIES).filter(k => rows.every(r => r.missing.indexOf(k) >= 0));
const sometimes = Object.keys(FAMILIES).filter(k =>
  rows.some(r => r.missing.indexOf(k) >= 0) && neverCovered.indexOf(k) < 0);
console.log('\n  never mentioned:  ' + (neverCovered.join(', ') || '(none)'));
console.log('  sometimes missed: ' + (sometimes.join(', ') || '(none)'));
console.log('\n  worst repeated sentence opener seen: ' +
  rows.map(r => r.worstOpen).sort((a, b) =>
    parseInt(b.split('x')[1]) - parseInt(a.split('x')[1]))[0]);
