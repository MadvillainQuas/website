'use strict';
/* ============================================================================
   THE INJURY REPORT / WAIVER WIRE

   WHO IS MISSING, WORKED OUT RATHER THAN TYPED IN. No league on this platform
   files an injury list, and none of them will start. But every finalised game
   already says exactly who was on the sheet and for how long, so the absence of
   a player who was playing last week is a fact the box scores already hold.

   Two kinds of absence, which are the same thing to a reader:

     OUT     no row in the box score at all — not on the sheet
     DNP     on the sheet, nought minutes — dressed and did not play

   Neither means anything on its own: a twelfth man missing a game is not news.
   So an absence is only reported for somebody the club was PLAYING, judged on
   what they had done before the game they missed (never on the season average,
   which the absence itself drags down):

     · at least MIN_GP appearances for that club — two, which is the fewest that
       can establish anything at all, and leaves the minutes below to say whether
       the club was playing him, and
     · twenty minutes or more last time out, or ROTATION_MPG a game, or a share
       of the club's games since their first appearance above SHARE — and, for
       that last one, REGULAR_MPG a game as well: turning out every week for
       four minutes is being available, not being played

   It RESOLVES ITSELF. There is no "resolved" flag to forget to clear: the
   report is computed from the games every time it is drawn, so the first game a
   player records a minute in, they are no longer missing from anything — the
   league page, the global wire and the preview's question marks all stop
   together because none of them is storing a judgement.

   TWO THINGS IT MUST NOT CALL AN INJURY:

     A TRANSFER. A player who left is missing from his old club's box scores
     forever. If he appears for anybody else after his last game here, he is
     gone, not hurt (`moved`).

     A RELEASE. The rest is the club's own knowledge, so a team manager (or
     their league's administrator) can mark a player released — player_releases,
     migration 0132 — and they leave the report and the previews at once.

   Pure functions over rows that are already loaded for the statistics pages:
   games (id, tipoff_at, home_team_id, away_team_id) and player_game_stats
   (game_id, player_uuid/player_id, team_idx, stats.min in MILLISECONDS). It
   asks for nothing of its own.

   supabase/tests/injuries.test.mjs holds every rule above.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaInjuries = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ---------------------------------------------------------- the thresholds ---
   Deliberately few and deliberately named: every one of them is a judgement
   about what "was playing" means, and a reader is told which one a player
   cleared rather than being shown a number out of nowhere. */
const MIN_GP        = 2;     // appearances for this club before an absence counts
const HEAVY_MIN     = 20;    // minutes last time out that make a player a starter-in-all-but-name
const ROTATION_MPG  = 15;    // minutes a game over their appearances
const SHARE         = 0.6;   // share of the club's games since their first that they played
const REGULAR_MPG   = 8;     // ...and the minutes that share has to be made of
const STALE_GAMES   = 10;    // beyond this a "waiver wire" entry, not a fresh absence

const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const mins = s => num(s && s.min) / 60000;          // the box stores milliseconds
const pid = r => r.player_uuid || r.player_id || null;
const key = (team, player) => String(team) + '|' + String(player);

/* the games that count, oldest first. A FINALISING GAME IS NOT DONE: its box is
   still being entered, and half an entered box makes a whole squad look absent. */
function timeline(games) {
  return (games || [])
    .filter(g => g && g.id && (g.status == null || g.status === 'final'))
    .slice()
    .sort((a, b) => String(a.tipoff_at || '').localeCompare(String(b.tipoff_at || '')));
}

const sideOf = (g, idx) => (idx === 0 ? g.home_team_id : g.away_team_id);

/* ------------------------------------------------------------- the report ---
   report({ games, pgs, released, now })

     games     the season's games (the statistics pages already have them)
     pgs       player_game_stats rows for those games
     released  a Set of "teamId|playerId", or a list of { team_id, player_id }
     opts      any threshold above, to override for a league that wants to

   Returns { entries, byTeam, teams } — entries newest absence first, byTeam a
   Map of teamId to that club's entries in the same order. */
function report(o) {
  const opt = o || {};
  const T = Object.assign({ MIN_GP, HEAVY_MIN, ROTATION_MPG, SHARE, REGULAR_MPG, STALE_GAMES }, opt.opts || {});
  const gl = timeline(opt.games);
  const byId = new Map(gl.map(g => [String(g.id), g]));
  const out = { entries: [], byTeam: new Map(), teams: [] };
  if (!gl.length) return out;

  const rel = releasedSet(opt.released);

  /* the club's games in order, and every appearance keyed by club and player */
  const clubGames = new Map();                       // teamId -> [game, …] oldest first
  gl.forEach(g => {
    [g.home_team_id, g.away_team_id].forEach(t => {
      if (!t) return;
      if (!clubGames.has(String(t))) clubGames.set(String(t), []);
      clubGames.get(String(t)).push(g);
    });
  });

  /* appearances: club+player -> Map<gameId, minutes>, and a player's last game anywhere */
  const seen = new Map();
  const lastAnywhere = new Map();                    // playerId -> { at, teamId }
  (opt.pgs || []).forEach(r => {
    const g = byId.get(String(r.game_id));
    const p = pid(r);
    if (!g || !p) return;
    const team = sideOf(g, r.team_idx);
    if (!team) return;
    const k = key(team, p);
    if (!seen.has(k)) seen.set(k, new Map());
    seen.get(k).set(String(g.id), mins(r.stats));
    const m = mins(r.stats);
    if (m <= 0) return;                              // nought minutes is not "playing for" anybody
    const at = String(g.tipoff_at || '');
    const prev = lastAnywhere.get(p);
    if (!prev || at > prev.at) lastAnywhere.set(p, { at, teamId: String(team) });
  });

  seen.forEach((appearances, k) => {
    const cut = k.indexOf('|');
    const teamId = k.slice(0, cut), playerId = k.slice(cut + 1);
    if (rel.has(k) || rel.has('*|' + playerId)) return;          // released: gone from the report
    const e = entryFor(clubGames.get(teamId) || [], appearances, T);
    if (!e) return;
    /* a player who has turned out for somebody else since is transferred, not missing */
    const last = lastAnywhere.get(playerId);
    if (last && last.teamId !== teamId && last.at > e.lastPlayedAt) return;
    e.teamId = teamId; e.playerId = playerId;
    out.entries.push(e);
  });

  /* the freshest absence first, then the player the club was using most */
  out.entries.sort((a, b) =>
    String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt)) || (b.mpg - a.mpg));
  out.entries.forEach(e => {
    if (!out.byTeam.has(e.teamId)) { out.byTeam.set(e.teamId, []); out.teams.push(e.teamId); }
    out.byTeam.get(e.teamId).push(e);
  });
  return out;
}

