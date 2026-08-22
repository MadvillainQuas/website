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
   /data-fade="hascrest"/.test(layer),
   "an inline onload here was refused by the page's own CSP — see section 14");
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

const pre = ['fixture', 'starters', 'squad', 'bench', 'officials'];
pre.forEach(sc => ok(`  the layer has a "${sc}" scene`, layerScenes.includes(sc),
  'has: ' + layerScenes.join(', ')));
ok('the control room groups them before tip',
   /\['fixture',\s*'pre'/.test(control) && /\['officials',\s*'pre'/.test(control));
ok('there are TWO squad screens, one per club',
   (control.match(/\['squad',\s*'pre'/g) || []).length === 2,
   'one screen cannot show both squads at a readable size');
ok('...told apart by side, not by scene name',
   /keyOf = \(scene, opts\)/.test(control) && /\{ side: '1' \}/.test(control));

ok('squads are fetched when there is no snapshot yet',
   /const snapped = !!\(game\.roster_snapshot && game\.roster_snapshot\.teams\);/.test(layer),
   'roster_snapshot is frozen at tip and does not exist before it');
ok('...and the snapshot still wins once it exists',
   /if \(snapped\) return mergeMeasurements\(\);/.test(layer));
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
   /<span class="ini">/.test(layer) && /data-fade="hasface"/.test(layer));
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

/* ---- 14. nothing on this page may rely on an inline handler -------------- */
console.log('\nthe CSP forbids inline handlers, so nothing may use one');

/* THE BUG THIS CATCHES SHIPPED AND WAS INVISIBLE. The crest, the face and the
   cut-out all revealed themselves from onload="..." attributes, and this page
   sets script-src 'self' — so the browser refused every one of them and each
   image stayed at opacity 0 behind its fallback. Nothing looked wrong: the
   monogram and the silhouette ARE the fallbacks, so every graphic rendered
   perfectly and simply never showed a photograph. */
ok('the layer sets script-src self', /script-src 'self'/.test(layerH));
ok('...and emits no inline event handler at all',
   !/\son[a-z]+=["']/.test(layer),
   (layer.match(/\son[a-z]+=["'][^"']{0,40}/) || [''])[0]);
ok('images ask for their reveal with a data attribute instead',
   (layer.match(/data-fade="/g) || []).length >= 3,
   'crest, face, cut-out and portrait — every image that fades in');
ok('...wired in script after every render', /function wireFades\(\)/.test(layer) &&
   /wireFades\(\);/.test(layer));
ok('...and a cached image, already complete, is handled too',
   /if \(img\.complete && img\.naturalWidth\) mark\(\);/.test(layer),
   'a cached image never fires load, so an onload attribute would miss it twice over');

/* ---- 15. the starting five, full frame ----------------------------------- */
console.log('\nthe five card is a picture, not an overlay');

ok('there is a full-frame five card', layerScenes.includes('five'));
ok('...offered for both clubs',
   (control.match(/\['five',\s*'pre'/g) || []).length === 2);
ok('...and it fills the frame rather than sitting in a corner',
   /\.fivecard\{[\s\S]{0,80}position:absolute;inset:0/.test(layerH));
ok('the club runs up a rail, leaving the width to the players',
   /writing-mode:vertical-rl/.test(layerH));
ok('the league mark sits on the rail, with the wordmark as a fallback',
   /leagueLogo\(\)/.test(layer) && /lgword/.test(layer));
ok('a squad shown before the fives are picked says so',
   /picked \? 'starting five' : 'squad'/.test(layer));

ok('a missing cut-out is a drawn figure, not a gap',
   /function silhouetteSVG\(\)/.test(layer));
ok('...built from primitives after a hand-written path came out wrong',
   /PRIMITIVES, NOT A HAND-WRITTEN PATH/.test(layer));
ok('...in the club colour rather than grey',
   /fill:color-mix\(in oklch, var\(--tc\)/.test(layerH));
ok('cut-outs are their own media kind, not the profile photograph',
   /kind = 'broadcast'/.test(rd('supabase', 'migrations', '0079_broadcast_media.sql')));
ok('...and only approved ones reach a graphic',
   /m\.status = 'approved'/.test(rd('supabase', 'migrations', '0079_broadcast_media.sql')));
ok('...fetched in one request rather than one per player',
   /rpc\/broadcast_images/.test(layer));

/* A cut-out is transparent by definition; JPEG has no alpha. */
const up = rd('epinoia', 'upload.js');
ok('a broadcast image keeps its alpha channel',
   /kind === 'logo' \|\| kind === 'broadcast'/.test(up),
   'encoded as JPEG a cut-out arrives on a flat black rectangle');
ok('...and is stored large enough to stand full height', /broadcast: 1200/.test(up));
ok('the admin panel refuses a JPEG before uploading it',
   /A JPEG cannot hold a transparent background/.test(rd('epinoia', 'admin', 'bcastimg-ui.js')));

/* ---- 16. the graphics are set in the platform's own faces ---------------- */
console.log('\nthe graphics look like the rest of the platform');

['Jersey25', 'Silkscreen', 'Archivo', 'MartianMono'].forEach(f =>
  ok(`  ${f} is loaded`, new RegExp("font-family:'" + f + "'").test(layerH)));
ok('...from the kit rather than a second copy',
   /url\('\.\.\/kit\/fonts\//.test(layerH));
ok('faces block rather than swap',
   /font-display:block/.test(layerH),
   'a swap reflows the caption while somebody is reading it, on air');
ok("the palette is the platform's own tokens", /--lume:#93f2bf/.test(layerH));
ok('labels are Silkscreen, uppercase and tracked, as everywhere else',
   /font-family:var\(--f-micro\);text-transform:uppercase;letter-spacing:\.18em/.test(layerH));
ok('figures are Martian Mono, as the tables are',
   /font-family:var\(--f-data\);font-variant-numeric:tabular-nums/.test(layerH));

/* ---- 17. position, height and weight beside each player ------------------ */
console.log('\nthe team sheet reads position, height, weight');

ok('the roster carries the measurements', /height: p\.height \|\| null/.test(layer));
ok('...fetched from the players table', /height_cm,weight_kg/.test(layer));
ok('...and the position from the roster entry, where it lives',
   /pos: r\.position \|\| ''/.test(layer));
ok('the five card prints them under the name', /vitalsHTML\(p\)/.test(layer));
ok('...position first, because that is what a commentator says first',
   /if \(p\.pos\) bits\.push/.test(layer));
ok('...and only what is recorded', /return bits\.length/.test(layer),
   'a club that has filled in nothing gets a name and a number, not a row of dashes');
ok('height is shown in feet and inches too', /function feetInches\(cm\)/.test(layer));
ok("...and 6'12\" is not a height anybody has ever been",
   /if \(inch === 12\) \{ ft \+= 1; inch = 0; \}/.test(layer));

/* the same figure is editable where a club secretary actually looks */
const teamJs = rd('epinoia', 't', 'team.js');
ok('position is editable on the team profile', /pos-in/.test(teamJs));
ok('...saving to roster_entries, not to the player',
   /from\('roster_entries'\)[\s\S]{0,80}position: raw/.test(teamJs),
   'a position belongs to a squad place, not to a person for all time');
ok('...gated on the same permission as the measurements beside it',
   /if \(!canEdit\) \{[\s\S]{0,120}r\.position/.test(teamJs));
ok('...offering the usual vocabulary without enforcing it',
   /posOptions/.test(teamJs) && /datalist/.test(teamJs),
   'a league that plays "Combo" must be able to write it');
ok('and a signed-in user can actually ask whether they may edit',
   /grant execute on function public\.is_team_manager\(uuid\) to authenticated/
     .test(rd('supabase', 'migrations', '0080_position_on_team_page.sql')));

/* ---- 18. what OBS taught us ---------------------------------------------- */
console.log('\nthe browser source is told to reload');

const mixJs = rd('epinoia', 'broadcast', 'control', 'mixers.js');
ok('rebuilding a source forces a cache-free reload',
   /refreshnocache/.test(mixJs),
   'CEF caches the page and re-pointing a source at the same URL does not ' +
   'restart it — a rebuilt graphic keeps showing what it showed before');

/* ---- 19. squad and bench are two graphics, not one with a mood ----------- */
console.log('\na bench that includes the starters is not a bench');

ok('squad and bench are separate scenes',
   layerScenes.includes('squad') && layerScenes.includes('bench'));
ok('...offered separately, per club',
   (control.match(/\['squad',/g) || []).length === 2 &&
   (control.match(/\['bench',/g) || []).length === 2);
ok('the bench excludes the starters',
   /list = men\.filter\(p => !starters\.has\(p\.id\)\)/.test(layer));
ok('...and shows nothing until the fives are known, rather than the whole squad',
   /if \(starters\.size < 5\) return '';/.test(layer),
   'a graphic captioned "bench" listing the starting five is worse than a blank');
ok('the squad graphic always works, which is what a stream needs before tip',
   /list = men;RNRNRNRNlabel = 'squad';/.test(layer.replace(/[\nCR ]+/g, 'RN')) ||
   /label = 'squad'/.test(layer));

/* both share the five card's frame, or they are two designs */
ok('both share the rail with the starting five', /function railHTML\(/.test(layer));
ok('...and the same card', /rosterCard\(st, 'squad'\)/.test(layer) &&
   /rosterCard\(st, 'bench'\)/.test(layer));
ok('a portrait is head and shoulders, not a full body squeezed small',
   /function portraitHTML\(/.test(layer),
   'twelve full-body figures across 16:9 are forty pixels wide each');
ok('...and the cut-out is reframed rather than reused as-is',
   /\.port2\.fromcut img\{[^}]*transform:scale/.test(layerH));

/* the sizing bug that made every circle overlap its neighbour */
ok('a portrait has a fixed size, not a flexing one',
   /A FIXED PORTRAIT, NOT A FLEXING ONE/.test(layerH));

/* ---- 20. the snapshot freezes who, not how tall -------------------------- */
console.log('\na played game still shows positions and heights');

ok('measurements are merged onto a frozen roster',
   /async function mergeMeasurements\(\)/.test(layer));
ok('...because the snapshot holds names and numbers only',
   /THE SNAPSHOT FREEZES WHO WAS AVAILABLE, NOT HOW TALL THEY ARE/.test(layer));
ok('...and the squad itself still comes from the snapshot',
   /if \(snapped\) return mergeMeasurements\(\);/.test(layer),
   'a roster edited on Tuesday must not rewrite who could play on Saturday');

/* ---- 21. going live, and the key that is not ours ------------------------ */
console.log('\nthe stream is driven from here, the key is not');

const mx2 = rd('epinoia', 'broadcast', 'control', 'mixers.js');
const ctl2 = rd('epinoia', 'broadcast', 'control', 'control.js');
['StartStream', 'StopStream', 'GetStreamStatus', 'StartRecord', 'GetRecordStatus']
  .forEach(r => ok(`  OBS ${r} is wired`, mx2.includes(r)));
ok('bitrate is derived, since OBS does not report it',
   /outputBytes[\s\S]{0,60}outputDuration|\* 8\) \/ secs/.test(ctl2));
ok('dropped frames and congestion are surfaced',
   /outputSkippedFrames/.test(ctl2) && /outputCongestion/.test(ctl2),
   'a bitrate that sags is a stream about to buffer');
ok('stopping a live stream asks first',
   /confirm\('Stop the stream\?/.test(ctl2),
   'a stream is public and so is a misclick');

/* the destination: stored by the league, never displayed */
const mig = rd('supabase', 'migrations', '0081_stream_targets.sql');
ok('a league can save a destination', /create table if not exists public\.league_stream_targets/.test(mig));
ok("...readable only by that league's administrators",
   /using \(public\.is_platform_admin\(\) or public\.is_league_admin\(league_id\)\)/.test(mig));
ok('...and the listing masks the key rather than returning it',
   /right\(t\.stream_key, 4\)/.test(mig));
ok('...which the migration checks for itself',
   /the listing function returns the raw key/.test(mig));
const sui = rd('epinoia', 'admin', 'stream-ui.js');
ok('the admin panel never fetches the key back',
   !/select\([^)]*stream_key/.test(sui) && /stream_targets_for_league/.test(sui));
ok('...and catches the commonest paste mistake',
   /looks like the ingest URL rather than the key/.test(sui));
ok('the control room posts it straight into OBS without rendering it',
   /mx\.setDestination\(t\.server, t\.stream_key\)/.test(ctl2) &&
   !/lvNote[^;]*stream_key/.test(ctl2));
ok('...over rtmp_custom, not a bundled service name',
   /streamServiceType: 'rtmp_custom'/.test(mx2),
   "OBS's service list changes between versions; an ingest URL does not");

/* what two rounds of testing against a real OBS actually taught */
ok('rebuilding a source cold-starts it rather than trusting a refresh',
   /A COLD START, NOT A REFRESH/.test(mx2));

/* ---- 22. scoring and streaming are one pipeline -------------------------- */
console.log('\nthe scorer publishes before tip, and the graphics notice');

const boot = rd('epinoia', 'score', 'bootstrap.js');
ok('the scorer primes a fixture before the ball is thrown',
   /async function primeFixture\(\)/.test(boot));
ok('...only once the fives are actually picked',
   /if \(!S\.starters \|\| !S\.starters\[0\] \|\| !S\.starters\[0\]\.length\) return;/.test(boot));
ok('...and does NOT touch status',
   /WHY status IS LEFT ALONE/.test(boot),
   'writing a roster says who is available; writing live says the ball is up');
const primeBlock = boot.slice(boot.indexOf('async function primeFixture'),
                              boot.indexOf('async function primeFixture') + 1400);
ok('...which the write itself honours', !/status:/.test(primeBlock), primeBlock.slice(0, 120));
ok('a failure to prime is quiet, unlike a failure to claim',
   /an alarming badge/.test(boot),
   'nothing is lost — the same write happens again at tip');

ok('the graphics watch the fixture before tip',
   /function watchPregame\(\)/.test(layer),
   'the live feed carries events, and before tip there are none');
ok('...and stop once the event stream can do the job',
   /if \(game\.status === 'live' \|\| game\.status === 'final'\) return;/.test(layer));
ok('...without restarting every fade on each tick',
   /would restart every portrait/.test(layer),
   'the faces would blink at the audience every eight seconds');

/* the other direction: the gallery can see what the scorer has done */
ok('the control room reads the fixture too', /async function pollReady\(\)/.test(control));
ok('...and marks a graphic that cannot work yet', /const blockedReason = key =>/.test(control));
ok('...telling a caveat apart from a block',
   /function isHardBlock|const isHardBlock/.test(control),
   'colouring them alike trains a director to ignore both');
ok('...and mirrors the layer on where a roster comes from',
   /A ROSTER IS EITHER SOURCE/.test(control),
   'the layer falls back to the clubs published rosters, so a squad tile that ' +
   'said "unavailable" beside a working graphic was simply wrong');

/* ---- 23. a primed fixture is watched more closely ------------------------ */
console.log('\nthe strip tightens up when a game is about to start');

const strip = rd('epinoia', 'embed', 'strip', 'strip.js');
ok('the strip has a primed cadence', /POLL_PRIMED_MS/.test(strip));
ok('...faster than idle, slower than live',
   /const POLL_PRIMED_MS = 6000;/.test(strip) && /POLL_MS = 20000/.test(strip));
ok('...triggered by a scheduled fixture that already has its fives',
   /primedNow = gs\.some\(g => statusOf\(g\) === 'scheduled'/.test(strip));
ok('...and the query actually fetches starters',
   /select=id,tipoff_at,status,venue,home_score,away_score,starters/.test(strip),
   'the signal is useless if the column is not asked for');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
