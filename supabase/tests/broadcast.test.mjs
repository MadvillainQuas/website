/* ============================================================================
   THE GRAPHICS LAYER, AND THE THINGS THAT WOULD PUT A HOLE IN A PROGRAMME.

   A web page that breaks gets a refresh. A graphics layer that breaks is on air,
   over a game, in front of everybody, and the person who could fix it is the one
   holding the camera. So the failure modes worth a test here are not the ones a
   browser would shout about — they are the quiet ones:

     · a URL parameter defaulted in the TEST and not in the USE, which threw at
       module scope and took the whole file with it. That bug shipped once
       already; it is the reason this file exists.
     · a select naming a column a database one migration behind does not have,
       which 400s and blanks the layer over three fields that decorate a header
     · a scene name that no longer exists, published from the control room
     · a graphic that renders nothing rather than obviously nothing

     node supabase/tests/broadcast.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const layer   = rd('epinoia', 'broadcast', 'broadcast.js');
const layerH  = rd('epinoia', 'broadcast', 'index.html');
const control = rd('epinoia', 'broadcast', 'control', 'control.js');
const fn      = rd('supabase', 'functions', 'broadcast', 'index.ts');
const gameJs  = rd('epinoia', 'game', 'game.js');
const scorer  = rd('epinoia', 'score', 'index.html');
const offUi   = rd('epinoia', 'admin', 'officials-ui.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- 1. no parameter is defaulted in the test but not in the use ---------- */
console.log('\na URL parameter cannot throw at module scope');

/* The shipped bug, exactly: `(qp.get('pos') || 'bl')` was TESTED with a default
   and then READ without one, so every URL omitting pos threw before
   window.EpinoiaBroadcast was ever assigned. Catch the shape, not the instance. */
const risky = [];
layer.split('\n').forEach((l, i) => {
  /* a defaulted read used as a guard, and a bare read on the same line */
  if (/qp\.get\('([a-z]+)'\)\s*\|\|/.test(l)) {
    const key = l.match(/qp\.get\('([a-z]+)'\)\s*\|\|/)[1];
    const bare = new RegExp("qp\\.get\\('" + key + "'\\)\\s*\\.");
    if (bare.test(l)) risky.push(`${i + 1}: ${l.trim()}`);
  }
});
ok('no line defaults a parameter and then dereferences it unguarded',
   risky.length === 0, risky.join('\n          '));

ok('the position is resolved once, into a variable',
   /const pos = String\(qp\.get\('pos'\) \|\| 'bl'\)\.toLowerCase\(\);/.test(layer));
ok('...and validated against a list', /POSITIONS\.includes\(pos\)/.test(layer));

/* ---- 2. an optional column cannot blank the layer ------------------------ */
console.log('\na database one migration behind costs a garnish, not the graphic');

const optional = ['capacity', 'attendance', 'officials'];
optional.forEach(col => {
  /* wherever these are asked for, it must not be in the same select as the
     things the graphic cannot do without */
  const core = layer.match(/const CORE = [\s\S]*?;/);
  ok(`the layer's core select does not name ${col}`,
     !!core && !core[0].includes(col), core ? core[0].slice(0, 120) : 'no CORE');
});
ok('...they are asked for separately and their absence is caught',
   /select=attendance,capacity,officials[\s\S]{0,200}catch/.test(layer));
ok('the public game page does the same',
   /select=capacity,attendance,officials[\s\S]{0,160}catch/.test(gameJs),
   'asking for them in the main select 400s the whole page — that shipped once');
ok('...and so does the season export',
   /GCORE \+ ',capacity,attendance,officials'[\s\S]{0,220}catch/.test(rd('epinoia', 'admin', 'export-ui.js')));

/* ---- 3. the scene list agrees at both ends ------------------------------- */
console.log('\nthe control room cannot call a scene the layer does not have');

