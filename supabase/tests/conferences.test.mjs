// conferences.js: the college systems (U SPORTS, NCAA D2), their conferences, logos and regions, and the one rule every
// page uses for which clubs it shows (Louie, 2026-10-16). No database: the module's pure parts under node.
//
//   node supabase/tests/conferences.test.mjs
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const EP = path.join(here, '..', '..', 'epinoia');
const require = createRequire(import.meta.url);
const CF = require(path.join(EP, 'conferences.js'));

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

console.log('-- the systems');
const US = CF.system('u-sports'), D2 = CF.system('ncaa-d2');
ok('two systems: U SPORTS and NCAA D2', !!US && !!D2 && CF.SYSTEMS.length === 2);
ok('a league finds its system by slug', CF.systemOf('u-sports') === US && CF.systemOf('ncaa-d2-men') === D2
   && CF.systemOf({ slug: 'ncaa-d2-women' }) === D2 && CF.systemOf('slb-men') === null);
const cfg = readFileSync(path.join(EP, 'config.js'), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(cfg.match(/window\.EPINOIA_COLLEGE = [^;]+;/)[0], ctx);
const fromCfg = ctx.window.EPINOIA_COLLEGE;
const fromMod = Object.fromEntries(CF.SYSTEMS.flatMap(s => s.leagues.map(l => [l.slug, s.key])));
ok('config.js EPINOIA_COLLEGE (what the rail knows) is exactly the module\'s leagues',
   JSON.stringify(Object.entries(fromCfg).sort()) === JSON.stringify(Object.entries(fromMod).sort()), fromCfg);
ok('...and every one of them is a university league in the tiers', ['u-sports', 'ncaa-d2-men', 'ncaa-d2-women']
   .every(s => new RegExp("'" + s + "': \\['uni'").test(cfg)));
/* mode.js decides the page before the first paint, so it carries its own copy of the list */
const modeSrc = readFileSync(path.join(EP, 'mode.js'), 'utf8');
const mctx = {};
vm.runInNewContext(modeSrc.match(/var COLLEGE = [^;]+;/)[0].replace('var COLLEGE', 'this.COLLEGE'), mctx);
ok('...and so is mode.js\'s copy (the hub a system league\'s front page goes to)',
   JSON.stringify(Object.entries(mctx.COLLEGE).sort()) === JSON.stringify(Object.entries(fromMod).sort()), mctx.COLLEGE);

console.log('\n-- the hub\'s map (maps.js)');
const mapsCtx = { window: {} };
vm.runInNewContext(readFileSync(path.join(EP, 'maps.js'), 'utf8'), mapsCtx);
const MAPS = mapsCtx.window.EpinoiaMaps;
ok('a US map (Alaska and Hawaii inset) and a Canada map, a path a state or province', !!MAPS && Object.keys(MAPS.us.paths).length === 51
   && Object.keys(MAPS.ca.paths).length === 13 && /^M/.test(MAPS.us.paths.AK) && /^M/.test(MAPS.us.paths.HI) && /^M/.test(MAPS.ca.paths.NU),
   MAPS && [Object.keys(MAPS.us.paths).length, Object.keys(MAPS.ca.paths).length]);
ok('every region\'s places are on its map, each in one region only, each region a colour of its own',
   CF.SYSTEMS.every(s => {
     const seen = new Set();
     return s.regions.every(r => /^#[0-9a-f]{6}$/i.test(r.colour) && r.where.every(w => {
       const fresh = !seen.has(w); seen.add(w); return fresh && !!MAPS[s.map].paths[w];
     })) && new Set(s.regions.map(r => r.colour)).size === s.regions.length;
   }));
