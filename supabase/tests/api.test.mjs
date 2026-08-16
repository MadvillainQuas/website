/* ============================================================================
   The read-only JSON API.

   Exercises the deployed Edge Function the way a consumer would: over HTTP,
   with a real key, checking both the shape of what comes back and the refusals
   — a bad key, a missing key, an unknown endpoint, and a league the key is not
   scoped to.

   The key is read from the scratchpad rather than this file, because a test
   with a credential in it is a credential in the repository. Skips cleanly
   when the key is not present, so this runs in CI without one.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/api';
const KEY_FILE = process.env.COURTSIDE_API_KEY_FILE ||
  'C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-Documents-ToUtopia-BattleEngine/' +
  '753cd4fc-247c-47e9-907a-c1bfd472aa7e/scratchpad/api-test-key.txt';

let KEY = process.env.COURTSIDE_API_KEY || '';
if (!KEY) {
  try { KEY = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (_) { /* none */ }
}
if (!KEY) {
  console.log('\nSKIP — no API key available (set COURTSIDE_API_KEY to run)');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got));

async function get(p, key = KEY) {
  const r = await fetch(BASE + p, { headers: key ? { 'X-API-Key': key } : {} });
  let body = null;
  try { body = await r.json(); } catch (_) { body = null; }
  return { status: r.status, body, headers: r.headers };
}

