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
  const lo = Math.round(Math.min(...all.map(r => r.sosElo))), hi = Math.round(Math.max(...all.map(r => r.sosElo)));
  const sos = Math.round(me.sosElo), gap = sos - 1500;
  const rel = Math.abs(gap) < 8 ? 'about the same as an average team'
    : (Math.abs(gap) < 25 ? 'slightly ' : Math.abs(gap) < 60 ? '' : 'far ') + (gap > 0 ? 'stronger' : 'weaker') + ' than an average team';
  const seg = Math.max(0, Math.min(4, Math.floor(Math.min(99.9, pct) / 20)));        // which fifth of the league: 0 easiest .. 4 hardest
  return { rank, n, games: me.games, sos, lo, hi, pct, seg, band: b,
           text: 'SOS ' + sos,
           word: b.word,
           line: ordinal(rank) + ' hardest of ' + n,
           tip: b.word + ' ' + ordinal(rank) + ' of ' + n + ' \u2014 opponents average ELO ' + sos + ' (avg 1500), over ' + me.games +
                ' games so far. Harder schedule = warmer colour.',
           more: 'Schedule strength so far: the opponents this club has faced averaged an ELO rating of ' + sos + '. ELO is a strength rating built from ' +
                 'results: 1500 is an average team and higher is stronger, so that is ' + rel + '. The league runs from ' + lo + ' (easiest) to ' + hi +
                 ' (hardest), over ' + me.games + ' games.' };
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
  if (!s) { if (chip) { if (chip._more) chip._more.remove(); chip.remove(); } return; }
  if (!chip) {
    chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'soschip';
    chip.setAttribute('data-i18n-ctx', 'soschip');
    const note = head.querySelector('#barNote');
    if (note) head.insertBefore(chip, note); else head.appendChild(chip);
    chip.addEventListener('click', () => {
      const open = chip.getAttribute('aria-expanded') !== 'true';
      chip.setAttribute('aria-expanded', open ? 'true' : 'false');
      const m = chip._more; if (m) m.hidden = !open;
    });
  }
  const meter = [0, 1, 2, 3, 4].map(i => '<i' + (i === s.seg ? ' class="on"' : '') + '></i>').join('');
  chip.innerHTML = '<span class="sc-top"><span class="sc-k">Schedule</span><span class="sc-w">' + s.word + '</span></span>' +
    '<span class="sc-meter" aria-hidden="true">' + meter + '</span>' +
    '<span class="sc-sub"><span>easy</span><span>' + s.line + '</span><span>hard</span></span>';
  chip.style.setProperty('--sc', s.band.colour);
  chip.title = s.tip;
  chip.setAttribute('aria-label', s.tip + ' Tap for what it means.');
  chip.dataset.band = s.band.key;
  if (!chip._more) {
    chip._more = doc.createElement('div');
    chip._more.className = 'soschip-more'; chip._more.hidden = true;
    chip._more.setAttribute('data-i18n-ctx', 'soschip');
    chip.after(chip._more);
    chip.setAttribute('aria-expanded', 'false');
  }
  chip._more.textContent = s.more;
}

/* ---------------------------------------------------------------------------
   THE CLUB PAGE (t/, beside its Team statistics heading): the club's OWN ELO beside its schedule. The rating is built
   from results by the same engine (sos.js eloRatings: 1500 an average team), ranked against every club in the same
   scope. Stronger = greener: its meter runs the other way from the schedule's, where harder = warmer.
   --------------------------------------------------------------------------- */
function strengthBand(p) {
  if (p == null || !isFinite(p)) return { key: 'none', word: '', colour: 'var(--rule-2)' };
  if (p >= 80) return { key: 'elite', word: 'Elite', colour: 'var(--good)' };
  if (p >= 60) return { key: 'strong', word: 'Strong', colour: 'color-mix(in oklch,var(--good) 65%,var(--amber))' };
  if (p >= 40) return { key: 'mid', word: 'Average', colour: 'var(--amber)' };
  if (p >= 20) return { key: 'weak', word: 'Weak', colour: 'color-mix(in oklch,var(--flare) 55%,var(--amber))' };
  return { key: 'weakest', word: 'Weakest', colour: 'var(--flare)' };
}

