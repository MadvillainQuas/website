// A MATCH REPORT'S CARD AND ITS ARTICLE'S HEAD (epinoia/news.js matchPlate, kit/news.css): the result as a
// broadcast puts it up, in the clubs' colours, with the LEAGUE's logo in the corner. The clubs' three letters
// (a club's prefix passed over, a derby told apart), the league's own colour and never the platform's default,
// the logo's chip and its monogram when there is no logo, the losing figure dimmed, FINAL (or LIVE) over the
// score, the card's edge in the winner's colour; the news page's head and the front page's wiring.
//   node supabase/tests/match-plate.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* ------------------------------------------------------------ a fake page --- */
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.title = '';
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: k => props[k] };
  }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return { contains: c => list().includes(c), add: c => { if (!list().includes(c)) self.className = list().concat(c).join(' '); },
             remove: c => { self.className = list().filter(x => x !== c).join(' '); } };
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { throw new Error('innerHTML used: ' + v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t) { (this.listeners[t] || []).forEach(fn => fn({ type: t })); }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  find(sel) { return this.findAll(sel)[0] || null; }
  findAll(sel) { const want = sel.split('.').filter(Boolean); return this.all().filter(n => want.every(c => n.classList.contains(c))); }
}
globalThis.document = { createElement: t => new El(t), createTextNode: t => new Text(t) };
const asked = [];
globalThis.window = { epinoiaLogoUrl: (p, px) => { asked.push([p, px]); return p ? 'https://img.example/' + p + '?w=' + px : null; } };

const N = require(path.join(root, 'epinoia', 'news.js'));

/* ------------------------------------------------------- the three letters --- */
console.log('\na club\'s three letters (codeOf)');
ok('a short name that is a code already, as it is', N.codeOf('che', 'Cheshire Phoenix') === 'CHE');
ok('a short name of words: its first word\'s first three', N.codeOf('Leicester Riders', 'Leicester Riders') === 'LEI');
ok('no short name: the name\'s', N.codeOf('', 'London Lions') === 'LON' && N.codeOf(null, 'Surrey 89ers') === 'SUR');
ok('a club\'s prefix is passed over (KK, BC, CB), and a Le or La',
   N.codeOf(null, 'KK Partizan Mozzart Bet') === 'PAR' && N.codeOf(null, 'BC Wolves') === 'WOL' &&
   N.codeOf(null, 'CB Canarias') === 'CAN' && N.codeOf(null, 'Le Mans Sarthe') === 'MAN',
   [N.codeOf(null, 'KK Partizan Mozzart Bet'), N.codeOf(null, 'BC Wolves'), N.codeOf(null, 'CB Canarias'), N.codeOf(null, 'Le Mans Sarthe')]);
ok('...but a name that is only short words keeps them', N.codeOf(null, 'AS') === 'AS');
ok('letters beyond Latin-1 are letters', N.codeOf(null, 'Žalgiris Kaunas') === 'ŽAL', N.codeOf(null, 'Žalgiris Kaunas'));
ok('"last" takes the full name\'s last word (a derby)', N.codeOf('LON', 'London Lions', 'last') === 'LIO' &&
   N.codeOf(null, 'London City Royals', 'last') === 'ROY');
ok('nothing to go on is nothing', N.codeOf(null, '') === '' && N.codeOf(undefined, undefined) === '');

/* ------------------------------------------------------------ the card --- */
const LEAGUE = { id: 'L1', slug: 'slb', name: 'Super League Basketball Men', colour_a: '#f08a24', colour_b: '#111111',
                 colour_source: 'logo', logo_path: 'leagues/slb.png' };
const ROW = { id: 'a1', slug: 'report-1234abcd', title: 'Cheshire Phoenix beat Leicester Riders 108–94', game_id: 'g1',
              home_name: 'Cheshire Phoenix', home_short: 'CHE', home_colour: '#1d3f8f', home_colour_2: '#f2c230', home_logo: 'clubs/che.png',
              away_name: 'Leicester Riders', away_short: null, away_colour: '#c8102e', away_colour_2: null, away_logo: null,
              home_score: 108, away_score: 94, published_at: '2026-09-27T21:30:00Z', author_name: 'Epinoia match report' };
