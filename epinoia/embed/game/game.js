'use strict';
/* ============================================================================
   The single-game embed — the scoreboard, not the whole box score.

   What a LiveStats card carries and this carries too: who is playing, the
   score, the period and clock, when and where, and the quarter breakdown.

   Deliberately NOT the full box score. An embed sits inside someone's article,
   and a twenty-column table is a link, not an inline widget — so the detail is
   one line (top scorer each side) and "full box score" is the way through.

   Live without credentials, exactly like the public page: the scorer's
   broadcast accepts anonymous subscribers and carries a whole-game snapshot on
   a slow beat, so this fills in whether or not the reader arrived at tip-off.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const E = window.EpinoiaEngine, L = window.EpinoiaLive;
const qp = new URLSearchParams(location.search);
const gameId = qp.get('g') || '';

/* ?theme=light for club sites that are not dark. One attribute, because the
   palette is a variable set rather than a second stylesheet. */
if ((new URLSearchParams(location.search).get('theme') || '') === 'light') {
  document.body.setAttribute('data-theme', 'light');
}

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const abbr = t => ((t && (t.short_name || t.name)) || '???')
  .replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 3).toUpperCase();

let game = null, S = null, sub = null;

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

const rowToEvent = r => {
  const e = Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock }, r.payload || {});
  if (r.team != null) e.team = r.team;
  if (r.pid != null) e.pid = r.pid;
  return e;
};

/* the host page cannot know how tall this wants to be */
function postHeight() {
  try {
    parent.postMessage({ epinoiaEmbed: 'height', height: document.body.scrollHeight }, '*');
  } catch (_) {}
}

function fail(msg) {
  $('#host').textContent = '';
  $('#host').appendChild(el('div', 'ep-empty', msg));
  postHeight();
}

