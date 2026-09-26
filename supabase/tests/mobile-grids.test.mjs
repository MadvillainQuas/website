/* ============================================================================
   THE PHONE LAYOUT PUTS THE RIGHT NUMBER OF CARDS ON A ROW.

   All three sections once asked for a 178–230px minimum column, which on a
   390px screen resolves to ONE column: five news articles became five
   full-width plates, twelve clubs became twelve, and the three monthly stars
   sat above the three weekly ones in a column six long.

   WHAT "RIGHT" IS HAS MOVED TWICE SINCE, and this file holds the reasoning
   rather than a snapshot of a grid:

     · the clubs and the stars became SNAP-SCROLLING RAILS on a phone — a row
       that pans rather than a grid that shrinks — so their cards keep a real
       width instead of four to a 390px screen;
     · the news cards went the other way (2026-09-18). Three across gave each
       112px: a headline clamped to two lines of 11px type, a date ellipsised
       to "13/09…" and a byline reading "EPINOIΛ MATCH RE…". Below 560px one
       card takes the row; between 560 and 720 they pair up.

   The trap worth a test is the CASCADE. The base .news-title is declared
   further down news.css at the same specificity, so a mobile override written
   above it — as the neighbouring media queries are — simply loses, and the
   cards keep a headline sized for a desktop card. Position in the file is
   load-bearing here, which nothing about the rule itself tells you.

     node supabase/tests/mobile-grids.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const news = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'news.css'), 'utf8');
const home = readFileSync(path.join(ROOT, 'epinoia', 'index.html'), 'utf8');
const card = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'card.css'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- news: two on a small tablet, one on a phone --------------------------- */
/* the tablet block ENDS where the phone block begins: sliced to the end of the file it
   picks up the phone's own 16px headline and calls it the tablet's */
const at720 = news.indexOf('@media (max-width:720px)');
const at560 = news.lastIndexOf('@media (max-width:560px)');
const mob = news.slice(at720, at560 > at720 ? at560 : undefined);
const phone = news.slice(at560);
/* the first font-size a selector is given inside a block — the rule that decides the
   headline, whatever the rest of the declaration looks like */
const size = (block, sel) => {
  const at = block.indexOf(sel + ',');
  const start = at >= 0 ? at : block.indexOf(sel + '{');
  if (start < 0) return null;
  const m = /font-size:\s*([\d.]+)px/.exec(block.slice(start, block.indexOf('}', start) + 1));
  return m ? parseFloat(m[1]) : null;
};

