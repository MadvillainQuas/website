-- ============================================================================
-- 0060 — THE BUCKETS ACCEPT VECTOR CRESTS.
--
-- The upload panels now ask clubs and leagues for an SVG with a transparent
-- background, because a crest is artwork rather than a photograph: the same
-- file has to serve a 240px card, a 620px plate and a print sheet at several
-- thousand, and only a vector does all three from one upload.
--
-- The client keeps an SVG as an SVG rather than putting it through the resize
-- canvas — but the buckets listed webp, jpeg and png only, so storage would
-- have refused the file after the panel had encouraged it. The advice and the
-- storage policy have to agree or the advice is a trap.
--
-- ON ALLOWING SVG AT ALL, since it is a document rather than pixels and can
-- carry script. Three things make it safe here, and they are worth writing
-- down because "we allow SVG uploads" reads alarming without them:
--
--   * every crest on the platform is rendered in an <img>, and an <img> does
--     not execute script in an SVG — that is the specification, not a hopeful
--     reading of it
--   * these buckets are on the storage origin, which is NOT the site's origin,
--     so a document opened directly there cannot reach a session on
--     prophesyscouting.co.uk
--   * and every upload lands as 'pending' and is seen by a league admin before
--     it appears publicly, which is the same gate a player photograph passes
--
-- The size limit is unchanged and does the rest: the client refuses an SVG over
-- 256kB, and the bucket refuses anything over 2MB whatever it is.
-- ============================================================================
update storage.buckets
   set allowed_mime_types = array['image/webp','image/jpeg','image/png','image/svg+xml']
 where id in ('media-pending', 'media-public');

-- ------------------------------------------------------------- assertions ---
do $$
declare miss text;
begin
  select string_agg(id, ', ') into miss
    from storage.buckets
   where id in ('media-pending', 'media-public')
     and not ('image/svg+xml' = any (allowed_mime_types));
  if miss is not null then
    raise exception 'ASSERT svg not permitted on: %', miss;
  end if;

  -- and the formats that were already working must still be there, because a
  -- careless overwrite here would break every photograph on the platform
  select string_agg(id, ', ') into miss
    from storage.buckets
   where id in ('media-pending', 'media-public')
     and not ('image/webp' = any (allowed_mime_types)
              and 'image/jpeg' = any (allowed_mime_types)
              and 'image/png'  = any (allowed_mime_types));
  if miss is not null then
    raise exception 'ASSERT a raster format was dropped from: %', miss;
  end if;

  raise notice '0060: both buckets accept svg, and still accept webp/jpeg/png';
end $$;
