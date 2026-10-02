-- 0224: THE PROFILE DASHBOARD'S HEAD (2026-10-02). PROFILE (epinoia/profile/) is a fan's dashboard now: their page,
-- the leagues, clubs and players they follow, and (0225) their reports, under a head they make their own: a title of
-- their choosing over the page, and a banner style. The colour and light or dark are the ones the fan already has
-- (fan_prefs.colour, fan_prefs.theme, set_fan_prefs); these two sit beside them, on the same row, read with it.
--
--   dash_title   null: the page's own ("Your dashboard"); otherwise 1 to 40 characters, one line
--   dash_banner  plain | glow (the default) | stripes | grid | club (the first followed club's colours)

alter table public.fan_prefs add column if not exists dash_title text
  check (dash_title is null or (char_length(dash_title) between 1 and 40 and dash_title !~ '[\r\n\t]'));
alter table public.fan_prefs add column if not exists dash_banner text not null default 'glow'
  check (dash_banner in ('plain', 'glow', 'stripes', 'grid', 'club'));

/* the fan's own head: a blank title puts the page's back; white space is folded, so a pasted line cannot break it */
create or replace function public.set_dashboard(p_title text, p_banner text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_title text; v_row public.fan_prefs;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_banner is not null and p_banner not in ('plain', 'glow', 'stripes', 'grid', 'club') then
    raise exception 'a banner is plain, glow, stripes, grid or club' using errcode = '22023';
  end if;
  v_title := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '');
  if v_title is not null and char_length(v_title) > 40 then
    raise exception 'a title is 40 characters at most' using errcode = '22023';
  end if;
  insert into public.fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.fan_prefs
     set dash_title = v_title, dash_banner = coalesce(p_banner, dash_banner), updated_at = now()
   where user_id = auth.uid()
  returning * into v_row;
  return jsonb_build_object('title', v_row.dash_title, 'banner', v_row.dash_banner);
end $$;
revoke all on function public.set_dashboard(text, text) from public;
grant execute on function public.set_dashboard(text, text) to authenticated;

notify pgrst, 'reload schema';
