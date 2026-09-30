'use strict';
/* ============================================================================
   THE SCHEDULE CHIP on a player's profile: how hard the schedule has been so far for the player's club,
   in the competitions the League percentile bars are showing. Its number is sos.js's SOS ELO (the
   opponents' average ELO), ranked against every club in the same scope; harder = warmer.

   summarise() and band() are pure (supabase/tests/sos-chip.test.mjs). paint() reads nothing: the caller
   hands it the games rows the page already loaded for the bars (EpinoiaData.season().games).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSosChip = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const MIN_GAMES = 3;

/* five bands by the share of the league whose schedule was EASIER (0 = easiest, 100 = hardest) */
function band(p) {
  if (p == null || !isFinite(p)) return { key: 'none', word: '', colour: 'var(--rule-2)' };
  if (p >= 80) return { key: 'hardest', word: 'Hardest', colour: 'var(--flare)' };
  if (p >= 60) return { key: 'hard', word: 'Hard', colour: 'color-mix(in oklch,var(--flare) 55%,var(--amber))' };
  if (p >= 40) return { key: 'mid', word: 'Average', colour: 'var(--amber)' };
  if (p >= 20) return { key: 'easy', word: 'Easy', colour: 'color-mix(in oklch,var(--good) 65%,var(--amber))' };
  return { key: 'easiest', word: 'Easiest', colour: 'var(--good)' };
}

function ordinal(n) {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}

/* games: season rows (home_team_id, away_team_id, home_score, away_score, tipoff_at);
   -> null when the club has played fewer than 3 games or the data is missing */
function summarise(games, teamId, SOS) {
  const X = SOS || root.EpinoiaSOS;
  if (!X || !X.eloRatings || !teamId) return null;
  const m = X.eloRatings(games);
  const me = m.get(teamId);
  if (!me || me.games < MIN_GAMES || !isFinite(me.sosElo)) return null;
  const all = [...m.values()].filter(r => isFinite(r.sosElo));
  const n = all.length;
  if (n < 2) return null;
  const rank = 1 + all.filter(r => r.sosElo > me.sosElo).length;      // 1 = hardest
  const pct = (all.filter(r => r.sosElo < me.sosElo).length / (n - 1)) * 100;
  const b = band(Math.min(100, pct));
  return { rank, n, games: me.games, sos: Math.round(me.sosElo), pct, band: b,
           text: 'SOS ' + Math.round(me.sosElo),
           tip: b.word + ' ' + ordinal(rank) + ' of ' + n + ' — opponents average ELO ' +
                Math.round(me.sosElo) + ' (avg 1500), over ' + me.games + ' games so far. Harder schedule = warmer colour.' };
}

/* the chip lives in the heading, between the h2 and #barNote; repainted in place, removed when there is nothing to say */
function paint(host, ctx) {
  const doc = root.document;
  if (!doc) return;
  const head = host || (doc.getElementById('barNote') || {}).parentNode;
  if (!head) return;
  let chip = head.querySelector('.soschip');
  let s = null;
  try { s = summarise(ctx && ctx.games, ctx && ctx.teamId); } catch (_) { s = null; }
  if (!s) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = doc.createElement('span');
    chip.className = 'soschip';
    chip.tabIndex = 0;
    const note = head.querySelector('#barNote');
    if (note) head.insertBefore(chip, note); else head.appendChild(chip);
  }
  chip.textContent = s.text;
  chip.style.setProperty('--sc', s.band.colour);
  chip.title = s.tip;
  chip.setAttribute('aria-label', s.tip);
  chip.dataset.band = s.band.key;
}

return { band, summarise, paint, ordinal, MIN_GAMES };
}));
