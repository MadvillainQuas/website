'use strict';
/* ============================================================================
   EPINOIA LINEUPS — units, filters and WOWY.

   Every stint in lineup_stints carries the five players who were on the floor
   and what happened while they were: an offensive box and a defensive one.
   That is enough to answer three questions properly.

     Which units played, and how did they do?
     How does any COMBINATION of players do — two, three, any number?
     How does a player do WITH a teammate against WITHOUT them?  (WOWY)

   One rule governs all of it: RATES ARE COMPUTED FROM SUMMED BOXES, never
   averaged across stints. A two-possession stint at 200 offensive rating is
   noise, and averaging it against a twenty-possession stint would let the
   noise win. Summing first means a rating is weighted by possessions because
   possessions are literally the denominator.

   The second rule is that a small sample is labelled, not hidden. Every line
   carries its possessions and minutes so a reader can see what a number rests
   on, and callers can filter on it rather than being handed a confident
   number built from ninety seconds.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLineups = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const dv = (a, b) => (b ? a / b : null);
const pct = (a, b) => { const r = dv(a, b); return r == null ? null : r * 100; };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

const BOX = ['pts', 'fga', 'fgm', 'f3m', 'fta', 'tov', 'or', 'dr'];
const blankBox = () => ({ pts: 0, fga: 0, fgm: 0, f3m: 0, fta: 0, tov: 0, or: 0, dr: 0 });

/* possessions, the same estimate the scorer and the season module use */
const poss = b => 0.96 * (num(b.fga) + num(b.tov) + 0.44 * num(b.fta) - num(b.or));

function blank() {
  return { dur: 0, pf: 0, pa: 0, stints: 0, off: blankBox(), def: blankBox() };
}

function add(acc, st) {
  const s = st.stats || st;
  acc.dur += num(s.dur);
  acc.pf += num(s.pf);
  acc.pa += num(s.pa);
  acc.stints += 1;
  BOX.forEach(k => {
    acc.off[k] += num((s.off || {})[k]);
    acc.def[k] += num((s.def || {})[k]);
  });
  return acc;
}

/* turn a summed pair of boxes into the line every view shows */
function finish(acc, label) {
  const o = acc.off, d = acc.def;
  const op = poss(o), dp = poss(d);
  return {
    label: label || '',
    stints: acc.stints,
    mins: r1(acc.dur / 60000),
    poss: r1(op),
    pm: acc.pf - acc.pa,
    pf: acc.pf, pa: acc.pa,

    /* ratings */
    ortg: r1(pct(o.pts, op)),
    drtg: r1(pct(d.pts, dp)),
    net: r1((pct(o.pts, op) || 0) - (pct(d.pts, dp) || 0)),

    /* the four factors, both ends — the same four that decide a game */
    efg:  r1(pct(o.fgm + 0.5 * o.f3m, o.fga)),
    tov:  r1(pct(o.tov, o.fga + 0.44 * o.fta + o.tov)),
    oreb: r1(pct(o.or, o.or + d.dr)),
    ftr:  r1(pct(o.fta, o.fga)),
    defg:  r1(pct(d.fgm + 0.5 * d.f3m, d.fga)),
    dtov:  r1(pct(d.tov, d.fga + 0.44 * d.fta + d.tov)),
    doreb: r1(pct(d.or, d.or + o.dr)),
    dftr:  r1(pct(d.fta, d.fga)),

    _off: o, _def: d
  };
}

/* --------------------------------------------------------------- filtering ---
   Stints whose five contain EVERY id given. Two players filters to the units
   they share; five filters to exactly that unit. An empty filter is the whole
   team, which is the natural baseline to compare a filtered line against. */
function contains(ids, want) {
  for (let i = 0; i < want.length; i++) if (ids.indexOf(want[i]) === -1) return false;
  return true;
}

function filter(stints, ids, label) {
  const want = ids || [];
  const acc = blank();
  (stints || []).forEach(st => {
    if (contains(st.player_ids || [], want)) add(acc, st);
  });
  return finish(acc, label);
}

/* --------------------------------------------------------- combinations ----
   The WOWY matrix as index_9 builds it: for a set of players, every ON/OFF
   arrangement of them, each aggregated separately.

   This is the difference between "which teammate helps" and "what actually
   happens". Picking three players gives eight rows — all three on, each pair
   without the third, each alone, none — and the row that is usually the
   surprise is one nobody would have thought to ask for.

   A combination requires every ON player present AND every OFF player absent.
   The second half is what makes it a real WOWY: without it, "A on, B off"
   would quietly include the minutes B also played. */
