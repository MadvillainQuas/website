'use strict';
/* ============================================================================
   LIVESTATS IMPORT — a FIBA play-by-play turned into Epinoia events.

   A league that has been running for years has its history in somebody else's
   system. Without this, Epinoia starts empty and every profile, table and
   lineup begins from the first game scored here. With it, the archive comes
   across and the season pages are worth reading on day one.

   The conversion is into the SCORER'S OWN event vocabulary — not a parallel
   import format — so an imported game and a scored game are the same kind of
   thing from that point on. The engine derives both, the box score renders
   both, WOWY reads both. Nothing downstream needs to know where a game came
   from, which is the property worth having: an import that produced a special
   second-class game would need special handling in nine places.

   Three things make this harder than a field rename:

     SUBSTITUTIONS ARE HALVES. FIBA emits an IN and an OUT as separate events;
     the scorer's `sub` carries both. They have to be paired, and a team that
     changes three players at a dead ball emits six events that pair into
     three — in whatever order the operator tapped them.

     PLAYERS ARE NUMBERS. The source knows shirt 7; Epinoia needs a player
     id. That resolution is against the game's frozen roster, and anything it
     cannot resolve is REPORTED rather than dropped, because a silently
     skipped player is a box score that is quietly wrong.

     THE CLOCK RUNS BACKWARDS. FIBA counts down within a period as MM:SS
     remaining; overtime periods restart the numbering and are distinguished
     by a type field rather than by period 5.

   Nothing here writes anything. It returns events, warnings and a reconcilable
   summary so the caller can show a person what will happen before it does.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLiveStats = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* -------------------------------------------------------------- vocabulary ---
   The scorer's event types, and the FIBA actions that become them. */
const SHOT = { '2pt': ['p2_made', 'p2_miss'],
               '3pt': ['p3_made', 'p3_miss'],
               'freethrow': ['ft_made', 'ft_miss'] };

const SIMPLE = { assist: 'ast', steal: 'stl', block: 'blk', turnover: 'to' };

/* Fouls the scorer records against a player. "foulon" is the foul DRAWN — the
   same physical event seen from the other side — and counting it would double
   every foul in the game. */
const FOUL_KIND = {
  personal: 'personal', offensive: 'offensive', unsportsmanlike: 'unsport',
  disqualifying: 'disqualifying', technical: 'tech', personaltechnical: 'tech',
  doublefoul: 'personal', shooting: 'personal'
};

/* A 2pt at the rim, by the source's own description. Coordinates are the
   engine's first test for this; where a feed has no coordinates the shot type
   is the honest fallback, and it is the one the scraper pipeline already
   trusts for the same purpose. */
const RIM = new Set(['layup', 'drivinglayup', 'reverselayup', 'tipin', 'tipinlayup',
                     'tipindunk', 'dunk', 'alleyoop', 'alleyoopdunk', 'eurostep',
                     'hookshot']);

const low = v => String(v == null ? '' : v).trim().toLowerCase();

/* --------------------------------------------------------------- the clock ---
   "MM:SS" remaining within the period. Some feeds write "MM:SS.t"; some write
   seconds alone in the dying moments. */
function clockMs(gt) {
  const s = String(gt == null ? '' : gt).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?:\.(\d))?$/);
  if (m) return ((+m[1]) * 60 + (+m[2])) * 1000 + (m[3] ? +m[3] * 100 : 0);
  const n = s.match(/^(\d{1,3})(?:\.(\d))?$/);
  if (n) return (+n[1]) * 1000 + (n[2] ? +n[2] * 100 : 0);
  return null;
}

/* Overtime restarts the period count, so OT1 arrives as period 1 with a type.
   Flattening to 5, 6, 7 is what the engine and every period label expect. */
function periodOf(ev, fallback) {
  const p = parseInt(ev.period, 10);
  const n = Number.isFinite(p) ? p : fallback;
  return low(ev.periodType) === 'overtime' ? 4 + n : n;
}

/* tno is 1 or 2 in the source; team_idx is 0 or 1 here */
function teamIdx(tno) {
  const n = parseInt(tno, 10);
  return n === 1 ? 0 : n === 2 ? 1 : null;
}

/* -------------------------------------------------------------- the roster ---
   Build shirt-number and name lookups per side from the game's frozen roster,
   so a later roster edit cannot retrospectively change an imported game. */
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