const layerScenes = [...layer.matchAll(/^\s{2}([a-z]+)\(st\)\s*\{/gm)].map(m => m[1]);
/* Read the SCENES table alone. GROUPS sits beside it in the same shape, so a
   file-wide match would call "pre", "live" and "post" scenes and then demand
   the layer implement them. */
const ctlTable = control.slice(control.indexOf('const SCENES = ['),
                               control.indexOf('];', control.indexOf('const SCENES = [')));
const ctlScenes = [...new Set([...ctlTable.matchAll(/\['([a-z]+)',\s*'(?:pre|live|post)'/g)]
  .map(m => m[1]))];
ok('the layer defines scenes', layerScenes.length >= 8, layerScenes.join(', '));
ctlScenes.forEach(s =>
  ok(`  control's "${s}" exists in the layer`, layerScenes.includes(s)));
ok('every layer scene is offered in the control room',
   layerScenes.every(s => ctlScenes.includes(s)),
   'unreachable: ' + layerScenes.filter(s => !ctlScenes.includes(s)).join(', '));
/* and an unknown name must leave air alone rather than blanking it */
ok('an unknown scene name is ignored rather than rendered',
   /if \(!SCENES\[frame\.scene\]\) return;/.test(layer));

/* ---- 4. the two ends of the live channel agree --------------------------- */
console.log('\nthe control room and the layer meet on the same channel');

ok('the control room publishes on bcast:<game>', /channel\('bcast:' \+ gameId\)/.test(control));
ok('the layer listens on bcast:<game>', /watch\('bcast:' \+ gameId/.test(layer));
ok('...on the same event name',
   /event: 'scene'/.test(control) && /event !== 'scene'/.test(layer));
ok('the layer only listens when asked to', /const LIVE_SCENE = qp\.get\('live'\) === '1';/.test(layer));

/* The control room must never become a single point of failure for the
   graphics: every scene has a plain URL that works with this page shut. */
ok('every scene also has a fixed URL', /function sceneURL\(scene, live, opts\)/.test(control));
ok('...and the operator is told to prefer it when the hall is unreliable',
   /never depend on this page being open/.test(control));

/* ---- 5. crests fall back rather than leaving a hole ---------------------- */
console.log('\na crest that 404s leaves the initials, not a gap');

ok('the monogram is painted first', /<span class="mono">/.test(layer));
ok('...and the crest only replaces it once it has loaded',
   /onload=[^>]*hascrest/.test(layer));
ok('...which is what the stylesheet keys off',
   /\.badge\.hascrest \.crest\{[^}]*opacity:1/.test(layerH) &&
   /\.badge\.hascrest \.mono\{opacity:0\}/.test(layerH));
ok('the club colour is an edge, never the plate',
   /border-left:\.55vmin solid var\(--tc\)/.test(layerH),
   'a fill in a club colour over a court in the same colour is invisible');

/* ---- 6. the numbers on air are defensible -------------------------------- */
console.log('\nno graphic puts a small sample on air as a fact');

ok('lineups have a minutes floor', /const LINEUP_MIN = \d+;/.test(layer));
ok('...and lead with plus/minus, not net rating',
   /b\.pm - a\.pm/.test(layer),
   'a four-minute unit at +6 is +139 by net rating, which reads as a mistake');
ok('ranked graphics use the whole squad, not the five on court',
   /function squadPool\(st\)/.test(layer) && /st\.home\.squad\.map/.test(layer),
   'a top-scorers graphic that omits whoever just came off is wrong exactly ' +
   'when a director reaches for it');
ok('...and exclude players who have not played',
   /filter\(p => p\.min > 0 \|\| p\.pts/.test(layer));

/* ---- 7. the pre-tip state is presentable --------------------------------- */
console.log('\na fixture that has not tipped is worth laying out');

ok('the clock shows the period length before tip, not zero',
   /if \(!started && !clockMs && E\.PLEN\) clockMs = E\.PLEN\(period\);/.test(layer),
   'somebody laying a scorebug out an hour early is exactly who sees this');
ok('the game page offers priming from the fixture', /Prime for broadcast/.test(gameJs));
ok('...behind a caret, not a second button',
   /IT IS A CARET, NOT A SECOND BUTTON/.test(gameJs));

/* ---- 8. the endpoint mirrors the layer ----------------------------------- */
console.log('\nthe polled document is the same document');

['periodLabel', 'periodFouls', 'bonus', 'timeoutsLeft', 'lastPlay', 'possessionArrow']
  .forEach(f => ok(`  both ends carry ${f}`, layer.includes(f) && fn.includes(f)));
ok('both format the clock the same way',
   /if \(t < 60000\) return \(Math\.floor\(t \/ 100\) \/ 10\)\.toFixed\(1\);/.test(layer) &&
   /if \(t < 60000\) return \(Math\.floor\(t \/ 100\) \/ 10\)\.toFixed\(1\);/.test(fn));
ok('the endpoint refuses to be cached', /no-store, must-revalidate/.test(fn));

/* ---- 9. officials: a list, and still a keyboard -------------------------- */
console.log('\nthe officials list never blocks a game being scored');

ok('the scorer offers the league list', /officials_for_game/.test(scorer));
ok('...and keeps every field typeable', /type a name…/.test(scorer));
ok('...falling back to plain text when the list is empty or unreachable',
   /if\(!able\.length\)\{[\s\S]{0,120}sel\.hidden = true; input\.hidden = false;/.test(scorer));
ok('...and when the list will not load at all',
   /officials list unavailable/.test(scorer),
   'a list that fails must not take the match details with it');
ok('a name already recorded but not on the list survives',
   /a name already recorded that is not on the list stays visible/.test(scorer));
ok('the admin deactivates rather than deletes',
   /deactivate/.test(offUi) && !/\.delete\(\)/.test(offUi),
   'a referee who stops officiating still refereed fourteen games');

/* ---- 10. pre-game works before a ball is thrown -------------------------- */
console.log('\nthe twenty minutes before tip are served');

const pre = ['fixture', 'starters', 'lineup', 'officials'];
pre.forEach(sc => ok(`  the layer has a "${sc}" scene`, layerScenes.includes(sc),
  'has: ' + layerScenes.join(', ')));
ok('the control room groups them before tip',
   /\['fixture',\s*'pre'/.test(control) && /\['officials',\s*'pre'/.test(control));
ok('there are TWO squad screens, one per club',
   (control.match(/\['lineup',\s*'pre'/g) || []).length === 2,
   'one screen cannot show both squads at a readable size');
ok('...told apart by side, not by scene name',
   /keyOf = \(scene, opts\)/.test(control) && /\{ side: '1' \}/.test(control));

ok('squads are fetched when there is no snapshot yet',
   /if \(game\.roster_snapshot && game\.roster_snapshot\.teams\) return;/.test(layer),
   'roster_snapshot is frozen at tip and does not exist before it');
ok('...and the snapshot still wins once it exists',
   /the snapshot is the truth once it exists/.test(layer));
ok('the starting-five graphic does not invent a five',
   /const picked = \(st\.starters\[0\] \|\| \[\]\)\.length/.test(layer),
   'showing the first five shirt numbers as a starting five would be wrong ' +
   'roughly one game in three');

/* ---- 11. photographs, and the hole they must not leave ------------------- */
console.log('\na photograph that fails leaves initials, not a gap');

ok('photos come from the approved media row', /media:photo_media_id\(storage_path\)/.test(layer));
ok('...with a pasted URL as the fallback', /stored \|\| r\.photo_url/.test(layer));
ok('...and the platform decides who may be shown, not this file',
   /an unapproved or unconsented photograph simply is not in the answer/.test(layer),
   'filtering minors on the client would be a second implementation of ' +
   'something the database already enforces');
ok('initials are painted first and the photo loads on top',
   /<span class="ini">/.test(layer) && /onload=[^>]*hasface/.test(layer));
ok('...which the stylesheet keys off',
   /\.face\.hasface img\{opacity:1\}/.test(layerH) &&
   /\.face\.hasface \.ini\{opacity:0\}/.test(layerH));

/* backdrop-filter washed every plate out — measured, then removed */
ok('no card uses backdrop-filter',
   !/\.card,\.bug\{[\s\S]*?backdrop-filter:blur/.test(layerH),
   'it sampled the transparent page and lightened the whole graphic');

/* ---- 12. driving the mixer ----------------------------------------------- */
console.log('\nthe control room drives the mixer, and survives without one');

const mix = rd('epinoia', 'broadcast', 'control', 'mixers.js');
ok('obs-websocket v5 is spoken directly', /op === 0/.test(mix) && /op === 2/.test(mix));
ok('...with the documented challenge',
   /sha256b64\(password \+ salt\)/.test(mix) && /sha256b64\(secret \+ challenge\)/.test(mix));
ok('...and the primitive is checked against known digests, not assumed',
   /checked against known SHA-256/.test(mix));
ok('a request cannot hang a button for ever', /timed out/.test(mix));
ok('building the layout is re-runnable',
   /RE-RUNNABLE ON PURPOSE/.test(mix) && /SetInputSettings/.test(mix),
   'a director presses it twice; the second press must not duplicate the sources');
ok('hidden sources shut down rather than holding a socket',
   /shutdown: true/.test(mix));

ok('vMix is driven over its web controller', /OverlayInput/.test(mix));
ok('...and the page does not pretend to know it worked',
   /a command that fails looks exactly\s+like one that worked/.test(mix),
   'vMix answers without CORS headers, so the reply cannot be read');

ok('the CSP permits a local mixer socket',
   /ws:\/\/localhost:\*/.test(rd('epinoia', 'broadcast', 'control', 'index.html')));
ok('...and why that is allowed at all is written down',
   /potentially trustworthy origin/.test(mix));

ok('a missing mixer is not a failure',
   /NOTHING HERE IS LOAD-BEARING/.test(mix));
ok('...and take never interrupts a game to complain about OBS',
   /the live layer has already changed/.test(rd('epinoia', 'broadcast', 'control', 'control.js')));

/* ---- 13. the exported files are the same rundown -------------------------- */
console.log('\nthe exports describe the same graphics');

const ctl = rd('epinoia', 'broadcast', 'control', 'control.js');
ok('an OBS scene collection is written', /function obsCollection\(\)/.test(ctl));
ok('...every source at 1920x1080', /width: 1920, height: 1080/.test(ctl));
ok('...with only the scorebug visible',
   /visible: keyOf\(key, opts\) === 'scorebug'/.test(ctl));
ok('a vMix preset is written', /function vmixPreset\(\)/.test(ctl));
ok('...describing inputs only',
   /would overwrite the cameras/.test(ctl),
   'a preset describing the whole production is a thing you do to somebody once');
ok('and a plain URL list, for everything else', /function urlList\(\)/.test(ctl));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
