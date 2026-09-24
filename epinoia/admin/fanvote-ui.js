'use strict';
/* ============================================================================
   FANS' VOTE — every tally, for the league's own admins (migration 0150).

   What the league page shows is the winners; this is the count behind them.
   Per week: how many voted (and how many of those were signed in), every player
   on the ballot with their 1sts, 2nds, 3rds and points, and every club with its
   votes. Per season: the same summed, and how many weeks each one won.

   Read through fanvote_admin, which refuses anybody who does not administer the
   league. Nothing here can change a vote: a ballot is the fan's.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFanVoteUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

function weekLabel(a, b) {
  const FV = window.EpinoiaFanVote;
  if (FV && FV.weekLabel) return FV.weekLabel(a, b);
  try { return new Date(a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (_) { return ''; }
}

/* a plain table: headers, rows of cells; the first column left-aligned */
function table(heads, rows) {
  const wrap = el('div'); wrap.style.cssText = 'overflow-x:auto;margin:6px 0 14px';
  const t = el('table', 'ep-tbl');
  t.style.minWidth = '0';
  const th = el('thead'); const hr = el('tr');
  heads.forEach((h, i) => { const c = el('th', null, h); if (!i) c.style.textAlign = 'left'; hr.appendChild(c); });
  th.appendChild(hr); t.appendChild(th);
  const tb = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    r.forEach((v, i) => { const c = el('td', null, v == null ? '' : String(v)); if (!i) c.style.textAlign = 'left'; tr.appendChild(c); });
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const league = typeof o.league === 'function' ? o.league() : o.league;
  host.textContent = '';

  host.appendChild(el('p', 'empty',
    'Every week the league plays, its front page asks the fans who was the best player ' +
    '(1st, 2nd, 3rd: three points, two, one) and which club had the best performance. ' +
    'The ballot is the week’s fifteen best players by BPM and every club that won. Voting opens ' +
    'the Monday after and closes that Thursday night; the winners go up above the Stars. ' +
    'Anybody may vote, once per browser or per account, so a determined fan can vote ' +
    'twice from two browsers: the “from accounts” count is the harder figure. ' +
    'To turn the vote off, untick Fans’ vote under Appearance.'));

  const bar = el('div', 'row');
  const seasonSel = el('select', 'ep-input');
  seasonSel.setAttribute('aria-label', 'Season');
  const refresh = el('button', 'ep-chip', 'refresh'); refresh.type = 'button';
  bar.append(seasonSel, refresh);
  host.appendChild(bar);
  const out = el('div');
  host.appendChild(out);

  async function load(season) {
    out.textContent = '';
    out.appendChild(el('div', 'empty', 'Loading…'));
    const { data, error } = await o.sb.rpc('fanvote_admin', { p_league: league.id, p_season: season || null });
    out.textContent = '';
    if (error) {
      /* a database without 0150 */
      out.appendChild(el('div', 'empty', /fanvote_admin/.test(error.message || '')
        ? 'The fans’ vote is not on this database yet (migration 0150).'
        : 'Could not read the votes: ' + error.message));
      return;
    }
    const d = data || {};
    seasonSel.textContent = '';
    (d.seasons && d.seasons.length ? d.seasons : [d.season]).forEach(s => {
      const op = el('option', null, s); op.value = s; if (s === d.season) op.selected = true;
      seasonSel.appendChild(op);
    });
    const rounds = d.rounds || [];
    if (!rounds.length) {
      out.appendChild(el('div', 'empty',
        'No vote yet this season. The first opens the Monday after the league finishes a game, ' +
        'the first time somebody opens the league’s page.'));
      return;
    }

    out.appendChild(el('div', 'fmt-h', 'The season: ' + d.season));
    const ps = (d.players || []).filter(p => p.points > 0 || p.weekly_wins > 0);
    if (ps.length) {
      out.appendChild(table(['Player', 'Weeks won', 'Points', '1st', '2nd', '3rd', 'On the ballot'],
        ps.map(p => [p.name || '(a player no longer listed)', p.weekly_wins, p.points, p.firsts, p.seconds, p.thirds,
                     p.rounds + (p.rounds === 1 ? ' week' : ' weeks')])));
    }
    const ts = (d.teams || []).filter(t => t.votes > 0 || t.weekly_wins > 0);
    if (ts.length) {
      out.appendChild(table(['Club', 'Weeks won', 'Votes', 'On the ballot'],
        ts.map(t => [t.name || '(a club no longer listed)', t.weekly_wins, t.votes,
                     t.rounds + (t.rounds === 1 ? ' week' : ' weeks')])));
    }

    out.appendChild(el('div', 'fmt-h', 'Week by week'));
    rounds.forEach((r, i) => {
      const det = el('details', 'ep-acc');
      if (i === 0) det.open = true;
      const sum = el('summary');
      sum.textContent = 'The week of ' + weekLabel(r.starts_at, r.ends_at) + ' · ' + r.status +
        ' · ' + r.ballots + (r.ballots === 1 ? ' ballot' : ' ballots') +
        ' (' + r.accounts + ' from accounts)';
      det.appendChild(sum);
      const players = r.players || [];
      if (players.length) {
        det.appendChild(table(['Player', 'Club', 'BPM rank', '1st', '2nd', '3rd', 'Points'],
          players.map(p => [p.name || '(a player no longer listed)', p.team || '', p.rank, p.firsts, p.seconds, p.thirds, p.points])));
      }
      const teams = r.teams || [];
      if (teams.length) {
        det.appendChild(table(['Club', 'Votes'], teams.map(t => [t.name || '(a club no longer listed)', t.votes])));
        const skip = el('p', 'ep-micro', r.skipped + (r.skipped === 1 ? ' voter' : ' voters') + ' skipped the club vote.');
        skip.style.color = 'var(--ink-3)';
        det.appendChild(skip);
      }
      out.appendChild(det);
    });
  }

  seasonSel.addEventListener('change', () => load(seasonSel.value));
  refresh.addEventListener('click', () => load(seasonSel.value));
  load(null).catch(e => { out.textContent = ''; out.appendChild(el('div', 'empty', 'Could not read the votes: ' + e.message)); });
}

return { mount };
}));
