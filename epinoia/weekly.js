'use strict';
/* ============================================================================
   THE WEEKLY REPORT — the same scouting question, asked of a week instead of a
   game.

   The match report's scout's note (game/story.js scout()) compares one game to
   every other game in the league and says where a side was ahead and behind.
   A coach's week is the same question over a slightly bigger object: two or
   three games, aggregated properly, read against the same distribution, and
   written in the register of somebody trying to be better next week rather
   than somebody describing what happened last week.

   TWO THINGS IT REFUSES TO DO.

   AVERAGE A PERCENTAGE. A week is not the mean of its games' shooting
   percentages; it is the week's makes over the week's attempts. Every rate
   here is rebuilt from the week's counting totals, which is why this reads the
   stored `adv` block for its COUNTS and never for its rates.

   PRETEND ONE GAME IS A WEEK. gamepct.js already shrinks a rate towards the
   league by its own volume, so a single hot night cannot present itself as a
   month of form — but the report also says how many games it is looking at,
   every time, because "you were poor from three this week" means something
   different after one game and after four.

   WHAT IT NEEDS: the subject's finished games in the window, the stored
   per-game stats for them, and gamepct's scales for that league. Without the
   scales there is no league to be measured against and the report says so
   rather than inventing a verdict.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWeekly = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ---------------------------------------------------------------- shapes --- */

/* The counting stats a week is summed over. Rates are rebuilt from these; nothing
   in the stored `adv` block that is already a rate is ever averaged. */
const TEAM_COUNTS = ['pts', 'fga', 'fgm', 'fg3a', 'fg3m', 'fg2a', 'fg2m', 'fta', 'ftm',
  'oreb', 'dreb', 'tov', 'ast', 'stl', 'blk', 'possessions', 'tsa', 'ptsAst',
  'rimA', 'rimM', 'midA', 'midM', 'minutes'];

const PLAYER_COUNTS = ['pts', 'p2a', 'p2m', 'p3a', 'p3m', 'fta', 'ftm', 'or', 'dr',
  'ast', 'to', 'stl', 'blk', 'pf', 'min', 'pm', 'ptsAst', 'rimA', 'rimM', 'midA', 'midM'];

/* the measures a coach asks about a week, in the order they would ask them.
   `style` is a preference, not a standard: it is shown and never judged. */
const TEAM_MEASURES = [
  { k: 'efg',   lab: 'shooting from the field',       short: 'eFG%' },
  { k: 'tovp',  lab: 'looking after the ball',        short: 'TOV%' },
  { k: 'orebp', lab: 'the offensive glass',           short: 'OREB%' },
  { k: 'drebp', lab: 'the defensive glass',           short: 'DREB%' },
  { k: 'ftr',   lab: 'getting to the line',           short: 'FTA rate' },
  { k: 'ftp',   lab: 'free throws',                   short: 'FT%' },
  { k: 'p3p',   lab: 'shooting from three',           short: '3PT%' },
  { k: 'p3r',   lab: 'how much they shot from three', short: '3PA rate', style: true },
  { k: 'rimr',  lab: 'getting to the rim',            short: 'rim rate', style: true },
  { k: 'rimp',  lab: 'finishing at the rim',          short: 'rim%' },
  { k: 'astp',  lab: 'sharing the ball',              short: 'AST%' },
  { k: 'astTo', lab: 'passing against turning it over', short: 'AST/TO' },
  { k: 'stlp',  lab: 'forcing turnovers',             short: 'STL%' },
  { k: 'blkp',  lab: 'protecting the rim',            short: 'BLK%' },
  { k: 'ppp',   lab: 'scoring per possession',        short: 'PPP' },
  { k: 'drtg',  lab: 'their defence',                 short: 'DRTG' }
];

const PLAYER_MEASURES = [
  { k: 'ts',      lab: 'scoring efficiency',            short: 'TS%' },
  { k: 'usg',     lab: 'how much of the offence they took', short: 'USG%', style: true },
  { k: 'tovP',    lab: 'looking after the ball',        short: 'TOV%' },
  { k: 'astPct',  lab: 'creating for others',           short: 'AST%' },
  { k: 'orebP',   lab: 'the offensive glass',           short: 'OREB%' },
  { k: 'drebP',   lab: 'the defensive glass',           short: 'DREB%' },
  { k: 'rimP',    lab: 'finishing at the rim',          short: 'rim%' },
  { k: 'p3P',     lab: 'shooting from three',           short: '3PT%' },
  { k: 'midP',    lab: 'the mid-range',                 short: 'mid%' },
  { k: 'ftr',     lab: 'getting to the line',           short: 'FTA rate' },
  { k: 'stlP',    lab: 'taking the ball off people',    short: 'STL%' },
  { k: 'blkP',    lab: 'blocking shots',                short: 'BLK%' },
  { k: 'ppp',     lab: 'points per possession used',    short: 'PPP' }
];

