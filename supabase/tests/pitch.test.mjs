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

/* ---- 1. the slide exists, and leads ---------------------------------------- */
console.log('\nthe deployment slide is what a buyer lands on');

ok('there is a deploy pane', /id="pane-deploy"/.test(learn));
ok('...and it is the one that opens',
   /<div class="pane on" id="pane-deploy">/.test(learn),
   'somebody arriving from the splash is deciding whether this is for them');
ok('...the other panes do not also open',
   (learn.match(/class="pane on"/g) || []).length === 1);
ok('its tab is first', learn.indexOf('data-p="deploy"') < learn.indexOf('data-p="use"'));

/* the tab machinery is generic, so a third tab needs no JS change — but the
   pane id and the tab key have to agree or the tab does nothing */
['deploy', 'use', 'how'].forEach(k => {
  ok(`tab "${k}" has a pane`, learn.includes(`data-p="${k}"`) && learn.includes(`id="pane-${k}"`));
});

/* ---- 2. both models are pitched ------------------------------------------- */
console.log('\nboth deployment models are named and scoped');

ok('model 01 is the managed platform', /Managed competition platform/.test(learn));
ok('model 02 is production and syndication',
   /Statistics production &amp; syndication/.test(learn));
ok('each says who it is for', (learn.match(/class="who"/g) || []).length === 2);
ok('each lists a scope of deployment',
   (learn.match(/Scope of deployment/g) || []).length === 2);

/* The distinction the whole page turns on: one hosts the public surface, the
   other does not. If the copy stops making that difference, the slide is just
   two lists. */
ok('model 02 promises the league keeps its own site',
   /your site stays yours/i.test(learn));
ok('model 01 promises a site it does not have',
   /no website/i.test(learn));

/* ---- 3. every framed URL resolves to something real ----------------------- */
console.log('\nevery live frame points at a page that exists');

const srcs = [...learn.matchAll(/<iframe[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
ok('the slide loads frames at all', srcs.length >= 5, `${srcs.length} found`);

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
ok('...and after a tab switch, when a hidden card first gets a width',
   /tabs\.forEach\(t => t\.addEventListener\('click', \(\) => setTimeout\(fitShots/.test(learnJs));

/* A grid track's implicit minimum is min-content, so a 1280px frame in a `1fr`
   column drags the whole slide sideways. Measured at 219px of spill before. */
ok('the model grid cannot be widened by its own contents',
   /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(learn),
   'plain 1fr lets a wide frame grow its own column');

/* The scaled frames are pictures, not controls — a page that captures a scroll
   or a tab is a trap inside a sales slide. The widgets are the exception, and
   are deliberately left live. */
ok('scaled frames do not take pointer input', /\.port iframe\{[^}]*pointer-events:none/.test(learn));
ok('...and are out of the tab order',
   (learn.match(/tabindex="-1"/g) || []).length >= 3);
ok('every frame is lazy', (learn.match(/loading="lazy"/g) || []).length === srcs.length);
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