function index(roster) {
  const sides = ((roster && roster.teams) || []).map(t => {
    const byNum = new Map(), byName = new Map();
    ((t && t.players) || []).forEach(p => {
      if (p.num != null && String(p.num).trim() !== '') {
        byNum.set(String(parseInt(p.num, 10)), p);      // "07" and "7" are one shirt
      }
      if (p.name) {
        byName.set(fold(p.name), p);
        /* surname alone, because a feed often carries only the family name */
        const parts = String(p.name).trim().split(/\s+/);
        if (parts.length > 1) {
          const k = fold(parts[parts.length - 1]);
          if (!byName.has(k)) byName.set(k, p);
        }
      }
    });
    return { byNum, byName, players: (t && t.players) || [] };
  });
  return sides;
}

/* Resolve one event's actor. Shirt number first — it is what a scoretable
   operator types and the least ambiguous thing in the feed — then the name. */
function resolve(side, ev) {
  if (!side) return null;
  const shirt = ev.shirtNumber != null && String(ev.shirtNumber).trim() !== ''
    ? String(parseInt(ev.shirtNumber, 10)) : null;
  if (shirt && side.byNum.has(shirt)) return side.byNum.get(shirt);

  const named = ev.player ||
    ((ev.firstName || '') + ' ' + (ev.familyName || '')).trim();
  if (named) {
    const hit = side.byName.get(fold(named));
    if (hit) return hit;
    if (ev.familyName) {
      const h2 = side.byName.get(fold(ev.familyName));
      if (h2) return h2;
    }
  }
  /* pno is a source-internal index, not a shirt; only worth trying last */
  if (ev.pno != null && side.byNum.has(String(parseInt(ev.pno, 10)))) {
    return side.byNum.get(String(parseInt(ev.pno, 10)));
  }
  return null;
}

/* ------------------------------------------------------------ substitutions ---
   FIBA writes IN and OUT separately. Pair them within a side at the same game
   time; a triple change gives three IN and three OUT, matched in order, which
   is arbitrary but harmless — the five on the floor after the change is the
   same set whichever way round they are paired, and that is all the engine
   reads a sub for. An unmatched half is reported. */
function pairSubs(pending) {
  const out = [];
  const ins = pending.filter(s => s.isIn);
  const outs = pending.filter(s => !s.isIn);
  const n = Math.min(ins.length, outs.length);
  for (let i = 0; i < n; i++) out.push({ in: ins[i], out: outs[i] });
  return { pairs: out, orphanIn: ins.slice(n), orphanOut: outs.slice(n) };
}

/* ================================================================ convert === */
/* opts: { data, roster, gameId }
   data may be the whole payload or just the event array — feeds differ, and
   asking a person to find the right key inside a JSON file is a poor trade. */
