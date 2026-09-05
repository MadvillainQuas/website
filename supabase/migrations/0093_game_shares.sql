-- ============================================================================
-- 0093 — shareable game pages.
--
-- A coach is not going to be given an invite code. The whole value of "here
-- are the numbers from Saturday" is that the link opens, once, for somebody
-- outside the site — so a share is a public row by design, reachable by
-- whoever holds the id and nobody else, because the id is the only way in.
--
-- WHAT IS STORED IS THE FEED, NOT A RENDERING. The share page runs the same
-- visualiser as gamevis.html against this payload, so a share shows every
-- tab the app has — box score, play-by-play, shot chart, the lot — and keeps
-- showing them when the app grows a new one. Storing rendered HTML instead
-- would freeze each share at the feature set of the week it was made, and
-- there would be no way to tell which shares were stale.
--
-- SNAPSHOT, NOT A POINTER. The payload is copied in rather than re-fetched
-- from Genius Sports on view, for three reasons: their host sends no CORS
-- header (that is what supabase/functions/livestats exists for), old matches
-- eventually stop being served, and a link sent to a coach should show the
-- game as it was when it was sent. A share of a game still in progress is
-- therefore frozen at the moment of sharing, which is why created_at is
-- shown on the page.
--
-- READ IS ANONYMOUS, WRITE IS NOT. select is granted to anon; there is no
-- insert policy at all, so rows can only arrive through the `share` Edge
-- Function on the service role, where the payload is size- and shape-checked
-- first. Without that split, a public insert policy would make this table a
-- free JSON host for anyone who read the page source.
-- ============================================================================

create table if not exists public.game_shares (
  -- Short, unguessable, URL-safe. Generated in the Edge Function rather than
  -- by a default here: a uuid would make the link twice as long to paste into
  -- a message, and the id IS the access control, so it is generated from a
  -- CSPRNG in one place we can reason about.
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{10,40}$'),

  -- The FIBA/Genius match id this came from. Not unique — sharing the same
  -- game twice (say, at half-time and at full time) must produce two links
  -- that each keep showing what they showed when they were sent.
  game_id       text not null,

  -- The data.json payload exactly as the feed served it.
  payload       jsonb not null,

  -- Denormalised so the share page can render a title, and the owner can read
  -- their own list, without parsing a 400 KB document first.
  home_name     text,
  away_name     text,
  home_score    int,
  away_score    int,
  competition   text,
  venue         text,
  is_final      boolean not null default false,

  created_at    timestamptz not null default now(),

  -- Free text, set by whoever made the share ("U18 semi — watch the third
  -- quarter"). Escaped at render; never interpolated as HTML.
  note          text
);

create index if not exists game_shares_game_id_idx on public.game_shares (game_id);
create index if not exists game_shares_created_at_idx on public.game_shares (created_at desc);

alter table public.game_shares enable row level security;

-- NO POLICY IS DEFINED, FOR READS EITHER, AND THAT IS THE POINT.
--
-- The obvious version of this table grants `select ... using (true)` to anon so
-- the share page can read a row. That does not mean "anyone who knows an id may
-- read that row" — it means "anyone may read EVERY row", because PostgREST will
-- answer `GET /rest/v1/game_shares?select=*` with no filter just as happily as
-- it answers a lookup by id. The unguessable id would stop being access control
-- the moment somebody read the page source and asked for the index instead.
--
-- So reads go through the `share` Edge Function on the service role, which
-- selects exactly one row by primary key and returns exactly that. RLS denying
-- everything by default is what makes the function the only door, for reads and
-- writes alike.
revoke all on public.game_shares from anon, authenticated;

comment on table public.game_shares is
  'Public, link-addressed snapshots of a FIBA LiveStats game, rendered by /share/. Read via the share Edge Function; written only on the service role.';