function combo(stints, onIds, offIds) {
  const on = onIds || [], off = offIds || [];
  const acc = blank();
  (stints || []).forEach(st => {
    const ids = st.player_ids || [];
    for (let i = 0; i < on.length; i++) if (ids.indexOf(on[i]) === -1) return;
    for (let i = 0; i < off.length; i++) if (ids.indexOf(off[i]) !== -1) return;
    add(acc, st);
  });
  return finish(acc);
}

/* every arrangement of the chosen players, most-used first.
   Capped at five: 2^5 is 32 rows, and beyond that every row is a sample of
   nothing — the combinations multiply faster than the minutes divide. */
function matrix(stints, ids) {
  const picked = (ids || []).slice(0, 5);
  if (!picked.length) return [];
  const rows = [];
  const total = 1 << picked.length;
  for (let mask = 0; mask < total; mask++) {
    const on = [], off = [];
    picked.forEach((id, i) => ((mask & (1 << i)) ? on : off).push(id));
    const line = combo(stints, on, off);
    rows.push(Object.assign(line, {
      on, off,
      state: picked.map(id => on.indexOf(id) !== -1)
    }));
  }
  return rows.sort((a, b) => b.mins - a.mins);
}

/* ----------------------------------------------------------- every lineup ---
   Grouped by the five, summed across games. */
function all(stints, minMinutes) {
  const by = new Map();
  (stints || []).forEach(st => {
    const ids = (st.player_ids || []).slice().sort();
    const key = ids.join(',');
    if (!by.has(key)) by.set(key, { ids, acc: blank() });
    add(by.get(key).acc, st);
  });
  const out = [...by.values()].map(v => Object.assign(finish(v.acc), { ids: v.ids }));
  const floor = minMinutes || 0;
  return out.filter(l => l.mins >= floor).sort((a, b) => b.mins - a.mins);
}

/* ------------------------------------------------------------------ WOWY ----
   With Or Without You: the same team, split four ways by which of two players
   was on the floor.

   The comparison that matters is not "how good is A" — it is how the team
   performs with A on and B off against with both on. That isolates the pairing
   from the player, which a raw on/off cannot do.

   Both-off is included because it is the honest baseline: if a team is better
   with neither of them than with either, that is the finding. */
function wowy(stints, aId, bId) {
  const parts = {
    both:   blank(),   // A and B
    aOnly:  blank(),   // A without B
    bOnly:  blank(),   // B without A
    neither: blank()
  };
  (stints || []).forEach(st => {
    const ids = st.player_ids || [];
    const a = ids.indexOf(aId) !== -1;
    const b = ids.indexOf(bId) !== -1;
    add(parts[a && b ? 'both' : a ? 'aOnly' : b ? 'bOnly' : 'neither'], st);
  });
  return {
    both:    finish(parts.both, 'both on'),
    aOnly:   finish(parts.aOnly, 'A without B'),
    bOnly:   finish(parts.bOnly, 'B without A'),
    neither: finish(parts.neither, 'neither')
  };
}

/* one player against everything they were not on the floor for */
function onOff(stints, playerId) {
  const on = blank(), off = blank();
  (stints || []).forEach(st => {
    add((st.player_ids || []).indexOf(playerId) !== -1 ? on : off, st);
  });
  const ON = finish(on, 'on'), OFF = finish(off, 'off');
  return {
    on: ON, off: OFF,
    diff: {
      net:  (ON.net != null && OFF.net != null) ? r1(ON.net - OFF.net) : null,
      ortg: (ON.ortg != null && OFF.ortg != null) ? r1(ON.ortg - OFF.ortg) : null,
      drtg: (ON.drtg != null && OFF.drtg != null) ? r1(ON.drtg - OFF.drtg) : null
    }
  };
}

/* every teammate ranked by what the pairing does, which is the table a WOWY
   panel actually shows */
function pairs(stints, playerId, minMinutes) {
  const mates = new Set();
  (stints || []).forEach(st => {
    const ids = st.player_ids || [];
    if (ids.indexOf(playerId) === -1) return;
    ids.forEach(id => { if (id !== playerId) mates.add(id); });
  });
  const floor = minMinutes == null ? 4 : minMinutes;
  return [...mates].map(id => {
    const w = wowy(stints, playerId, id);
    return {
      id,
      withMate: w.both,
      withoutMate: w.aOnly,
      /* the pairing effect: how the team does with both, against how it does
         with this player but not that teammate */
      swing: (w.both.net != null && w.aOnly.net != null)
        ? r1(w.both.net - w.aOnly.net) : null
    };
  }).filter(p => p.withMate.mins >= floor)
    .sort((a, b) => (b.swing ?? -Infinity) - (a.swing ?? -Infinity));
}

return { filter, all, wowy, onOff, pairs, combo, matrix, finish, blank, add, poss };
}));
