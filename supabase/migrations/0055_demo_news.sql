-- ============================================================================
-- 0055 — NEWS FOR THE DEMO LEAGUE.
--
-- The news system shipped in 0051 with nothing in it, so the front of the demo
-- league showed the empty state and the news tab showed the empty state, and
-- neither of those is the thing anyone needs to look at when deciding whether
-- the feature works. Five published articles, one of them pinned.
--
-- THE NUMBERS ARE READ OUT OF THE DATABASE, not typed in here. A seeded article
-- claiming Neon City are top of the table is a hostage to every later migration
-- that adds a game — 0012 seeds a fuller season, 0024 a prior one, 0026 a cup —
-- and an article that contradicts the standings table two screens below it is
-- worse than no article at all. So the league leader, the record, the most
-- recent result and the top scorer are all queried at seed time and formatted
-- into the prose. If the data is not there, the sentence that needed it is not
-- written; nothing is invented.
--
-- IT IS IDEMPOTENT ON THE LEAGUE, not on each article: if the demo league has
-- any article at all, this does nothing. Re-running a migration must not
-- duplicate a front page, and it must never overwrite something written since
-- through the editor — which is the likelier case by far, because the reason to
-- have demo articles is to have something to edit.
--
-- Bodies go through clean_news_body() rather than straight into the column. The
-- block allow-list is the format's contract and a migration is not exempt from
-- it: anything here that the editor could not have produced should be dropped
-- here too, so what the seed puts in is exactly what a writer could have.
-- ============================================================================
do $$
declare
  lg        uuid;
  cp        uuid;
  cup       uuid;
  lead_team text;
  lead_w    int;
  lead_l    int;
  lead_strk text;
  second    text;
  g_home    text;
  g_away    text;
  g_hs      int;
  g_as      int;
  g_when    date;
  scorer    text;
  scorer_pt numeric;
  n_teams   int;
  n_games   int;
  body      jsonb;
  pub       timestamptz := now();
