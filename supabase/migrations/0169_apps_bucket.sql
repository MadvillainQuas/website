-- ============================================================================
-- 0169 — THE ANDROID APP IS DOWNLOADED FROM OUR OWN STORAGE.
--
-- The download page linked the code host's release pages for the signed APK,
-- and asked that host's public API for the file's size and version. The site
-- no longer names or depends on where its code is kept, so the release
-- workflow now also publishes the files here, in a public bucket, and the page
-- links them:
--
--   apps/epinoia.apk             the current signed build (stable name, what the
--                                page and version.json link)
--   apps/epinoia-<version>.apk   the same build, kept by version
--   apps/epinoia.json            { versionName, versionCode, bytes, sha256,
--                                  publishedAt }: what the page shows
--
-- Public to read, as a release download always was. Written by the service
-- role alone (no storage policy grants anyone else a write).
-- ============================================================================
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('apps', 'apps', true,
        array['application/vnd.android.package-archive', 'application/octet-stream', 'application/json'],
        52428800)
on conflict (id) do update
  set public = true,
      allowed_mime_types = array['application/vnd.android.package-archive', 'application/octet-stream', 'application/json'],
      file_size_limit = 52428800;
