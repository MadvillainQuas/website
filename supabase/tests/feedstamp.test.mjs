/* ============================================================================
   A FED PLAY IS STAMPED BY WHEN THE FEED CHANGED, NOT WHEN WE ASKED.

   docs/feed-timing.md. data.json sits behind CloudFront with max-age=30, so
   the copy the ingest receives was uploaded, on average, 13 s before it
   arrived (recv minus Last-Modified over 110 live versions: median 13.2 s,
   p90 23.3 s, max 87.6 s) - and the live lane only looked at a game once
   every 37.9 s (median; worst 198.5 s) because it wrote every other game
   between two looks.

     step 1  scripts/ingest/feedstamp.py version_stamp: the stamp is the
             response's Last-Modified + 999 ms, bounded by receive time
     step 2  feedstamp.accept + scripts/ingest/feed_observer.py: a conditional
             GET per game every few seconds between writes, content detected
             by hash, older CDN copies dropped
     step 3  translate/fiba_events.py `_ans` + feedstamp.stamp_version /
             row_stamp: each action timed by the version it FIRST appeared in,
             pulled earlier by the game clock within that version
     step 4  feedstamp.accept: an unchanged rewrite (a 304 with a newer
             Last-Modified) narrows the next version's lower edge, capped 60 s

   Everything python runs through `feedstamp.py --eval` / `--replay` or a -c
   harness; nothing here needs requests (the guard runner has none) or the
   network.

     node supabase/tests/feedstamp.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const INGEST = path.join(ROOT, 'scripts', 'ingest');
const FEEDSTAMP = path.join(INGEST, 'feedstamp.py');
const PROBE = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'probe3.jsonl.gz');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* run python with args and stdin; the payload is whatever follows '@@' */
function py(args, input) {
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, args, { input: input == null ? '' : input, encoding: 'utf8',
                                     env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    if (r.error) continue;                                   /* no such interpreter */
    if (r.status === 0 && r.stdout.includes('@@')) return { got: JSON.parse(r.stdout.split('@@').pop()) };
    if (r.stderr && /Traceback|Error/.test(r.stderr)) return { err: r.stderr.slice(-1200) };
  }
  return { err: 'no python ran ' + args.join(' ') };
}
const evalCases = (cases) => py([FEEDSTAMP, '--eval'], JSON.stringify(cases));

/* ---------------------------------------------------------------------------
   STEP 1: ONE RESPONSE.

   S3 truncates Last-Modified to whole seconds, so the upload happened inside
   [lm, lm + 999]: +999 keeps the stamp an upper bound, which is the only
   property epinoia/video.js relies on (it spends wall_err as run-up BEFORE the
   stamp). Receive time is an upper bound too, so it wins when it is earlier. A
   header older than two minutes, or more than 2 s ahead of our clock, is not
   believed, and receive time is used.
   --------------------------------------------------------------------------- */
console.log('\nstep 1: the stamp is when the copy was uploaded');
{
  const { got, err } = evalCases([
    { fn: 'version_stamp', args: [1000000, 1012000, null] },
    { fn: 'version_stamp', args: [1000000, 1000400, null] },
    { fn: 'version_stamp', args: [null, 1012000, null] },
    { fn: 'version_stamp', args: [1000000, 1130000, null] },
    { fn: 'version_stamp', args: [1005000, 1000000, null] },
    { fn: 'version_stamp', args: [1000000, 1012000, 1001000] },
    { fn: 'version_stamp', args: [1000000, 1012000, 1000000] },
    { fn: 'lm_ms', args: ['Sun, 13 Sep 2026 13:00:00 GMT'] },
    { fn: 'lm_ms', args: [null] },
    { fn: 'lm_ms', args: ['garbage'] },
  ]);
  if (err) ok('feedstamp.py --eval runs', false, err);
  else {
    const v = got.map(x => x.ok);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    ok('a believable Last-Modified stamps lm + 999 ms, with lm as the lower edge',
       eq(v[0], { stamp_ms: 1000999, edge_ms: 1000000, basis: 'lm', older: false }), JSON.stringify(v[0]));
    ok('...but never later than receive time, which binds inside the last second',
       v[1].stamp_ms === 1000400 && v[1].basis === 'lm', JSON.stringify(v[1]));
    ok('no header: receive time, and the lower edge a 30 s cache allows',
       v[2].stamp_ms === 1012000 && v[2].edge_ms === 982000 && v[2].basis === 'recv', JSON.stringify(v[2]));
    ok('a header 130 s old is not believed: receive time',
       v[3].stamp_ms === 1130000 && v[3].basis === 'recv', JSON.stringify(v[3]));
    ok('a header 5 s in the future is not believed: receive time',
       v[4].stamp_ms === 1000000 && v[4].basis === 'recv', JSON.stringify(v[4]));
    ok('a header earlier than the one already held is an older copy', v[5].older === true, JSON.stringify(v[5]));
    ok('...and an EQUAL one is not (S3 seconds: new content can carry the same header)', v[6].older === false);
    ok('Last-Modified parses to epoch ms', v[7] === 1789304400000, String(v[7]));
    ok('...and a missing or unreadable header is null', v[8] === null && v[9] === null);
  }
}

/* ---------------------------------------------------------------------------
   STEP 2: ONE GAME'S STATE, POLL BY POLL.

   Content is detected by HASH, not ETag: a new ETag on the same bytes would
   reset changed_at, and the stale-final rule ("unchanged 15 minutes at the end
   of P4") would never fire. A 200 whose Last-Modified is strictly older than
   the version held is an edge serving an older copy and is dropped.
   --------------------------------------------------------------------------- */
