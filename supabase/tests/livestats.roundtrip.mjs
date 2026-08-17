/* ============================================================================
   LiveStats import — a round trip on a REAL game.

   The unit tests use a fixture I wrote, which means they test the converter
   against my own idea of what a play-by-play looks like. This does something
   harder to fool: it takes a game that was actually scored in Epinoia,
   re-expresses its event log in FIBA's vocabulary, feeds THAT through the
   importer, and checks the engine derives the same box score from the result.

   If the mapping loses anything — a rebound's side, a foul's kind, a free
   throw, the ordering that assists depend on — the two box scores disagree and
   this says exactly where.

   Read-only against the live project: it fetches, it never writes.
   Skips cleanly when the project is unreachable, so CI does not fail on a
   network blip.
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../epinoia/livestats.js');
const E = require('../../epinoia/engine.js');

const URL_ = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
const KEY = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got  ' + g + '\n        want ' + w); }
};

async function api(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(`${r.status} on ${path.split('?')[0]}`);
  return r.json();
}
/* PostgREST caps a response at 1000 rows whatever `limit` says — a one-shot
   query returns a fifth of a game's log and looks entirely successful. */
async function all(path) {
  let out = [], from = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const chunk = await api(`${path}${sep}offset=${from}&limit=1000`);
    out = out.concat(chunk);
    if (chunk.length < 1000) return out;
    from += 1000;
  }
}

/* ---------------------------------------------------------------------------
   Epinoia events -> a FIBA-shaped payload. This is the inverse of the
   importer, written independently of it so a shared misunderstanding cannot
   cancel itself out.
   --------------------------------------------------------------------------- */
