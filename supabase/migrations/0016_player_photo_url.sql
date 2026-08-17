-- ============================================================================
-- 0016 — players.photo_url.
--
-- The profile page has a photo slot. players already carries photo_media_id
-- and photo_consent, which is the right model for uploads once a storage
-- bucket and a moderation queue exist — media rows are only readable when
-- approved, and enforce_minor_photo_consent() blocks a minor's photo without
-- recorded guardian consent.
--
-- None of that is built yet, and a slot that can never be filled is not a
-- feature. This is the simple half: a URL a club can set now. The consent rule
-- still applies, because it is the same rule — a minor's photo is not
-- published without consent, whichever column it came from.
--
-- The trigger below is what makes that true rather than merely intended.
-- ============================================================================
alter table public.players
  add column if not exists photo_url text;

comment on column public.players.photo_url is
  'Direct URL to a player photograph. Subject to the same consent rule as an '
  'uploaded photo: a minor must have photo_consent recorded. Prefer '
  'photo_media_id once storage and moderation exist.';

-- A minor's photograph needs recorded guardian consent, and that must hold for
-- a pasted URL exactly as it does for an upload. Without this the new column
-- would be a way around the safeguarding rule rather than a second door to it.
create or replace function public.enforce_minor_photo_url_consent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.photo_url is not null and new.is_minor and not new.photo_consent then
    raise exception
      'a photograph of an under-18 player needs recorded guardian consent'
      using errcode = '23514';
  end if;
  return new;
end; $$;

drop trigger if exists players_photo_url_consent on public.players;
create trigger players_photo_url_consent
  before insert or update on public.players
  for each row execute function public.enforce_minor_photo_url_consent();
