/* ============================================================================
   THE FIXTURE PREVIEW SAYS TRUE THINGS.

   The preview writes prose from season aggregates, which means it can be
   confidently wrong in a way a table cannot: a table showing 24.0 and 26.4 is
   just two numbers, while a sentence claiming one side is "good at taking away
   what the other does best" is a claim, and it has to follow from them.

   The first draft got exactly that backwards. edge() is signed so positive
   always means "the attacking side is ahead", whichever direction the
   underlying factor runs — turnover rate is better when LOW, the other three
   when HIGH. A NEGATIVE edge therefore means the attack does this less well
   than the defence normally concedes, which says something about the attack.
   The draft reported it as a defensive strength, and so described a defence
   that was in fact generous on that factor as shutting the matchup down.

   These tests hold the parts that can be wrong rather than the wording:

     1. the sign convention, in both directions, on a low-is-better factor
        and a high-is-better one;
     2. that only a genuine advantage is ever named as a matchup;
     3. that a small sample is refused rather than described;
     4. that missing statistics drop their sentence instead of printing "—"
        into prose or throwing;
     5. that names and venues are escaped — they reach this module straight
        from the database and go into innerHTML.

       node supabase/tests/preview.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'epinoia', 'game', 'preview.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.error('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

const F = {};
P.FACTORS.forEach(f => { F[f.k] = f; });

/* ---- 1. the sign convention ---------------------------------------------- */
/* eFG: higher is better, so an attack at 54 against a defence conceding 50 is
   +4 to the attack. */
ok('high-is-better: attack ahead reads positive',
   P.__test.edge(F.efg, 54, 50) === 4, String(P.__test.edge(F.efg, 54, 50)));
ok('high-is-better: attack behind reads negative',
   P.__test.edge(F.efg, 46, 50) === -4, String(P.__test.edge(F.efg, 46, 50)));
/* turnovers: LOWER is better, so an attack at 12 against a defence that forces
   16 is the attack ahead — the sign must not flip with the factor. */
ok('low-is-better: attack ahead still reads positive',
   P.__test.edge(F.tov, 12, 16) === 4, String(P.__test.edge(F.tov, 12, 16)));
ok('low-is-better: attack behind still reads negative',
   P.__test.edge(F.tov, 18, 16) === -2, String(P.__test.edge(F.tov, 18, 16)));
ok('a missing value yields no edge at all',
   P.__test.edge(F.efg, null, 50) === null && P.__test.edge(F.efg, 50, undefined) === null);

/* ---- 2. only a real advantage is called a matchup ------------------------- */
const shape = over => Object.assign({
  gp: 6, ortg: 105, drtg: 105, net: 0, pace: 70, ppg: 80, papg: 80,
  ff_efg: 50, ff_tov: 14, ff_oreb: 28, ff_ftr: 22,
  dff_efg: 50, dff_tov: 14, dff_oreb: 28, dff_ftr: 22,
  p3_share: 33, p3_acc: 34, ast_to: 1.5
}, over || {});

/* A is a long way BEHIND on every factor; B is level. Nothing here is an
   advantage for anybody, so no matchup sentence may be produced. */
const behind = P.__test.observations(
  P.__test.teamShape(shape({ ff_efg: 40, ff_tov: 22, ff_oreb: 18, ff_ftr: 12 })),
  P.__test.teamShape(shape({})), 'Alpha', 'Beta');
ok('a side merely being worse is never described as a matchup',
   !behind.some(o => /matchup to watch/.test(o.text)),
   behind.map(o => o.text).join(' | '));

/* Now give B a real edge: B attacks the offensive glass at 40 where A concedes
   24. That is +16 to B and must be named, with B as the attacking side. */
const real = P.__test.observations(
  P.__test.teamShape(shape({ dff_oreb: 24 })),
  P.__test.teamShape(shape({ ff_oreb: 40 })), 'Alpha', 'Beta');
const matchup = real.find(o => /matchup to watch/.test(o.text));
ok('a genuine advantage IS named', !!matchup);
ok('...with the attacking side named as the attacker',
   !!matchup && /matchup to watch is Beta/.test(matchup.text), matchup && matchup.text);
