'use strict';
/* ============================================================================
   APPEARANCE — what a league shows, and what colour it is.

   Three groups of switches over one RPC (migration 0053). All of it is
   cosmetic in the sense that nothing here changes a number; none of it is
   cosmetic in the sense that a league with no merchandise and no news should
   not carry two headings explaining that it has neither.

   THE COUNTRY IS NOT DECORATION. It is the level above the league in the
   sidebar, so a league without one is filed under "Elsewhere" — reachable,
   and obviously unfiled. The picker takes the two-letter code and shows the
   flag and the country's name back, rather than offering a list of two
   hundred: the list would need maintaining, would be wrong somewhere, and
   Intl already knows every region in the reader's own language.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAppearance = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* The same derivation the rail uses: two ISO letters onto two regional
   indicators. Kept in both places rather than shared because it is four lines
   and the rail deliberately loads nothing. */
const flagOf = code => /^[A-Za-z]{2}$/.test(code || '') ? String.fromCodePoint(
  ...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '\u{1F3F3}';

let regionNames;
function countryName(code) {
  if (!/^[A-Za-z]{2}$/.test(code || '')) return '';
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(undefined, { type: 'region' }); }
    catch (_) { regionNames = null; }
  }
  if (!regionNames) return code.toUpperCase();
  try { return regionNames.of(code.toUpperCase()) || code.toUpperCase(); }
  catch (_) { return code.toUpperCase(); }
}

/* The blocks on the league's front page, in the order they appear there — a
   settings list in a different order from the thing it configures is a
   settings list you have to translate. */
const SECTIONS = [
  ['news',     'News',            'up to five headline cards'],
  ['clubs',    'Clubs',           'the club plates'],
  ['toty',     'Team of the Year', 'the selected team and the ballot'],
  ['stars',    'Stars',           'the weekly and monthly podiums'],
  ['games',    'Games',           'live, recent and upcoming'],
  ['season',   'This season',     'the table and leaders, and the full-table links'],
  ['merch',    'Merchandise',     'the shop and the star of the month'],
  ['socials',  'Socials',         'the league’s Instagram'],
  ['takepart', 'Take part',       'the sign-in cards at the foot']
];

const TABS = [
  ['fixtures',   'Fixtures'],
  ['statistics', 'Statistics'],
  ['wowy',       'WOWY'],
  ['table',      'Table'],
  ['news',       'News'],
  ['score',      'Score a game',  'only ever shown to somebody who may score'],
  ['portal',     'Club portal',   'only ever shown to a club manager'],
  ['admin',      'League admin',  'only ever shown to an administrator']
];

