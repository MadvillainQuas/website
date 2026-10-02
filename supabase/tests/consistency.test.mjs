/* ============================================================================
   TEAM SPACING (epinoia/season.js) and 3PT CONSISTENCY (epinoia/consistency.js), on the player profile.

     * TEAM SPACING is a season row's number: the points his teammates' threes are worth per 100 possessions while he
       is on the floor, his own threes taken out, ranked in the league like any other bar;
     * 3PT CONSISTENCY is worked out for one player, when his profile is opened, from his game log: accuracy and volume
       recalculated after every game, and the score is how little they moved from where the season ended;
     * where they sit on the page, and that nothing here is computed for the league.

     node supabase/tests/consistency.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

const Season = require(path.join(ROOT, 'epinoia', 'season.js'));
const K = require(path.join(ROOT, 'epinoia', 'consistency.js'));

console.log('team spacing: the row');
{
  const game = (id, extra) => ({ game_id: id, player_uuid: 'P', team_idx: 0, stats: Object.assign({ min: 40 * 60000, pts: 12, p2a: 8, p2m: 4, p3a: 6, p3m: 2, fta: 2, ftm: 2 }, extra) });
  const tg = (id, adv) => [{ game_id: id, team_idx: 0, stats: { adv: Object.assign({ pts: 90, fga: 80, fgm: 36, fg3a: 30, fg3m: 12, fta: 20, ftm: 15, tov: 12, oreb: 10, dreb: 25, minutes: 200 }, adv) } },
    { game_id: id, team_idx: 1, stats: { adv: { pts: 80, fga: 75, fgm: 30, fg3a: 20, fg3m: 6, fta: 20, tov: 12, oreb: 8, dreb: 24, minutes: 200 } } }];
  const row = Season.players([game('g1')], tg('g1'))[0];
  const poss = 80 + 0.44 * 20 + 12;                        // the team's possessions, and he played all forty minutes
  ok('his teammates’ threes: 24 attempts and 10 makes (the team’s 30 and 12 less his own 6 and 2)',
     Math.abs(row.tm3_pct - 100 * 10 / 24) < 0.06 && Math.abs(row.tm3_a100 - 100 * 24 / poss) < 0.06, [row.tm3_pct, row.tm3_a100]);
  ok('TEAM SPACING = the points those makes are worth per 100 possessions: 3 x 10 / possessions x 100',
     Math.abs(row.team_spacing - 300 * 10 / poss) < 0.06, [row.team_spacing, 300 * 10 / poss]);
  const cold = Season.players([game('g1')], tg('g1', { fg3a: 12, fg3m: 2 }))[0];
  ok('a team that shoots fewer and worse gives him less room', cold.team_spacing < row.team_spacing / 2, [cold.team_spacing, row.team_spacing]);
  const alone = Season.players([game('g1', { p3a: 30, p3m: 12 })], tg('g1'))[0];
  ok('his OWN threes are taken out: when he took all of them there is no spacing to speak of (null)', alone.team_spacing === null, alone.team_spacing);
  const half = Season.players([game('g1', { min: 20 * 60000 })], tg('g1', { fg3a: 40, fg3m: 16 }))[0];
  ok('a player on the floor half the game is given half the team’s threes to count (weighted by his share of the game)',
     Math.abs(half.team_spacing - 300 * (0.5 * 16 - 2) / (0.5 * poss)) < 0.06, [half.team_spacing, 300 * (0.5 * 16 - 2) / (0.5 * poss)]);
  const few = Season.players([game('g1')], tg('g1', { fg3a: 8, fg3m: 3 }))[0];
  ok('under ten teammate attempts it is noise, and null', few.team_spacing === null, few.team_spacing);
  const shared = rd('supabase', 'functions', '_shared', 'season.js');
  ok('the Edge Functions’ copy of season.js carries it', /team_spacing:/.test(shared));
}

console.log('\n3pt consistency: the arithmetic');
{
  const steady = Array.from({ length: 20 }, (_, i) => ({ t: i, a: 5, m: 2, poss: 70 }));
  ok('a shooter who is 40% on five a night, every night, scores 100', K.threePt(steady).score === 100, K.threePt(steady));
  const hotCold = Array.from({ length: 20 }, (_, i) => ({ t: i, a: 6, m: i < 10 ? 4 : 0, poss: 70 }));
  const hc = K.threePt(hotCold);
  ok('hot for ten games then cold for ten is far from steady (variable)', hc.score < 45 && hc.label === 'variable', hc);
  const role = Array.from({ length: 20 }, (_, i) => ({ t: i, a: i < 10 ? 2 : 10, m: i < 10 ? 0 : 5, poss: 70 }));
  ok('a change of role and of form together is streaky', K.threePt(role).score < 30 && K.threePt(role).label === 'streaky', K.threePt(role));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const scores = [];
  for (let s = 0; s < 200; s++) {
    const g = Array.from({ length: 25 }, (_, i) => { const a = 4 + Math.floor(rnd() * 5); let m = 0; for (let k = 0; k < a; k++) if (rnd() < 0.36) m++; return { t: i, a, m, poss: 70 }; });
    scores.push(K.threePt(g).score);
  }
  scores.sort((a, b) => a - b);
  ok('a shooter whose only variation is chance sits in the middle-upper range (median 55-80), not at the extremes', scores[100] >= 55 && scores[100] <= 80, scores[100]);
  ok('the order the games are given in does not matter; they are walked by date', K.threePt(hotCold.slice().reverse()).score === hc.score);
  ok('it measures steadiness, not quality: a 25% shooter who is 25% every night is just as steady',
     K.threePt(Array.from({ length: 20 }, (_, i) => ({ t: i, a: 8, m: 2, poss: 70 }))).score === 100);
  const noPoss = K.threePt(hotCold.map(g => Object.assign({}, g, { poss: null })));
  ok('with no possessions on record it is read from accuracy alone', noPoss.ok && noPoss.volume === null && noPoss.score > 0, noPoss);
  const r = K.threePt(steady);
  ok('the running percentage after each game is handed back for the line under the card', r.curve.length === 20 && r.curve.every(v => v === 40), r.curve.slice(0, 3));
  ok('under five games there is nothing to be consistent about', K.threePt(steady.slice(0, 4)).ok === false && /needs 5 games/.test(K.threePt(steady.slice(0, 4)).why));
  ok('under 25 attempts too', K.threePt(Array.from({ length: 10 }, (_, i) => ({ t: i, a: 2, m: 1, poss: 70 }))).ok === false);
}

console.log('\n3pt consistency: from the game log');
{
  const row = (i, o) => ({ games: { tipoff_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), competition_id: (o && o.comp) || 'c1', status: (o && o.status) || 'final' },
    stats: Object.assign({ min: 1800000, p3a: 5, p3m: 2, oc: { tFGA: 60, tFTA: 15, tTOV: 10, tOR: 8 } }, o && o.stats) });
  const log = Array.from({ length: 12 }, (_, i) => row(i));
  ok('a log becomes games with the possessions of his team on the floor', K.fromLog(log, null, Season.POSS).ok && Math.abs(K.fromLog(log, null, Season.POSS).vol - 100 * 5 / Season.POSS(60, 15, 10, 8)) < 0.06);
  const mixed = log.concat(Array.from({ length: 12 }, (_, i) => row(30 + i, { comp: 'c2' })));
  ok('cut to the competitions the profile is showing: another competition’s games are not his season here', K.fromLog(mixed, ['c1'], Season.POSS).games === 12 && K.fromLog(mixed, null, Season.POSS).games === 24);
  ok('a game that was not finished, or he did not play, is not counted',
     K.fromLog(log.concat([row(50, { status: 'scheduled' }), row(51, { stats: { min: 0 } })]), null, Season.POSS).games === 12);
  ok('a game with no on-court block still counts for accuracy', K.fromLog(log.map(r => Object.assign({}, r, { stats: Object.assign({}, r.stats, { oc: null }) })), null, Season.POSS).volume === null);
}

console.log('\nthe page');
const pjs = rd('epinoia', 'p', 'player.js');
const rim = pjs.slice(pjs.indexOf("title: 'at the rim'"), pjs.indexOf("title: 'mid-range'"));
ok('TEAM SPACING is a bar in "at the rim", ranked like the others (higher is more room)', /\['team_spacing','TEAM SPACING'\]/.test(rim) && !/'team_spacing'/.test(pjs.slice(pjs.indexOf('const BAR_LOW'), pjs.indexOf('];', pjs.indexOf('const BAR_LOW')))));
ok('...with a tooltip that says what it is', /team_spacing: 'How stretched the floor/.test(pjs));
const three = pjs.slice(pjs.indexOf("title: 'three-pointers'"), pjs.indexOf("title: 'free throws'"));
ok('3PT CONSISTENCY sits with the three-pointers, as a card of its own', /consistency: true/.test(three) && /'3PT CONSISTENCY'/.test(pjs) && /blk\.consistency \? consistencyCard : null/.test(pjs));
ok('...worked out from the game log the page already reads, not asked for again', /LOG_ROWS = rows;/.test(pjs) && /K\.fromLog\(LOG_ROWS, SCOPE_IDS/.test(pjs) && !/consistency[^\n]*api\(/i.test(pjs));
ok('...for this player only: nothing about it is computed in season.js or for the league', !/consistency/i.test(rd('epinoia', 'season.js')));
ok('...cut to the competitions in view, so the log query names each game’s competition', /games(!inner)?\(tipoff_at,competition_id,/.test(pjs) && /SCOPE_IDS = ids;/.test(pjs));
ok('...and drawn again when the log arrives', /if \(LAST_BARS\) paintBars\(LAST_BARS\.mine, LAST_BARS\.field\)/.test(pjs));
const html = rd('epinoia', 'p', 'index.html');
ok('the page loads consistency.js before player.js', html.indexOf('../consistency.js?v=') > 0 && html.indexOf('../consistency.js?v=') < html.indexOf('<script src="player.js'));

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