ok('...and quotes both numbers so the claim is checkable',
   !!matchup && /40\.0%/.test(matchup.text) && /24\.0%/.test(matchup.text),
   matchup && matchup.text);

/* ---- 3. small samples are refused, not described -------------------------- */
const thin = P.narrative({ nameA: 'Alpha', nameB: 'Beta',
  teamA: shape({ gp: 1 }), teamB: shape({ gp: 2 }) });
ok('a one-game sample is called early rather than analysed',
   thin.length === 1 && /Early days/.test(thin[0]), thin[0]);
ok('no games at all says so plainly',
   /nothing to read into/.test(P.narrative({ nameA: 'A', nameB: 'B',
     teamA: null, teamB: null })[0]));

/* ---- 4. missing statistics drop their sentence ---------------------------- */
const sparse = { gp: 6 };     // a team row with nothing but a game count
const bare = P.narrative({ nameA: 'Alpha', nameB: 'Beta',
  teamA: sparse, teamB: sparse });
ok('a team row with no rate stats still renders without throwing',
   Array.isArray(bare));
ok('...and does not print an em dash into the prose',
   !bare.join(' ').includes('—%') && !/\b—\b/.test(bare.join(' ')),
   bare.join(' | '));

/* ---- 5. hostile names and venues are escaped ------------------------------ */
const eviln = '<img src=x onerror=alert(1)>';
const html = P.render({
  nameA: eviln, nameB: 'Beta', colourA: '#93f2bf', colourB: '#8ff5ff',
  slugA: 'a', slugB: 'b', teamA: shape({}), teamB: shape({}),
  starsA: [{ id: 'p1', name: eviln, gp: 6, ppg: 10, rpg: 4, apg: 3, ts: 55 }],
  starsB: [], tipoff: '2026-11-14T19:30:00Z',
  venue: eviln, address: eviln, competition: eviln, leagueSlug: 'l'
});
ok('a club name cannot inject markup', !html.includes('<img src=x'),
   (html.match(/<img[^>]*>/) || [''])[0]);
/* Assert on the ANGLE BRACKETS, not on the word "onerror". An earlier version
   of this check stripped &lt;/&gt; before searching — which removes the very
   evidence that the escaping worked, leaving the harmless text "onerror=" and
   calling it a failure. Escaped markup is inert: what matters is that no raw
   tag survives, and that the payload is present in its escaped form rather
   than having been silently dropped. */
ok('a venue cannot inject markup',
   !html.includes('<img src=x') && html.includes('&lt;img src=x'),
   html.includes('<img src=x') ? 'raw tag survived' : 'payload was not rendered at all');
ok('the map query is URL-encoded, not interpolated raw',
   !html.includes('maps?q=<'), 'raw angle bracket in the map query');

/* the render must still be a complete page for a normal fixture */
const good = P.render({
  nameA: 'Alpha', nameB: 'Beta', colourA: '#93f2bf', colourB: '#8ff5ff',
  slugA: 'alpha', slugB: 'beta', teamA: shape({}), teamB: shape({}),
  starsA: [{ id: 'p1', name: 'One', gp: 6, ppg: 10, rpg: 4, apg: 3, ts: 55 }],
  starsB: [{ id: 'p2', name: 'Two', gp: 6, ppg: 9, rpg: 5, apg: 2, ts: 54 }],
  tipoff: '2026-11-14T19:30:00Z', venue: 'Hall', address: 'Somewhere',
  competition: 'Cup', leagueSlug: 'l'
});
ok('eight factor rows — four with the ball, four without',
   (good.match(/class="pv-factor"/g) || []).length === 8);
ok('a map is drawn when there is an address', /<iframe/.test(good));
ok('no map is drawn when there is nowhere to point at',
   !/<iframe/.test(P.render({ nameA: 'A', nameB: 'B', teamA: shape({}), teamB: shape({}),
     colourA: '#93f2bf', colourB: '#8ff5ff' })));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