const dv = (a, b) => (b ? a / b : 0);
const num = v => (v == null || isNaN(v) ? 0 : +v);

/* --------------------------------------------------------------- summing --- */

function sum(rows, keys, pick) {
  const out = {};
  keys.forEach(k => { out[k] = 0; });
  rows.forEach(r => {
    const s = pick ? pick(r) : r;
    if (!s) return;
    keys.forEach(k => { out[k] += num(s[k]); });
  });
  return out;
}

/* THE WEEK'S RATES, FROM THE WEEK'S COUNTS. Every formula here is the one the
   engine uses for a single game (epinoia/engine.js teamAdv); the only difference
   is what is in the numerator and the denominator. */
function teamRates(T, O) {
  const poss = T.possessions || (T.fga - T.oreb + T.tov + 0.44 * T.fta);
  const oppPoss = O.possessions || (O.fga - O.oreb + O.tov + 0.44 * O.fta);
  return Object.assign({}, T, {
    possessions: poss,
    efg: dv(T.fgm + 0.5 * T.fg3m, T.fga) * 100,
    ts: dv(T.pts, 2 * T.tsa) * 100,
    tsa: T.tsa || (T.fga + 0.44 * T.fta),
    tovp: dv(T.tov, T.fga + 0.44 * T.fta + T.tov) * 100,
    orebp: dv(T.oreb, T.oreb + O.dreb) * 100,
    drebp: dv(T.dreb, T.dreb + O.oreb) * 100,
    ftr: dv(T.fta, T.fga) * 100,
    ftp: dv(T.ftm, T.fta) * 100,
    astp: dv(T.ast, T.fgm) * 100,
    astTo: dv(T.ast, T.tov),
    stlp: dv(T.stl, oppPoss) * 100,
    blkp: dv(T.blk, O.fga - O.fg3a) * 100,
    rimp: dv(T.rimM, T.rimA) * 100,
    rimr: dv(T.rimA, T.fga) * 100,
    midp: dv(T.midM, T.midA) * 100,
    p3p: dv(T.fg3m, T.fg3a) * 100,
    p3r: dv(T.fg3a, T.fga) * 100,
    astPtsP: dv(T.ptsAst, T.pts - T.ftm) * 100,
    ortg: dv(T.pts, poss) * 100,
    drtg: dv(O.pts, oppPoss) * 100,
    ppp: dv(T.pts, poss),
    tsaPer100: dv(T.tsa || (T.fga + 0.44 * T.fta), poss) * 100
  });
}

/* a player's week, in the shape gamepct's PLAYER scope reads. The on-court block
   (ocOrtg and friends) is deliberately absent: those are per-possession readings
   of the five around them and do not sum. */
function playerRates(P, T, O) {
  const fga = P.p2a + P.p3a, fgm = P.p2m + P.p3m;
  const tsa = fga + 0.44 * P.fta;
  const teamPoss = T ? (T.possessions || (T.fga - T.oreb + T.tov + 0.44 * T.fta)) : 0;
  const share = T && T.minutes ? dv(P.min / 60000, T.minutes) : 0;
  return {
    id: P.id, min: P.min, pts: P.pts, fgm: fgm,
    ts: dv(P.pts, 2 * tsa) * 100,
    usg: teamPoss && share ? dv(fga + 0.44 * P.fta + P.to, teamPoss * share) * 100 : null,
    tovP: dv(P.to, fga + 0.44 * P.fta + P.to) * 100,
    astPct: T && T.fgm ? dv(P.ast, T.fgm * (share || 1)) * 100 : null,
    orebP: T && O ? dv(P.or, (T.oreb + O.dreb) * (share || 1)) * 100 : null,
    drebP: T && O ? dv(P.dr, (T.dreb + O.oreb) * (share || 1)) * 100 : null,
    rimP: dv(P.rimM, P.rimA) * 100,
    p3P: dv(P.p3m, P.p3a) * 100,
    midP: dv(P.midM, P.midA) * 100,
    ftr: dv(P.fta, fga) * 100,
    stlP: T && O ? dv(P.stl, (O.possessions || 0) * (share || 1)) * 100 : null,
    blkP: T && O ? dv(P.blk, (O.fga - O.fg3a) * (share || 1)) * 100 : null,
    ppp: dv(P.pts, fga + 0.44 * P.fta + P.to),
    p3a: P.p3a, rimA: P.rimA, midA: P.midA, fta: P.fta, tpc: fga + 0.44 * P.fta + P.to,
    ast: P.ast, pm: P.pm, tsa: tsa
  };
}