const cardOf = (row, opts) => N.card(row, Object.assign({ leagueSlug: 'slb', base: '' }, opts || {}));

console.log('\na match report\'s card');
{
  asked.length = 0;
  const c = cardOf(ROW, { league: LEAGUE });
  const plate = c.find('club-plate');
  ok('the card is a match report\'s, and its plate the result\'s', c.classList.contains('match') && plate && plate.classList.contains('mt-plate'));
  const hh = plate.find('mt-half.home'), ah = plate.find('mt-half.away');
  ok('each half in its club\'s colour', hh.style.getPropertyValue('--c') === '#1d3f8f' && ah.style.getPropertyValue('--c') === '#c8102e');
  ok('...its second colour beside it, or its first again', hh.style.getPropertyValue('--c2') === '#f2c230' && ah.style.getPropertyValue('--c2') === '#c8102e');
  ok('the cut: a black edge and the league\'s stripe', plate.findAll('mt-seam').length === 2 && plate.findAll('mt-seam.k').length === 1);
  ok('the league\'s own colour on the plate, and the words on it in black (orange reads black)',
     plate.style.getPropertyValue('--lg') === '#f08a24' && plate.style.getPropertyValue('--lg-ink') === '#0a0a0a',
     [plate.style.getPropertyValue('--lg'), plate.style.getPropertyValue('--lg-ink')]);

  const home = plate.find('mt-club.home'), away = plate.find('mt-club.away');
  ok('the winner and the loser are marked', home.classList.contains('win') && away.classList.contains('lose'));
  ok('a crest from its logo, at 192 px', home.find('mt-crest').children[0].src === 'https://img.example/clubs/che.png?w=192');
  ok('...a club without one shows its letters', away.find('mt-crest').textContent === 'LEI' && !away.find('mt-crest').children.length);
  ok('...and a crest that does not load gives way to them', (() => {
    const img = home.find('mt-crest').children[0]; img.fire('error');
    return home.find('mt-crest').textContent === 'CHE';
  })());
  ok('the codes under the crests, each with the full name as its title',
     home.find('mt-name').textContent === 'CHE' && away.find('mt-name').textContent === 'LEI' &&
     home.find('mt-name').title === 'Cheshire Phoenix' && away.find('mt-name').title === 'Leicester Riders');

  const st = plate.find('mt-st'), sc = plate.find('mt-sc');
  ok('FINAL over the score (a word the packs already have: "final")', st && st.textContent === 'Final' && !st.classList.contains('live'));
  const v = sc.findAll('v');
  ok('the score, the losing figure dimmed', v.length === 2 && v[0].textContent === '108' && v[1].textContent === '94' &&
     !v[0].classList.contains('lose') && v[1].classList.contains('lose'));

  const chip = plate.find('mt-league');
  const mid = plate.find('mt-mid');
  ok('the league\'s chip heads the score\'s column, over the board (no crest can run into it)',
     mid && mid.children[0] === chip && mid.children[1].classList.contains('mt-board') && mid.children[1].find('mt-st') === st);
  ok('the league\'s logo, at 96 px, named', chip && chip.children[0].tagName === 'IMG' &&
     chip.children[0].src === 'https://img.example/leagues/slb.png?w=96' && chip.children[0].alt === LEAGUE.name && chip.title === LEAGUE.name);
  ok('...and a logo that does not load becomes the league\'s monogram on its colour', (() => {
    chip.children[0].fire('error');
    return chip.textContent === 'SLB' && chip.classList.contains('mono') && chip.style.getPropertyValue('--lg') === '#f08a24';
  })(), chip.textContent);
  ok('the card\'s edge is the winner\'s colour, not a hash of the headline', c.style.getPropertyValue('--ink-c') === '#1d3f8f', c.style.getPropertyValue('--ink-c'));
  ok('no corner marks on the result\'s print (they are the generated plate\'s)', !plate.findAll('club-reg').length);
  const latest = cardOf(ROW, { league: LEAGUE, latest: true }), pinned = cardOf(Object.assign({}, ROW, { pinned: true }), { league: LEAGUE, latest: true });
  ok('its flag is a tab on the words\' panel, not on the print (where it ran into a crest)',
     latest.find('news-cbody').find('news-flag').textContent === 'Latest' && !latest.find('club-plate').find('news-flag'));
  ok('...a pin as well, and still a pin, not Latest', pinned.find('news-cbody').find('news-flag.pin') &&
     pinned.find('news-cbody').find('news-flag').textContent === 'Pinned' && !pinned.find('club-plate').find('news-flag'));
  ok('...while any other card keeps its flag on its plate', (() => {
    const w = cardOf({ id: 'b', slug: 'b', title: 'A signing', published_at: '2026-09-20T10:00:00Z' }, { latest: true });
    return w.find('club-plate').find('news-flag') && !w.find('news-cbody').find('news-flag');
  })());
  ok('the headline, the kicker and the byline are still the card\'s', c.find('news-title').textContent === ROW.title &&
     /Match report/.test(c.find('news-kick').textContent) && c.find('club-ed').textContent === 'Epinoia match report');
}