const THEME = [
  ['bg',       'Page background', '#04100b'],
  ['panel',    'Panels',          '#0a1a13'],
  ['ink',      'Text',            '#e6fff1'],
  ['rail',     'Sidebar',         '#071710'],
  ['rail_ink', 'Sidebar text',    '#e6fff1'],
  ['accent',   'Accent',          '#93f2bf']
];

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  let cur = { country: '', sections: {}, nav: {}, theme: {} };
  const boxes = {}, tabBoxes = {}, colours = {};

  /* ---- the league's own mark ----
     Shown beside the league's name on its front page, at the top of the one
     screen every visitor sees. It goes through the same media queue as a club
     crest and a player photograph — the league approves what appears under its
     own name, including its own upload, because one queue that always applies
     beats two with an exception in it. */
  host.appendChild(el('div', 'fmt-h', 'League logo'));
  host.appendChild(el('p', 'empty',
    'Sits next to the league name on the front page. An SVG with a ' +
    'transparent background is best — it stays sharp at every size and on ' +
    'every screen; a transparent PNG works too. It appears once it is ' +
    'approved in Photographs below.'));
  const lgRow = el('div', 'row');
  const lgFile = el('input');
  lgFile.type = 'file';
  lgFile.accept = 'image/svg+xml,image/png,image/webp,image/*';
  lgFile.style.display = 'none';
  const lgPick = el('button', 'ep-btn mini', 'upload a logo');
  lgPick.type = 'button';
  lgPick.addEventListener('click', () => lgFile.click());
  const lgPrev = el('span', 'mt');
  /* the same pairing as everywhere else: add, and take down */
  const lgRm = el('button', 'ep-btn mini', 'remove logo');
  lgRm.type = 'button';
  lgRm.hidden = true;
  lgRm.title = 'take the league logo down — the name shows on its own';
  lgRm.addEventListener('click', async () => {
    if (!confirm('Remove the league logo?\n\nThe league name shows on its own ' +
                 'until another is uploaded.')) return;
    lgRm.disabled = true;
    const { data, error } = await o.sb.rpc('remove_media', {
      p_owner_type: 'league', p_owner_id: o.league.id, p_kind: 'logo' });
    lgRm.disabled = false;
    if (error) return o.say(error.message, 'err');
    const orphans = (data && data.orphans) || [];
    if (orphans.length) {
      o.sb.storage.from('media-public').remove(orphans).catch(() => {});
      o.sb.storage.from('media-pending').remove(orphans).catch(() => {});
    }
    lgPrev.textContent = 'no logo yet';
    lgRm.hidden = true;
    o.say('Logo removed.', 'ok');
  });

  lgRow.append(lgPick, lgFile, lgRm, lgPrev);
  host.appendChild(lgRow);

  /* whatever is already approved, so an administrator can see what is live */
  (async () => {
    try {
      const { data } = await o.sb.from('media')
        .select('storage_path,status')
        .eq('owner_type', 'league').eq('owner_id', o.league.id).eq('kind', 'logo')
        .order('created_at', { ascending: false }).limit(1);
      const m = data && data[0];
      if (!m) { lgPrev.textContent = 'no logo yet'; return; }
      lgRm.hidden = false;
      lgPrev.textContent = '';
      const img = document.createElement('img');
      img.src = window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, m.storage_path);
      img.alt = ''; img.style.cssText = 'height:30px;vertical-align:middle;margin-right:8px';
      lgPrev.appendChild(img);
      lgPrev.appendChild(document.createTextNode(m.status));
    } catch (_) { lgPrev.textContent = ''; }
  })();

  lgFile.addEventListener('change', async () => {
    const f = lgFile.files && lgFile.files[0];
    lgFile.value = '';
    if (!f) return;
    if (!window.EpinoiaUpload) return o.say('The uploader did not load.', 'err');
    lgPick.disabled = true;
    try {
      const up = await window.EpinoiaUpload.upload(o.sb, {
        file: f, ownerType: 'league', ownerId: o.league.id, kind: 'logo' });
      if (!up || !up.storage_path) throw new Error('the upload returned no path');
      lgPrev.textContent = 'uploaded — approve it in Photographs';
      lgRm.hidden = false;
      o.say('Logo uploaded and queued for approval.', 'ok');
    } catch (e) {
      o.say('Upload failed: ' + (e.message || e), 'err');
    }
    lgPick.disabled = false;
  });

  /* ---- country ---- */
  host.appendChild(el('div', 'fmt-h', 'Country'));
  host.appendChild(el('p', 'empty',
    'Two letters — GB, ES, DE. The sidebar groups leagues by country, and the ' +
    'flag comes from the code rather than being uploaded. A league with no ' +
    'country is filed under “Elsewhere”.'));
  const cRow = el('div', 'row');
  const code = el('input', 'ep-input');
  code.maxLength = 2; code.placeholder = 'GB'; code.style.flex = '0 0 80px';
  code.style.textTransform = 'uppercase';
  const preview = el('span', 'mt', '');
  preview.style.fontSize = '15px';
  cRow.append(code, preview);
  host.appendChild(cRow);
  const drawFlag = () => {
    const v = code.value.trim();
    preview.textContent = v ? flagOf(v) + '  ' + countryName(v) : 'no country — “Elsewhere”';
  };
  code.addEventListener('input', drawFlag);

  /* ---- sections ---- */
  host.appendChild(el('div', 'fmt-h', 'Sections on the league’s front page'));
  const sGrid = el('div', 'app-grid');
  SECTIONS.forEach(([key, label, hint]) => {
    const cell = el('div', 'app-cell');
    const lab = el('label', 'sw');
    const box = el('input'); box.type = 'checkbox'; box.checked = true;
    boxes[key] = box;
    lab.append(box, document.createTextNode(' ' + label));
    cell.append(lab, el('div', 'app-hint', hint));
    sGrid.appendChild(cell);
  });
  host.appendChild(sGrid);

  /* ---- tabs ---- */
  host.appendChild(el('div', 'fmt-h', 'Tabs in the sidebar'));
  host.appendChild(el('p', 'empty',
    'Switching one off hides it from everybody, including the people whose ' +
    'role would otherwise show it — a league that does not run its own ' +
    'scoring should not offer the button to the one person who could press it.'));
  const tGrid = el('div', 'app-grid');
  TABS.forEach(([key, label, hint]) => {
    const cell = el('div', 'app-cell');
    const lab = el('label', 'sw');
    const box = el('input'); box.type = 'checkbox'; box.checked = true;
    tabBoxes[key] = box;
    lab.append(box, document.createTextNode(' ' + label));
    cell.append(lab);
    if (hint) cell.appendChild(el('div', 'app-hint', hint));
    tGrid.appendChild(cell);
  });
  host.appendChild(tGrid);

  /* ---- colours ---- */
  host.appendChild(el('div', 'fmt-h', 'Colours'));
  host.appendChild(el('p', 'empty',
    'Six slots, and nothing else is themeable — a league can look like itself ' +
    'without being able to produce something nobody can read. Leave a slot on ' +
    'its default to inherit the platform’s.'));
  const cGrid = el('div', 'app-grid');
  THEME.forEach(([key, label, dflt]) => {
    const cell = el('div', 'app-cell');
    const row = el('div', 'row'); row.style.marginBottom = '0';
    const inp = el('input', 'ep-input'); inp.type = 'color'; inp.value = dflt;
    inp.style.cssText = 'flex:0 0 46px;padding:3px';
    const use = el('input'); use.type = 'checkbox';
    const lab = el('label', 'sw');
    lab.append(use, document.createTextNode(' ' + label));
    colours[key] = { inp, use, dflt };
    row.append(inp, lab);
    cell.appendChild(row);
    cGrid.appendChild(cell);
  });
  host.appendChild(cGrid);

  const bar = el('div', 'row');
  const save = el('button', 'ep-btn pri', 'save appearance'); save.type = 'button';
  const reset = el('button', 'ep-btn mini', 'back to the defaults'); reset.type = 'button';
  const view = el('a', 'ep-btn mini', 'see the page ↗');
  view.href = '../?l=' + encodeURIComponent(o.league.slug);
  view.target = '_blank'; view.rel = 'noopener';
  bar.append(save, reset, view);
  host.appendChild(bar);

  reset.addEventListener('click', () => {
    Object.values(boxes).forEach(b => { b.checked = true; });
    Object.values(tabBoxes).forEach(b => { b.checked = true; });
    Object.values(colours).forEach(c => { c.use.checked = false; c.inp.value = c.dflt; });
    o.say('Cleared — press save to apply.', 'ok');
  });

  save.addEventListener('click', async () => {
    const v = code.value.trim();
    if (v && !/^[A-Za-z]{2}$/.test(v)) {
      return o.say('A country code is exactly two letters.', 'err');
    }
    const sections = {}, nav = {}, theme = {};
    /* ONLY THE SWITCHED-OFF ONES ARE SENT. Absent means shown, everywhere, so
       writing `true` for the rest would freeze today's list into every league
       — and a section added next month would be missing from that stored
       object and therefore hidden for everybody who had ever pressed save. */
    Object.keys(boxes).forEach(k => { if (!boxes[k].checked) sections[k] = false; });
    Object.keys(tabBoxes).forEach(k => { if (!tabBoxes[k].checked) nav[k] = false; });
    Object.keys(colours).forEach(k => {
      if (colours[k].use.checked) theme[k] = colours[k].inp.value;
    });

    save.disabled = true;
    const r = await o.sb.rpc('set_league_appearance', {
      p_league: o.league.id, p_country: v, p_sections: sections,
      p_nav: nav, p_theme: theme });
    save.disabled = false;
    if (r.error) return o.say(r.error.message, 'err');
    o.say('Saved — reload the league page to see it.', 'ok');
    load();
  });

  async function load() {
    const r = await o.sb.from('leagues')
      .select('country,sections,nav,theme').eq('id', o.league.id).maybeSingle();
    if (r.error || !r.data) { drawFlag(); return; }
    cur = r.data;
    code.value = cur.country || '';
    drawFlag();
    Object.keys(boxes).forEach(k => {
      boxes[k].checked = (cur.sections || {})[k] !== false;
    });
    Object.keys(tabBoxes).forEach(k => {
      tabBoxes[k].checked = (cur.nav || {})[k] !== false;
    });
    Object.keys(colours).forEach(k => {
      const v2 = (cur.theme || {})[k];
      colours[k].use.checked = !!v2;
      colours[k].inp.value = v2 || colours[k].dflt;
    });
  }

  load();
}

return { mount, flagOf, countryName };
}));
