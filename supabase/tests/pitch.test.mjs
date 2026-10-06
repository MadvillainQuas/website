/* ============================================================================
   THE SALES PAGE SHOWS THE LIVE PRODUCT, SO IT CANNOT GO STALE.

   The deployment slide on /learn/ sells two things — a hosted competition site,
   and the statistics pipeline syndicated into a site the league already has —
   and it illustrates both with the real product rather than screenshots. A
   screenshot of a platform that ships this often is out of date the week after
   it is taken, and a prospect who spots that has learned something true about
   how closely the marketing tracks the software.

   That choice has a cost this file exists to cover: a framed page is a URL,
   and a URL rots. If a route is renamed, a screenshot merely becomes old, but
   a live frame becomes an error page inside a sales pitch. So every frame the
   slide loads is checked to resolve to something that actually exists here.

   It also checks the claims. The spec table makes specific technical
   assertions — an append-only log, row-level safeguarding, partner push on
   finalisation — and each one is asserted against the thing in this repository
   that makes it true, so a claim cannot outlive its implementation.

     node supabase/tests/pitch.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const learn = rd('epinoia', 'learn', 'index.html');
const learnJs = rd('epinoia', 'learn', 'learn.js');
const scorer = rd('epinoia', 'score', 'index.html');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- 1. the page's tabs (rebuilt 2026-10-06: Overview, Platform, Data & models, Deploy, Contact) ------------- */
console.log('\nthe tabs: the case first, every tab a pane, the contact form last');

/* Read the tabs OFF THE PAGE rather than naming them here, so a new tab is checked without a test change. */
const tabKeys = [...learn.matchAll(/<button type="button" data-t="([a-z-]+)"/g)].map(m => m[1]);
const paneKeys = [...learn.matchAll(/<div class="lm-pane" data-p="([a-z-]+)"/g)].map(m => m[1]);
ok('the case for it leads: Overview is the first tab', tabKeys[0] === 'overview', tabKeys.join(','));
ok('...and the contact form is a tab of its own', tabKeys.includes('contact') && /<form id="form"/.test(learn));
ok('every tab has a pane, and every pane a tab', tabKeys.length >= 4 && tabKeys.join() === paneKeys.join(), tabKeys.join() + ' / ' + paneKeys.join());
ok('only the first pane opens without the script', !/<div class="lm-pane" data-p="overview" hidden/.test(learn) &&
   paneKeys.slice(1).every(k => new RegExp('<div class="lm-pane" data-p="' + k + '" hidden>').test(learn)));
