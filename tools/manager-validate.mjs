/* ============================================================================
   MANAGER: DOES THE SIMULATION LOOK LIKE THE REAL THING? The marks the GO promo shows (epinoia/manager/validation.json).

     node tools/manager-validate.mjs                    the default leagues (complete seasons), written to the file
     node tools/manager-validate.mjs --reps 8 --dry     more games a pairing, printed only

   For each league: its season file (the public CDN copy the site reads, signed out), every real club built from its own
   players the way the Manager builds them (core/cards.js cards, engine.js autoRotation at each man's minutes a game), and
   every club played against every other, home and away, `reps` times. Two ways:
     * WITH IDENTITY - each club also carries the gap between its own four factors and its players' build (what the
       Manager's real clubs play with);
     * FROM THE PLAYERS ALONE - nothing of the club but its men (what the reader's own club is).
   The marks: the correlation of each club's simulated margin with its real point difference a game, the points a game
   simulated against real, the home win share simulated against real, the three-point rate. Nothing here writes to the
   database; the file is committed with the code.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.EpinoiaWinStats = require(path.join(ROOT, 'epinoia', 'winstats.js'));
const Sim = require(path.join(ROOT, 'epinoia', 'winsim.js'));
const C = require(path.join(ROOT, 'epinoia', 'manager', 'core', 'cards.js'));
const E = require(path.join(ROOT, 'epinoia', 'manager', 'core', 'engine.js'));
E.use(Sim);

const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
const URL_ = (process.env.SUPABASE_URL || 'https://hhvofgqqadtyvcjudhjx.supabase.co').replace(/\/$/, '');
const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const REPS = +(opt('reps') || 6), DRY = argv.includes('--dry');
/* complete seasons with a hundred games or more (slug@season): the ones a correlation means something on */
const LEAGUES = (opt('leagues') || 'orlen-basket-liga@2025-26,primera-feb@2025-26,nbl-d1@2025-26,cebl@2026').split(',');

const get = async u => { for (let t = 0; t < 4; t++) { try { const r = await fetch(u, { headers: { apikey: PUBLISHABLE } }); if (r.ok) return r.json(); } catch (_) { /* again */ } await new Promise(res => setTimeout(res, 500 * (t + 1))); } return null; };
function unpack(p) { if (!p) return []; if (Array.isArray(p)) return p; const k = p.k || [], x = p.x || {}; return (p.v || []).map((vals, i) => { const r = {}, skip = x[i] ? new Set(x[i]) : null; for (let j = 0; j < k.length; j++) if (!skip || !skip.has(j)) r[k[j]] = vals[j]; return r; }); }
const corr = (xs, ys) => { const m = a => a.reduce((s, v) => s + v, 0) / a.length, mx = m(xs), my = m(ys); let c = 0, vx = 0, vy = 0; xs.forEach((x, i) => { c += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; }); return c / Math.sqrt(vx * vy); };

const index = await get(`${URL_}/rest/v1/snapshots?select=key,competition_id,data&key=like.season:*&limit=2000`) || [];
const units = index.filter(r => r.competition_id && !String(r.key).includes(',') && r.data && r.data.file);
const comps = new Map();
for (let i = 0; i < units.length; i += 40) (await get(`${URL_}/rest/v1/competitions?id=in.(${units.slice(i, i + 40).map(u => u.competition_id).join(',')})&select=id,name,kind,seasons(name,leagues(name,slug))`) || []).forEach(c => comps.set(c.id, c));

