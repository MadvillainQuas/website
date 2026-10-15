/* A SMALL, MADE-UP SAMPLE of the scraped player-stats files, for supabase/tests/transfer-matrix.test.mjs.

   Deterministic (a seeded generator): eight leagues of known strength over six seasons, about 320 players who move
   between them, and the awkward cases the real files have: a player split between two clubs in one league-season, the same
   row scraped twice into both files (the one with more minutes must win), a club name with a comma (a quoted field), a
   row with no minutes, missing stats, a league nobody moves to or from, and the older archive's MSL- identities, one
   matching a main-file player by a short form of his name and one that must not (he played elsewhere that season).

   orig.json beside this file holds the numbers the ORIGINAL standalone app (transfermatrix/index.html v3) gave on this
   sample, read in a headless browser; the test holds the engine to them.

     node supabase/tests/fixtures/transfer/sample.mjs <dir>     writes player_stats.csv and player_stats2.csv there */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS = ['BPM', 'TS_pct', 'USG_pct', 'ORB_pct', 'DRB_pct', 'AST_pct', 'TOV_pct', 'STL_pct', 'BLK_pct'];
const HEAD = ['league', 'season', 'team', 'team_abbrev', 'player_name', 'GP', 'MIN'].concat(STATS, ['player_url']);
/* league -> [BPM offset (how much harder than an average league), feeder neighbours] */
export const LEAGUES = {
  'Euroleague': [2.0, ['Spanish ACB', 'German BBL']],
  'Spanish ACB': [0.0, ['Euroleague', 'Spanish Primera FEB', 'German BBL']],
  'German BBL': [-1.5, ['Spanish ACB', 'Euroleague', 'NCAA Big Ten Conference', 'Irish Super League']],
  'Spanish Primera FEB': [-5.0, ['Spanish ACB', 'NCAA Big East Conference']],
  'NCAA Big Ten Conference': [-6.0, ['German BBL', 'Spanish Primera FEB']],
  'NCAA Big East Conference': [-6.5, ['Spanish Primera FEB', 'German BBL']],
  'Irish Super League': [-9.0, ['German BBL']],
  'Island League': [-3.0, []]
};
const SEASONS = ['2019-2020', '2020-2021', '2021-2022', '2022-2023', '2023-2024', '2024-2025'];
const FIRST = ['James', 'Marco', 'Luka', 'Pau', 'Dario', 'Kevin', 'Mike', 'Nikola', 'Sergio', 'Tomas', 'Jonas', 'Andre', 'Felix', 'Ivan', 'Omar', 'Paul'];
const LAST = ['Smith', 'Garcia', 'Novak', 'Rossi', 'Muller', 'Petrov', 'Jones', 'Lopez', 'Kovac', 'Weber', 'Silva', 'Brown', 'Nielsen', 'Moreau', 'Horvat', 'Byrne'];