ok('learn.js knows the same tabs', /const TABS = \['overview', 'platform', 'data', 'deploy', 'contact'\]/.test(learnJs));
ok('...and the addresses the page had before still land (?t=who, ?t=new, ?t=how)', /OLD = \{ who: 'overview', new: 'platform', how: 'data' \}/.test(learnJs));
ok('/contact/ forwards to the Contact tab, keeping its topic',
   /searchParams\.set\('t', 'contact'\)/.test(rd('epinoia', 'contact', 'go.js')) && /searchParams\.set\('topic', topic\)/.test(rd('epinoia', 'contact', 'go.js')) &&
   /<script src="go\.js/.test(rd('epinoia', 'contact', 'index.html')));
ok('the form is contact.js\'s, loaded by the page', /<script src="\.\.\/contact\/contact\.js/.test(learn));
['form', 'topic', 'privacyBox', 'pkind', 'pcap', 'name', 'email', 'subjectRow', 'subject', 'bodyLabel', 'body', 'count', 'max', 'website', 'send', 'msg']
  .forEach(id => ok('  the form has #' + id, learn.includes('id="' + id + '"')));

/* ---- 2. both models are pitched ------------------------------------------- */
console.log('\nboth deployment models are named and scoped');

ok('the managed platform', /Managed platform<\/span><h3>Your competition, run on Epinoia/.test(learn));
ok('data production and syndication', /Data production and syndication<\/span><h3>Your site, our statistics/.test(learn));
ok('one promises the league keeps its own site', /has a website and intends to keep it/i.test(learn));
ok('the other promises a site it does not have', /no website/i.test(learn));
ok('the live figures and the leagues are read, not typed', /async function figures\(\)/.test(learnJs) && /function coverage\(leagues\)/.test(learnJs) &&
   /id="kpis"/.test(learn) && /id="cov"/.test(learn));

/* ---- 3. every framed URL resolves to something real ----------------------- */
console.log('\nevery live frame points at a page that exists');

const srcs = [...learn.matchAll(/<iframe[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
ok('the page loads frames at all', srcs.length >= 5, `${srcs.length} found`);

srcs.forEach(src => {
  const clean = src.replace(/&amp;/g, '&').split('?')[0];   // strip the query
  /* ../l/ -> epinoia/l/index.html */
  const rel = clean.replace(/^\.\.\//, '');
  const file = path.join(ROOT, 'epinoia', rel.endsWith('/') ? rel + 'index.html' : rel);
  ok(`  ${clean} exists`, existsSync(file), file);
});

/* A frame is only proof if it is the real product. A path outside epinoia/, or
   an absolute URL to somewhere else, would be a mock dressed as evidence. */
ok('no frame reaches outside this origin',
   srcs.every(s => !/^https?:/i.test(s)), srcs.filter(s => /^https?:/i.test(s)).join(' '));

/* the two widget kinds the syndication model actually sells */
ok('the ticker is shown live', srcs.some(s => /embed\/strip\//.test(s)));
ok('a box score is shown live', srcs.some(s => /embed\/game\//.test(s)));
ok('standings are shown live', srcs.some(s => /embed\/table\/.*standings/.test(s)));
ok('the hosted site is shown', srcs.some(s => /\.\.\/l\//.test(s)));
ok('the scoring app is shown', srcs.some(s => /score\/\?train=1/.test(s)));

/* ---- 4. the frames are sized, not squeezed -------------------------------- */
console.log('\na framed page renders at the width it was designed for');

ok('learn.js scales the framed pages', /function fitShots\(\)/.test(learnJs));
ok('...at a desktop width by default', /\+port\.dataset\.w \|\| 1280/.test(learnJs));
ok('...and re-runs on resize', /addEventListener\('resize', fitShots/.test(learnJs));
ok('...and after a tab switch, when a hidden card first gets a width', /setTimeout\(fitShots, 0\)/.test(learnJs));

/* A grid track's implicit minimum is min-content, so a 1280px frame in a `1fr`
   column drags the whole slide sideways. Measured at 219px of spill before. */
const css = rd('epinoia', 'kit', 'learn.css');
ok('the model grid cannot be widened by its own contents', /\.lm-grid\.two\{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\) \}/.test(css) &&
   /\.lm-card\{[^}]*min-width:0/.test(css), 'a card must be allowed to be narrower than its frame');

/* The scaled frames are pictures, not controls — a page that captures a scroll
   or a tab is a trap inside a sales slide. The widgets are the exception, and
   are deliberately left live. */
ok('scaled frames do not take pointer input', /\.port iframe\{[^}]*pointer-events:none/.test(css));
ok('...and are out of the tab order',
   (learn.match(/tabindex="-1"/g) || []).length >= 3);
/* Count the attribute ON THE TAGS IT IS ABOUT. Comparing a page-wide count of
   loading="lazy" against the number of frames held only while the page had no
   images; the moment the gallery arrived, thirteen lazy <img> tags made the
   totals disagree and the check failed for the one reason that was not a bug. */
const lazyOf = re => [...learn.matchAll(re)].filter(m => /loading="lazy"/.test(m[0])).length;
const frames = [...learn.matchAll(/<iframe\b[^>]*>/g)].length;
const imgs = [...learn.matchAll(/<img\b[^>]*>/g)].length;
ok('every frame is lazy', lazyOf(/<iframe\b[^>]*>/g) === frames,
   `${lazyOf(/<iframe\b[^>]*>/g)} of ${frames}`);
/* The gallery is half a megabyte of captures across four tabs. Eager, they would
   all be fetched for a reader who never leaves the first one. */
ok('...and so is every screenshot', imgs > 0 && lazyOf(/<img\b[^>]*>/g) === imgs,
   `${lazyOf(/<img\b[^>]*>/g)} of ${imgs}`);
/* A picture with no intrinsic size reflows the text under it when it lands. */
ok('...and each one reserves its space',
   [...learn.matchAll(/<img\b[^>]*>/g)].every(m => /width="\d+"/.test(m[0]) && /height="\d+"/.test(m[0])));
ok('every frame is described for a screen reader',
   (learn.match(/<iframe[^>]*\stitle="/g) || []).length === srcs.length);

/* ---- 5. the scorer can be framed without its own guide over it ------------- */
console.log('\nthe scoring app can be shown, not its documentation');

ok('the scorer honours ?guide=0', /const EP_GUIDE = .*get\('guide'\) !== '0'/.test(scorer));
ok('...and the demo guide is gated on it', /EP_TRAIN && !window\.__hvSeen && EP_GUIDE/.test(scorer));
ok('...anything other than an explicit 0 leaves the guide on',
   /!== '0'/.test(scorer), 'a missing param must not silently suppress it');
ok('the slide uses it', /score\/\?train=1&amp;guide=0/.test(learn));
ok('...but the call to action does not, so a real visitor still gets the guide',
   /href="\.\.\/score\/\?train=1"/.test(learn));

/* ---- 6. the claims are backed by something in this repository ------------- */
console.log('\nno claim outlives its implementation');

const claim = (what, re, file, backing) => {
  if (!re.test(learn)) { ok(`claim: ${what}`, false, 'the copy no longer makes this claim'); return; }
  ok(`claim: ${what}`, backing.test(rd(...file)), 'made on the slide, not found in ' + file.join('/'));
};

/* the retraction is a database concern, not an engine one: the engine replays
   whatever the log contains, and the log is what refuses to be edited */
claim('append-only event log', /append-only event log/i,
      ['supabase', 'migrations', '0027_event_retraction.sql'], /retract/i);
claim('one engine, shared by app, site and server', /one shared engine/i,
      ['supabase', 'functions', '_shared', 'engine.js'], /derive/);
claim('FIBA LiveStats import', /FIBA\s*<\/b>?\s*LiveStats|<b>FIBA\s+LiveStats<\/b>/i,
      ['epinoia', 'livestats.js'], /livestats|LiveStats/i);
claim('partner push on finalisation', /Partner push on finalisation/i,
      ['epinoia', 'api', 'index.html'], /scraper key/i);
claim('read-only JSON API with rate-limit headers', /rate-limit\s*<?\/?b?>?\s*headers/i,
      ['epinoia', 'api', 'index.html'], /X-RateLimit-Limit/);
claim('row-level safeguarding of minors', /row-level policy on the players/i,
      ['supabase', 'migrations', '0049_club_profile.sql'], /policy players_read on public\.players/);
claim('standings recomputed, not accumulated', /recomputed\s*<?\/?b?>?\s*from the log/i,
      ['supabase', 'migrations', '0074_recompute_needs_standing.sql'], /recompute_standings/);

/* And the one number on the page. The learn page already claimed it before this
   slide existed; it must keep meaning the same thing. */
/* Whitespace-normalised: the phrase is wrapped across two source lines in one
   of the two places it appears, which a naive match sees as absent. */
const flat = learn.replace(/\s+/g, ' ');
ok('the latency claim matches the rest of the page',
   (flat.match(/under a second behind/g) || []).length >= 2,
   'the slide and the older pane should not quote two different figures');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