function convert(opts) {
  const o = opts || {};
  const src = pickEvents(o.data);
  const sides = index(o.roster);
  const events = [];
  const warnings = [];
  const unmatched = new Map();          // "side:shirt" -> count
  let seq = 0, period = 1, ended = false;

  const counts = { shots: 0, ft: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0,
                   foul: 0, sub: 0, skipped: 0 };

  if (!src.length) {
    return { events: [], warnings: ['No play-by-play events found in that file.'],
             counts, unmatched: [], empty: true };
  }

  const push = e => { e.id = ++seq; events.push(e); return e; };

  /* the frame every event shares */
  const frame = ev => ({ period, clock: clockMs(ev.gt) });

  const note = (side, ev) => {
    const shirt = ev.shirtNumber != null ? String(ev.shirtNumber) : (ev.player || '?');
    const key = (side === 0 ? 'home' : side === 1 ? 'away' : '?') + ' #' + shirt;
    unmatched.set(key, (unmatched.get(key) || 0) + 1);
  };

  /* substitutions buffer, flushed when the game time or the team changes */
  let pending = [], pendKey = null, pendTeam = null;
  function flushSubs() {
    if (!pending.length) return;
    const { pairs, orphanIn, orphanOut } = pairSubs(pending);
    pairs.forEach(p => {
      push(Object.assign({ t: 'sub', team: pendTeam, in: p.in.pid, out: p.out.pid },
                         p.in.frame));
      counts.sub++;
    });
    /* A lone IN or OUT cannot be represented and would silently corrupt the
       five on the floor, so it is refused loudly rather than guessed at. */
    orphanIn.concat(orphanOut).forEach(s => {
      warnings.push('unpaired substitution at ' + (s.frame.clock == null ? '?' :
        fmt(s.frame.clock)) + ' in period ' + s.frame.period +
        ' — ' + (s.isIn ? 'came on' : 'went off') + ' with no matching partner');
      counts.skipped++;
    });
    pending = []; pendKey = null; pendTeam = null;
  }

  src.forEach(ev => {
    const action = low(ev.actionType);
    const sub = low(ev.subType);
    const side = teamIdx(ev.tno);

    /* keep the period in step even on events that carry no team */
    if (ev.period != null) period = periodOf(ev, period);

    if (action === 'substitution') {
      if (side == null) { counts.skipped++; return; }
      const person = resolve(sides[side], ev);
      if (!person) { note(side, ev); counts.skipped++; return; }
      const key = side + '@' + String(ev.gt) + '@' + period;
      if (pendKey !== null && key !== pendKey) flushSubs();
      pendKey = key; pendTeam = side;
      pending.push({ isIn: sub === 'in', pid: person.id, frame: frame(ev) });
      return;
    }
    /* anything else closes an open substitution group */
    if (pending.length) flushSubs();

    if (action === 'period') {
      /* the source marks both ends of a period; only the start is an event
         the engine wants, and the end of the last one is the game ending */
      if (low(ev.subType) === 'start' || low(ev.periodAction) === 'start' || !ev.subType) {
        push({ t: 'period_start', period, clock: clockMs(ev.gt) });
      }
      return;
    }
    if (action === 'game') {
      if (!ended) { push({ t: 'game_end', period, clock: 0 }); ended = true; }
      return;
    }
    if (action === 'timeout') {
      if (side != null) push(Object.assign({ t: 'timeout', team: side }, frame(ev)));
      return;
    }
    if (action === 'jumpball') {
      push(Object.assign({ t: 'jump' }, frame(ev)));
      return;
    }

    if (side == null) { counts.skipped++; return; }

    /* a team rebound or team turnover has no player and that is legitimate */
    const teamOnly = (ev.pno == null || ev.pno === 0 || ev.pno === '0') &&
                     !ev.shirtNumber && !ev.player;
    const person = teamOnly ? null : resolve(sides[side], ev);
    if (!teamOnly && !person) {
      note(side, ev);
      counts.skipped++;
      return;
    }
    const pid = person ? person.id : null;

    if (SHOT[action]) {
      const made = ev.success === 1 || ev.success === '1' || ev.success === true;
      const t = SHOT[action][made ? 0 : 1];
      const e = push(Object.assign({ t, team: side, pid }, frame(ev)));
      if (action === 'freethrow') counts.ft++; else counts.shots++;

      /* Location, where the feed has it. The engine reads a separate `loc`
         event keyed to the shot, which is also how the scorer records it. */
      const x = num(ev.x), y = num(ev.y);
      if (x != null && y != null) {
        push({ t: 'loc', ref: e.id, x: x / 100, y: y / 100,
               period, clock: e.clock });
      } else if (action === '2pt' && RIM.has(sub)) {
        /* no coordinates: let the shot type carry the rim classification,
           which is what the engine's `paint` tag exists for */
        push({ t: 'tag', ref: e.id, tag: 'paint', period, clock: e.clock });
      }
      if (sub) push({ t: 'stype', ref: e.id, v: sub, period, clock: e.clock });
      return;
    }

    if (action === 'rebound') {
      /* "deadball" rebounds are bookkeeping, not a rebound anybody grabbed */
      if (sub === 'deadball') { counts.skipped++; return; }
      push(Object.assign({ t: 'reb', team: side, pid, off: sub === 'offensive' },
                         frame(ev)));
      counts.reb++;
      return;
    }

    if (SIMPLE[action]) {
      push(Object.assign({ t: SIMPLE[action], team: side, pid }, frame(ev)));
      counts[SIMPLE[action] === 'ast' ? 'ast' : SIMPLE[action] === 'stl' ? 'stl'
            : SIMPLE[action] === 'blk' ? 'blk' : 'to']++;
      return;
    }

    if (action === 'foul') {
      /* the drawn side of a foul is the same event counted twice */
      if (sub === 'foulon' || sub === 'offensivefoulon') { return; }
      const kind = FOUL_KIND[sub];
      if (!kind) { counts.skipped++; return; }
      push(Object.assign({ t: 'foul', team: side, pid, kind }, frame(ev)));
      counts.foul++;
      return;
    }

    counts.skipped++;
  });

  flushSubs();
  if (!ended) push({ t: 'game_end', period, clock: 0 });

  if (unmatched.size) {
    const total = [...unmatched.values()].reduce((a, b) => a + b, 0);
    warnings.unshift(total + ' event' + (total === 1 ? '' : 's') +
      ' could not be matched to a player on the roster: ' +
      [...unmatched.entries()].map(([k, n]) => k + ' (' + n + ')').join(', '));
  }

  return { events, warnings, counts,
           unmatched: [...unmatched.entries()].map(([k, n]) => ({ who: k, n })) };
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return (typeof n === 'number' && isFinite(n)) ? n : null;
}

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* Feeds nest the play-by-play under different keys, and some hand it over as
   a bare array. Finding it is the importer's job, not the operator's. */
