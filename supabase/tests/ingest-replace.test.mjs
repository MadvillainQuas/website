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

/* THE IN-PLACE UPSERT THAT REPLACED IT COULD NEVER RUN: an upsert over an existing
   (game_id, seq) is an UPDATE, and game_events refuses every UPDATE for every role. The
   first Genius correction of a live game froze its log. A correction now keeps the rows
   that still match, deletes from the first that differs, and inserts from there. */
ok('a correction never writes an UPDATE: no upsert into game_events is left',
   !/sb\.upsert\("game_events"/.test(src));
ok('...there is no unconditional delete of the game left either',
   !/sb\.delete\("game_events", f"game_id=eq\.\{game_id\}"\)/.test(src));
ok('...it deletes from the first row that differs and inserts from there',
   /sb\.delete\("game_events", f"game_id=eq\.\{game_id\}&seq=gte\.\{existing\[keep\]\['seq'\]\}"\)/.test(src) &&
   /sb\.insert\("game_events", fresh\[i:i \+ 400\]\)/.test(src) && /if not _same_row\(e, r\):/.test(src));
ok('...and the reason is written down where the next reader will need it',
   /there must be no instant at which the league's copy of the/.test(src));
const trig = readFileSync(path.join(ROOT, 'supabase', 'migrations', '0030_retraction_trigger.sql'), 'utf8');
ok('...because the database refuses UPDATE outright, and lets a server role delete',
   /create trigger game_events_no_update before update on public\.game_events\s+for each row execute function public\.forbid_event_mutation\(\);/.test(trig) &&
   /if current_user not in \('authenticated', 'anon'\) then\s+return old;/.test(trig));
ok('...and the reason is written down where the next reader will need it',
   /raises on every\s*\n?\s*# UPDATE for every role, the service role included/.test(src) &&
   /PostgREST refuses a bulk insert whose objects do not share one key set/.test(src));

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
   /for r in within_stamp\(rows\[len\(existing\):\], stamp\):/.test(src));
ok('...and in both write paths only to rows one stamp can honestly cover',
   /for r in within_stamp\(tail, stamp\):/.test(src) && /latest - _elapsed_ms\(r\) <= err \+ 3000/.test(src));
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
    '    def __init__(self, existing): self.existing, self.inserted, self.upserted, self.deleted, self.chunks = existing, [], [], [], []',
    '    def select(self, table, q):',
    "        return [{'status': 'live'}] if table == 'games' else (self.existing if table == 'game_events' else [])",
    '    def patch(self, *a): pass',
    "    def delete(self, table, q): self.deleted.append(q) if table == 'game_events' else None",
    '    def function(self, *a): return 200, {}',
    "    def upsert(self, table, rw, oc): self.upserted.extend(rw) if table == 'game_events' else None",
    '    def insert(self, table, rw):',
    "        if table == 'game_events':",
    '            self.inserted.extend(rw)',
    '            self.chunks.append({tuple(sorted(r.keys())) for r in rw})',
    'iso = lambda ms: datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()',
    'out = {}',
    'for c in spec["cases"]:',
    '    now = int(time.time() * 1000)',
    '    existing = []',
    "    for r in rows[:c['n']]:",
    "        e = dict(r, payload=dict(r.get('payload') or {}), created_at=iso(now - c['written_ago_ms']))",
    "        if c.get('wall_ago_ms') is not None: e['payload'].update(wall=now - c['wall_ago_ms'], wall_err=10500)",
    '        existing.append(e)',
    "    if c.get('corrupt') is not None: existing[c['corrupt']]['clock'] = (existing[c['corrupt']]['clock'] or 0) + 1000",
    "    if c.get('correct_at') is not None: existing[c['correct_at']]['clock'] += 1000   # Genius revised one play",
    '    sb = SB(existing)',
    "    observed = (now, 30000 + 400)",
    "    R.write_event_log(sb, {'adapter': 'fiba', 'code': 'x'}, NS(raw=feed, status='live', external_id='x'), 'g', {}, observed)",
    "    tl = sb.inserted",
    "    lat = max(R._elapsed_ms(r) for r in tl) if tl else 0",
    "    e0 = next(((r.get('payload') or {}).get('wall_err') for r in tl if 'wall' in (r.get('payload') or {})), None)",
    "    out[c['name']] = {'tail': len(tl), 'stamped': sum(1 for r in tl if 'wall' in (r.get('payload') or {})),",
    "                      'errs': sorted({(r.get('payload') or {}).get('wall_err') for r in tl if 'wall' in (r.get('payload') or {})}),",
    "                      'rows': len(rows), 'span': (lat - min(R._elapsed_ms(r) for r in tl)) if tl else 0,",
    "                      'honest': all(('wall' in (r.get('payload') or {})) == (e0 is not None and lat - R._elapsed_ms(r) <= e0 + 3000) for r in tl),",
    "                      'upserted': len(sb.upserted), 'deleted': sb.deleted, 'uniform': all(len(k) == 1 for k in sb.chunks),",
    "                      'first_seq': tl[0]['seq'] if tl else None, 'created_at_all': all('created_at' in r for r in tl),",
    "                      'carried': sum(1 for r in tl if r['seq'] <= c['n'] and (r.get('payload') or {}).get('wall') == now - (c.get('wall_ago_ms') or 0))}",
    'try:',
    "    out['helper'] = [R.discovery_observed(NS(status=st), time.time() - 0.2, 30) for st in ('live', 'final', 'scheduled')]",
    'except AttributeError:',
    "    out['helper'] = None",
    'now_ms = int(time.time() * 1000)',
    "out['helper_lm'] = {'now': now_ms, 'h': R.discovery_observed(NS(status='live', feed_lm_ms=now_ms - 12000, feed_recv_ms=now_ms), time.time() - 0.2, 30)}",
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');

  const feedPath = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json');
  const cases = [
    { name: 'recent', n: 150, written_ago_ms: 20000 },
    { name: 'old', n: 150, written_ago_ms: 240000 },
    { name: 'minute', n: 150, written_ago_ms: 100000 },
    { name: 'walled', n: 150, written_ago_ms: 5000, wall_ago_ms: 50000 },
    /* Genius corrects the 121st play of a 150-play log */
    { name: 'corrected', n: 150, written_ago_ms: 5000, wall_ago_ms: 50000, correct_at: 120 },
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
    /* THE TAIL HERE COVERS A WHOLE STRETCH OF THE GAME, which is what a bulk re-add after a
       lost rewrite batch looks like (2026-09-12: 348 and 541 rows, one instant each). One
       poll stamp can only be honest for the plays within its bar of the latest. */
    ok('a tail on an unstamped log written 20 s ago stamps its latest plays',
       c.recent.tail > 0 && c.recent.stamped > 0, JSON.stringify(c.recent));
    ok('...and only those: a play further back in game time than the bar is left unstamped',
       c.recent.span > 33400 && c.recent.stamped < c.recent.tail && c.recent.honest === true, JSON.stringify(c.recent));
    ok('...in every case, whatever the bar', [c.recent, c.minute, c.walled].every(x => x.honest === true));
    ok('...with the configured bar, which is the wider of the two',
       c.recent.errs.length === 1 && c.recent.errs[0] === 30400, JSON.stringify(c.recent.errs));
    ok('a tail on an unstamped log last written 100 s ago carries 100 s, not the configured 30',
       c.minute.errs.length === 1 && near(c.minute.errs[0], 100000, 2000), JSON.stringify(c.minute.errs));
    ok('...and one last written four minutes ago is left unstamped rather than claimed',
       c.old.tail > 0 && c.old.stamped === 0, JSON.stringify(c.old));
    ok('a stamped log still measures from its newest stamp, not from created_at',
       c.walled.errs.length === 1 && near(c.walled.errs[0], 50000, 2000), JSON.stringify(c.walled.errs));

    /* A GENIUS CORRECTION 30 PLAYS BACK, run through the real write path. */
    const k = c.corrected;
    ok('a correction writes no UPDATE: nothing is upserted into game_events',
       k.upserted === 0 && [c.recent, c.minute, c.walled].every(x => x.upserted === 0), JSON.stringify(k));
    ok('...the 120 plays before it are left alone; only seq 121 on is deleted and re-inserted',
       JSON.stringify(k.deleted) === JSON.stringify(['game_id=eq.g&seq=gte.121']) && k.first_seq === 121 &&
       k.tail === k.rows - 120, JSON.stringify({ deleted: k.deleted, first: k.first_seq, n: k.tail, rows: k.rows }));
    ok('...the re-inserted plays keep the stamps they had earned',
       k.carried === 29, String(k.carried));
    ok('...and every insert chunk has one key set, which PostgREST requires',
       k.uniform === true && k.created_at_all === true && [c.recent, c.minute, c.walled].every(x => x.uniform === true));
    ok('...while an ordinary tail deletes nothing', [c.recent, c.minute, c.walled].every(x => x.deleted.length === 0));

    const h = c.helper;
    ok('the discovery lane builds `observed` for a live game',
       Array.isArray(h) && Array.isArray(h[0]) && near(h[0][1], 30200, 150), JSON.stringify(h));
    ok('...and nothing for a finished or scheduled one', Array.isArray(h) && h[1] === null && h[2] === null);
    /* BOTH LANES STAMP ON THE SAME CLOCK: a discovery write on receive time, 13 s later
       than the live lane's Last-Modified stamps, would make the live lane's next tail
       measure a negative gap and collapse its bar to the configured interval. */
    const hl = c.helper_lm;
    ok('the discovery lane stamps a live game by Last-Modified + 999 ms too, not receive time',
       hl && Array.isArray(hl.h) && hl.h[0] === hl.now - 11001 && near(hl.h[1], 30200, 150), JSON.stringify(hl));
  }

  const lane = src.slice(src.indexOf('live_set = []'), src.indexOf('if not args.dry_run:', src.indexOf('live_set = []')));
  ok('both of the discovery lane\'s writes pass it',
     (lane.match(/write_platform\(sb, src, b, run, discovery_observed\(b, t_obs, args\.live_every\)\)/g) || []).length === 2 &&
     !/write_platform\(sb, src, b, run\)\s*$/m.test(src), (lane.match(/write_platform\([^)]*\)/g) || []).join(' | '));
  ok('...each timed from just before its own fetch',
     (lane.match(/t_obs = time\.time\(\)\s*\n\s*try:\s*\n\s*b = adapter\.fetch/g) || []).length === 2);
  const disc = src.slice(src.indexOf('def discovery_observed('), src.indexOf('def within_stamp('));
  ok('...and it reads the response\'s Last-Modified to do it',
     /feed_lm_ms/.test(disc) && /feedstamp\.version_stamp\(/.test(disc));
}