begin
  select id into lg from leagues where slug = 'demo-league';
  if lg is null then
    raise notice '0055: no demo league, nothing to write about';
    return;
  end if;

  if exists (select 1 from news_articles where league_id = lg) then
    raise notice '0055: the demo league already has news — leaving it alone';
    return;
  end if;

  -- the league competition with the most games in it, which is the one worth
  -- writing about whichever migrations have run
  select c.id into cp
    from competitions c
    join seasons s on s.id = c.season_id
   where s.league_id = lg and c.kind = 'league'
   order by (select count(*) from games g where g.competition_id = c.id) desc,
            s.starts_on desc
   limit 1;

  select c.id into cup
    from competitions c
    join seasons s on s.id = c.season_id
   where s.league_id = lg and c.kind <> 'league'
   limit 1;

  select count(*) into n_teams from teams where league_id = lg;

  if cp is not null then
    select t.name, st.w, st.l, st.streak
      into lead_team, lead_w, lead_l, lead_strk
      from standings st join teams t on t.id = st.team_id
     where st.competition_id = cp
     order by st.rank nulls last, st.league_points desc, st.diff desc
     limit 1;

    select t.name into second
      from standings st join teams t on t.id = st.team_id
     where st.competition_id = cp
     order by st.rank nulls last, st.league_points desc, st.diff desc
     offset 1 limit 1;

    select count(*) into n_games
      from games where competition_id = cp and status = 'final';

    select h.name, a.name, g.home_score, g.away_score, g.tipoff_at::date
      into g_home, g_away, g_hs, g_as, g_when
      from games g
      join teams h on h.id = g.home_team_id
      join teams a on a.id = g.away_team_id
     where g.competition_id = cp and g.status = 'final'
     order by g.tipoff_at desc
     limit 1;
  end if;

  /* THE LEADING SCORER, off the same aggregate the front page reads.

     Not off player_game_stats: that table holds one jsonb blob per player per
     game with a text player_id, so re-deriving a per-game average from it here
     would be a second, differently-written implementation of the thing
     player_season_stats already is — and the first time the two disagreed, the
     article would be the one that was wrong.

     A MINOR IS NEVER NAMED. The database withholds under-18 names from every
     public page and the API, and an article is a public page; a seed that wrote
     one into prose would be the one hole in that.

     Wrapped, because a demo league with no box scores is a perfectly ordinary
     state and the piece simply drops the sentence that needed the number. */
  begin
    select p.first_name || ' ' || p.last_name, round(ss.ppg, 1)
      into scorer, scorer_pt
      from player_season_stats ss
      join players p on p.id = ss.player_id
     where ss.competition_id = cp
       and ss.gp >= 2
       and coalesce(p.is_minor, false) = false
     order by ss.ppg desc nulls last
     limit 1;
  exception when others then
    scorer := null;
  end;

  -- ==========================================================================
  -- 1. PINNED — the state of the table.
  -- ==========================================================================
  body := jsonb_build_array(
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      coalesce(lead_team, 'The league') ||
      case when lead_w is not null
           then ' sit top of the Division One table at ' || lead_w || '-' || lead_l ||
                case when coalesce(lead_strk, '') <> ''
                     then ', and arrive at the weekend on ' || lead_strk || '.'
                     else '.' end
           else ' is under way.' end ||
      case when second is not null
           then ' ' || second || ' are the closest thing to a challenger, and the ' ||
                'margin between the two is thinner than the record makes it look.'
           else '' end))),
    jsonb_build_object('type', 'h2', 'spans', jsonb_build_array(
      jsonb_build_object('t', 'What the table is not telling you'))),
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'Win-loss is a blunt instrument this early. Point difference is the better ' ||
      'guide, and the full-season table carries both, along with the pace and ' ||
      'efficiency numbers the standings page has no room for.'))),
    case when scorer is not null then
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        scorer || ' leads the league for scoring at ' || scorer_pt ||
        ' a game — a number that has held up against every defence put in ' ||
        'front of it so far.')))
    else
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        'Individual leaders appear on the front page as soon as the box scores ' ||
        'are in.')))
    end,
    jsonb_build_object('type', 'rule'),
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'This is a demonstration league. Every figure in this article was read out ' ||
      'of the same tables the standings are drawn from, which is the point of it.')))
  );

  insert into news_articles (league_id, slug, title, standfirst, body, status,
                             pinned, published_at, author_name)
  values (lg, 'the-table-takes-shape',
    'The table takes shape',
    coalesce(lead_team || ' set the pace, but the difference column tells a ' ||
             'different story', 'Where the season stands'),
    clean_news_body(body), 'published', true, pub - interval '2 days',
    'Epinoia Newsroom');

  -- ==========================================================================
  -- 2. The most recent result, written as a report.
  -- ==========================================================================
  if g_home is not null then
    body := jsonb_build_array(
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        case when g_hs > g_as
             then g_home || ' beat ' || g_away || ' ' || g_hs || '-' || g_as
             else g_away || ' won at ' || g_home || ' ' || g_as || '-' || g_hs end ||
        ', and the margin was settled long before the final whistle suggested ' ||
        'it might be.'))),
      jsonb_build_object('type', 'h2', 'spans', jsonb_build_array(
        jsonb_build_object('t', 'How it turned'))),
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        'The third quarter did it. One side stopped taking the first shot ' ||
        'available and started taking the second one, and a game that had been ' ||
        'traded basket for basket became a game with a leader in it.'))),
      jsonb_build_object('type', 'quote', 'spans', jsonb_build_array(jsonb_build_object('t',
        'We did not change anything. We just did the thing we had already ' ||
        'decided to do, for eight minutes in a row.'))),
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        'The full box score, including every possession as it was recorded, is ' ||
        'on the game page.')))
    );

    insert into news_articles (league_id, slug, title, standfirst, body, status,
                               pinned, published_at, author_name)
    values (lg, 'eight-minutes-that-settled-it',
      'Eight minutes that settled it',
      g_home || ' v ' || g_away || ' — the third quarter decided a game the ' ||
      'first half could not',
      clean_news_body(body), 'published', false, pub - interval '4 days',
      'Epinoia Newsroom');
  end if;

  -- ==========================================================================
  -- 3. The Team of the Year ballot. This one exists to point at a feature
  --    nobody would find on their own.
  -- ==========================================================================
  body := jsonb_build_array(
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'The vote for Team of the Year is open, and for the first time the ' ||
      'public ballot counts towards the result rather than running alongside ' ||
      'it.'))),
    jsonb_build_object('type', 'h2', 'spans', jsonb_build_array(
      jsonb_build_object('t', 'How the weighting works'))),
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'Every ballot is one voter, and every voter carries a weight the league ' ||
      'sets: coaches, officials and the public are each worth a stated share ' ||
      'of the electorate. A player''s percentage is the share of the total ' ||
      'weight that voted for them — not the share of votes cast — so a name ' ||
      'that appears on every public ballot and no official one lands exactly ' ||
      'where the weighting says it should.'))),
    jsonb_build_object('type', 'ul', 'items', jsonb_build_array(
      jsonb_build_array(jsonb_build_object('t',
        'Five places, and one vote each — no ranking, no first-team-second-team')),
      jsonb_build_array(jsonb_build_object('t',
        'One ballot per account, changeable until the vote closes')),
      jsonb_build_array(jsonb_build_object('t',
        'Results stay sealed until the league publishes them')))),
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'The ballot is on the front page, above the season''s statistical ' ||
      'leaders. It closes at the end of the regular season.')))
  );

  insert into news_articles (league_id, slug, title, standfirst, body, status,
                             pinned, published_at, author_name)
  values (lg, 'the-ballot-is-open',
    'The ballot is open',
    'Team of the Year now counts the public vote as part of the electorate — ' ||
    'here is exactly how much it is worth',
    clean_news_body(body), 'published', false, pub - interval '6 days',
    'Epinoia Newsroom');

  -- ==========================================================================
  -- 4. The cup, if there is one.
  -- ==========================================================================
  if cup is not null then
    body := jsonb_build_array(
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        'The cup returns' ||
        case when n_teams > 0 then ' with all ' || n_teams || ' clubs entered'
             else '' end ||
        ', and the draw has done what the draw usually does: put the two form ' ||
        'sides on the same side of it.'))),
      jsonb_build_object('type', 'h3', 'spans', jsonb_build_array(
        jsonb_build_object('t', 'The format'))),
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        'Group stage into a knockout, and the bracket is published in full ' ||
        'before a ball is thrown up — which matters, because a league that ' ||
        'decides the format after the seeding is a league that has decided ' ||
        'the winner.'))),
      jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
        'Ties, seedings and the route to the final are all on the cup page.')))
    );

    insert into news_articles (league_id, slug, title, standfirst, body, status,
                               pinned, published_at, author_name)
    values (lg, 'the-draw-has-been-unkind',
      'The draw has been unkind',
      'Group stage into a knockout, and the bracket is public before the first ' ||
      'tip',
      clean_news_body(body), 'published', false, pub - interval '9 days',
      'Epinoia Newsroom');
  end if;

  -- ==========================================================================
  -- 5. How to follow it. Always true, whatever the data says.
  -- ==========================================================================
  body := jsonb_build_array(
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'Every game is scored live, and the score you see on the game page is ' ||
      'the same record the statistician is writing — not a copy of it, and not ' ||
      'a summary published afterwards.'))),
    jsonb_build_object('type', 'h2', 'spans', jsonb_build_array(
      jsonb_build_object('t', 'Three ways in'))),
    jsonb_build_object('type', 'ol', 'items', jsonb_build_array(
      jsonb_build_array(jsonb_build_object('t',
        'The game page, which updates as the game happens and keeps the full ' ||
        'box score afterwards')),
      jsonb_build_array(jsonb_build_object('t',
        'The embeds, which put a live score or the table on any club site ' ||
        'with one line of markup')),
      jsonb_build_array(jsonb_build_object('t',
        'The read-only API, for anyone who would rather have the numbers than ' ||
        'the page')))),
    jsonb_build_object('type', 'h3', 'spans', jsonb_build_array(
      jsonb_build_object('t', 'And one thing we will not do'))),
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(jsonb_build_object('t',
      'Under-18 players are not named or photographed on any public page, in ' ||
      'the API, or in any feed given to a partner. That is enforced by the ' ||
      'database rather than by whoever is building the page, which is the only ' ||
      'version of that promise worth making.')))
  );

  insert into news_articles (league_id, slug, title, standfirst, body, status,
                             pinned, published_at, author_name)
  values (lg, 'how-to-follow-the-league',
    'How to follow the league',
    'Live scores, embeds and an API — and the one thing that is never published',
    clean_news_body(body), 'published', false, pub - interval '14 days',
    'Epinoia Newsroom');

  raise notice '0055: seeded % demo articles',
    (select count(*) from news_articles where league_id = lg);
end $$;
