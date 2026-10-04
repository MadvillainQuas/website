-- 0228: THE REPORTS MANAGER (2026-10-04). Three things the platform console's reports manager (Accounts > Reports by
-- email > Open the reports manager) and the mailer (scripts/report_mailer.mjs) need:
--
--   synergy_profiles   A PLAYER'S SYNERGY NUMBERS, assigned to the site's player. The admin drops in the scraper's play-type
--                      CSV (synergy_playtypes_<Player>_accumulated.csv); the browser reads it (epinoia/synergy.js) and keeps
--                      only the numbers the reports print - his drives left / right / straight (possessions, PPP, eFG%,
--                      TO%, rim / mid-range / three FG% and share), what his man shot attacking him face-up and posting
--                      him up - never the file. One a player: a new file replaces the old. Synergy's data is licensed, so
--                      platform administrators alone read and write it; the mailer reads it with the service key and hands
--                      it to the report it draws (EPINOIA_SYNERGY), so every report it sends has it.
--   report_rapm        RAPM, KEPT. A report's ORAPM / DRAPM are worked out from every stint of the league's season
--                      (rapm.js), once a set of games (the key is report.js rapmKey: how many, and their fingerprint).
--                      It used to be kept only in the browser that worked it out; kept here, PRIME REPORT's one click
--                      makes it there for every report of that league and season - the mailer's included. Anyone may
--                      read it (it is worked out from the public play-by-play); platform administrators write it, and the
--                      mailer with the service key.
--   player_zip         THE PLAYERS' REPORTS, ZIPPED: the Sunday email's clubs' players' own reports, in a reply to it
--                      (released players and those under 10 minutes a game left out). On for every address; the manager
--                      can turn it off for one. Logged as kind 'players', so a rerun never sends it twice.

create table if not exists public.synergy_profiles (
  player_id   uuid primary key references public.players(id) on delete cascade,
  profile     jsonb not null check (jsonb_typeof(profile) = 'object'),
  source_name text check (source_name is null or char_length(source_name) <= 120),   -- the name in the file
  source_id   text check (source_id is null or char_length(source_id) <= 80),        -- Synergy's own player id
  seasons     text check (seasons is null or char_length(seasons) <= 600),           -- "2026-2027 Leicester - International + ..."
  file_name   text check (file_name is null or char_length(file_name) <= 200),
  uploaded_by uuid default auth.uid() references auth.users on delete set null,
  uploaded_at timestamptz not null default now()
);
alter table public.synergy_profiles enable row level security;
drop policy if exists synergy_profiles_admin on public.synergy_profiles;
create policy synergy_profiles_admin on public.synergy_profiles
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on public.synergy_profiles to authenticated;
grant all on public.synergy_profiles to service_role;

create table if not exists public.report_rapm (
  key         text primary key check (key ~ '^[0-9]+-[0-9a-z]+$'),
  games       int not null check (games > 0),
  m           jsonb not null check (jsonb_typeof(m) = 'array'),                        -- [[player id, orapm, drapm], ...]
  computed_at timestamptz not null default now(),
  computed_by uuid default auth.uid() references auth.users on delete set null
);
alter table public.report_rapm enable row level security;
drop policy if exists report_rapm_read on public.report_rapm;
create policy report_rapm_read on public.report_rapm for select using (true);
drop policy if exists report_rapm_admin on public.report_rapm;
create policy report_rapm_admin on public.report_rapm
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select on public.report_rapm to anon, authenticated;
grant insert, update, delete on public.report_rapm to authenticated;
grant all on public.report_rapm to service_role;

alter table public.report_mail_subs add column if not exists player_zip boolean not null default true;
alter table public.report_mail_log drop constraint if exists report_mail_log_kind_check;
alter table public.report_mail_log add constraint report_mail_log_kind_check
  check (kind in ('game', 'sunday', 'team', 'opp', 'players'));