/* ---------------------------------------------------------------------------
   THE LIVE LANE STAMPS BY WHEN THE FEED CHANGED (docs/feed-timing.md, steps 1-2).

   Step 1: observed[0] is the response's Last-Modified + 999 ms, and an older CDN
   copy is skipped BEFORE the hash compare - after it, an older copy would count
   as new content and rewrite the log backwards. Step 2: a FeedObserver polls
   between writes, and the inline fetch survives only behind EPINOIA_OBSERVER=0.
   observed[1] stays the CONFIGURED interval in both, so the heartbeat's `fast`
   test above is untouched.
   --------------------------------------------------------------------------- */
console.log('\nthe live lane stamps by when the feed changed');
{
  const lk = src.slice(src.indexOf('def live_keeper('), src.indexOf('def main('));
  ok('live_keeper stamps through feedstamp.version_stamp', /feedstamp\.version_stamp\(/.test(lk));
  ok('...with the Last-Modified stamp and the configured error, as before',
     /observed = \(vs\["stamp_ms"\], int\(\(\(fast_every if is_armed else every\)/.test(lk));
  ok('an older CDN copy is skipped before the hash compare can call it new',
     lk.indexOf('if vs["older"]:') > 0 &&
     lk.indexOf('if vs["older"]:') < lk.indexOf('if hashes.get(xid) == b.payload_hash:'));
  ok('...and the newest Last-Modified is remembered only after a write',
     /elif vs\["basis"\] == "lm":\s*\n\s*last_lm\[xid\] = max\(last_lm\.get\(xid\) or 0, b\.feed_lm_ms\)/.test(lk) &&
     lk.indexOf('last_lm[xid] = max(') > lk.indexOf('hashes[xid] = b.payload_hash'));

  ok('the observer is polled at the top of every pass and again after every write',
     (lk.match(/observe_due\(/g) || []).length >= 2);
  ok('...unless EPINOIA_OBSERVER=0, the kill switch', /os\.environ\.get\("EPINOIA_OBSERVER", ""\) != "0"/.test(lk));
  ok('the loop builds its bundle from the observer\'s snapshot', /bundle_from_raw\(snap\.raw/.test(lk));
  ok('...and the network fetch is reachable only in the kill-switch branch',
     (lk.match(/\.fetch\(/g) || []).length === 1 &&
     lk.indexOf('# KILL SWITCH') > 0 && lk.indexOf('# KILL SWITCH') < lk.indexOf('.fetch(') &&
     lk.indexOf('.fetch(') < lk.indexOf('snap = observer.take(xid)'));
  ok('the observer\'s stamp keeps the configured error plus the poll\'s own duration',
     /observed = \(snap\.stamp_ms, int\(\(fast_every if is_armed else every\) \* 1000\) \+ snap\.fetch_ms\)/.test(lk));
  ok('a version already in the database (a pass handover) is not written again',
     /if hashes\.get\(xid\) == b\.payload_hash:\s+# pass handover/.test(lk));
  ok('the stale-final rule survives, timed from when the observer saw the content change',
     /time\.time\(\) \* 1000 - snap\.changed_at_ms >= STALE_FINAL_S \* 1000/.test(lk) && /_looks_finished\(b\.raw\)/.test(lk));
  ok('each pass ends with the decision-gate numbers per game',
     /gaps over 25 s/.test(lk) && /for xid in list\(observer\.st\):\s*\n\s*print\(observer_line\(xid\)\)/.test(lk));

  const fl = readFileSync(path.join(ROOT, 'scripts', 'ingest', 'adapters', 'fiba_livestats.py'), 'utf8');
  ok('the adapter keeps Last-Modified and receive time on the bundle',
     /def _get_meta\(self, url: str\)/.test(fl) && /b\.feed_lm_ms, b\.feed_recv_ms = meta\["lm_ms"\], meta\["recv_ms"\]/.test(fl));
  ok('the dry run prints recv-lm so a live check can see the CDN\'s age',
     /recv-lm=\{\(b\.feed_recv_ms - b\.feed_lm_ms\) \/ 1000:\.1f\}s/.test(src));
}

/* ---------------------------------------------------------------------------
   A PLAY IS TIMED BY THE VERSION IT FIRST APPEARED IN (docs/feed-timing.md, step 3).

   The observer remembers, per LiveStats actionNumber, the upload each action
   first appeared in, pulled back by the game clock: {an: [hi, lo] | None}.
   write_event_log reads it per row through the translator's `_ans`:
     mem      the row takes memory's wall and wall_err, in the tail and in a
              rewrite (over a carried stamp);
     decline  a late entry is left unstamped - and the poll stamp may not cover it;
     none     what memory cannot place falls to today's poll stamp, within_stamp
              and all.
   An existing row with NO wall that memory can place is refilled. Everything
   sits in a try: a raise costs the memory, never the write - write_platform
   swallows this function's exceptions and live_keeper marks the hash anyway, so
   an escaped raise would freeze a live log. EPINOIA_STAMPS=shadow computes and
   prints, and writes exactly what it would without memory; unset means on.

   Run against the real write_event_log on the saved LiveStats feed, database faked.
   --------------------------------------------------------------------------- */
console.log('\na play is timed by the version it first appeared in');
{
  const HARNESS = [
    'import sys, json, io, time, types, os, copy, contextlib',
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
    "EV = T['events']",
    "rows = R.game_rows('g', EV)",
    'N = len(rows)',
    'class SB:',
    '    def __init__(self, existing): self.existing, self.inserted, self.upserted, self.deleted, self.chunks = existing, [], [], [], []',
    '    def select(self, table, q):',
    "        return [{'status': 'live'}] if table == 'games' else (self.existing if table == 'game_events' else [])",
    '    def patch(self, *a): pass',
    "    def delete(self, table, q): self.deleted.append(q) if table == 'game_events' else None",
    '    def function(self, *a): return 200, {}',
    "    def upsert(self, table, rw, oc): self.upserted.extend(rw) if table == 'game_events' else None",
    "    def insert(self, table, rw): (self.inserted.extend(rw), self.chunks.append(sorted({tuple(sorted(x)) for x in rw}))) if table == 'game_events' else None",
    'iso = lambda ms: datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()',
    'NOW = int(time.time() * 1000)',
    "R.now_iso = lambda: iso(NOW)                         # a rewrite's created_at for new rows: the same in every run compared",
    'MEM = [NOW - 5000, NOW - 25000]                      # memory: uploaded by NOW-5 s, not before NOW-25 s',
    'def existing_of(n, written_ago_ms, wall_ago_ms=None, correct_at=None):',
    '    ex = []',
    '    for r in rows[:n]:',
    "        e = dict(r, payload=dict(r.get('payload') or {}), created_at=iso(NOW - written_ago_ms))",
    "        if wall_ago_ms is not None: e['payload'].update(wall=NOW - wall_ago_ms, wall_err=10500)",
    '        ex.append(e)',
    "    if correct_at is not None: ex[correct_at]['clock'] += 1000   # Genius revised one play",
    '    return ex',
    "def ans_of(lo, hi): return {an for e in EV if lo <= e['seq'] <= hi for an in e['_ans']}",
    'def run(existing, stamps, mode, boom=False):',
    "    if mode is None: os.environ.pop('EPINOIA_STAMPS', None)",
    "    else: os.environ['EPINOIA_STAMPS'] = mode",
    '    sb, buf, real = SB(copy.deepcopy(existing)), io.StringIO(), R.feedstamp.row_stamp',
    '    if boom:',
    "        def explode(*a, **k): raise RuntimeError('boom')",
    '        R.feedstamp.row_stamp = explode',
    '    try:',
    '        with contextlib.redirect_stdout(buf):',
    "            R.write_event_log(sb, {'adapter': 'fiba', 'code': 'x'}, NS(raw=feed, status='live', external_id='x'), 'g', {}, (NOW, 30400), stamps)",
    '    finally:',
    '        R.feedstamp.row_stamp = real',
    "    return {'ins': sb.inserted, 'upserted': len(sb.upserted), 'deleted': sb.deleted, 'uniform': all(len(k) == 1 for k in sb.chunks), 'log': buf.getvalue()}",
    "same = lambda a, b: json.dumps([a['ins'], a['deleted'], a['upserted']], sort_keys=True) == json.dumps([b['ins'], b['deleted'], b['upserted']], sort_keys=True)",
    "P = lambda r: r.get('payload') or {}",
    'out = {}',
    '',
    '# (a) THE TAIL: memory for most new actions, one late entry, the last ten unknown',
    'head = ans_of(1, 150)',
    'tail = sorted(ans_of(151, N) - head)',
    'st_a = {an: list(MEM) for an in tail[:-10]}',
    'st_a[tail[0]] = None',
    'kind = {e["seq"]: R.feedstamp.row_stamp(e["_ans"], st_a)[0] for e in EV}',
    'ex_a = existing_of(150, 20000)',
    'a = run(ex_a, st_a, None)',
    'ins = a["ins"]',
    'latest = max(R._elapsed_ms(r) for r in ins)',
    'out["a"] = {"n": len(ins), "first": ins[0]["seq"] if ins else None, "deleted": a["deleted"], "upserted": a["upserted"],',
    '  "mem": sum(1 for r in ins if kind[r["seq"]] == "mem"), "decline": sum(1 for r in ins if kind[r["seq"]] == "decline"),',
    '  "none": sum(1 for r in ins if kind[r["seq"]] == "none"),',
    '  "none_stamped": sum(1 for r in ins if kind[r["seq"]] == "none" and "wall" in P(r)),',
    '  "mem_ok": all(P(r).get("wall") == NOW - 5000 and P(r).get("wall_err") == 20000 for r in ins if kind[r["seq"]] == "mem"),',
    '  "decline_ok": all("wall" not in P(r) for r in ins if kind[r["seq"]] == "decline"),',
    '  "none_ok": all((("wall" in P(r)) == (latest - R._elapsed_ms(r) <= 30400 + 3000)) and (P(r).get("wall") in (None, NOW)) for r in ins if kind[r["seq"]] == "none"),',
    '  "columns": sorted({k for r in ins for k in r}), "log": a["log"]}',
    '',
    '# (b) REFILL: an unstamped log, memory for everything from seq 101 on',
    'st_b = {an: list(MEM) for an in ans_of(101, N) - ans_of(1, 100)}',
    'kind_b = {e["seq"]: R.feedstamp.row_stamp(e["_ans"], st_b)[0] for e in EV}',
    'K = min(s for s, k in kind_b.items() if k == "mem")',
    'b = run(existing_of(150, 20000), st_b, "on")',
    'ib = b["ins"]',
    'out["b"] = {"K": K, "deleted": b["deleted"], "upserted": b["upserted"], "n": len(ib), "rows": N, "first": ib[0]["seq"] if ib else None,',
    '  "mem_ok": all(P(r).get("wall") == NOW - 5000 and P(r).get("wall_err") == 20000 for r in ib if kind_b[r["seq"]] == "mem"),',
    '  "refilled": sum(1 for r in ib if r["seq"] <= 150 and kind_b[r["seq"]] == "mem"),',
    '  "kept_created": all(r.get("created_at") == iso(NOW - 20000) for r in ib if r["seq"] <= 150 and kind_b[r["seq"]] == "mem"),',
    '  "uniform": b["uniform"], "created_all": all("created_at" in r for r in ib), "log": b["log"]}',
    '# ...and run again over what (b) wrote: nothing left to refill, so nothing is rewritten',
    'ex_b2 = [dict(r) for r in rows[:K - 1]] + [dict(r, created_at=r.get("created_at")) for r in ib]',
    'for e in ex_b2: e.setdefault("created_at", iso(NOW - 20000))',
    'b2 = run(ex_b2, st_b, "on")',
    'out["b_again"] = {"n": len(b2["ins"]), "deleted": b2["deleted"]}',
    '# ...and a log whose rows already carry poll stamps is not "upgraded"',
    'b3 = run(existing_of(150, 5000, wall_ago_ms=50000), st_b, "on")',
    'out["b_walled"] = {"deleted": b3["deleted"], "first": b3["ins"][0]["seq"] if b3["ins"] else None,',
    '  "tail_mem": all(P(r).get("wall") == NOW - 5000 for r in b3["ins"] if kind_b[r["seq"]] == "mem")}',
    '',
    '# (c) A CORRECTION at seq 121 of a stamped log: memory for 130 on beats the carried poll stamp',
    'st_c = {an: list(MEM) for an in ans_of(130, N) - ans_of(1, 129)}',
    'kind_c = {e["seq"]: R.feedstamp.row_stamp(e["_ans"], st_c)[0] for e in EV}',
    'c = run(existing_of(150, 5000, wall_ago_ms=50000, correct_at=120), st_c, "on")',
    'ic = c["ins"]',
    'out["c"] = {"deleted": c["deleted"], "first": ic[0]["seq"] if ic else None, "upserted": c["upserted"],',
    '  "mem_rows": sum(1 for r in ic if r["seq"] <= 150 and kind_c[r["seq"]] == "mem"),',
    '  "mem_over_carry": all(P(r).get("wall") == NOW - 5000 and P(r).get("wall_err") == 20000 for r in ic if r["seq"] <= 150 and kind_c[r["seq"]] == "mem"),',
    '  "carried_before": sum(1 for r in ic if 121 <= r["seq"] < 130 and P(r).get("wall") == NOW - 50000),',
    '  "uniform": c["uniform"]}',
    '',
    '# (d) A RAISE INSIDE THE MEMORY BLOCK: exactly the write without memory, and said so',
    'for name, ex, st in (("a", ex_a, st_a), ("b", existing_of(150, 20000), st_b), ("c", existing_of(150, 5000, wall_ago_ms=50000, correct_at=120), st_c)):',
    '    plain = run(ex, None, None)',
    '    d = run(ex, st, "on", boom=True)',
    '    sh = run(ex, st, "shadow")',
    '    off = run(ex, st, "off")',
    '    typo = run(ex, st, "shadwo")',
    '    out["d_" + name] = {"boom_same": same(d, plain), "boom_log": "! feedstamp:" in d["log"],',
    '                        "shadow_same": same(sh, plain), "shadow_log": "feedstamp shadow" in sh["log"],',
    '                        "off_same": same(off, plain), "typo_same": same(typo, plain), "on_differs": not same(run(ex, st, "on"), plain)}',
    'out["shadow_line"] = next((l for l in run(ex_a, st_a, "shadow")["log"].splitlines() if "feedstamp shadow" in l), None)',
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');

  const feedPath = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json');
  let got = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'ingest')],
                        { input: JSON.stringify({ feed: feedPath }), encoding: 'utf8', maxBuffer: 64 << 20,
                          env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    if (r.status === 0 && r.stdout.includes('@@')) { got = JSON.parse(r.stdout.split('@@').pop()); break; }
    if (r.stderr && /Traceback/.test(r.stderr)) { ok('write_event_log runs with memory stamps', false, r.stderr.slice(-1200)); break; }
  }
  if (!got) ok('a python to run write_event_log with memory stamps', false);
  else {
    const J = x => JSON.stringify(x);
    const a = got.a;
    ok('(a) a tail with memory, unset EPINOIA_STAMPS (on): appended, nothing deleted or upserted',
       a.first === 151 && a.deleted.length === 0 && a.upserted === 0 && a.mem > 0 && a.decline > 0 && a.none > 0,
       J({ first: a.first, deleted: a.deleted, mem: a.mem, decline: a.decline, none: a.none }));
    ok('...memory rows take memory\'s wall and window (NOW-5 s, 20 s), not the poll\'s', a.mem_ok === true);
    ok('...the late entry is left unstamped: the poll stamp may not cover it either', a.decline_ok === true);
    ok('...and what memory cannot place takes the poll stamp exactly as within_stamp decides, measured over the whole tail',
       a.none_ok === true && a.none_stamped > 0, J({ none: a.none, stamped: a.none_stamped }));
    ok('...the write says how many memory placed', /by memory/.test(a.log), a.log);
    ok('...and _ans never reaches the database: the rows carry the eight columns only',
       J(a.columns) === J(['clock', 'game_id', 'payload', 'period', 'pid', 'seq', 't', 'team']), J(a.columns));

    const b = got.b;
    ok('(b) an existing row with no wall that memory can place is refilled: rewritten from the first such row, never upserted',
       b.K > 100 && J(b.deleted) === J(['game_id=eq.g&seq=gte.' + b.K]) && b.first === b.K && b.n === b.rows - b.K + 1 && b.upserted === 0,
       J({ K: b.K, deleted: b.deleted, first: b.first, n: b.n, rows: b.rows }));
    ok('...the refilled rows carry memory\'s stamps', b.mem_ok === true && b.refilled > 0, String(b.refilled));
    ok('...keep the insert time they had (game_tip_wallclock and the timed-log test read it)', b.kept_created === true);
    ok('...and every insert chunk still has one key set', b.uniform === true && b.created_all === true);
    ok('...and says it refilled', /\(refill\)/.test(b.log), b.log);
    ok('refilled once, it never churns: the next write over the same log rewrites nothing',
       got.b_again.n === 0 && got.b_again.deleted.length === 0, J(got.b_again));
    ok('rows that already carry a poll stamp are not "upgraded": only the tail is written',
       got.b_walled.deleted.length === 0 && got.b_walled.first === 151 && got.b_walled.tail_mem === true, J(got.b_walled));

    const c = got.c;
    ok('(c) a correction still rewrites only from the changed play (seq 121)',
       J(c.deleted) === J(['game_id=eq.g&seq=gte.121']) && c.first === 121 && c.upserted === 0 && c.uniform === true, J(c));
    ok('...memory is applied after the carry and over it',
       c.mem_rows > 0 && c.mem_over_carry === true && c.carried_before > 0, J(c));

    for (const k of ['a', 'b', 'c']) {
      const d = got['d_' + k];
      ok(`(d/${k}) a raise inside the memory block writes exactly what no memory would, and prints "! feedstamp:"`,
         d.boom_same === true && d.boom_log === true && d.on_differs === true, J(d));
      ok(`(e/${k}) EPINOIA_STAMPS=shadow writes exactly what no memory would, and prints what it would have done`,
         d.shadow_same === true && d.shadow_log === true, J(d));
      ok(`(e/${k}) "off" writes today's stamps, and so does a typo (fails safe)`, d.off_same === true && d.typo_same === true, J(d));
    }
    ok('the shadow line reports memory against the poll stamp',
       /feedstamp shadow: \d+ of \d+ rows by memory \(median [\d.]+ s before the poll stamp, median bar [\d.]+ s\), \d+ declined, \d+ to refill; poll \{/.test(got.shadow_line || ''),
       String(got.shadow_line));
  }

  ok('memory stamps are applied after the carry in the rewrite branch',
     src.indexOf('if r["seq"] in mem:', src.indexOf('if kept < len(existing):')) > src.indexOf('if kept < len(existing):') &&
     src.indexOf('if r["seq"] in mem:', src.indexOf('if kept < len(existing):')) < src.indexOf('how_first = ""'));
  ok('declined rows are excluded from both fresh-stamp loops',
     (src.match(/and r\["seq"\] not in declined:/g) || []).length === 2 &&
     /if "wall" in \(r\.get\("payload"\) or \{\}\) or r\["seq"\] in declined:/.test(src));
  ok('the memory block falls back to today\'s stamps on any exception',
     /except Exception as exc:\s*\n\s*print\(f"    ! feedstamp:/.test(src));
  ok('a refill takes the rewrite branch', /if existing and same_prefix and not refill:/.test(src));
  ok('the live lane hands the observer\'s memory to the write, and the kill switch hands none',
     /write_platform\(sb, src, b, run, observed, observer\.stamps\(xid\) if observer else None\)/.test(src) &&
     /write_event_log\(sb, src, b, game_id, people\["pids"\], observed, stamps\)/.test(src));
  ok('the discovery lane passes no memory (a different process: its own writes stay poll-stamped)',
     (src.match(/write_platform\(sb, src, b, run, discovery_observed\(b, t_obs, args\.live_every\)\)/g) || []).length === 2);
}

/* ---------------------------------------------------------------------------
   2b: ONE CONNECTION, AND ONLY IDEMPOTENT CALLS ARE RESENT.

   A pooled keep-alive connection can die while the live lane naps (up to two
   minutes before a tip-off), and urllib3 does not retry a POST or PATCH. select,
   patch and upsert are safe to send twice and get one more try; insert (a
   duplicate row), rpc and function (a second finalise-game) never do.
   --------------------------------------------------------------------------- */
console.log('\n2b: the database client keeps one connection');
{
  const cls = src.slice(src.indexOf('class Supabase:'), src.indexOf('class RepoFeed:'));
  ok('every Supabase call goes through the session, none through bare requests',
     !/requests\.(get|post|patch|delete)\(/.test(cls) && (cls.match(/self\.s\.(get|post|patch|delete)\(/g) || []).length === 8,
     String((cls.match(/self\.s\.(get|post|patch|delete)\(/g) || []).length));
  const HARNESS = [
    'import sys, json, types',
    'try:',
    '    import requests',
    '    CE = requests.ConnectionError',
    'except ImportError:',
    "    m = types.ModuleType('requests'); m.ConnectionError = type('ConnectionError', (OSError,), {}); m.Session = lambda: None",
    "    sys.modules['requests'] = m; CE = m.ConnectionError",
    'sys.path.insert(0, sys.argv[1])',
    'import run_ingest as R',
    'class Resp:',
    "    status_code = 200; text = '[]'; headers = {'content-type': 'application/json'}",
    '    def raise_for_status(self): pass',
    '    def json(self): return []',
    'class Flaky:',
    '    def __init__(self): self.n = 0',
    '    def _hit(self, *a, **k):',
    '        self.n += 1',
    "        if self.n == 1: raise CE('connection reset by peer')",
    '        return Resp()',
    '    get = post = patch = delete = _hit',
    'calls = {',
    "    'select': lambda sb: sb.select('games', 'select=id'),",
    "    'upsert': lambda sb: sb.upsert('games', [{}], 'id'),",
    "    'patch': lambda sb: sb.patch('games', 'id=eq.1', {}),",
    "    'insert': lambda sb: sb.insert('game_events', [{}]),",
    "    'rpc': lambda sb: sb.rpc('refresh_feed_team_season', {}),",
    "    'function': lambda sb: sb.function('finalise-game', {}),",
    "    'delete': lambda sb: sb.delete('game_events', 'seq=gt.1'),",
    "    'storage_put': lambda sb: sb.storage_put('feed', 'x.json', b'{}'),",
    '}',
    'out = {}',
    'for name, fn in calls.items():',
    '    s = Flaky(); sb = R.Supabase("https://x.supabase.co", "k", session=s)',
    '    try:',
    '        fn(sb); res = "ok"',
    '    except CE:',
    '        res = "raised"',
    '    out[name] = [res, s.n, sb.s is s]',
    "if hasattr(sys.modules['requests'], 'HTTPError'):",
    '    class Bad:',
    "        status_code = 400; text = '{\"code\":\"PGRST102\",\"message\":\"All object keys must match\"}'",
    "        def raise_for_status(self): raise requests.HTTPError('400 Client Error: Bad Request for url: x')",
    '    class OneBad:',
    '        def post(self, *a, **k): return Bad()',
    '    try:',
    "        R.Supabase('https://x.supabase.co', 'k', session=OneBad()).insert('game_events', [{}]); out['body'] = None",
    '    except Exception as exc:',
    "        out['body'] = str(exc)",
    'else:',
    "    out['body'] = 'skipped'",
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');
  let got = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'ingest')],
                        { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    if (r.status === 0 && r.stdout.includes('@@')) { got = JSON.parse(r.stdout.split('@@').pop()); break; }
    if (r.stderr && /Traceback/.test(r.stderr)) { ok('the Supabase client runs', false, r.stderr.slice(-800)); break; }
  }
  if (!got) ok('a python to run the Supabase client with', false);
  else {
    const same = (k, res, n) => got[k] && got[k][0] === res && got[k][1] === n && got[k][2] === true;
    ok('select, upsert and patch survive a dropped connection with exactly one resend',
       same('select', 'ok', 2) && same('upsert', 'ok', 2) && same('patch', 'ok', 2), JSON.stringify(got));
    ok('insert, rpc, function, delete and storage_put are never resent',
       ['insert', 'rpc', 'function', 'delete', 'storage_put'].every(k => same(k, 'raised', 1)), JSON.stringify(got));
    ok('a refused write carries PostgREST\'s reason, not just "400 Client Error"',
       got.body === 'skipped' || (/400 Client Error/.test(got.body) && /All object keys must match/.test(got.body)),
       String(got.body));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
