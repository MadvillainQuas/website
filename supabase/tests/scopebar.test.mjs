/* ============================================================================
   WHAT A STATS TABLE COVERS — the covering and conference buttons (scopebar.js).

   A college league is forty-eight clubs in four conferences, and a table of all
   of them is one nobody reads. So the league page's Leaders, Team Stats and
   Strength of Schedule tabs and the Statistics page offer the season's played
   competitions as buttons, and a league of conferences (or groups) a button per
   conference, opening on the first conference when every club would be forty or
   more. The rules are RUN here on leagues shaped like the real ones: U SPORTS
   (48 clubs, four conferences), ProB (29 clubs, Nord and Süd) and BCB (three
   competitions, one of them played). Then the buttons themselves, through a
   small stand-in for the DOM, and the wiring on both pages.

     node supabase/tests/scopebar.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);

globalThis.EpinoiaStandings = require(path.join(ROOT, 'epinoia', 'standings.js'));
const X = require(path.join(ROOT, 'epinoia', 'scopebar.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };

/* ---- leagues shaped like the real ones -------------------------------------- */
const entriesFor = (comp, groups) => {
  const out = [];
  Object.entries(groups).forEach(([g, n]) => {
    for (let i = 0; i < n; i++) out.push({ competition_id: comp, team_id: g.replace(/\W/g, '') + i, group_name: g });
  });
  return out;
};
const USPORTS = [{ id: 'us', name: 'U SPORTS 2026-27', kind: 'league', format: 'conferences' },
                 { id: 'usp', name: 'U SPORTS Final 8', kind: 'playoff', format: 'knockout' }];
const usEntries = entriesFor('us', { 'Canada West': 17, OUA: 19, AUS: 8, RSEQ: 4 })
  .concat([{ competition_id: 'usp', team_id: 'OUA0', group_name: null },
           { competition_id: 'usp', team_id: 'AUS0', group_name: null }]);
const us = X.model(USPORTS, usEntries, new Set(['us', 'usp']));

console.log('\na college league of four conferences');
{
  const G = X.groups(us, ['us', 'usp']);
  ok('one button per conference, in name order', G.list.map(g => g.name).join('|') === 'AUS|Canada West|OUA|RSEQ',
     G.list.map(g => g.name).join('|'));
  ok('...named as the conferences themselves, the way the standings name them',
     G.list.every(g => g.label === g.name));
  ok('...and the row is called "conference"', G.noun === 'conference');
  ok('every club in view is counted once', G.clubs.size === 48, G.clubs.size);
  ok('forty-eight clubs open on the first conference, not on a table of all of them',
     X.settle(us, ['us', 'usp'], null) === 'AUS');
  ok('...a conference the reader chose stays chosen', X.settle(us, ['us', 'usp'], 'OUA') === 'OUA');
  ok('...and so does "all", once the reader has asked for it', X.settle(us, ['us', 'usp'], 'all') === 'all');
  ok('...while a conference this scope does not have falls back to the first', X.settle(us, ['us'], 'Nord') === 'AUS');
  const keepOUA = X.keeper(us, ['us', 'usp'], 'OUA');
  ok('the OUA’s clubs are shown and nobody else’s', keepOUA('OUA3') && !keepOUA('AUS3') && !keepOUA('RSEQ1'));
  ok('"all" keeps everybody', X.keeper(us, ['us'], 'all')('RSEQ1') && X.keeper(us, ['us'], null)('AUS0'));
  ok('the playoffs alone have no conferences to offer', X.groups(us, ['usp']).list.length === 0 &&
     X.settle(us, ['usp'], 'OUA') === 'all');
}

console.log('\na league played in two groups');
{
  const PROB = [{ id: 'pb', name: 'ProB', kind: 'league', format: 'groups' }];
  const pb = X.model(PROB, entriesFor('pb', { Nord: 14, 'Süd': 15 }), new Set(['pb']));
  const G = X.groups(pb, ['pb']);
  ok('Nord and Süd, named "Group Nord" and "Group Süd" as the table names them',
     G.list.map(g => g.label).join('|') === 'Group Nord|Group Süd', G.list.map(g => g.label).join('|'));
  ok('...in a row called "group"', G.noun === 'group');
  ok('twenty-nine clubs open on all of them', X.settle(pb, ['pb'], null) === 'all');
  ok('...with the groups a tap away', X.keeper(pb, ['pb'], 'Nord')('Nord3') && !X.keeper(pb, ['pb'], 'Nord')('Sd3'));
}