/* games as summarise() takes them -> null under 3 games, or when the league has fewer than two rated clubs */
function strength(games, teamId, SOS) {
  const X = SOS || root.EpinoiaSOS;
  if (!X || !X.eloRatings || !teamId) return null;
  const m = X.eloRatings(games);
  const me = m.get(teamId);
  if (!me || me.games < MIN_GAMES || !isFinite(me.elo)) return null;
  const all = [...m.values()].filter(r => isFinite(r.elo));
  const n = all.length;
  if (n < 2) return null;
  const rank = 1 + all.filter(r => r.elo > me.elo).length;          // 1 = strongest
  const pct = (all.filter(r => r.elo < me.elo).length / (n - 1)) * 100;
  const b = strengthBand(Math.min(100, pct));
  const elo = Math.round(me.elo), gap = elo - 1500;
  const lo = Math.round(Math.min(...all.map(r => r.elo))), hi = Math.round(Math.max(...all.map(r => r.elo)));
  const rel = Math.abs(gap) < 8 ? 'about an average team' : (Math.abs(gap) < 25 ? 'slightly ' : Math.abs(gap) < 60 ? '' : 'far ') +
    (gap > 0 ? 'stronger' : 'weaker') + ' than an average team';
  const seg = Math.max(0, Math.min(4, Math.floor(Math.min(99.9, pct) / 20)));
  return { rank, n, games: me.games, elo, lo, hi, pct, seg, band: b, word: b.word,
           line: ordinal(rank) + ' of ' + n,
           tip: 'ELO ' + elo + ': ' + b.word.toLowerCase() + ', ' + ordinal(rank) + ' of ' + n + ' (avg 1500), over ' + me.games + ' games.',
           more: 'ELO is a strength rating built from results: every win takes points from the loser, more for an upset and a big margin. ' +
                 '1500 is an average team, so ' + elo + ' is ' + rel + '. The league runs from ' + lo + ' to ' + hi + ', over ' + me.games + ' games.' };
}

/* one chip, drawn as the player page draws its schedule: a word, a five-step meter and a rank; `kind` names it so it is
   repainted in place. The sentence on what it means opens under `below` (the heading), across the width. */
function chip(box, below, kind, s, o) {
  const doc = root.document;
  let c = box.querySelector('.soschip[data-kind="' + kind + '"]');
  if (!s) { if (c) { if (c._more) c._more.remove(); c.remove(); } return null; }
  if (!c) {
    c = doc.createElement('button');
    c.type = 'button'; c.className = 'soschip' + (o.cls ? ' ' + o.cls : ''); c.dataset.kind = kind;
    c.setAttribute('data-i18n-ctx', 'soschip');
    box.appendChild(c);
    c._more = doc.createElement('div'); c._more.className = 'soschip-more'; c._more.hidden = true;
    c._more.setAttribute('data-i18n-ctx', 'soschip');
    below.after(c._more);
    c.setAttribute('aria-expanded', 'false');
    c.addEventListener('click', () => {
      const open = c.getAttribute('aria-expanded') !== 'true';
      box.querySelectorAll('.soschip').forEach(x => { x.setAttribute('aria-expanded', 'false'); if (x._more) x._more.hidden = true; });
      c.setAttribute('aria-expanded', open ? 'true' : 'false');
      c._more.hidden = !open;
    });
  }
  const meter = [0, 1, 2, 3, 4].map(i => '<i' + (i === s.seg ? ' class="on"' : '') + '></i>').join('');
  c.innerHTML = '<span class="sc-top"><span class="sc-k">' + o.label + '</span><span class="sc-w">' + s.word + (o.value ? ' <b>' + o.value + '</b>' : '') + '</span></span>' +
    '<span class="sc-meter" aria-hidden="true">' + meter + '</span>' +
    '<span class="sc-sub"><span>' + o.ends[0] + '</span><span>' + s.line + '</span><span>' + o.ends[1] + '</span></span>';
  c.style.setProperty('--sc', s.band.colour);
  c.title = s.tip;
  c.setAttribute('aria-label', s.tip + ' Tap for what it means.');
  c.dataset.band = s.band.key;
  c._more.textContent = s.more;
  return c;
}

/* the club page: its ELO and its schedule, side by side at the end of the heading (head: the .ep-hdr) */
function paintClub(head, ctx) {
  const doc = root.document;
  if (!doc || !head) return;
  let box = head.querySelector('.soschips');
  let e = null, h = null;
  try { e = strength(ctx && ctx.games, ctx && ctx.teamId); } catch (_) { e = null; }
  try { h = summarise(ctx && ctx.games, ctx && ctx.teamId); } catch (_) { h = null; }
  if (!box) {
    if (!e && !h) return;
    box = doc.createElement('div'); box.className = 'soschips';
    const h2 = head.querySelector('h2');
    if (h2) h2.after(box); else head.appendChild(box);
  }
  chip(box, head, 'elo', e, { label: 'ELO', value: e && e.elo, ends: ['weak', 'strong'], cls: 'is-elo' });
  chip(box, head, 'sos', h && Object.assign({}, h, { word: h.word }), { label: 'Schedule', value: h && h.sos, ends: ['easy', 'hard'] });
  if (!box.children.length) box.remove();
}

return { band, summarise, paint, ordinal, MIN_GAMES, strengthBand, strength, paintClub };
}));
