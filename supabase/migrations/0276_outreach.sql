-- 0276 OUTREACH (Louie, 2026-10-16): the clubs on the platform, each with the contact address it publishes itself, so the
-- platform's owner can pitch the analytics report subscription to a club by hand - ticked in the console, drafted in the
-- EPINOIA email style, opened in his own email and sent by him. Nothing here sends anything.
--
--   outreach_contacts    a club (its teams across the platform's leagues, grouped) and ONE address of its own: an
--                        organisational address it publishes (info@, office@, commercial@ ...), where it was read and
--                        when; never a person's name. Its state: new, ready, sent, replied, interested, declined,
--                        do_not_contact, bounced. A club whose only way in is a form keeps the form's address and an
--                        empty email.
--   outreach_templates   the pitch's words: a subject and a body with merge fields ({{club}}, {{league}} ...), and the
--                        sign-off; one 'default' row to start, more by language if wanted
--   outreach_import      a batch of researched contacts in: new ones added, known ones refreshed (website, source,
--                        date) - never their state, so a club marked sent or do-not-contact stays so
--
-- Platform administrators only, every row and every call (RLS and the function's own check).

create table if not exists public.outreach_contacts (
  id           uuid primary key default gen_random_uuid(),
  club_key     text not null,                       -- the club: one of its teams' ids (the research's grouping)
  team_ids     uuid[] not null default '{}',
  club_name    text not null,
  country      text,
  league_slugs text[] not null default '{}',
  website      text,
  email        text not null default '',            -- '' when the club publishes only a form
  email_role   text,                                -- general, commercial, media, management, athletics, other
  source_url   text,
  contact_form text,
  language     text,
  gathered_at  timestamptz,
  status       text not null default 'new',
  sent_at      timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  constraint outreach_contacts_status_ck check (status in ('new','ready','sent','replied','interested','declined','do_not_contact','bounced')),
  constraint outreach_contacts_email_ck check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint outreach_contacts_web_ck check (website is null or website ~* '^https?://'),
  constraint outreach_contacts_club_email_uq unique (club_key, email)
);
create index if not exists outreach_contacts_status_ix on public.outreach_contacts (status);

create table if not exists public.outreach_templates (
  name        text primary key,
  subject     text not null,
  body        text not null,
  signoff     text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.outreach_contacts  enable row level security;
alter table public.outreach_templates enable row level security;
drop policy if exists outreach_contacts_admin on public.outreach_contacts;
create policy outreach_contacts_admin on public.outreach_contacts
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists outreach_templates_admin on public.outreach_templates;
create policy outreach_templates_admin on public.outreach_templates
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on public.outreach_contacts, public.outreach_templates to authenticated;
grant all on public.outreach_contacts, public.outreach_templates to service_role;

/* THE PITCH TO START FROM: short, about what the club gets, its own page linked, and how to say no */
insert into public.outreach_templates (name, subject, body, signoff) values (
  'default',
  '{{club}}: your games, analysed after every final whistle',
  'Hi {{club}} team,

I run EPINOIA, the basketball analytics site that covers {{league}}. Every game {{club}} plays is already on it - box scores, play-by-play, lineups and shot charts - and your club page is here: {{club_page}}

We also send clubs a scouting and analysis report by email: each game broken down at the final whistle, and every Sunday a report on the opponents you face that week, as A4 PDFs drawn from the live data.

{{hook}}

Would a sample report for {{club}} be useful? Reply to this email and I will send one over - there is nothing to sign up for.

If this is not for you, just reply "no thanks" and you will not hear from us again.',
  'Kind regards,
Louie
EPINOIA'
) on conflict (name) do nothing;

create or replace function public.outreach_import(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; added int := 0; refreshed int := 0; v_id uuid; v_email text;
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'an array of at most 500 contacts' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(btrim(coalesce(r->>'email', '')));
    if v_email <> '' and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then continue; end if;
    if coalesce(btrim(r->>'club_key'), '') = '' or coalesce(btrim(r->>'club_name'), '') = '' then continue; end if;
    select id into v_id from outreach_contacts where club_key = r->>'club_key' and email = v_email;
    if v_id is null then
      insert into outreach_contacts (club_key, team_ids, club_name, country, league_slugs, website, email, email_role, source_url,
                                     contact_form, language, gathered_at, updated_by)
      values (r->>'club_key',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(r->'team_ids', '[]'::jsonb)) x), '{}'),
              left(r->>'club_name', 200), left(r->>'country', 12),
              coalesce((select array_agg(left(x, 80)) from jsonb_array_elements_text(coalesce(r->'league_slugs', '[]'::jsonb)) x), '{}'),
              case when r->>'website' ~* '^https?://' then left(r->>'website', 500) end,
              v_email, left(r->>'email_role', 40),
              case when r->>'source_url' ~* '^https?://' then left(r->>'source_url', 500) end,
              case when r->>'contact_form' ~* '^https?://' then left(r->>'contact_form', 500) end,
              left(r->>'language', 12), coalesce((r->>'gathered_at')::timestamptz, now()), auth.uid());
      added := added + 1;
    else
      /* known: what the research found is refreshed, its state and notes are the owner's and stay */
      update outreach_contacts set
        team_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(r->'team_ids', '[]'::jsonb)) x), team_ids),
        club_name = left(r->>'club_name', 200),
        website = coalesce(case when r->>'website' ~* '^https?://' then left(r->>'website', 500) end, website),
        email_role = coalesce(left(r->>'email_role', 40), email_role),
        source_url = coalesce(case when r->>'source_url' ~* '^https?://' then left(r->>'source_url', 500) end, source_url),
        contact_form = coalesce(case when r->>'contact_form' ~* '^https?://' then left(r->>'contact_form', 500) end, contact_form),
        language = coalesce(left(r->>'language', 12), language),
        gathered_at = coalesce((r->>'gathered_at')::timestamptz, gathered_at),
        updated_at = now(), updated_by = auth.uid()
      where id = v_id;
      refreshed := refreshed + 1;
    end if;
    v_id := null;
  end loop;
  return jsonb_build_object('added', added, 'refreshed', refreshed);
end; $$;
alter function public.outreach_import(jsonb) owner to postgres;
revoke all on function public.outreach_import(jsonb) from public, anon;
grant execute on function public.outreach_import(jsonb) to authenticated;