(async function main() {
  console.log('\nthe front door');
  {
    const r = await get('/');
    ok('the root describes itself without a key', r.status === 200, 'status ' + r.status);
    ok('and lists its endpoints', Array.isArray(r.body?.endpoints) && r.body.endpoints.length > 4,
       (r.body?.endpoints || []).length + ' endpoints');
  }

  console.log('\nauthentication');
  {
    const r = await get('/v1/leagues', '');
    eq('no key is refused', r.status, 401);
    ok('with a hint about how to send one', /X-API-Key/.test(r.body?.hint || ''), r.body?.hint);
  }
  {
    const r = await get('/v1/leagues', 'csk_definitely_not_a_real_key');
    eq('a bogus key is refused', r.status, 401);
    ok('and is not told whether the key ever existed',
       r.body?.error === 'invalid key', r.body?.error);
  }

  console.log('\nquota accounting');
  {
    const r = await get('/v1/leagues');
    eq('a good key is accepted', r.status, 200);
    const lim = r.headers.get('x-ratelimit-limit');
    const rem = r.headers.get('x-ratelimit-remaining');
    ok('the limit is reported', lim != null, lim);
    ok('the remaining count is reported', rem != null, rem);
    ok('and the reset time is', r.headers.get('x-ratelimit-reset') != null,
       r.headers.get('x-ratelimit-reset'));

    const before = Number(rem);
    const r2 = await get('/v1/leagues');
    const after = Number(r2.headers.get('x-ratelimit-remaining'));
    ok('the counter actually moves', after === before - 1, before + ' -> ' + after);
  }

  console.log('\nthe collections');
  let slug = null;
  {
    const r = await get('/v1/leagues');
    ok('leagues come back', Array.isArray(r.body?.leagues), JSON.stringify(r.body?.leagues));
    slug = r.body?.leagues?.[0]?.slug;
    ok('a key scoped to one league sees only that league',
       (r.body?.leagues || []).length === 1, slug);
  }

  {
    const r = await get(`/v1/leagues/${slug}`);
    eq('the overview loads', r.status, 200);
    ok('and names its competitions',
       Array.isArray(r.body?.competitions) && r.body.competitions.length > 0,
       (r.body?.competitions || []).map(c => c.name).join(', '));
  }

  {
    const r = await get(`/v1/leagues/${slug}/standings`);
    eq('standings load', r.status, 200);
    const rows = r.body?.standings || [];
    ok('with rows', rows.length > 0, rows.length + ' rows');
    ok('a team is an object, not a bare id',
       rows[0] && typeof rows[0].team === 'object' && rows[0].team.slug != null,
       JSON.stringify(rows[0]?.team));
    ok('and no internal ids leak into the row',
       rows[0] && !('team_id' in rows[0]) && !('competition_id' in rows[0]),
       Object.keys(rows[0] || {}).join(','));
    ok('ranks ascend', rows.every((r2, i) => i === 0 || r2.rank >= rows[i - 1].rank),
       rows.map(r2 => r2.rank).join(','));
  }

  let gameId = null;
  {
    const r = await get(`/v1/leagues/${slug}/games?status=final&limit=3`);
    eq('games load', r.status, 200);
    ok('the limit is honoured', (r.body?.games || []).length <= 3,
       (r.body?.games || []).length + ' games');
    ok('and is echoed so a caller can page', r.body?.limit === 3, String(r.body?.limit));
    const g = r.body?.games?.[0];
    ok('a finished game carries its score', g && g.score && g.score.home != null,
       JSON.stringify(g?.score));
    gameId = g?.id;
  }

  {
    const r = await get(`/v1/leagues/${slug}/players?limit=5`);
    eq('players load', r.status, 200);
    const p = r.body?.players?.[0];
    ok('a player is named, not just an id', p && p.player && p.player.name,
       p?.player?.name);
    ok('totals and per-game are both given',
       p && p.totals && p.per_game && p.per_game.points != null,
       JSON.stringify(p?.per_game));
    ok('sorted by points', (r.body?.players || []).every((x, i, a) =>
       i === 0 || x.totals.points <= a[i - 1].totals.points),
       (r.body?.players || []).map(x => x.totals.points).join(','));
  }

  {
    const r = await get(`/v1/leagues/${slug}/awards`);
    eq('awards load', r.status, 200);
    ok('with a basis stated for each',
       (r.body?.awards || []).every(a => typeof a.basis === 'string'),
       (r.body?.awards || []).length + ' awards');
  }

  {
    const comp = (await get(`/v1/leagues/${slug}`)).body?.competitions
      ?.find(c => c.format === 'knockout');
    if (comp) {
      const r = await get(`/v1/leagues/${slug}/bracket?competition=${comp.id}`);
      eq('the bracket loads', r.status, 200);
      ok('with ties', (r.body?.ties || []).length > 0, (r.body?.ties || []).length + ' ties');
      const undecided = (r.body?.ties || []).find(t => !t.home);
      ok('an unplayed tie has no team rather than a fake one',
         undecided ? undecided.home === null : true);
    } else {
      console.log('  SKIP  no knockout competition to read');
    }
  }

  if (gameId) {
    const r = await get(`/v1/games/${gameId}`);
    eq('a box score loads', r.status, 200);
    ok('with both sides',
       Array.isArray(r.body?.box_score?.home) && Array.isArray(r.body?.box_score?.away),
       (r.body?.box_score?.home || []).length + ' v ' + (r.body?.box_score?.away || []).length);
    const line = r.body?.box_score?.home?.[0];
    ok('a line is shaped for a reader',
       line && line.player?.name && line.fg && line.fg.attempted != null,
       JSON.stringify(line?.fg));
    ok('minutes are minutes, not milliseconds',
       line && (line.minutes == null || line.minutes < 60), String(line?.minutes));
  }

  console.log('\nrefusals');
  {
    const r = await get('/v1/leagues/not-a-real-league/standings');
    eq('an unknown league is a 404', r.status, 404);
  }
  {
    const r = await get(`/v1/leagues/${slug}/nonsense`);
    eq('an unknown collection is a 404', r.status, 404);
    ok('that says what does exist', /standings/.test(r.body?.hint || ''), r.body?.hint);
  }
  {
    const r = await fetch(BASE + '/v1/leagues',
      { method: 'POST', headers: { 'X-API-Key': KEY } });
    eq('writing is refused', r.status, 405);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