console.log('\nthe league\'s colour is its own or none');
{
  const plateOf = lg => cardOf(ROW, { league: lg }).find('club-plate');
  ok('a colour from its logo, or set by hand, is worn', plateOf(Object.assign({}, LEAGUE, { colour_source: 'manual' })).style.getPropertyValue('--lg') === '#f08a24');
  ok('the platform\'s default is not (the kit\'s own stripe instead)', plateOf(Object.assign({}, LEAGUE, { colour_source: 'default' })).style.getPropertyValue('--lg') === undefined);
  ok('...nor the default mint, whatever it says', plateOf(Object.assign({}, LEAGUE, { colour_a: '#93F2BF' })).style.getPropertyValue('--lg') === undefined);
  ok('a dark league colour carries white words', plateOf(Object.assign({}, LEAGUE, { colour_a: '#1a237e' })).style.getPropertyValue('--lg-ink') === '#ffffff');
  const noLogo = plateOf(Object.assign({}, LEAGUE, { logo_path: null })).find('mt-league');
  ok('a league without a logo: its monogram on its colour', noLogo && noLogo.textContent === 'SLB' && noLogo.classList.contains('mono') &&
     noLogo.style.getPropertyValue('--lg') === '#f08a24');
  const nothing = cardOf(ROW, {}).find('club-plate');
  ok('no league row (a caller that has none): the result all the same, no chip, the kit\'s stripe',
     nothing.classList.contains('mt-plate') && !nothing.find('mt-league') && nothing.style.getPropertyValue('--lg') === undefined);
}