ok('the news grid divides into six on a phone',
   /\.news-grid\{[\s\S]{0,160}grid-template-columns:repeat\(6,1fr\)/.test(mob));
ok('...two cards to a row on a small tablet, with the lead one across the top',
   /\.news-grid > \.news-card\{grid-column:span 3\}/.test(mob) &&
   /\.news-grid > \.news-card:first-child\{grid-column:span 6\}/.test(mob));
ok('...and one to a row on a phone, the lead card included',
   /\.news-grid > \.news-card,\s*\.news-grid > \.news-card:first-child\{grid-column:1 \/ -1\}/.test(phone));
ok('...where the headline is big enough to read at arm’s length',
   (size(phone, '.news-title') || 0) >= 16, 'phone headline ' + size(phone, '.news-title') + 'px');
ok('...and the standfirst comes back, now there is room for it',
   /\.news-grid > \.news-card \.news-stand\{display:-webkit-box/.test(phone));
ok('the phone block comes after the tablet one, so it is the one that applies',
   news.lastIndexOf('@media (max-width:560px)') > news.indexOf('@media (max-width:720px)'));

/* THE CASCADE. Both rules are (0,1,0); the later one wins. */
const baseTitle = news.indexOf('.news-title{');
const mobileBlock = news.indexOf('@media (max-width:720px)');
ok('the mobile block sits AFTER the base .news-title, or it loses the cascade',
   mobileBlock > baseTitle, 'mobile at ' + mobileBlock + ', base at ' + baseTitle);
ok('...and it does size the headline for the card it is in',
   (size(mob, '.news-title') || 0) >= 13 && (size(mob, '.news-title') || 99) <= 15,
   'tablet headline ' + size(mob, '.news-title') + 'px');

/* ---- clubs and stars ------------------------------------------------------ */
const hmob = home.slice(home.indexOf('@media (max-width:720px)'));
/* A RAIL, NOT A GRID. Four clubs across 390px is a 79px card; a row that pans
   keeps each one a real size and still shows there are more. */
ok('the clubs pan rather than shrink, and each card keeps a width',
   /\.clubgrid\{[\s\S]{0,200}overflow-x:auto[\s\S]{0,200}scroll-snap-type:x/.test(hmob) &&
   /\.clubgrid \.club\{flex:0 0 \d+px;scroll-snap-align:start\}/.test(hmob));
ok('and so do the stars, so monthly and weekly are two rails not a column of six',
   /\.stargrid\{[\s\S]{0,200}overflow-x:auto[\s\S]{0,200}scroll-snap-type:x/.test(hmob) &&
   /\.stargrid \.star\{flex:0 0 \d+px;\s*scroll-snap-align:start\}/.test(hmob));
ok('...with no scrollbar drawn across either', /\.clubgrid::-webkit-scrollbar\{display:none\}/.test(hmob) &&
   /\.stargrid::-webkit-scrollbar\{display:none\}/.test(hmob));

/* A star card names a player and a club, which are not .club-name — the first
   attempt scaled a class the star cards do not use. */
ok('the star name is scaled by the class star cards actually carry',
   /\.stargrid \.star-name\{font-size:/.test(hmob));
ok('...and so is the club under it', /\.stargrid \.star-team\{font-size:/.test(hmob));
ok('the crest monogram comes down too, or it swamps a 79px card',
   /\.clubgrid \.club-mono\{font-size:clamp\(/.test(hmob));

/* ---- a card is the size of its track, not the size of its caption ---------- */
/* The rail hands every club card flex:0 0 128px, and every plate is aspect-ratio:1, so on a
   phone the twenty EuroLeague clubs should have been twenty identical squares. Five of them
   were not: a flex item's automatic minimum is its whole content, the caption is nowrap, and
   "Crvena Zvezda Meridianbet Belgrade" floored its card at 182px — which the square plate then
   matched in height, so the card grew in both directions (reported 2026-09-18, measured on the
   live EuroLeague page: 128 / 137 / 139 / 155 / 160 / 182).

   flex-basis alone does not say this. Only min-width:0 lets the card sit on its track and the
   caption ellipsis, which is exactly what .club-ed already had to do. */
ok('the club card can never be widened by its own caption',
   /\.club\{[^}]*min-width:0/.test(card));
ok('...and the caption gives way instead of pushing',
   /\.club-name\{[^}]*min-width:0/.test(card));
ok('...which only works because the caption can ellipsis',
   /\.club-name\{[^}]*text-overflow:ellipsis/.test(card) &&
   /\.club-name\{[^}]*white-space:nowrap/.test(card));
/* the same floor, already fixed once on the byline — if it regresses the news cards go too */
ok('the edition byline keeps the fix it was given first',
   /\.club-ed\{[^}]*min-width:0/.test(card));

/* ---- the desktop layout is untouched -------------------------------------- */
ok('the desktop news layout still leads with one wide card',
   /@media \(min-width:1000px\)[\s\S]{0,220}first-child\{grid-column:span 3\}/.test(news));
ok('and the desktop grids fill the row: three podium cards and seven more share the width, the directory\'s columns stretch (nothing capped at 240px and packed left)',
   /@media \(min-width:1100px\)\{ \.stargrid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\} \}/.test(home)
   && /@media \(min-width:1100px\)\{ \.stargrid\.starmore\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)\} \}/.test(home)
   && !/minmax\(178px,240px\)|justify-content:start/.test(home) && !/minmax\(178px,240px\)/.test(card));

/* ---- one or two cards are not blown up to fill the row ---------------------- */
{
  const kitHome = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'home.css'), 'utf8');
  const rule = c => new RegExp('\\.' + c + ':not\\(:has\\(> :nth-child\\(3\\)\\)\\)\\{grid-template-columns:repeat\\(3,minmax\\(0,1fr\\)\\)\\}');
  ok('a club directory of one or two clubs keeps the size of a row of three (kit and league page)', rule('clubgrid').test(kitHome) && rule('clubgrid').test(home));
  ok('...and so does a podium of one or two stars (never the smaller ranks 4-10)', /\.stargrid:not\(\.starmore\):not\(:has\(> :nth-child\(3\)\)\)\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/.test(kitHome) && !/\.starmore:not\(:has/.test(kitHome));
  ok('...and the Instagram tiles', rule('ig-grid').test(card));
  ok('...only from 721px up: on a phone they are rails', /@media \(min-width:721px\)\{ \.clubgrid:not/.test(kitHome));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
