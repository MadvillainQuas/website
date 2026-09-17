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

  /* ---- the league's own mark, and the colours it gives the league ----
     Beside the league's name on its front page and in the sidebar. A LEAGUE ADMIN'S OWN UPLOAD
     IS LIVE AT ONCE (publish_league_logo, 0122), the way a club manager's crest is: approving it
     in Photographs was a second step with the same person in it. It goes straight into the
     public bucket, which the storage policy of 0065 allows for a league admin's logo path.

     THEN ITS COLOURS ARE READ, with the same count a club's crest gets (teamcolour.js palette,
     the browser twin of scripts/ingest/team_colours.py), and saved as the league's colours:
     the trims on the league's front page, its table and fixtures page, and the sidebar while a
     visitor is on either. Colours an admin picked by hand are never replaced by a read unless
     they ask for it. The ingest's colour sweep reads any logo this page did not. */
  const TC = () => window.EpinoiaTeamColour;
  const logoUrl = path => window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, path);
  const NEEDS_0122 = 'The database has not had migration 0122 yet — run Push Database.bat, then try again.';
  const missingFn = e => !!e && (e.code === 'PGRST202' || /could not find the function/i.test(e.message || ''));

  host.appendChild(el('div', 'fmt-h', 'League logo'));
  host.appendChild(el('p', 'empty',
    'Sits next to the league name on the front page and in the sidebar, and gives the league ' +
    'its colours: the two strongest colours in it become the trims on the league’s pages. An ' +
    'SVG with a transparent background is best — it stays sharp at every size; a transparent ' +
    'PNG works too. It is live as soon as it is uploaded.'));
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
  lgRow.append(lgPick, lgFile, lgRm, lgPrev);
  host.appendChild(lgRow);

  const paintLogo = (path, note) => {
    lgPrev.textContent = '';
    if (!path) { lgPrev.textContent = note || 'no logo yet'; lgRm.hidden = true; return; }
    lgRm.hidden = false;
    const img = document.createElement('img');
    img.src = logoUrl(path);
    img.alt = ''; img.style.cssText = 'height:30px;vertical-align:middle;margin-right:8px';
    lgPrev.appendChild(img);
    if (note) lgPrev.appendChild(document.createTextNode(note));
  };

  /* whatever is there already, live or waiting, so an administrator can see it */
  async function showLogo() {
    try {
      const { data } = await o.sb.from('media')
        .select('storage_path,status')
        .eq('owner_type', 'league').eq('owner_id', o.league.id).eq('kind', 'logo')
        .order('created_at', { ascending: false }).limit(1);
      const m = data && data[0];
      if (!m) return paintLogo(null);
      paintLogo(m.storage_path, m.status === 'approved' ? 'live' : m.status + ' — approve it in Photographs');
    } catch (_) { lgPrev.textContent = ''; }
  }
  showLogo();

  lgRm.addEventListener('click', async () => {
    if (!confirm('Remove the league logo?\n\nThe league name shows on its own until another is ' +
                 'uploaded, and colours read from this logo go with it (colours you picked stay).')) return;
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
    paintLogo(null);
    o.say('Logo removed.', 'ok');
    loadColours();
  });

  /* The two colours of a logo, read in this browser and saved as the league's. force: replace
     colours an admin picked by hand (the "use the logo's colours" button); an upload never does. */
  async function readLogoColours(path, force) {
    const T = TC();
    if (!T || !T.fromImage) return o.say('The colour reader did not load.', 'err');
    const pal = await T.fromImage(logoUrl(path));
    if (!pal || !pal.primary) {
      o.say('The logo is live, but no colours could be read from it — pick them under League colours.', 'warn');
      return;
    }
    const b = pal.secondary || T.derived(pal.primary);
    const r = await o.sb.rpc('set_league_colours', {
      p_league: o.league.id, p_colour_a: pal.primary, p_colour_b: b, p_source: 'logo', p_force: !!force });
    if (r.error) return o.say(missingFn(r.error) ? NEEDS_0122 : r.error.message, 'err');
    await loadColours();
    if (r.data === 'kept') {
      o.say('The logo is live. The colours you picked are kept — “use the logo’s colours” switches to it.', 'ok');
    } else {
      o.say('The logo is live, and the league’s colours are now ' + pal.primary + ' and ' + b +
            ' from it. Reload the league’s page to see them.', 'ok');
    }
  }

  lgFile.addEventListener('change', async () => {
    const f = lgFile.files && lgFile.files[0];
    lgFile.value = '';
    if (!f) return;
    if (!window.EpinoiaUpload) return o.say('The uploader did not load.', 'err');
    lgPick.disabled = true;
    try {
      /* Is publish_league_logo there? A database without 0122 answers "no such function"; one
         with it refuses the all-zero id as "no such image" before anything else happens. */
      const probe = await o.sb.rpc('publish_league_logo', { p_media: '00000000-0000-0000-0000-000000000000' });
      if (missingFn(probe.error)) {
        /* the old way: the approval queue, and no colours until the migration is in */
        const up = await window.EpinoiaUpload.upload(o.sb, {
          file: f, ownerType: 'league', ownerId: o.league.id, kind: 'logo' });
        if (!up || !up.storage_path) throw new Error('the upload returned no path');
        lgPrev.textContent = 'uploaded — approve it in Photographs';
        lgRm.hidden = false;
        o.say('Logo uploaded and queued for approval. ' + NEEDS_0122.replace('try again', 'upload it again to publish it at once and read its colours'), 'warn');
      } else {
        const up = await window.EpinoiaUpload.upload(o.sb, {
          file: f, ownerType: 'league', ownerId: o.league.id, kind: 'logo', bucket: 'media-public' });
        if (!up || !up.storage_path) throw new Error('the upload returned no path');
        const pub = await o.sb.rpc('publish_league_logo', { p_media: up.id });
        if (pub.error) throw new Error(pub.error.message);
        const orphans = (pub.data && pub.data.orphans) || [];
        if (orphans.length) {
          o.sb.storage.from('media-public').remove(orphans).catch(() => {});
          o.sb.storage.from('media-pending').remove(orphans).catch(() => {});
        }
        paintLogo(up.storage_path, 'live');
        await readLogoColours(up.storage_path, false);
      }
    } catch (e) {
      o.say('Upload failed: ' + (e.message || e), 'err');
    }
    lgPick.disabled = false;
  });

  /* ---- league colours ---- */
  host.appendChild(el('div', 'fmt-h', 'League colours'));
  host.appendChild(el('p', 'empty',
    'The league’s two colours: a wash behind its name, the selected tab, the hairlines and a ' +
    'stripe along the top of the sidebar, on the league’s front page and its table and ' +
    'fixtures page (the sidebar goes back to normal on every other page). Read from the logo ' +
    'when one is uploaded, or pick your own — colours you pick are never replaced by a logo.'));
  const lcRow = el('div', 'row');
  const lcA = el('input', 'ep-input'); lcA.type = 'color'; lcA.value = '#93f2bf';
  lcA.style.cssText = 'flex:0 0 46px;padding:3px'; lcA.title = 'primary colour';
  const lcB = el('input', 'ep-input'); lcB.type = 'color'; lcB.value = '#8ff5ff';
  lcB.style.cssText = 'flex:0 0 46px;padding:3px'; lcB.title = 'secondary colour';
  const lcTrim = el('span');
  lcTrim.style.cssText = 'display:inline-block;width:120px;height:10px;border-radius:2px;vertical-align:middle';
  const lcState = el('span', 'mt');
  lcRow.append(lcA, lcB, lcTrim, lcState);
  host.appendChild(lcRow);
  const lcBar = el('div', 'row');
  const lcSave = el('button', 'ep-btn mini', 'save these colours'); lcSave.type = 'button';
  const lcLogo = el('button', 'ep-btn mini', 'use the logo’s colours'); lcLogo.type = 'button';
  const lcClear = el('button', 'ep-btn mini', 'no league colours'); lcClear.type = 'button';
  lcClear.title = 'back to the platform’s own colours';
  lcBar.append(lcSave, lcLogo, lcClear);
  host.appendChild(lcBar);

  let lgRowData = null;
  const drawTrim = () => {
    lcTrim.style.background = 'linear-gradient(90deg,' + lcA.value + ' 0 72%,' + lcB.value + ' 72% 88%,' + lcA.value + ' 88%)';
  };
  lcA.addEventListener('input', drawTrim);
  lcB.addEventListener('input', drawTrim);

  async function loadColours() {
    const r = await o.sb.from('leagues').select('*').eq('id', o.league.id).maybeSingle();
    if (r.error || !r.data) return;
    lgRowData = r.data;
    lcA.value = /^#[0-9a-f]{6}$/i.test(r.data.colour_a || '') ? r.data.colour_a : '#93f2bf';
    lcB.value = /^#[0-9a-f]{6}$/i.test(r.data.colour_b || '') ? r.data.colour_b : '#8ff5ff';
    drawTrim();
    const src = r.data.colour_source;
    lcState.textContent = src === 'logo' ? 'read from the logo'
      : src === 'manual' ? 'picked by hand'
      : src === undefined ? 'needs migration 0122'
      : r.data.logo_path ? 'not read from the logo yet' : 'none — the platform’s colours';
    lcLogo.disabled = !r.data.logo_path;
  }

  const saveColours = async (source, a, b, force) => {
    const r = await o.sb.rpc('set_league_colours', {
      p_league: o.league.id, p_colour_a: a, p_colour_b: b, p_source: source, p_force: !!force });
    if (r.error) { o.say(missingFn(r.error) ? NEEDS_0122 : r.error.message, 'err'); return false; }
    await loadColours();
    return true;
  };
  lcSave.addEventListener('click', async () => {
    lcSave.disabled = true;
    if (await saveColours('manual', lcA.value, lcB.value)) {
      o.say('Saved — the league’s pages use these colours now.', 'ok');
    }
    lcSave.disabled = false;
  });
  lcLogo.addEventListener('click', async () => {
    if (!lgRowData || !lgRowData.logo_path) return o.say('Upload a logo first.', 'warn');
    lcLogo.disabled = true;
    await readLogoColours(lgRowData.logo_path, true);
    lcLogo.disabled = !(lgRowData && lgRowData.logo_path);
  });
  lcClear.addEventListener('click', async () => {
    lcClear.disabled = true;
    if (await saveColours('default', null, null)) {
      o.say('Cleared — the league’s pages are in the platform’s colours again.', 'ok');
    }
    lcClear.disabled = false;
  });
  loadColours();

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
  host.appendChild(el('div', 'fmt-h', 'Page and sidebar colours (advanced)'));
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