console.log('\na season of three competitions, one of them played');
{
  const BCB = [{ id: 'lg', name: 'BCB 2026-2027', kind: 'league', format: 'table' },
               { id: 'tr', name: 'BCB Trophy 2027', kind: 'trophy', format: 'table' },
               { id: 'dup', name: 'British Championship Basketball', kind: 'league', format: 'table' }];
  const bcb = X.model(BCB, entriesFor('tr', { '': 20 }).map(e => Object.assign(e, { group_name: null })), new Set(['tr']));
  ok('only the played competition is offered', bcb.played.map(c => c.id).join() === 'tr');
  ok('no conferences, no conference buttons', X.groups(bcb, ['lg', 'tr', 'dup']).list.length === 0);
  ok('one group is not a choice either',
     X.groups(X.model(BCB, entriesFor('tr', { West: 12 }), new Set(['tr'])), ['tr']).list.length === 0);
}

console.log('\na club in two competitions');
{
  const CS = [{ id: 'cup', name: 'Cup', kind: 'cup', format: 'groups' },
              { id: 'lg', name: 'League', kind: 'league', format: 'conferences' }];
  const E = [{ competition_id: 'cup', team_id: 'x', group_name: 'Cup Group A' },
             { competition_id: 'lg', team_id: 'x', group_name: 'East' },
             { competition_id: 'lg', team_id: 'y', group_name: 'West' },
             { competition_id: 'cup', team_id: 'y', group_name: 'Cup Group B' }];
  const G = X.groups(X.model(CS, E, new Set(['cup', 'lg'])), ['cup', 'lg']);
  ok('takes its conference, whichever competition is listed first', G.list.map(g => g.name).join('|') === 'East|West',
     G.list.map(g => g.name).join('|'));
}

/* ---- the read ------------------------------------------------------------------ */
console.log('\nthe read, once per season');
{
  const calls = [];
  const D = {
    all: async p => { calls.push(p); return usEntries; },
    get: async p => {
      calls.push(p);
      if (/competition_id=eq\.us&/.test(p)) return [{ id: 'g1' }];
      if (/competition_id=eq\.usp&/.test(p)) return [];
      throw new Error('503');
    }
  };
  const M = await X.load(D, USPORTS.concat([{ id: 'odd', name: 'Odd', kind: 'league', format: 'table' }]));
  ok('entries with their groups, in one read', calls.filter(c => /^competition_teams\?competition_id=in\.\(us,usp,odd\)&select=competition_id,team_id,group_name$/.test(c)).length === 1,
     calls.join('\n          '));
  ok('a competition with no finalised game is not offered', !M.played.some(c => c.id === 'usp'));
  ok('...one whose check failed is offered, as it always was', M.played.some(c => c.id === 'odd'));
  ok('each check asks for one finalised game and no more',
     calls.filter(c => /^games\?competition_id=eq\.[a-z]+&status=in\.\(final,finalising\)&select=id&limit=1$/.test(c)).length === 3);
  const broken = await X.load({ all: async () => { throw new Error('500'); }, get: async () => [{ id: 1 }] }, USPORTS);
  ok('a refused entries read leaves no conference buttons and every competition',
     broken.entries.length === 0 && broken.played.length === 2);
  ok('no competitions, no reads', (await X.load({ all: () => { throw new Error('asked'); } }, [])).comps.length === 0);
}

