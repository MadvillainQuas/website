/* ============================================================================
   A CORRECTED FEED MUST NOT EMPTY THE GAME, OR UN-TIME IT.

   When the Genius feed revises something, run_ingest cannot append — the
   existing log is no longer a prefix of the new one — so it rewrites. Three
   faults, all watched happening on live fixtures on 2026-09-12.

   Caught three times in fifteen minutes, not twice: 82 -> 0, 114 -> 0, 154 -> 0.

   1. THE GAME WENT EMPTY. It was `delete everything, then insert everything`:
      two requests with no transaction around them, so between them the game had
      no play-by-play at all. Caught twice inside five minutes on two different
      live games — 82 events then zero, 114 events then zero — while games.
      home_score still read 2-16. Anything reading the log in that gap (the
      public game page, the box score, the broadcast endpoint, finalise-game)
      saw a game that had not been played. It heals a second later, which is
      exactly why nobody had seen it.

   2. THE WALL STAMPS WENT WITH IT. The stamps already earned are carried across
      by matching the old rows against the new, and the key included `pid` — the
      one component that is a PLATFORM id rather than feed data. Player rows are
      minted during a game as substitutes appear, so a pid that is re-resolved
      between two polls changes for every event naming a player while the play
      itself has not moved. The carry then matches nothing, and because only rows
      past len(existing) get a fresh stamp, everything before that point is left
      permanently unstamped: it cannot be re-stamped on any later pass, and every
      replace after it has nothing left to carry. A ratchet.

      Measured the same evening: all four live games ended up largely un-timed.
      One of them held 251 of 251 for as long as it went uncorrected and then
      dropped to 67 of 325 the moment it was, which is the clearest statement of
      the mechanism there is. Translating a feed afresh and
      comparing field by field found t, team, period and clock IDENTICAL across
      all 144 rows — so the four fields describing the PLAY are stable, and the
      one that broke the carry describes our database.

   There is no Python test harness in this repo, so these assert the source.
   The behaviour above was established by watching production, not by this file.

     node supabase/tests/ingest-replace.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const src = readFileSync(path.join(ROOT, 'scripts', 'ingest', 'run_ingest.py'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

console.log('\nthe game is never empty');

ok('the log is upserted over itself rather than deleted and rebuilt',
   /sb\.upsert\("game_events", rows\[i:i \+ 400\], "game_id,seq"\)/.test(src));
ok('...so there is no unconditional delete of the game left',
   !/sb\.delete\("game_events", f"game_id=eq\.\{game_id\}"\)/.test(src));
ok('...and only a log that got SHORTER deletes anything, and then only the surplus',
   /if existing and len\(rows\) < len\(existing\):/.test(src) &&
   /sb\.delete\("game_events", f"game_id=eq\.\{game_id\}&seq=gt\.\{len\(rows\)\}"\)/.test(src));
ok('...which works because the rows are keyed on (game_id, seq)',
   /"game_id,seq"/.test(src));
ok('...and the reason is written down where the next reader will need it',
   /there must be no instant at which the league's copy of the game is empty/.test(src));

console.log('\nand it is not un-timed');

ok('the carry key no longer contains pid',
   /carry\.setdefault\(\(e\["t"\], e\.get\("team"\), e\["period"\], e\["clock"\]\)/.test(src) &&
   !/carry\.setdefault\(\(e\["t"\], e\.get\("team"\), e\.get\("pid"\)/.test(src));
ok('...on both sides of the comparison',
   /k = \(r\["t"\], r\["team"\], r\["period"\], r\["clock"\]\)/.test(src));
ok('...and the reason is recorded: pid is ours, the other four are the feed\'s',
   /the only component of that key which is a PLATFORM id/.test(src));
ok('...with the measurement that established it',
   /t,\s*\n\s*# team, period and clock IDENTICAL across all 144 rows/.test(src) ||
   /team, period and clock IDENTICAL across all 144 rows/.test(src));

ok('anything the key still missed is carried by position, as the comment always claimed',
   /if kept < len\(existing\):/.test(src) &&
   /for i, r in enumerate\(rows\):/.test(src));
ok('...only onto a row that is still the same play',
   /!=\s*\(r\["t"\], r\["team"\], r\["period"\], r\["clock"\]\)/.test(src) &&
   /continue/.test(src));
ok('...and never over a stamp already carried',
   /if "wall" in \(r\.get\("payload"\) or \{\}\):\s*\n\s*continue/.test(src));

/* The ratchet is the reason this matters more than one lost stamp: the branch
   that hands out fresh stamps only reaches rows past the old length. */
