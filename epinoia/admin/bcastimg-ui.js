'use strict';
/* ============================================================================
   BROADCAST PLAYER IMAGES — the cut-outs a lineup card is made of.

   A different picture from the profile photograph and for a different job. The
   profile shot is head-and-shoulders in a circle on a player page; this one is
   a full-body cut-out with the background removed, standing three-quarters of
   the height of a 1080-line frame. Neither substitutes for the other — a head
   shot stretched to full height looks like a mistake, and a cut-out in a
   circle is a pair of boots.

   SO IT IS UPLOADED HERE AND NOT THERE, and the lineup graphic asks only for
   kind='broadcast'. Where there is none it draws a figure in the club's colour
   rather than reaching for the wrong picture.

   WHAT THIS PANEL DELIBERATELY DOES NOT DO is cut the background out. That is
   a job for whatever the operator already uses, and a background remover
   written here would be a worse one that also had to be maintained. The panel
   says what it wants — PNG or WebP with transparency — and warns when what
   arrived plainly is not that.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaBcastImg = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const { sb, say } = opts;
  const CFG = window.EPINOIA_CONFIG || {};
  let teams = [], players = [], images = {}, teamId = null;

  const publicUrl = path => window.EpinoiaUpload.publicUrl(CFG, path);

  async function loadTeams() {
    const league = opts.league && opts.league();
    if (!league) { host.innerHTML = ''; return; }
    const { data } = await sb.from('teams').select('id,name,colour')
      .eq('league_id', league.id).order('name');
    teams = data || [];
    if (!teamId && teams.length) teamId = teams[0].id;
    await loadSquad();
  }

  async function loadSquad() {
    players = []; images = {};
    if (!teamId) { render(); return; }
    const { data: re } = await sb.from('roster_entries')
      .select('jersey,players(id,first_name,last_name)')
      .eq('team_id', teamId).eq('active', true);
    players = (re || []).filter(r => r.players).map(r => ({
      id: r.players.id, jersey: r.jersey || '',
      name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim()
    })).sort((a, b) => (+a.jersey || 99) - (+b.jersey || 99));

    if (players.length) {
      /* Pending as well as approved: an operator needs to see the one they
         uploaded two minutes ago, not wonder whether it saved. */
      const { data: md } = await sb.from('media')
        .select('id,owner_id,storage_path,status,created_at')
        .eq('owner_type', 'player').eq('kind', 'broadcast')
        .in('owner_id', players.map(p => p.id))
        .order('created_at', { ascending: false });
      (md || []).forEach(m => { if (!images[m.owner_id]) images[m.owner_id] = m; });
    }
    render();
  }

  function render() {
    host.innerHTML = '';

    const note = el('p', 'ep-micro');
    note.style.cssText = 'color:var(--ink-3);line-height:1.9;margin:0 0 12px';
    note.innerHTML = 'Full-body cut-outs for the broadcast lineup graphics. ' +
      '<b>PNG or WebP with a transparent background</b> — cut out in whatever you ' +
      'already use. A player without one is drawn as a figure in the club’s ' +
      'colour, so the graphic never has a gap in it.';
    host.appendChild(note);

    if (!teams.length) {
      host.appendChild(el('p', 'ep-micro', 'No clubs in this league yet.'));
      return;
    }

    const pick = el('div');
    pick.style.cssText = 'display:flex;gap:9px;align-items:center;margin-bottom:12px;flex-wrap:wrap';
    const sel = el('select', 'ep-in');
    teams.forEach(t => {
      const o = el('option', null, t.name); o.value = t.id;
      if (t.id === teamId) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { teamId = sel.value; loadSquad(); };
    pick.appendChild(el('span', 'ep-micro', 'club'));
    pick.appendChild(sel);
    host.appendChild(pick);

    const grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(146px,1fr));gap:10px';

    players.forEach(p => {
      const card = el('div', 'glass');
      card.style.cssText = 'padding:9px;display:flex;flex-direction:column;gap:7px';

      const frame = el('div');
      frame.style.cssText = 'aspect-ratio:3/4;background:' +
        'repeating-conic-gradient(#131a17 0% 25%,#0d1310 0% 50%) 50%/14px 14px;' +
        'border:1px solid var(--rule);display:flex;align-items:flex-end;' +
        'justify-content:center;overflow:hidden;position:relative';
      const m = images[p.id];
      if (m) {
        const img = el('img');
        img.src = publicUrl(m.storage_path);
        img.style.cssText = 'height:100%;width:auto;max-width:100%;object-fit:contain';
        frame.appendChild(img);
        if (m.status !== 'approved') {
          const tag = el('span', 'ep-micro', m.status);
          tag.style.cssText = 'position:absolute;top:4px;left:4px;background:var(--amber);' +
            'color:#04100b;padding:1px 5px;font-size:8px;letter-spacing:.1em';
          frame.appendChild(tag);
        }
      } else {
        const none = el('span', 'ep-micro', 'no image');
        none.style.cssText = 'color:var(--ink-3);align-self:center';
        frame.appendChild(none);
      }
      card.appendChild(frame);

      const nm = el('div', 'ep-micro', (p.jersey ? p.jersey + '  ' : '') + p.name);
      nm.style.cssText = 'font-size:9px;line-height:1.6;color:var(--ink-2);' +
        'text-transform:capitalize;min-height:24px';
      card.appendChild(nm);

      const file = el('input'); file.type = 'file';
      file.accept = 'image/png,image/webp'; file.style.display = 'none';
      const btn = el('button', 'ep-btn ghost', m ? 'replace' : 'upload');
      btn.style.fontSize = '9px';
      btn.onclick = () => file.click();

      file.onchange = async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        /* A JPEG has no alpha at all, so it cannot be a cut-out however it
           looks in a thumbnail — say so before it is uploaded rather than
           after it appears on a graphic with a black box round it. */
        if (/jpe?g/i.test(f.type)) {
          say && say('A JPEG cannot hold a transparent background — export the ' +
                     'cut-out as PNG or WebP.', true);
          file.value = ''; return;
        }
        btn.disabled = true; btn.textContent = 'uploading…';
        try {
          await window.EpinoiaUpload.upload(sb, {
            ownerType: 'player', ownerId: p.id, kind: 'broadcast', file: f
          });
          say && say(p.name + ' uploaded — approve it below to put it on air.');
          await loadSquad();
        } catch (err) {
          say && say(String((err && err.message) || err), true);
          btn.disabled = false; btn.textContent = m ? 'replace' : 'upload';
        }
      };

      const row = el('div');
      row.style.cssText = 'display:flex;gap:5px';
      row.appendChild(btn);
      if (m && m.status !== 'approved') {
        const ok = el('button', 'ep-btn', 'approve');
        ok.style.fontSize = '9px';
        ok.onclick = async () => {
          ok.disabled = true;
          const { error } = await sb.from('media')
            .update({ status: 'approved' }).eq('id', m.id);
          if (error) {
            /* The commonest refusal here is a minor without recorded consent,
               and the database's own message says so better than a guess. */
            say && say(error.message, true); ok.disabled = false; return;
          }
          say && say(p.name + ' is on air.');
          loadSquad();
        };
        row.appendChild(ok);
      }
      card.appendChild(row);
      card.appendChild(file);
      grid.appendChild(card);
    });

    host.appendChild(grid);
  }

  loadTeams();
  return { reload: loadTeams };
}

return { mount };
}));
