// 0215: THE RECORDS ARE KEPT, NOT WORKED OUT ON EVERY VISIT (docs/performance-audit.md).
//
// On a real Postgres (PGlite; skipped with a note when it is not installed), 0215 loaded on stand-ins for the
// tables it reads and the read policies it mirrors (games, leagues, players and media as the reader sees them;
// player_game_stats' pgs_read through game_rows_public / can_read_game_rows as 0151 has it):
//   * the backfill builds the same records the page used to work out (records.js, the old reads, run here over
//     the same fixture through a stand-in EpinoiaData), for a league's season and across leagues (ALL / MEN'S /
//     WOMEN'S), and the page asks for nothing else when it can (one request);
//   * a game's lines go in only when they reach a list; a record is replaced only when surpassed; a tie is shared
//     and credited to whoever set it first; a list keeps its twelve best (and every line level with the best);
//   * the order games are finalised in does not matter (two finalised at once are applied one after the other
//     under the competition's lock: either order gives the lists a rebuild from nothing gives);
//   * a correction, a revert, a move and a deleted game put the affected lists right, and only those;
//   * a private league's records are not on anybody else's board, and a withheld minor is passed over;
//   * a failure inside the upkeep never stops a finalise.
//
//   node supabase/tests/records-store.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 600))); } };
const M = readFileSync(path.join(here, '..', 'migrations', '0215_records.sql'), 'utf8');
const RJ = readFileSync(path.join(ROOT, 'epinoia', 'records.js'), 'utf8');

/* ------------------------------------------------------------------------- the files (no database) --- */
console.log('the files');
ok('the upkeep is the database\'s: triggers on games and both box-score tables, for every path that finalises',
   /create trigger records_game_ins after insert on public\.games/.test(M) && /create trigger records_game_upd after update of status, competition_id, home_score, away_score/.test(M) &&
   /create trigger records_game_del after delete on public\.games/.test(M) && /'player_game_stats', 'team_game_stats'/.test(M) && /for each statement/.test(M));
ok('everything for a competition happens under its lock, taken in one order', /pg_advisory_xact_lock\(hashtextextended\('epinoia\.records:'/.test(M) &&
   /foreach c in array comps loop perform public\.records_lock\(c\); end loop;/.test(M) && /x is not null order by 1\)/.test(M));
ok('a failure never stops a finalise: it is caught and the competition marked for a rebuild', /exception when others then[\s\S]*?on conflict \(competition_id\) do update set stale = true/.test(M));
ok('the board is read as the reader (security invoker) and the writers are not callable from a browser',
   /records_board[\s\S]*?security invoker/.test(M) && /grant execute on function public\.records_board\(text, text\) to anon, authenticated/.test(M) &&
   ['record_candidates', 'records_rebuild', 'records_prune', 'records_count', 'records_apply_game', 'records_touch', 'records_backfill', 'records_lock']
     .every(f => new RegExp('revoke execute on function public\\.' + f + '\\(').test(M)));
ok('a line is read exactly as its box score is (0151\'s policy on player_game_stats)',
   /create policy record_lines_read[\s\S]*?game_rows_public p where p\.id = record_lines\.game_id\), false\)\s+or public\.can_read_game_rows\(record_lines\.game_id\)/.test(M));
ok('the store never reads the situations line', !/'sit'|->\s*'sit'|stats->sit/.test(M.replace(/--.*$/gm, '')));
ok('records.js asks the board first and keeps the old reads only as its fallback',
   /const b = await board\(D, comps, 'all'\);/.test(RJ) && /const b = await board\(D, null, filter === 'u22' \? 'all' : filter\);/.test(RJ) &&
   /return globalRead\(D, ST, filter, o\);/.test(RJ) && /return b && b\.ready \? b : null;/.test(RJ));

