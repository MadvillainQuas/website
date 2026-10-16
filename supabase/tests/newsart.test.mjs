// epinoia/newsart.js + epinoia/newspost.js (Louie, 2026-10-16): a cover for every story that came without a picture,
// drawn from its words, and a story drawn as an Instagram post in the creator hub from the pieces his three examples
// share. Held here:
//   * the words read: the clubs a story names (and only those - a lone "Thunder" is not Worthing's when the text says
//     "Oklahoma City Thunder", a lower-case "derby" is not Derby), two clubs a game only when the story is one, the
//     player, the number (a comeback, a run, a points haul), what kind of news it is (the headline before the summary);
//   * the colours: a field white capitals read on, an accent that is a colour (never pink, never the field's own hue
//     lifted a little), the desk's own colourways for a publisher with none;
//   * every cover layout and every post template at every size: drawn, and every word on the picture;
//   * a post never carries a cut-out nobody gave it, nor the preview's hint;
//   * the words to post it with; the pages that load it (the hub, the news cards).
//
//   node supabase/tests/newsart.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const EP = path.join(here, '..', '..', 'epinoia');
const req = createRequire(import.meta.url);
const A = req(path.join(EP, 'newsart.js'));
const NP = req(path.join(EP, 'newspost.js'));
const src = f => readFileSync(path.join(EP, f), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

const clubs = [
  { name: 'Adelaide 36ers', short: 'ADL', colour: '#0b1f3a', colour2: '#c8102e' },
  { name: 'Tasmania JackJumpers', short: 'TAS', colour: '#0f4d2c', colour2: '#d8b25a' },
  { name: 'London Lions', short: 'LON', colour: '#010101', colour2: '#d5d5d5' },
  { name: 'Cheshire Phoenix', short: 'CHE', colour: '#02405c', colour2: '#fccd4d' },
  { name: 'Worthing Thunder', short: 'WOR', colour: '#1b2a6b', colour2: '#f4c300' },
  { name: 'Derby Trailblazers', short: 'Derby', colour: '#231f20', colour2: null },
  { name: 'B. Braun Sheffield Sharks', short: 'SHE', colour: '#1c2a5c', colour2: '#e2001a' },
  { name: 'Valencia Basket', short: 'VAL', colour: '#f26722', colour2: '#000000' }
];
const an = (title, summary, extra) => A.analyse(Object.assign({ title, summary, kind: 'story', brand: { name: 'Desk' } }, extra || {}), { clubs });

console.log('the words');
let f = an('Adelaide 36ers come from 10 down to beat Tasmania JackJumpers', 'Bryce Cotton was the difference, with 35 points.');
ok('a result between two clubs: a duel, the comeback its number, the player named', f.layout === 'duel' && f.clubs.map(c => c.name).join() === 'Adelaide 36ers,Tasmania JackJumpers'
   && f.number && f.number.value === '10' && f.number.label === 'POINT COMEBACK' && f.names[0] === 'Bryce Cotton' && f.topic.key === 'result', f);
f = an('Choosing to Go Bigger', 'London Lions won every domestic trophy last season. Cheshire Phoenix were second.');
ok('two clubs in a feature are not a game: the first one, alone', f.layout === 'club' && f.clubs.length === 1 && f.clubs[0].name === 'London Lions', f.clubs);
f = an('Rockets dominate Thunder in preseason finale', 'The Houston Rockets defeated the Oklahoma City Thunder 116-89 on Thursday.');
ok('"Oklahoma City Thunder" is not Worthing Thunder: two teams the site does not hold, a duel on monograms with the score',
   f.layout === 'duel' && f.clubs.every(c => c.guess) && f.score && f.score.join() === '116,89' && !f.clubs.some(c => c.name === 'Worthing Thunder'), f.clubs);
f = an('Udine, Lorenzo Pomes: "Obiettivo rallentare il ritmo di Treviso"', 'Lorenzo Pomes knows what a derby means.');
ok('a lower-case "derby" is not Derby', !f.clubs.some(c => /Derby/.test(c.name)), f.clubs);
f = an('Sharks sign a new point guard', 'B. Braun Sheffield Sharks have signed Jordan Smith.');
ok('a club by its name after the sponsor, or its nickname alone', f.clubs[0] && f.clubs[0].name === 'B. Braun Sheffield Sharks' && f.topic.key === 'signing', f.clubs);
f = an('Knicks waive Tony Bradley and Ochai Agbaji', 'They are waiving him, and an injury to a third player made room.');
ok('the headline says what kind of news before the summary does (a roster move, not an injury)', f.topic.key === 'released', f.topic);
f = an('Pourquoi Mohamed Dabone ne peut toujours pas jouer', 'Le talent ne suffit pas.');
ok('an opening word in another language is not part of a name', f.names[0] === 'Mohamed Dabone', f.names);
f = an('Lakers genuinely believe in Bronny James', 'The Los Angeles Lakers genuinely believe in Bronny James as a player.');
ok('one article off the front of a name, never "Los"', f.names.includes('Bronny James') && f.names.includes('Los Angeles Lakers'), f.names);
ok('numbers: a run, points, a streak; never a season', A.numberOf('a 12-0 run to finish').value === '12–0' && A.numberOf('He scored 31 points').label === 'POINTS'
   && A.numberOf('their fifth straight loss') === null && A.numberOf('five in a row').value === '5' && A.numberOf('the 2026-27 season') === null);
ok('a score is two numbers from 30 to 200', String(A.scoreOf('won 88–81 at home')) === '88,81' && A.scoreOf('the 2026-27 season') === null && A.scoreOf('a 12-0 run') === null);
ok('a quote is the first thing said in quotation marks', A.quoteOf('He said “we will be back next week, stronger” after the game') === 'we will be back next week, stronger');
f = an('トライフープ岡山が契約発表', '10月16日、Bワン西地区に所属する');
ok('a story with nothing to name: the brand layout, latest news', f.layout === 'brand' && f.topic.key === 'news');
f = A.analyse({ title: 'Report', summary: '', kind: 'league', home: clubs[2], away: clubs[3], homeScore: 90, awayScore: 80 }, {});
ok('a match report brings its own clubs and score', f.layout === 'duel' && f.score.join() === '90,80');

/* IS IT A GAME? The headline says so, not a score in the lines under it (Louie, 2026-10-16: "5 super-early predictions
   for the Sheffield Sharks" came out as its summary's 98-76 game) */
{
  const sharks = [{ name: 'Sheffield Sharks', short: 'SHE', colour: '#1c2a5c' }, { name: 'Caledonia Gladiators', short: 'CAL', colour: '#00539f' }];
  const sum = 'The Sheffield Sharks got their season underway with a convincing 98-76 win at home against the Caledonia Gladiators.';
  const p1 = A.analyse({ title: '5 super-early predictions for the Sheffield Sharks', summary: sum, kind: 'article' }, { clubs: sharks });
  ok('a list piece about a club whose summary mentions a game: the count leads (5 / SUPER-EARLY PREDICTIONS), the club its subject, no score',
     p1.layout === 'number' && p1.club && p1.club.name === 'Sheffield Sharks' && p1.score === null && p1.number.value === '5'
     && p1.number.phrase === 'super-early predictions' && p1.topic.key === 'predictions', p1);
  const p2 = A.analyse({ title: '5 super-early predictions for the Sheffield Sharks', summary: sum, kind: 'article' }, { clubs: [] });
  ok('...and with no clubs to find, never a duel of guesses', p2.layout === 'number' && !p2.clubs.length, p2.layout);
  const p3 = A.analyse({ title: 'Sheffield Sharks beat Caledonia Gladiators 98-76', summary: '', kind: 'article' }, { clubs: sharks });
  ok('a headline that is a result is still a duel with its score', p3.layout === 'duel' && String(p3.score) === '98,76');
  ok('a list piece counts its items: 3 takeaways, 10 storylines', A.numberOf('3 takeaways from the opener').label === 'TAKEAWAYS'
     && A.numberOf('10 storylines to watch this season').value === '10' && A.numberOf('Lions win 3 straight') !== null);
}

/* WHO LEADS THE COVER: what the headline names first (Louie, 2026-10-16: "the auto layout logic can do with a lot of work") */
{
  const man = [{ name: 'Manchester Basketball', short: 'MAN', colour: '#e2001a', colour2: '#1e5bb8' }];
  const lau = A.analyse({ title: 'Caroline Lau: The Heartbeat of Manchester Basketball', kind: 'article',
    summary: "Even with the abundance of talent at Manchester Basketball's disposal, Caroline Lau has established herself as the critical cog." }, { clubs: man });
  ok('a person named before a club leads, in the club\'s colours with its crest beside her', lau.layout === 'name' && lau.names[0] === 'Caroline Lau'
     && lau.club && lau.club.name === 'Manchester Basketball' && lau.palette.base === '#e2001a', lau);
  ok('...the strap is the headline\'s own second half, never LATEST NEWS', A.strapFor(lau) === 'THE HEARTBEAT OF MANCHESTER BASKETBALL', A.strapFor(lau));
  const go = an('Choosing to Go Bigger', 'London Lions won every domestic trophy last season. Cheshire Phoenix were second.');
  ok('a capitalised phrase the summary never repeats is no person ("Go Bigger")', go.layout === 'club' && go.clubs[0].name === 'London Lions', go.layout);
  const sima = an('Yankuba Sima parts ways with Valencia after one-year stint', 'Valencia and Yankuba Sima mutually terminate contract immediately');
  ok('a player who leaves a club: the player leads, the club\'s crest beside him', sima.layout === 'name' && sima.club && sima.club.name === 'Valencia Basket');
  const jp = A.analyse({ title: 'NBA公式Instagramがハッキング被害…“偽”暗号資産「NBAコイン」を宣伝', summary: '日本でも連日', kind: 'story', brand: { name: 'Basketball King' } }, {});
  ok('a quotation mark alone makes no quote (a Japanese headline quoting a word)', jp.topic.key !== 'quote' && jp.layout === 'brand', jp.topic);
  ok('...and with nothing to name and no quote, the strap is nothing rather than filler', A.strapFor(jp) === null);
}
/* THE SITE'S COVERS ARE SVG: vectors and real text, crisp at any size (Louie: "the text still looks a bit blurry") */
{
  const sv = A.svgContext(400, 250);
  A.drawArt(sv, 400, 250, an('Valencia center reportedly moves to Germany', 'Yankuba Sima is leaving Valencia Basket.'), { clubs: [{ src: 'https://x/crest.png', width: 100, height: 100 }], brand: null }, { top: 40 });
  const out = sv.svg();
  ok('a cover drawn into the SVG context is an SVG of the cover\'s own size, its words as text, its crest as an image',
     /^<svg [^>]*viewBox="0 0 400 250"/.test(out) && /<text [^>]*>VALENCIA<\/text>/.test(out) && /<image href="https:\/\/x\/crest\.png"/.test(out) && /<\/svg>$/.test(out), out.slice(0, 200));
  ok('...every group it opens is closed', (out.match(/<g[ >]/g) || []).length === (out.match(/<\/g>/g) || []).length);
  ok('...and words are escaped, never markup', !/<text[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;)/.test(out));
  const nc2 = src('newsart.js');
  ok('the page mounts the cover as SVG, out of the translation, under the page\'s real badges', /svgContext\(w, h\)/.test(nc2) && /translate', 'no'/.test(nc2)
     && /querySelectorAll\(opt\.avoid\)/.test(nc2));
}

/* THE CLUBS BY THEIR OWN NAMES (Louie, 2026-10-16: "it's using Barking Abbey U19 Men when its canonical name is ...") */
{
  const KC = req(path.join(EP, 'newscard.js'));
  const eabl = [
    { name: 'Barking Abbey School', aliases: ['Barking Abbey U19 Men'] },
    { name: 'City of London Academy', aliases: ['City of London Academy - Southwark U19 Men'] },
    { name: 'Manchester Magic', aliases: ['The Manchester Magic Academy U19 Men'] },
    { name: 'UTC Sheffield Olympic Legacy Park U19 Men', aliases: [] },
    { name: 'Itchen College', aliases: ['Itchen College U19 Men', 'Itchen'] }
  ];
  const pairs = KC.aliasPairs(eabl);
  ok('a league\'s aliases as pairs, longest first; an alias that is a club\'s own name, or too short, is nobody\'s',
     pairs[0][0].length >= pairs[pairs.length - 1][0].length && !pairs.some(p => p[0] === 'Itchen') && pairs.some(p => p[0] === 'Manchester Magic Academy U19 Men'));
  ok('a match report\'s headline in the clubs\' own names, whatever dash the feed\'s spelling was given',
     KC.canonText('Barking Abbey U19 Men beat City of London Academy — Southwark U19 Men 61–54', pairs) === 'Barking Abbey School beat City of London Academy 61–54',
     KC.canonText('Barking Abbey U19 Men beat City of London Academy — Southwark U19 Men 61–54', pairs));
  ok('..."The X" mid-sentence and at the start, a possessive kept, and a club whose own name is long left alone',
     KC.canonText('The Manchester Magic Academy U19 Men come from 10 down to beat UTC Sheffield Olympic Legacy Park U19 Men', pairs)
       === 'Manchester Magic come from 10 down to beat UTC Sheffield Olympic Legacy Park U19 Men'
     && KC.canonText("Barking Abbey U19 Men's run", pairs) === "Barking Abbey School's run");
  ok('...never inside a longer word, and text with no alias untouched', KC.canonText('Itchen College U19 Mens', pairs) === 'Itchen College U19 Mens'
     && KC.canonText('nothing here', pairs) === 'nothing here');
  const f = A.analyse({ title: 'Barking Abbey U19 Men beat City of London Academy — Southwark U19 Men 61–54', summary: '', kind: 'league' },
    { clubs: eabl.map(c => Object.assign({ colour: '#202020' }, c)) });
  ok('a cover finds the clubs by their feed spellings too, and names them by their own', f.layout === 'duel'
     && f.clubs.map(c => c.name).join() === 'Barking Abbey School,City of London Academy', f.clubs.map(c => c.name));
  const cs = [{ name: 'Barking Abbey School', short: 'Barking', aliases: ['Barking Abbey U19 Men'] }, { name: 'City of London Academy', short: 'City of' },
              { name: 'UTC Sheffield Olympic Legacy Park U19 Men', short: 'UTC' }, { name: 'B. Braun Sheffield Sharks', short: 'SHE' }];
  ok('a club on a cover: never "U19 MEN" or "SCHOOL" - the age, sex and kind of side come off, a long name is its short word',
     cs.map(c => A.clubWords(c).join(' ')).join('|') === 'Barking Abbey|City of London|UTC|Sheffield Sharks', cs.map(c => A.clubWords(c).join(' ')));
  ok('...and its letters on a disc with no crest are its own (UTC, BA), not "UM"', A.monogram(cs[2]) === 'UTC' && A.monogram(cs[0]) === 'BA');
  ok('the cover reads the words with the clubs\' own names', A.canonWith('Barking Abbey U19 Men won', cs) === 'Barking Abbey School won');
  const fin = readFileSync(path.join(here, '..', 'functions', 'finalise-game', 'index.ts'), 'utf8');
  ok('finalise-game writes the report with the clubs\' names on the site, side 0 the hosts', /gameBrief\(named,/.test(fin)
     && /from\('teams'\)\.select\('id,name'\)/.test(fin) && /const ids = \[g\.home_team_id, g\.away_team_id\]/.test(fin));
  ok('every place a league\'s article is shown reads the clubs by their own names', /KC\.canon\(link, o\.leagueSlug\)/.test(src('news.js'))
     && /K\.canon\(host, league\.slug\)/.test(src('news/news-page.js')) && /it\.kind === 'league' && it\.row && it\.row\.league_slug\) canon\(art/.test(src('newscard.js')));
}

console.log('\nthe colours');
const contrast = (a, b) => { const x = A.lum(a), y = A.lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hue = h => { const n = parseInt(h.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
const pals = ['#cc0e21', '#e2022e', '#f26722', '#0f4d2c', '#02405c', '#010101', '#ffffff', '#fccd4d', '#93783a'].map(c => [c, A.palette(c, null, c)]);
ok('white capitals read on every field (7:1 or better on its deep colour)', pals.every(([, p]) => contrast('#ffffff', p.deep) >= 7), pals.map(([c, p]) => c + ':' + contrast('#ffffff', p.deep).toFixed(1)));
ok('no accent is pink: a red club lifted is not one', pals.every(([, p]) => { const h = hue(p.accent); return !((h < 22 || h > 320) && A.lum(p.accent) > 0.3); }), pals.map(([c, p]) => c + '>' + p.accent));
ok('a club whose second colour is white or black gets the desk\'s yellow', A.palette('#cc0e21', '#fae2e0').accent === '#ffe14d' && A.palette('#010101', '#d5d5d5').accent === '#ffe14d');
ok('a club\'s own coloured second colour is its accent', A.palette('#02405c', '#fccd4d').accent === '#fccd4d');
const house = new Set(['TalkBasket', 'BeBasket', 'Eurohoops', 'Solobasket', 'BasketNews', 'Pianeta'].map(n => A.palette(null, null, n).deep));
ok('publishers with no colour of their own get the desk\'s colourways, not one orange', house.size >= 4, [...house]);

console.log('\nthe covers');
function recorder(W, H) {
  const log = [], saved = [];
  let size = 10;
  const c = {
    log, fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, shadowColor: '', shadowBlur: 0,
    shadowOffsetY: 0, lineCap: 'butt', filter: 'none', letterSpacing: '0px', fontStretch: 'normal',
    save() { saved.push([size, c.textAlign, c.textBaseline, c.dy || 0]); }, restore() { const s = saved.pop(); if (s) [size, c.textAlign, c.textBaseline, c.dy] = s; },
    set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return size + 'px x'; },
    measureText(t) { return { width: String(t).length * size * 0.5 }; },
    text(t, x, y0) {
      const y = y0 + (c.dy || 0);
      const w = String(t).length * size * 0.5;
      const left = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x;
      const top = c.textBaseline === 'middle' ? y - size * 0.5 : y - size * 0.75;
      if (String(t).trim()) log.push({ kind: 'text', t: String(t), x0: left, x1: left + w, y0: top, y1: top + size * 0.95, size });
    },
    fillText(t, x, y) { c.text(t, x, y); }, strokeText(t, x, y) { log.push({ kind: 'ghost', t }); },
    fillRect() {}, clearRect() {}, rect() {}, clip() {}, setTransform() {}, scale() {}, translate(x, y) { c.dy = (c.dy || 0) + y; },
    createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {},
    drawImage(img, x, y, w, h) { log.push({ kind: 'image', tag: img.tag, x0: x, y0: y, x1: x + w, y1: y + h }); }
  };
  return c;
}
const img = (w, h, tag) => ({ width: w, height: h, naturalWidth: w, naturalHeight: h, tag });
const off = (log, W, H) => log.filter(e => e.kind === 'text' && (e.x0 < -1 || e.x1 > W + 1 || e.y0 < -1 || e.y1 > H + 1));
const cases = {
  duel: an('Adelaide 36ers come from 10 down to beat Tasmania JackJumpers', 'Bryce Cotton was the difference, with 35 points.'),
  club: an('Valencia center reportedly moves to Germany', 'Yankuba Sima is leaving Valencia Basket.'),
  number: an('A 12-0 run settles it', 'Nobody saw it coming.'),
  name: an('James Harden reveals when he might shave his trademark beard', 'James Harden is not planning to shave.'),
  brand: an('トライフープ岡山が契約発表', '10月16日')
};
ok('the five layouts are what the words say', Object.entries(cases).every(([k, v]) => v.layout === k), Object.entries(cases).map(([k, v]) => k + ':' + v.layout));
for (const [k, facts] of Object.entries(cases)) {
  for (const [W, H] of [[296, 185], [560, 315], [400, 400], [1600, 900], [360, 640]]) {
    const c = recorder(W, H);
    let threw = null;
    try { A.drawArt(c, W, H, facts, { clubs: [img(200, 200, 'crest'), img(200, 200, 'crest')], brand: img(100, 100, 'brand') }, { safeTop: 0.2 }); } catch (e) { threw = e.message; }
    const o = off(c.log, W, H);
    ok(`${k} at ${W}x${H}: drawn, every word on the picture`, !threw && !o.length, threw || o.slice(0, 3).map(e => e.t + '@' + Math.round(e.x0) + ',' + Math.round(e.y0)));
  }
}

{
  /* A MATCH REPORT'S COVER (opts.final): the board says FINAL, never FINAL SCORE again; the league's mark at the top;
     a small card's clubs by their three letters */
  const rep = A.analyse({ title: 'Sharks own the paint to beat Leicester Riders', summary: 'Fahro Alihodzic did the most damage, with 25 points.',
                          kind: 'league', home: clubs[6], away: { name: 'Leicester Riders', short: 'LEI', colour: '#e2022e' }, homeScore: 85, awayScore: 75,
                          brand: { name: 'Super League' } }, {});
  const c = recorder(560, 315);
  A.drawArt(c, 560, 315, rep, { clubs: [img(200, 200, 'crest'), img(200, 200, 'crest')], brand: img(100, 100, 'league') }, { final: true, leagueMark: true, safeTop: 0.04 });
  /* a pill is drawn a letter at a time (its tracking): its words read joined */
  const texts = c.log.filter(e => e.kind === 'text').map(e => e.t), all = texts.join('');
  ok('a finished game\'s cover: FINAL on the board, the night\'s number as its strap - with whose it is - and no FINAL SCORE', all.includes('FINAL') && !all.includes('FINALSCORE')
     && all.includes('ALIHODZIC25PTS') && texts.includes('85') && texts.includes('75'), texts);
  /* A PLAYER'S NUMBER NAMES THE PLAYER (Louie: "27 points" alone "is very vague vs. something like '11 point comeback'") */
  const strap = (t, sm, h, w) => A.strapOf(A.analyse({ title: t, summary: sm, kind: 'league', home: h || clubs[2], away: w || clubs[6], homeScore: 80, awayScore: 70 }, {}));
  ok('a player\'s points: the family name with them (POMES 27 PTS)', strap('Bristol Flyers live off second chances to beat Leicester Riders',
     'Lorenzo Pomes did the most damage, with 27 points. Leicester Riders have lost five in a row.') === 'POMES 27 PTS');
  ok('...the name nearest before the number, not a club earlier in the sentence (FELIZ 8 THREES)',
     strap('Real Madrid cruises past ASVEL as Andres Feliz hits eight threes', '') === 'FELIZ 8 THREES');
  ok('...and no strap at all when the words never say whose they are', strap('Lions beat Sharks', 'The bench added 31 points between them.') === null);
  ok('a club\'s number stays as it is (11 POINT COMEBACK, 11–0 RUN)', strap('Cheshire Phoenix come from 11 down to beat Manchester', '') === '11 POINT COMEBACK'
     && strap('Liverpool blow it open with an 11-0 run', '') === '11–0 RUN');
  ok('...the league\'s mark drawn at the top', c.log.some(e => e.kind === 'image' && e.tag === 'league' && e.y0 < 60));
  ok('...and every word on the picture', !off(c.log, 560, 315).length);
  const small = recorder(120, 70);
  A.drawArt(small, 120, 70, rep, { clubs: [], brand: null }, { final: true, safeTop: 0.04 });
  const st = small.log.filter(e => e.kind === 'text').map(e => e.t);
  ok('...on a small card the clubs are their three letters', st.includes('SHE') && st.includes('LEI'), st);
  const noNum = A.analyse({ title: 'Lions beat Sharks', summary: '', kind: 'league', home: clubs[2], away: clubs[6], homeScore: 80, awayScore: 70 }, {});
  const c2 = recorder(560, 315);
  A.drawArt(c2, 560, 315, noNum, { clubs: [] }, { final: true });
  ok('...and no strap at all when there is no number to say', !/SCORE|LATEST/.test(c2.log.filter(e => e.kind === 'text').map(e => e.t).join('')));
}
const newsJs = src('news.js');
ok('a match report\'s card and its head wear the cover once the game is final (never a live one), over the plate and under its grain',
   /if \(isMatch && !a\.cover_path && !o\.live\) matchArt\(/.test(newsJs) && /if \(o\.final && !o\.live/.test(newsJs) && /before: '\.club-grain'/.test(newsJs)
   && /final: g\.status === 'final'/.test(src('news/news-page.js')));

console.log('\nthe posts');
const art = { title: 'Lonnie Walker joins Besiktas', summary: 'Besiktas have signed Lonnie Walker, via multiple reports.', kind: 'story', brand: { name: 'Desk' },
              url: 'https://example.org/a', league: { name: 'EuroLeague', slug: 'euroleague' } };
const lw = A.analyse(art, { clubs: [{ name: 'Besiktas Istanbul', short: 'BES', colour: '#000000', colour2: '#ffffff' }] });
const p0 = NP.compose(art, lw);
ok('a signing is a headline post: its subject on the first line, the rest in the accent', p0.template === 'headline' && p0.headline === 'Lonnie Walker\njoins Besiktas'
   && NP.parseHeadline(p0.headline).lines.length === 2 && p0.kicker === 'NEW SIGNING' && p0.sub === 'via Desk', p0);
ok('A NEW POST HAS NO CUT-OUT: a figure is only ever a picture a person gives it', Array.isArray(p0.cutouts) && p0.cutouts.length === 0 && p0.photos.length === 0);
ok('the template a story suits: a quote, an injury, a result, a number',
   NP.compose(art, an('Coach speaks', '“We will be back next week, stronger than before,” he said.')).template === 'quote'
   && NP.compose(art, an('Lions star injured', 'He is sidelined with an ankle sprain.')).template === 'report'
   && NP.compose(art, Object.assign(an('Adelaide beat Tasmania 88-81', ''), {})).template === 'result'
   && NP.compose(art, an('A 12-0 run settles it', '')).template === 'stat');
ok('*stars* colour words, a typed line break is a line', JSON.stringify(NP.parseHeadline('one *two*\nthree').lines.map(l => l.map(w => w.text + (w.accent ? '*' : '')))) === '[["ONE","TWO*"],["THREE"]]');
ok('a report\'s rows: a line each, cells by | or a tab', JSON.stringify(NP.parseRows('SF | A | Out | R6 | note\nC\tB\tGame-time')) === '[["SF","A","Out","R6","note"],["C","B","Game-time"]]');
ok('the status pills: out red, game-time amber, available green, the rest grey',
   NP.statusStyle('Out').ink === '#c81e1e' && NP.statusStyle('Game-time').ink === '#8a5a00' && NP.statusStyle('Available').ink === '#147a3d' && NP.statusStyle('Uncertain').ink === '#3d4350');
const full = Object.assign(NP.compose(art, lw), {
  photos: [{ img: img(1600, 1000, 'photo'), panX: 0.2, zoom: 1.2 }, { img: img(800, 1000, 'photo2') }],
  cutouts: [{ img: img(600, 900, 'cutout') }],
  quote: 'I don’t think he’s played well in the four preseason games, but he’s had good practices,', who: 'JJ REDICK', whoLine: 'on the preseason',
  rows: NP.parseRows('SF | Isaac Bonga | Game-time | Round 6 | A *wrist injury* after a DNP\nC | Ioannis Kouzeloglou | Out | Indefinitely | Not on the roster'),
  sponsor: { text: 'PRESENTED BY:', name: 'sponsor' }, stat: { value: '35', label: 'POINTS', who: 'BRYCE COTTON' },
  score: { home: clubs[0], away: clubs[1], hs: 88, as: 81, label: 'FINAL' }, club: clubs[0],
  images: { crest: img(300, 300, 'crest'), crests: [img(300, 300, 'crest'), img(300, 300, 'crest')], brand: img(120, 120, 'brand'), sponsor: null },
  facts: cases.duel
});
for (const [t] of NP.TEMPLATES) {
  for (const size of Object.keys(NP.SIZES)) {
    const S = NP.SIZES[size];
    for (const withPhoto of [true, false]) {
      const post = Object.assign({}, full, { template: t, size }, withPhoto ? {} : { photos: [], cutouts: [] });
      const c = recorder(S.w, S.h);
      let threw = null;
      try { NP.draw(c, post, { size }); } catch (e) { threw = e.message; }
      const o = off(c.log, S.w, S.h);
      const covered = size === 'story' ? c.log.filter(e => e.kind === 'text' && (e.y0 < S.top - 4 || e.y1 > S.h - S.bottom + 4)) : [];
      ok(`${t} / ${size}${withPhoto ? '' : ', no pictures'}: drawn, every word on it` + (size === 'story' ? ', none under Instagram\'s bars' : ''),
         !threw && !o.length && !covered.length, threw || o.concat(covered).slice(0, 3).map(e => e.t + '@' + Math.round(e.x0) + ',' + Math.round(e.y0)));
      if (!withPhoto) ok(`${t} / ${size}, no pictures: no cut-out drawn`, !c.log.some(e => e.kind === 'image' && e.tag === 'cutout'));
    }
  }
}
{
  const empty = Object.assign({}, full, { template: 'report', rows: [] });
  const saved = recorder(1080, 1350), shown = recorder(1080, 1350);
  NP.draw(saved, empty, { size: 'portrait' }); NP.draw(shown, empty, { size: 'portrait', preview: true });
  const hint = l => l.some(e => e.kind === 'text' && /injury report/.test(e.t));
  ok('an empty table\'s hint is on the preview, never on the saved picture', hint(shown.log) && !hint(saved.log));
}
{
  const off2 = Object.assign({}, full, { template: 'headline', off: ['crest', 'kicker', 'headline', 'sub', 'brand', 'cutouts'] });
  const c = recorder(1080, 1350); NP.draw(c, off2, { size: 'portrait' });
  ok('every piece switched off is not drawn', !c.log.some(e => e.kind === 'text') && !c.log.some(e => e.kind === 'image' && /crest|cutout|brand/.test(e.tag)));
}
const cap = NP.caption(Object.assign({}, p0));
ok('the words to post it with: the headline, the first line, the link, the tags', /^Lonnie Walker joins Besiktas/.test(cap) && /Read it: https:\/\/example\.org\/a/.test(cap)
   && /#EuroLeague/.test(cap) && /#LonnieWalker/.test(cap) && /#basketball$/.test(cap), cap);
ok('a quote post\'s words open with the quote and who said it', /^“We will be back next week, stronger than before,” — Coach/.test(
   NP.caption(Object.assign(NP.compose(art, an('Coach speaks', '“We will be back next week, stronger than before,” he said.')), { who: 'COACH' }))));
ok('a file name from the story, the template and the size', NP.filename(p0, 'story') === 'lonnie-walker-joins-besiktas-headline-story.png');

console.log('\nthe pages');
const hub = src('creators/hub/index.html');
ok('the hub loads the post kit and has its section', /newsart\.js\?v=\d+/.test(hub) && /newspost\.js\?v=\d+/.test(hub) && /hub\/?posts\.js\?v=\d+|"posts\.js\?v=\d+"/.test(hub)
   && /id="posts"/.test(hub) && /injuries\.js\?v=\d+/.test(hub));
ok('the hub mounts it when a league is chosen', /newsPosts\(\)/.test(src('creators/hub/hub.js')));
const nc = src('newscard.js');
ok('a card with no picture gets its cover, from newsart.js loaded beside newscard.js at its version',
   /newsart\.js' \+ \(m\[2\] \|\| ''\)/.test(nc) && /cover\(plate, f, it, partner\)/.test(nc) && /artFigure/.test(src('news/news-page.js')) && /K\.art\(/.test(src('news.js')));
const ncss = src('kit/newscard.css');
ok('a card with a drawn cover shows its publisher\'s badge (whose story it is), no grain over the drawing, and a partner\'s pill below the words',
   /\.pc-noimg \.pc-plate\.has-art > \.pc-badge\{display:flex\}/.test(ncss) && /\.pc-plate\.has-art > \.pc-grain\{display:none\}/.test(ncss)
   && /avoid: '\.pc-badge,\.pc-kind,\.pc-partner'/.test(nc) && /chrome: true, avoid: null/.test(nc)
   && /\.club-plate\.has-art > \.club-grain\{display:none\}/.test(src('kit/news.css')));
{
  /* the words stay above a partner's pill: nothing drawn in the bottom fifth but the ground */
  const f = an('Valencia center reportedly moves to Germany', 'Yankuba Sima is leaving Valencia Basket.');
  const c = recorder(296, 185);
  A.drawArt(c, 296, 185, f, { clubs: [img(200, 200, 'crest')] }, { safeTop: 0.2, safeBottom: 0.2 });
  const low = c.log.filter(e => e.kind === 'text' && e.y1 > 185 * 0.8 + 1);
  ok('a partner\'s cover keeps every word above the pill\'s band', !low.length, low.map(e => e.t));
}
ok('no test figure ships: nothing under epinoia/ names a lab or a cut-out file', !/_lab\/|cutout\.png/.test(nc + src('newsart.js') + src('newspost.js') + src('creators/hub/posts.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
