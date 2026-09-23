-- ============================================================================
-- 0150 — MAKE YOUR VOICE HEARD: THE WEEKLY FANS' VOTE.
--
-- Every week a league played, its front page asks the fans two questions about
-- the week just gone:
--
--   WHO WAS THE BEST LAST WEEK?        the fifteen best players of the week by box
--                                      plus/minus, ranked 1st, 2nd and 3rd;
--   WHO HAD THE BEST PERFORMANCE?      every club that won a game that week,
--                                      one pick, and it may be skipped.
--
-- The winners go above the Stars on the league page, every week's winners have
-- their own page, and the league's admins see every tally.
--
-- THE WEEK IS THE LEAGUE'S OWN. Monday to Sunday on the clock of the league's
-- country (fanvote_zone; London when it has none). The round about that week
-- opens the next Monday at 06:00 local, so Sunday night's games have been
-- finalised, and closes when that Thursday ends, so the winners are up before
-- the weekend's games (Louie's choice, 2026-09-23). A week with no finished game
-- has no round.
--
-- WHO IS ON THE BALLOT IS DECIDED BY THE SERVER, NOT BY A BROWSER. The fifteen
-- players are the Stars podium's own rule (epinoia/stars.js WINDOWS 'week': a
-- game and twenty minutes, best BPM first) run over the week, and BPM is the
-- same file the pages run. That is JavaScript, and rewriting it in plpgsql is
-- how two implementations start to disagree (supabase/functions/_shared/
-- awards.ts says why at length). So the Edge Function `fanvote` computes the
-- candidates with the shared code and hands them to fanvote_open, which only
-- the service role may call and which checks everything it is given: the week
-- must be the one due, every player must exist and not be withheld (0049), and
-- the list is cut to fifteen. The page asks the function to open a round only when
-- fanvote_state says one is due; a round already opened is never re-opened.
--
-- ANYONE MAY VOTE, ONCE PER BROWSER (Louie's choice). A signed-out ballot is
-- keyed to a random key the browser keeps, stored here only as its md5, the
-- way the Team of the Year ballot works (0047, epinoia/toty.js). A signed-in
-- fan's ballot is keyed to their account, and it absorbs the ballot the same
-- browser cast before they signed in, so signing in is never a second vote.
-- That stops the accidental double vote and the idle refresh, not a determined
-- person with a second browser, and the console says so by showing how many
-- ballots came from accounts. New anonymous ballots from one network address
-- are capped at 30 in ten minutes (fanvote_throttle, 0127's pattern).
--
-- THE SCORE. 3 points for a 1st, 2 for a 2nd, 1 for a 3rd. Ties go to more
-- 1sts, then more 2nds, then the better BPM rank on the ballot. A club is one
-- vote per ballot, ties to the better-placed card (more wins that week, then
-- the bigger margin). A round with no ballots has no winner.
--
-- PRIVATE AND MEMBERS-ONLY LEAGUES (0118, 0139, 0147). Every read and every vote
-- asks league_visible first, so a private league's vote is its invited fans'
-- and a members-only league's is its members'. A league that turns the section
-- off in Appearance (set_league_appearance now knows 'fanvote') has no rounds
-- opened and no panel shown.
--
-- NOTHING IS READABLE THROUGH THE TABLES except the rounds' dates (for the
-- rail's probe). Candidates, ballots and tallies come out only through the
-- functions below, which is what keeps a ballot anonymous and a withheld
-- player's name off the page.
--
-- Contract: docs/fanvote.md. Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE FAN'S SWITCH. On by default, so nobody is opted out by a migration.
-- "Don't show this again" on the panel turns it off for an account; the profile
-- turns it back on. A signed-out browser keeps the same answer in localStorage.
-- ----------------------------------------------------------------------------
alter table public.fan_prefs add column if not exists want_fanvote boolean not null default true;
comment on column public.fan_prefs.want_fanvote is
  'Open the weekly fans'' vote panel on league pages (0150). The panel can still be opened by hand.';

-- ----------------------------------------------------------------------------
-- 2. THE TABLES.
-- ----------------------------------------------------------------------------
create table if not exists public.fanvote_rounds (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues on delete cascade,
  week_start  date not null,                 -- the Monday of the week voted on, on the league's clock
  time_zone   text not null,
  starts_at   timestamptz not null,          -- that Monday 00:00 local: games from here...
  ends_at     timestamptz not null,          -- ...to the next Monday 00:00 local
  opens_at    timestamptz not null,          -- that next Monday 06:00 local
  closes_at   timestamptz not null,          -- the end of that Thursday, local
  games       int not null default 0,
  created_at  timestamptz not null default now(),
  unique (league_id, week_start),
  check (starts_at < ends_at and opens_at < closes_at)
);
create index if not exists fanvote_rounds_league on public.fanvote_rounds (league_id, closes_at desc);

/* No foreign key to players or teams, deliberately: player merges delete rows,
   and a vote about last week must never be the thing that stops one. A candidate
   whose player has gone is simply not drawn. */
create table if not exists public.fanvote_candidates (
  round_id    uuid not null references public.fanvote_rounds on delete cascade,
  kind        text not null check (kind in ('player', 'team')),
  subject_id  uuid not null,
  team_id     uuid,                          -- a player's club that week
  rank        int not null check (rank > 0), -- players: BPM order; clubs: wins, then margin
  line        jsonb not null default '{}'::jsonb check (jsonb_typeof(line) = 'object'),
  primary key (round_id, kind, subject_id)
);

create table if not exists public.fanvote_ballots (
  round_id     uuid not null references public.fanvote_rounds on delete cascade,
  voter        text not null check (voter ~ '^(u|k):'),   -- u:<account> or k:<md5 of the browser key>
  user_id      uuid references auth.users on delete set null,
  first_id     uuid,
  second_id    uuid,
  third_id     uuid,
  team_id      uuid,
  team_skipped boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (round_id, voter)
);

create table if not exists public.fanvote_calls (
  ip           text not null,
  window_start timestamptz not null,
  calls        int not null default 0,
  primary key (ip, window_start)
);

alter table public.fanvote_rounds     enable row level security;
alter table public.fanvote_candidates enable row level security;
alter table public.fanvote_ballots    enable row level security;
alter table public.fanvote_calls      enable row level security;

drop policy if exists fanvote_rounds_read on public.fanvote_rounds;
create policy fanvote_rounds_read on public.fanvote_rounds for select to anon, authenticated
  using (public.league_visible(league_id));

revoke all on table public.fanvote_rounds, public.fanvote_candidates,
                    public.fanvote_ballots, public.fanvote_calls from public, anon, authenticated;
grant select on table public.fanvote_rounds to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. THE LEAGUE'S CLOCK AND ITS WEEK.
-- ----------------------------------------------------------------------------
/* A country's clock, for the country code on leagues (0053). One zone per
   country: where a country has several, its biggest basketball city's. Checked
   through notify_valid_tz (0145), so a zone this Postgres does not know falls
   back to London rather than breaking a page. */
create or replace function public.fanvote_zone(p_country text)
returns text language sql stable set search_path = public as $$
  select public.notify_valid_tz(case upper(btrim(coalesce(p_country, '')))
    when 'GB' then 'Europe/London'      when 'IE' then 'Europe/Dublin'
    when 'FR' then 'Europe/Paris'       when 'ES' then 'Europe/Madrid'
    when 'PT' then 'Europe/Lisbon'      when 'DE' then 'Europe/Berlin'
    when 'IT' then 'Europe/Rome'        when 'NL' then 'Europe/Amsterdam'
    when 'BE' then 'Europe/Brussels'    when 'LU' then 'Europe/Luxembourg'
    when 'CH' then 'Europe/Zurich'      when 'AT' then 'Europe/Vienna'
    when 'DK' then 'Europe/Copenhagen'  when 'NO' then 'Europe/Oslo'
    when 'SE' then 'Europe/Stockholm'   when 'FI' then 'Europe/Helsinki'
    when 'IS' then 'Atlantic/Reykjavik' when 'EE' then 'Europe/Tallinn'
    when 'LV' then 'Europe/Riga'        when 'LT' then 'Europe/Vilnius'
    when 'PL' then 'Europe/Warsaw'      when 'CZ' then 'Europe/Prague'
    when 'SK' then 'Europe/Bratislava'  when 'HU' then 'Europe/Budapest'
    when 'SI' then 'Europe/Ljubljana'   when 'HR' then 'Europe/Zagreb'
    when 'BA' then 'Europe/Sarajevo'    when 'RS' then 'Europe/Belgrade'
    when 'ME' then 'Europe/Podgorica'   when 'MK' then 'Europe/Skopje'
    when 'AL' then 'Europe/Tirane'      when 'XK' then 'Europe/Belgrade'
    when 'BG' then 'Europe/Sofia'       when 'RO' then 'Europe/Bucharest'
    when 'GR' then 'Europe/Athens'      when 'CY' then 'Asia/Nicosia'
    when 'TR' then 'Europe/Istanbul'    when 'UA' then 'Europe/Kiev'
    when 'IL' then 'Asia/Jerusalem'     when 'JP' then 'Asia/Tokyo'
    when 'KR' then 'Asia/Seoul'         when 'CN' then 'Asia/Shanghai'
    when 'TW' then 'Asia/Taipei'        when 'PH' then 'Asia/Manila'
    when 'AU' then 'Australia/Sydney'   when 'NZ' then 'Pacific/Auckland'
    when 'CA' then 'America/Toronto'    when 'US' then 'America/New_York'
    when 'MX' then 'America/Mexico_City' when 'BR' then 'America/Sao_Paulo'
    when 'AR' then 'America/Argentina/Buenos_Aires'
    else 'Europe/London' end);
$$;

/* The round about the last full week before p_at, on the league's clock: the
   week's Monday, the games' span, and when the vote opens and closes. DST-safe:
   every instant is a local wall time converted once. */
create or replace function public.fanvote_window(p_league uuid, p_at timestamptz default now())
returns table (week_start date, time_zone text, starts_at timestamptz, ends_at timestamptz,
               opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  with z as (select public.fanvote_zone(l.country) as tz from leagues l where l.id = p_league),
       m as (select z.tz, date_trunc('week', p_at at time zone z.tz)::date as monday from z)
  select m.monday - 7,
         m.tz,
         (m.monday - 7)::timestamp at time zone m.tz,
         m.monday::timestamp at time zone m.tz,
         (m.monday::timestamp + interval '6 hours') at time zone m.tz,
         (m.monday::timestamp + interval '4 days') at time zone m.tz
    from m;
$$;

/* The ballot's key: an account, or the md5 of the browser's own random key. A
   key shorter than eight characters is not one (toty.js makes 36). */
create or replace function public.fanvote_key(p_voter text)
returns text language sql immutable set search_path = public as $$
  select case when char_length(btrim(coalesce(p_voter, ''))) between 8 and 200
              then 'k:' || md5(btrim(p_voter)) end;
$$;

create or replace function public.fanvote_voter(p_voter text)
returns text language sql stable set search_path = public as $$
  select case when auth.uid() is not null then 'u:' || auth.uid()::text
              else public.fanvote_key(p_voter) end;
$$;

-- ----------------------------------------------------------------------------
-- 4. OPENING A ROUND (the service role, from the fanvote Edge Function).
-- ----------------------------------------------------------------------------
/* Is a round due for this league right now? The week's window must be open, the
   league must want the vote, no round may exist yet, the league must have
   finished a game that week, and nothing that week may still be live or being
   finalised -- for six hours; after that a game stuck on the scorer's table does
   not hold the whole week's vote hostage. */
create or replace function public.fanvote_due(p_league uuid, p_at timestamptz default now())
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(w) || jsonb_build_object('league_id', p_league)
    from public.fanvote_window(p_league, p_at) w
    join leagues l on l.id = p_league
   where p_at >= w.opens_at and p_at < w.closes_at
     and coalesce((l.sections ->> 'fanvote')::boolean, true)
     and not exists (select 1 from fanvote_rounds r
                      where r.league_id = p_league and r.week_start = w.week_start)
     and exists (select 1 from games g
                   join competitions c on c.id = g.competition_id
                   join seasons s on s.id = c.season_id
                  where s.league_id = p_league and g.status = 'final'
                    and g.tipoff_at >= w.starts_at and g.tipoff_at < w.ends_at)
     and (p_at >= w.opens_at + interval '6 hours'
          or not exists (select 1 from games g
                           join competitions c on c.id = g.competition_id
                           join seasons s on s.id = c.season_id
                          where s.league_id = p_league and g.status in ('live', 'finalising')
                            and g.tipoff_at >= w.starts_at and g.tipoff_at < w.ends_at));
$$;

/* The round and its cards. p_players: [{id, team_id, line}] best first;
   p_teams: [{id, line}] in the order the cards are laid out. Everything is
   checked, nothing is trusted: a bad entry is dropped, a withheld player is
   dropped, the players are cut to fifteen. Idempotent: if the round exists already
   (two pages asked at once) its id comes back and its cards are left alone. */
create or replace function public.fanvote_open(p_league uuid, p_week_start date,
                                               p_players jsonb, p_teams jsonb,
                                               p_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = public as $$
declare
  w       record;
  e       record;
  v_round uuid;
  v_games int;
  v_id    uuid;
  v_team  uuid;
  v_n     int := 0;
  v_t     int := 0;
  re_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into w from public.fanvote_window(p_league, p_at);
  if w.week_start is null then
    raise exception 'there is no such league' using errcode = '22023';
  end if;
  if p_week_start is distinct from w.week_start then
    raise exception 'the round due is the week of % and not %', w.week_start, p_week_start
      using errcode = '22023';
  end if;
  if p_at < w.opens_at or p_at >= w.closes_at then
    raise exception 'the vote on the week of % is not open', w.week_start using errcode = '22023';
  end if;

  select count(*) into v_games
    from games g
    join competitions c on c.id = g.competition_id
    join seasons s on s.id = c.season_id
   where s.league_id = p_league and g.status = 'final'
     and g.tipoff_at >= w.starts_at and g.tipoff_at < w.ends_at;
  if v_games = 0 then
    raise exception 'the league finished no game in the week of %', w.week_start using errcode = '22023';
  end if;

  insert into fanvote_rounds (league_id, week_start, time_zone, starts_at, ends_at, opens_at, closes_at, games)
  values (p_league, w.week_start, w.time_zone, w.starts_at, w.ends_at, w.opens_at, w.closes_at, v_games)
  on conflict (league_id, week_start) do nothing
  returning id into v_round;
  if v_round is null then
    select r.id into v_round from fanvote_rounds r
     where r.league_id = p_league and r.week_start = w.week_start;
    return v_round;
  end if;

  for e in
    select x.value as v
      from jsonb_array_elements(case when jsonb_typeof(p_players) = 'array' then p_players else '[]'::jsonb end)
           with ordinality as x(value, ord)
     order by x.ord
  loop
    exit when v_n >= 15;
    continue when jsonb_typeof(e.v) <> 'object' or coalesce(e.v ->> 'id', '') !~* re_uuid;
    v_id := (e.v ->> 'id')::uuid;
    continue when not exists (select 1 from players p
                               where p.id = v_id and not public.player_withheld(p.is_minor, p.public_consent));
    continue when exists (select 1 from fanvote_candidates c
                           where c.round_id = v_round and c.kind = 'player' and c.subject_id = v_id);
    v_team := case when coalesce(e.v ->> 'team_id', '') ~* re_uuid then (e.v ->> 'team_id')::uuid end;
    v_n := v_n + 1;
    insert into fanvote_candidates (round_id, kind, subject_id, team_id, rank, line)
    values (v_round, 'player', v_id, v_team, v_n,
            case when jsonb_typeof(e.v -> 'line') = 'object' then e.v -> 'line' else '{}'::jsonb end);
  end loop;

  for e in
    select x.value as v
      from jsonb_array_elements(case when jsonb_typeof(p_teams) = 'array' then p_teams else '[]'::jsonb end)
           with ordinality as x(value, ord)
     order by x.ord
  loop
    exit when v_t >= 32;
    continue when jsonb_typeof(e.v) <> 'object' or coalesce(e.v ->> 'id', '') !~* re_uuid;
    v_id := (e.v ->> 'id')::uuid;
    continue when not exists (select 1 from teams t where t.id = v_id);
    continue when exists (select 1 from fanvote_candidates c
                           where c.round_id = v_round and c.kind = 'team' and c.subject_id = v_id);
    v_t := v_t + 1;
    insert into fanvote_candidates (round_id, kind, subject_id, team_id, rank, line)
    values (v_round, 'team', v_id, v_id, v_t,
            case when jsonb_typeof(e.v -> 'line') = 'object' then e.v -> 'line' else '{}'::jsonb end);
  end loop;

  if v_n = 0 and v_t = 0 then
    delete from fanvote_rounds where id = v_round;
    return null;
  end if;
  return v_round;
end $$;

-- ----------------------------------------------------------------------------
-- 5. READING A ROUND.
-- ----------------------------------------------------------------------------
create or replace function public.fanvote_team_json(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'slug', t.slug,
                            'colour', t.colour, 'colour_2', t.colour_2, 'logo_path', t.logo_path)
    from teams t where t.id = p_team;
$$;

/* the cards: players best first (a withheld player is never drawn, even if consent
   was withdrawn after the round opened), clubs in their order */
create or replace function public.fanvote_round_json(p_round uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'round_id', r.id, 'week_start', r.week_start, 'time_zone', r.time_zone,
    'starts_at', r.starts_at, 'ends_at', r.ends_at, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
    'games', r.games,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'slug', p.slug,
               'name', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
               'rank', c.rank, 'line', c.line, 'team', public.fanvote_team_json(c.team_id))
             order by c.rank)
        from fanvote_candidates c
        join players p on p.id = c.subject_id
       where c.round_id = r.id and c.kind = 'player'
         and not public.player_withheld(p.is_minor, p.public_consent)), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(public.fanvote_team_json(c.subject_id)
                       || jsonb_build_object('rank', c.rank, 'line', c.line)
             order by c.rank)
        from fanvote_candidates c
       where c.round_id = r.id and c.kind = 'team'
         and exists (select 1 from teams t where t.id = c.subject_id)), '[]'::jsonb))
  from fanvote_rounds r where r.id = p_round;
