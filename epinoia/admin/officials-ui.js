'use strict';
/* ============================================================================
   THE LEAGUE'S OFFICIALS — entered here once, picked in the scorer all season.

   The alternative is what 0076 shipped with: a statistician typing a referee's
   name at 19:25 on a phone. That works, and it produces "A Shaw", "Shaw, A."
   and "Adam Shaw" as three different officials by Christmas, at which point
   nobody can count anybody's appearances and the scoresheets disagree with each
   other about who was there.

   DEACTIVATE, DO NOT DELETE. A referee who stops officiating still refereed
   fourteen games, and their name is on fourteen scoresheets. Removing the row
   would not remove those — the name is copied onto the fixture when it is
   chosen, on purpose — but it would make the list lie about last season.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaOfficials = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* The chairs a scoresheet has. Same vocabulary as the scorer's match details
   and as games.officials, because three lists of role names is three lists to
   fall out of step. */
const ROLES = [
  ['referee',          'referee'],
  ['umpire1',          'umpire 1'],
  ['umpire2',          'umpire 2'],
  ['commissioner',     'commissioner'],
  ['scorer',           'scorer'],
  ['assistant_scorer', 'assistant scorer'],
  ['timekeeper',       'timekeeper'],
  ['shot_clock',       'shot clock']
];
/* Table officials are one competence, court officials another. Offering eight
   checkboxes per person is a form nobody fills in; offering two groups and
   letting the keen tick individually is one somebody will. */
const GROUPS = [
  ['court', 'court officials', ['referee', 'umpire1', 'umpire2', 'commissioner']],
  ['table', 'table officials', ['scorer', 'assistant_scorer', 'timekeeper', 'shot_clock']]
];

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const { sb, say } = opts;
  let rows = [];

  async function load() {
    const league = opts.league && opts.league();
    if (!league) { host.innerHTML = ''; return; }
    const { data, error } = await sb.from('league_officials')
      .select('*').eq('league_id', league.id).order('name');
    if (error) { say && say(error.message, true); return; }
    rows = data || [];
    render();
  }

  function render() {
    const league = opts.league && opts.league();
    host.innerHTML = '';

    const note = el('p', 'ep-micro');
    note.style.cssText = 'color:var(--ink-3);line-height:1.9;margin:0 0 12px';
    note.textContent = 'Everyone who can be appointed to a fixture. The scoring app ' +
      'offers these in a dropdown when a statistician fills in the match details, ' +
      'and still lets them type a name that is not here — a late replacement must ' +
      'not stop a game being scored.';
    host.appendChild(note);

    /* ---- the list ---- */
    if (rows.length) {
      const tbl = el('table', 'ep-tbl');
      tbl.style.marginBottom = '14px';
      const head = el('thead');
      head.innerHTML = '<tr><th style="text-align:left">Name</th>' +
        '<th style="text-align:left">Can officiate as</th>' +
        '<th style="text-align:left">Licence</th><th></th></tr>';
      tbl.appendChild(head);
      const body = el('tbody');

      rows.forEach(r => {
        const tr = el('tr');
        if (!r.active) tr.style.opacity = '.45';

        const nm = el('td'); nm.style.textAlign = 'left';
        nm.appendChild(el('span', null, r.name));
        if (!r.active) {
          const tag = el('span', 'ep-micro', ' · inactive');
          tag.style.color = 'var(--ink-3)'; nm.appendChild(tag);
        }
        tr.appendChild(nm);

        const rl = el('td', 'ep-micro',
          (r.roles || []).map(k => (ROLES.find(x => x[0] === k) || [k, k])[1]).join(', '));
        rl.style.cssText = 'text-align:left;color:var(--ink-3)';
        tr.appendChild(rl);

        const lc = el('td', 'ep-micro', r.licence || '—');
        lc.style.cssText = 'text-align:left;color:var(--ink-3)';
        tr.appendChild(lc);

        const act = el('td'); act.style.textAlign = 'right';
        const toggle = el('button', 'ep-btn ghost', r.active ? 'deactivate' : 'reactivate');
        toggle.onclick = async () => {
          toggle.disabled = true;
          const { error } = await sb.from('league_officials')
            .update({ active: !r.active }).eq('id', r.id);
          if (error) { say && say(error.message, true); toggle.disabled = false; return; }
          say && say(r.name + (r.active ? ' will not be offered on new fixtures.'
                                        : ' is available again.'));
          load();
        };
        act.appendChild(toggle);
        tr.appendChild(act);
        body.appendChild(tr);
      });
      tbl.appendChild(body);

      const wrap = el('div', 'ep-tw');
      wrap.appendChild(tbl);
      host.appendChild(wrap);
    }

    /* ---- add one ---- */
    const form = el('div', 'glass');
    form.style.cssText = 'padding:13px;display:flex;flex-direction:column;gap:10px';

    const line = el('div');
    line.style.cssText = 'display:flex;gap:9px;flex-wrap:wrap;align-items:center';
    const name = el('input'); name.placeholder = 'name'; name.className = 'ep-in';
    name.style.cssText = 'flex:1 1 190px;min-width:150px';
    const lic = el('input'); lic.placeholder = 'licence (optional)'; lic.className = 'ep-in';
    lic.style.cssText = 'flex:0 1 150px;min-width:110px';
    line.appendChild(name); line.appendChild(lic);
    form.appendChild(line);

    const boxes = {};
    GROUPS.forEach(([, label, keys]) => {
      const g = el('div');
      g.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;align-items:center';
      const t = el('span', 'ep-micro', label);
      t.style.cssText = 'color:var(--ink-3);letter-spacing:.18em;text-transform:uppercase;' +
        'min-width:112px';
      g.appendChild(t);
      keys.forEach(k => {
        const lab = el('label', 'ep-micro');
        lab.style.cssText = 'display:flex;align-items:center;gap:5px;color:var(--ink-2)';
        const cb = el('input'); cb.type = 'checkbox'; cb.value = k;
        if (k === 'referee') cb.checked = true;      // the commonest case, pre-ticked
        boxes[k] = cb;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode((ROLES.find(x => x[0] === k) || [k, k])[1]));
        g.appendChild(lab);
      });
      form.appendChild(g);
    });

    const add = el('button', 'ep-btn', 'Add official');
    add.style.alignSelf = 'flex-start';
    add.onclick = async () => {
      const n = name.value.trim();
      if (!n) { say && say('A name, at least.', true); return; }
      const roles = Object.keys(boxes).filter(k => boxes[k].checked);
      if (!roles.length) { say && say('Tick at least one chair they can fill.', true); return; }
      add.disabled = true;
      const { error } = await sb.from('league_officials').insert({
        league_id: league.id, name: n, roles, licence: lic.value.trim() || null
      });
      add.disabled = false;
      if (error) {
        /* The unique constraint is the commonest failure here and "duplicate
           key value violates unique constraint" is not a sentence to show a
           league secretary. */
        say && say(/duplicate|unique/i.test(error.message)
          ? n + ' is already on the list.' : error.message, true);
        return;
      }
      name.value = ''; lic.value = '';
      say && say(n + ' added.');
      load();
    };
    form.appendChild(add);
    host.appendChild(form);
  }

  load();
  return { reload: load };
}

return { mount, ROLES, GROUPS };
}));