ok('the fresh stamp still only goes to rows past the old length',
   /for r in rows\[len\(existing\):\]:/.test(src));
ok('...which is why the carry has to work, and is said so',
   /A\s*\n?\s*# ratchet, not a blip\./.test(src) || /ratchet, not a blip/.test(src));

console.log('\nand the error bar says what it means');

/* observed[1] is built in live_keeper as the CONFIGURED interval plus the fetch
   duration, and the comment there is right about the meaning while the
   arithmetic is not: the previous poll of THIS game was not `every` seconds ago,
   because live_keeper walks the due set in one serialised loop doing a fetch and
   a whole write pass per game before sleeping.

   Measured across four simultaneous live games, 46 intervals: median 37.9 s
   against a claimed 10.5 s, 40 of 46 wider than claimed, worst 18.9x. Every row
   of a batch is stamped with the poll's instant, so the earliest play in it is
   that much earlier than its stamp — and video.js spends wall_err as run-up when
   it cuts a clip, so an understated bar puts the play in front of its own
   window. The page prints the number too: "plays placed to within +/-N s". */
ok('the stamp widens its error to the real gap when the log knows better',
   /const newest = max/.test(src) === false &&   /* python, not js */
   /newest = max\(\(int\(\(e\.get\("payload"\) or \{\}\)\.get\("wall"\)\)/.test(src));
ok('...which is the previous poll of this game, by definition',
   /the newest\s*\n?\s*# wall in the existing log IS when this game was last polled/.test(src));
ok('...and never narrows it', /if real > err:\s*\n\s*err = real/.test(src));
ok('...covering a pass handover, which the loop cannot see at all',
   /a process that has already exited/.test(src));
ok('past three minutes it declines to stamp rather than claim a bound it has not got',
   /if err <= 180_000:/.test(src) &&
   /an unstamped row is better than a confidently wrong one/.test(src));
ok('the measurement that justifies it is recorded',
   /median 37\.9 s against a claimed 10\.5 s/.test(src));

/* And the one other reader of observed[1] asks a different question. */
ok('the running heuristic keeps the CONFIGURED value on purpose',
   /DELIBERATELY THE CONFIGURED INTERVAL/.test(src) &&
   /fast = bool\(observed and observed\[1\] is not None and observed\[1\] <= 6000\)/.test(src));
ok('...and says why, so nobody widens it to match the stamp',
   /would make a slow pass look like a fast one/.test(src));

/* ---------------------------------------------------------------------------
   A LIVE GAME IS TIMED WHICHEVER LANE SEES IT.

   Only live_keeper passed `observed`. The half-hourly discovery pass wrote live
   games too, unstamped, and those rows could never be stamped later: the live
   lane's next poll finds the log already that long and stamps only what is past
   it. When discovery saw a game first, the unstamped row was the tip, and a game
   with no tip stamp has no tip_wall and falls back to insert times throughout.

   And a tail on a log with no stamps at all took the configured interval as its
   error bar, however long ago the log was really written. The log's own
   created_at says when that was.

   Run against the real write_event_log, on a real LiveStats payload, with the
   database faked.
   --------------------------------------------------------------------------- */
console.log('\na live game is timed whichever lane sees it');

{
  const HARNESS = [
    'import sys, json, io, time, types',
    'try:',
    '    import requests',
    'except ImportError:',
    "    sys.modules['requests'] = types.ModuleType('requests')   # a bare CI python; nothing here calls it",
    'from datetime import datetime, timezone',
    'from types import SimpleNamespace as NS',
    'sys.path.insert(0, sys.argv[1])',
    'import run_ingest as R',
    'spec = json.load(sys.stdin)',
    "feed = json.load(io.open(spec['feed'], encoding='utf-8'))",
    "T = R.translate(feed, lambda team, pno: '%s:%s' % (team, pno))",
    "rows = R.game_rows('g', T['events'])",
    'class SB:',
    '    def __init__(self, existing): self.existing, self.inserted, self.upserted = existing, [], []',
    '    def select(self, table, q):',
    "        return [{'status': 'live'}] if table == 'games' else (self.existing if table == 'game_events' else [])",
    '    def patch(self, *a): pass',
    '    def delete(self, *a): pass',
    '    def function(self, *a): return 200, {}',
    "    def upsert(self, table, rw, oc): self.upserted.extend(rw) if table == 'game_events' else None",
    "    def insert(self, table, rw): self.inserted.extend(rw) if table == 'game_events' else None",
    'iso = lambda ms: datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()',
    'out = {}',
    'for c in spec["cases"]:',
    '    now = int(time.time() * 1000)',
    '    existing = []',
    "    for r in rows[:c['n']]:",
    "        e = dict(r, payload=dict(r.get('payload') or {}), created_at=iso(now - c['written_ago_ms']))",
    "        if c.get('wall_ago_ms') is not None: e['payload'].update(wall=now - c['wall_ago_ms'], wall_err=10500)",
    '        existing.append(e)',
    '    sb = SB(existing)',
    "    observed = (now, 30000 + 400)",
    "    R.write_event_log(sb, {'adapter': 'fiba', 'code': 'x'}, NS(raw=feed, status='live', external_id='x'), 'g', {}, observed)",
    "    tl = sb.inserted",
    "    out[c['name']] = {'tail': len(tl), 'stamped': sum(1 for r in tl if 'wall' in (r.get('payload') or {})),",
    "                      'errs': sorted({(r.get('payload') or {}).get('wall_err') for r in tl if 'wall' in (r.get('payload') or {})}),",
    "                      'rows': len(rows)}",
    'try:',
    "    out['helper'] = [R.discovery_observed(NS(status=st), time.time() - 0.2, 30) for st in ('live', 'final', 'scheduled')]",
    'except AttributeError:',
    "    out['helper'] = None",
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');

  const feedPath = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json');
  const cases = [
    { name: 'recent', n: 150, written_ago_ms: 20000 },
    { name: 'old', n: 150, written_ago_ms: 240000 },
    { name: 'minute', n: 150, written_ago_ms: 100000 },
    { name: 'walled', n: 150, written_ago_ms: 5000, wall_ago_ms: 50000 },
  ];
  let got = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'ingest')],
                        { input: JSON.stringify({ feed: feedPath, cases }), encoding: 'utf8',
                          env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    if (r.status === 0 && r.stdout.includes('@@')) { got = JSON.parse(r.stdout.split('@@').pop()); break; }
    if (r.stderr && /Traceback/.test(r.stderr)) { ok('write_event_log runs', false, r.stderr.slice(-800)); break; }
  }
  if (!got) ok('a python to run write_event_log with', false);
  else {
    const c = got;
    const near = (v, want, slack) => Math.abs(v - want) <= slack;
    ok('a tail on an unstamped log written 20 s ago is stamped',
       c.recent.tail > 0 && c.recent.stamped === c.recent.tail, JSON.stringify(c.recent));
    ok('...with the configured bar, which is the wider of the two',
       c.recent.errs.length === 1 && c.recent.errs[0] === 30400, JSON.stringify(c.recent.errs));
    ok('a tail on an unstamped log last written 100 s ago carries 100 s, not the configured 30',
       c.minute.errs.length === 1 && near(c.minute.errs[0], 100000, 2000), JSON.stringify(c.minute.errs));
    ok('...and one last written four minutes ago is left unstamped rather than claimed',
       c.old.tail > 0 && c.old.stamped === 0, JSON.stringify(c.old));
    ok('a stamped log still measures from its newest stamp, not from created_at',
       c.walled.errs.length === 1 && near(c.walled.errs[0], 50000, 2000), JSON.stringify(c.walled.errs));

    const h = c.helper;
    ok('the discovery lane builds `observed` for a live game',
       Array.isArray(h) && Array.isArray(h[0]) && near(h[0][1], 30200, 150), JSON.stringify(h));
    ok('...and nothing for a finished or scheduled one', Array.isArray(h) && h[1] === null && h[2] === null);
  }

  const lane = src.slice(src.indexOf('live_set = []'), src.indexOf('if not args.dry_run:', src.indexOf('live_set = []')));
  ok('both of the discovery lane\'s writes pass it',
     (lane.match(/write_platform\(sb, src, b, run, discovery_observed\(b, t_obs, args\.live_every\)\)/g) || []).length === 2 &&
     !/write_platform\(sb, src, b, run\)\s*$/m.test(src), (lane.match(/write_platform\([^)]*\)/g) || []).join(' | '));
  ok('...each timed from just before its own fetch',
     (lane.match(/t_obs = time\.time\(\)\s*\n\s*try:\s*\n\s*b = adapter\.fetch/g) || []).length === 2);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
