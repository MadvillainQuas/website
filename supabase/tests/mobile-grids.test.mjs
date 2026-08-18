/* ============================================================================
   THE PHONE LAYOUT PUTS THE RIGHT NUMBER OF CARDS ON A ROW.

   All three sections asked for a 178–230px minimum column, which on a 390px
   screen resolves to ONE column: five news articles became five full-width
   plates, twelve clubs became twelve, and the three monthly stars sat above
   the three weekly ones in a column six long. Measured in a 375px viewport
   after the change: news [2,3], clubs [4], stars [3,3].

   The trap worth a test is the CASCADE. The base .news-title is declared
   further down news.css at the same specificity, so the mobile override —
   written above it, as the neighbouring media queries are — simply lost, and
   the second row kept a 15px headline in a 166px card. Position in the file is
   load-bearing here, which nothing about the rule itself tells you.

     node supabase/tests/mobile-grids.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const news = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'news.css'), 'utf8');
const home = readFileSync(path.join(ROOT, 'epinoia', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- news: two, then three ------------------------------------------------ */
const mob = news.slice(news.indexOf('@media (max-width:720px)'));
ok('the news grid divides into six on a phone',
   /\.news-grid\{[\s\S]{0,160}grid-template-columns:repeat\(6,1fr\)/.test(mob));
ok('...the first two cards take half each — a row of two',
   /nth-child\(-n\+2\)\{grid-column:span 3\}/.test(mob));
ok('...and the rest take a third each — a row of three',
   /\.news-grid > \.news-card\{grid-column:span 2\}/.test(mob));

/* THE CASCADE. Both rules are (0,1,0); the later one wins. */
const baseTitle = news.indexOf('.news-title{');
const mobileBlock = news.indexOf('@media (max-width:720px)');
ok('the mobile block sits AFTER the base .news-title, or it loses the cascade',
   mobileBlock > baseTitle, 'mobile at ' + mobileBlock + ', base at ' + baseTitle);
ok('...and it does bring the headline down', /\.news-title\{font-size:11px/.test(mob));

/* ---- clubs and stars ------------------------------------------------------ */
const hmob = home.slice(home.indexOf('@media (max-width:720px)'));
ok('four clubs to a row',
   /\.clubgrid\{[\s\S]{0,120}grid-template-columns:repeat\(4,1fr\)/.test(hmob));
ok('three stars to a row, so monthly and weekly read as two rows',
   /\.stargrid\{[\s\S]{0,120}grid-template-columns:repeat\(3,1fr\)/.test(hmob));

/* A star card names a player and a club, which are not .club-name — the first
   attempt scaled a class the star cards do not use. */
ok('the star name is scaled by the class star cards actually carry',
   /\.stargrid \.star-name\{font-size:/.test(hmob));
ok('...and so is the club under it', /\.stargrid \.star-team\{font-size:/.test(hmob));
ok('the crest monogram comes down too, or it swamps a 79px card',
   /\.clubgrid \.club-mono\{font-size:clamp\(/.test(hmob));

/* ---- the desktop layout is untouched -------------------------------------- */
ok('the desktop news layout still leads with one wide card',
   /@media \(min-width:1000px\)[\s\S]{0,220}first-child\{grid-column:span 3\}/.test(news));
ok('and the desktop grids still cap their card width',
   /@media \(min-width:1100px\)[\s\S]{0,140}minmax\(178px,240px\)/.test(home));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
