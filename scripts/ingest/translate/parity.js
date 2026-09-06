// parity.js — replay a translated log through the REAL Epinoia engine and diff
// every player's box against FIBA's own totals. Usage:
//   node scripts/ingest/translate/parity.js <translated.json> <raw data.json>
// Exit code 0 = every counted stat matches for every player; 1 = mismatches listed.
const fs = require('fs');
const path = require('path');
const E = require(path.resolve(__dirname, '../../../epinoia/engine.js'));

const [, , tPath, rawPath] = process.argv;
const T = JSON.parse(fs.readFileSync(tPath, 'utf8'));
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

// the merged event object every consumer builds: id = seq, payload spread
const events = T.events.map(e => Object.assign({ id: e.seq, seq: e.seq, t: e.t, team: e.team, pid: e.pid, period: e.period, clock: e.clock }, e.payload));
const game = { teams: T.roster_snapshot.teams, starters: T.starters, events, period: T.period, clockMs: 0, tipWinner: T.tip_winner, arrowInit: T.arrow_init };
const d = E.deriveGame(game);

const mins = s => { const m = String(s || '0:00').match(/^(\d+):(\d+)/); return m ? +m[1] + (+m[2]) / 60 : 0; };
let bad = 0, checked = 0;
const rows = [];
['1', '2'].forEach((k, ti) => {
  const tm = raw.tm[k];
  Object.entries(tm.pl || {}).forEach(([pno, p]) => {
    const pid = `${ti}:${pno}`;
    const s = d.stats[pid] || {};
    const fgm = (s.p2m || 0) + (s.p3m || 0), fga = (s.p2a || 0) + (s.p3a || 0);
    const cmp = [
      ['pts', s.pts || 0, +p.sPoints || 0], ['fgm', fgm, +p.sFieldGoalsMade || 0], ['fga', fga, +p.sFieldGoalsAttempted || 0],
      ['3pm', s.p3m || 0, +p.sThreePointersMade || 0], ['3pa', s.p3a || 0, +p.sThreePointersAttempted || 0],
      ['ftm', s.ftm || 0, +p.sFreeThrowsMade || 0], ['fta', s.fta || 0, +p.sFreeThrowsAttempted || 0],
      ['or', s.or || 0, +p.sReboundsOffensive || 0], ['dr', s.dr || 0, +p.sReboundsDefensive || 0],
      ['ast', s.ast || 0, +p.sAssists || 0], ['stl', s.stl || 0, +p.sSteals || 0], ['blk', s.blk || 0, +p.sBlocks || 0],
      ['to', s.to || 0, +p.sTurnovers || 0], ['pf', s.pf || 0, +p.sFoulsPersonal || 0], ['fd', s.fd || 0, +p.sFoulsOn || 0],
    ];
    const diffs = cmp.filter(([, a, b]) => a !== b);
    checked += cmp.length; bad += diffs.length;
    const minEp = (s.min || 0) / 60000, minF = mins(p.sMinutes);
    const minOff = Math.abs(minEp - minF) > 0.6;
    if (diffs.length || minOff) rows.push(`  ${k === '1' ? 'H' : 'A'} ${(p.name || pno).padEnd(16)} ` +
      diffs.map(([n, a, b]) => `${n} ${a}≠${b}`).join(' ') + (minOff ? ` min ${minEp.toFixed(1)}≠${minF.toFixed(1)}` : ''));
  });
});
const teamPts = [+raw.tm['1'].tot_sPoints || 0, +raw.tm['2'].tot_sPoints || 0];
const scoreOk = d.score[0] === teamPts[0] && d.score[1] === teamPts[1];
const teamReb = ['1', '2'].map(k => (+raw.tm[k].tot_sReboundsTeam || 0));
const epTeamReb = [0, 1].map(t => (d.team[t].teamRebO || 0) + (d.team[t].teamRebD || 0));
console.log(`${path.basename(rawPath)}: events ${events.length}, score ${d.score.join('-')} vs FIBA ${teamPts.join('-')} ${scoreOk ? 'OK' : 'MISMATCH'}, ` +
  `team reb ${epTeamReb.join('/')} vs ${teamReb.join('/')}, player stats ${checked - bad}/${checked} match` +
  (T.report.unmatched ? `, unmatched pids ${T.report.unmatched}` : '') + (T.report.warnings.length ? `, warnings: ${T.report.warnings.join('; ')}` : ''));
rows.forEach(r => console.log(r));
process.exit(bad || !scoreOk ? 1 : 0);