function pickEvents(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const direct = ['pbp', 'playByPlay', 'play_by_play', 'actions', 'events'];
  for (const k of direct) {
    if (Array.isArray(data[k])) return data[k];
  }
  /* the shape the FIBA data.json actually uses */
  if (data.pbp && Array.isArray(data.pbp.pbp)) return data.pbp.pbp;
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k2 of direct) if (Array.isArray(v[k2])) return v[k2];
    }
  }
  /* last resort: the longest array of objects that look like events */
  let best = [];
  const walk = (node, depth) => {
    if (depth > 3 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > best.length && node.some(x => x && x.actionType)) best = node;
      return;
    }
    Object.keys(node).forEach(k => walk(node[k], depth + 1));
  };
  walk(data, 0);
  return best;
}

/* ------------------------------------------------------------- the starters ---
   Who was on the floor before the first substitution. This is not decoration:
   the engine seeds its on-court five from it, so a wrong answer misattributes
   every lineup stint and every on/off number in the game.

   Two sources, best first. Most FIBA payloads carry a starter flag per player,
   which is authoritative. Where they do not, the five are INFERRED from the
   log — the first five distinct players a side uses, with anyone who is
   substituted IN excluded, because coming on is proof of not having started.

   Inference can be short: a starter who touches nothing and is replaced early
   leaves only four discoverable names. The gap is filled from the rest of the
   squad in shirt order and REPORTED, because a silently invented starter is a
   lineup table that is quietly wrong. */
function starters(data, roster, events) {
  const sides = index(roster);
  const out = [[], []];
  const notes = [];

  /* 1. the flag, if the payload has one */
  const tm = (data && (data.tm || data.teams)) || {};
  [0, 1].forEach(i => {
    const t = tm[String(i + 1)] || tm[i];
    const list = t && (t.pl || t.players);
    if (!list) return;
    const arr = Array.isArray(list) ? list : Object.keys(list).map(k => list[k]);
    arr.forEach(p => {
      const isStarter = p.starter === 1 || p.starter === '1' || p.starter === true;
      if (!isStarter || out[i].length >= 5) return;
      const hit = resolve(sides[i], {
        shirtNumber: p.shirtNumber != null ? p.shirtNumber : p.num,
        player: p.name, firstName: p.firstName, familyName: p.familyName
      });
      if (hit && out[i].indexOf(hit.id) === -1) out[i].push(hit.id);
    });
  });

  /* 2. infer from the log for any side the flag did not settle */
  [0, 1].forEach(i => {
    if (out[i].length === 5) return;
    const cameOn = new Set();
    const seen = [];
    (events || []).forEach(e => {
      if (e.team !== i) return;
      if (e.t === 'sub') { if (e.in) cameOn.add(e.in); return; }
      if (!e.pid || cameOn.has(e.pid)) return;
      if (seen.indexOf(e.pid) === -1 && seen.length < 5) seen.push(e.pid);
    });
    seen.forEach(id => { if (out[i].length < 5 && out[i].indexOf(id) === -1) out[i].push(id); });

    if (out[i].length < 5) {
      const before = out[i].length;
      (sides[i].players || []).forEach(p => {
        if (out[i].length < 5 && out[i].indexOf(p.id) === -1) out[i].push(p.id);
      });
      notes.push('side ' + (i + 1) + ': only ' + before + ' of 5 starters could be ' +
        'determined from the file, so the rest were taken from the squad list in order — ' +
        'lineup stints for this game may be slightly off');
    }
  });

  return { starters: out, notes };
}

/* --------------------------------------------------------------- the teams ---
   A convenience for the UI: read team names out of the payload so an operator
   can confirm they picked the right fixture before importing it. */
function describe(data) {
  const d = data || {};
  const t = d.tm || d.teams || {};
  const one = t['1'] || t[0] || {}, two = t['2'] || t[1] || {};
  const nameOf = x => x.name || x.longName || x.teamName || x.nameInternational || null;
  return {
    home: nameOf(one), away: nameOf(two),
    scoreHome: num(one.score), scoreAway: num(two.score),
    events: pickEvents(d).length
  };
}

return { convert, describe, starters, pickEvents, clockMs, periodOf, teamIdx,
         index, resolve, pairSubs, RIM, FOUL_KIND };
}));