$$;

/* THE COUNT. 3-2-1 for players (ties: 1sts, 2nds, the ballot's BPM order), one
   vote a ballot for clubs (ties: the card's order). */
create or replace function public.fanvote_tally(p_round uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (select * from fanvote_ballots x where x.round_id = p_round),
  pc as (
    select c.subject_id as id, c.rank,
           (select count(*) from b where b.first_id  = c.subject_id)::int as firsts,
           (select count(*) from b where b.second_id = c.subject_id)::int as seconds,
           (select count(*) from b where b.third_id  = c.subject_id)::int as thirds
      from fanvote_candidates c where c.round_id = p_round and c.kind = 'player'),
  tc as (
    select c.subject_id as id, c.rank,
           (select count(*) from b where b.team_id = c.subject_id)::int as votes
      from fanvote_candidates c where c.round_id = p_round and c.kind = 'team')
  select jsonb_build_object(
    'ballots',        (select count(*) from b),
    'accounts',       (select count(*) from b where b.voter like 'u:%'),
    'player_ballots', (select count(*) from b where b.first_id is not null),
    'team_ballots',   (select count(*) from b where b.team_id is not null),
    'skipped',        (select count(*) from b where b.team_skipped),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', pc.id, 'rank', pc.rank, 'firsts', pc.firsts,
                                          'seconds', pc.seconds, 'thirds', pc.thirds,
                                          'points', 3 * pc.firsts + 2 * pc.seconds + pc.thirds)
             order by 3 * pc.firsts + 2 * pc.seconds + pc.thirds desc, pc.firsts desc, pc.seconds desc, pc.rank)
        from pc), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', tc.id, 'rank', tc.rank, 'votes', tc.votes)
             order by tc.votes desc, tc.rank)
        from tc), '[]'::jsonb));
