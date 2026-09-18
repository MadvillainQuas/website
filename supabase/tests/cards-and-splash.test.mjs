/* ============================================================================
   THREE THINGS A READER LOOKS AT, PUT RIGHT (2026-09-18).

     1. THE EMBEDS SCROLL. A league's own standings showed nine of its twelve
        clubs, because the table is content-driven and the frame around it is
        not: it was simply cut off at the bottom edge with no hint that there
        was more. The rows scroll inside the frame now, between a header and a
        footer that stay put, and the league's front page asks for the whole
        table and a top thirty rather than twelve and ten.

     2. THE FIXTURE CARD PUTS THE TWO CLUBS SIDE BY SIDE. Stacked, a fixture
        read as a list of two things rather than as a match. The league badge,
        the day, the time and the venue are all still on it.

     3. THE APP OPENS ON THE BRAND. Both splash images were the app icon again,
        so a cold start read as the same tile twice and then a browser. The
        screen somebody actually looks at carries the lockup — the mark beside
        the wordmark. The system splash keeps the mark alone, because the
        platform masks that one to a circle whatever is put in it.

     node supabase/tests/cards-and-splash.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const png = (...p) => { const b = fs.readFileSync(path.join(ROOT, ...p));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }; };

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

/* --------------------------------------------------------- 1. the embeds --- */
console.log('\n1. the table and the leaders scroll, and hold every row');
{
  const page = rd('epinoia', 'embed', 'table', 'index.html');
  const js = rd('epinoia', 'embed', 'table', 'table.js');
  ok('the rows scroll inside the frame', /#host\{[^}]*overflow-y:auto/.test(page));
  ok('...between a header and a footer that stay put',
     /body\.cse\{display:flex;flex-direction:column;max-height:100vh\}/.test(page) &&
     /\.ep-hd,\.ep-foot\{flex:none\}/.test(page));
  ok('...and the column heads stay above the rows that scroll under them',
     /\.ep-tbl thead th\{position:sticky;top:0/.test(page));
  ok('a scroll inside the embed does not take the host page with it',
     /overscroll-behavior:contain/.test(page));

  ok('the cap is 200 rows, not 25', /const MAX_ROWS = 200;/.test(js));
  ok('...and the default is untouched, so every page already embedding this is unchanged',
     /parseInt\(qp\.get\('n'\), 10\) \|\| 10, MAX_ROWS\)/.test(js));
  ok('the height it reports is the LIST\'s, not the box\'s — or a page that resizes the frame ' +
     'would be told to keep it exactly as tall as it already is',
     /const height = host \? chrome \+ host\.scrollHeight : document\.body\.scrollHeight;/.test(js));

  const home = rd('epinoia', 'home.js');
  ok('the league\'s front page asks for the whole table', /kind=standings&n=200/.test(home));
  ok('...and a top thirty', /kind=leaders&stat=ppg&n=30/.test(home));
  const idx = rd('epinoia', 'index.html');
  ok('the frame is tall enough that the scroll is a bonus, not the only way in', (() => {
    const m = /\.embedframe\{[^}]*height:(\d+)px/.exec(idx);
    return m && Number(m[1]) >= 400;
  })(), (/\.embedframe\{[^}]*height:\d+px/.exec(idx) || [])[0]);
}

/* ---------------------------------------------------- 2. the fixture card --- */
console.log('\n2. the two clubs, side by side');
{
  const js = rd('epinoia', 'globalgames.js');
  const css = rd('epinoia', 'kit', 'fxc.css');
  ok('the card is home, a middle, away — in that order',
     /body\.appendChild\(side\(g\.home[\s\S]{0,600}body\.appendChild\(mid\);[\s\S]{0,80}body\.appendChild\(side\(g\.away/.test(js));
  ok('three columns, not two stacked rows',
     /\.fxc-body\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/.test(css));
  ok('an upcoming game has a "v" between them', /mid\.appendChild\(node\('span', 'fxc-v', 'v'\)\)/.test(js));
  ok('a played one has the score, the winner\'s number in the accent',
     /fxc-sc h' \+ \(winH \? ' win' : winA \? ' lose' : ''\)/.test(js) && /\.fxc-sc\.win\{color:var\(--lume\)\}/.test(css));
  ok('the league badge and its name are still on the top line',
     /const holder = node\('span', 'fxc-lg'\);\s*\n\s*holder\.innerHTML = badge\(leagueOf\(g\)/.test(js));
  ok('the day and the time are both on it, in full',
     /when\.appendChild\(node\('span', 'fxc-day', dayLabel\(g\.tipoff_at, o\.now\)\)\);\s*\n\s*when\.appendChild\(node\('b', null, timeLabel\(g\.tipoff_at\)\)\);/.test(js));
  ok('...and the venue is still in the foot', /foot\.appendChild\(node\('span', 'fxc-vn', g\.venue/.test(js));
  ok('a name too long for half a card wraps rather than being cut to a word and a half',
     /-webkit-line-clamp:2/.test(css) && !/\.fxc-nm\{[^}]*white-space:nowrap/.test(css));
  ok('both sides reserve the same height, so the cards line up', /\.fxc-tm\{[^}]*min-height:\d+px/.test(css));
  /* the kit zooms the page from 1000px, and a container query measures the unzoomed size:
     a threshold written against what a ruler says would never match */
  ok('the full name comes back on a card wide enough for two of them',
     /@container \(min-width:290px\)\{/.test(css));
  ok('...and the reason the number looks small is written down',
     /zoom:1\.25 from 1000px/.test(css) || /unzoomed/.test(css));
  ok('the letters are what a narrow card shows',
     /\.fxc-nm \.full\{display:none\}\n\.fxc-nm \.short\{display:inline\}/.test(css));
}

/* -------------------------------------------------------- 3. the splash --- */
console.log('\n3. the app opens on the brand, not on its own icon');
{
  const gen = rd('tools', 'build-brand-icons.py');
  ok('there is a lockup: the mark, a gap, the wordmark', /def lockup\(height_dp, k\)/.test(gen) &&
     /out\.paste\(m, \(0, 0\), m\)/.test(gen) && /out\.paste\(w_, \(mw \+ gap/.test(gen));
  ok('the TWA splash is the lockup', /save\(lockup\(LOCKUP_DP, k\), f'\{RES\}\/drawable-\{name\}\/splash\.png'\)/.test(gen));
  ok('the Android 12 system splash keeps the mark alone, because it is masked to a circle',
     /drawable-\{name\}\/splash_system\.png/.test(gen) && /shape\(round\(162 \* k\), SPLASH/.test(gen));
  ok('iOS opens on the same lockup', /save\(lockup\(LOCKUP_DP, scale\),/.test(gen));
  ok('it is transparent, so the splash colour behind it is HOME\'s own',
     /Image\.new\('RGBA', \(mw \+ gap \+ ww, h\), \(0, 0, 0, 0\)\)/.test(gen));

  /* and what was actually written */
  const dens = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const splash = dens.map(d => png('android', 'app', 'src', 'main', 'res', 'drawable-' + d, 'splash.png'));
  ok('every density has a WIDE splash — a lockup, not a tile',
     splash.every(s => s.w > s.h * 3), JSON.stringify(splash.map(s => s.w + 'x' + s.h)));
  ok('...and they are the same shape at every density', (() => {
    const r = splash.map(s => s.w / s.h);
    return Math.max(...r) - Math.min(...r) < 0.05;
  })());
  ok('...and they grow with the density', (() => {
    const w = splash.map(s => s.w);
    return w.every((v, i) => i === 0 || v > w[i - 1]);
  })());
  const sys = dens.map(d => png('android', 'app', 'src', 'main', 'res', 'drawable-' + d, 'splash_system.png'));
  ok('the system splash is still square', sys.every(s => s.w === s.h),
     JSON.stringify(sys.map(s => s.w + 'x' + s.h)));
  const ios = ['launch-logo.png', 'launch-logo@2x.png', 'launch-logo@3x.png']
    .map(f => png('ios', 'Epinoia', 'Assets.xcassets', 'LaunchLogo.imageset', f));
  /* each part is rounded independently, so 3x is within a pixel or two of three times 1x */
  ok('iOS carries the same wide lockup at 1x, 2x and 3x',
     ios.every(s => s.w > s.h * 3) &&
     Math.abs(ios[1].w - ios[0].w * 2) <= 4 && Math.abs(ios[2].w - ios[0].w * 3) <= 8,
     JSON.stringify(ios.map(s => s.w + 'x' + s.h)));

  const manifest = rd('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  ok('the manifest still points the TWA splash at that drawable',
     /SPLASH_IMAGE_DRAWABLE"\s*\n\s*android:resource="@drawable\/splash"/.test(manifest));
  ok('...on HOME\'s own colour, so the hand-over never flashes another',
     /SPLASH_SCREEN_BACKGROUND_COLOR"\s*\n\s*android:resource="@color\/epinoia_ground_light"/.test(manifest));
  ok('...and the file provider that carries it to Chrome is declared',
     /FILE_PROVIDER_AUTHORITY"\s*\n\s*android:value="\$\{applicationId\}\.fileprovider"/.test(manifest) &&
     /android:authorities="\$\{applicationId\}\.fileprovider"/.test(manifest));
}

/* ------------------------------------------------------- 4. a new build --- */
console.log('\n4. a new version for phones to take');
{
  const v = JSON.parse(rd('epinoia', 'android', 'version.json'));
  ok('the version code went up with the splash', v.versionCode >= 5,
     'versionCode ' + v.versionCode);
  ok('...and the name with it', v.versionName >= '1.0.4', v.versionName);
  eq('it is a whole number, which is what the release tag is built from',
     Number.isInteger(v.versionCode) && v.versionCode > 0, true);
  ok('the download still points at the latest release',
     /releases\/latest\/download\/epinoia\.apk$/.test(v.apk));
  const wf = rd('.github', 'workflows', 'android.yml');
  ok('pushing that file is what builds and releases it',
     /- 'epinoia\/android\/version\.json'/.test(wf) && /tag_name: android-v\$\{\{ steps\.version\.outputs\.code \}\}/.test(wf));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