function render() {
  if (!game) return;
  const live = game.status === 'live', final = game.status === 'final';
  const d = (S && S.events.length) ? E.deriveGame(S) : null;
  const hs = d ? d.score[0] : (game.home_score || 0);
  const as = d ? d.score[1] : (game.away_score || 0);

  const host = $('#host'); host.textContent = '';
  const wrap = el('div', 'ep-game');

  /* competition, then when and where — the two things a card must state */
  const top = el('div', 'top');
  top.appendChild(el('span', null, (game.competitions && game.competitions.name) || 'Fixture'));
  const when = game.tipoff_at
    ? new Date(game.tipoff_at).toLocaleDateString('en-GB',
        { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' +
      new Date(game.tipoff_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : 'date TBC';
  top.appendChild(el('span', null, [when, game.venue].filter(Boolean).join(' · ')));
  wrap.appendChild(top);

  const board = el('div', 'board');
  const side = (t, sc, other, away) => {
    const box = el('div', 'tm' + (away ? ' away' : ''));
    const cr = el('span', 'crest', abbr(t).slice(0, 2));
    cr.style.background = (t && t.colour) || '#93f2bf';
    const holder = el('div');
    /* a class, not an inline colour: the light theme has to be able to
       restyle the winner, and an inline value is unreachable from CSS */
    const n = el('div', 'nm' + (final ? (sc > other ? ' win' : sc < other ? ' lose' : '') : ''),
                 (t && t.name) || '—');
    holder.appendChild(n);
    box.append(cr, holder);
    return box;
  };
  board.appendChild(side(game.home, hs, as, false));

  const mid = el('div', 'mid');
  const sc = el('div', 'score');
  sc.append(el('span', null, String(hs)), el('span', 'sep', '·'), el('span', null, String(as)));
  mid.appendChild(sc);
  const clk = el('div', 'clk' + (live ? ' live' : ''));
  clk.textContent = final ? 'final'
    : live ? E.perName(S ? S.period : 1).toUpperCase() + ' · ' +
             E.fmtClock(sub && sub.state ? sub.clockMs() : (S ? S.clockMs : 0))
    : 'scheduled';
  mid.appendChild(clk);
  board.appendChild(mid);
  board.appendChild(side(game.away, as, hs, true));
  wrap.appendChild(board);

  if (d) {
    /* the quarter strip: the shape of the game in one line */
    const maxP = Math.max(4, ...Object.keys(d.perQ[0]).map(Number),
                             ...Object.keys(d.perQ[1]).map(Number), 1);
    const qs = el('div', 'qs');
    for (let p = 1; p <= maxP; p++) {
      const c = el('div');
      c.append(el('div', 'ql', E.perName(p).toUpperCase()),
               el('div', 'qv', String(d.perQ[0][p] || 0)),
               el('div', 'qv', String(d.perQ[1][p] || 0)));
      qs.appendChild(c);
    }
    const tot = el('div');
    tot.append(el('div', 'ql', 'TOT'), el('div', 'qv', String(hs)), el('div', 'qv', String(as)));
    qs.appendChild(tot);
    wrap.appendChild(qs);

    /* top scorer each side — as much detail as a card should carry */
    const lead = el('div', 'lead');
    [0, 1].forEach(t => {
      const players = (S.teams[t] && S.teams[t].players) || [];
      let best = null;
      players.forEach(p => {
        const st = d.stats[p.id];
        if (st && (!best || st.pts > best.pts)) best = { name: p.name, pts: st.pts };
      });
      if (best && best.pts > 0) {
        const line = el('span');
        line.append(document.createTextNode(abbr(t ? game.away : game.home) + ' '),
                    el('b', null, best.name + ' ' + best.pts));
        lead.appendChild(line);
      }
    });
    if (lead.children.length) wrap.appendChild(lead);
  }

  host.appendChild(wrap);
  $('#full').href = new URL('../../game/?g=' + encodeURIComponent(gameId) + '&mode=supabase',
                            location.href).href;
  postHeight();
}

function merge(g, events, removed, full) {
  if (!S) return;
  if (g) {
    if (g.teams) S.teams = g.teams;
    if (g.starters) S.starters = g.starters;
    if (g.period != null) S.period = g.period;
    if (g.status) { S.status = g.status; game.status = g.status; }
  }
  /* retractions first — an edit can reuse an id, so dropping the old ones
     after adding the new would delete what just arrived */
  if (removed && removed.length) {
    const gone = new Set(removed);
    S.events = S.events.filter(e => !gone.has(e.id));
  }
  /* a FULL frame is the whole log and replaces what we hold — merging can
     never undo anything, so this is what makes a viewer self-heal */
  if (full && events) {
    S.events = events.map(e => {
      const ev = Object.assign({}, e);
      if (ev.seq != null && ev.id == null) ev.id = ev.seq;
      return ev;
    }).sort((a, b) => a.id - b.id);
    return;
  }
  if (events && events.length) {
    const seen = new Set(S.events.map(e => e.id));
    events.forEach(e => {
      const ev = Object.assign({}, e);
      if (ev.seq != null && ev.id == null) ev.id = ev.seq;
      if (!seen.has(ev.id)) { seen.add(ev.id); S.events.push(ev); }
    });
    S.events.sort((a, b) => a.id - b.id);
  }
  if (sub && sub.state) S.clockMs = sub.clockMs();
}

(async function boot() {
  if (!gameId) return fail('No game specified');
  try {
    const gs = await api(`games?id=eq.${encodeURIComponent(gameId)}` +
      `&select=id,status,period,tipoff_at,venue,home_score,away_score,roster_snapshot,starters,` +
      `tip_winner,arrow_init,home:home_team_id(name,short_name,colour),` +
      `away:away_team_id(name,short_name,colour),competitions(name)&limit=1`);
    if (!gs.length) return fail('Game not found');
    game = gs[0];

    let rows = [];
    try {
      rows = await api(`game_events?game_id=eq.${encodeURIComponent(gameId)}` +
        `&select=seq,t,team,pid,period,clock,payload&order=seq&limit=1000`);
    } catch (_) { /* a live game with nothing written yet is normal */ }

    const snap = game.roster_snapshot;
    S = {
      teams: (snap && snap.teams) || [
        { name: (game.home || {}).name || 'home', color: (game.home || {}).colour, players: [] },
        { name: (game.away || {}).name || 'away', color: (game.away || {}).colour, players: [] }],
      starters: game.starters || [[], []],
      events: rows.map(rowToEvent),
      period: game.period || 1, clockMs: 0,
      tipWinner: game.tip_winner, arrowInit: game.arrow_init,
      phase: game.status === 'final' ? 'final' : 'game'
    };
    render();

    if (game.status !== 'final') {
      sub = L.subscriber({
        gameId, mode: 'supabase',
        supabase: window.epinoiaClient ? epinoiaClient() : null,
        onSnapshot(s) { merge(s.game, s.events, s.removed); render(); },
        onFrame(f) { merge(f.game, f.events, f.removed, f.full); render(); },
        onStatus() {}
      });
      /* The clock ticks locally, as everywhere — but only while somebody can
         see it. An embed in a background tab redrawing a clock once a second
         for an hour is a phone getting warm for nothing. */
      setInterval(() => { if (!document.hidden) render(); }, 1000);
    }
  } catch (e) {
    fail('Could not load this game');
  }
})();