$$;

/* One finished round as the page shows it: its dates, how many voted, and the
   winners with the top three of each. Names come from the rows as they are now,
   and a player withheld now is named as nobody. */
create or replace function public.fanvote_result_json(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r   fanvote_rounds%rowtype;
  t   jsonb;
  v_p jsonb := '[]'::jsonb;
  v_t jsonb := '[]'::jsonb;
  x   jsonb;
  v_pb int;
  v_tb int;
begin
  select * into r from fanvote_rounds where id = p_round;
  if not found then return null; end if;
  t := public.fanvote_tally(p_round);
  v_pb := (t ->> 'player_ballots')::int;
  v_tb := (t ->> 'team_ballots')::int;

  for x in select value from jsonb_array_elements(t -> 'players') loop
    exit when jsonb_array_length(v_p) >= 3;
    continue when (x ->> 'points')::int = 0;
    v_p := v_p || jsonb_build_array((
      select jsonb_build_object(
               'id', p.id, 'slug', p.slug,
               'name', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
               'team', public.fanvote_team_json(c.team_id), 'line', c.line,
               'points', (x ->> 'points')::int, 'firsts', (x ->> 'firsts')::int,
               'share', round(100.0 * (x ->> 'points')::int / nullif(3 * v_pb, 0)))
        from players p
        join fanvote_candidates c on c.round_id = p_round and c.kind = 'player' and c.subject_id = p.id
       where p.id = (x ->> 'id')::uuid and not public.player_withheld(p.is_minor, p.public_consent)));
  end loop;
  v_p := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_p) e where e <> 'null'::jsonb), '[]'::jsonb);

  for x in select value from jsonb_array_elements(t -> 'teams') loop
    exit when jsonb_array_length(v_t) >= 3;
    continue when (x ->> 'votes')::int = 0;
    v_t := v_t || jsonb_build_array(public.fanvote_team_json((x ->> 'id')::uuid)
             || jsonb_build_object('votes', (x ->> 'votes')::int,
                                   'line', (select c.line from fanvote_candidates c
                                             where c.round_id = p_round and c.kind = 'team'
                                               and c.subject_id = (x ->> 'id')::uuid),
                                   'share', round(100.0 * (x ->> 'votes')::int / nullif(v_tb, 0))));
  end loop;
  v_t := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_t) e where e <> 'null'::jsonb), '[]'::jsonb);

  return jsonb_build_object(
    'round_id', r.id, 'week_start', r.week_start, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'closes_at', r.closes_at, 'games', r.games,
    'ballots', (t ->> 'ballots')::int, 'player_ballots', v_pb, 'team_ballots', v_tb,
    'player', v_p -> 0, 'team', v_t -> 0, 'players', v_p, 'teams', v_t);
end $$;

-- ----------------------------------------------------------------------------
-- 6. THE PAGE'S THREE CALLS (anyone).
-- ----------------------------------------------------------------------------
/* Everything the league page needs in one answer:
     open    the round being voted on now, its cards, and this voter's ballot
     due     a round should be open and is not yet (the page then asks the
             fanvote function to open it, and asks again)
     last    the latest finished round that somebody voted in, with its winners
     prompt  a signed-in fan's switch (null when signed out: the browser decides)
   null for a league this caller may not see; {off:true} when the league has
   turned the vote off. */
create or replace function public.fanvote_state(p_league uuid, p_voter text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_on     boolean;
  r        fanvote_rounds%rowtype;
  b        fanvote_ballots%rowtype;
  v_voter  text := public.fanvote_voter(p_voter);
  v_key    text := public.fanvote_key(p_voter);
  v_open   jsonb;
  v_last   jsonb;
  v_prompt boolean;
begin
  if p_league is null or not public.league_visible(p_league) then
    return null;
  end if;
  select coalesce((l.sections ->> 'fanvote')::boolean, true) into v_on from leagues l where l.id = p_league;
  if v_on is null then
    return null;
  end if;
  if not v_on then
    return jsonb_build_object('league', p_league, 'off', true);
  end if;

  select * into r from fanvote_rounds x
   where x.league_id = p_league and x.opens_at <= now() and now() < x.closes_at
   order by x.opens_at desc limit 1;
  if r.id is not null then
    if v_voter is not null then
      select * into b from fanvote_ballots y where y.round_id = r.id and y.voter = v_voter;
    end if;
    /* this browser's signed-out ballot, before the account had one of its own */
    if b.round_id is null and auth.uid() is not null and v_key is not null then
      select * into b from fanvote_ballots y where y.round_id = r.id and y.voter = v_key;
    end if;
    v_open := public.fanvote_round_json(r.id) || jsonb_build_object('ballot',
      case when b.round_id is null then null
           else jsonb_build_object(
                  'players', to_jsonb(array_remove(array[b.first_id, b.second_id, b.third_id], null)),
                  'team', b.team_id, 'skipped', b.team_skipped) end);
  end if;

  select public.fanvote_result_json(x.id) into v_last
    from fanvote_rounds x
   where x.league_id = p_league and x.closes_at <= now()
     and exists (select 1 from fanvote_ballots y where y.round_id = x.id)
   order by x.closes_at desc limit 1;

  if auth.uid() is not null then
    select p.want_fanvote into v_prompt from fan_prefs p where p.user_id = auth.uid();
    v_prompt := coalesce(v_prompt, true);
  end if;

  return jsonb_build_object('league', p_league, 'open', v_open,
                            'due', public.fanvote_due(p_league) is not null,
                            'last', v_last, 'prompt', v_prompt, 'server_now', now());
end $$;

/* at most 30 new signed-out ballots in ten minutes from one network address */
create or replace function public.fanvote_throttle()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip    text;
  v_win   timestamptz := date_trunc('hour', now()) + make_interval(mins => (extract(minute from now())::int / 10) * 10);
  v_calls int;
begin
  v_ip := coalesce(btrim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)), '');
  if v_ip = '' then
    v_ip := coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip', 'unknown');
  end if;
  v_ip := encode(extensions.digest(v_ip, 'sha256'), 'hex');
  insert into fanvote_calls (ip, window_start, calls) values (v_ip, v_win, 1)
  on conflict (ip, window_start) do update set calls = fanvote_calls.calls + 1
  returning calls into v_calls;
  if v_calls > 30 then
    raise exception 'too many votes from this network; try again in a few minutes' using errcode = 'PT429';
  end if;
  delete from fanvote_calls c where c.window_start < now() - interval '1 hour';