/* ------------------------------------------------------------------------------------ the database --- */
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database part: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.members (user_id uuid, league_id uuid);
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, gender text, visibility text not null default 'public');
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid, name text, starts_on date);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid, name text);
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid, name text, short_name text, slug text, colour text, colour_2 text, logo_path text);
  create table public.media (id uuid primary key default gen_random_uuid(), owner_type text, owner_id uuid, kind text, storage_path text, status text, created_at timestamptz default now());
  create table public.players (id uuid primary key default gen_random_uuid(), slug text, first_name text not null default '', last_name text not null default '',
    photo_url text, photo_media_id uuid, is_minor boolean not null default false, public_consent boolean not null default false);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid, home_team_id uuid not null, away_team_id uuid not null,
    tipoff_at timestamptz, status text not null default 'scheduled', home_score int not null default 0, away_score int not null default 0, finalised_at timestamptz);
  create index on public.games (competition_id);
  create table public.player_game_stats (game_id uuid not null references public.games on delete cascade, player_id text not null, player_uuid uuid,
    team_idx int not null, stats jsonb not null, primary key (game_id, player_id));
  create table public.team_game_stats (game_id uuid not null references public.games on delete cascade, team_idx int not null, stats jsonb not null,
    primary key (game_id, team_idx));
  /* who may see a league: a public one everybody, a private one its members */
  create function public.league_ok(p uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from leagues l where l.id = p and (l.visibility = 'public'
      or exists (select 1 from members m where m.league_id = l.id and m.user_id = auth.uid()))) $$;
  create function public.league_of_game(p uuid) returns uuid language sql stable security definer set search_path = public as $$
    select s.league_id from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id where g.id = p $$;
  /* 0151's fast path (public leagues' finals) and the rule */
  create view public.game_rows_public as
    select g.id from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id join leagues l on l.id = s.league_id
     where g.status = 'final' and l.visibility = 'public';
  create function public.can_read_game_rows(p uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from games g where g.id = p and g.status = 'final' and public.league_ok(public.league_of_game(g.id))) $$;
  alter table leagues enable row level security;      create policy r on leagues for select using (public.league_ok(id));
  alter table seasons enable row level security;      create policy r on seasons for select using (public.league_ok(league_id));
  alter table competitions enable row level security; create policy r on competitions for select using (exists (select 1 from seasons s where s.id = season_id));
  alter table teams enable row level security;        create policy r on teams for select using (public.league_ok(league_id));
  alter table games enable row level security;        create policy r on games for select using (public.league_ok(public.league_of_game(id)));
  alter table players enable row level security;      create policy r on players for select using (not (is_minor and not public_consent));
  alter table media enable row level security;        create policy r on media for select using (status = 'approved');
  alter table player_game_stats enable row level security; create policy r on player_game_stats for select using (public.can_read_game_rows(game_id));
  alter table team_game_stats enable row level security;   create policy r on team_game_stats for select using (public.can_read_game_rows(game_id));
  grant usage on schema public, auth to anon, authenticated;
  grant select on all tables in schema public to anon, authenticated;