console.log('\nstep 2: the observer\'s state machine');
{
  const st = { $: 'st' };
  const { got, err } = evalCases([
    { fn: 'new_state', as: 'st' },
    { fn: 'accept', args: [st, 200, 1000000, 'e1', 1012000, 'h1'] },          // a1
    { fn: 'accept', args: [st, 304, 1000000, null, 1017000] },                // a2
    { fn: 'accept', args: [st, 304, 1020000, null, 1022000] },                // a3
    { fn: 'accept', args: [st, 304, 1090000, null, 1092000] },                // a4
    { fn: 'accept', args: [st, 200, 1091000, 'e2', 1093000, 'h1'] },          // a5
    { fn: 'accept', args: [st, 200, 999000, 'e0', 1095000, 'h0'] },           // a6
    { fn: 'accept', args: [st, 200, 1100000, 'e3', 1105000, 'h2'] },          // a7
    { fn: 'accept', args: [st, 200, null, 'e4', 1140000, 'h3'] },             // a8
    { fn: 'accept', args: [st, 403, null, null, 1145000] },                   // a9
    { fn: 'accept', args: [st, 500, null, null, 1150000] },                   // a10
    { fn: 'new_state', as: 'eq' },
    { fn: 'accept', args: [{ $: 'eq' }, 200, 1000000, 'x1', 1012000, 'k1'] },
    { fn: 'accept', args: [{ $: 'eq' }, 200, 1000000, 'x2', 1020000, 'k2'] },
    { fn: 'accept', args: [{ $: 'new_state_unused' }, 200, 1, null, 2, null] },
    { fn: 'new_state', as: 'nohash' },
    { fn: 'accept', args: [{ $: 'nohash' }, 200, null, null, 5000, null] },
    /* step 4: a 304 whose Last-Modified is 5 s AHEAD of our clock is not believed, so moves nothing */
    { fn: 'new_state', as: 'ahead' },
    { fn: 'accept', args: [{ $: 'ahead' }, 200, 1000000, 'y1', 1012000, 'j1'] },
    { fn: 'accept', args: [{ $: 'ahead' }, 304, 1025000, null, 1020000] },
  ]);
  if (err) ok('accept runs', false, err);
  else if (got.slice(1, 11).some(x => !x.ok)) ok('accept runs', false, JSON.stringify(got.slice(1, 11)));
  else {
    const [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10] = got.slice(1, 11).map(x => ({ s: x.ok[0], ev: x.ok[1] }));
    ok('a1: the first 200 is a new version stamped lm + 999',
       a1.ev === 'new' && a1.s.version === 1 && a1.s.stamp_ms === 1000999 && a1.s.changed_at_ms === 1012000 &&
       a1.s.lo_ms === null && a1.s.basis === 'lm' && a1.s.etag === 'e1', JSON.stringify(a1));
    ok('a2: a 304 is the same content; nothing moves',
       a2.ev === 'same' && a2.s.version === 1 && a2.s.changed_at_ms === 1012000 && a2.s.n304 === 1 &&
       a2.s.lm_seen_ms === 1000000);
    ok('a3, a4: 304s carrying a newer Last-Modified are still the same content',
       a3.ev === 'same' && a4.ev === 'same' && a4.s.version === 1 && a4.s.changed_at_ms === 1012000);
    /* STEP 4: an unchanged rewrite says the upload still held exactly this at that second */
    ok('a3 (step 4): a rewrite at 1020000 moves the lower edge to it',
       a3.s.lm_seen_ms === 1020000, String(a3.s.lm_seen_ms));
    ok('a4 (step 4): ...but never more than 60 s past the upload it rewrites (1090000 -> 1060000)',
       a4.s.lm_seen_ms === 1060000, String(a4.s.lm_seen_ms));
    ok('a5: a 200 with a NEW ETag but the same hash is the same content, and changed_at holds',
       a5.ev === 'same' && a5.s.version === 1 && a5.s.changed_at_ms === 1012000 && a5.s.etag === 'e2', JSON.stringify(a5));
    ok('a5 (step 4): ...and the cap still holds on a same-hash 200 (lm_seen stays 1060000)',
       a5.s.lm_seen_ms === 1060000, String(a5.s.lm_seen_ms));
    ok('a6: an older Last-Modified is an older copy: counted, not taken',
       a6.ev === 'older' && a6.s.version === 1 && a6.s.n_older === 1 && a6.s.hash === 'h1' && a6.s.etag === 'e2' &&
       a6.s.lm_seen_ms === 1060000);
    ok('a7: new content is version 2, stamped from its own header, windowed from the last rewrite seen (step 4)',
       a7.ev === 'new' && a7.s.version === 2 && a7.s.changed_at_ms === 1105000 && a7.s.stamp_ms === 1100999 &&
       a7.s.lo_ms === 1060000 && a7.s.lm_seen_ms === 1100000, JSON.stringify(a7.s));
    ok('a8: no Last-Modified is still a new version, on receive time',
       a8.ev === 'new' && a8.s.version === 3 && a8.s.basis === 'recv' && a8.s.stamp_ms === 1140000 &&
       a8.s.edge_ms === 1110000 && a8.s.lm_ms === null && a8.s.lo_ms === 1100000 && a8.s.lm_seen_ms === 1110000,
       JSON.stringify(a8.s));
    const ah = got[19] && got[19].ok;
    ok('a 304 whose Last-Modified is 5 s ahead of our clock does not move the lower edge',
       ah && ah[1] === 'same' && ah[0].lm_seen_ms === 1000000, JSON.stringify(got[19]));
    ok('a403 is absent; a 500 is an error; neither changes the version',
       a9.ev === 'absent' && a10.ev === 'error' && a10.s.version === 3 && a10.s.n_error === 1);
    ok('the poll gaps are counted for the decision gate (70 s and 35 s are over 25 s)',
       a10.s.polls === 10 && a10.s.gaps === 9 && a10.s.max_poll_gap_ms === 70000 && a10.s.gaps_over_25s === 2,
       JSON.stringify({ polls: a10.s.polls, gaps: a10.s.gaps, max: a10.s.max_poll_gap_ms, over: a10.s.gaps_over_25s }));
    ok('an EQUAL Last-Modified on different content is a new version, not an older copy',
       got[13].ok && got[13].ok[1] === 'new' && got[13].ok[0].version === 2, JSON.stringify(got[13]));
    ok('a 200 with no body hash is never mistaken for the (empty) held one',
       got[16].ok && got[16].ok[1] === 'new', JSON.stringify(got[16]));
  }
}