end $$;

/* One ballot a voter a round, changeable until the round closes. p_players is
   the 1st, 2nd and 3rd in that order (fewer only when fewer players are on the
   ballot); null leaves the players as they were. p_team picks the club,
   p_skip_team records "skip", and leaving both out leaves the club as it was. */
create or replace function public.fanvote_cast(p_round uuid, p_voter text, p_players uuid[] default null,
                                               p_team uuid default null, p_skip_team boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r        fanvote_rounds%rowtype;
  v_voter  text := public.fanvote_voter(p_voter);
  v_key    text := public.fanvote_key(p_voter);
  v_have   int;
  v_need   int;
  v_prev   fanvote_ballots%rowtype;
  v_cur    fanvote_ballots%rowtype;
  v_first  uuid;
  v_second uuid;
  v_third  uuid;
  v_team   uuid;
  v_skip   boolean;
begin
  select * into r from fanvote_rounds where id = p_round;
  if r.id is null or not public.league_visible(r.league_id)
     or not coalesce((select (l.sections ->> 'fanvote')::boolean from leagues l where l.id = r.league_id), true) then
    raise exception 'there is no such vote' using errcode = '22023';
  end if;
  if now() < r.opens_at or now() >= r.closes_at then
    raise exception 'the vote on the week of % is not open' , r.week_start using errcode = '22023';
  end if;
  if v_voter is null then
    raise exception 'a vote needs a voter key' using errcode = '22023';
  end if;
  if p_players is null and p_team is null and not coalesce(p_skip_team, false) then
    raise exception 'there is nothing in this vote' using errcode = '22023';
  end if;

  if p_players is not null then
    select count(*) into v_have from fanvote_candidates c where c.round_id = r.id and c.kind = 'player';
    v_need := least(3, v_have);
    if v_need = 0 or coalesce(cardinality(p_players), 0) <> v_need
       or (select count(distinct x) from unnest(p_players) x where x is not null) <> v_need then
      raise exception 'pick % different players with the best first', v_need using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_players) x
                where not exists (select 1 from fanvote_candidates c
                                   where c.round_id = r.id and c.kind = 'player' and c.subject_id = x)) then
      raise exception 'that player is not on this ballot' using errcode = '22023';
    end if;
  end if;
  if p_team is not null and not exists (select 1 from fanvote_candidates c
                                         where c.round_id = r.id and c.kind = 'team' and c.subject_id = p_team) then
    raise exception 'that club is not on this ballot' using errcode = '22023';
  end if;

  /* A signed-in fan's ballot absorbs the one this browser cast before they signed
     in: one person, one ballot, whichever way round they did it. */
  if auth.uid() is not null and v_key is not null then
    delete from fanvote_ballots y where y.round_id = r.id and y.voter = v_key returning * into v_prev;
  end if;
  select * into v_cur from fanvote_ballots y where y.round_id = r.id and y.voter = v_voter for update;
  if v_cur.round_id is null and v_prev.round_id is null and auth.uid() is null then
    perform public.fanvote_throttle();
  end if;

  if p_players is not null then
    v_first := p_players[1]; v_second := p_players[2]; v_third := p_players[3];
  else
    v_first  := coalesce(v_cur.first_id,  v_prev.first_id);
    v_second := coalesce(v_cur.second_id, v_prev.second_id);
    v_third  := coalesce(v_cur.third_id,  v_prev.third_id);
  end if;
  if p_team is not null then
    v_team := p_team; v_skip := false;
  elsif coalesce(p_skip_team, false) then
    v_team := null; v_skip := true;
  else
    v_team := coalesce(v_cur.team_id, v_prev.team_id);
    v_skip := coalesce(v_cur.team_skipped, v_prev.team_skipped, false);
  end if;

  insert into fanvote_ballots as y (round_id, voter, user_id, first_id, second_id, third_id, team_id, team_skipped)
  values (r.id, v_voter, auth.uid(), v_first, v_second, v_third, v_team, v_skip)
  on conflict (round_id, voter) do update
    set first_id = excluded.first_id, second_id = excluded.second_id, third_id = excluded.third_id,
        team_id = excluded.team_id, team_skipped = excluded.team_skipped,
        user_id = coalesce(excluded.user_id, y.user_id), updated_at = now();

  return jsonb_build_object('ok', true, 'ballot', jsonb_build_object(
    'players', to_jsonb(array_remove(array[v_first, v_second, v_third], null)),
    'team', v_team, 'skipped', v_skip));
end $$;

/* Finished rounds, newest first, as fanvote_result_json draws them: the league
   page takes the first with a winner, the weekly-winners page takes them all. */
create or replace function public.fanvote_winners(p_league uuid, p_limit int default 12)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_league is null or not public.league_visible(p_league) then null
         else coalesce((
           select jsonb_agg(public.fanvote_result_json(x.id) order by x.week_start desc)
             from (select r.id, r.week_start from fanvote_rounds r
                    where r.league_id = p_league and r.closes_at <= now()
                    order by r.week_start desc
                    limit greatest(1, least(coalesce(p_limit, 12), 104))) x), '[]'::jsonb) end;
$$;

-- ----------------------------------------------------------------------------
-- 7. THE CONSOLE (the league's admins): every round's tally, and the season's.
-- ----------------------------------------------------------------------------
create or replace function public.fanvote_admin(p_league uuid, p_season text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_seasons text[];
  v_season  text;
  v_rounds  jsonb;
  v_players jsonb;
  v_teams   jsonb;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  select coalesce(array_agg(s order by s desc), '{}'::text[]) into v_seasons
    from (select distinct public.season_label(r.week_start) as s from fanvote_rounds r where r.league_id = p_league) x;
  v_season := coalesce(nullif(btrim(p_season), ''), v_seasons[1], public.season_label(current_date));

  with rs as (
    select r.* from fanvote_rounds r
     where r.league_id = p_league and public.season_label(r.week_start) = v_season),
  per as (
    select rs.id, rs.week_start, rs.starts_at, rs.ends_at, rs.opens_at, rs.closes_at, rs.games,
           public.fanvote_tally(rs.id) as t
      from rs)
  select coalesce(jsonb_agg(jsonb_build_object(
           'round_id', per.id, 'week_start', per.week_start, 'starts_at', per.starts_at, 'ends_at', per.ends_at,
           'opens_at', per.opens_at, 'closes_at', per.closes_at, 'games', per.games,
           'status', case when now() < per.opens_at then 'upcoming'
                          when now() < per.closes_at then 'open' else 'closed' end,
           'ballots', per.t -> 'ballots', 'accounts', per.t -> 'accounts',
           'player_ballots', per.t -> 'player_ballots', 'team_ballots', per.t -> 'team_ballots',
           'skipped', per.t -> 'skipped',
           'players', (select coalesce(jsonb_agg(e.v || jsonb_build_object(
                                 'name', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
                                 'team', (select t.name from fanvote_candidates c join teams t on t.id = c.team_id
                                           where c.round_id = per.id and c.kind = 'player' and c.subject_id = p.id))
                               order by e.o), '[]'::jsonb)
                         from jsonb_array_elements(per.t -> 'players') with ordinality as e(v, o)
                         left join players p on p.id = (e.v ->> 'id')::uuid),
           'teams', (select coalesce(jsonb_agg(e.v || jsonb_build_object('name', t.name) order by e.o), '[]'::jsonb)
                       from jsonb_array_elements(per.t -> 'teams') with ordinality as e(v, o)
                       left join teams t on t.id = (e.v ->> 'id')::uuid))
         order by per.week_start desc), '[]'::jsonb)
    into v_rounds
    from per;

  /* the season's totals: points and places summed over every round, and a weekly
     win for each finished round a player or club topped */
  with rs as (
    select r.* from fanvote_rounds r
     where r.league_id = p_league and public.season_label(r.week_start) = v_season),
  b as (select y.* from fanvote_ballots y join rs on rs.id = y.round_id),
  pr as (
    select c.round_id, c.subject_id as id, c.rank,
           count(*) filter (where b.first_id  = c.subject_id)::int as f,
           count(*) filter (where b.second_id = c.subject_id)::int as s,
           count(*) filter (where b.third_id  = c.subject_id)::int as t
      from fanvote_candidates c join rs on rs.id = c.round_id
      left join b on b.round_id = c.round_id
     where c.kind = 'player'
     group by c.round_id, c.subject_id, c.rank),
  pw as (
    select distinct on (pr.round_id) pr.round_id, pr.id
      from pr join rs on rs.id = pr.round_id
     where rs.closes_at <= now() and 3 * pr.f + 2 * pr.s + pr.t > 0
     order by pr.round_id, 3 * pr.f + 2 * pr.s + pr.t desc, pr.f desc, pr.s desc, pr.rank)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
           'points', x.points, 'firsts', x.f, 'seconds', x.s, 'thirds', x.t,
           'weekly_wins', x.wins, 'rounds', x.rounds)
         order by x.wins desc, x.points desc, x.f desc), '[]'::jsonb)
    into v_players
    from (select pr.id, sum(3 * pr.f + 2 * pr.s + pr.t)::int as points, sum(pr.f)::int as f,
                 sum(pr.s)::int as s, sum(pr.t)::int as t, count(*)::int as rounds,
                 (select count(*) from pw where pw.id = pr.id)::int as wins
            from pr group by pr.id) x
    left join players p on p.id = x.id;

  with rs as (
    select r.* from fanvote_rounds r
     where r.league_id = p_league and public.season_label(r.week_start) = v_season),
  b as (select y.* from fanvote_ballots y join rs on rs.id = y.round_id),
  tr as (
    select c.round_id, c.subject_id as id, c.rank,
           count(*) filter (where b.team_id = c.subject_id)::int as v
      from fanvote_candidates c join rs on rs.id = c.round_id
      left join b on b.round_id = c.round_id
     where c.kind = 'team'
     group by c.round_id, c.subject_id, c.rank),
  tw as (
    select distinct on (tr.round_id) tr.round_id, tr.id
      from tr join rs on rs.id = tr.round_id
     where rs.closes_at <= now() and tr.v > 0
     order by tr.round_id, tr.v desc, tr.rank)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', t.name, 'votes', x.votes,
                                               'weekly_wins', x.wins, 'rounds', x.rounds)
         order by x.wins desc, x.votes desc), '[]'::jsonb)
    into v_teams
    from (select tr.id, sum(tr.v)::int as votes, count(*)::int as rounds,
                 (select count(*) from tw where tw.id = tr.id)::int as wins
            from tr group by tr.id) x
    left join teams t on t.id = x.id;

  return jsonb_build_object('season', v_season, 'seasons', to_jsonb(v_seasons),
                            'rounds', v_rounds, 'players', v_players, 'teams', v_teams);
