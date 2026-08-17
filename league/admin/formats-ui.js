'use strict';
/* ============================================================================
   COMPETITION FORMAT — groups, and seeding a knockout.

   Two controls a league needs once a season is more than one table.

   GROUPS are assigned per team per competition, so the same club can be in
   Group A of the league and ungrouped in the cup. Typing a group name into a
   box beside each team is deliberately plain: the alternative is a drag-and-
   drop board, which is more fun to build and slower to use when you have
   sixteen teams and a fixture list to get out.

   SEEDING refuses anything but a power of two. A bracket that is not is a
   bracket with byes, and who gets a bye is a decision with consequences that
   should be made by a person on purpose rather than by a function quietly.

   Both write through SECURITY DEFINER functions, so what a league admin can do
   is decided by the database rather than by which buttons this file draws.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFormats = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* opts: { host, sb, comp, comps, teams, entered, say, onDone } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  host.textContent = '';

  if (!opts.comp) {
    host.appendChild(el('div', 'empty', 'Pick a competition above to set its format.'));
    return;
  }

  /* ---- what kind of thing this is ----
     The public page reads `kind` to decide where a competition belongs: league
     and playoff are STAGES of the same season and share the Table tab, while a
     cup runs alongside and gets its own. Getting this wrong puts a cup's
     bracket where a reader expects the league table, so it is editable rather
     than fixed at creation. */
  const kRow = el('div', 'row');
  kRow.appendChild(el('span', 'ep-micro', 'This is a'));
  const kSel = el('select', 'ep-input');
  kSel.style.flex = '0 0 auto';
  [['league', 'league phase — shares the Table tab'],
   ['playoff', 'playoff phase — shares the Table tab'],
   ['cup', 'cup — gets its own tab']]
    .forEach(([v, label]) => { const o = el('option', null, label); o.value = v; kSel.appendChild(o); });
  kSel.value = opts.comp.kind || 'league';
  const kSave = el('button', 'ep-btn mini', 'save');
  kSave.type = 'button';
  kSave.addEventListener('click', async () => {
    const { error } = await opts.sb.from('competitions')
      .update({ kind: kSel.value }).eq('id', opts.comp.id);
    if (error) return opts.say(error.message, 'err');
    opts.comp.kind = kSel.value;
    opts.say(kSel.value === 'cup'
      ? 'Saved — this now appears under the Cup tab.'
      : 'Saved — this now appears as a phase on the Table tab.', 'ok');
    if (opts.onDone) opts.onDone();
  });
  kRow.append(kSel, kSave);
  host.appendChild(kRow);

  /* ---- format ---- */
  const fRow = el('div', 'row');
  fRow.appendChild(el('span', 'ep-micro', 'Format'));
  const fSel = el('select', 'ep-input');
  fSel.style.flex = '0 0 auto';
  [['table', 'one table'], ['groups', 'groups'],
   ['knockout', 'knockout'], ['groups_knockout', 'groups then knockout']]
    .forEach(([v, label]) => {
      const o = el('option', null, label); o.value = v; fSel.appendChild(o);
    });
  fSel.value = opts.comp.format || 'table';
  const fSave = el('button', 'ep-btn mini', 'save');
  fSave.type = 'button';
  fSave.addEventListener('click', async () => {
    const { error } = await opts.sb.from('competitions')
      .update({ format: fSel.value }).eq('id', opts.comp.id);
    if (error) return opts.say(error.message, 'err');
    opts.comp.format = fSel.value;
    opts.say('Format saved.', 'ok');
    if (opts.onDone) opts.onDone();
  });
  fRow.append(fSel, fSave);
  host.appendChild(fRow);

  /* ---- groups ---- */
  const entered = (opts.entered || []);
  if (!entered.length) {
    host.appendChild(el('div', 'empty',
      'No teams are entered in this competition yet — enter them above and their ' +
      'groups can be set here.'));
  } else {
    host.appendChild(el('div', 'fmt-h', 'Groups'));
    host.appendChild(el('div', 'empty',
      'Leave a group blank for a single table. A team’s group belongs to this ' +
      'competition only, so the same club can be in Group A here and ungrouped in the cup.'));

    const grid = el('div', 'fmt-grid');
    const inputs = new Map();
    entered.forEach(row => {
      const t = (opts.teams || {})[row.team_id] || {};
      const cell = el('div', 'fmt-cell');
      cell.appendChild(el('span', 'fmt-name', t.name || '—'));
      const inp = el('input', 'ep-input fmt-in');
      inp.value = row.group_name || '';
      inp.maxLength = 12;
      inp.placeholder = '—';
      inputs.set(row.team_id, inp);
      cell.appendChild(inp);
      grid.appendChild(cell);
    });
    host.appendChild(grid);

    const gSave = el('button', 'ep-btn', 'save groups');
    gSave.type = 'button';
    gSave.addEventListener('click', async () => {
      gSave.disabled = true;
      try {
        for (const [teamId, inp] of inputs) {
          const v = inp.value.trim();
          const { error } = await opts.sb.from('competition_teams')
            .update({ group_name: v || null })
            .eq('competition_id', opts.comp.id).eq('team_id', teamId);
          if (error) throw error;
        }
        /* the table is grouped by the standings, so it has to be rebuilt for
           the change to show up anywhere */
        const { error } = await opts.sb.rpc('recompute_standings',
          { p_competition: opts.comp.id });
        if (error) throw new Error('Groups saved, but the table could not be rebuilt: ' + error.message);
        opts.say('Groups saved and the table rebuilt.', 'ok');
        if (opts.onDone) opts.onDone();
      } catch (e) {
        opts.say(e.message || 'That was refused.', 'err');
      } finally { gSave.disabled = false; }
    });
    host.appendChild(el('div', 'row')).appendChild(gSave);
  }

  /* ---- design a bracket -------------------------------------------------
     Replaces the old "pick a power of two and press seed". A real post-season
     is a SHAPE and a set of SERIES LENGTHS, and both are decisions a league
     makes once and then wants written down: 1 & 2 bye and 3-6 play in, semis
     best of three, final over two legs on aggregate.

     The two arithmetic conditions are checked HERE as well as in the database,
     not because the database needs help but because a designer that only says
     no after you press the button is a designer you fight. The message is the
     same either way; this one just arrives while you are still typing. */
  host.appendChild(el('div', 'fmt-h', 'Knockout'));
  host.appendChild(el('div', 'empty',
    'The bracket is built in one go and fills itself in as results arrive - ' +
    'nothing here has to be revisited between rounds. Seeding is standard: ' +
    'the top seed meets the lowest qualifier, and the top two can only meet ' +
    'in the final.'));

  const dRow1 = el('div', 'row');
  const nIn = el('input', 'ep-input'); nIn.type = 'number'; nIn.min = '2'; nIn.max = '32';
  nIn.value = '4'; nIn.style.flex = '0 0 92px';
  const bIn = el('input', 'ep-input'); bIn.type = 'number'; bIn.min = '0'; bIn.max = '16';
  bIn.value = '0'; bIn.style.flex = '0 0 92px';
  const lN = el('label', 'f'); lN.style.flex = '0 0 92px';
  lN.append(el('span', null, 'ENTRANTS'), nIn);
  const lB = el('label', 'f'); lB.style.flex = '0 0 92px';
  lB.append(el('span', null, 'BYES'), bIn);

  const srcSel = el('select', 'ep-input');
  srcSel.style.flex = '1 1 180px';
  (opts.comps || []).forEach(c => {
    const o = el('option', null, 'seed from ' + c.name); o.value = c.id; srcSel.appendChild(o);
  });
  const table = (opts.comps || []).find(c => c.id !== opts.comp.id && c.format !== 'knockout');
  if (table) srcSel.value = table.id;
  const lS = el('label', 'f'); lS.style.flex = '1 1 180px';
  lS.append(el('span', null, 'SEEDS FROM'), srcSel);

  dRow1.append(lN, lB, lS);
  host.appendChild(dRow1);

  let preset = null;
  let roundRows = [];

  /* One preset row, because these are what almost every league picks and
     typing 6 and 2 from scratch each time is how a bye ends up in the wrong
     place. */
  const presets = el('div', 'pick');
  [['1-4 knockout', 4, 0, [{ legs: 1 }, { legs: 1 }]],
   ['1-8 knockout', 8, 0, [{ legs: 1 }, { legs: 1 }, { legs: 1 }]],
   ['1 & 2 bye, 3-6 play in', 6, 2,
     [{ label: 'Play-in', legs: 1 }, { label: 'Semi-final', legs: 3 }, { label: 'Final', legs: 1 }]],
   ['four teams, all best of three', 4, 0, [{ legs: 3 }, { legs: 3 }]],
   ['final over two legs', 4, 0,
     [{ legs: 1 }, { label: 'Final', legs: 2, decider: 'aggregate' }]]
  ].forEach(entry => {
    const c = el('button', 'ep-chip', entry[0]); c.type = 'button';
    c.addEventListener('click', () => {
      nIn.value = String(entry[1]); bIn.value = String(entry[2]);
      preset = entry[3]; redrawRounds();
    });
    presets.appendChild(c);
  });
  host.appendChild(presets);

  const roundsHost = el('div');
  host.appendChild(roundsHost);
  const check = el('div', 'empty');
  check.style.paddingTop = '0';
  host.appendChild(check);

  /* How many rounds a field of this shape produces, and whether it produces
     one at all. Mirrors design_bracket exactly - see migration 0046. */
  function shape() {
    const n = parseInt(nIn.value, 10) || 0;
    const b = parseInt(bIn.value, 10) || 0;
    if (n < 2) return { bad: 'A bracket needs at least two teams.' };
    if (b < 0 || b >= n) return { bad: 'There have to be fewer byes than entrants.' };
    if ((n - b) % 2) return { bad: n + ' entrants with ' + b + ' bye' + (b === 1 ? '' : 's') +
      ' leaves ' + (n - b) + ' teams to pair off, which is odd. Change one of them.' };
    const k = (n - b) / 2, sv = b + k;
    if (sv < 1 || (sv & (sv - 1))) return { bad: b + ' bye' + (b === 1 ? '' : 's') + ' plus ' + k +
      ' first-round winner' + (k === 1 ? '' : 's') + ' is ' + sv +
      ', which is not a power of two - the bracket would not fill.' };
    let rounds = 1, x = sv;
    while (x > 1) { rounds++; x /= 2; }
    return { n: n, b: b, k: k, s: sv, rounds: rounds };
  }

  function defaultLabel(r, total, hasByes) {
    if (r === total) return 'Final';
    if (r === total - 1) return 'Semi-final';
    if (r === total - 2) return 'Quarter-final';
    if (r === 1 && hasByes) return 'Play-in';
    return 'Round ' + r;
  }

  function redrawRounds() {
    const sh = shape();
    roundsHost.textContent = '';
    roundRows = [];
    check.textContent = '';
    check.style.color = '';
    if (sh.bad) { check.textContent = sh.bad; check.style.color = 'var(--flare)'; return; }

    check.textContent = sh.rounds + ' round' + (sh.rounds === 1 ? '' : 's') + ': ' +
      (sh.b ? sh.b + ' straight into round two, ' : '') + sh.k +
      ' first-round tie' + (sh.k === 1 ? '' : 's') + '.';

    for (let r = 1; r <= sh.rounds; r++) {
      const p = (preset && preset[r - 1]) || {};
      const row = el('div', 'row');
      const lab = el('input', 'ep-input');
      lab.value = p.label || defaultLabel(r, sh.rounds, sh.b > 0);
      lab.maxLength = 24; lab.style.flex = '1 1 150px';
      const fmt = el('select', 'ep-input'); fmt.style.flex = '0 0 auto';
      [['1|wins', 'one game'],
       ['2|aggregate', 'two legs, on aggregate'],
       ['3|wins', 'best of three'],
       ['5|wins', 'best of five'],
       ['7|wins', 'best of seven']].forEach(pair => {
        const o = el('option', null, pair[1]); o.value = pair[0]; fmt.appendChild(o);
      });
      fmt.value = (p.legs || 1) + '|' + (p.decider || (p.legs === 2 ? 'aggregate' : 'wins'));
      if (!Array.prototype.some.call(fmt.options, o => o.value === fmt.value)) fmt.value = '1|wins';
      row.append(el('span', 'ep-micro', 'Round ' + r), lab, fmt);
      roundsHost.appendChild(row);
      roundRows.push({ lab: lab, fmt: fmt });
    }
  }
  nIn.addEventListener('input', () => { preset = null; redrawRounds(); });
  bIn.addEventListener('input', () => { preset = null; redrawRounds(); });
  redrawRounds();

  const dRow2 = el('div', 'row');
  const build = el('button', 'ep-btn pri', 'build bracket'); build.type = 'button';
  const gen = el('button', 'ep-btn', 'create the games'); gen.type = 'button';
  gen.title = 'one fixture per leg for every tie whose two sides are known';
  const startIn = el('input', 'ep-input'); startIn.type = 'date';
  startIn.style.flex = '0 0 150px';
  const lStart = el('label', 'f'); lStart.style.flex = '0 0 150px';
  lStart.append(el('span', null, 'FIRST ROUND ON'), startIn);
  dRow2.append(build, lStart, gen);
  host.appendChild(dRow2);

  build.addEventListener('click', async () => {
    const sh = shape();
    if (sh.bad) return opts.say(sh.bad, 'err');
    const spec = {
      entrants: sh.n, byes: sh.b, source: srcSel.value,
      rounds: roundRows.map(rr => {
        const bits = rr.fmt.value.split('|');
        return { label: rr.lab.value, legs: Number(bits[0]), decider: bits[1] };
      })
    };
    if (!confirm('This replaces any existing bracket in ' + opts.comp.name +
                 ', and any games already attached to it are left behind.\n\nBuild it?')) return;
    build.disabled = true;
    const res = await opts.sb.rpc('design_bracket',
      { p_competition: opts.comp.id, p_spec: spec });
    build.disabled = false;
    if (res.error) return opts.say(res.error.message, 'err');
    opts.say('Bracket built - ' + res.data + ' ties.', 'ok');
    if (opts.onDone) opts.onDone();
  });

  gen.addEventListener('click', async () => {
    gen.disabled = true;
    const res = await opts.sb.rpc('generate_tie_games', {
      p_competition: opts.comp.id,
      p_start: startIn.value || null, p_gap_days: 7 });
    gen.disabled = false;
    if (res.error) return opts.say(res.error.message, 'err');
    opts.say(res.data
      ? res.data + ' game' + (res.data === 1 ? '' : 's') + ' created. Run it again ' +
        'after each round to add the next one.'
      : 'Nothing to create - every playable tie already has its games.',
      res.data ? 'ok' : 'warn');
    if (opts.onDone) opts.onDone();
  });

  /* ---- awards ---- */
  host.appendChild(el('div', 'fmt-h', 'Awards'));
  host.appendChild(el('div', 'empty',
    'Awards are recomputed automatically whenever a game is finalised. This is ' +
    'here for after a correction, or for a season imported in bulk. Most ' +
    'valuable player is decided by box plus/minus — the same number the ' +
    'leaderboards show — and the rest by the plain per-game leaders.'));
  const aBtn = el('button', 'ep-btn', 'recompute awards');
  aBtn.type = 'button';
  aBtn.addEventListener('click', async () => {
    aBtn.disabled = true;
    const label = aBtn.textContent;
    aBtn.textContent = 'recomputing…';
    /* Through the Edge Function rather than straight to the RPC, because the
       MVP is decided by BPM and BPM is computed by the shared JavaScript the
       pages run, not by plpgsql. Calling compute_season_awards on its own
       would quietly leave the MVP on the efficiency formula. */
    try {
      const { data: { session } } = await opts.sb.auth.getSession();
      const r = await fetch(opts.cfg.supabaseUrl + '/functions/v1/finalise-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: opts.cfg.supabaseAnonKey,
          Authorization: 'Bearer ' + (session ? session.access_token : '')
        },
        body: JSON.stringify({ competitionId: opts.comp.id, awards: 1 })
      });
      const j = await r.json().catch(() => ({}));
      aBtn.disabled = false; aBtn.textContent = label;
      if (!r.ok || j.error) return opts.say(j.error || ('Refused (' + r.status + ').'), 'err');
      const notes = (j.notes || []).join(' · ');
      opts.say(j.mvp
        ? 'Awards rebuilt. MVP by BPM: ' +
          (j.mvp.value > 0 ? '+' : '') + j.mvp.value + ' over ' + j.mvp.games + ' games.' +
          (notes ? ' ' + notes : '')
        : ('Awards rebuilt. ' + (notes || '')), notes && !j.mvp ? 'warn' : 'ok');
    } catch (e) {
      aBtn.disabled = false; aBtn.textContent = label;
      opts.say('Could not reach the server: ' + (e.message || e), 'err');
    }
  });
  host.appendChild(el('div', 'row')).appendChild(aBtn);
}

return { mount };
}));
