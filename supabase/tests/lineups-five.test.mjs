/* ============================================================================
   FIVE ON THE FLOOR, AND THE MINUTES THE BOX SCORE SAYS.

   Every minute, plus/minus, on-court rating, lineup and per-minute rate on the
   game page is the engine running stints over the event log, so a side that is
   not five a side for a stretch is wrong everywhere at once -- and nothing on
   the page looks broken. Found 2026-09-23 auditing the full stats tab against
   LiveStats' own box score over the 160 saved SLB games:

     - 22 games had a side on four or six, for 19 seconds to 23 minutes: the
       translator dropped a substitution whose OUT and IN the operator had not
       logged back to back (scripts/ingest/translate/subs_test.py);
     - 7 more lost up to ten minutes of one player: a change logged twice sent
       on somebody already on, and the engine restarted his stint at the repeat.

   This replays every saved game through the ingest's own translator and the
   engine, and holds both sides to five a side throughout and each player's
   minutes to the feed's own, wherever the feed's box adds up to the game.

     node supabase/tests/lineups-five.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const sandbox = { console };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(read('epinoia/engine.js'), ctx, { filename: 'engine.js' });
const E = sandbox.EpinoiaEngine;

/* ---- the engine: somebody sent on who is already on keeps his stint ----------------------- */
console.log('\na change logged twice');
{
  const teams = [0, 1].map(t => ({ name: 't' + t, players: [1, 2, 3, 4, 5, 6].map(i => ({ id: t + ':' + i, name: 'P' + i, num: i })) }));
  const starters = [0, 1].map(t => [1, 2, 3, 4, 5].map(i => t + ':' + i));
  const ev = [
    { id: 1, t: 'period_start', period: 1, clock: 600000 },
    { id: 2, t: 'sub', team: 0, period: 1, clock: 480000, out: '0:1', in: '0:6' },    // 2:00 in
    { id: 3, t: 'sub', team: 0, period: 1, clock: 300000, out: '0:1', in: '0:6' },    // the same change again at 5:00
  ];
  const d = E.deriveGame({ teams, starters, events: ev, period: 1, clockMs: 0 });
  const min = id => d.stats[id].min / 60000;
  ok('the player sent on at 2:00 has his eight minutes, not the five since the repeat', min('0:6') === 8, String(min('0:6')));
  ok('...the player he replaced keeps his two', min('0:1') === 2, String(min('0:1')));
  ok('...and the side\'s minutes still add up to the quarter', [1, 2, 3, 4, 5, 6].reduce((n, i) => n + min('0:' + i), 0) === 50);
}

/* ---- every saved SLB game ------------------------------------------------------------------ */
console.log('\nevery saved SLB game, through the ingest\'s translator and the engine');
const DIR = path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data');
/* the folder, not 160 paths: a Windows command line stops at 32K characters */
const files = fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f)).sort().map(f => path.join(DIR, f));
const py = [
  'import sys, json, io, os, re',
  'sys.path.insert(0, sys.argv[1])',
  'from translate.fiba_events import translate',
  'out = []',
  'for n in sorted(f for f in os.listdir(sys.argv[2]) if re.match(r"^[0-9]+[.]json$", f)):',
  '    T = translate(json.load(io.open(os.path.join(sys.argv[2], n), encoding="utf-8")), lambda team, pno: "%s:%s" % (team, pno))',
  '    out.append({"starters": T["starters"], "period": T["period"], "teams": T["roster_snapshot"]["teams"],',
  '                "events": [dict(e, **(e.get("payload") or {}), id=e["seq"]) for e in T["events"]]})',
  'sys.stdout.write(json.dumps(out))',
].join('\n');
let games = null;
for (const exe of ['python3', 'python']) {
  const r = spawnSync(exe, ['-c', py, path.join(ROOT, 'scripts', 'ingest'), DIR], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status === 0 && r.stdout) { games = JSON.parse(r.stdout); break; }
}
ok(files.length + ' saved games translate', !!games && games.length === files.length);

const mmss = s => { const m = /^(\d+):(\d+)/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : 0; };
const notFive = [], sums = [], minutes = [];
let compared = 0;
(games || []).forEach((T, gi) => {
  const name = path.basename(files[gi]);
  const raw = JSON.parse(fs.readFileSync(files[gi], 'utf8'));
  const d = E.deriveGame({ teams: T.teams, starters: T.starters, events: T.events, period: T.period, clockMs: 0 });
  const length = E.cumEl(T.period, 0);
  [0, 1].forEach(t => {
    const off = d.lineups[t].filter(l => l.ids.length !== 5 && l.dur > 0);
    if (off.length) notFive.push(`${name} side ${t}: ${off.length} stints, ${(off.reduce((n, l) => n + l.dur, 0) / 1000).toFixed(0)} s`);
    const ours = T.teams[t].players.reduce((n, p) => n + (d.stats[p.id] ? d.stats[p.id].min : 0), 0);
    if (Math.abs(ours - 5 * length) > 1000) sums.push(`${name} side ${t}: ${(ours / 60000).toFixed(2)} v ${(5 * length / 60000).toFixed(0)}`);
    /* the feed's own box, where it adds up to the game (a payload saved mid-game does not) */
    const pl = raw.tm[String(t + 1)].pl || {};
    const feedSum = Object.values(pl).reduce((n, p) => n + mmss(p.sMinutes), 0);
    if (Math.abs(feedSum * 1000 - 5 * length) > 5000) return;
    compared++;
    for (const pno in pl) {
      const s = d.stats[t + ':' + pno];
      const a = s ? s.min / 1000 : 0, b = mmss(pl[pno].sMinutes);
      if (Math.abs(a - b) > 60) minutes.push(`${name} ${t}:${pno} ${pl[pno].familyName}: ours ${(a / 60).toFixed(2)} feed ${pl[pno].sMinutes}`);
    }
  });
});
ok('both sides are five on the floor for every second of every game', !notFive.length, notFive.slice(0, 5).join('; '));
ok('...so each side\'s player minutes add up to the game', !sums.length, sums.slice(0, 5).join('; '));
ok(`every player's minutes are within a minute of the feed's own (${compared} sides whose box adds up)`,
   compared > 300 && !minutes.length, minutes.slice(0, 5).join('; '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