end $$;

-- ----------------------------------------------------------------------------
-- 8. THE FAN'S SWITCH REACHES set_fan_prefs (latest: 0145), and 'fanvote' is a
-- section a league may turn off (set_league_appearance, latest: 0053). Each is
-- its predecessor plus lines tagged -- 0150.
-- ----------------------------------------------------------------------------
create or replace function public.set_fan_prefs(p jsonb)
returns public.fan_prefs language plpgsql security invoker set search_path = public as $$
declare r public.fan_prefs;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update fan_prefs set
    theme              = coalesce(p->>'theme', theme),
    colour             = coalesce(p->>'colour', colour),
    fav_team_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_team_ids') x), fav_team_ids),
    fav_player_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_player_ids') x), fav_player_ids),
    fav_game_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_game_ids') x), fav_game_ids),
    fav_league_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_league_ids') x), fav_league_ids),
    notify_inapp       = coalesce((p->>'notify_inapp')::boolean, notify_inapp),
    notify_email       = coalesce((p->>'notify_email')::boolean, notify_email),
    notify_push        = coalesce((p->>'notify_push')::boolean, notify_push),
    want_results       = coalesce((p->>'want_results')::boolean, want_results),
    want_players       = coalesce((p->>'want_players')::boolean, want_players),
    want_fixtures      = coalesce((p->>'want_fixtures')::boolean, want_fixtures),
    want_announcements = coalesce((p->>'want_announcements')::boolean, want_announcements),
    want_fixture_2d    = coalesce((p->>'want_fixture_2d')::boolean, want_fixture_2d),
    want_fixture_2h    = coalesce((p->>'want_fixture_2h')::boolean, want_fixture_2h),
    want_lineups       = coalesce((p->>'want_lineups')::boolean, want_lineups),
    want_player_games  = coalesce((p->>'want_player_games')::boolean, want_player_games),
    want_halftime      = coalesce((p->>'want_halftime')::boolean, want_halftime),
    want_fanvote       = coalesce((p->>'want_fanvote')::boolean, want_fanvote),         -- 0150
    time_zone          = case when nullif(btrim(coalesce(p->>'time_zone', '')), '') is not null
                               then public.notify_valid_tz(p->>'time_zone') else time_zone end,
    updated_at         = now()
  where user_id = auth.uid()
  returning * into r;

  -- an empty array is a real instruction, and array_agg over nothing is null
  if p ? 'fav_team_ids' and jsonb_array_length(p->'fav_team_ids') = 0 then
    update fan_prefs set fav_team_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_player_ids' and jsonb_array_length(p->'fav_player_ids') = 0 then
    update fan_prefs set fav_player_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_game_ids' and jsonb_array_length(p->'fav_game_ids') = 0 then
    update fan_prefs set fav_game_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_league_ids' and jsonb_array_length(p->'fav_league_ids') = 0 then
    update fan_prefs set fav_league_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  return r;
end $$;

create or replace function public.set_league_appearance(
  p_league uuid,
  p_country text default null,
  p_sections jsonb default null,
  p_nav jsonb default null,
  p_theme jsonb default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  k text; v text;
  ok_sections text[] := array['news','clubs','toty','stars','games','season',
                              'merch','socials','takepart'];
  ok_nav text[] := array['fixtures','statistics','wowy','table','news',
                         'score','portal','admin'];
  ok_theme text[] := array['bg','panel','ink','rail','rail_ink','accent'];
  clean_sections jsonb := '{}'::jsonb;
  clean_nav jsonb := '{}'::jsonb;
  clean_theme jsonb := '{}'::jsonb;
begin
  ok_sections := ok_sections || array['fanvote'];                                 -- 0150
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  if p_sections is not null then
    for k in select jsonb_object_keys(p_sections) loop
      if k = any(ok_sections) then
        clean_sections := clean_sections ||
          jsonb_build_object(k, coalesce((p_sections->>k)::boolean, true));
      end if;
    end loop;
  end if;

  if p_nav is not null then
    for k in select jsonb_object_keys(p_nav) loop
      if k = any(ok_nav) then
        clean_nav := clean_nav || jsonb_build_object(k, coalesce((p_nav->>k)::boolean, true));
      end if;
    end loop;
  end if;

  if p_theme is not null then
    for k in select jsonb_object_keys(p_theme) loop
      v := trim(coalesce(p_theme->>k, ''));
      if k = any(ok_theme) and v <> '' then
        if v !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'colours are six-digit hex, like #0a1a13 — got "%"', v
            using errcode = '22023';
        end if;
        clean_theme := clean_theme || jsonb_build_object(k, lower(v));
      end if;
    end loop;
  end if;

  update leagues set
    country  = case when p_country is null then country
                    when p_country = ''    then null
                    else upper(trim(p_country)) end,
    sections = case when p_sections is null then sections else clean_sections end,
    nav      = case when p_nav      is null then nav      else clean_nav end,
    theme    = case when p_theme    is null then theme    else clean_theme end
  where id = p_league;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_appearance', 'league', p_league::text,
          jsonb_build_object('country', p_country, 'sections', clean_sections,
                             'nav', clean_nav, 'theme', clean_theme));
  return 'saved';
end; $$;