/* one club, one player: is he missing, and on what grounds?
   THE JUDGEMENT IS MADE ON THE GAMES BEFORE THE FIRST ONE HE MISSED. Reading it
   off the season averages would let the absence answer the question about
   itself — three weeks out drops a 28-minute regular under any minutes-per-game
   line you care to draw, and the longer somebody is hurt the less hurt they look. */
function entryFor(clubGames, appearances, T) {
  if (!clubGames.length) return null;
  const played = [];                                  // indexes into clubGames with minutes
  const onSheet = [];                                 // indexes with a row of any kind
  clubGames.forEach((g, i) => {
    const m = appearances.get(String(g.id));
    if (m == null) return;
    onSheet.push(i);
    if (m > 0) played.push(i);
  });
  if (!played.length) return null;                    // never played for this club

  const lastAt = played[played.length - 1];
  const missed = clubGames.length - 1 - lastAt;       // club games since, all of them missed
  if (missed < 1) return null;                        // he played the club's last game

  /* what he was, before he stopped */
  const before = played.filter(i => i <= lastAt);
  if (before.length < T.MIN_GP) return null;
  const total = before.reduce((s, i) => s + appearances.get(String(clubGames[i].id)), 0);
  const mpg = total / before.length;
  const lastMin = appearances.get(String(clubGames[lastAt].id));
  const debut = before[0];
  const since = lastAt - debut + 1;                   // club games from his first to his last
  const share = since > 0 ? before.length / since : 0;

  const reason = lastMin >= T.HEAVY_MIN ? 'starter'
    : mpg >= T.ROTATION_MPG ? 'rotation'
    : (share >= T.SHARE && mpg >= T.REGULAR_MPG) ? 'regular' : null;
  if (!reason) return null;

  /* on the sheet with nought minutes in the most recent one is a different fact
     from not being on it at all, and a reader wants to be told which */
  const lastGame = clubGames[clubGames.length - 1];
  const dnp = appearances.get(String(lastGame.id)) === 0;

  return {
    missed, mpg: Math.round(mpg * 10) / 10, gp: before.length,
    lastMin: Math.round(lastMin * 10) / 10,
    lastPlayedAt: String(clubGames[lastAt].tipoff_at || ''),
    lastGameId: String(clubGames[lastAt].id),
    sinceGameId: String(clubGames[lastAt + 1].id),    // the first one he missed
    share: Math.round(share * 100) / 100, since,
    dnp, reason, stale: missed >= T.STALE_GAMES
  };
}

/* the releases, however they arrive: a Set of keys, or the table's own rows.
   A row with no team_id releases the player everywhere ("*|id"), which is what
   a platform administrator striking somebody off means. */
function releasedSet(rel) {
  if (rel instanceof Set) return rel;
  const s = new Set();
  (rel || []).forEach(r => {
    if (typeof r === 'string') { s.add(r); return; }
    if (!r) return;
    const p = r.player_id || r.playerId;
    if (!p) return;
    s.add(key(r.team_id || r.teamId || '*', p));
  });
  return s;
}

/* -------------------------------------------------------- what to call it ---
   One line a reader understands without the table of thresholds above it. */
function line(e, o) {
  const opt = o || {};
  const n = e.missed;
  const what = e.dnp ? 'did not play' : 'out';
  const runs = n === 1 ? 'the last game' : 'the last ' + n + ' games';
  /* A SHARE IS NOT A SENTENCE. "100% of the club's games" is true of a player who has
     turned out twice and says nothing; the two numbers behind it say what he was. */
  const was = e.reason === 'starter'
    ? one(e.lastMin) + ' minutes last time out'
    : e.reason === 'rotation'
      ? one(e.mpg) + ' minutes a game'
      : e.gp + ' of the club’s last ' + (e.since || e.gp) + ', ' + one(e.mpg) + ' minutes a game';
  return what + ' for ' + runs + ' · ' + was + (opt.stale && e.stale ? ' · long-term' : '');
}
const one = v => (v == null || !isFinite(v)) ? '—' : String(Math.round(v * 10) / 10);

/* the entries a game preview should carry for one club: the fresh ones, worst
   first, capped so a preview is a preview and not the whole wire */
function forPreview(rep, teamId, limit) {
  const list = (rep && rep.byTeam && rep.byTeam.get(String(teamId))) || [];
  return list.filter(e => !e.stale)
    .sort((a, b) => (b.mpg - a.mpg) || (a.missed - b.missed))
    .slice(0, Math.max(1, limit || 5));
}

return { report, line, forPreview, releasedSet, entryFor, timeline,
         MIN_GP, HEAVY_MIN, ROTATION_MPG, SHARE, REGULAR_MPG, STALE_GAMES };
}));