/* ---- the buttons ---------------------------------------------------------------- */
console.log('\nthe buttons');
function node(tag) {
  const n = { tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', type: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(k, f) { this.listeners[k] = f; } };
  let text = '';
  Object.defineProperty(n, 'textContent', {
    get() { return text + n.children.map(c => c.textContent).join(''); },
    set(v) { text = String(v); n.children = []; }
  });
  return n;
}
globalThis.document = { createElement: node };
{
  const host = node('div');
  const got = { scope: [], conf: [] };
  X.mount({ host, model: us, scope: 'all', conf: 'OUA',
            scopeIds: s => (s === 'all' ? ['us', 'usp'] : [s]),
            onScope: s => got.scope.push(s), onConf: g => got.conf.push(g) });
  const [covering, conference] = host.children;
  const chips = r => r.children.filter(c => c.tagName === 'BUTTON');
  ok('two rows: the competitions, then the conferences', host.children.length === 2 &&
     covering.children[0].textContent === 'covering' && conference.children[0].textContent === 'conference');
  ok('the whole season and each played competition, a playoff tagged as one',
     chips(covering).map(b => b.textContent).join('|') === 'whole season|U SPORTS 2026-27|U SPORTS Final 8playoff',
     chips(covering).map(b => b.textContent).join('|'));
  ok('"all" and the four conferences', chips(conference).map(b => b.textContent).join('|') === 'all|AUS|Canada West|OUA|RSEQ');
  const on = chips(conference).filter(b => /\bon\b/.test(b.className));
  ok('the conference being shown is lit, and says so', on.length === 1 && on[0].textContent === 'OUA' && on[0].attrs['aria-pressed'] === 'true');
  ok('every one is a real button', chips(conference).concat(chips(covering)).every(b => b.type === 'button'));
  chips(conference)[1].listeners.click();
  chips(conference)[3].listeners.click();
  chips(covering)[1].listeners.click();
  ok('a tap on another conference asks for it; a tap on the lit one asks for nothing',
     got.conf.join() === 'AUS' && got.scope.join() === 'us', JSON.stringify(got));
}
{
  const host = node('div');
  X.mount({ host, model: X.model([{ id: 'a', name: 'A', format: 'table' }], [], new Set(['a'])), scope: 'all', conf: 'all',
            scopeIds: () => ['a'], onScope() {}, onConf() {} });
  ok('nothing to choose draws nothing at all', host.children.length === 0);
}

/* ---- the wiring --------------------------------------------------------------- */
console.log('\nthe pages');
const league = rd('epinoia', 'l', 'league.js');
const stats = rd('epinoia', 'stats', 'stats.js');
const lhtml = rd('epinoia', 'l', 'index.html');
const shtml = rd('epinoia', 'stats', 'index.html');
const kit = rd('epinoia', 'kit', 'epinoia-kit.css');
ok('the league page’s three stats tabs draw the buttons',
   ['renderLeaders', 'renderTeamStats', 'renderSOS'].every(f => league.includes('scopePicker(bar, ' + f + ')')));
ok('...Leaders shows the conference’s players', /S\.players\.filter\(p => keep\(clubOf\(S, p\)\)\)/.test(league));
ok('...Team Stats its clubs', /S\.teams\.filter\(t => keep\(t\.id\)\)/.test(league));
ok('...and Strength of Schedule its clubs, over every game in scope', /only: keep,/.test(league));
ok('...the choice of conference outlives a change of competition, not a change of season',
   /onScope: s => \{\s*statScope = s;\s*SEASON = null;/.test(league) && /statScope = 'all'; statConf = null;/.test(league));
ok('...and no covering select is left', !/scopesel/.test(league));
ok('the Statistics page draws the same buttons', /X\.settle\(M, scopeIds\(\), conf\)/.test(stats) &&
   /X\.mount\(\{ host: bar, model: M, scope, conf, scopeIds,/.test(stats) && !/scopesel/.test(stats));
ok('...and shows the conference’s players', /const rows = S\.players\.filter\(p => keep\(/.test(stats) && /\n\s+rows,\s*\n/.test(stats));
ok('both pages load scopebar.js before their own script',
   lhtml.indexOf('../scopebar.js?v=') > 0 && lhtml.indexOf('../scopebar.js?v=') < lhtml.indexOf('league.js?v=') &&
   shtml.indexOf('../scopebar.js?v=') > 0 && shtml.indexOf('../scopebar.js?v=') < shtml.indexOf('stats.js?v='));
ok('a cup’s kind rides on its button', /\.scopebar \.ep-chip \.kindtag\{/.test(kit));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