/* --------------------------------------------------------------- reading --- */

const GP = () => (typeof globalThis !== 'undefined' && globalThis.EpinoiaGamePct) || null;

/* one measure, read against the league: { pct, band } or nulls */
function read(scope, key, ctx, league) {
  const g = GP();
  if (!g || !g.rate) return { pct: null, band: null };
  const r = g.rate(scope, key, ctx, { league });
  return r ? { pct: (r.d ? r.g : r.p), band: r.band } : { pct: null, band: null };
}

function ledger(scope, measures, ctx, values, league) {
  const rows = [];
  measures.forEach(m => {
    const v = values[m.k];
    if (v == null || !isFinite(v)) return;
    const r = read(scope, m.k, ctx, league);
    rows.push({ key: m.k, label: m.lab, short: m.short, style: !!m.style,
                value: v, pct: r.pct, band: r.band });
  });
  const judged = rows.filter(r => !r.style && r.pct != null);
  const byPct = judged.slice().sort((a, b) => b.pct - a.pct);
  return {
    rows,
    good: byPct.filter(r => r.pct >= 60).slice(0, 3),
    bad: byPct.filter(r => r.pct <= 40).reverse().slice(0, 3),
    graded: judged.length > 0
  };
}

/* ------------------------------------------------------------------ words --- */

/* the register is "next week", not "last week": every weakness is phrased as a
   thing to work on, and every strength as a thing to keep doing */
function phrase(p) {
  if (p == null) return 'hard to place';
  const r = Math.round(p);
  if (r >= 90) return 'better than nine weeks in ten';
  if (r >= 75) return 'better than three in four';
  if (r >= 60) return 'better than most';
  if (r > 40) return 'about average for this league';
  if (r > 25) return 'worse than most';
  if (r > 10) return 'worse than three in four';
  return 'worse than nine in ten';
}

const listOf = xs => {
  const a = xs.slice(0, 3);
  return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
};

function prose(subject, led, games, record) {
  const out = [];
  const n = games.length;
  const spell = n === 1 ? 'one game' : n + ' games';
  if (!n) return ['No games in this window yet — the report fills in as soon as one is played.'];

  const head = subject + ' played ' + spell + (record ? ' (' + record + ')' : '') + ' this week.';
  if (!led.graded) {
    out.push(head + ' There are no league scales built for this competition yet, so these are ' +
      'the week’s own numbers with nothing to read them against.');
    return out;
  }
  out.push(head + ' Read against every other ' + (n === 1 ? 'game' : 'run of games') +
    ' in this league, here is where the week sat.');

  if (led.good.length) {
    out.push('KEEP DOING: ' + listOf(led.good.map(r => r.label)) + '. ' +
      cap(led.good[0].label) + ' was ' + phrase(led.good[0].pct) + ' — the part of the week ' +
      'that needs no fixing, only repeating.');
  }
  if (led.bad.length) {
    out.push('WORK ON: ' + listOf(led.bad.map(r => r.label)) + '. ' +
      cap(led.bad[0].label) + ' was ' + phrase(led.bad[0].pct) + ', and it is the furthest ' +
      'behind the league of anything here — the one to take into Tuesday.');
  }
  if (!led.good.length && !led.bad.length) {
    out.push('Nothing in the week stood out in either direction: every measure landed in the ' +
      'middle of the league. That is a week to build on rather than to react to.');
  }
  const styles = led.rows.filter(r => r.style && r.pct != null);
  if (styles.length) {
    out.push('For shape rather than score: ' + styles.map(r => r.label + ' was ' +
      Math.round(r.pct) + 'th percentile').join(', ') + '. Neither answer is the right one; ' +
      'it is worth knowing which one you chose.');
  }
  if (n === 1) {
    out.push('One game is one game. The scales already pull a single night back towards the ' +
      'league, but treat everything above as a question for next week rather than an answer.');
  }
  return out;
}

