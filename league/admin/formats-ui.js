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
  else root.CourtsideFormats = api;
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

  /* ---- format ---- */
  const fRow = el('div', 'row');
  fRow.appendChild(el('span', 'cs-micro', 'Format'));
  const fSel = el('select', 'cs-input');
  fSel.style.flex = '0 0 auto';
  [['table', 'one table'], ['groups', 'groups'],
   ['knockout', 'knockout'], ['groups_knockout', 'groups then knockout']]
    .forEach(([v, label]) => {
      const o = el('option', null, label); o.value = v; fSel.appendChild(o);
    });
  fSel.value = opts.comp.format || 'table';
  const fSave = el('button', 'cs-btn mini', 'save');
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
      const inp = el('input', 'cs-input fmt-in');
      inp.value = row.group_name || '';
      inp.maxLength = 12;
      inp.placeholder = '—';
      inputs.set(row.team_id, inp);
      cell.appendChild(inp);
      grid.appendChild(cell);
    });
    host.appendChild(grid);

    const gSave = el('button', 'cs-btn', 'save groups');
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

  /* ---- seed a bracket ---- */
  host.appendChild(el('div', 'fmt-h', 'Knockout'));
  host.appendChild(el('div', 'empty',
    'Seeding builds the whole bracket at once: the top seed plays the lowest ' +
    'qualifier, so the top two can only meet in the final. Ties fill themselves ' +
    'in as results arrive — nothing here has to be revisited between rounds.'));

  const sRow = el('div', 'row');
  const nSel = el('select', 'cs-input');
  nSel.style.flex = '0 0 auto';
  [2, 4, 8, 16].forEach(n => {
    const o = el('option', null, n + ' teams'); o.value = String(n); nSel.appendChild(o);
  });
  nSel.value = '4';

  /* the table the seeds come from — usually the league this playoff belongs
     to, which is a different competition from the playoff itself */
  const srcSel = el('select', 'cs-input');
  srcSel.style.flex = '1 1 160px';
  (opts.comps || []).forEach(c => {
    const o = el('option', null, 'seed from ' + c.name); o.value = c.id; srcSel.appendChild(o);
  });
  const table = (opts.comps || []).find(c => c.id !== opts.comp.id && c.format !== 'knockout');
  if (table) srcSel.value = table.id;

  const seed = el('button', 'cs-btn pri', 'seed bracket');
  seed.type = 'button';
  seed.addEventListener('click', async () => {
    const n = parseInt(nSel.value, 10);
    if (!confirm('Seeding replaces any existing bracket in ' + opts.comp.name +
                 '. Build a ' + n + '-team bracket?')) return;
    seed.disabled = true;
    const { data, error } = await opts.sb.rpc('seed_bracket', {
      p_competition: opts.comp.id, p_qualifiers: n, p_from_competition: srcSel.value
    });
    seed.disabled = false;
    if (error) return opts.say(error.message, 'err');
    opts.say('Bracket seeded — ' + data + ' round' + (data === 1 ? '' : 's') + '.', 'ok');
    if (opts.onDone) opts.onDone();
  });
  sRow.append(nSel, srcSel, seed);
  host.appendChild(sRow);

  /* ---- awards ---- */
  host.appendChild(el('div', 'fmt-h', 'Awards'));
  host.appendChild(el('div', 'empty',
    'Awards are recomputed automatically whenever a game is finalised. This is ' +
    'here for after a correction, or for a season imported in bulk.'));
  const aBtn = el('button', 'cs-btn', 'recompute awards');
  aBtn.type = 'button';
  aBtn.addEventListener('click', async () => {
    aBtn.disabled = true;
    const { data, error } = await opts.sb.rpc('compute_season_awards',
      { p_competition: opts.comp.id });
    aBtn.disabled = false;
    if (error) return opts.say(error.message, 'err');
    opts.say(data ? data + ' awards decided.' : 'Not enough games played for awards yet.',
             data ? 'ok' : 'warn');
  });
  host.appendChild(el('div', 'row')).appendChild(aBtn);
}

return { mount };
}));