ok('the maps name no source site and carry nothing but paths', !/https?:|<script/i.test(readFileSync(path.join(EP, 'maps.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '')));

console.log('\n-- the conferences, as the feeds name them');
const usNames = Object.keys(JSON.parse(readFileSync(path.join(here, '..', '..', 'config', 'groups', 'usports.json'), 'utf8')).default);
ok('every U SPORTS conference of the groups file is one of the system\'s, none made up',
   usNames.length === 4 && usNames.every(n => { const c = CF.conference(US, n); return c && !c.made; }), usNames);
/* the NCAA ingest's own names (adapters/ncaa.py conference_name over its D2 list) */
const d2Names = ['CACC', 'CCAA', 'CIAA', 'Conference Carolinas', 'Independent', 'Division II Independents', 'ECC', 'G MAC',
  'GAC', 'GLIAC', 'GLVC', 'Great Northwest', 'Gulf South', 'IND', 'Lone Star', 'MEC', 'MID America Intercollegiate', 'NE10',
  'NSIC', 'Pacwest', 'Peach Belt', 'PSAC', 'RMAC', 'SAC', 'SIAC', 'Sunshine State'];
const missed = d2Names.filter(n => { const c = CF.conference(D2, n); return !c || c.made; });
ok('every NCAA D2 conference name the ingest writes is one of the system\'s (the three spellings of independents too)',
   !missed.length, missed);
ok('...23 conferences and the independents', D2.conferences.length === 24 && D2.conferences.filter(c => c.key !== 'independent').length === 23);
ok('a conference the system does not know yet is still shown, with a made-up entry', (() => {
  const c = CF.conference(D2, 'Brand New Athletic Conference');
  return c && c.made && c.key === 'brand-new-athletic-conference' && c.short === 'Brand New Athletic Conference';
})());
ok('keys are unique and URL-safe', CF.SYSTEMS.every(s => new Set(s.conferences.map(c => c.key)).size === s.conferences.length
   && s.conferences.every(c => /^[a-z0-9-]+$/.test(c.key))));

console.log('\n-- logos and regions');
const logos = CF.SYSTEMS.flatMap(s => s.conferences.filter(c => c.logo).map(c => [s, c]));
ok('27 logos, every one a file in epinoia/img/conferences', logos.length === 27 &&
   logos.every(([s, c]) => existsSync(path.join(EP, 'img', 'conferences', s.logoDir, c.logo))),
   logos.filter(([s, c]) => !existsSync(path.join(EP, 'img', 'conferences', s.logoDir, c.logo))).map(([, c]) => c.key));
const svgs = logos.filter(([, c]) => c.logo.endsWith('.svg')).map(([s, c]) => readFileSync(path.join(EP, 'img', 'conferences', s.logoDir, c.logo), 'utf8'));
ok('no SVG logo carries a script, a handler or a link out (cleaned before it was kept)',
   svgs.every(t => !/<script|javascript:|\son\w+\s*=|href="https?:/i.test(t)));
ok('...and every SVG has a viewBox (four did not, as served)', svgs.every(t => /viewBox=/.test(t)));
ok('no logo names the site it came from', svgs.every(t => !/sidearm|cloudfront/i.test(t)));
ok('every conference but the independents has a region of its system',
   CF.SYSTEMS.every(s => s.conferences.every(c => c.key === 'independent' || s.regions.some(r => r.key === c.region))));
ok('NCAA D2: the NCAA\'s own eight regions, three conferences in each but South Central (the Lone Star and the RMAC)',
   D2.regions.length === 8 && D2.regions.every(r => D2.conferences.filter(c => c.region === r.key).length === (r.key === 'south-central' ? 2 : 3)),
   D2.regions.map(r => r.key + ':' + D2.conferences.filter(c => c.region === r.key).length));
ok('U SPORTS: four regions of Canada, a conference each', US.regions.length === 4
   && US.regions.every(r => US.conferences.filter(c => c.region === r.key).length === 1));
const grouped = CF.byRegion(D2, D2.conferences);
ok('byRegion: the regions in order, the independents last on their own',
   grouped.length === 9 && grouped[0].region.key === 'east' && grouped[8].region === null
   && grouped[8].conferences[0].key === 'independent');
ok('every place a conference names is on its map', CF.SYSTEMS.every(s => s.conferences.every(c =>
   c.where.every(w => CF.TILES[s.map].at[w])) && s.regions.every(r => r.where.every(w => CF.TILES[s.map].at[w]))));
const svg = CF.mapSvg('ca', ['ON'], { title: 'Ontario' });
ok('a map lights its places and names itself', (svg.match(/cfm-on/g) || []).length === 1 && /aria-label="Ontario"/.test(svg)
   && (svg.match(/<rect/g) || []).length === Object.keys(CF.TILES.ca.at).length);

console.log('\n-- the scope: which clubs a page shows');
const rows = [
  { team_id: 'a', group_name: 'OUA' }, { team_id: 'b', group_name: 'OUA' }, { team_id: 'c', group_name: 'AUS' },
  { team_id: 'x', group_name: null }, { team_id: 'y', group_name: '  ' }
];
const all = CF.scopeFrom('u-sports', rows, null);
ok('a college league: every club with a conference, no club without one (Baylor, UC Irvine...)',
   all.keep('a') && all.keep('c') && !all.keep('x') && !all.keep('y') && !all.keep('nobody'));
ok('...its conferences in the system\'s order (Canada West, OUA, RSEQ, AUS: west to east)',
   all.conferences.map(c => c.key).join(',') === 'oua,aus');
const oua = CF.scopeFrom('u-sports', rows, 'oua');
ok('?conf=oua: that conference\'s clubs alone', oua.conference && oua.conference.key === 'oua'
   && oua.keep('a') && oua.keep('b') && !oua.keep('c') && !oua.keep('x'));
ok('a club\'s conference, for a chip or a row', all.conferenceOf('c').key === 'aus' && all.conferenceOf('x') === null);
ok('the clubs kept, for a query: the conference\'s (either side of a game)', JSON.stringify(oua.ids.sort()) === '["a","b"]'
   && JSON.stringify(all.ids.sort()) === '["a","b","c"]', [oua.ids, all.ids]);
ok('nothing assigned yet (a season before its groups): every club, not none', CF.scopeFrom('u-sports', [], null).keep('anyone'));
ok('every other league: every club, no system', (() => {
  const s = CF.scopeFrom('slb-men', rows, 'oua');
  return s.system === null && s.keep('x') && s.keep('whoever');
})());

if (fail) { console.log(`\n${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\nconferences: ${pass} passed - two systems, their conferences, logos, regions and the clubs a page shows`);
