'use strict';
/* ============================================================================
   THE KNOCKOUT AND THE TROPHIES.

   Two things a league page needs once a season has a shape beyond one table:
   the bracket, and who won what.

   The bracket is drawn as columns, one per round. The thing a bracket
   communicates that a list cannot is WHO PLAYS THE WINNER — so a tie whose
   sides are not settled shows the tie it is waiting on rather than an empty
   box, and a reader can trace a path through the rounds before any of it has
   been played. That is most of the point of publishing a bracket early.

   The awards come from the same season table the Leaders tab reads, so the two
   cannot disagree, and each card carries the appearance gate it was decided
   under — an award with a hidden minimum is an award nobody can check.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideBracket = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* --------------------------------------------------------------- bracket --- */
async function renderBracket(opts) {
  const pane = document.querySelector(opts.host);
  if (!pane) return;
  pane.textContent = '';
  const api_ = opts.api, comp = opts.comp;

  let ties = [];
  try {
    ties = await api_('bracket_ties?competition_id=eq.' + comp.id +
      '&select=id,round,slot,label,home_seed,away_seed,home_agg,away_agg,winner_team_id,' +
      'home_from_tie,away_from_tie,' +
      'home:home_team_id(id,name,short_name,colour,slug),' +
      'away:away_team_id(id,name,short_name,colour,slug)' +
      '&order=round.asc,slot.asc');
  } catch (e) {
    pane.appendChild(el('div', 'empty', 'Could not load the bracket: ' + e.message));
    return;
  }
  if (!ties.length) {
    pane.appendChild(el('div', 'empty',
      'No knockout stage in this competition. One appears here once the league ' +
      'seeds a bracket from the table.'));
    return;
  }

  /* which games belong to which tie, so a card can link to its box score */
  const gamesByTie = {};
  try {
    const gs = await api_('games?competition_id=eq.' + comp.id + '&tie_id=not.is.null' +
      '&select=id,tie_id,status,home_score,away_score,tipoff_at&order=tipoff_at');
    gs.forEach(g => { (gamesByTie[g.tie_id] = gamesByTie[g.tie_id] || []).push(g); });
  } catch (_) { /* the links are a courtesy; the bracket stands without them */ }

  const rounds = new Map();
  ties.forEach(t => {
    if (!rounds.has(t.round)) rounds.set(t.round, []);
    rounds.get(t.round).push(t);
  });
  const byId = new Map(ties.map(t => [t.id, t]));

  const board = el('div', 'bracket');
  [...rounds.keys()].sort((a, b) => a - b).forEach(r => {
    const col = el('div', 'brcol');
    col.appendChild(el('div', 'brlabel', rounds.get(r)[0].label || ('Round ' + r)));
    rounds.get(r).forEach(t => col.appendChild(tieCard(t, byId, gamesByTie)));
    board.appendChild(col);
  });
  pane.appendChild(board);
}

function tieCard(t, byId, gamesByTie) {
  const card = el('div', 'brtie');

  const side = (team, seed, agg, fromTie) => {
    const isWinner = !!(t.winner_team_id && team && team.id === t.winner_team_id);
    const row = el('div', 'brside' + (isWinner ? ' win' : ''));
    const dot = el('span', 'brdot');
    dot.style.background = (team && team.colour) || 'var(--rule-2)';
    row.appendChild(dot);

    if (team) {
      const a = el('a', 'brname', team.name || '');
      a.href = '../t/?t=' + encodeURIComponent(team.slug || '');
      row.appendChild(a);
      if (seed != null) row.appendChild(el('span', 'brseed', String(seed)));
    } else {
      /* undecided: say what it is waiting for rather than showing nothing */
      const src = fromTie ? byId.get(fromTie) : null;
      row.appendChild(el('span', 'brname pend',
        src ? 'winner of ' + (src.label || 'round ' + src.round) + ' ' + (src.slot + 1)
            : 'to be decided'));
    }
    row.appendChild(el('span', 'bragg', agg == null ? '' : String(agg)));
    return row;
  };

  card.append(side(t.home, t.home_seed, t.home_agg, t.home_from_tie),
              side(t.away, t.away_seed, t.away_agg, t.away_from_tie));

  const legs = gamesByTie[t.id] || [];
  if (legs.length) {
    const foot = el('div', 'brfoot');
    legs.forEach((g, i) => {
      const a = el('a', 'brleg', legs.length > 1 ? 'leg ' + (i + 1) : 'box score');
      a.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
      foot.appendChild(a);
    });
    card.appendChild(foot);
  } else if (t.home && t.away) {
    card.appendChild(el('div', 'brfoot pend', 'not played yet'));
  } else if (t.home_agg == null && t.away_agg == null) {
    /* a level aggregate stays undecided rather than being coin-tossed, and a
       reader should be told that rather than left wondering */
    if (t.home && t.away && t.home_agg != null && t.home_agg === t.away_agg) {
      card.appendChild(el('div', 'brfoot pend', 'level — undecided'));
    }
  }
  return card;
}

/* ---------------------------------------------------------------- awards --- */
const AWARD_NAMES = {
  mvp: 'Most valuable player', scorer: 'Leading scorer',
  rebounder: 'Leading rebounder', playmaker: 'Leading playmaker',
  defender: 'Defensive player', marksman: 'Best from three',
  best_offence: 'Best offence', best_defence: 'Best defence'
};
const AWARD_ORDER = ['mvp', 'scorer', 'rebounder', 'playmaker', 'defender',
                     'marksman', 'best_offence', 'best_defence'];

async function renderAwards(opts) {
  const host = document.querySelector(opts.host);
  if (!host) return;
  host.textContent = '';
  let rows = [];
  try {
    rows = await opts.api('season_awards?competition_id=eq.' + opts.comp.id +
      '&select=code,value,detail,players(first_name,last_name,slug),' +
      'teams(name,short_name,colour,slug)');
  } catch (_) { host.style.display = 'none'; return; }
  if (!rows.length) { host.style.display = 'none'; return; }
  host.style.display = '';

  host.appendChild(el('div', 'grouphead', 'Season awards'));
  const grid = el('div', 'awgrid');
  rows.slice().sort((a, b) => AWARD_ORDER.indexOf(a.code) - AWARD_ORDER.indexOf(b.code))
    .forEach(r => {
      const card = el('div', 'awcard');
      card.appendChild(el('div', 'awtitle', AWARD_NAMES[r.code] || r.code));
      const p = r.players, t = r.teams;
      const who = el('div', 'awwho');
      if (p) {
        const a = el('a', null, ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
        a.href = '../p/?p=' + encodeURIComponent(p.slug || '');
        who.appendChild(a);
        if (t) who.appendChild(el('span', 'awteam', t.short_name || t.name || ''));
      } else if (t) {
        const a = el('a', null, t.name || '');
        a.href = '../t/?t=' + encodeURIComponent(t.slug || '');
        who.appendChild(a);
      }
      card.appendChild(who);
      /* A plus/minus figure without its sign is a different number. "+7.4" and
         "7.4" read the same on a card and mean the same thing only by luck —
         and a negative one, which happens in a weak field, would be flatly
         wrong without it. Everything else is a count and takes no sign. */
      const signed = /plus\/minus/.test(r.detail || '') && Number(r.value) > 0;
      card.appendChild(el('div', 'awval',
        r.value == null ? '' : (signed ? '+' : '') + String(r.value)));
      card.appendChild(el('div', 'awdet', r.detail || ''));
      grid.appendChild(card);
    });
  host.appendChild(grid);
}

return { renderBracket, renderAwards };
}));