console.log('\nthe card\'s colour, a derby, a game without a score');
{
  const away = cardOf(Object.assign({}, ROW, { home_score: 80, away_score: 91 }), { league: LEAGUE });
  ok('an away win: the away club\'s colour', away.style.getPropertyValue('--ink-c') === '#c8102e');
  const pale = cardOf(Object.assign({}, ROW, { home_colour: '#fafafa' }), { league: LEAGUE });
  ok('a winner too pale to edge a white card gives way to the other club', pale.style.getPropertyValue('--ink-c') === '#c8102e');
  const mint = cardOf(Object.assign({}, ROW, { home_colour: '#93f2bf', away_colour: null }), { league: LEAGUE });
  ok('...and two clubs on no colour of their own to the headline\'s tint', /^hsl\(/.test(mint.style.getPropertyValue('--ink-c')) &&
     mint.find('mt-half.home').style.getPropertyValue('--c') === mint.style.getPropertyValue('--ink-c'));
  const derby = cardOf(Object.assign({}, ROW, { home_name: 'London Lions', home_short: null, away_name: 'London City Royals', away_short: null }), { league: LEAGUE });
  ok('a derby is never LON v LON', derby.find('mt-club.home').find('mt-name').textContent === 'LIO' &&
     derby.find('mt-club.away').find('mt-name').textContent === 'ROY',
     [derby.find('mt-club.home').find('mt-name').textContent, derby.find('mt-club.away').find('mt-name').textContent]);
  const vs = cardOf(Object.assign({}, ROW, { home_score: null, away_score: null }), { league: LEAGUE }).find('club-plate');
  ok('no score: "v", no FINAL, nobody marked', vs.find('mt-sc.vs') && vs.find('mt-sc.vs').textContent === 'v' && !vs.find('mt-st') &&
     !vs.find('mt-club.win') && !vs.find('mt-club.lose'));
  const covered = cardOf(Object.assign({}, ROW, { cover_path: 'news/x.jpg' }), { league: LEAGUE, url: p => 'https://img.example/' + p });
  ok('a report with a cover photograph keeps the photograph', !covered.find('club-plate').classList.contains('mt-plate') && covered.find('news-cover-img'));
  const written = cardOf({ id: 'b', slug: 'signing', title: 'A new signing', published_at: '2026-09-20T10:00:00Z' }, { league: LEAGUE });
  ok('an article that is not a report is the generated plate, as it was', !written.classList.contains('match') &&
     written.find('club-flood') && written.findAll('club-reg').length === 4 && !written.find('mt-league'));
}

/* ------------------------------------------------------ the article's head --- */
console.log('\nthe article\'s head (plate)');
{
  const p = N.plate(ROW, { league: LEAGUE, when: '27 Sep 2026' });
  ok('the plate on its own, wide', p.classList.contains('club-plate') && p.classList.contains('art-plate') && p.classList.contains('mt-plate'));
  const nm = p.find('mt-club.home').find('mt-name');
  ok('the names in full, with the code beside for a narrow head (kit/news.css shows one)',
     nm.find('full').textContent === 'Cheshire Phoenix' && nm.find('code').textContent === 'CHE');
  ok('FINAL and the day over the score', p.find('mt-st').textContent === 'Final · 27 Sep 2026' && p.find('mt-st').find('when'));
  ok('the winner\'s colour as its own (the shadow under it)', p.style.getPropertyValue('--ink-c') === '#1d3f8f');
  ok('the league\'s logo in its corner', p.find('mt-league') && p.find('mt-league').children[0].src === 'https://img.example/leagues/slb.png?w=96');
  const live = N.plate(ROW, { league: LEAGUE, live: true });
  ok('a game opened again since says LIVE (a word the packs have: "live")', live.find('mt-st').textContent === 'Live' && live.find('mt-st').classList.contains('live'));
}

/* ------------------------------------------------------------ the wiring --- */
console.log('\nthe pages hand the card their league');
{
  const home = read('epinoia', 'home.js');
  /* the front page's news is HOME's feed now (feedview.js, the post card): the plate stays the article's head and the news page's card */
  ok('the front page\'s news is the feed, given the league', /EpinoiaFeedView[\s\S]{0,400}league: \{ id: LEAGUE\.id, slug: LEAGUE\.slug/.test(home) && !/mountHeadlines/.test(home));
  const page = read('epinoia', 'news', 'news-page.js');
  ok('the news page reads the league\'s logo and where its colour came from',
     /'&select=id,slug,name,colour_a,colour_b,colour_source,logo_path&limit=1'/.test(page));
  ok('...and gives its cards the league', /N\.card\(a, \{[\s\S]{0,120}base: '\.\.\/', league/.test(page));
  const one = page.slice(page.indexOf('async function one('), page.indexOf('function heroOf('));
  ok('an article keeps its head\'s place above the cover and the words, while the game is read',
     one.indexOf("el('div', 'art-plate-slot'") > 0 && one.indexOf("el('div', 'art-plate-slot'") < one.indexOf('if (a.cover_path)') &&
     /generated && !a\.cover_path \? ' is-wait' : ''/.test(one));
  ok('...and lets it go whatever the answer', (one.match(/settle\(\)/g) || []).length >= 2);
  ok('a report without a cover gets the result as its head', /if \(!a\.cover_path && N\.plate\) \{ const h = heroOf\(g, league, a\)/.test(one));
  const hero = page.slice(page.indexOf('function heroOf('), page.indexOf('async function reportGame('));
  ok('the head opens the box score', /link\.href = gameHref\(g\.id\)/.test(hero) && /aria-label/.test(hero));
  ok('...FINAL with the day only for a final game, LIVE for one opened again',
     /N\.plate\(row, \{ league, live: g\.status === 'live', when: g\.status === 'final' \? day : '' \}\)/.test(hero));
}

console.log('\nthe print (kit/news.css)');
{
  const css = read('epinoia', 'kit', 'news.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the score\'s column stacks the chip over the board', /\.mt-mid\{[^}]*flex-direction:column/.test(css) &&
     /\.mt-board\{[^}]*background:#0a0a0a/.test(css));
  ok('...the chip in its flow, not laid over a corner', /\.mt-league\{/.test(css) && !/\.mt-league\{[^}]*position:absolute/.test(css));
  ok('the plate measures itself, and its crests, score and chip are sized by it (cqw), not by the window',
     /\.mt-plate\{[^}]*container:mtplate \/ inline-size/.test(css) && /\.mt-crest\{[^}]*width:clamp\([^)]*cqw/.test(css) &&
     /\.mt-sc\{[^}]*font-size:clamp\([^)]*cqw/.test(css) && /\.mt-league\{[^}]*height:clamp\([^)]*cqw/.test(css) &&
     !/\.mt-sc\{[^}]*vw/.test(css));
  ok('...its monogram on the league\'s colour', /\.mt-league\.mono\{[^}]*var\(--lg/.test(css));
  ok('the stripe is the league\'s colour, the kit\'s own without one', /\.mt-seam\{[^}]*var\(--lg,/.test(css));
  ok('FINAL on the league\'s colour, LIVE on the live red', /\.mt-st\{[^}]*background:var\(--lg,/.test(css) && /\.mt-st\.live\{[^}]*background:var\(--tt-red/.test(css));
  ok('the losing figure dimmed', /\.mt-sc \.v\.lose\{[^}]*color:/.test(css));
  ok('the article\'s head measures its slot', /\.art-plate-slot\{[^}]*container:artslot \/ inline-size/.test(css));
  ok('...its height following its width, with no phone and desktop shapes for the site\'s zoom to put in the wrong places',
     /\.art-plate\{[^}]*aspect-ratio:auto;height:clamp\([^)]*cqw/.test(css));
  const narrow = (css.match(/@container artslot \(max-width:560px\)\{([\s\S]*?\})\s*\}/) || [])[1] || '';
  ok('...a name in full wrapping to two lines, then, narrower, the codes for the names',
     /\.art-plate \.mt-name\{[^}]*white-space:normal/.test(css) && /\.art-plate \.mt-name \.full\{display:none\}/.test(narrow) &&
     /\.art-plate \.mt-name \.code\{display:inline\}/.test(narrow), narrow.slice(0, 200));
  ok('...and on a phone FINAL without the day', /@container artslot \(max-width:420px\)\{\s*\.art-plate \.mt-st \.when\{display:none\}/.test(css));
  ok('a match report\'s flag sits on the line under the print, at the right', /\.news-cbody > \.news-flag\{[^}]*top:-\d+px[^}]*right:/.test(css) &&
     /\.news-card \.news-cbody\{position:relative\}/.test(css));
  ok('its place, kept while the game is read, goes when empty', /\.art-plate-slot:empty\{display:none\}/.test(css) && /\.art-plate-slot\.is-wait::before\{/.test(css));
}

console.log('\nthe words');
for (const [lang, file] of [['Spanish', 'es.js'], ['Japanese', 'ja.js']]) {
  const pack = read('epinoia', 'i18n', file);
  ok(lang + ' has FINAL and LIVE (the lookup folds the case)', /^\s*'final':\s*'[^']+'/m.test(pack) && /^\s*'live':\s*'[^']+'/m.test(pack));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
