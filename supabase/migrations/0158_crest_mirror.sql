-- ============================================================================
-- 0158 — CRESTS ARE MIRRORED AND SERVED AT THE SIZE THEY ARE SHOWN.
--
-- 604 of the platform's 605 club crests are other sites' URLs (the leagues' own
-- CDNs and the feeds' image hosts), hot-linked as they are: PNGs of 100 KB to
-- 780 KB drawn at 24-64 px, some on slow hosts, a few already dead (they answer
-- with an HTML page), and every one a visitor's IP handed to a third party.
-- HOME, the fixture lists and every table draw dozens at a time.
--
-- The snapshots function now copies each crest once into this public bucket,
-- 'crests', named by a hash of its URL (the same hash epinoia/config.js
-- computes, so a page can find the copy with no lookup), and pages ask Storage's
-- image transformation (a Pro feature) for it at display size, as WebP where the
-- browser takes it: a 300 KB PNG becomes a few KB. A crest not copied yet, or
-- one that cannot be (dead, not an image, too big), falls back in the page to
-- the original URL, so nothing is ever drawn worse than before. teams.logo_path
-- is not touched: the ingest's rules for it, and the colour-from-crest trigger
-- (0103), stay exactly as they are.
--
-- crest_files is the function's memory of what it copied or failed to, so each
-- URL is fetched once (a failure is retried after a week).
-- ============================================================================
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('crests', 'crests', true,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'], 5242880)
on conflict (id) do update
  set public = true,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'],
      file_size_limit = 5242880;

create table if not exists public.crest_files (
  url          text primary key,
  key          text not null,             -- the object's name in 'crests' (config.js crestKey of url)
  ok           boolean not null,
  content_type text,
  bytes        int,
  error        text,
  checked_at   timestamptz not null default now()
);
alter table public.crest_files enable row level security;
revoke all on table public.crest_files from public, anon, authenticated;
grant all on table public.crest_files to service_role;
alter table public.crest_files owner to postgres;