`);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

/* --------------------------------------------------------------------------------- the fixture --- */
let seed = 20261002;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const uuid = () => { const h = () => Math.floor(rnd() * 16).toString(16); let s = ''; for (let i = 0; i < 32; i++) s += h(); return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32); };

const F = { leagues: [], seasons: [], comps: [], teams: [], players: [], games: [], pgs: [], tgs: [], media: [] };
const LG = [['alpha', 'Alpha League', null, 'public'], ['beta', 'Beta Women', 'women', 'public'], ['hidden', 'Hidden League', null, 'private']];
let day = 0;
for (const [slug, name, gender, visibility] of LG) {
  const l = { id: uuid(), slug, name, gender, visibility }; F.leagues.push(l);
  const teams = [0, 1, 2, 3].map(i => ({ id: uuid(), league_id: l.id, name: name + ' Club ' + i, short_name: 'C' + i, slug: slug + '-c' + i, colour: '#11223' + i, colour_2: null, logo_path: null }));
  F.teams.push(...teams);
  const roster = new Map(teams.map(t => [t.id, []]));
  teams.forEach((t, ti) => { for (let k = 0; k < 7; k++) {
    const minor = k === 6 && ti % 2 === 0;
    const p = { id: uuid(), slug: t.slug + '-p' + k, first_name: 'P' + k, last_name: t.short_name + slug, photo_url: k === 1 ? 'https://img.example/p.jpg' : (k === 2 ? 'http://insecure/p.jpg' : null),
                photo_media_id: null, is_minor: minor, public_consent: false };
    if (k === 3) { const m = { id: uuid(), owner_type: 'player', owner_id: p.id, kind: 'photo', storage_path: 'players/' + p.id + '/a.webp', status: 'approved' }; F.media.push(m); p.photo_media_id = m.id; }
    F.players.push(p); roster.get(t.id).push(p);
  } });
  for (const [sname, starts] of [['2025', '2025-01-01'], ['2026', '2026-01-01']]) {
    const se = { id: uuid(), league_id: l.id, name: sname, starts_on: starts }; F.seasons.push(se);
    for (const cn of ['regular', 'cup']) {
      const c = { id: uuid(), season_id: se.id, name: cn }; F.comps.push(c);
      for (let gi = 0; gi < 9; gi++) {
        const [h, a] = [ri(0, 3), ri(0, 3)];
        const home = teams[h], away = teams[h === a ? (a + 1) % 4 : a];
        day++;
        const g = { id: uuid(), competition_id: c.id, home_team_id: home.id, away_team_id: away.id,
                    tipoff_at: new Date(Date.UTC(starts.slice(0, 4) === '2025' ? 2025 : 2026, 0, 1 + (gi % 7 === 3 ? 2 : day % 300), 18)).toISOString(),
                    status: 'final', home_score: 0, away_score: 0 };
        F.games.push(g);
        const sideTot = [0, 0];
        [home, away].forEach((t, side) => {
          roster.get(t.id).forEach((p, k) => {
            if (rnd() < 0.15) return;
            const st = { pts: ri(0, 22) + (rnd() < 0.1 ? ri(5, 20) : 0), ast: ri(0, 9), stl: ri(0, 4), blk: ri(0, 3), p3m: ri(0, 5), min: 600000 };
            if (rnd() < 0.9) st.or = ri(0, 5); if (rnd() < 0.9) st.dr = ri(0, 9);
            if (rnd() < 0.05) delete st.blk;
            sideTot[side] += st.pts;
            F.pgs.push({ game_id: g.id, player_id: p.id, player_uuid: p.id, team_idx: side, stats: st });
          });
          if (rnd() < 0.3) F.pgs.push({ game_id: g.id, player_id: t.id + ':' + ri(40, 49), player_uuid: null, team_idx: side, stats: { pts: ri(0, 30), ast: ri(0, 9), or: 1, dr: ri(0, 9), stl: 1, blk: 0, p3m: 2 } });
          if (rnd() < 0.95) F.tgs.push({ game_id: g.id, team_idx: side, stats: { adv: { fg3m: ri(3, 16), ast: ri(8, 28), oreb: ri(4, 16), dreb: ri(18, 34) } } });
        });
        g.home_score = sideTot[0]; g.away_score = sideTot[1];
      }
    }
  }
}
F.media.push({ id: uuid(), owner_type: 'team', owner_id: F.teams[0].id, kind: 'logo', storage_path: 'crests/old.png', status: 'approved', created_at: '2026-01-01T00:00:00Z' });
F.media.push({ id: uuid(), owner_type: 'team', owner_id: F.teams[0].id, kind: 'logo', storage_path: 'crests/new.png', status: 'approved', created_at: '2026-02-01T00:00:00Z' });

/* the last game of Alpha's 2026 regular season is held back, to be finalised after the backfill */
const alpha = F.leagues[0];
const seasonOf = id => F.seasons.find(s => s.id === id);
const compsOf = (l, sname) => F.comps.filter(c => { const s = seasonOf(c.season_id); return s.league_id === l.id && s.name === sname; });
const alphaNow = compsOf(alpha, '2026');
const late = F.games.filter(g => g.competition_id === alphaNow[0].id).slice(-2);
late.forEach(g => { g.status = 'scheduled'; });

async function insert(table, rows, cols) {
  for (const r of rows) {
    const vals = cols.map(c => (c === 'stats' ? JSON.stringify(r[c]) : r[c] === undefined ? null : r[c]));
    await db.query(`insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
  }
}
await insert('leagues', F.leagues, ['id', 'slug', 'name', 'gender', 'visibility']);
await insert('seasons', F.seasons, ['id', 'league_id', 'name', 'starts_on']);
await insert('competitions', F.comps, ['id', 'season_id', 'name']);
await insert('teams', F.teams, ['id', 'league_id', 'name', 'short_name', 'slug', 'colour', 'colour_2', 'logo_path']);
await insert('media', F.media.map(m => Object.assign({ created_at: '2026-01-15T00:00:00Z' }, m)), ['id', 'owner_type', 'owner_id', 'kind', 'storage_path', 'status', 'created_at']);
await insert('players', F.players, ['id', 'slug', 'first_name', 'last_name', 'photo_url', 'photo_media_id', 'is_minor', 'public_consent']);
await insert('games', F.games, ['id', 'competition_id', 'home_team_id', 'away_team_id', 'tipoff_at', 'status', 'home_score', 'away_score']);
await insert('player_game_stats', F.pgs, ['game_id', 'player_id', 'player_uuid', 'team_idx', 'stats']);
await insert('team_game_stats', F.tgs, ['game_id', 'team_idx', 'stats']);

/* ---------------------------------------------------------------- the old reads, over the same rows ---
   What PostgREST answered records.js, as a signed-out reader: only public leagues' rows, sorted and cut as
   asked. Read from the database each time, so a change made below is seen. */
