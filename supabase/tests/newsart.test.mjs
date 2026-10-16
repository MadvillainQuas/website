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
  ok('a finished game\'s cover: FINAL on the board, the night\'s number as its strap, no FINAL SCORE', all.includes('FINAL') && !all.includes('FINALSCORE')
     && all.includes('25POINTS') && texts.includes('85') && texts.includes('75'), texts);
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
   /newsart\.js' \+ \(m\[2\] \|\| ''\)/.test(nc) && /cover\(plate, f, it\)/.test(nc) && /artFigure/.test(src('news/news-page.js')) && /K\.art\(/.test(src('news.js')));
ok('no test figure ships: nothing under epinoia/ names a lab or a cut-out file', !/_lab\/|cutout\.png/.test(nc + src('newsart.js') + src('newspost.js') + src('creators/hub/posts.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
