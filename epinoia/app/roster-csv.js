'use strict';
/* ============================================================================
   ROSTER CSV IMPORT — the panel.

   Twenty players at once instead of twenty forms. The parsing, mapping and
   validation all live in csv.js, which is tested on its own; this file is the
   part a person touches.

   The design rule is that NOTHING IS WRITTEN UNTIL THE PREVIEW IS SHOWN. A
   manager sees exactly which rows will be created, which already exist, which
   will change a jersey and which are refused and why — and only then presses
   the button. A half-applied import is worse than a refused one, and an
   import you cannot inspect first is how twenty wrong rows get made.

   Rows with errors are skipped rather than blocking the rest, because the
   common case is one typo in a sheet of fifteen and refusing the whole file
   over it just moves the work back to the manager.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaRosterCSV = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* the slug generator the portal already uses for hand-added players */
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);

const BADGE = {
  add:      ['new',      'ok'],
  update:   ['jersey',   'warn'],
  existing: ['on roster','muted'],
  error:    ['skipped',  'err']
};

/* opts: { host, sb, team, me, existing, onDone, say } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const C = window.EpinoiaCSV;
  host.textContent = '';
  let parsed = null;

  /* ---- input ---- */
  const lead = el('p', 'ep-micro csv-lead');
  lead.textContent = 'Paste a team sheet, or choose a file. Columns are worked out from the ' +
    'headings — jersey, first and last name, birth year — and a single "Name" column is fine. ' +
    'Height, weight, wingspan and previous club are read too when the sheet has them: '  +
    'heights in centimetres, metres or feet and inches, weights in kilograms or pounds. ' +
    'Nothing is saved until you have seen what it will do.';
  host.appendChild(lead);

  const ta = el('textarea', 'ep-input csv-ta');
  ta.rows = 6;
  ta.placeholder = '#,First,Last,Year\n4,Silas,Byrne,2007\n7,Iggy,Kovacs,1998';
  ta.spellcheck = false;
  host.appendChild(ta);

  const bar = el('div', 'row csv-bar');
  const file = el('input');
  file.type = 'file';
  file.accept = '.csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values';
  file.className = 'csv-file';
  const readBtn = el('button', 'ep-btn', 'Preview');
  readBtn.type = 'button';
  const clearBtn = el('button', 'mini', 'clear');
  clearBtn.type = 'button';
  bar.append(file, readBtn, clearBtn);
  host.appendChild(bar);

  const summary = el('div', 'csv-sum');
  host.appendChild(summary);
  const table = el('div', 'ep-tw csv-tw');
  host.appendChild(table);
  const commitBar = el('div', 'row csv-commit');
  host.appendChild(commitBar);

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    /* a roster is kilobytes; anything huge is the wrong file and reading it
       would hang the tab rather than fail usefully */
    if (f.size > 2 * 1024 * 1024) {
      opts.say('That file is ' + Math.round(f.size / 1024 / 1024) + ' MB — too big to be a team sheet.', 'err');
      file.value = ''; return;
    }
    const fr = new FileReader();
    fr.onload = () => { ta.value = String(fr.result || ''); preview(); };
    fr.onerror = () => opts.say('Could not read that file.', 'err');
    fr.readAsText(f);
  });

  readBtn.addEventListener('click', preview);
  clearBtn.addEventListener('click', () => {
    ta.value = ''; file.value = ''; parsed = null;
    summary.textContent = ''; table.textContent = ''; commitBar.textContent = '';
    opts.say('');
  });

  function preview() {
    const text = ta.value;
    if (!text.trim()) { opts.say('Nothing to read yet — paste a sheet first.', 'warn'); return; }

    parsed = C.build({
      text,
      existing: opts.existing || [],
      thisYear: new Date().getFullYear()
    });

    summary.textContent = ''; table.textContent = ''; commitBar.textContent = '';

    if (parsed.empty || !parsed.rows.length) {
      summary.appendChild(el('div', 'csv-note', 'No rows found in that.'));
      return;
    }

    const c = parsed.counts;
    const chips = el('div', 'csv-chips');
    const chip = (n, label, cls) => {
      if (!n) return;
      const d = el('span', 'csv-chip ' + cls);
      d.append(el('b', null, String(n)), document.createTextNode(' ' + label));
      chips.appendChild(d);
    };
    chip(c.add, 'to add', 'ok');
    chip(c.update, 'jersey change', 'warn');
    chip(c.existing, 'already on roster', 'muted');
    chip(c.error, 'skipped', 'err');
    summary.appendChild(chips);

    /* say how the columns were read — a silently mis-mapped column is the
       failure mode that produces a roster of people called "2007" */
    const cols = Object.keys(parsed.map)
      .map(k => k + ' → ' + (parsed.headed ? (parsed.header[parsed.map[k]] || '?') : 'column ' + (parsed.map[k] + 1)));
    const note = el('div', 'csv-note');
    note.textContent = (parsed.headed ? 'Columns read as: ' : 'No headings found, read by position: ') +
      cols.join(' · ') + (parsed.delimiter === ',' ? '' : '  (delimiter "' + (parsed.delimiter === '\t' ? 'tab' : parsed.delimiter) + '")');
    summary.appendChild(note);

    const t = el('table', 'plist csv-tbl');
    const thead = el('thead'), hr = el('tr');
    ['', '#', 'Name', 'Born', '', 'What happens'].forEach(h => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr); t.appendChild(thead);
    const tb = el('tbody');

    parsed.rows.forEach(r => {
      const tr = el('tr', r.action === 'error' ? 'csv-bad' : '');
      tr.appendChild(el('td', 'csv-line', String(r.line)));
      tr.appendChild(el('td', null, r.jersey || '–'));

      const nm = el('td');
      nm.appendChild(el('span', null, (r.first + ' ' + r.last).trim() || '—'));
      if (r.is_minor) nm.appendChild(el('span', 'minor', 'U18'));
      tr.appendChild(nm);

      tr.appendChild(el('td', null, r.birth_year == null ? '–' : String(r.birth_year)));

      const [label, cls] = BADGE[r.action] || BADGE.add;
      const bd = el('td');
      bd.appendChild(el('span', 'csv-badge ' + cls, label));
      tr.appendChild(bd);

      const msg = el('td', 'csv-msg');
      msg.textContent = r.errors.concat(r.warnings).join(' · ') ||
        (r.action === 'add' ? 'added to the roster'
          : r.action === 'existing' ? 'no change' : '');
      tr.appendChild(msg);

      tb.appendChild(tr);
    });
    t.appendChild(tb);
    table.appendChild(t);

    const willWrite = c.add + c.update;
    if (!willWrite) {
      commitBar.appendChild(el('div', 'csv-note',
        c.error ? 'Every row was refused — fix the sheet and preview again.'
                : 'Everyone in that sheet is already on the roster. Nothing to do.'));
      return;
    }

    const go = el('button', 'ep-btn pri',
      'Import ' + willWrite + (willWrite === 1 ? ' player' : ' players'));
    go.type = 'button';
    go.addEventListener('click', () => commit(go));
    commitBar.appendChild(go);
    if (c.error) {
      commitBar.appendChild(el('span', 'csv-note',
        c.error + (c.error === 1 ? ' row is' : ' rows are') + ' skipped.'));
    }
    opts.say('');
  }

  async function commit(btn) {
    if (!parsed) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'importing…';

    const toAdd = parsed.rows.filter(r => r.action === 'add');
    const toUpdate = parsed.rows.filter(r => r.action === 'update');
    let made = [];

    try {
      /* 1. the people */
      if (toAdd.length) {
        const payload = toAdd.map(r => ({
          slug: slugify((r.first + '-' + r.last).trim() || 'player'),
          first_name: r.first, last_name: r.last,
          birth_year: r.birth_year, is_minor: r.is_minor,
          height_cm: r.height_cm, weight_kg: r.weight_kg,
          wingspan_cm: r.wingspan_cm, previous_club: r.previous_club,
          created_by: opts.me.id
        }));
        const { data, error } = await opts.sb.from('players').insert(payload).select('id');
        if (error) throw error;
        made = (data || []).map(p => p.id);

        /* 2. their places on this roster.
           If this half fails the players exist with no team, which is invisible
           in the UI and impossible for a manager to clean up — so undo them. */
        const entries = made.map((id, i) => ({
          team_id: opts.team.id, player_id: id,
          jersey: toAdd[i].jersey || null, active: true
        }));
        const { error: rErr } = await opts.sb.from('roster_entries').insert(entries);
        if (rErr) {
          await opts.sb.from('players').delete().in('id', made);
          throw new Error('Roster entries were refused (' + rErr.message +
                          '), so the new player records were removed again.');
        }
      }

      /* 3b. measurements for people already here. A sheet that carries a
         height for somebody already on the roster is a correction, and
         ignoring it would make the importer useful once and useless after
         that. Nothing is CLEARED from a blank cell — an export that omits a
         column must not wipe what the club typed in by hand. */
      for (const r of parsed.rows.filter(x => x.action === 'existing' && x.match)) {
        const patch = {};
        if (r.height_cm != null)    patch.height_cm = r.height_cm;
        if (r.weight_kg != null)    patch.weight_kg = r.weight_kg;
        if (r.wingspan_cm != null)  patch.wingspan_cm = r.wingspan_cm;
        if (r.previous_club)        patch.previous_club = r.previous_club;
        if (!Object.keys(patch).length) continue;
        const { error } = await opts.sb.from('players')
          .update(patch).eq('id', r.match.playerId);
        if (error) throw error;
      }

      /* 3. jersey changes for people already here */
      for (const r of toUpdate) {
        const { error } = await opts.sb.from('roster_entries')
          .update({ jersey: r.jersey || null })
          .eq('team_id', opts.team.id).eq('player_id', r.match.playerId);
        if (error) throw error;
      }

      const bits = [];
      if (toAdd.length) bits.push(toAdd.length + (toAdd.length === 1 ? ' player added' : ' players added'));
      if (toUpdate.length) bits.push(toUpdate.length + ' jersey' + (toUpdate.length === 1 ? '' : 's') + ' changed');
      opts.say(bits.join(', ') + '.', 'ok');

      ta.value = ''; file.value = ''; parsed = null;
      summary.textContent = ''; table.textContent = ''; commitBar.textContent = '';
      if (opts.onDone) opts.onDone();
    } catch (e) {
      opts.say(e.message || 'That import was refused.', 'err');
      btn.disabled = false; btn.textContent = original;
    }
  }
}

return { mount };
}));