function rng(seed) {                            // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r1 = v => (Math.round(v * 10) / 10).toFixed(1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* {files: [text, text]} */
export function sampleCSVs() {
  const R = rng(20261015);
  const norm = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = a => a[Math.floor(R() * a.length)];
  const names = Object.keys(LEAGUES);
  const rows = [];
  const club = (lg, k) => lg.split(' ').map(w => w[0]).join('') + ' Club ' + (1 + (k % 6));
  const statsFor = (t, lg, role) => {
    const off = LEAGUES[lg][0];
    return [
      t - off + norm() * 1.6,
      clamp(55 + 0.6 * t - 0.5 * off + norm() * 3, 30, 75),
      clamp(19 + role * 4 + 0.4 * t + norm() * 2.5, 8, 38),
      clamp(5 + (1 - role) * 4 + norm() * 1.5, 0.5, 16),
      clamp(14 + (1 - role) * 6 + norm() * 2, 4, 30),
      clamp(12 + role * 10 - 0.2 * off + norm() * 3, 2, 45),
      clamp(14 - 0.3 * t + 0.3 * off + norm() * 2.5, 4, 30),
      clamp(1.7 + 0.08 * t + norm() * 0.4, 0.3, 4.5),
      clamp(1.5 + (1 - role) * 2.5 + norm() * 0.6, 0, 9)
    ];
  };
  for (let p = 0; p < 320; p++) {
    const id = 1000 + p * 7;
    const name = pick(FIRST) + ' ' + pick(LAST) + (p % 23 === 0 ? ' Jr.' : '');
    const t = norm() * 2.8, role = R();
    let lg = names[p % 7];                       // the Island League is filled below, on its own
    let s0 = Math.floor(R() * 4);
    const len = 2 + Math.floor(R() * 4);
    for (let s = s0; s < Math.min(SEASONS.length, s0 + len); s++) {
      const mins = Math.round(40 + R() * 1400) + (R() < 0.5 ? 0.5 : 0);
      const gp = Math.max(1, Math.round(mins / (12 + R() * 20)));
      const team = club(lg, p + s);
      const vals = statsFor(t, lg, role).map(r1);
      if (R() < 0.04) vals[8] = '';                // a missing stat
      if (R() < 0.02) vals[7] = '';
      rows.push([lg, SEASONS[s], team, 'X', name, gp, mins.toFixed(1)].concat(vals, ['/player/' + name.replace(/\W+/g, '-') + '/Summary/' + id]));
      if (R() < 0.06) {                            // the same league-season at a second club
        const m2 = Math.round(60 + R() * 500);
        rows.push([lg, SEASONS[s], club(lg, p + s + 3), 'Y', name, Math.max(1, Math.round(m2 / 20)), m2.toFixed(1)].concat(statsFor(t, lg, role).map(r1), ['/player/' + name.replace(/\W+/g, '-') + '/Summary/' + id]));
      }
      /* a move the next season, to a neighbour (most stay) */
      const nb = LEAGUES[lg][1];
      if (nb.length && R() < 0.38) lg = pick(nb);
    }
  }
  /* the Island League: its own players, never moving */
  for (let p = 0; p < 14; p++) {
    const id = 9000 + p, name = pick(FIRST) + ' Islander' + p;
    for (const s of [2, 3]) rows.push(['Island League', SEASONS[s], 'IL Club ' + (p % 3), 'I', name, 20, (300 + p * 10).toFixed(1)].concat(statsFor(norm() * 2, 'Island League', R()).map(r1), ['/player/x/Summary/' + id]));
  }
  /* a club name with a comma, quoted */
  rows.push(['German BBL', SEASONS[4], '"Baskets, The"', 'BT', 'Felix Comma', 30, '880.0'].concat(statsFor(1, 'German BBL', 0.5).map(r1), ['/player/Felix-Comma/Summary/7777']));
  rows.push(['Spanish ACB', SEASONS[5], 'SA Club 2', 'S', 'Felix Comma', 28, '700.0'].concat(statsFor(1, 'Spanish ACB', 0.5).map(r1), ['/player/Felix-Comma/Summary/7777']));
  /* no minutes: skipped */
  rows.push(['Spanish ACB', SEASONS[5], 'SA Club 3', 'S', 'Zero Minutes', 1, '0'].concat(STATS.map(() => '0.0'), ['/player/Zero/Summary/7778']));
  /* the archive: MSL- 'Paddy Byrne' is main-file 'Patrick Byrne' (BBL 2019-2020, Irish 2021-2022 under the archive id);
     MSL- 'Omar Zeller' must NOT match main-file 'Omar Zeller', who played 25 games in the BBL that very season */
  rows.push(['German BBL', SEASONS[0], 'GB Club 1', 'G', 'Patrick Byrne', 28, '900.0'].concat(statsFor(2, 'German BBL', 0.4).map(r1), ['/player/Patrick-Byrne/Summary/8001']));
  rows.push(['German BBL', SEASONS[1], 'GB Club 1', 'G', 'Patrick Byrne', 26, '810.0'].concat(statsFor(2, 'German BBL', 0.4).map(r1), ['/player/Patrick-Byrne/Summary/8001']));
  rows.push(['Irish Super League', SEASONS[2], 'ISL Club 1', 'I', 'Paddy Byrne', 18, '620.0'].concat(statsFor(2, 'Irish Super League', 0.4).map(r1), ['MSL-501']));
  rows.push(['German BBL', SEASONS[3], 'GB Club 2', 'G', 'Omar Zeller', 25, '700.0'].concat(statsFor(0, 'German BBL', 0.6).map(r1), ['/player/Omar-Zeller/Summary/8002']));
  rows.push(['Irish Super League', SEASONS[3], 'ISL Club 2', 'I', 'Omar Zeller', 16, '500.0'].concat(statsFor(0, 'Irish Super League', 0.6).map(r1), ['MSL-502']));
  /* two files, as the real set is split; a slice of rows scraped into both, the second copy with more minutes */
  const line = r => r.join(',');
  const a = [], b = [];
  rows.forEach((r, i) => { (i % 3 === 2 ? b : a).push(r); });
  const dup = a.filter((r, i) => i % 41 === 5).map(r => { const c = r.slice(); c[6] = (parseFloat(c[6]) + 37).toFixed(1); return c; });
  const dupLess = a.filter((r, i) => i % 53 === 9).map(r => { const c = r.slice(); c[6] = Math.max(1, parseFloat(c[6]) - 30).toFixed(1); c[7] = '9.9'; return c; });
  b.push(...dup, ...dupLess);
  return { files: [[HEAD.join(',')].concat(a.map(line)).join('\n') + '\n', [HEAD.join(',')].concat(b.map(line)).join('\r\n') + '\r\n'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node sample.mjs <dir>'); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  const { files } = sampleCSVs();
  fs.writeFileSync(path.join(dir, 'player_stats.csv'), files[0]);
  fs.writeFileSync(path.join(dir, 'player_stats2.csv'), files[1]);
  console.log('wrote', files.map(f => f.split(/\r?\n/).length - 2).join(' + '), 'rows to', dir);
}
