-- ============================================================================
-- A LEAGUE'S OWN LETTERS.
--
-- The scorebug carries a badge, and a league that has not uploaded a logo gets
-- its initials there instead. Deriving those from the name is right most of the
-- time and wrong in two ways that matter.
--
-- THE FIRST IS ORDINARY. Real competitions have acronyms that their names do
-- not produce: EuroLeague is EL, the Basketball Champions League is BCL, a club
-- competition called "The Something Trophy" is not "TST" to anybody who follows
-- it. A derived acronym is a guess, and a league should be able to say.
--
-- THE SECOND IS NOT ORDINARY. Three letters taken off the front of ordinary
-- English words land on acronyms that belong to political organisations, and a
-- scoreboard at a schools game is the last place any of them should appear. The
-- demo league did exactly this: "Epinoia Demo League" derives EDL, which in
-- Britain names a far-right street movement. Nobody chose it, no reviewer would
-- have caught it in the code, and it would have gone out on every stream of
-- every game the league played.
--
-- So: a column a league controls, a blocklist for the derived case, and a demo
-- league renamed so it stops producing the thing at all.
-- ============================================================================

alter table public.leagues
  add column if not exists initials text;

do $$ begin
  /* One to four characters, letters and digits. Long enough for BCL and NBL1,
     short enough that it is still a badge rather than a word — and constrained
     rather than trusted, because this is drawn at 2vmin on live television and
     a paragraph typed into it is a broken graphic on air. */
  alter table public.leagues add constraint leagues_initials_ck
    check (initials is null or initials ~ '^[A-Za-z0-9]{1,4}$');
exception when duplicate_object then null; end $$;

comment on column public.leagues.initials is
  'The badge letters for this league, when it has no logo. Set by the league; '
  'derived from the name only when this is null. A league whose derived '
  'acronym is unfortunate — or simply wrong — sets it here.';

-- ----------------------------------------------------------------------------
-- The demo league stops generating it.
--
-- Renamed rather than only overridden, because the name is what appears in
-- every heading, every share card and every page title, and "Demo" there is
-- also what produced the letters. "Basketball" is both the honest word and the
-- one that gives the league the acronym anybody would expect.
-- ----------------------------------------------------------------------------
update public.leagues
   set name = 'Epinoia Basketball League',
       initials = 'EBL'
 where slug = 'demo-league';

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $test$
declare
  n text;
  i text;
begin
  select name, initials into n, i from public.leagues where slug = 'demo-league';
  if n is null then
    raise notice '0087 ok: column added (no demo league on this database)';
    return;
  end if;
  if i is distinct from 'EBL' then
    raise exception '0087: the demo league should carry EBL, it has %', coalesce(i, 'null');
  end if;
  if n like '%Demo%' then
    raise exception '0087: the demo league is still named "%" and will derive EDL', n;
  end if;

  /* The constraint has to actually refuse a sentence. */
  begin
    update public.leagues set initials = 'not a badge' where slug = 'demo-league';
    raise exception '0087: the length constraint is not being enforced';
  exception when check_violation then
    null;                                     -- refused, which is the point
  end;

  raise notice '0087 ok: a league sets its own letters, and the demo league '
               'no longer derives an acronym nobody chose';
end $test$;