function toFiba(events, roster) {
  const shirt = {};                       // pid -> shirt number, per side
  roster.teams.forEach((t, i) => (t.players || []).forEach(p => {
    shirt[p.id] = { num: String(p.num), tno: i + 1 };
  }));

  const gt = ms => {
    if (ms == null) return '00:00';
    const s = Math.max(0, Math.round(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  /* the importer flattens OT to 5,6,7; going back out means undoing that */
  const per = p => (p > 4 ? { period: p - 4, periodType: 'OVERTIME' }
                          : { period: p, periodType: 'REGULAR' });

  const SHOT = { p2_made: ['2pt', 1], p2_miss: ['2pt', 0],
                 p3_made: ['3pt', 1], p3_miss: ['3pt', 0],
                 ft_made: ['freethrow', 1], ft_miss: ['freethrow', 0] };
  const SIMPLE = { ast: 'assist', stl: 'steal', blk: 'block', to: 'turnover' };
  const FOUL_BACK = { personal: 'personal', offensive: 'offensive',
                      unsport: 'unsportsmanlike', disqualifying: 'disqualifying',
                      tech: 'technical' };

  const out = [];
  const who = e => {
    const s = e.pid ? shirt[e.pid] : null;
    return s ? { tno: s.tno, shirtNumber: s.num }
             : { tno: e.team != null ? e.team + 1 : null, pno: 0 };
  };

  events.forEach(e => {
    const base = Object.assign({ gt: gt(e.clock) }, per(e.period || 1));

    if (SHOT[e.t]) {
      const [action, success] = SHOT[e.t];
      out.push(Object.assign({ actionType: action, success }, base, who(e)));
      return;
    }
    if (e.t === 'reb') {
      out.push(Object.assign({ actionType: 'rebound',
        subType: e.off ? 'offensive' : 'defensive' }, base, who(e)));
      return;
    }
    if (SIMPLE[e.t]) {
      out.push(Object.assign({ actionType: SIMPLE[e.t] }, base, who(e)));
      return;
    }
    if (e.t === 'foul') {
      out.push(Object.assign({ actionType: 'foul',
        subType: FOUL_BACK[e.kind] || 'personal' }, base, who(e)));
      return;
    }
    if (e.t === 'sub') {
      /* one Epinoia sub becomes the two halves FIBA writes */
      const i = shirt[e.in], o = shirt[e.out];
      if (o) out.push(Object.assign({ actionType: 'substitution', subType: 'out',
        tno: o.tno, shirtNumber: o.num }, base));
      if (i) out.push(Object.assign({ actionType: 'substitution', subType: 'in',
        tno: i.tno, shirtNumber: i.num }, base));
      return;
    }
    if (e.t === 'period_start') {
      out.push(Object.assign({ actionType: 'period', subType: 'start' }, base));
      return;
    }
    if (e.t === 'timeout') {
      out.push(Object.assign({ actionType: 'timeout', tno: e.team + 1 }, base));
      return;
    }
    if (e.t === 'jump')     { out.push(Object.assign({ actionType: 'jumpball' }, base)); return; }
    if (e.t === 'game_end') { out.push(Object.assign({ actionType: 'game' }, base)); return; }
    /* tag / stype / loc are Epinoia's own descriptors and have no FIBA
       equivalent as separate events — they ride on the shot there */
  });
  return { tm: { 1: { name: roster.teams[0].name }, 2: { name: roster.teams[1].name } },
           pbp: out };
}

/* the fields a scoresheet would show, for one player */
const LINE = s => ({
  pts: s.pts, p2a: s.p2a, p2m: s.p2m, p3a: s.p3a, p3m: s.p3m,
  fta: s.fta, ftm: s.ftm, or: s.or, dr: s.dr,
  ast: s.ast, stl: s.stl, blk: s.blk, to: s.to, pf: s.pf
});

(async function main() {
  let games;
  try {
    games = await api('games?status=eq.final&select=id,starters,roster_snapshot,period&limit=3');
  } catch (e) {
    console.log('\nSKIP — project unreachable (' + e.message + ')');
    process.exit(0);
  }
  const usable = (games || []).filter(g => g.roster_snapshot && g.starters);
  if (!usable.length) {
    console.log('\nSKIP — no finalised game with a frozen roster to round-trip');
    process.exit(0);
  }

  for (const g of usable) {
    console.log('\ngame ' + g.id.slice(0, 8));
    const rows = await all(`game_events?game_id=eq.${g.id}` +
      `&select=seq,t,team,pid,period,clock,payload&order=seq`);
    const original = rows.map(r => Object.assign(
      { t: r.t, id: r.seq, period: r.period, clock: r.clock },
      r.payload || {},
      r.team != null ? { team: r.team } : {},
      r.pid != null ? { pid: r.pid } : {}));

    console.log('  ' + original.length + ' events in the log');

    const before = E.deriveGame({ teams: g.roster_snapshot.teams, starters: g.starters,
                                  events: original, period: g.period || 4, clockMs: 0 });

    /* out to FIBA and back again */
    const payload = toFiba(original, g.roster_snapshot);
    const conv = L.convert({ data: payload, roster: g.roster_snapshot });
    const after = E.deriveGame({ teams: g.roster_snapshot.teams, starters: g.starters,
                                 events: conv.events, period: g.period || 4, clockMs: 0 });

    eq('  nothing failed to convert', conv.counts.skipped, 0);
    eq('  no unmatched players', conv.unmatched, []);
    eq('  the final score survives the trip', after.score, before.score);

    let differing = 0;
    g.roster_snapshot.teams.forEach(t => (t.players || []).forEach(p => {
      const a = LINE(before.stats[p.id] || {}), b = LINE(after.stats[p.id] || {});
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        differing++;
        console.log('  FAIL  ' + p.name + '\n        was ' + JSON.stringify(a) +
                    '\n        now ' + JSON.stringify(b));
      }
    }));
    if (differing) { fail++; }
    else { pass++; console.log('  PASS    every player\'s box score is identical'); }

    /* the team totals a table is built from */
    [0, 1].forEach(i => {
      const a = before.team[i], b = after.team[i];
      eq('  team ' + (i + 1) + ' turnovers', b.toTot, a.toTot);
      eq('  team ' + (i + 1) + ' team rebounds', [b.teamRebO, b.teamRebD], [a.teamRebO, a.teamRebD]);
    });
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
