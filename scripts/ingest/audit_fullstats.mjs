/* audit_fullstats.mjs — does the FULL STATS tab agree with the feed that fed it?

   Everything on that tab is derived by replaying the event log (epinoia/engine.js). The log is
   translated from each league's own feed by scripts/ingest/translate/fiba_events.py, and a
   translation can silently drop a kind of action -- which shows up not as an error but as a
   number that is quietly too low. The feed also hands over its OWN team totals, which the
   pipeline stores untouched in team_game_stats. Those two should agree.

   So: for a finished game in each competition, replay the stored log through the real engine and
   put the two side by side. A row that differs is either a translation dropping something or the
   feed's own totals disagreeing with its own log, and both are worth knowing about.

   It also reports the inputs the tab needs that only a QUALIFIER can supply, because a feed that
   sends none leaves those metrics reading zero however good the rest of it is.

       node scripts/ingest/audit_fullstats.mjs                 # one game per competition
       node scripts/ingest/audit_fullstats.mjs --code LNBE2 --games 3

   Reads only. Config from %APPDATA%\\epinoia\\worker.json, or SUPABASE_URL / SUPABASE_SERVICE_KEY.
*/
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const E = require(path.resolve(process.cwd(), 'epinoia/engine.js'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CODE = opt('--code', null);
const GAMES = Number(opt('--games', 1));

let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  const cfg = JSON.parse(readFileSync(path.join(process.env.APPDATA, 'epinoia', 'worker.json'), 'utf8'));
  url = cfg.supabase_url; key = cfg.service_key;
}
const base = url.replace(/\/$/, '') + '/rest/v1/';
const get = async q => {
  const r = await fetch(base + q, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error(q + ' -> ' + r.status);
  return r.json();
};

/* the log as the page holds it: game.js's rowToEvent, the satellites flattened onto the event */
const rowToEvent = r => Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock },
  r.payload || {}, r.team != null ? { team: r.team } : {}, r.pid != null ? { pid: r.pid } : {});

/* what the feed's own totals call each thing, against what the replay calls it */
const PAIRS = [
  ['pts', 'pts'], ['fga', 'fga'], ['fgm', 'fgm'], ['p3a', 'p3a'], ['p3m', 'p3m'],
  ['fta', 'fta'], ['ftm', 'ftm'], ['or', 'or'], ['dr', 'dr'], ['ast', 'ast'],
  ['to', 'toTot'], ['stl', 'stl'], ['blk', 'blk']
];

const comps = await get('external_games?select=adapter,competition_code,game_id,tipoff_at'
  + '&game_id=not.is.null&external_status=eq.final&order=tipoff_at.desc&limit=3000'
  + (CODE ? `&competition_code=eq.${CODE}` : ''));
const byComp = new Map();
for (const r of comps) {
  const k = r.adapter + '|' + r.competition_code;
  if (!byComp.has(k)) byComp.set(k, []);
  byComp.get(k).push(r.game_id);
}

let anyDiff = false;
for (const [k, gids] of [...byComp.entries()].sort()) {
  const [adapter, code] = k.split('|');
  for (const gid of gids.slice(0, GAMES)) {
    const [rows, teams, official] = await Promise.all([
      get(`game_events?select=t,seq,period,clock,team,pid,payload&game_id=eq.${gid}&order=seq&limit=4000`),
      get(`games?select=home_team_id,away_team_id,starters,period,status&id=eq.${gid}`),
      get(`team_game_stats?select=team_idx,stats&game_id=eq.${gid}`)
    ]);
    if (!rows.length) continue;
    const g = teams[0] || {};
    const pids = [...new Set(rows.map(r => r.pid).filter(Boolean))];
    const S = {
      teams: [0, 1].map(t => ({ name: 'T' + t, players: pids.map(id => ({ id, name: id, num: '' })) })),
      starters: (g.starters && g.starters.length === 2) ? g.starters : [[], []],
      events: rows.map(rowToEvent), period: g.period || 4, clockMs: 0,
      status: g.status || 'final', phase: 'final'
    };
    const d = E.deriveGame(S);
    const T = [0, 1].map(t => E.teamTotals(S, d, t));

    console.log(`\n${adapter} · ${code} · ${gid.slice(0, 8)}`);
    if (!official.length) {
      console.log('  (the feed stored no team totals for this game — nothing to check the replay against)');
    } else {
      const off = {}; official.forEach(o => { off[o.team_idx] = o.stats || {}; });
      const bad = [];
      for (const [fk, rk] of PAIRS) {
        for (const t of [0, 1]) {
          const a = Number((off[t] || {})[fk]), b = Number(T[t][rk]);
          if (!Number.isFinite(a)) continue;
          if (a !== b) bad.push(`${fk} t${t}: feed ${a} vs replay ${b}`);
        }
      }
      if (bad.length) { anyDiff = true; console.log('  DIFFERS  ' + bad.join(' · ')); }
      else console.log('  the replay matches the feed\'s own totals on every counted stat');
    }
    /* the inputs only a qualifier can supply */
    const sit = ['paint', 'fast', 'sc', 'pot'].map(x => `${x} ${d.team[0][x]}-${d.team[1][x]}`).join(' · ');
    const locs = rows.filter(r => r.t === 'loc').length;
    const shots = rows.filter(r => /^p[23]_/.test(r.t)).length;
    console.log(`  situational: ${sit}`);
    console.log(`  markers: ${locs} on ${shots} shots`);
  }
}
console.log(anyDiff ? '\nsome totals differ — see above' : '\nevery replay checked matches its feed');