/* ---------------------------------------------------------------------------
   THE OBSERVER ITSELF, against a scripted CDN (no network).
   --------------------------------------------------------------------------- */
console.log('\nstep 2: the observer asks conditionally, on one cache key');
{
  const HARNESS = [
    'import sys, json, time, types',
    'from email.utils import formatdate',
    'try:',
    '    import requests',
    'except ImportError:',
    "    sys.modules['requests'] = types.ModuleType('requests')   # a bare CI python; the fake session is used",
    'sys.path.insert(0, sys.argv[1])',
    'import feed_observer as FO',
    'class Resp:',
    '    def __init__(self, status, body=None, lm_s=None, etag=None):',
    '        self.status_code = status',
    '        self.content = (body if isinstance(body, bytes) else json.dumps(body).encode()) if body is not None else b""',
    "        self.headers = {k: v for k, v in (('Last-Modified', formatdate(lm_s, usegmt=True) if lm_s else None), ('ETag', etag)) if v}",
    '    def json(self): return json.loads(self.content)',
    'class Sess:',
    '    def __init__(self, script): self.script, self.calls = script, []',
    '    def get(self, url, headers=None, timeout=None):',
    "        self.calls.append({'url': url, 'headers': dict(headers or {}), 'timeout': timeout})",
    '        item = self.script.pop(0)',
    '        if isinstance(item, Exception): raise item',
    '        return item',
    'now = int(time.time())',
    "G1 = {'tm': {'1': {'score': 2}, '2': {'score': 0}}, 'pbp': [{'actionNumber': 1, 'actionType': 'period', 'subType': 'start'}]}",
    "G0 = {'tm': {'1': {'score': 0}, '2': {'score': 0}}, 'pbp': []}",
    "G2 = {'tm': {'1': {'score': 5}, '2': {'score': 0}}, 'pbp': G1['pbp'] + [{'actionNumber': 2, 'actionType': '3pt'}]}",
    'script = [Resp(403), Resp(200, G1, now - 12, \'"e1"\'), Resp(304, None, now - 12, \'"e1"\'), Resp(200, G1, now - 12, \'"e2"\'),',
    "          Resp(200, G0, now - 60, '\"e0\"'), Resp(200, {'not': 'a game'}), Resp(200, b'<html>'), RuntimeError('reset'),",
    "          Resp(200, G2, now - 2, '\"e3\"')]",
    'rows, logs = [], []',
    "obs = FO.FeedObserver(session=Sess(script), gap_s=0, log=logs.append, on_poll=lambda x, r: rows.append(r))",
    'out = {"events": [], "takes": []}',
    'for i in range(9):',
    "    out['events'].append(obs.poll('2887008'))",
    "    s = obs.take('2887008')",
    "    out['takes'].append(None if s is None else {'version': s.version, 'stamp_ms': s.stamp_ms, 'lm_ms': s.lm_ms, 'recv_ms': s.recv_ms,",
    "                                                'changed_at_ms': s.changed_at_ms, 'fetch_ms': s.fetch_ms, 'score': s.raw['tm']['1']['score']})",
    "out['calls'] = obs.s.calls",
    "out['stats'] = obs.stats('2887008')",
    "out['rows'] = rows",
    "out['logs'] = logs",
    "out['now'] = now",
    "obs2 = FO.FeedObserver(session=Sess([Resp(304), Resp(304), Resp(304)]), gap_s=0, log=logs.append)",
    "out['due'] = [obs2.observe_due(['a'], 5.0), len(obs2.s.calls), obs2.observe_due(['a'], 5.0), len(obs2.s.calls),",
    "              obs2.observe_due(['a'], 5.0, frozenset({'a'}), 0.0), len(obs2.s.calls)]",
    "obs.forget('2887008'); out['forgotten'] = [obs.take('2887008'), obs.stats('2887008')['polls'], obs.stamps('2887008')]",
    /* step 3: the observer stamps each version's new actions as it arrives; the first is the baseline */
    "P = lambda an, at, sub, clock, per=1: {'actionNumber': an, 'actionType': at, 'subType': sub, 'clock': clock, 'period': per, 'periodType': 'REGULAR'}",
    "V1 = {'tm': {'1': {'score': 0}, '2': {'score': 0}}, 'pbp': [P(1, 'period', 'start', '10:00:00')]}",
    "V2 = {'tm': {'1': {'score': 2}, '2': {'score': 0}}, 'pbp': V1['pbp'] + [P(2, '2pt', 'layup', '09:40:00'), P(3, 'rebound', 'defensive', '09:35:00')]}",
    "V3 = {'tm': {'1': {'score': 2}, '2': {'score': 2}}, 'pbp': 5}",
    "V4 = {'tm': {'1': {'score': 2}, '2': {'score': 3}}, 'pbp': V2['pbp'] + [P(4, '2pt', 'dunk', '09:20:00'), P(5, 'foul', 'personal', '09:10:00')]}",
    "V5 = {'tm': {'1': {'score': 2}, '2': {'score': 4}}, 'pbp': V4['pbp'] + [P(6, 'freethrow', 'x', '09:10:00')]}",
    "slogs = []",
    "obs3 = FO.FeedObserver(session=Sess([Resp(200, V1, now - 40, '\"v1\"'), Resp(200, V2, now - 12, '\"v2\"'), Resp(200, V3, now - 2, '\"v3\"'),",
    "                                     Resp(200, V4, now - 2, '\"v4\"'), Resp(200, V5, now - 1, '\"v5\"')]), gap_s=0, log=slogs.append)",
    "ev3 = [obs3.poll('g3')]; s_after1 = obs3.stamps('g3'); ev3.append(obs3.poll('g3')); s_after2 = obs3.stamps('g3')",
    "s_after2['2'] = 'mutated'; ev3.append(obs3.poll('g3'))",
    "out['mem'] = {'events': ev3, 'after1': s_after1, 'after2': obs3.stamps('g3'), 'take3': obs3.take('g3').version,",
    "              'stats': obs3.stats('g3'), 'logs': slogs, 'copy': 'mutated' not in json.dumps(obs3.stamps('g3'))}",
    "ev3.append(obs3.poll('g3')); out['mem']['after4'] = obs3.stamps('g3')",
    "ev3.append(obs3.poll('g3')); out['mem']['after5'] = obs3.stamps('g3'); out['mem']['lo5'] = obs3.st['g3']['lo_ms']",
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');
  const { got, err } = py(['-c', HARNESS, INGEST]);
  if (err) ok('feed_observer runs against a fake session', false, err);
  else {
    const E = got.events, K = got.takes, C = got.calls;
    ok('before the table opens (403) there is nothing to take', E[0] === 'absent' && K[0] === null, JSON.stringify(E));
    ok('the first game body is version 1, stamped by its Last-Modified',
       E[1] === 'new' && K[1] && K[1].version === 1 && K[1].stamp_ms === (got.now - 12) * 1000 + 999 &&
       K[1].lm_ms === (got.now - 12) * 1000 && K[1].recv_ms === K[1].changed_at_ms && K[1].fetch_ms >= 0, JSON.stringify(K[1]));
    ok('...and the next request is conditional on its ETag',
       !('If-None-Match' in C[0].headers) && !('If-None-Match' in C[1].headers) && C[2].headers['If-None-Match'] === '"e1"');
    ok('every request pins the gzip cache key and names the ingest',
       C.every(c => c.headers['Accept-Encoding'] === 'gzip, deflate' && /ProphesyIngest/.test(c.headers['User-Agent'])) &&
       C.every(c => /\/data\/2887008\/data\.json$/.test(c.url)));
    ok('a 304 is the same version', E[2] === 'same' && K[2].version === 1);
    ok('a new ETag on the same body is the same version (hash, not ETag)', E[3] === 'same' && K[3].version === 1);
    ok('...and the new ETag is the one asked with next', C[4].headers['If-None-Match'] === '"e2"');
    ok('an older copy is dropped, the held body kept, and it is said so',
       E[4] === 'older' && K[4].version === 1 && K[4].score === 2 && got.logs.some(l => /older copy/.test(l)), JSON.stringify(got.logs));
    ok('JSON that is not a game is "not published", not a version', E[5] === 'absent' && K[5].version === 1);
    ok('a body that is not JSON, and a dropped connection, are errors that keep the loop alive',
       E[6] === 'error' && E[7] === 'error' && K[7].version === 1 && got.logs.some(l => /reset/.test(l)));
    ok('new content is version 2', E[8] === 'new' && K[8].version === 2 && K[8].score === 5 &&
       K[8].stamp_ms === (got.now - 2) * 1000 + 999, JSON.stringify(K[8]));
    const s = got.stats;
    ok('stats: polls, 304 share, versions, older copies, errors',
       s.polls === 9 && Math.abs(s.share304 - 1 / 9) < 1e-9 && s.versions === 2 && s.older === 1 && s.errors === 2 &&
       typeof s.max_poll_gap_ms === 'number' && s.gaps === 8, JSON.stringify(s));
    const r200 = got.rows.filter(r => r.status === 200 && r.event === 'new');
    ok('each poll is recorded in probe3\'s row shape, so a watch replays',
       got.rows.length === 9 && got.rows.every(r => r.gid === '2887008' && r.v === 'gzip' && typeof r.t0 === 'number') &&
       r200.length === 2 && r200.every(r => Array.isArray(r.top) && typeof r.lm === 'number' && r.n >= 1) &&
       got.rows[2].status === 304 && got.rows[7].err, JSON.stringify(got.rows.map(r => [r.status, r.event, !!r.top, r.err || ''])));
    const d = got.due;
    ok('observe_due only asks when a game\'s interval has passed (armed games on their own)',
       d[1] === 1 && d[3] === 1 && d[5] === 2, JSON.stringify(d));
    ok('forget() drops a finished game', got.forgotten[0] === null && got.forgotten[1] === 0 &&
       JSON.stringify(got.forgotten[2]) === '{}');

    /* STEP 3 IN THE OBSERVER. V1 (uploaded now-40) is the baseline; V2 (now-12) adds a layup at
       09:40 and the rebound at 09:35, so the layup is pulled 5 s: [hi - 5000, lo]. */
    const m = got.mem, hi = (got.now - 12) * 1000 + 999, lo = (got.now - 40) * 1000;
    ok('the first version a process holds is the baseline: known, nothing stamped',
       m.events[0] === 'new' && JSON.stringify(m.after1) === '{}', JSON.stringify(m));
    ok('the next version stamps its new actions, pulled by the clock, windowed from the one before',
       m.events[1] === 'new' && JSON.stringify(m.after2['2']) === JSON.stringify([hi - 5000, lo - 10000]) &&
       JSON.stringify(m.after2['3']) === JSON.stringify([hi, lo - 10000]) && !('1' in m.after2), JSON.stringify(m.after2));
    ok('stamps() hands out a copy, so a poll cannot change what a write is holding', m.copy === true);
    ok('a pbp that cannot be stamped costs its stamps, never the poll: the version is still taken',
       m.events[2] === 'new' && m.take3 === 3 && m.logs.some(l => /! feedstamp g3/.test(l)), JSON.stringify(m.logs));
    ok('stats() reports what memory holds', m.stats.stamped === 2 && m.stats.late === 0 && m.stats.contra === 0,
       JSON.stringify(m.stats));
    ok('...and the version after a failed one is a baseline again: what it held is known, never stamped late',
       m.events[3] === 'new' && JSON.stringify(Object.keys(m.after4).sort()) === '["2","3"]', JSON.stringify(m.after4));
    ok('...after which stamping resumes, windowed from that baseline',
       m.events[4] === 'new' && JSON.stringify(m.after5['6']) === JSON.stringify([(got.now - 1) * 1000 + 999, (got.now - 2) * 1000 - 10000]) &&
       m.lo5 === (got.now - 2) * 1000 && !('4' in m.after5) && !('5' in m.after5), JSON.stringify([m.after5, m.lo5]));
  }

  const fo = readFileSync(path.join(INGEST, 'feed_observer.py'), 'utf8');
  const fs_ = readFileSync(FEEDSTAMP, 'utf8');
  ok('the observer takes its session as an argument (session=None)...', /session=None/.test(fo));
  ok('...never as a default built at import', !/def [^\n]*requests\.Session\(\)/.test(fo));
  ok('feedstamp.py never imports requests (the guard runner has none)',
     !/^\s*(import requests|from requests)/m.test(fs_));
  const bare = py(['-c', "import sys, json; sys.modules['requests'] = None; sys.path.insert(0, sys.argv[1]); " +
                         "import feedstamp; sys.stdout.write('@@' + json.dumps(feedstamp.version_stamp(1000, 2000, None)))", INGEST]);
  ok('...and loads on a python where importing requests fails', bare.got && bare.got.stamp_ms === 1999, bare.err);
}

/* ---------------------------------------------------------------------------
   STEP 3: WHICH FEED ACTIONS EACH EVENT CAME FROM.

   The translator now remembers the LiveStats actionNumbers behind every event
   (`_ans`). In memory only - and everything the database sees must be exactly
   what it was: tools/feedtiming/golden.py froze the committed translator's rows
   on the saved feed BEFORE the edit, and they are compared field by field.
   --------------------------------------------------------------------------- */
console.log('\nstep 3: every translated event knows its actions, and no row moved');
{
  const HARNESS = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate, game_rows, default_pid, clock_ms',
    "raw = json.load(io.open(sys.argv[2], encoding='utf-8'))",
    'T = translate(raw, default_pid)',
    "pbp = {int(a['actionNumber']): a for a in raw['pbp']}",
    'out = {"events": T["events"], "warnings": T["report"]["warnings"], "keys": sorted({k for r in game_rows("g", T["events"]) for k in r}),',
    '       "pbp": {an: [a.get("actionType"), a.get("subType"), a.get("tno"), a.get("period"), a.get("gt")] for an, a in pbp.items()},',
    '       "clock_ms_trap": clock_ms("00:51:40")}',
    /* a fouled-out player the feed never subs off: the translator invents the sub, with no action behind it */
    "pl = lambda n, s: {str(i): {'firstName': 'P', 'familyName': str(i), 'shirtNumber': i, 'starter': '1' if i <= 5 else '0'} for i in range(1, n + 1)}",
    "fo = {'tm': {'1': {'name': 'H', 'code': 'H', 'pl': pl(6, 1)}, '2': {'name': 'A', 'code': 'A', 'pl': pl(6, 2)}},",
    "      'pbp': [{'actionNumber': 1, 'actionType': 'period', 'subType': 'start', 'period': 1, 'periodType': 'REGULAR', 'gt': '10:00'}] +",
    "             [{'actionNumber': 1 + k, 'actionType': 'foul', 'subType': 'personal', 'tno': 1, 'pno': 1, 'period': 1, 'periodType': 'REGULAR', 'gt': '0%d:00' % (9 - k)} for k in range(1, 6)]}",
    'F = translate(fo, default_pid)',
    'out["fouled_out"] = [[e["t"], e["_ans"]] for e in F["events"]] + [F["report"]["warnings"]]',
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');
  const FEED = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json');
  const { got, err } = py(['-c', HARNESS, INGEST, FEED]);
  if (err) ok('the translator runs on the saved feed', false, err);
  else {
    const E = got.events;
    ok('383 events, every one with a list of actionNumbers',
       E.length === 383 && E.every(e => Array.isArray(e._ans)), String(E.length));
    const sat = E.filter(e => ['loc', 'stype', 'tag'].includes(e.t));
    const count = t => sat.filter(e => e.t === t).length;
    ok('the 190 satellites (75 loc, 82 stype, 33 tag) carry their shot\'s actionNumber',
       sat.length === 190 && count('loc') === 75 && count('stype') === 82 && count('tag') === 33 &&
       sat.every(e => JSON.stringify(e._ans) === JSON.stringify(E[e.payload.ref - 1]._ans)), String(sat.length));
    ok('every other event carries exactly the action it was read from',
       E.filter(e => !['loc', 'stype', 'tag', 'sub'].includes(e.t)).every(e => e._ans.length === 1 && got.pbp[e._ans[0]]));
    const subs = E.filter(e => e.t === 'sub');
    const P = got.pbp;
    ok('all 22 substitutions carry both halves, [out, in]: the same team, period and clock',
       subs.length === 22 && subs.every(e => e._ans.length === 2 &&
         P[e._ans[0]] && P[e._ans[1]] && P[e._ans[0]][0] === 'substitution' && P[e._ans[0]][1] === 'out' && P[e._ans[1]][1] === 'in' &&
         P[e._ans[0]][2] === P[e._ans[1]][2] && P[e._ans[0]][3] === P[e._ans[1]][3] && P[e._ans[0]][4] === P[e._ans[1]][4]),
       JSON.stringify(subs.slice(0, 3).map(e => e._ans)));
    ok('...and not the action being read when the pair was flushed',
       subs.every(e => e._ans.every(an => P[an][0] === 'substitution')));
    ok('game_rows still writes exactly the eight columns: _ans never reaches the database',
       JSON.stringify(got.keys) === JSON.stringify(['clock', 'game_id', 'payload', 'period', 'pid', 'seq', 't', 'team']),
       JSON.stringify(got.keys));
    const golden = JSON.parse(readFileSync(path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.golden.json'), 'utf8'));
    const mine = E.map(e => [e.seq, e.t, e.team, e.pid, e.period, e.clock, e.payload]);
    /* key order is not content: the golden file was written with sorted keys */
    const canon = x => Array.isArray(x) ? '[' + x.map(canon).join(',') + ']'
      : (x && typeof x === 'object') ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}'
      : JSON.stringify(x);
    const firstDiff = mine.findIndex((r, i) => canon(r) !== canon(golden[i]));
    ok('seq, t, team, pid, period, clock and payload equal the golden translation, row for row',
       golden.length === 383 && mine.length === golden.length && firstDiff === -1,
       firstDiff >= 0 ? JSON.stringify([mine[firstDiff], golden[firstDiff]]) : String(golden.length));
    const fo = got.fouled_out, fab = fo.slice(0, -1).filter(x => x[0] === 'sub');
    ok('the sub invented for a fouled-out player carries no action at all ([])',
       fab.length === 1 && JSON.stringify(fab[0][1]) === '[]' && fo[fo.length - 1].some(w => /fabricated sub/.test(w)),
       JSON.stringify(fo));
    ok('the trap this avoids: translate\'s clock_ms reads "00:51:40" as 0', got.clock_ms_trap === 0, String(got.clock_ms_trap));
  }
}

/* ---------------------------------------------------------------------------
   STEP 3: ONE ACTION'S WINDOW.

   An action is timed by the version it first appears in. Within that version,
   real time between two plays is never less than their game time, so the most
   basketball played among the actions keyed at or after it bounds how much
   earlier it happened: hi_i = hi - (E_i - el_i). The first version a process
   sees is the baseline (known, never stamped: "none", today's poll logic). A
   late entry - a clock more than 3 s behind what the log had shown - is
   declined. Memory is write-once.
   --------------------------------------------------------------------------- */
console.log('\nstep 3: memory stamps, by hand');
{
  const A = (an, at, sub, clock, period = 1, periodType = 'REGULAR') =>
    ({ actionNumber: an, actionType: at, subType: sub, clock, period, periodType });
  const base = [A(1, 'period', 'start', '10:00:00'), A(2, '2pt', 'layup', '09:30:00'), A(3, 'rebound', 'defensive', '09:00:00')];
  const v2 = base.concat([A(4, '2pt', 'jumpshot', '08:50:00'), A(5, 'rebound', 'offensive', '08:40:00'), A(6, '3pt', 'jumpshot', '08:30:00'),
                          A(7, 'turnover', 'badpass', '09:30:00'), A(8, 'foul', 'personal', '08:32:00')]);
  const v3 = v2.concat([A(4, '2pt', 'jumpshot', '08:20:00'), A(9, 'substitution', 'in', '08:30:00')]);
  const S = { $: 's' }, ST = { $: 's', i: 'stamps' };
  const cases = [
    { fn: 'elapsed_ms', args: [A(10, '2pt', 'jumpshot', '00:51:40', 4)] },                       // 0
    { fn: 'elapsed_ms', args: [{ actionNumber: 10, actionType: '2pt', gt: '00:51', period: 4 }] }, // 1
    { fn: 'elapsed_ms', args: [A(11, '2pt', 'x', '04:00:00', 1, 'OVERTIME')] },                    // 2
    { fn: 'elapsed_ms', args: [A(12, 'period', 'start', '10:00:00', 2)] },                          // 3
    { fn: 'elapsed_ms', args: [{ actionNumber: 13, actionType: '2pt', clock: 'garbage', period: 1 }] }, // 4
    { fn: 'clock_cc_ms', args: ['00:51:40'] }, { fn: 'clock_cc_ms', args: ['09:59.5'] }, { fn: 'clock_cc_ms', args: [null] }, // 5-7
    { fn: 'new_state', as: 's' },                                                                   // 8
    { fn: 'stamp_version', args: [S, base, 1000999, null, true] },                                  // 9
    { fn: 'value', args: [S] },                                                                     // 10
    { fn: 'row_stamp', args: [[2], ST] },                                                           // 11
    { fn: 'stamp_version', args: [S, v2, 1031999, 1000000, false] },                                // 12
    ...[[4], [5], [6], [7], [8], [4, 6], [], [99], [7, 99], [99, 7]].map(a => ({ fn: 'row_stamp', args: [a, ST] })), // 13-22
    { fn: 'stamp_version', args: [S, v3, 1061999, 1031000, false] },                                // 23
    { fn: 'value', args: [ST] },                                                                    // 24
    { fn: 'row_stamp', args: [[6, 9], ST] },                                                        // 25
    { fn: 'value', args: [S] },                                                                     // 26
    /* a contradiction: the pull lands 47 s before the lower edge */
    { fn: 'new_state', as: 'c' },                                                                   // 27
    { fn: 'stamp_version', args: [{ $: 'c' }, [A(1, '2pt', 'x', '10:00:00')], 1000999, null, true] }, // 28
    { fn: 'stamp_version', args: [{ $: 'c' }, [A(2, '2pt', 'x', '09:58:00'), A(3, '2pt', 'x', '09:00:00')], 1010999, 1000000, false] }, // 29
    { fn: 'value', args: [{ $: 'c' }] },                                                            // 30
    /* past three minutes: the tip against a pre-game upload is left to the poll, not declined */
    { fn: 'new_state', as: 'w' },                                                                   // 31
    { fn: 'stamp_version', args: [{ $: 'w' }, [], 1000999, null, true] },                           // 32
    { fn: 'stamp_version', args: [{ $: 'w' }, [A(1, 'period', 'start', '10:00:00'), A(2, 'jumpball', 'won', '09:59:00')], 1200999, 1000000, false] }, // 33
    { fn: 'value', args: [{ $: 'w', i: 'stamps' }] },                                               // 34
    { fn: 'row_stamp', args: [[1], { $: 'w', i: 'stamps' }] },                                      // 35
    /* no lower edge is the baseline too, whatever the flag says */
    { fn: 'new_state', as: 'n' },                                                                   // 36
    { fn: 'stamp_version', args: [{ $: 'n' }, [A(1, '2pt', 'x', '09:00:00')], 1000999, null, false] }, // 37
    { fn: 'value', args: [{ $: 'n' }] },                                                            // 38
    /* final-minute tenths are kept: two actions 0.6 s apart pull 600 ms, not 0 or 1000 */
    { fn: 'new_state', as: 't' },                                                                   // 39
    { fn: 'stamp_version', args: [{ $: 't' }, [A(1, '2pt', 'x', '01:00:00', 4)], 1000999, null, true] }, // 40
    { fn: 'stamp_version', args: [{ $: 't' }, [A(2, 'foul', 'personal', '00:51:40', 4), A(3, 'freethrow', 'x', '00:50:80', 4)], 1030999, 1000000, false] }, // 41
    { fn: 'value', args: [{ $: 't', i: 'stamps' }] },                                               // 42
  ];
  const { got, err } = evalCases(cases);
  const bad = err ? null : got.findIndex(x => !('ok' in x));
  if (err || bad >= 0) ok('stamp_version / row_stamp run', false, err || JSON.stringify([bad, got[bad]]));
  else {
    const v = got.map(x => x.ok);
    const J = x => JSON.stringify(x);
    ok('elapsed_ms reads the pbp clock\'s hundredths: P4 00:51:40 is 2348600 (gt 00:51 would say 2349000)',
       v[0] === 2348600 && v[1] === 2349000, J([v[0], v[1]]));
    ok('...OT1 04:00:00 is 2460000, a P2 start is its base, 600000, and garbage is null',
       v[2] === 2460000 && v[3] === 600000 && v[4] === null, J([v[2], v[3], v[4]]));
    ok('clock_cc_ms: mm:ss:cc, mm:ss.f, and nothing', v[5] === 51400 && v[6] === 599500 && v[7] === null, J(v.slice(5, 8)));
    ok('the baseline is known, not stamped: no entries, maxel 60 s, and its actions fall back ("none")',
       J(v[9]) === '[]' && J(v[10].stamps) === '{}' && J(v[10].known) === '[1,2,3]' && v[10].maxel_ms === 60000 &&
       J(v[11]) === '["none",null]', J([v[9], v[10].stamps, v[10].known, v[10].maxel_ms, v[11]]));
    const [r4, r5, r6, r7, r8, r46, rE, r99, r799, r997] = v.slice(13, 23);
    ok('a two at 08:50, followed in the same upload by a three at 08:30, is pulled 20 s',
       J(r4) === J(['mem', { wall: 1011999, wall_err: 21999 }]), J(r4));
    ok('...the rebound at 08:40 10 s, and the three itself not at all',
       J(r5) === J(['mem', { wall: 1021999, wall_err: 31999 }]) && J(r6) === J(['mem', { wall: 1031999, wall_err: 41999 }]), J([r5, r6]));
    ok('a turnover at 09:30, keyed after the log had shown 09:00, is a late entry: declined',
       J(r7) === '["decline",null]' && got[12].ok.includes(7), J(r7));
    ok('a foul at 08:32 is within 3 s of nothing it trails, and is its own latest: not pulled',
       J(r8) === J(['mem', { wall: 1029999, wall_err: 39999 }]), J(r8));
    ok('several actions: the earliest upper bound', J(r46) === J(['mem', { wall: 1011999, wall_err: 21999 }]), J(r46));
    ok('no actions ([]) and an action memory never saw are "none"', J(rE) === '["none",null]' && J(r99) === '["none",null]');
    ok('...and a decline wins over an unknown, in either order', J(r799) === '["decline",null]' && J(r997) === '["decline",null]');
    ok('memory is write-once: action 4 reappearing at 08:20 keeps [1011999, 990000]',
       J(v[24]['4']) === J([1011999, 990000]) && J(v[24]['9']) === J([1061999, 1021000]), J(v[24]));
    ok('a substitution whose halves landed in different versions takes the SMALLEST lower edge',
       J(v[25]) === J(['mem', { wall: 1031999, wall_err: 41999 }]), J(v[25]));
    ok('the late entry is counted, and nothing contradicted', v[26].late === 1 && v[26].contra === 0, J([v[26].late, v[26].contra]));
    ok('a pull that lands before the lower edge is not stored at all, and is counted',
       v[30].stamps['2'] === undefined && J(v[30].stamps['3']) === J([1010999, 990000]) && v[30].contra === 1,
       J([v[30].stamps, v[30].contra]));
    ok('a window past 180 s is stored, and read back as "none", not a decline: the tip keeps today\'s stamp',
       J(v[34]['1']) === J([1199999, 990000]) && J(v[35]) === '["none",null]', J([v[34], v[35]]));
    ok('with no lower edge a version is a baseline whatever the flag says',
       J(v[37]) === '[]' && J(v[38].stamps) === '{}' && J(v[38].known) === '[1]', J(v[38]));
    ok('final-minute hundredths survive the pull: 00:51:40 then 00:50:80 is 600 ms',
       J(v[42]['2']) === J([1030399, 990000]) && J(v[42]['3']) === J([1030999, 990000]), J(v[42]));
  }
}

/* ---------------------------------------------------------------------------
   THE BUDGET, REPLAYED THROUGH THE CDN.

   probe3.jsonl.gz: four live BCB games, ~15 minutes, gzip key polled every 3 s.
   The replay walks every row (304s without a header included): the edge's copy
   at a row is the latest 200 at or before it. tools/feedtiming/steps_sim.py kept
   only rows with a Last-Modified and so measured the CDN's own 30 s cycle; its
   cadence claims ("every version seen at 5-15 s, 25 s loses versions") were
   artefacts. What holds: with Last-Modified stamps, cadence barely matters
   below ~25-30 s, and a 38 s loop (today's median) loses a sixth of versions.
   --------------------------------------------------------------------------- */
console.log('\nthe budget, replayed');
{
  const run = (S) => py([FEEDSTAMP, '--replay', PROBE, '--every', String(S), '--step', '2', '--json']);
  const r5 = run(5), r10 = run(10), r38 = run(38);
  if (r5.err || r10.err || r38.err) ok('feedstamp.py --replay runs', false, r5.err || r10.err || r38.err);
  else {
    const a = r5.got, b = r10.got, c = r38.got;
    ok('a poll every 5 s sees every one of the 110 versions', a.versions_total === 110 && a.versions_seen === 110,
       `${a.versions_seen}/${a.versions_total}`);
    ok('...and so does every 10 s', b.versions_seen === 110, `${b.versions_seen}/${b.versions_total}`);
    ok('today\'s 38 s loop does not (90 of 110)', c.versions_seen <= 95, `${c.versions_seen}/${c.versions_total}`);
    /* a window is lm - lm_prev + 999 ms, so "30 s" is 29.999 */
    const near30 = (g) => g && Math.abs(g.median - 30) < 0.5;
    ok('shot windows: median 30 s at a 5 s poll (the plan\'s <= 30 s)',
       near30(a.groups.shots) && a.groups.shots.median <= 30.5 && a.groups.shots.n === 103, JSON.stringify(a.groups.shots));
    ok('other live-ball windows: median 30 s', near30(a.groups.live) && a.groups.live.n === 161, JSON.stringify(a.groups.live));
    ok('dead-ball windows: median 30 s', near30(a.groups.dead) && a.groups.dead.n === 85, JSON.stringify(a.groups.dead));
    ok('...with 10 dead-ball windows past 180 s declined (period breaks) and nothing else',
       a.wide.dead === 10 && a.wide_total === 10, JSON.stringify(a.wide));
    ok('no stamp is later than the first upload that contained its play',
       a.hi_after_first_lm_max_ms === 0 && a.contradictions === 0, String(a.hi_after_first_lm_max_ms));
    ok('at 38 s the windows widen (shots median 37 s, dead ball 56 s)',
       c.groups.shots.median > a.groups.shots.median && c.groups.dead.median > a.groups.dead.median,
       JSON.stringify([c.groups.shots.median, c.groups.dead.median]));
  }

  /* STEP 3: memory stamps, pulled by the clock. The recording keeps only the newest 60
     actions per version, so a late entry cannot occur in it (hand cases cover that). */
  const r3 = py([FEEDSTAMP, '--replay', PROBE, '--every', '5', '--step', '3', '--json']);
  const r4 = py([FEEDSTAMP, '--replay', PROBE, '--every', '5', '--step', '4', '--json']);
  const r2 = run(5);
  if (r3.err || r4.err || r2.err) ok('feedstamp.py --replay --step 3/4 runs', false, r3.err || r4.err || r2.err);
  else {
    const t = r3.got, f = r4.got, J = x => JSON.stringify(x);
    /* a window is hi - lo with hi = Last-Modified + 999 ms, so "37 s" is 36.999.
       EVERY NUMBER HERE IS THE PLAN'S PLUS THE 10 s KEY LAG (feedstamp.KEY_LAG_MS): the
       upload before a play is not quite a lower bound for it, because the upload's content
       is older than its Last-Modified and a play is keyed a few seconds after it happens.
       The shape of the distribution is the pull; the offset is that allowance. */
    const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.01;
    const g = (x, n, med, p90, max) => x && x.n === n && near(x.median, med) && near(x.p90, p90) && (max == null || near(x.max, max));
    ok('step 3: every version seen, every action placed, nothing past 180 s, no late entries',
       t.versions_seen === 110 && t.wide_total === 0 && t.late === 0, J([t.versions_seen, t.wide, t.late]));
    ok('step 3: shot windows median 37 s (the plan\'s <= 27 s), p25 30, p90 48, max 134',
       g(t.groups.shots, 103, 37, 48, 134) && near(t.groups.shots.p25, 30) && t.groups.shots.median <= 37, J(t.groups.shots));
    ok('step 3: other live-ball median 38 s, p90 46', g(t.groups.live, 161, 38, 46), J(t.groups.live));
    ok('step 3: dead ball median 40 s, p90 57, max 71 - the 10 period-break windows are now placed',
       g(t.groups.dead, 95, 40, 57, 71), J(t.groups.dead));
    ok('no pulled stamp is later than the first upload that held its play',
       t.hi_after_first_lm_max_ms !== null && t.hi_after_first_lm_max_ms <= 1000, String(t.hi_after_first_lm_max_ms));
    ok('no contradiction now: the assist keyed after its basket\'s upload (2887012 #451), by 1 ms: inside the 2 s slack',
       t.contradictions === 0 && t.hi_minus_lo_min_ms >= -2000 && J(t.contra_list) === J([['2887012', 451, -1]]),
       J([t.contradictions, t.hi_minus_lo_min_ms, t.contra_list]));
    ok('step 4: shots median 37 s, p90 47, max 74', g(f.groups.shots, 103, 37, 47, 74), J(f.groups.shots));
    ok('step 4: other live-ball median 38 s, p90 45, max 67', g(f.groups.live, 161, 38, 45, 67), J(f.groups.live));
    ok('step 4: dead ball median 40 s, p90 45 (the plan\'s <= 50 s), max 57',
       g(f.groups.dead, 95, 40, 45, 67) && f.groups.dead.p90 <= 46 && f.groups.dead.p90 <= 60, J(f.groups.dead));
    ok('step 4: nothing contradicts, nothing past 180 s',
       f.contradictions === 0 && f.hi_minus_lo_min_ms >= -2000 && f.wide_total === 0, J([f.contradictions, f.wide]));
    /* WHAT THE CLIP CAP BUYS (epinoia/video.js clipOf, step 5), the play anywhere in its window */
    const c2 = r2.got.containment, c3 = t.containment, c4 = f.containment;
    ok('a made three at a 15 s run-up cap: 0.83, then 0.74 and 0.75 once the window is honest',
       c2.p3_made.cap15 === 0.833 && c3.p3_made.cap15 === 0.739 && c4.p3_made.cap15 === 0.75, J([c2.p3_made, c3.p3_made, c4.p3_made]));
    ok('...0.97 at 30 s and 0.99 at 45 s (free throws 0.59, 0.93, 0.99): the cap video.js raises',
       c4.p3_made.cap30 >= 0.96 && c4.p3_made.cap45 >= 0.99 && c4.ft_made.cap15 === 0.591 && c4.ft_made.cap30 >= 0.92 && c4.ft_made.cap45 >= 0.98, J(c4));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
