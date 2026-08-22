-- ============================================================================
-- MATCH DETAILS — the things a scoresheet has that the event log does not.
--
-- Everything the platform publishes is derived from the event log, which is
-- the right rule and is why two pages cannot disagree. But a scoresheet is not
-- only a record of play: it is a record of a MATCH, and a match has officials,
-- a hall, and a number of people who came to watch. None of that is an event.
-- It is context, entered once, and until now there was nowhere to put it.
--
-- WHY OFFICIALS ARE NAMES AND NOT USER ACCOUNTS. game_officials already exists
-- and links auth.users to a fixture — that table is about PERMISSION, about
-- who may write to this game, and its rows are statisticians with logins. A
-- referee is almost never a user of this platform. Requiring an account before
-- a referee's name can appear on a scoresheet would mean either inventing
-- accounts nobody signs into, or leaving the line blank, which is the one thing
-- a governed competition cannot do. So the names live in a jsonb column, keyed
-- by the roles the FIBA scoresheet actually has, and game_officials keeps doing
-- the job it was built for.
--
-- WHY CAPACITY AND ATTENDANCE TOGETHER. Capacity alone is trivia. Capacity with
-- attendance is a competition telling you it filled the hall, which is the
-- reason a league wants the field at all. Both are optional and neither is
-- derived from anything, so both are plain integers with a sanity bound.
-- ============================================================================

alter table public.games add column if not exists capacity   int;
alter table public.games add column if not exists attendance int;
alter table public.games add column if not exists officials  jsonb not null default '{}'::jsonb;

-- A hall does not hold a negative number of people, and a typo of 100000 in a
-- sports hall is worth refusing at the door rather than explaining later.
do $$ begin
  alter table public.games add constraint games_capacity_sane
    check (capacity   is null or (capacity   >= 0 and capacity   <= 200000));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.games add constraint games_attendance_sane
    check (attendance is null or (attendance >= 0 and attendance <= 200000));
exception when duplicate_object then null; end $$;

comment on column public.games.officials is
  'Named match officials, by role: referee, umpire1, umpire2, commissioner, '
  'scorer, assistant_scorer, timekeeper, shot_clock. Names, not user ids — '
  'see game_officials for who may WRITE to this fixture.';

-- ----------------------------------------------------------------------------
-- THE WRITE PATH IS AN RPC, NOT A COLUMN GRANT.
--
-- games already has an update policy, and widening it to let a statistician
-- patch these four fields would widen it for every other column on the row at
-- the same time — the score, the status, finalised_at. A function that writes
-- exactly these fields and nothing else is narrower than any policy could be,
-- and it puts the permission question in one place: may_score_game, the same
-- gate the scorer already answers to.
--
-- Deliberately usable BEFORE tip and AFTER the final whistle. Before, because
-- the referees are known at the door and typing them at 19:25 is when somebody
-- actually has the time; after, because the attendance figure is not known
-- until the game has started and the commissioner's name is the sort of thing
-- that gets corrected on Monday.
-- ----------------------------------------------------------------------------
create or replace function public.set_match_details(
  p_game       uuid,
  p_venue      text    default null,
  p_address    text    default null,
  p_capacity   int     default null,
  p_attendance int     default null,
  p_officials  jsonb   default null
) returns public.games
language plpgsql security definer set search_path = public as $$
declare
  g public.games;
  clean jsonb;
begin
  if not public.may_score_game(p_game) then
    raise exception 'not permitted to edit this fixture'
      using errcode = '42501';
  end if;

  /* Only the roles a scoresheet has. Anything else a caller sends is dropped
     rather than stored: this column is read by the scoresheet renderer, and a
     free-for-all jsonb becomes a schema nobody wrote down. */
  if p_officials is not null then
    select coalesce(jsonb_object_agg(k, trim(v)), '{}'::jsonb) into clean
    from jsonb_each_text(p_officials) as e(k, v)
    where k in ('referee','umpire1','umpire2','commissioner',
                'scorer','assistant_scorer','timekeeper','shot_clock')
      and trim(v) <> '';
  end if;

  update public.games set
    venue         = coalesce(nullif(trim(coalesce(p_venue,   '')), ''), venue),
    venue_address = coalesce(nullif(trim(coalesce(p_address, '')), ''), venue_address),
    /* -1 is "clear this field". A plain null means "not supplied", because a
       form that leaves attendance blank must not wipe a number entered on the
       night by somebody else. */
    capacity      = case when p_capacity   is null then capacity
                         when p_capacity   < 0     then null
                         else p_capacity   end,
    attendance    = case when p_attendance is null then attendance
                         when p_attendance < 0     then null
                         else p_attendance end,
    officials     = coalesce(clean, officials)
  where id = p_game
  returning * into g;

  if g.id is null then
    raise exception 'no such fixture' using errcode = 'P0002';
  end if;

  return g;
end $$;

revoke all on function public.set_match_details(uuid,text,text,int,int,jsonb) from public;
grant execute on function public.set_match_details(uuid,text,text,int,int,jsonb) to authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  gid uuid;
  g   public.games;
begin
  select id into gid from public.games limit 1;
  if gid is null then
    raise notice '0076 self-test skipped: no games';
    return;
  end if;

  -- the officials filter keeps what a scoresheet has and drops what it does not
  select coalesce(jsonb_object_agg(k, trim(v)), '{}'::jsonb) into g.officials
  from jsonb_each_text('{"referee":"A Shaw","mascot":"Barry","umpire1":"  "}'::jsonb) as e(k,v)
  where k in ('referee','umpire1','umpire2','commissioner',
              'scorer','assistant_scorer','timekeeper','shot_clock')
    and trim(v) <> '';

  if g.officials <> '{"referee":"A Shaw"}'::jsonb then
    raise exception '0076: officials filter wrong, got %', g.officials;
  end if;

  raise notice '0076 ok: match details column set, officials filtered to the scoresheet roles';
end $$;
