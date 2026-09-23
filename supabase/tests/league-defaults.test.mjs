/* ============================================================================
   THREE THINGS A LEAGUE ADMIN KEPT HAVING TO FIX BY HAND (0148, 0149, the tab strip).

   1. A new league started with its Merchandise shelf on and empty, and had to be switched off in
      Appearance before the first visitor. The default of leagues.sections now hides it.
   2. The LNBP and the CIBACOPA send clubs in CAPITALS ("ABEJAS DE LEON"). names.py team_name()
      turns a shouted club back into a name for new clubs, and 0149 does the same to the clubs
      already stored. They are two implementations of one rule, so the lists they share are
      compared here: a particle or an acronym added to one and not the other would make the
      database and the ingest disagree about how a club is written.
   3. The game page's tab strip did not fit on a desktop (the last tab was cut off). It is fitted
      by measurement (game.js fitTabs), which needs the size hook in theme.css and no
      `transition: all` on the buttons, or the strip is measured half way through animating.

     node supabase/tests/league-defaults.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* ---- 1. a new league starts without its merchandise shelf ---------------------------------- */
console.log('\n1. merchandise is off for a new league');
{
  const m = read('supabase', 'migrations', '0148_new_leagues_start_without_merchandise.sql');
  ok('the default of leagues.sections hides merch',
     /alter column sections set default '\{"merch": false\}'::jsonb/.test(m));
  ok('...as a column default, so the console, the feed ingest and the scripts are all covered',
     !/create or replace function public\.create_league/.test(m));
  ok('it checks a league inserted with no sections, and one that names its own',
     /'zz-t148-a'/.test(m) && /'zz-t148-b'/.test(m) && /"news": false/.test(m));
  ok('RAISE has no format placeholders to miscount', !/raise exception '[^']*%/.test(m));
  const key = /merch:\s*'#merchSec'/.test(read('epinoia', 'home.js'));
  ok('"merch" is the key the league page reads, and false is what hides it', key &&
     /sections\[k\] = false|\[k\] !== false|!== false/.test(read('epinoia', 'admin', 'appearance-ui.js')));
}

/* ---- 2. club names in capitals ------------------------------------------------------------- */
console.log('\n2. a shouted club is written as a name, in the ingest and in the database');
{
  const py = read('scripts', 'ingest', 'names.py');
  const sql = read('supabase', 'migrations', '0149_club_names_in_title_case.sql');
  const pyList = (name) => {
    const m = new RegExp(name + '\\s*=\\s*\\{([^}]*)\\}').exec(py);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
  };
  const sqlList = (name) => {
    const m = new RegExp(name + '\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]').exec(sql);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
  };
  const same = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  const acr = pyList('_CLUB_ACRONYMS');
  ok('the two implementations keep the same acronyms', acr.length > 10 && same(acr, sqlList('acronyms')),
     'py ' + acr.join(',') + '\n          sql ' + sqlList('acronyms').join(','));
  const lowerPy = (() => {
    const base = /_LOWER_PARTICLES\s*=\s*\{([^}]*)\}/.exec(py);
    const extra = pyList('_CLUB_LOWER'.replace('_CLUB_LOWER', '_CLUB_LOWER')) ;
    const more = /_CLUB_LOWER\s*=\s*_LOWER_PARTICLES\s*\|\s*\{([^}]*)\}/.exec(py);
    const grab = m => m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
    return grab(base).concat(grab(more));
  })();
  ok('...and the same lower-case particles', lowerPy.length > 15 && same(lowerPy, sqlList('particles')),
     'py ' + lowerPy.join(',') + '\n          sql ' + sqlList('particles').join(','));
  ok('only a name in capitals throughout is rewritten (a lower-case letter means it is the club\'s own spelling)',
     /p <> upper\(p\) or p = lower\(p\) then return p/.test(sql) && /_is_shouted\(s\)/.test(py));
  ok('a one-word name of four letters or fewer is an abbreviation, in both',
     /char_length\(btrim\(p\)\) <= 4/.test(sql) && /len\(s\) <= 4/.test(py));
  ok('the old spelling stays searchable as an alias, and slugs do not move',
     /array_append\(aliases, name\)/.test(sql) && !/set[^;]*slug\s*=/.test(sql));
  ok('printed codes (AGS, MBC) are left alone in short_name', /char_length\(short_name\) > 4/.test(sql));
  ok('the migration exercises the clubs that were shouting', /ABEJAS DE LEON/.test(sql) && /CORRECAMINOS UAT VICTORIA/.test(sql));
  ok('RAISE has no format placeholders to miscount', !/raise exception '[^']*%/.test(sql));
  const fp = read('scripts', 'ingest', 'feedplatform.py');
  ok('a new club is created through team_name(), so every league gets the rule',
     /nice = names\.team_name\(raw_name\)/.test(fp));
}

/* ---- 3. the game page's tab strip fits on a desktop ---------------------------------------- */
console.log('\n3. the tab strip');
{
  const js = read('epinoia', 'game', 'game.js');
  const css = read('epinoia', 'game', 'theme.css');
  ok('game.js fits the strip by measurement, between 9px and 12px', /function fitTabs\(\)/.test(js) &&
     /let lo = 9, hi = 12;/.test(js));
  ok('...only above the phone breakpoint, where the strip scrolls as it always did',
     /window\.innerWidth <= 820\) return;/.test(js));
  ok('...refitted on resize, on a new tab, and when the fonts arrive',
     /addEventListener\('resize', queueTabFit\)/.test(js) && /new MutationObserver/.test(js) && /fonts\.ready\.then\(queueTabFit\)/.test(js));
  ok('a timeout, not requestAnimationFrame: a hidden tab does not run frames', /setTimeout\(fitTabs, 30\)/.test(js) && !/requestAnimationFrame\(fitTabs\)/.test(js));
  ok('theme.css reads the size, in em padding so it scales with the type',
     /@media \(min-width:821px\)\{[\s\S]*\.tabrow \.tabbtn\{ font-size:var\(--tabfs, 12px\); padding:\.9em \.75em/.test(css));
  ok('the buttons no longer transition every property (fitTabs would measure mid-animation)',
     /\.tabrow \.tabbtn\{[^}]*transition:background-color[^}]*\}/.test(css));
  ok('the strip names a short-label context for the languages that need one',
     /class="tabrow" style="flex-wrap:wrap" data-i18n-ctx="gtab"/.test(js));
  const boxcss = read('epinoia', 'boxscore.css');
  ok('boxscore.css (generated from the scorer) is not where the fix lives', !/--tabfs/.test(boxcss));
  for (const code of ['ja', 'es']) {
    const src = read('epinoia', 'i18n', code, 'game.js');
    const sec = (/gtab:\s*\{([\s\S]*?)\n\s*\}/.exec(src) || [])[1] || '';
    const tabs = [...js.matchAll(/\['(?:report|halftime|box|pbp|shots|adv|lineups|flow|connections|events|shotclock|video)', '([^']+)'\]/g)].map(m => m[1]);
    const lacking = tabs.filter(t => sec.indexOf("'" + t + "'") < 0);
    ok(code + ' has a short form for every game tab (' + tabs.length + ')', tabs.length >= 12 && !lacking.length, lacking.join(', '));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
