// The console's Links tab and the public pages' switchers (epinoia/admin/platform/links-ui.js, epinoia/linkswitch.js). No browser,
// no network: a small stand-in for the page, and fake answers in the shape the database gives (0178).
//
//   node supabase/tests/links-ui.test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

/* ---------------------------------------------------------------- a stand-in page --- */
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.text = ''; this.attrs = {}; this.handlers = {}; this.style = {}; this.dataset = {}; this._cls = new Set(); this.hidden = false; this.value = ''; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { (on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c); } }; }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? Object.assign(new N('#text'), { text: c }) : c)); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.text = v == null ? '' : String(v); }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  fire(t, e = {}) { (this.handlers[t] || []).forEach(f => f(Object.assign({ preventDefault() {}, stopPropagation() {}, target: this, key: '' }, e))); }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.find(pred, out)); return out; }
  cls(c) { return this.find(n => n._cls.has(c)); }
}
const docHandlers = {};
globalThis.document = {
  createElement: t => new N(t), createTextNode: t => Object.assign(new N('#text'), { text: t }),
  addEventListener: (t, f) => { (docHandlers[t] = docHandlers[t] || []).push(f); },
  querySelector: () => null, body: new N('body')
};
globalThis.window = {};
const require = createRequire(import.meta.url);
const L = require(path.join(here, '..', '..', 'epinoia', 'admin', 'platform', 'links-ui.js'));
const K = require(path.join(here, '..', '..', 'epinoia', 'linkswitch.js'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- the console: pure --- */
console.log('-- the flagged possibilities');
const sug = [{ confidence: 'low' }, { confidence: 'high' }, { confidence: 'medium' }, { confidence: 'high' }];
ok('the tally counts each confidence', JSON.stringify(L.tally(sug)) === JSON.stringify({ high: 2, medium: 1, low: 1 }));
ok('narrowing keeps one confidence, "all" keeps every one', L.narrowed(sug, 'high').length === 2 && L.narrowed(sug, 'all').length === 4 && L.narrowed(sug, 'low').length === 1);
ok('the most sure sort first', sug.slice().sort(L.bySureness).map(r => r.confidence).join() === 'high,high,medium,low');
ok('each confidence says what it means', ['high', 'medium', 'low'].every(k => L.CONF_HELP[k].length > 10));
ok('every kind of player match has a word, the ambiguous initial included', ['exact', 'core', 'short', 'ambiguous'].every(k => L.KIND_WORD[k]));
const team = { id: 't1', slug: 'london-lions', name: 'London Lions', competitions: [{ season: '2026-27', name: 'A' }, { season: '2026-27', name: 'B' }, { season: '2025-26', name: 'A' }] };
ok('a team\'s seasons are listed once each, newest first', JSON.stringify(L.seasonsOf(team)) === JSON.stringify(['2026-27', '2025-26']));
const pcard = { spells: [{ team: 'Newcastle', league: 'SLB', season: '2026-27' }, { team: 'Newcastle', league: 'SLB', season: '2026-27' }, { team: 'Bourg', league: 'Elite', season: '2025-26' }, { team: 'X', league: 'Y', season: '2024-25' }, { team: 'Z' }] };
const sp = L.spellLines(pcard, 3);
ok('a player\'s places, without repeats, capped, the rest counted', sp.shown.length === 3 && sp.more === 1 && sp.shown[0] === 'Newcastle · SLB · 2026-27', sp);
ok('a link to the public page opens the team by slug and the player by id', L.publicHref('team', team) === '../../t/?t=london-lions' && L.publicHref('player', { id: 'abc' }) === '../../p/?p=abc');

/* ---------------------------------------------------------------- the dropdown --- */
console.log('-- the dropdown');
{
  const asked = []; const picked = [];
  let release = null;
  const C = L.combo({
    placeholder: 'find', delay: 0,
    fetch: q => { asked.push(q); if (q === 'slow') return new Promise(r => { release = () => r([{ id: 'old' }]); }); return Promise.resolve({ rows: [{ id: q + '1' }, { id: q + '2' }], more: q === 'many' }); },
    render: (r, li) => { li.textContent = r.id; },
    pick: r => picked.push(r.id)
  });
  const input = C.input, list = C.root.cls('lk-list')[0];
  const type = async v => { input.value = v; input.fire('input'); await tick(15); };
  await type('ab');
  ok('typing asks the server, and the list shows what came back', asked[asked.length - 1] === 'ab' && list.hidden === false && list.cls('lk-opt').length === 2, asked);
  ok('the first result is highlighted', list.children[0].classList.contains('on'));
  input.fire('keydown', { key: 'ArrowDown' });
  ok('the arrow key moves down', list.children[1].classList.contains('on') && !list.children[0].classList.contains('on'));
  input.fire('keydown', { key: 'Enter' });
  ok('Enter picks the highlighted one, closes the list and clears the box', picked.join() === 'ab2' && list.hidden === true && input.value === '', picked);
  await type('many');
  ok('a query with more behind it says so', list.children[list.children.length - 1].textContent.includes('more matches'));
  input.fire('keydown', { key: 'Escape' });
  ok('Escape closes the list', list.hidden === true);
  await type('slow');                                    // an answer that has not come back yet...
  await type('fast');                                    // ...is overtaken by a later question
  release();
  await tick(15);
  ok('a slow answer to an old question does not replace a newer one', list.cls('lk-opt').map(li => li.textContent).join() === 'fast1,fast2', list.cls('lk-opt').map(li => li.textContent));
  list.cls('lk-opt')[0].fire('pointerdown');
  ok('pressing a result picks it', picked[picked.length - 1] === 'fast1');
  await type('');
  ok('an empty box shows nothing (minChars 1)', list.hidden === true);
}

/* ---------------------------------------------------------------- the public pages --- */
console.log('-- the console: the women\'s / men\'s setting reaches the whole league (0182)');
{
  const card = (o) => Object.assign({ id: 't', league_gender: null, women: false, women_set: false, women_from: 'names' }, o);
  const opts = c => L.womenChoices(c).options.map(x => x[0] + '=' + x[1]);
  ok('the select offers auto, the league\'s two answers and the one-team pair', L.womenChoices(card()).options.map(x => x[0]).join() === 'auto,yes,no,yes1,no1');
  ok('the whole-league answers say so', /women.*whole league/.test(opts(card())[1]) && /men.*whole league/.test(opts(card())[2]) && /this team only/.test(opts(card())[3]) && /this team only/.test(opts(card())[4]), opts(card()));
  ok('nothing set: it shows "auto", saying where the answer comes from - the names', L.womenChoices(card()).value === 'auto' && /men \/ mixed \(names\)/.test(opts(card())[0]) && /women \(names\)/.test(opts(card({ women: true }))[0]));
  ok('...or the league, or the team\'s own recorded gender', /women \(its league\)/.test(opts(card({ women: true, women_from: 'league' }))[0]) && /men \(its league\)/.test(opts(card({ women_from: 'league' }))[0])
     && /women \(recorded\)/.test(opts(card({ women: true, women_from: 'team_gender' }))[0]));
  ok('a flag that agrees with the league shows as the whole-league option', L.womenChoices(card({ women: true, women_set: true, women_from: 'team', league_gender: 'women' })).value === 'yes'
     && L.womenChoices(card({ women: false, women_set: true, women_from: 'team', league_gender: 'men' })).value === 'no');
  ok('...one that does not (a women\'s side in a men\'s league) as "this team only"', L.womenChoices(card({ women: true, women_set: true, women_from: 'team', league_gender: 'men' })).value === 'yes1'
     && L.womenChoices(card({ women: false, women_set: true, women_from: 'team', league_gender: null })).value === 'no1');
  ok('auto sends only the team and null: the league is never un-set from a club', JSON.stringify(L.womenArgs('auto', 'T')) === JSON.stringify({ p_team: 'T', p_women: null }));
  ok('women / men send the league with them', JSON.stringify(L.womenArgs('yes', 'T')) === JSON.stringify({ p_team: 'T', p_women: true, p_league: true }) && JSON.stringify(L.womenArgs('no', 'T')) === JSON.stringify({ p_team: 'T', p_women: false, p_league: true }));
  ok('the one-team pair say so', JSON.stringify(L.womenArgs('yes1', 'T')) === JSON.stringify({ p_team: 'T', p_women: true, p_league: false }) && JSON.stringify(L.womenArgs('no1', 'T')) === JSON.stringify({ p_team: 'T', p_women: false, p_league: false }));
  const res = { whole_league: true, league: { name: 'Aussie Premier', gender: 'women' }, teams: 12, cleared: 0, kept: 0 };
  ok('after a whole-league save it says which league, and how many teams that reached', L.leagueWords(res, true) === 'Saved. Aussie Premier is now a women\'s league: all 12 of its teams count as women\'s.', L.leagueWords(res, true));
  ok('...men\'s, the same way', /is now a men's league: all 12 of its teams count as men's\./.test(L.leagueWords(res, false)));
  ok('...what it reset and what kept its own answer', /1 team setting that said otherwise was reset\./.test(L.leagueWords(Object.assign({}, res, { cleared: 1 }), true)) && /3 team settings that said otherwise were reset\./.test(L.leagueWords(Object.assign({}, res, { cleared: 3 }), true))
     && /1 team keeps a gender recorded on the team itself\./.test(L.leagueWords(Object.assign({}, res, { kept: 1 }), true)) && /2 teams keep a gender recorded/.test(L.leagueWords(Object.assign({}, res, { kept: 2 }), true)));
  ok('a one-team league says so', /its one team counts as women's/.test(L.leagueWords(Object.assign({}, res, { teams: 1 }), true)));
  ok('one team only, "auto", or a database from before 0182 (a boolean back) says plain "Saved."', L.leagueWords({ whole_league: false, league: null }, true) === 'Saved.' && L.leagueWords(true, true) === 'Saved.' && L.leagueWords(null, null) === 'Saved.');
}

{
  /* the real row: a club's card in the possible matches, its select changed, what goes to the database and what is said */
  const calls = [], said = [];
  const cardT = (id, lg, o) => Object.assign({ id, slug: id, name: 'Aces', league: lg, league_gender: null, women: false, women_set: false, women_from: 'names', competitions: [], namesakes: 0 }, o);
  const sug1 = { rows: [{ key: 'aces', ids: ['t1', 't2'], confidence: 'high', flag: 'possible', reason: 'the same name in 2 leagues', cards: [cardT('t1', 'Aussie Premier'), cardT('t2', 'Cup')] }], total: 1 };
  const sb = { rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'platform_link_filters') return { data: { leagues: [], seasons: [] } };
    if (name === 'platform_link_suggestions') return { data: sug1 };
    if (name === 'platform_link_groups') return { data: { rows: [], total: 0 } };
    if (name === 'platform_team_set_women') return { data: { whole_league: args.p_league === true, league: { name: 'Aussie Premier', gender: 'women' }, teams: 12, cleared: 1, kept: 0, women: true } };
    return { data: null };
  } };
  const host = new N('div');
  await L.mount({ host, sb, say: (t, k) => said.push([t, k]) });
  await tick(20);
  const sel = host.cls('lk-w').filter(n => !n.cls('lk-y').length && !n._cls.has('lk-y'))[0];
  ok('a club row has the women\'s / men\'s select, showing its five choices', !!sel && sel.children.map(o => o.value).join() === 'auto,yes,no,yes1,no1', sel && sel.children.map(o => o.value));
  sel.value = 'yes'; sel.fire('change'); await tick(20);
  const set = calls.find(c => c[0] === 'platform_team_set_women');
  ok('choosing "women · whole league" sends the team, women, and the league along', set && set[1].p_team === 't1' && set[1].p_women === true && set[1].p_league === true, set);
  ok('...and says which league is now women\'s, and how many teams that reached', said.some(s => s[1] === 'ok' && /Aussie Premier is now a women's league: all 12 of its teams count as women's\. 1 team setting that said otherwise was reset\./.test(s[0])), said);
  ok('...then the lists are asked again (the other clubs of that league have changed too)', calls.filter(c => c[0] === 'platform_link_suggestions').length >= 2);
  calls.length = 0; said.length = 0;
  sel.value = 'no1'; sel.fire('change'); await tick(20);
  const one = calls.find(c => c[0] === 'platform_team_set_women');
  ok('"not women · this team only" leaves the league alone', one && one[1].p_women === false && one[1].p_league === false && said.some(s => s[0] === 'Saved.'), [one, said]);
  calls.length = 0;
  sel.value = 'auto'; sel.fire('change'); await tick(20);
  const au = calls.find(c => c[0] === 'platform_team_set_women');
  ok('"auto" sends no league at all', au && au[1].p_women === null && !('p_league' in au[1]), au);
}

console.log('-- the public pages: switchers');
const CARDS = [
  { id: 'a', slug: 'london-lions', name: 'London Lions', league: 'Super League Basketball Men', women: false, competitions: [{ season: '2026-27', name: 'SLB' }, { season: '2026-27', name: 'Cup' }, { season: '2025-26', name: 'SLB' }] },
  { id: 'b', slug: 'london-lions-eurocup', name: 'London Lions', league: 'EuroCup', women: false, competitions: [{ season: '2025-26', name: 'EuroCup' }] },
  { id: 'c', slug: 'london-lions-women', name: 'London Lions', league: 'Super League Basketball Women', women: true, competitions: [{ season: '2026-27', name: 'Championship' }] }
];
ok('seasons across a club\'s teams, newest first', JSON.stringify(K.seasonsAcross(CARDS)) === JSON.stringify(['2026-27', '2025-26']));
ok('a team\'s competitions by season, optionally one season', JSON.stringify(K.bySeason(CARDS[0], null).map(g => g.season)) === JSON.stringify(['2026-27', '2025-26'])
   && K.bySeason(CARDS[0], '2025-26').length === 1 && K.bySeason(CARDS[0], '2026-27')[0].names.join() === 'SLB,Cup');
ok('a player\'s link group: every id, himself first if missing', K.playerIds({ players: [{ id: 'x' }, { id: 'y' }] }, 'me').join() === 'me,x,y' && K.playerIds(null, 'me').join() === 'me'
   && K.playerIds({ players: [{ id: 'me' }, { id: 'y' }] }, 'me').join() === 'me,y');
ok("the women's indicator falls back on the names before the database has it: league, team and the leagues' own languages",
   K.looksWomen('London Lions', 'london-lions-slb-women', 'Super League Basketball Women', 'slb-women') && K.looksWomen('Basket Landes', 'landes', 'Ligue Féminine de Basket')
   && K.looksWomen('Estudiantes', 'e', 'Liga Femenina Endesa') && K.looksWomen('Team', 'team', 'W League')
   && !K.looksWomen('London Lions', 'london-lions', 'Super League Basketball Men') && !K.looksWomen('Womenswear FC'));
ok('a youth side is told from its names too: Liga U, an academy, an age; its age when the name states one',
   K.looksYouth('Casademont Zaragoza', 'zaragoza', 'Liga U', 'liga-u') && K.looksYouth('Seawolves Academy', 'seawolves-academy', 'ProB') && K.looksYouth('Zagreb', 'zagreb', 'ABA U19 League')
   && K.looksYouth('PuHu Juniorit') && K.looksYouth('Chalon', 'c', 'Espoirs ÉLITE') && !K.looksYouth('Sheffield Sharks', 'sheffield-sharks', 'Super League Basketball Men') && !K.looksYouth('Ubuntu FC')
   && K.youthAge('Zagreb', 'ABA U19 League') === 'U19' && K.youthAge('London Lions U-21') === 'U21' && K.youthAge('Under 18 Lions') === 'U18' && K.youthAge('Liga U') === null && K.youthAge('Under 30 Club') === null);
{
  const YOUTH = [CARDS[0], { id: 'd', slug: 'london-lions-u18', name: 'London Lions U18', league: 'Liga U', women: false, youth: true, age: 'U18', competitions: [{ season: '2026-27', name: 'Liga U' }] },
                 { id: 'e', slug: 'london-lions-academy', name: 'London Lions Academy', league: 'Pro B', women: false, youth: true, age: null, competitions: [] }];
  const yi = K.teamSwitcher({ group: 'London Lions', teams: YOUTH }, 'a').cls('ls-comp');
  ok('a youth side in the switcher carries its age, or the word when it has none', yi[1].cls('ls-youth')[0].textContent === 'U18' && yi[2].cls('ls-youth')[0].textContent === 'youth' && yi[0].cls('ls-youth').length === 0);
  ok('the youth chip is a chip of its own, apart from the womens', yi[1].cls('ls-women').length === 0 && K.youthChip('U16').textContent === 'U16');
}
ok('a club linked to nothing gets no switcher; one alone neither', K.teamSwitcher(null, 'a') === null && K.teamSwitcher({ teams: [CARDS[0]] }, 'a') === null);
{
  const sw = K.teamSwitcher({ group: 'London Lions', teams: CARDS }, 'a');
  const items = () => sw.cls('ls-comp');
  ok('a linked club gets a button for each of its leagues, linking to that side\'s page', items().length === 3 && items().map(i => i.href).join() === './?t=london-lions,./?t=london-lions-eurocup,./?t=london-lions-women', items().map(i => i.href));
  ok('...each named for its league', items().map(i => i.cls('ls-comp-t')[0].children[0].textContent).join() === 'Super League Basketball Men,EuroCup,Super League Basketball Women');
  ok('the page you are on is marked, and told to assistive tech', items()[0].classList.contains('on') && items()[0].attrs['aria-current'] === 'page' && !items()[1].classList.contains('on') && !items()[1].attrs['aria-current']);
  ok('the women\'s side carries the indicator', items()[2].cls('ls-women').length === 1 && items()[0].cls('ls-women').length === 0);
  ok('it is buttons and one drop-down: no panel to open, no counter button', sw.cls('ls-pop').length === 0 && sw.cls('ls-btn').length === 0 && sw.cls('ls-btn-n').length === 0);
  ok('a button says its competitions in the tooltip, season by season', items()[0].title === '2026-27: SLB · Cup\n2025-26: SLB', items()[0].title);
  const sel = sw.cls('ls-season')[0];
  ok('with two seasons there is a drop-down, and it holds the seasons alone', !!sel && sel.children.map(o => o.textContent).join() === 'all seasons,2026-27,2025-26', sel && sel.children.map(o => o.textContent));
  ok('...and no league or competition name is in it', !sel.children.some(o => /SLB|EuroCup|Basketball|Championship|Cup/.test(o.textContent)));
  ok('with every season showing, a button says nothing under its name', items().every(i => i.cls('ls-comp-s').length === 0));
  sel.value = '2025-26'; sel.fire('change');
  ok('choosing a season keeps the buttons of the sides that played it', items().length === 2 && items().map(i => i.href).join() === './?t=london-lions,./?t=london-lions-eurocup', items().map(i => i.href));
  ok('...and says under each name which competitions it entered that season', items().map(i => i.cls('ls-comp-s')[0].textContent).join() === 'SLB,EuroCup', items().map(i => i.cls('ls-comp-s').length));
  sel.value = '2026-27'; sel.fire('change');
  ok('...another season, another set', items().length === 2 && items().some(i => i.cls('ls-women').length === 1) && items()[0].cls('ls-comp-s')[0].textContent === 'SLB · Cup');
  sel.value = ''; sel.fire('change');
  ok('"all seasons" brings every side back', items().length === 3);
  const eu = K.teamSwitcher({ group: 'London Lions', teams: CARDS }, 'b');
  const es = eu.cls('ls-season')[0]; es.value = '2026-27'; es.fire('change');
  ok('the side you are on stays even in a season it did not play (the EuroCup side, in 2026-27)', eu.cls('ls-comp').length === 3 && eu.cls('ls-comp')[1].classList.contains('on') && eu.cls('ls-comp')[1].href === './?t=london-lions-eurocup', eu.cls('ls-comp').map(i => i.href));
  ok('...it shows no competitions line for that season', eu.cls('ls-comp').find(i => i.classList.contains('on')).cls('ls-comp-s').length === 0);
  const one = K.teamSwitcher({ group: 'G', teams: [{ id: 'x', slug: 'x', name: 'X', league: 'L1', competitions: [{ season: '2026-27', name: 'A' }] }, { id: 'y', slug: 'y', name: 'X', league: 'L2', competitions: [{ season: '2026-27', name: 'B' }] }] }, 'x');
  ok('sides that share one season still get the drop-down, with that season alone (no "all seasons" to choose)', one.cls('ls-season').length === 1 && one.cls('ls-season')[0].children.map(o => o.textContent).join() === '2026-27' && one.cls('ls-season')[0].value === '2026-27');
  ok('...and its buttons stay plain: one line each, the competitions in the tooltip', one.cls('ls-comp').every(i => i.cls('ls-comp-s').length === 0) && one.cls('ls-comp').map(i => i.title).join() === '2026-27: A,2026-27: B', one.cls('ls-comp').map(i => i.title));
  ok('the season drop-down comes before the buttons', one.children[0].cls('ls-season').length === 1 && one.children[1].classList.contains('ls-comps'));
  ok('a club with no competition recorded yet gets the buttons and no drop-down', (() => { const z = K.teamSwitcher({ teams: [{ id: 'x', slug: 'x', league: 'L1' }, { id: 'y', slug: 'y', league: 'L2' }] }, 'x'); return z.cls('ls-season').length === 0 && z.cls('ls-comp').length === 2; })());
}
{
  const PL = { group: 'Deane Williams', players: [
    { id: 'p1', slug: 'deane-williams', name: 'Deane Williams', spells: [{ team: 'London Lions', league: 'SLB', season: '2026-27' }] },
    { id: 'p2', slug: 'd-williams', name: 'D Williams', spells: [{ team: 'London Lions', league: 'EuroCup', season: '2026-27' }, { team: 'London Lions Women', league: 'SLBW', season: '2025-26', women: true }] }] };
  const sw = K.playerSwitcher(PL, 'p1');
  ok('a linked player gets "other profiles" counting the others', sw && sw.cls('ls-btn-n')[0].textContent === '1');
  const items = sw.cls('ls-item');
  ok('each profile is a link, the current one marked, with where he played', items.length === 2 && items[0].classList.contains('on') && items[1].href === './?p=d-williams' && items[1].cls('ls-row').length === 2, items.map(i => i.href));
  ok('a spell at a women\'s side says so', items[1].cls('ls-women').length === 1 && items[0].cls('ls-women').length === 0);
  ok('a player linked to nothing gets none', K.playerSwitcher(null, 'p1') === null && K.playerSwitcher({ players: [PL.players[0]] }, 'p1') === null);
}
ok('a name is never translated (club, league, player names carry translate="no")', (() => {
  const sw = K.teamSwitcher({ group: 'G', teams: CARDS }, 'a');
  return sw.find(n => n.attrs.translate === 'no').length !== 0;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
