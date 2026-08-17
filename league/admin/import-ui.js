'use strict';
/* ============================================================================
   IMPORT A PLAYED GAME — the admin panel.

   A league that has been running for years has its history in somebody else's
   system. This brings it across, into the scorer's own event vocabulary, so an
   imported game and a scored one are the same kind of thing everywhere after.

   The conversion lives in league/livestats.js and is tested on its own. This
   file is the part a person touches, and it follows the same rule as the
   roster importer: NOTHING IS WRITTEN UNTIL THE OPERATOR HAS SEEN WHAT WILL
   HAPPEN. Team names and final score out of the file, counts by event type,
   every player the file mentions that the roster does not, and any starter the
   file could not settle.

   Re-importing is deliberately allowed and deliberately loud. The event log is
   the source of truth for a game, so a second import REPLACES it rather than
   appending — appending would double every stat silently. The panel says how
   many events will be discarded before it does that.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaImportUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('en-GB',
  { day: '2-digit', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };

/* opts: { host, sb, leagueId, games, teams, say, onDone } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const LS = window.EpinoiaLiveStats;
  host.textContent = '';

  let picked = null, payload = null, prepared = null;

  const lead = el('p', 'empty im-lead');
  lead.style.padding = '0 0 12px';
  lead.textContent = 'Choose the fixture this file belongs to, then paste or open the ' +
    'play-by-play JSON. It is converted into the same events the scorer writes, so an ' +
    'imported game behaves exactly like one scored here — box score, profiles, lineups and all.';
  host.appendChild(lead);

  /* ---- 1. the fixture ---- */
  host.appendChild(el('div', 'im-step', '1 — which game'));
  const pick = el('div', 'pick im-pick');
  host.appendChild(pick);

  const games = (opts.games || []).slice().sort((a, b) =>
    new Date(b.tipoff_at || 0) - new Date(a.tipoff_at || 0));
  if (!games.length) {
    pick.appendChild(el('span', 'empty', 'No fixtures in this league yet — schedule one above first.'));
  }
  games.forEach(g => {
    const home = (opts.teams[g.home_team_id] || {}).short_name ||
                 (opts.teams[g.home_team_id] || {}).name || '?';
    const away = (opts.teams[g.away_team_id] || {}).short_name ||
                 (opts.teams[g.away_team_id] || {}).name || '?';
    const b = el('button', 'ep-chip');
    b.type = 'button';
    b.textContent = home + ' v ' + away + '  ' + fmtDate(g.tipoff_at);
    if (g.status === 'final') b.appendChild(el('span', 'im-final', 'final'));
    b.addEventListener('click', () => {
      picked = g;
      pick.querySelectorAll('.ep-chip').forEach(c => c.classList.remove('on'));
      b.classList.add('on');
      opts.say('');
      if (payload) preview();
    });
    pick.appendChild(b);
  });

  /* ---- 2. the file ---- */
  host.appendChild(el('div', 'im-step', '2 — the play-by-play'));
  const ta = el('textarea', 'ep-input im-ta');
  ta.rows = 5;
  ta.placeholder = 'Paste the LiveStats JSON here, or choose a file below';
  ta.spellcheck = false;
  host.appendChild(ta);

  const bar = el('div', 'row im-bar');
  const file = el('input');
  file.type = 'file'; file.accept = '.json,application/json';
  const readBtn = el('button', 'ep-btn', 'Read the file');
  readBtn.type = 'button';
  bar.append(file, readBtn);
  host.appendChild(bar);

  const out = el('div', 'im-out');
  host.appendChild(out);

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    /* a season of play-by-play is a few hundred KB; anything enormous is the
       wrong file and reading it would hang the tab rather than fail usefully */
    if (f.size > 25 * 1024 * 1024) {
      opts.say('That file is ' + Math.round(f.size / 1024 / 1024) + ' MB — too big for one game.', 'err');
      file.value = ''; return;
    }
    const fr = new FileReader();
    fr.onload = () => { ta.value = String(fr.result || ''); preview(); };
    fr.onerror = () => opts.say('Could not read that file.', 'err');
    fr.readAsText(f);
  });
  readBtn.addEventListener('click', preview);

  async function preview() {
    out.textContent = '';
    prepared = null;

    const text = ta.value.trim();
    if (!text) return opts.say('Paste the play-by-play first.', 'warn');
    try { payload = JSON.parse(text); }
    catch (e) { payload = null; return opts.say('That is not valid JSON: ' + e.message, 'err'); }

    const head = LS.describe(payload);
    const card = el('div', 'im-card');
    card.appendChild(el('div', 'im-h', 'the file says'));
    const line = el('div', 'im-teams');
    line.append(el('b', null, head.home || 'team one'),
                el('span', 'im-v', head.scoreHome != null ? head.scoreHome + ' – ' + head.scoreAway : 'v'),
                el('b', null, head.away || 'team two'));
    card.appendChild(line);
    card.appendChild(el('div', 'im-sub', head.events + ' play-by-play events'));
    out.appendChild(card);

    if (!head.events) {
      out.appendChild(el('div', 'im-bad', 'No play-by-play found inside that file.'));
      return;
    }
    if (!picked) {
      out.appendChild(el('div', 'im-warn', 'Now choose which fixture this is, above.'));
      return;
    }

    /* the roster the events are resolved against. A played game freezes its
       own; a fixture that has never been scored has none yet, so one is built
       from the two clubs' current rosters and frozen by this import. */
    let roster = picked.roster_snapshot;
    let built = false;
    if (!roster || !roster.teams || roster.teams.length !== 2) {
      roster = await buildRoster(picked);
      built = true;
      if (!roster) {
        out.appendChild(el('div', 'im-bad',
          'Neither club has a roster yet — add the players first, in the portal or by CSV.'));
        return;
      }
    }

    const conv = LS.convert({ data: payload, roster });
    const st = LS.starters(payload, roster, conv.events);

    /* how many events would be thrown away */
    let had = 0;
    try {
      const { count } = await opts.sb.from('game_events')
        .select('seq', { count: 'exact', head: true }).eq('game_id', picked.id);
      had = count || 0;
    } catch (_) { /* the count is a courtesy; not being able to read it is not fatal */ }

    const c = conv.counts;
    const chips = el('div', 'im-chips');
    const chip = (n, label, cls) => { if (!n) return;
      const d = el('span', 'im-chip ' + (cls || ''));
      d.append(el('b', null, String(n)), document.createTextNode(' ' + label));
      chips.appendChild(d); };
    chip(c.shots, 'field goals', 'ok');
    chip(c.ft, 'free throws', 'ok');
    chip(c.reb, 'rebounds', 'ok');
    chip(c.ast, 'assists', 'ok');
    chip(c.stl, 'steals', 'ok');
    chip(c.blk, 'blocks', 'ok');
    chip(c.to, 'turnovers', 'ok');
    chip(c.foul, 'fouls', 'ok');
    chip(c.sub, 'substitutions', 'ok');
    chip(c.skipped, 'not understood', 'err');
    out.appendChild(chips);
    out.appendChild(el('div', 'im-sub', conv.events.length + ' events will be written'));

    if (built) {
      out.appendChild(el('div', 'im-warn',
        'This fixture had no roster recorded, so one was built from both clubs’ ' +
        'current squads and will be frozen onto the game by this import.'));
    }
    conv.warnings.forEach(w => out.appendChild(el('div', 'im-warn', w)));
    st.notes.forEach(w => out.appendChild(el('div', 'im-warn', w)));

    if (had) {
      out.appendChild(el('div', 'im-warn',
        'This game already has ' + had + ' events. Importing REPLACES them — the log is ' +
        'the source of truth, so adding to it would double every statistic.'));
    }

    prepared = { game: picked, roster, events: conv.events, starters: st.starters, had };

    const go = el('button', 'ep-btn pri',
      had ? 'Replace ' + had + ' events with ' + conv.events.length
          : 'Import ' + conv.events.length + ' events');
    go.type = 'button';
    go.addEventListener('click', () => commit(go));
    const cb = el('div', 'row im-commit');
    cb.appendChild(go);
    out.appendChild(cb);
    opts.say('');
  }

  /* Build a roster_snapshot from the two clubs' current rosters, in the shape
     the engine and the box score expect. */
  async function buildRoster(game) {
    const ids = [game.home_team_id, game.away_team_id];
    const teams = [];
    for (const tid of ids) {
      const { data, error } = await opts.sb.from('roster_entries')
        .select('jersey,players(id,first_name,last_name)')
        .eq('team_id', tid).eq('active', true).order('jersey');
      if (error || !data || !data.length) return null;
      const t = opts.teams[tid] || {};
      teams.push({
        name: (t.name || '').toLowerCase(),
        color: t.colour || '#93f2bf',
        players: data.filter(r => r.players).map(r => ({
          id: r.players.id,
          name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim().toLowerCase(),
          num: r.jersey || ''
        }))
      });
    }
    return { teams };
  }

  async function commit(btn) {
    if (!prepared) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'importing…';

    try {
      const { game, roster, events, starters } = prepared;

      /* 1. the log is replaced, not appended to */
      if (prepared.had) {
        const { error } = await opts.sb.from('game_events').delete().eq('game_id', game.id);
        if (error) throw new Error('Could not clear the existing log: ' + error.message);
      }

      /* 2. freeze the roster and the five who started, before the events land,
            so nothing can read a log it has no roster to interpret */
      const { error: gErr } = await opts.sb.from('games').update({
        roster_snapshot: roster, starters, status: 'live'
      }).eq('id', game.id);
      if (gErr) throw new Error('Could not prepare the game: ' + gErr.message);

      /* 3. the events, in chunks — a whole game is too many rows for one
            request and a partial failure needs to say how far it got */
      const rows = events.map((e, i) => {
        const { t, id, period, clock, team, pid } = e;
        const payload = Object.assign({}, e);
        ['t', 'id', 'period', 'clock', 'team', 'pid'].forEach(k => delete payload[k]);
        return { game_id: game.id, seq: i + 1, t, period,
                 clock: clock == null ? null : clock,
                 team: team == null ? null : team,
                 pid: pid == null ? null : pid,
                 payload };
      });

      let done = 0;
      for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);
        const { error } = await opts.sb.from('game_events').insert(chunk);
        if (error) {
          throw new Error('Wrote ' + done + ' of ' + rows.length +
            ' events, then was refused: ' + error.message +
            '. The game is left open so the import can be run again.');
        }
        done += chunk.length;
        btn.textContent = 'importing… ' + done + '/' + rows.length;
      }

      /* 4. finalise — the same path a scored game takes, so the derived
            tables, standings and season stats are rebuilt by one code path */
      opts.say('Events written. Finalising…', 'ok');
      const fin = await finalise(game.id);
      if (fin) opts.say('Imported ' + rows.length + ' events, and the game is final.', 'ok');
      else opts.say('Imported ' + rows.length + ' events. Finalising did not run — ' +
                    'finalise the game from the scorer to build its box score.', 'warn');

      ta.value = ''; file.value = ''; out.textContent = '';
      payload = null; prepared = null;
      if (opts.onDone) opts.onDone();
    } catch (e) {
      opts.say(e.message || 'That import was refused.', 'err');
      btn.disabled = false; btn.textContent = label;
    }
  }

  /* The finalise Edge Function rebuilds every derived table. It may not be
     deployed on a given project, which is a state worth reporting rather than
     throwing over — the events are safely in either way. */
  async function finalise(gameId) {
    try {
      const { error } = await opts.sb.functions.invoke('finalise-game', { body: { game_id: gameId } });
      return !error;
    } catch (_) { return false; }
  }
}

return { mount };
}));
