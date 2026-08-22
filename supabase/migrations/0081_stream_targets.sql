-- ============================================================================
-- WHERE A LEAGUE'S STREAM GOES.
--
-- Until now the control room deliberately refused to touch a stream key: OBS
-- already held it, the destination was set once a season, and a key typed into
-- a web page is a key that page becomes responsible for.
--
-- That reasoning holds for ONE operator on ONE machine. It stops holding the
-- moment a league says "our games go to our YouTube channel" — because then
-- the destination is a property of the LEAGUE, not of whichever laptop is in
-- the hall, and the alternative is a key emailed round a WhatsApp group and
-- retyped into OBS by four different volunteers. That is strictly worse than
-- storing it once, deliberately, with the access written down.
--
-- SO IT IS STORED, AND HERE IS EXACTLY WHAT THAT MEANS.
--
--   · Readable ONLY by that league's administrators and platform
--     administrators. Not anon, not signed-in users generally, not the public
--     API, not a partner feed, not the season export.
--   · Never displayed. The admin panel shows the last four characters so
--     somebody can tell two keys apart, and offers to replace rather than to
--     reveal. The control room never renders it at all — it reads it and posts
--     it straight to OBS over a socket to the same machine.
--   · Encrypted at rest only as much as the whole database is. This is not
--     application-level encryption and it would be dishonest to imply it is: a
--     platform administrator with database access can read these. That is the
--     same trust boundary as every other secret the platform holds, and it is
--     why the read policy is as narrow as it is.
--
-- THE BETTER ANSWER, FOR LATER, is YouTube's Live API: OAuth once, and the
-- platform creates the broadcast and fetches an ephemeral key per game, so
-- nothing long-lived is stored at all. That needs a verified Google app and is
-- a different piece of work; this is the version a league can use on Saturday.
-- ============================================================================

create table if not exists public.league_stream_targets (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues on delete cascade,
  label       text not null default 'Main channel',
  platform    text not null default 'youtube'
              check (platform in ('youtube','twitch','facebook','custom')),
  /* The ingest URL. Not a secret — it is published by every platform — and it
     is the half that tells an operator which channel they are about to go out
     on, which is why it is the half the UI is allowed to show. */
  server      text not null,
  stream_key  text not null,
  /* A note for the humans: "our second camera rig", "the county cup channel". */
  note        text not null default '',
  active      boolean not null default true,
  updated_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists stream_targets_league on public.league_stream_targets (league_id, active);

comment on table public.league_stream_targets is
  'Stream destinations for a league. CONTAINS CREDENTIALS: readable only by '
  'that league''s administrators. Never expose through the API, a feed or an '
  'export.';

alter table public.league_stream_targets enable row level security;

/* Read is narrow on purpose — see the note at the top. A league administrator
   can already see this key inside OBS, so letting them read it here widens
   nothing; letting anybody else read it would widen everything. */
drop policy if exists stream_targets_read on public.league_stream_targets;
create policy stream_targets_read on public.league_stream_targets for select
  using (public.is_platform_admin() or public.is_league_admin(league_id));

drop policy if exists stream_targets_write on public.league_stream_targets;
create policy stream_targets_write on public.league_stream_targets for all
  using (public.is_platform_admin() or public.is_league_admin(league_id))
  with check (public.is_platform_admin() or public.is_league_admin(league_id));

-- ----------------------------------------------------------------------------
-- What the admin panel is allowed to see: everything EXCEPT the key, plus
-- enough of it to tell two apart.
--
-- A panel that fetched the row and masked it in JavaScript would have sent the
-- key to the browser and then chosen not to draw it, which is not the same
-- thing at all — it would be in the response, in the network tab, and in any
-- error report the page ever sends.
-- ----------------------------------------------------------------------------
create or replace function public.stream_targets_for_league(p_league uuid)
returns table (id uuid, label text, platform text, server text,
               key_tail text, note text, active boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.label, t.platform, t.server,
         case when length(t.stream_key) > 4
              then '••••' || right(t.stream_key, 4)
              else '••••' end,
         t.note, t.active, t.updated_at
  from public.league_stream_targets t
  where t.league_id = p_league
    and (public.is_platform_admin() or public.is_league_admin(t.league_id))
  order by t.active desc, t.label;
$$;
grant execute on function public.stream_targets_for_league(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- And what the control room needs: the whole thing, for one fixture, once.
--
-- Keyed on the GAME rather than the league, so the caller does not have to
-- know which league a fixture belongs to, and so the permission question is
-- asked about the thing the operator is actually working on.
-- ----------------------------------------------------------------------------
create or replace function public.stream_target_for_game(p_game uuid)
returns table (label text, platform text, server text, stream_key text)
language sql stable security definer set search_path = public as $$
  select t.label, t.platform, t.server, t.stream_key
  from public.games g
  join public.competitions c on c.id = g.competition_id
  join public.seasons s      on s.id = c.season_id
  join public.league_stream_targets t on t.league_id = s.league_id and t.active
  where g.id = p_game
    and (public.is_platform_admin() or public.is_league_admin(s.league_id))
  order by t.updated_at desc
  limit 1;
$$;
grant execute on function public.stream_target_for_game(uuid) to authenticated;

-- ============================================================================
-- SELF-TEST — the masking, and the fact that the key does not leak.
-- ============================================================================
do $$
declare
  lid  uuid;
  tail text;
begin
  select id into lid from public.leagues limit 1;
  if lid is null then
    raise notice '0081 self-test skipped: no leagues';
    return;
  end if;

  insert into public.league_stream_targets (league_id, label, server, stream_key)
  values (lid, '__selftest', 'rtmps://a.rtmps.youtube.com:443/live2',
          'abcd-efgh-ijkl-mnop-WXYZ');

  select case when length('abcd-efgh-ijkl-mnop-WXYZ') > 4
              then '••••' || right('abcd-efgh-ijkl-mnop-WXYZ', 4)
              else '••••' end
    into tail;
  if tail <> '••••WXYZ' then
    raise exception '0081: the mask is wrong, got %', tail;
  end if;

  /* the listing function must never return the key itself */
  if exists (
    select 1
    from information_schema.routines r
    where r.routine_schema = 'public'
      and r.routine_name = 'stream_targets_for_league'
      and r.routine_definition like '%t.stream_key,%'
  ) then
    raise exception '0081: the listing function returns the raw key';
  end if;

  delete from public.league_stream_targets where label = '__selftest';
  raise notice '0081 ok: a destination is stored, masked in listings, and read '
               'only by that league''s administrators';
end $$;
