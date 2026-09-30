/* SCHEDULE CHIP + ELO: band(), summarise() and eloRatings() are pure.
     node supabase/tests/sos-chip.test.mjs */
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
const SOS = require(path.join(ROOT, 'epinoia', 'sos.js'));
const Chip = require(path.join(ROOT, 'epinoia', 'p', 'sos-chip.js'));
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); pass++; console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + e.message); } };

ok('bands: five, hardest is red, easiest is green', () => {
  assert.equal(Chip.band(100).key, 'hardest'); assert.equal(Chip.band(80).key, 'hardest');
  assert.equal(Chip.band(79.9).key, 'hard'); assert.equal(Chip.band(50).key, 'mid');
  assert.equal(Chip.band(39.9).key, 'easy'); assert.equal(Chip.band(0).key, 'easiest');
  assert.match(Chip.band(90).colour, /flare/); assert.match(Chip.band(5).colour, /good/);
  assert.equal(Chip.band(null).key, 'none');
});
ok('ordinal', () => assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(Chip.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']));

const T = ['a', 'b', 'c', 'd'], games = []; let i = 0;
for (let r = 0; r < 3; r++) for (const x of T) for (const y of T) if (x < y)
  games.push({ id: i, home_team_id: x, away_team_id: y, home_score: 80 + i, away_score: 75 + (i * 3) % 11, tipoff_at: new Date(2026, 0, 1 + i++).toISOString() });
ok('eloRatings: every club, 1500-centred, zero-sum', () => {
  const m = SOS.eloRatings(games);
  assert.equal(m.size, 4);
  const sum = [...m.values()].reduce((s, r) => s + r.elo, 0);
  assert.ok(Math.abs(sum - 6000) < 1e-6);
});
ok('eloRatings agrees with compute over the same scores', () => {
  const full = SOS.compute(SOS.scoreLines(games), {}).rows;
  const m = SOS.eloRatings(games);
  full.forEach(r => assert.equal(m.get(r.key).elo, r.elo));
});
ok('summarise: rank 1 is the hardest schedule', () => {
  const r = T.map(t => Chip.summarise(games, t, SOS));
  assert.deepEqual(r.map(x => x.rank).sort(), [1, 2, 3, 4]);
  const hardest = r.find(x => x.rank === 1);
  assert.equal(hardest.band.key, 'hardest'); assert.equal(r.find(x => x.rank === 4).band.key, 'easiest');
  assert.match(hardest.tip, /^Hardest 1st of 4 .*avg 1500/);
  assert.match(hardest.text, /^SOS \d+$/);
  assert.match(hardest.line, /^1st hardest of 4$/); assert.ok(hardest.seg === 4 && hardest.more.includes("ELO"));
});
ok('summarise: hidden under 3 games or without data', () => {
  assert.equal(Chip.summarise(games.slice(0, 2), 'a', SOS), null);
  assert.equal(Chip.summarise(null, 'a', SOS), null);
  assert.equal(Chip.summarise(games, 'zzz', SOS), null);
  assert.equal(Chip.summarise(games, null, SOS), null);
});
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