const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/* ------------------------------------------------------------- assembling --- */

/* `api` is the page's own fetcher: (path) => Promise<rows>. Nothing here knows
   about keys or URLs, so this module is testable with a stub. */
async function teamWeek(api, teamId, opts) {
  const o = opts || {};
  const days = o.days || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const games = await api('games?select=id,tipoff_at,status,home_team_id,away_team_id,home_score,away_score' +
    `&status=eq.final&tipoff_at=gte.${since}` +
    `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})&order=tipoff_at.desc&limit=20`);
  if (!games.length) return { games: [], prose: prose(o.name || 'This team', { rows: [], graded: false }, []), led: null };
  const ids = games.map(g => g.id).join(',');
  const rows = await api(`team_game_stats?select=game_id,team_idx,stats&game_id=in.(${ids})`);
  const mine = [], theirs = [];
  let w = 0, l = 0;
  games.forEach(g => {
    const home = g.home_team_id === teamId;
    const me = rows.find(r => r.game_id === g.id && r.team_idx === (home ? 0 : 1));
    const op = rows.find(r => r.game_id === g.id && r.team_idx === (home ? 1 : 0));
    if (me && me.stats && me.stats.adv) mine.push(me.stats.adv);
    if (op && op.stats && op.stats.adv) theirs.push(op.stats.adv);
    const my = home ? g.home_score : g.away_score, th = home ? g.away_score : g.home_score;
    if (my > th) w++; else if (my < th) l++;
  });
  const T = teamRates(sum(mine, TEAM_COUNTS), sum(theirs, TEAM_COUNTS));
  const O = teamRates(sum(theirs, TEAM_COUNTS), sum(mine, TEAM_COUNTS));
  const led = ledger('team', TEAM_MEASURES, { T, O }, T, o.league);
  return { games, led, totals: T, opponent: O, record: w + '-' + l,
           prose: prose(o.name || 'This team', led, games, w + '-' + l) };
}

async function playerWeek(api, playerId, opts) {
  const o = opts || {};
  const days = o.days || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const lines = await api('player_game_stats?select=game_id,team_idx,stats' +
    `&player_uuid=eq.${playerId}&limit=40`);
  if (!lines.length) return { games: [], led: null, prose: prose(o.name || 'This player', { rows: [], graded: false }, []) };
  const ids = [...new Set(lines.map(r => r.game_id))].join(',');
  const games = (await api(`games?select=id,tipoff_at,status,home_score,away_score&id=in.(${ids})` +
    `&status=eq.final&tipoff_at=gte.${since}&order=tipoff_at.desc`)) || [];
  const keep = new Set(games.map(g => g.id));
  const played = lines.filter(r => keep.has(r.game_id));
  if (!played.length) return { games: [], led: null, prose: prose(o.name || 'This player', { rows: [], graded: false }, []) };
  const teamRows = await api(`team_game_stats?select=game_id,team_idx,stats&game_id=in.(${[...keep].join(',')})`);
  const mineT = [], oppT = [];
  played.forEach(r => {
    const me = teamRows.find(x => x.game_id === r.game_id && x.team_idx === r.team_idx);
    const op = teamRows.find(x => x.game_id === r.game_id && x.team_idx === 1 - r.team_idx);
    if (me && me.stats && me.stats.adv) mineT.push(me.stats.adv);
    if (op && op.stats && op.stats.adv) oppT.push(op.stats.adv);
  });
  const P = sum(played, PLAYER_COUNTS, r => r.stats);
  const T = teamRates(sum(mineT, TEAM_COUNTS), sum(oppT, TEAM_COUNTS));
  const O = teamRates(sum(oppT, TEAM_COUNTS), sum(mineT, TEAM_COUNTS));
  const V = playerRates(P, T, O);
  const led = ledger('player', PLAYER_MEASURES, { a: V, x: P, T, O, TT: T, OT: O }, V, o.league);
  return { games, led, totals: V, minutes: P.min,
           prose: prose(o.name || 'This player', led, games, null) };
}

