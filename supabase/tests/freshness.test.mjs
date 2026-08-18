/* ============================================================================
   THE PAGES THAT LIST GAMES KEEP UP, AND THE NEWEST ARTICLE LEADS.

   Two complaints, one shape: a page showing something that stopped being true
   a while ago.

   THE FIXTURE SCREENS. The fixtures page re-read its games every 90 seconds
   when nothing was live, so a game could start, or finish, and the list carry
   on showing the old state for a minute and a half. The league's own front
   page never re-read at all — the page most likely to be left open through an
   evening was the one that could not change. Both now have a floor of 30
   seconds and, above that, the scorer's announcement.

   THE NEWS FLAG. A match report filed minutes earlier appeared SECOND, behind
   a week-old article wearing the word "Latest". Both parts of that were the
   same mistake: the flag was printed on whatever was PINNED, which is a
   different claim entirely. news_public's ordering was right all along —
   pinned first, then newest — so nothing about the order needed changing. What
   needed changing is that a pin should say "Pinned", the newest should say
   "Latest", and it should take one click to release a pin rather than a round
   trip through the article editor.

     node supabase/tests/freshness.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* ---- the fixture screens refresh ------------------------------------------ */
{
  const fx = read('epinoia', 'fixtures', 'fixtures.js');
  const home = read('epinoia', 'home.js');

  const idle = Number((fx.match(/IDLE_MS\s*=\s*(\d+)/) || [])[1]);
  const live = Number((fx.match(/LIVE_MS\s*=\s*(\d+)/) || [])[1]);
  ok('the fixtures page re-reads at least every 30 seconds when nothing is live',
     idle > 0 && idle <= 30000, String(idle));
  ok('...and more often while a game is on', live > 0 && live < idle, live + ' vs ' + idle);

  const hIdle = Number((home.match(/GAMES_IDLE_MS\s*=\s*(\d+)/) || [])[1]);
  const hLive = Number((home.match(/GAMES_LIVE_MS\s*=\s*(\d+)/) || [])[1]);
  ok('the league front page re-reads its games at all — it never used to',
     hIdle > 0, String(hIdle));
  ok('...on the same 30-second floor', hIdle <= 30000, String(hIdle));
  ok('...and tightens while a game is on', hLive > 0 && hLive < hIdle,
     hLive + ' vs ' + hIdle);

  ok('the front page starts the watch after it has drawn',
     /applySections\(\);[\s\S]{0,300}watchGames\(\)/.test(home));
  ok('...including when the league in the URL does not exist',
     (home.match(/watchGames\(\);/g) || []).length >= 2,
     String((home.match(/watchGames\(\);/g) || []).length));

  /* Re-reading is only safe to do often if it is cheap when nothing moved. */
  ok('a refresh that finds no change does not rebuild the list',
     /key === gamesKey && \$\('#games'\)\.childElementCount/.test(home));
  ok('...and the fingerprint is what a reader would actually notice',
     /g\.id \+ ':' \+ g\.status \+ ':' \+\s*\n?\s*g\.home_score \+ '-' \+ g\.away_score/.test(home) ||
     /g\.id \+ ':' \+ g\.status[\s\S]{0,80}home_score/.test(home));
}

/* ---- the announcement is a nudge, never a source of truth ----------------- */
{
  const fx = read('epinoia', 'fixtures', 'fixtures.js');
  const home = read('epinoia', 'home.js');
  for (const [name, src, fn] of [['fixtures', fx, 'watchLive'], ['home', home, 'watchGames']]) {
    ok(`${name} joins the announce topic`, /epinoia:live/.test(src));
    /* Either spelling of the topic — the literal, or the constant it is held
       in — so long as watching it leads to a re-read and nothing else. */
    ok(`${name} responds by RE-READING, not by believing the message`,
       new RegExp(`watch\\((?:ANNOUNCE_TOPIC|'epinoia:live')[\\s\\S]{0,320}${fn}\\(0\\)`).test(src),
       'the message must only decide WHEN to look');
  }
  ok('both pages load the realtime client',
     /rt\.js\?v=\d+/.test(read('epinoia', 'fixtures', 'index.html')) &&
     /rt\.js\?v=\d+/.test(read('epinoia', 'index.html')));
  ok('the timer survives as the floor for what a scorer cannot announce',
     /watchLive\(\);/.test(fx) && /gamesTimer = setTimeout/.test(home));
}

/* ---- the news flag means what it says ------------------------------------- */
{
  const news = read('epinoia', 'news.js');
  ok('a PINNED article is flagged "Pinned"', /a\.pinned.*'Pinned'/.test(news),
     (news.match(/news-flag[^\n]*/g) || []).join(' | '));
  ok('"Latest" is no longer printed on whatever happens to be pinned',
     !/a\.pinned[^\n]*'Latest'/.test(news));
  ok('"Latest" is decided by the caller, which is the only level that can see '
     + 'the whole list', /opts && opts\.latest/.test(news));
  ok('the league front page works out which article is genuinely newest',
     /newest = rows\.reduce/.test(news) && /published_at/.test(news));
  ok('...and marks only that one', /latest: newest && a\.id === newest\.id/.test(news));

  const page = read('epinoia', 'news', 'news-page.js');
  ok('the archive, which sorts by date, marks its first card',
     /latest: i === 0/.test(page));

  const css = read('epinoia', 'kit', 'news.css');
  ok('the two flags do not look the same, because they do not mean the same',
     /\.news-flag\.pin\{/.test(css));
}

/* ---- pinning ---------------------------------------------------------------
   The ordering was never the problem, so the tests are about the RULES around
   the pin rather than about sort order. */
{
  const mig = read('supabase', 'migrations', '0071_pin_one_article.sql');
  ok('pinning is exclusive — a league leads with one thing, not four',
     /update news_articles\s*\n?\s*set pinned = false/.test(mig));
  ok('...enforced by a trigger, so the editor, the switch and the API all obey',
     /create trigger news_one_pin/.test(mig));
  ok('any existing pile-up of pins is cleaned up on the way in',
     /update public\.news_articles a\s*\n\s*set pinned = false/.test(mig));
  ok('there is a function that flips just the pin',
     /create or replace function public\.set_article_pinned/.test(mig));
  ok('...restricted to writers of that league',
     /is_league_writer\(v_league\)/.test(mig));
  ok('...and it is executable by a signed-in user',
     /grant execute on function public\.set_article_pinned/.test(mig));
  ok('the migration calls what it creates — plpgsql is not checked until it runs',
     /do \$\$[\s\S]*news_public\(lg/.test(mig));
  ok('...and asserts the pinned article actually leads',
     /does not lead with the pinned article/.test(mig));
  ok('...and that releasing it puts the newest back on top',
     /the newest article does not lead/.test(mig));

  const ui = read('epinoia', 'admin', 'news-ui.js');
  ok('the admin list has a one-click pin, not a trip through the editor',
     /set_article_pinned/.test(ui));
  ok('only a published article can be pinned — a draft cannot lead a page',
     /a\.status === 'published'[\s\S]{0,200}pinBtn/.test(ui));
  ok('the button says which way it goes', /a\.pinned \? 'unpin' : 'pin'/.test(ui));
  ok('and the editor checkbox admits that pinning releases the other one',
     /releases any other pin/.test(ui));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