const out = [];
for (const want of LEAGUES) {
  const [slug, season] = want.split('@');
  const u = units.find(x => { const c = comps.get(x.competition_id) || {}, s = c.seasons || {}; return c.kind === 'league' && s.name === season && s.leagues && s.leagues.slug === slug; });
  if (!u) { console.log('no season file for', want); continue; }
  const c = comps.get(u.competition_id), j = await get(`${URL_}/storage/v1/object/public/snapshots/${String(u.data.file).split('/').map(encodeURIComponent).join('/')}`);
  if (!j || !j.data) { console.log('could not read', want); continue; }
  const d = j.data, P = unpack(d.players), T = unpack(d.teams), teamOf = new Map(d.teamOfPlayer || []), games = d.games || [];
  const ref = C.refOf(P), L = E.leagueOf(ref, null, 40, { teams: T, games }), X = { L, ref, G: 40 };
  const cards = new Map(P.map(r => [String(r.id), C.cardOf(r, ref, {})]).filter(([, x]) => x));
  const clubs = T.filter(t => t.gp >= 5).map(t => {
    const men = P.filter(r => teamOf.get(r.id) === t.id && r.min > 0).map(r => ({ id: String(r.id), mpg: r.min / t.gp, share: C.shareOf(r) }));
    const segs = E.autoRotation(men, 40);
    return segs.length ? { id: t.id, segs, cards, row: t } : null;
  }).filter(Boolean);
  clubs.forEach(t => { t.identity = E.identityOf(t, t.row, X); });
  const run = withId => {
    const sum = new Map(clubs.map(t => [t.id, { m: 0, n: 0 }]));
    let g = 0, pts = 0, homeW = 0, fga = 0, fg3a = 0;
    for (const H of clubs) for (const A of clubs) {
      if (H === A) continue;
      for (let r = 0; r < REPS; r++) {
        const h = withId ? H : Object.assign({}, H, { identity: null }), a = withId ? A : Object.assign({}, A, { identity: null });
        const res = E.play(h, a, Object.assign({}, X, { seed: E.hashOf(H.id + A.id + r), home: 1 }));
        const dm = res.pts[0] - res.pts[1];
        sum.get(H.id).m += dm; sum.get(H.id).n++; sum.get(A.id).m -= dm; sum.get(A.id).n++;
        g++; pts += res.pts[0] + res.pts[1]; if (dm > 0) homeW++;
        fga += res.tally[0].fga + res.tally[1].fga; fg3a += res.tally[0].fg3a + res.tally[1].fg3a;
      }
    }
    return { r: corr(clubs.map(t => t.row.diffpg), clubs.map(t => sum.get(t.id).m / sum.get(t.id).n)), ppg: pts / g / 2, home: homeW / g, p3r: fg3a / fga, games: g };
  };
  const a = run(true), b = run(false);
  const s = k => T.reduce((x, t) => x + (+t[k] || 0), 0), decided = games.filter(x => x.home_score !== x.away_score);
  const row = { league: c.seasons.leagues.name, season, clubs: clubs.length, realGames: games.length, simGames: a.games,
    r: +a.r.toFixed(3), rPlayers: +b.r.toFixed(3), ppgSim: +a.ppg.toFixed(1), ppgReal: +(s('pts') / s('gp')).toFixed(1),
    homeSim: +a.home.toFixed(3), homeReal: +(decided.filter(x => x.home_score > x.away_score).length / Math.max(1, decided.length)).toFixed(3),
    p3rSim: +(100 * a.p3r).toFixed(1), p3rReal: +(100 * s('p3a') / s('fga')).toFixed(1) };
  out.push(row);
  console.log(JSON.stringify(row));
}
if (!out.length) { console.error('nothing validated'); process.exit(1); }
const file = path.join(ROOT, 'epinoia', 'manager', 'validation.json');
const doc = { built: new Date().toISOString().slice(0, 10), reps: REPS, leagues: out,
  summary: { leagues: out.length, games: out.reduce((a, x) => a + x.simGames, 0), r: +(out.reduce((a, x) => a + x.r, 0) / out.length).toFixed(3),
    rPlayers: +(out.reduce((a, x) => a + x.rPlayers, 0) / out.length).toFixed(3),
    ppgGap: +(out.reduce((a, x) => a + Math.abs(x.ppgSim - x.ppgReal), 0) / out.length).toFixed(1) } };
if (DRY) console.log(JSON.stringify(doc, null, 1));
else { fs.writeFileSync(file, JSON.stringify(doc, null, 1) + '\n'); console.log('written', path.relative(ROOT, file)); }
