'use strict';
/* ============================================================================
   GENERATE A FIXTURE LIST.

   The scheduling lives in schedule.js and is tested on its own. This is the
   part a league secretary touches, and it follows the rule the other bulk
   tools follow: NOTHING IS WRITTEN UNTIL THE WHOLE THING HAS BEEN SEEN.

   A fixture list is the one artefact a league publishes that everybody plans
   around, so the preview shows the season round by round AND the home/away
   split it produced — the generator balances greedily rather than optimally,
   and an imbalance you can see before you commit is a decision, while one you
   find in March is a complaint.

   Generating twice is guarded rather than forbidden. A secretary who gets the
   start date wrong should be able to fix it, but doing so must not silently
   duplicate a season, and must never touch a game that has already been
   played.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideFixtureGen = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const dt = iso => { try { return new Date(iso).toLocaleDateString('en-GB',
  { weekday: 'short', day: '2-digit', month: 'short' }); } catch (_) { return ''; } };
const tm = iso => { try { return new Date(iso).toLocaleTimeString('en-GB',
  { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

/* opts: { host, sb, comp, entered, teams, existing, say, onDone } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const S = window.CourtsideSchedule;
  host.textContent = '';
  let plan = null;

  if (!opts.comp) {
    host.appendChild(el('div', 'empty', 'Pick a competition first.'));
    return;
  }
  const entered = opts.entered || [];
  if (entered.length < 2) {
    host.appendChild(el('div', 'empty',
      'At least two teams have to be entered in this competition before a ' +
      'fixture list can be generated.'));
    return;
  }

  const named = id => ((opts.teams || {})[id] || {}).name || '—';

  host.appendChild(el('div', 'empty',
    entered.length + ' teams entered. Everybody plays everybody; teams in ' +
    'different groups are scheduled separately, so a competition with groups ' +
    'becomes several small round-robins running in parallel.'));

  /* ---- the knobs ---- */
  const r1 = el('div', 'row');
  const mkField = (label, node) => {
    const w = el('label', 'f');
    w.appendChild(el('span', null, label));
    w.appendChild(node);
    return w;
  };
  const start = el('input', 'cs-input'); start.type = 'date';
  start.value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const gap = el('input', 'cs-input'); gap.type = 'number';
  gap.min = '1'; gap.max = '60'; gap.value = '7';
  const times = el('input', 'cs-input');
  times.value = '19:30, 21:30';
  times.placeholder = '19:30, 21:30';
  const legs = el('select', 'cs-input');
  [['single', 'once — everybody plays everybody'],
   ['double', 'twice — home and away']].forEach(([v, l]) => {
    const o = el('option', null, l); o.value = v; legs.appendChild(o);
  });
  r1.append(mkField('First round', start), mkField('Days between rounds', gap));
  host.appendChild(r1);
  const r2 = el('div', 'row');
  r2.append(mkField('Kick-off times, in order', times), mkField('Each pair meets', legs));
  host.appendChild(r2);

  const bar = el('div', 'row');
  const prev = el('button', 'cs-btn', 'Preview the season');
  prev.type = 'button';
  bar.appendChild(prev);
  host.appendChild(bar);

  const out = el('div', 'fg-out');
  host.appendChild(out);

  prev.addEventListener('click', preview);

  function preview() {
    out.textContent = '';
    const everyDays = Math.max(1, parseInt(gap.value, 10) || 7);
    const slots = times.value.split(',').map(s => s.trim())
      .filter(s => /^\d{1,2}:\d{2}$/.test(s));
    if (!slots.length) {
      opts.say('Give at least one kick-off time, as HH:MM.', 'warn');
      return;
    }

    const rounds = S.forCompetition(entered, { double: legs.value === 'double' });
    const fixtures = S.withDates(rounds, { start: start.value, everyDays, times: slots });
    if (!fixtures.length) {
      out.appendChild(el('div', 'empty', 'That produced no fixtures.'));
      return;
    }
    plan = fixtures;

    /* ---- what already exists, so a second run is not a silent duplicate ---- */
    const existing = opts.existing || [];
    const played = existing.filter(g => g.status === 'final' || g.status === 'live');

    const chips = el('div', 'fg-chips');
    const chip = (n, label, cls) => { if (!n) return;
      const d = el('span', 'fg-chip ' + (cls || ''));
      d.append(el('b', null, String(n)), document.createTextNode(' ' + label));
      chips.appendChild(d); };
    chip(fixtures.length, 'fixtures', 'ok');
    chip(rounds.length, 'rounds', 'ok');
    chip(existing.length, 'already scheduled', existing.length ? 'warn' : '');
    chip(played.length, 'already played', played.length ? 'err' : '');
    out.appendChild(chips);

    if (played.length) {
      out.appendChild(el('div', 'fg-bad',
        played.length + ' of the existing fixtures ' +
        (played.length === 1 ? 'has' : 'have') + ' been played. Those are never ' +
        'touched — generating will replace only the fixtures that have not started.'));
    } else if (existing.length) {
      out.appendChild(el('div', 'fg-warn',
        'This competition already has ' + existing.length + ' scheduled ' +
        (existing.length === 1 ? 'fixture' : 'fixtures') +
        '. Generating replaces them.'));
    }

    /* ---- the home/away split, before anybody commits to it ---- */
    const bal = S.balance(fixtures);
    const worst = Math.max(...bal.map(b => Math.abs(b.diff)));
    const bh = el('div', 'fg-h', 'Home and away');
    out.appendChild(bh);
    const bgrid = el('div', 'fg-bal');
    bal.sort((a, b) => named(a.team_id).localeCompare(named(b.team_id)))
      .forEach(b => {
        const c = el('div', 'fg-balcell' + (Math.abs(b.diff) > 1 ? ' off' : ''));
        c.appendChild(el('span', 'fg-balname', named(b.team_id)));
        c.appendChild(el('span', 'fg-balnum', b.home + ' H / ' + b.away + ' A'));
        bgrid.appendChild(c);
      });
    out.appendChild(bgrid);
    out.appendChild(el('div', 'empty',
      worst <= 1
        ? 'Every team is within one game of an even split, which is the best ' +
          'possible when each plays an odd number of games.'
        : 'The widest gap is ' + worst + ' games. Switching to home and away ' +
          'evens this out exactly.'));

    /* ---- the season itself ---- */
    out.appendChild(el('div', 'fg-h', 'The season'));
    const wrap = el('div', 'fg-rounds');
    const byRound = new Map();
    fixtures.forEach(f => {
      if (!byRound.has(f.round)) byRound.set(f.round, []);
      byRound.get(f.round).push(f);
    });
    byRound.forEach((games, n) => {
      const r = el('div', 'fg-round');
      r.appendChild(el('div', 'fg-rnum',
        'Round ' + n + ' · ' + dt(games[0].tipoff_at)));
      games.forEach(g => {
        const line = el('div', 'fg-game');
        if (g.group) line.appendChild(el('span', 'fg-grp', g.group));
        line.appendChild(el('span', 'fg-home', named(g.home)));
        line.appendChild(el('span', 'fg-v', 'v'));
        line.appendChild(el('span', 'fg-away', named(g.away)));
        line.appendChild(el('span', 'fg-time', tm(g.tipoff_at)));
        r.appendChild(line);
      });
      wrap.appendChild(r);
    });
    out.appendChild(wrap);

    const go = el('button', 'cs-btn pri', 'Create ' + fixtures.length + ' fixtures');
    go.type = 'button';
    go.addEventListener('click', () => commit(go, played));
    const cb = el('div', 'row');
    cb.appendChild(go);
    out.appendChild(cb);
    opts.say('');
  }

  async function commit(btn, played) {
    if (!plan) return;
    const existing = opts.existing || [];
    const removable = existing.filter(g => g.status !== 'final' && g.status !== 'live');

    let msg = 'Create ' + plan.length + ' fixtures?';
    if (removable.length) msg += '\n\n' + removable.length + ' unplayed fixture' +
      (removable.length === 1 ? '' : 's') + ' will be replaced.';
    if (played.length) msg += '\n' + played.length + ' played game' +
      (played.length === 1 ? '' : 's') + ' will be left alone.';
    if (!confirm(msg)) return;

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'creating…';
    try {
      /* Clear only what has not started. A played game is a record of
         something that happened and is never collateral in a re-generation. */
      if (removable.length) {
        const { error } = await opts.sb.from('games').delete()
          .in('id', removable.map(g => g.id));
        if (error) throw new Error('Could not clear the old fixtures: ' + error.message);
      }

      const rows = plan.map(f => ({
        competition_id: opts.comp.id,
        home_team_id: f.home, away_team_id: f.away,
        tipoff_at: f.tipoff_at, status: 'scheduled'
      }));
      /* chunked: a 20-team double round-robin is 380 rows, which is more than
         one request should carry, and a partial failure needs to say how far
         it got rather than leaving a half season behind silently */
      let done = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await opts.sb.from('games').insert(chunk);
        if (error) {
          throw new Error('Created ' + done + ' of ' + rows.length +
            ' fixtures, then was refused: ' + error.message);
        }
        done += chunk.length;
        btn.textContent = 'creating… ' + done + '/' + rows.length;
      }

      opts.say(rows.length + ' fixtures created.', 'ok');
      plan = null; out.textContent = '';
      if (opts.onDone) opts.onDone();
    } catch (e) {
      opts.say(e.message || 'That was refused.', 'err');
      btn.disabled = false; btn.textContent = label;
    }
  }
}

return { mount };
}));