const R = require(path.join(ROOT, 'epinoia', 'records.js'));
const ST = require(path.join(ROOT, 'epinoia', 'stars.js'));
const inOf = s => (s.match(/in\.\(([^)]*)\)/) || [])[1].split(',');
async function anonRows(sql, params) {
  await db.exec(`set role anon; select set_config('test.uid', '', false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const pgOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const numJ = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
const oldD = {
  calls: [],
  async all(qs) { this.calls.push(qs); return this.answer(qs); },
  async get(qs) { this.calls.push(qs); return this.answer(qs); },
  async answer(qs) {
    if (qs.startsWith('rpc/')) throw new Error('404 on /rpc/records_board');
    if (qs.startsWith('games?')) {
      const rows = await anonRows(`select id, competition_id, home_team_id, away_team_id, home_score, away_score,
          to_char(tipoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as tipoff_at from games where status = 'final' and competition_id is not null order by tipoff_at, id`);
      const comps = /competition_id=in\./.test(qs) ? new Set(inOf(qs.slice(qs.indexOf('competition_id=in.')))) : null;
      return rows.filter(g => !comps || comps.has(g.competition_id));
    }
    if (qs.startsWith('seasons?')) {
      const ids = new Set(inOf(qs));
      const rows = await anonRows(`select s.id, s.name, s.league_id, s.starts_on::text, coalesce((select json_agg(json_build_object('id', c.id)) from competitions c where c.season_id = s.id), '[]') as competitions
          from seasons s order by s.starts_on desc nulls last, s.id`);
      return rows.filter(s => ids.has(s.league_id));
    }
    if (qs.startsWith('player_game_stats?')) {
      const key = qs.match(/order=stats->(\w+)\./)[1];
      const n = +qs.match(/limit=(\d+)/)[1];
      const comps = inOf(qs.slice(qs.indexOf('games.competition_id=')));
      const rows = await anonRows(`select s.game_id, s.player_id, s.player_uuid, s.team_idx, s.stats->'or' as v_or, s.stats->'dr' as v_dr, s.stats->$1 as v,
           to_char(g.tipoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as at
           from player_game_stats s join games g on g.id = s.game_id where g.status = 'final' and g.competition_id = any($2::uuid[]) and s.stats ? $1
            and jsonb_typeof(s.stats->$1) <> 'null'`, [key, comps]);
      rows.sort((a, b) => ((numJ(b.v) ?? -Infinity) - (numJ(a.v) ?? -Infinity)) || pgOrder(a.game_id, b.game_id) || pgOrder(a.player_id, b.player_id));
      return rows.slice(0, n).map(r => ({ game_id: r.game_id, player_id: r.player_id, player_uuid: r.player_uuid, team_idx: r.team_idx,
        v_or: r.v_or, v_dr: r.v_dr, v: r.v, games: { tipoff_at: r.at } }));
    }
    if (qs.startsWith('team_game_stats?')) {
      const comps = inOf(qs.slice(qs.indexOf('games.competition_id=')));
      return anonRows(`select t.game_id, t.team_idx, t.stats->'adv'->'pts' as t_pts, t.stats->'adv'->'fg3m' as t_p3m, t.stats->'adv'->'ast' as t_ast,
          t.stats->'adv'->'oreb' as t_oreb, t.stats->'adv'->'dreb' as t_dreb from team_game_stats t join games g on g.id = t.game_id
          where g.status = 'final' and g.competition_id = any($1::uuid[])`, [comps]);
    }
    if (qs.startsWith('players?')) {
      return anonRows(`select p.id, p.photo_url, case when m.id is null then null else json_build_object('storage_path', m.storage_path) end as media
          from players p left join media m on m.id = p.photo_media_id where p.id = any($1::uuid[])`, [inOf(qs)]);
    }
    if (qs.startsWith('teams?') || qs.startsWith('media?')) return [];
    throw new Error('unexpected read ' + qs);
  },
  async playerMeta(ids) {
    const uu = ids.filter(id => /^[0-9a-f-]{36}$/.test(id));
    const rows = await anonRows(`select id, slug, first_name, last_name from players where id = any($1::uuid[])`, [uu]);
    const out = {};
    ids.forEach(id => { if (!uu.includes(id)) out[id] = { name: 'Player', slug: null }; });
    rows.forEach(p => { out[p.id] = { name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Player', slug: p.slug }; });
    return out;
  }
};
const leaguesAnon = async () => anonRows(`select id, slug, name, gender from leagues order by name`);
globalThis.EpinoiaStars = ST;
globalThis.EpinoiaGlobalGames = { leagues: leaguesAnon };
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://db.example', supabaseAnonKey: 'k' };

/* the board, as a signed-out reader (or as `uid`) */
async function boardAs(comps, filter, uid) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('test.uid', '${uid || ''}', false);`);
  try { return (await db.query('select board from public.records_board($1, $2)', [comps ? comps.join(',') : null, filter || 'all'])).rows[0].board; }
  finally { await db.exec(`reset role; select set_config('test.uid', '', false);`); }
}
const newD = {
  calls: [],
  async get(qs) { this.calls.push(qs);
    if (!qs.startsWith('rpc/records_board?')) throw new Error('unexpected read ' + qs);
    const u = new URLSearchParams(qs.slice(qs.indexOf('?') + 1));
    return [{ board: await boardAs(u.get('p_comps') ? u.get('p_comps').split(',') : null, u.get('p_filter')) }];
  },
  async all(qs) { return this.get(qs); }
};
/* a record set as compared: what each card shows */
const shape = d => d ? {
  games: d.games,
  player: d.player.map(r => [r.cat.k, +r.v, r.shared, r.holder.game_id, r.holder.pid, r.teamId, r.oppId, r.side, (r.meta || {}).name, r.photo || null]),
  team: d.team.map(r => [r.cat.k, +r.v, r.shared, r.game.id, r.teamId, r.oppId, r.side, r.pts, r.opp])
} : null;
async function oldLoad(comps) { globalThis.EpinoiaData = oldD; R._reset(); return shape(await R.load({ comps, board: false })); }
async function newLoad(comps) { globalThis.EpinoiaData = newD; R._reset(); newD.calls = []; return shape(await R.load({ comps })); }
async function oldGlobal(filter) { globalThis.EpinoiaData = oldD; R._reset(); try { sessionStorage.clear(); } catch (_) {} const r = await R.global({ filter }); return r && { data: shape(r.data), leagues: r.leagues, lg: r.data.player.concat(r.data.team).map(x => x.league && x.league.slug) }; }
async function newGlobal(filter) { globalThis.EpinoiaData = newD; R._reset(); newD.calls = []; const r = await R.global({ filter }); return r && { data: shape(r.data), leagues: r.leagues, lg: r.data.player.concat(r.data.team).map(x => x.league && x.league.slug), teamsById: r.teamsById }; }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a, b) => { if (!a || !b) return [a, b]; const out = [];
  ['player', 'team'].forEach(k => (a.data || a)[k].forEach((r, i) => { const s = ((b.data || b)[k] || [])[i]; if (JSON.stringify(r) !== JSON.stringify(s)) out.push([r, s]); }));
  return out.length ? out : [a, b]; };

/* ----------------------------------------------------------------------------- the migration --- */
console.log('\nthe migration');
await db.exec(M);
await db.exec(M);    // a push stopped half way can be pushed again
ok('it loads (twice: every statement can be run again)', true);
ok('a browser may read the board and nothing it may write',
   (await one(`select has_function_privilege('anon', 'public.records_board(text, text)', 'execute') as b,
                      has_function_privilege('anon', 'public.records_backfill(int)', 'execute') as f,
                      has_function_privilege('anon', 'public.records_apply_game(uuid, uuid)', 'execute') as a,
                      has_table_privilege('anon', 'public.record_lines', 'insert') as i`)).b === true &&
   (await one(`select has_function_privilege('anon', 'public.records_backfill(int)', 'execute') as f`)).f === false &&
   (await one(`select has_table_privilege('anon', 'public.record_lines', 'insert') as i`)).i === false);

console.log('\nthe backfill');
const alphaComps = alphaNow.map(c => c.id);
{
  const b = await boardAs(alphaComps);
  ok('until the backfill has run the board says it is not ready, and the page works the records out as before',
     b.ready === false && (R._reset(), await R.board(newD, alphaComps, 'all')) === null);
}
let res = await one(`select public.records_backfill(5) as r`);
ok('in batches: at most p_max competitions a call, and what is left', res.r.built === 5 && res.r.left > 0, res.r);
while (res.r.left > 0) res = await one(`select public.records_backfill(5) as r`);
ok('until nothing is left; then the board is ready', res.r.left === 0 && (await boardAs(alphaComps)).ready === true, res.r);
ok('again, it builds nothing', (await one(`select public.records_backfill(5) as r`)).r.built === 0);
const kept = (await one(`select count(*)::int as n, count(distinct competition_id)::int as c from record_lines`));
ok('a hundred-odd small rows a competition at most (eleven lists of twelve, and ties)', kept.n > 0 && kept.n / kept.c < 160, kept);

console.log('\nthe same records as the page worked out');
for (const [l, sname] of [[F.leagues[0], '2026'], [F.leagues[0], '2025'], [F.leagues[1], '2026']]) {
  const comps = compsOf(l, sname).map(c => c.id);
  const [a, b] = [await oldLoad(comps), await newLoad(comps)];
  ok(`${l.name} ${sname}: every player and team record, its holder, tie count, club, name and photograph`, same(a, b) && a.player.length === 6 && a.team.length === 5, diff(a, b));
  ok(`${l.name} ${sname}: in one request`, newD.calls.length === 1, newD.calls);
}
for (const f of ['all', 'men', 'women']) {
  const [a, b] = [await oldGlobal(f), await newGlobal(f)];
  ok(`across leagues, ${f.toUpperCase()}: the same records, leagues and seasons`, a && b && same(a.data, b.data) && a.leagues === b.leagues && same(a.lg, b.lg), diff(a, b));
  ok(`across leagues, ${f.toUpperCase()}: one request, names and clubs included`, newD.calls.length === 1 && Object.keys(b.teamsById).length > 0, newD.calls);
}
{
  const b = await newGlobal('all');
  ok('a club\'s crest is its latest approved upload', b.teamsById[F.teams[0].id] ? /crests\/new\.png/.test(JSON.stringify(b.teamsById[F.teams[0].id])) : true, b.teamsById[F.teams[0].id]);
}

console.log('\nprivate leagues and withheld players');
{
  const hidden = F.leagues[2];
  const hc = compsOf(hidden, '2026').map(c => c.id);
  const anon = await boardAs(hc);
  ok('a private league\'s records are on no signed-out board', anon.games === 0 && anon.player.length === 0 && anon.team.length === 0, anon);
  const all = await boardAs(null);
  ok('nor across leagues', !JSON.stringify(all).includes(hidden.id) && all.leagues === 2, all.leagues);
  const MEMBER = '77777777-7777-7777-7777-777777777777';
  await q(`insert into members values ($1, $2)`, [MEMBER, hidden.id]);
  const mine = await boardAs(hc, 'all', MEMBER);
  ok('its member sees them', mine.games > 0 && mine.player.length > 0, mine.games);
  const kept = await one(`select count(*)::int as n from record_lines where competition_id = any($1::uuid[])`, [hc]);
  ok('(they are kept all the same)', kept.n > 0);
  const minors = F.players.filter(p => p.is_minor).map(p => p.id);
  const allBoards = JSON.stringify([await boardAs(null), await boardAs(alphaComps)]);
  ok('a minor without consent is never named; the record passes to the next line', minors.every(id => !allBoards.includes(id)));
}

/* --------------------------------------------------------------------- the upkeep, game by game --- */
const fromScratch = async () => {
  const before = await q(`select competition_id, kind, cat, game_id, subject, value::text from record_lines order by 1,2,3,4,5`);
  await db.exec(`update record_comps set stale = true`);
  await q(`select public.records_backfill(100)`);
  const after = await q(`select competition_id, kind, cat, game_id, subject, value::text from record_lines order by 1,2,3,4,5`);
  return [before, after];
};
const linesOf = async (comp) => q(`select kind, cat, game_id::text, subject, value::float as v from record_lines where competition_id = $1 order by kind, cat, value desc, game_id, subject`, [comp]);
const c0 = alphaNow[0].id;

console.log('\nfinalising');
{
  const [g1, g2] = late;
  const b0 = await boardAs(alphaComps);
  const pts0 = b0.player.find(r => r.cat === 'pts');
  // g1: one line above the record
  const scorer = F.players.find(p => p.slug === alpha.slug + '-c0-p0');
  await q(`update player_game_stats set stats = jsonb_set(stats, '{pts}', $2::jsonb) where game_id = $1 and player_id = $3`, [g1.id, String(+pts0.v + 9), scorer.id]);
  await q(`insert into player_game_stats (game_id, player_id, player_uuid, team_idx, stats) values ($1, $2, $4::uuid, 0, $3) on conflict do nothing`,
          [g1.id, scorer.id, JSON.stringify({ pts: +pts0.v + 9, ast: 1 }), scorer.id]);
  const linesBefore = await linesOf(c0);
  ok('a game not yet final is on no list', !linesBefore.some(r => r.game_id === g1.id));
  await q(`update games set status = 'final', finalised_at = now() where id = $1`, [g1.id]);
  const b1 = await boardAs(alphaComps);
  const pts1 = b1.player.find(r => r.cat === 'pts');
  ok('a line above the record replaces it when its game is finalised', +pts1.v === +pts0.v + 9 && pts1.game.id === g1.id && pts1.pid === scorer.id, pts1);
  ok('and the count of games moves', b1.games === b0.games + 1, [b0.games, b1.games]);
  const [a, b] = [await oldLoad(alphaComps), await newLoad(alphaComps)];
  ok('the board is still exactly what the page worked out', same(a, b), diff(a, b));

  // g2: everything below the lists
  await q(`update player_game_stats set stats = '{"pts": 1, "ast": 0, "or": 0, "dr": 1, "stl": 0, "blk": 0, "p3m": 0}'::jsonb where game_id = $1`, [g2.id]);
  await q(`update team_game_stats set stats = '{"adv": {"fg3m": 0, "ast": 1, "oreb": 0, "dreb": 1}}'::jsonb where game_id = $1`, [g2.id]);
  await q(`update games set home_score = 2, away_score = 3 where id = $1`, [g2.id]);
  const l1 = await linesOf(c0);
  await q(`update games set status = 'final' where id = $1`, [g2.id]);
  const l2 = await linesOf(c0);
  ok('a game that sets nothing changes nothing', same(l1, l2));
}

console.log('\nties and the list\'s length');
{
  const lines = await linesOf(c0);
  const pts = lines.filter(r => r.kind === 'player' && r.cat === 'pts');
  ok('a player statistic keeps its twelve best (and every line level with the best)', pts.length >= 12 && pts.filter(r => r.v < pts[0].v).length <= 11, pts.length);
  const team = lines.filter(r => r.kind === 'team' && r.cat === 'pts');
  ok('a team statistic keeps the lines level with its best', team.length >= 1 && team.every(r => r.v === team[0].v), team);
  // a tie: shared, and credited to whoever set it first
  const best = await boardAs(alphaComps);
  const rec = best.player.find(r => r.cat === 'pts');
  const other = F.games.find(g => g.competition_id === c0 && g.status === 'final' && g.id !== rec.game.id && g.tipoff_at !== rec.game.tipoff_at.slice(0, 19) + '.000Z');
  const who = F.pgs.find(r => r.game_id === other.id && r.player_uuid && !F.players.find(p => p.id === r.player_uuid).is_minor);
  await q(`update player_game_stats set stats = jsonb_set(stats, '{pts}', $3::jsonb) where game_id = $1 and player_id = $2`, [other.id, who.player_id, String(rec.v)]);
  const tied = (await boardAs(alphaComps)).player.find(r => r.cat === 'pts');
  const first = Date.parse(other.tipoff_at) < Date.parse(rec.game.tipoff_at) ? other.id : rec.game.id;
  ok('a line level with the record shares it, and the record is credited to whoever set it first',
     +tied.v === +rec.v && tied.shared === rec.shared + 1 && tied.game.id === first, [rec, tied, first]);
  ok('(the page would say the same)', same(await oldLoad(alphaComps), await newLoad(alphaComps)));
  // a new line ranked fifth enters, the thirteenth leaves
  const p13 = pts[12] || pts[pts.length - 1];
  const fifth = pts[4].v;
  const g = F.games.filter(x => x.competition_id === c0 && x.status === 'final')[3];
  const line = F.pgs.find(r => r.game_id === g.id && r.player_uuid);
  const had = lines.some(r => r.cat === 'pts' && r.game_id === g.id && r.subject === line.player_id);
  await q(`update player_game_stats set stats = jsonb_set(stats, '{pts}', $3::jsonb) where game_id = $1 and player_id = $2`, [g.id, line.player_id, String(fifth)]);
  const now = (await linesOf(c0)).filter(r => r.kind === 'player' && r.cat === 'pts');
  ok('a line reaching the list goes in where it ranks, and the list keeps its length', had || (now.some(r => r.game_id === g.id && r.subject === line.player_id) &&
     now.filter(r => r.v < now[0].v).length <= 11), [had, now.length]);
  ok('and it is still exactly what the page would work out', same(await oldLoad(alphaComps), await newLoad(alphaComps)));
}

console.log('\nin either order');
{
  /* two games of another competition, finalised one way round and then the other: the same lists, and the
     lists a rebuild from nothing gives (under the lock they are applied one after the other, each seeing the
     other's committed lines, so these are the only two histories two finalises at once can have) */
  const comp = F.comps.find(c => c.id === alphaNow[1].id);
  const two = F.games.filter(g => g.competition_id === comp.id).slice(0, 2);
  const run = async order => {
    for (const g of two) await q(`update games set status = 'scheduled' where id = $1`, [g.id]);
    for (const g of order) await q(`update games set status = 'final' where id = $1`, [g.id]);
    return linesOf(comp.id);
  };
  const ab = await run(two), ba = await run(two.slice().reverse());
  const [, scratch] = await fromScratch();
  ok('A then B and B then A keep the same lists', same(ab, ba));
  ok('and they are what a rebuild from nothing gives', same(ba, await linesOf(comp.id)) && scratch.length > 0);
}

console.log('\ncorrections');
{
  const best = await boardAs(alphaComps);
  const tp = best.team.find(r => r.cat === 'pts');
  // the team record's game re-scored below the next best, which is on no list (a team list keeps one value)
  const before = await linesOf(c0);
  const g = F.games.find(x => x.id === tp.game.id);
  const homeSide = tp.side === 0;
  await q(`update games set ${homeSide ? 'home_score' : 'away_score'} = 1 where id = $1`, [g.id]);
  const after = await boardAs(alphaComps);
  const tp2 = after.team.find(r => r.cat === 'pts');
  ok('a corrected score that held the team record gives it to the next best, from the whole competition', tp2.game.id !== g.id || tp2.side !== tp.side, [tp, tp2]);
  ok('the same as the page would work out', same(await oldLoad(alphaComps), await newLoad(alphaComps)));
  const after2 = await linesOf(c0);
  const changed = new Set(after2.filter(r => !before.some(s => same(s, r))).map(r => r.kind + ':' + r.cat));
  ok('only that statistic\'s list was rebuilt', [...changed].every(k => k === 'team:pts' || k === 'team:margin'), [...changed]);

  // the player record's line lowered: the next best takes it
  const pr = after.player.find(r => r.cat === 'pts');
  await q(`update player_game_stats set stats = jsonb_set(stats, '{pts}', '0'::jsonb) where game_id = $1 and coalesce(player_uuid::text, player_id) = $2`, [pr.game.id, pr.pid]);
  const pr2 = (await boardAs(alphaComps)).player.find(r => r.cat === 'pts');
  ok('a corrected line that held a record gives it to the next best', !(pr2.game.id === pr.game.id && pr2.pid === pr.pid) && +pr2.v <= +pr.v, [pr, pr2]);

  // reverted (finalise-game's revert: lines deleted, the game live again), then finalised again
  const rec = (await boardAs(alphaComps)).player.find(r => r.cat === 'reb');
  const saved = await q(`select player_id, player_uuid, team_idx, stats from player_game_stats where game_id = $1`, [rec.game.id]);
  await q(`delete from player_game_stats where game_id = $1`, [rec.game.id]);
  await q(`update games set status = 'live', finalised_at = null where id = $1`, [rec.game.id]);
  const gone = (await boardAs(alphaComps)).player.find(r => r.cat === 'reb');
  ok('a reverted game leaves every list it was on', gone.game.id !== rec.game.id && !(await linesOf(c0)).some(r => r.game_id === rec.game.id));
  await q(`update games set status = 'finalising' where id = $1`, [rec.game.id]);
  for (const r of saved) await q(`insert into player_game_stats (game_id, player_id, player_uuid, team_idx, stats) values ($1, $2, $3, $4, $5)`, [rec.game.id, r.player_id, r.player_uuid, r.team_idx, JSON.stringify(r.stats)]);
  ok('a finalising game\'s lines are on no list yet', !(await linesOf(c0)).some(r => r.game_id === rec.game.id));
  await q(`update games set status = 'final' where id = $1`, [rec.game.id]);
  const back = (await boardAs(alphaComps)).player.find(r => r.cat === 'reb');
  ok('finalised again, it holds the record again', back.game.id === rec.game.id && +back.v === +rec.v, [rec, back]);

  // moved to the other competition, then deleted
  const other = alphaNow[1].id;
  await q(`update games set competition_id = $2 where id = $1`, [rec.game.id, other]);
  ok('a game moved to another competition leaves the first one\'s lists and joins the other\'s',
     !(await linesOf(c0)).some(r => r.game_id === rec.game.id) && (await linesOf(other)).some(r => r.game_id === rec.game.id));
  ok('and the counts follow it', (await one(`select games from record_comps where competition_id = $1`, [other])).games ===
     (await one(`select count(*)::int as n from games where competition_id = $1 and status = 'final'`, [other])).n);
  await q(`delete from games where id = $1`, [rec.game.id]);
  ok('a deleted game leaves every list', !(await q(`select 1 from record_lines where game_id = $1`, [rec.game.id])).length);
  ok('everything kept is what a rebuild from nothing gives', (([a, b]) => same(a, b))(await fromScratch()));
  for (const comps of [alphaComps, compsOf(F.leagues[1], '2026').map(c => c.id)]) {
    const [a, b] = [await oldLoad(comps), await newLoad(comps)];
    ok('and what the page would work out', same(a, b), diff(a, b));
  }
}

console.log('\na failure never stops a finalise');
{
  const g = await one(`select id from games where competition_id = $1 and status = 'final' order by id limit 1`, [c0]);
  /* the upkeep breaks half way (its count of games refused), inside a real update of a final game */
  await db.exec(`create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
    create trigger boom before update on public.record_comps for each row when (new.stale = false) execute function public.boom();`);
  let err = null;
  try { await q(`update games set home_score = home_score + 1 where id = $1`, [g.id]); } catch (e) { err = e.message; }
  ok('the update goes through', err === null, err);
  ok('the competition is marked to be rebuilt', (await one(`select stale from record_comps where competition_id = $1`, [c0])).stale === true);
  await db.exec(`drop trigger boom on public.record_comps; drop function public.boom();`);
  await q(`update games set home_score = home_score - 1 where id = $1`, [g.id]);
  ok('and is, whole, at its next touch', (await one(`select stale from record_comps where competition_id = $1`, [c0])).stale === false &&
     same(await oldLoad(alphaComps), await newLoad(alphaComps)));
}

console.log('\nthe page\'s requests');
{
  /* the real data.js, with fetch counted: HOME's Global records and a league's Records are each one request */
  const D = require(path.join(ROOT, 'epinoia', 'data.js'));
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    const u = new URL(url);
    if (!/\/rest\/v1\/rpc\/records_board$/.test(u.pathname)) return { ok: false, status: 404, headers: new Map(), json: async () => ({}) };
    const p = u.searchParams;
    const b = await boardAs(p.get('p_comps') ? p.get('p_comps').split(',') : null, p.get('p_filter'));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => [{ board: b }] };
  };
  globalThis.EpinoiaData = D; R._reset();
  const g = await R.global({ filter: 'all' });
  ok('Global records: at most two data requests (one)', g && asked.length <= 2 && asked.length === 1, asked);
  asked.length = 0;
  const l = await R.load({ comps: alphaComps });
  ok('a league\'s Records: at most two data requests (one)', l && asked.length <= 2 && asked.length === 1, asked);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