/* ------------------------------------------------------------------ view --- */
const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* KEEP DOING / WORK ON, and then the whole ledger. The two lists are the report; the ledger
   underneath is the evidence for them, in one order, so a coach can check a claim rather than
   take it. A style is drawn in grey and carries no verdict. */
function render(rep, opts) {
  const o = opts || {};
  const led = rep.led;
  const head = '<div class="wk-head"><div class="wk-k">weekly report</div>' +
    '<div class="wk-sub">' + esc(o.window || 'the last seven days') +
    (rep.games && rep.games.length ? ' · ' + rep.games.length +
      (rep.games.length === 1 ? ' game' : ' games') : '') +
    (rep.record ? ' · ' + esc(rep.record) : '') + '</div></div>';
  const paras = (rep.prose || []).map(p => {
    const m = /^(KEEP DOING|WORK ON):\s*/.exec(p);
    if (!m) return '<p>' + esc(p) + '</p>';
    const cls = m[1] === 'WORK ON' ? 'wk-work' : 'wk-keep';
    return '<p class="' + cls + '"><b>' + m[1].toLowerCase() + '</b>' + esc(p.slice(m[0].length)) + '</p>';
  }).join('');
  let table = '';
  if (led && led.rows.length) {
    const rows = led.rows.map(r => {
      const p = r.pct == null ? null : Math.round(r.pct);
      const cls = r.style ? 'wk-style' : p == null ? '' : p >= 70 ? 'wk-good' : p <= 30 ? 'wk-bad' : 'wk-mid';
      return '<div class="wk-row ' + cls + '">' +
        '<span class="wk-lab">' + esc(r.short) + '</span>' +
        '<span class="wk-val">' + (Math.round(r.value * 10) / 10) + '</span>' +
        '<span class="wk-bar"><i style="width:' + (p == null ? 0 : Math.max(2, Math.min(100, p))) + '%"></i></span>' +
        '<span class="wk-p">' + (p == null ? '—' : p) + '</span></div>';
    }).join('');
    table = '<div class="wk-tbl">' + rows + '</div>' +
      '<div class="wk-key">the bar is the percentile against real games in this competition · ' +
      'grey rows are a style, not a score</div>';
  }
  return '<div class="wk">' + head + '<div class="wk-prose">' + paras + '</div>' + table + '</div>';
}

/* ------------------------------------------------------------------ mount --- */
/* THE SAME WIRING ON BOTH PROFILES. A tab that hides the page body and shows one panel is the
   pattern the video tab already established on these two pages; doing it twice by hand is how
   the two drift. The report is fetched once, on the first press, because a coach who never
   opens the tab should not pay for it on every page load. */
function mount(o) {
  const tabs = document.querySelector(o.tabs);
  const panel = document.querySelector(o.panel);
  if (!tabs || !panel) return null;
  let loaded = false;
  const btn = document.createElement('button');
  btn.className = 'ep-tab'; btn.type = 'button'; btn.dataset.p = 'weekly';
  btn.setAttribute('role', 'tab');
  btn.textContent = o.label || 'Weekly report';
  tabs.appendChild(btn);
  tabs.style.display = '';
  const show = async on => {
    document.body.classList.toggle('wktab', on);
    panel.style.display = on ? '' : 'none';
    tabs.querySelectorAll('.ep-tab').forEach(b => b.classList.toggle('on', b === btn ? on : false));
    if (!on) return;
    if (loaded) return;
    loaded = true;
    panel.innerHTML = '<div class="wk"><div class="wk-prose"><p>Reading the week…</p></div></div>';
    try {
      const rep = await o.load();
      panel.innerHTML = render(rep, { window: o.window });
    } catch (e) {
      loaded = false;
      panel.innerHTML = '<div class="wk"><div class="wk-prose"><p>The week could not be read ' +
        'just now. Try again in a moment.</p></div></div>';
      if (typeof console !== 'undefined') console.warn('[weekly]', e);
    }
  };
  btn.onclick = () => show(true);
  tabs.querySelectorAll('.ep-tab').forEach(b => {
    if (b === btn) return;
    const prev = b.onclick;
    b.onclick = e => { show(false); if (prev) prev.call(b, e); };
  });
  panel.style.display = 'none';
  return { show };
}

return { render, mount, teamWeek, playerWeek, teamRates, playerRates, ledger, prose, phrase,
         TEAM_MEASURES, PLAYER_MEASURES, TEAM_COUNTS, PLAYER_COUNTS, sum };
}));