-- ----------------------------------------------------------------------------
-- 9. GRANTS. Browsers get the three page calls and (signed in) the console;
-- the Edge Function the two that open a round; every helper is internal.
-- ----------------------------------------------------------------------------
revoke all on function public.fanvote_zone(text) from public, anon, authenticated;
revoke all on function public.fanvote_window(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fanvote_key(text) from public, anon, authenticated;
revoke all on function public.fanvote_voter(text) from public, anon, authenticated;
revoke all on function public.fanvote_due(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fanvote_open(uuid, date, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fanvote_team_json(uuid) from public, anon, authenticated;
revoke all on function public.fanvote_round_json(uuid) from public, anon, authenticated;
revoke all on function public.fanvote_tally(uuid) from public, anon, authenticated;
revoke all on function public.fanvote_result_json(uuid) from public, anon, authenticated;
revoke all on function public.fanvote_throttle() from public, anon, authenticated;
revoke all on function public.fanvote_state(uuid, text) from public;
revoke all on function public.fanvote_cast(uuid, text, uuid[], uuid, boolean) from public;
revoke all on function public.fanvote_winners(uuid, int) from public;
revoke all on function public.fanvote_admin(uuid, text) from public, anon;
grant execute on function public.fanvote_state(uuid, text) to anon, authenticated, service_role;
grant execute on function public.fanvote_cast(uuid, text, uuid[], uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.fanvote_winners(uuid, int) to anon, authenticated, service_role;
grant execute on function public.fanvote_admin(uuid, text) to authenticated, service_role;
grant execute on function public.fanvote_due(uuid, timestamptz) to service_role;
grant execute on function public.fanvote_open(uuid, date, jsonb, jsonb, timestamptz) to service_role;

alter function public.fanvote_zone(text) owner to postgres;
alter function public.fanvote_window(uuid, timestamptz) owner to postgres;
alter function public.fanvote_key(text) owner to postgres;
alter function public.fanvote_voter(text) owner to postgres;
alter function public.fanvote_due(uuid, timestamptz) owner to postgres;
alter function public.fanvote_open(uuid, date, jsonb, jsonb, timestamptz) owner to postgres;
alter function public.fanvote_team_json(uuid) owner to postgres;
alter function public.fanvote_round_json(uuid) owner to postgres;
alter function public.fanvote_tally(uuid) owner to postgres;
alter function public.fanvote_result_json(uuid) owner to postgres;
alter function public.fanvote_throttle() owner to postgres;
alter function public.fanvote_state(uuid, text) owner to postgres;
alter function public.fanvote_cast(uuid, text, uuid[], uuid, boolean) owner to postgres;
alter function public.fanvote_winners(uuid, int) owner to postgres;
alter function public.fanvote_admin(uuid, text) owner to postgres;
alter function public.set_league_appearance(uuid, text, jsonb, jsonb, jsonb) owner to postgres;

-- ============================================================================
-- SELF-TEST. One block, always ended by a private code (P0150) its own handler
-- swallows, so every row, role, claim and setting it touches is rolled back; any
-- other error fails the migration. It asserts only about what it seeds, and it
-- runs at any hour of any day: the round is opened AS OF a moment inside its
-- window (fanvote_open's p_at, which only the service role has), and then its
-- window is moved round now() to vote in it and past now() to count it.
--
-- Seeded: a public league in London (GB) with four clubs, a player per club
-- plus a minor with no consent, two finished games in the last full week, and
-- accounts for a fan, a stranger, a guest, the league's admin.
-- ============================================================================
do $test$
declare
  who     text := current_user || ' (session ' || session_user || ')';
  orig    text := current_user;
  lg uuid; se uuid; cp uuid;
  ta uuid; tb uuid; tc uuid; td uuid;
  pa uuid; pb uuid; pc uuid; pd uuid; pk uuid;
  u_fan uuid; u_out uuid; u_guest uuid; u_admin uuid;
  w       record;
  v_at    timestamptz;
  v_round uuid;
  v_r2    uuid;
  v_week2 date;
  lg2 uuid; se2 uuid; cp2 uuid; t2a uuid; t2b uuid; v_pid uuid; v_cap uuid; v_live uuid;
  j       jsonb;
  n       int;
  i       int;
  v_err   text;
  key_a   text := 't150-browser-a-0000000001';
  key_b   text := 't150-browser-b-0000000002';
  key_c   text := 't150-browser-c-0000000003';
  key_d   text := 't150-browser-d-0000000004';
begin
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '{}', true);
    execute format('set local role %I', orig);

    -- ============================================================ seeded as the owner
    insert into leagues (slug, name, country) values ('zz-t150-league', 'T150 League', 'GB') returning id into lg;
    insert into seasons (league_id, name) values (lg, '0150') returning id into se;
    insert into competitions (season_id, name) values (se, 'T150 League') returning id into cp;
    insert into teams (league_id, slug, name) values (lg, 'zz-t150-hawks', 'T150 Hawks') returning id into ta;
    insert into teams (league_id, slug, name) values (lg, 'zz-t150-owls',  'T150 Owls')  returning id into tb;
    insert into teams (league_id, slug, name) values (lg, 'zz-t150-wrens', 'T150 Wrens') returning id into tc;
    insert into teams (league_id, slug, name) values (lg, 'zz-t150-kites', 'T150 Kites') returning id into td;
    insert into players (slug, first_name, last_name) values ('zz-t150-a', 'Ada', 'Ash')   returning id into pa;
    insert into players (slug, first_name, last_name) values ('zz-t150-b', 'Bo', 'Birch')  returning id into pb;
    insert into players (slug, first_name, last_name) values ('zz-t150-c', 'Cy', 'Cedar') returning id into pc;
    insert into players (slug, first_name, last_name) values ('zz-t150-d', 'Di', 'Dogwood') returning id into pd;
    insert into players (slug, first_name, last_name, is_minor, public_consent)
      values ('zz-t150-kid', 'Kit', 'Young', true, false) returning id into pk;

    select * into w from public.fanvote_window(lg, now());
    if w.week_start is null or extract(isodow from w.week_start) <> 1 then
      raise exception '0150: the week does not start on a Monday (%)', w.week_start;
    end if;
    if w.opens_at <> ((w.week_start + 7)::timestamp + interval '6 hours') at time zone 'Europe/London'
       or w.closes_at <> ((w.week_start + 11)::timestamp) at time zone 'Europe/London' then
      raise exception '0150: the window is not Monday 06:00 to the end of Thursday in London (% to %)', w.opens_at, w.closes_at;
    end if;
    v_at := w.opens_at + interval '7 hours';          -- Monday 13:00 of the voting week

    -- two finished games in the week, a Wednesday: Hawks beat Owls, Wrens beat Kites
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp, ta, tb, w.starts_at + interval '2 days 19 hours', 'final', 80, 70),
             (cp, tc, td, w.starts_at + interval '2 days 20 hours', 'final', 90, 60);

    -- 1. due only inside the window, and only with games
    if public.fanvote_due(lg, v_at) is null then
      raise exception '0150: a round is not due on the Monday after a week with games';
    end if;
    if public.fanvote_due(lg, w.opens_at - interval '1 minute') is not null then
      raise exception '0150: a round was due before Monday 06:00';
    end if;
    if public.fanvote_due(lg, w.closes_at) is not null then
      raise exception '0150: a round was due after Thursday ended';
    end if;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp, tb, td, w.starts_at + interval '6 days 20 hours', 'live') returning id into v_live;
    if public.fanvote_due(lg, w.opens_at + interval '1 hour') is not null then
      raise exception '0150: a round was due while a game of the week was still live';
    end if;
    if public.fanvote_due(lg, v_at) is null then
      raise exception '0150: a game stuck live held the round past six hours';
    end if;
    delete from games where id = v_live;

    -- 2. opened with a withheld minor, a made-up id and a duplicate in the list: all dropped
    v_round := public.fanvote_open(lg, w.week_start,
      jsonb_build_array(
        jsonb_build_object('id', pa, 'team_id', ta, 'line', jsonb_build_object('bpm', 9.1, 'gp', 1)),
        jsonb_build_object('id', pk, 'team_id', ta, 'line', jsonb_build_object('bpm', 8.0)),
        jsonb_build_object('id', gen_random_uuid(), 'team_id', ta),
        jsonb_build_object('id', pb, 'team_id', tb, 'line', jsonb_build_object('bpm', 6.2)),
        jsonb_build_object('id', pa, 'team_id', ta),
        jsonb_build_object('id', pc, 'team_id', tc, 'line', jsonb_build_object('bpm', 5.0)),
        jsonb_build_object('id', pd, 'team_id', td, 'line', jsonb_build_object('bpm', 1.5)),
        '"not an object"'::jsonb),
      jsonb_build_array(jsonb_build_object('id', tc, 'line', jsonb_build_object('wins', 1, 'diff', 30)),
                        jsonb_build_object('id', ta, 'line', jsonb_build_object('wins', 1, 'diff', 10)),
                        jsonb_build_object('id', gen_random_uuid())),
      v_at);
    if v_round is null then raise exception '0150: fanvote_open opened nothing'; end if;
    select count(*) into n from fanvote_candidates where round_id = v_round and kind = 'player';
    if n <> 4 then raise exception '0150: expected 4 player cards with the minor and the stranger and the repeat dropped but got %', n; end if;
    if exists (select 1 from fanvote_candidates where round_id = v_round and subject_id = pk) then
      raise exception '0150: a withheld minor is on the ballot';
    end if;
    if (select rank from fanvote_candidates where round_id = v_round and subject_id = pb) is distinct from 2 then
      raise exception '0150: the ranks are not renumbered in order';
    end if;
    select count(*) into n from fanvote_candidates where round_id = v_round and kind = 'team';
    if n <> 2 then raise exception '0150: expected 2 club cards, got %', n; end if;
    if public.fanvote_open(lg, w.week_start, '[]'::jsonb, '[]'::jsonb, v_at) is distinct from v_round then
      raise exception '0150: opening the same round twice did not give back the same round';
    end if;
    select count(*) into n from fanvote_candidates where round_id = v_round;
    if n <> 6 then raise exception '0150: opening it again changed its cards (% now)', n; end if;
    if public.fanvote_due(lg, v_at) is not null then
      raise exception '0150: a round is still due once it exists';
    end if;
    begin
      perform public.fanvote_open(lg, w.week_start - 7, '[]'::jsonb, '[]'::jsonb, v_at);
      raise exception '0150: a round for another week was opened';
    exception when sqlstate '22023' then null;
    end;

    -- 2b. the ballot holds fifteen players, not one more: seventeen offered on a league of its own
    insert into leagues (slug, name, country) values ('zz-t150-cap', 'T150 Cap', 'GB') returning id into lg2;
    insert into seasons (league_id, name) values (lg2, '0150') returning id into se2;
    insert into competitions (season_id, name) values (se2, 'T150 Cap') returning id into cp2;
    insert into teams (league_id, slug, name) values (lg2, 'zz-t150-cap-larks', 'T150 Larks') returning id into t2a;
    insert into teams (league_id, slug, name) values (lg2, 'zz-t150-cap-rooks', 'T150 Rooks') returning id into t2b;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp2, t2a, t2b, w.starts_at + interval '3 days 19 hours', 'final', 70, 60);
    j := '[]'::jsonb;
    for i in 1 .. 17 loop
      insert into players (slug, first_name, last_name) values ('zz-t150-cap-' || i, 'Cap', 'Player ' || i)
        returning id into v_pid;
      j := j || jsonb_build_array(jsonb_build_object('id', v_pid, 'team_id', t2a));
    end loop;
    v_cap := public.fanvote_open(lg2, w.week_start, j, jsonb_build_array(jsonb_build_object('id', t2a)), v_at);
    select count(*) into n from fanvote_candidates where round_id = v_cap and kind = 'player';
    if n <> 15 then raise exception '0150: the ballot held % players where fifteen is the most', n; end if;
    if (select max(rank) from fanvote_candidates where round_id = v_cap and kind = 'player') is distinct from 15 then
      raise exception '0150: the fifteen are not ranked 1 to 15';
    end if;

    -- the people
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, '', now(), now(), now()
      from (values (gen_random_uuid(), 't150-fan@example.invalid'), (gen_random_uuid(), 't150-out@example.invalid'),
                   (gen_random_uuid(), 't150-guest@example.invalid'), (gen_random_uuid(), 't150-admin@example.invalid'))
           as x(id, email);
    select id into u_fan   from auth.users where email = 't150-fan@example.invalid';
    select id into u_out   from auth.users where email = 't150-out@example.invalid';
    select id into u_guest from auth.users where email = 't150-guest@example.invalid';
    select id into u_admin from auth.users where email = 't150-admin@example.invalid';
    insert into memberships (user_id, role, scope_type, scope_id) values (u_admin, 'league_admin', 'league', lg);
    insert into league_guests (league_id, user_id) values (lg, u_guest);

    -- 3. voting: the round is moved round now()
    update fanvote_rounds set opens_at = now() - interval '1 hour', closes_at = now() + interval '1 hour' where id = v_round;

    set local role anon;
    j := public.fanvote_state(lg, key_a);
    if j -> 'open' is null or jsonb_array_length(j -> 'open' -> 'players') is distinct from 4
       or jsonb_array_length(j -> 'open' -> 'teams') is distinct from 2
       or (j -> 'open' -> 'ballot') is distinct from 'null'::jsonb then
      raise exception '0150: signed out, the open round reads wrong: %', j;
    end if;
    if (j -> 'open' -> 'players' -> 0 ->> 'name') is distinct from 'Ada Ash'
       or (j -> 'open' -> 'players' -> 0 -> 'team' ->> 'name') is distinct from 'T150 Hawks' then
      raise exception '0150: the first card is not Ada Ash of T150 Hawks: %', j -> 'open' -> 'players' -> 0;
    end if;
    if (j -> 'prompt') is distinct from 'null'::jsonb or coalesce((j ->> 'due')::boolean, true) then
      raise exception '0150: signed out there is no account switch and nothing due: %', j;
    end if;

    j := public.fanvote_cast(v_round, key_a, array[pa, pb, pc], ta);
    j := public.fanvote_cast(v_round, key_b, array[pb, pa, pc], ta);
    j := public.fanvote_cast(v_round, key_c, array[pa, pc, pb], null, true);
    j := public.fanvote_cast(v_round, key_d, array[pc, pb, pa]);          -- this browser, before signing in
    if (j -> 'ballot' ->> 'team') is not null then raise exception '0150: a players-only ballot picked a club'; end if;
    j := public.fanvote_cast(v_round, key_d, null, tc);                    -- ...and its club, later
    if (j -> 'ballot' -> 'players') is distinct from to_jsonb(array[pc, pb, pa]) then
      raise exception '0150: adding the club lost the players already picked: %', j;
    end if;
    j := public.fanvote_state(lg, key_a);
    if (j -> 'open' -> 'ballot' -> 'players') is distinct from to_jsonb(array[pa, pb, pc])
       or (j -> 'open' -> 'ballot' ->> 'team')::uuid is distinct from ta then
      raise exception '0150: a browser does not see its own ballot: %', j -> 'open' -> 'ballot';
    end if;
    if (j -> 'last') is distinct from 'null'::jsonb or jsonb_array_length(public.fanvote_winners(lg)) is distinct from 0 then
      raise exception '0150: a round still open already shows winners: %', public.fanvote_winners(lg);
    end if;

    -- 4. what is refused
    foreach v_err in array array['dup', 'stranger', 'two', 'club', 'nokey', 'empty'] loop
      begin
        case v_err
          when 'dup'      then perform public.fanvote_cast(v_round, key_a, array[pa, pa, pb]);
          when 'stranger' then perform public.fanvote_cast(v_round, key_a, array[pa, pb, pk]);
          when 'two'      then perform public.fanvote_cast(v_round, key_a, array[pa, pb]);
          when 'club'     then perform public.fanvote_cast(v_round, key_a, null, tb);
          when 'nokey'    then perform public.fanvote_cast(v_round, 'short', array[pa, pb, pc]);
          else                 perform public.fanvote_cast(v_round, key_a);
        end case;
        raise exception '0150: a bad ballot (%) was accepted', v_err;
      exception when sqlstate '22023' then null;
      end;
    end loop;
    execute format('set local role %I', orig);

    -- 5. signed in: the account's ballot absorbs this browser's signed-out one
    perform set_config('request.jwt.claims', json_build_object('sub', u_fan, 'role', 'authenticated')::text, true);
    set local role authenticated;
    j := public.fanvote_state(lg, key_d);
    if (j -> 'open' -> 'ballot' -> 'players') is distinct from to_jsonb(array[pc, pb, pa])
       or (j ->> 'prompt')::boolean is not true then
      raise exception '0150: signed in this browser''s earlier ballot or the switch is missing: %', j;
    end if;
    j := public.fanvote_cast(v_round, key_d, array[pa, pb, pc]);
    if (j -> 'ballot' ->> 'team')::uuid is distinct from tc then
      raise exception '0150: the absorbed ballot lost its club: %', j;
    end if;
    perform public.set_fan_prefs(jsonb_build_object('want_fanvote', false));
    j := public.fanvote_state(lg, key_d);
    if (j ->> 'prompt')::boolean is not false then
      raise exception '0150: "don''t show this again" did not reach fanvote_state: %', j ->> 'prompt';
    end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from fanvote_ballots where round_id = v_round;
    if n <> 4 then raise exception '0150: signing in made a second ballot (% ballots where 4 were expected)', n; end if;
    if not exists (select 1 from fanvote_ballots where round_id = v_round and voter = 'u:' || u_fan and user_id = u_fan) then
      raise exception '0150: the signed-in ballot is not keyed to the account';
    end if;

    -- 6. the count: Ada 3+2+3+3 = 11, Bo 2+3+1+2 = 8, Cy 1+1+2+1 = 5; Hawks 2, Wrens 1
    j := public.fanvote_tally(v_round);
    if (j -> 'players' -> 0 ->> 'id')::uuid is distinct from pa
       or (j -> 'players' -> 0 ->> 'points')::int is distinct from 11
       or (j -> 'players' -> 1 ->> 'points')::int is distinct from 8
       or (j -> 'players' -> 2 ->> 'points')::int is distinct from 5
       or (j -> 'teams' -> 0 ->> 'id')::uuid is distinct from ta
       or (j -> 'teams' -> 0 ->> 'votes')::int is distinct from 2
       or (j ->> 'ballots')::int is distinct from 4 or (j ->> 'accounts')::int is distinct from 1
       or (j ->> 'skipped')::int is distinct from 1 then
      raise exception '0150: the tally is wrong: %', j;
    end if;

    -- 7. the throttle: 30 new signed-out ballots from one address in ten minutes, not 31
    perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.148')::text, true);
    set local role anon;
    for i in 1 .. 30 loop
      perform public.fanvote_cast(v_round, 't150-flood-' || lpad(i::text, 8, '0'), array[pd, pc, pb]);
    end loop;
    begin
      perform public.fanvote_cast(v_round, 't150-flood-00000031', array[pd, pc, pb]);
      raise exception '0150: the 31st new ballot from one address in ten minutes was taken';
    exception when sqlstate 'PT429' then null;
    end;
    perform public.fanvote_cast(v_round, 't150-flood-00000001', array[pc, pd, pb]);   -- changing one is not new
    execute format('set local role %I', orig);
    perform set_config('request.headers', '{}', true);
    delete from fanvote_ballots where round_id = v_round and voter in
      (select public.fanvote_key('t150-flood-' || lpad(g::text, 8, '0')) from generate_series(1, 31) g);

    -- 8. closed: nobody votes, and the winners are Ada and the Hawks
    update fanvote_rounds set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 minute' where id = v_round;
    set local role anon;
    begin
      perform public.fanvote_cast(v_round, key_a, array[pc, pb, pa]);
      raise exception '0150: a vote was taken after the round closed';
    exception when sqlstate '22023' then null;
    end;
    j := public.fanvote_winners(lg);
    if jsonb_array_length(j) is distinct from 1 or (j -> 0 -> 'player' ->> 'id')::uuid is distinct from pa
       or (j -> 0 -> 'team' ->> 'id')::uuid is distinct from ta or (j -> 0 ->> 'ballots')::int is distinct from 4 then
      raise exception '0150: the winners are wrong: %', j;
    end if;
    j := public.fanvote_state(lg, key_a);
    if (j -> 'last' -> 'player' ->> 'name') is distinct from 'Ada Ash' or (j -> 'open') is distinct from 'null'::jsonb then
      raise exception '0150: the page does not show last week''s winner: %', j;
    end if;
    execute format('set local role %I', orig);

    -- 9. a tie on points and firsts goes to the better BPM rank; a round nobody voted in has no winner
    v_week2 := case when public.season_label(w.week_start - 7) = public.season_label(w.week_start)
                    then w.week_start - 7 else w.week_start + 7 end;     -- the same season either way
    insert into fanvote_rounds (league_id, week_start, time_zone, starts_at, ends_at, opens_at, closes_at, games)
    values (lg, v_week2, 'Europe/London', w.starts_at - interval '7 days', w.starts_at,
            now() - interval '2 hours', now() + interval '1 hour', 1) returning id into v_r2;
    insert into fanvote_candidates (round_id, kind, subject_id, team_id, rank)
    values (v_r2, 'player', pc, tc, 1), (v_r2, 'player', pb, tb, 2), (v_r2, 'player', pa, ta, 3);
    set local role anon;
    perform public.fanvote_cast(v_r2, key_a, array[pb, pc, pa]);
    perform public.fanvote_cast(v_r2, key_b, array[pc, pb, pa]);
    execute format('set local role %I', orig);
    update fanvote_rounds set closes_at = now() - interval '2 minutes' where id = v_r2;
    j := public.fanvote_result_json(v_r2);
    if (j -> 'player' ->> 'id')::uuid is distinct from pc or (j -> 'team') is distinct from 'null'::jsonb then
      raise exception '0150: the tie did not go to the better BPM rank or a club won with no votes: %', j;
    end if;

    -- 10. the console: its admin, not a stranger; the season's weekly wins
    perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.fanvote_admin(lg);
      raise exception '0150: a stranger read the league''s votes';
    exception when insufficient_privilege then null;
    end;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    j := public.fanvote_admin(lg);
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);
    if jsonb_array_length(j -> 'rounds') is distinct from 2 or (j -> 'players' -> 0 ->> 'weekly_wins')::int is distinct from 1
       or (select count(*) from jsonb_array_elements(j -> 'players') e where (e ->> 'weekly_wins')::int = 1) <> 2
       or (j -> 'rounds' -> 0 -> 'players' -> 0 ->> 'name') is null then
      raise exception '0150: the console''s view is wrong: %', j;
    end if;

    -- 11. private: the vote is the invited fans' only
    perform set_config('epinoia.visibility_rpc', 'on', true);
    update leagues set visibility = 'private' where id = lg;
    perform set_config('epinoia.visibility_rpc', '', true);
    update fanvote_rounds set opens_at = now() - interval '1 hour', closes_at = now() + interval '1 hour' where id = v_round;
    set local role anon;
    if public.fanvote_state(lg, key_a) is not null or public.fanvote_winners(lg) is not null then
      raise exception '0150: a private league''s vote is readable signed out';
    end if;
    begin
      perform public.fanvote_cast(v_round, key_a, array[pa, pb, pc]);
      raise exception '0150: a stranger voted in a private league';
    exception when sqlstate '22023' then null;
    end;
    select count(*) into n from fanvote_rounds where league_id = lg;
    if n <> 0 then raise exception '0150: a private league''s rounds are listed signed out'; end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', json_build_object('sub', u_guest, 'role', 'authenticated')::text, true);
    set local role authenticated;
    j := public.fanvote_state(lg, key_a);
    if j -> 'open' is null then raise exception '0150: a guest of a private league cannot see its vote'; end if;
    perform public.fanvote_cast(v_round, key_a, array[pa, pb, pc], ta);
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('epinoia.visibility_rpc', 'on', true);
    update leagues set visibility = 'public' where id = lg;
    perform set_config('epinoia.visibility_rpc', '', true);

    -- 12. a league that turns the vote off in Appearance
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.set_league_appearance(lg, null, jsonb_build_object('fanvote', false), null, null);
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);
    if (select sections ->> 'fanvote' from leagues where id = lg) is distinct from 'false' then
      raise exception '0150: set_league_appearance does not keep the fanvote switch';
    end if;
    set local role anon;
    j := public.fanvote_state(lg, key_a);
    if (j ->> 'off')::boolean is not true then raise exception '0150: a league with the vote off still offers it: %', j; end if;
    begin
      perform public.fanvote_cast(v_round, key_a, array[pc, pb, pa]);
      raise exception '0150: a league with the vote off still took a vote';
    exception when sqlstate '22023' then null;
    end;
    execute format('set local role %I', orig);
    delete from fanvote_rounds where league_id = lg and week_start = w.week_start;
    if public.fanvote_due(lg, v_at) is not null then
      raise exception '0150: a round is due in a league that turned the vote off';
    end if;

    -- 13. what a browser may touch
    if has_table_privilege('anon', 'public.fanvote_ballots', 'select')
       or has_table_privilege('anon', 'public.fanvote_candidates', 'select')
       or has_table_privilege('authenticated', 'public.fanvote_ballots', 'insert')
       or has_function_privilege('anon', 'public.fanvote_open(uuid, date, jsonb, jsonb, timestamptz)', 'execute')
       or has_function_privilege('authenticated', 'public.fanvote_open(uuid, date, jsonb, jsonb, timestamptz)', 'execute')
       or has_function_privilege('anon', 'public.fanvote_due(uuid, timestamptz)', 'execute')
       or has_function_privilege('anon', 'public.fanvote_admin(uuid, text)', 'execute')
       or has_function_privilege('anon', 'public.fanvote_tally(uuid)', 'execute')
       or not has_function_privilege('anon', 'public.fanvote_state(uuid, text)', 'execute')
       or not has_function_privilege('anon', 'public.fanvote_cast(uuid, text, uuid[], uuid, boolean)', 'execute')
       or not has_function_privilege('anon', 'public.fanvote_winners(uuid, int)', 'execute')
       or not has_function_privilege('service_role', 'public.fanvote_open(uuid, date, jsonb, jsonb, timestamptz)', 'execute') then
      raise exception '0150: the grants are not what the header says';
    end if;

    raise exception using errcode = 'P0150', message = '0150 passed; rolling its test rows back';
  exception
    when sqlstate 'P0150' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  if exists (select 1 from leagues where slug like 'zz-t150-%') or exists (select 1 from players where slug like 'zz-t150-%') then
    raise exception '0150: the test rows outlived their rollback';
  end if;
  raise notice '0150 ok: the week is the league''s own (Mon 06:00 to Thu end), a round opens once with the server''s cards (no minor, no stranger, fifteen at most; a live game holds it six hours at most), anyone votes once per browser and signing in absorbs it, 3-2-1 with its tie-breaks, the throttle, the winners, the console, a private league''s vote is its guests'' only, and a league can turn it off';
end $test$;
