'use strict';
/* ============================================================================
   THE DASHBOARD (profile/, 2026-10-02): a fan's PROFILE as one screen of everything that is theirs.

     THE HEAD      theirs to make (0224): a title over the page, their picture or initial in their colour, a banner
                   (glow, plain, stripes, grid, or the colours of the first club they follow) and light or dark.
                   "customise" opens the form; every change shows at once and is kept on save (set_dashboard for the
                   title and the banner, set_fan_prefs for the colour and the look, the same row /me/ writes).
                   Under it, at a glance: new reports, and how many leagues, clubs and players they follow.
     REPORTS       (0225) only for an account hooked up to the report mailer: every game analysis, scouting report
                   and team report made for it, newest first, each with its kind, the day it was made and NEW until
                   it is opened; Open and Download ask storage for a five-minute signed link to the private file,
                   and opening marks it (report_seen).
     COMING UP     the next games of the leagues and clubs followed, as HOME's fixture cards (globalgames.js)
     LEAGUES       a tile each: the badge, the name, the next game
     CLUBS         a tile each: the crest, the league, the last result (won or lost) and the next game
     PLAYERS       a tile each: the picture, the club, the latest line and when it was
     ARENAS        EPINOIA GO: every arena they have stamped, ticked off (their own stamps; go/arenaticks.js), the one
                   just stamped (?ticked=) landing
   The follow lists are fan_prefs' own (the bells on every league, club and player page write them). Every read
   failing leaves its section away rather than the page broken, and a database without 0224/0225 draws the rest.

     window.EpinoiaDashboard.mount({ sb, session })   -> Promise
   The pure helpers are exported for supabase/tests/dashboard-ui.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaDashboard = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = v => (Array.isArray(v) ? v : []).filter(x => UUID.test(String(x)));
const list = a => a.map(x => '"' + x + '"').join(',');
const HEX = /^#[0-9a-f]{6}$/i;
/* /me/'s swatches, so the two pages offer the same colours */
const SWATCHES = ['#93f2bf', '#8ff5ff', '#ffd166', '#ff7ab8', '#b7a8ff', '#ff5f6b', '#63ffa0', '#ffffff', '#ff9f43', '#5ab8ff'];
const BANNERS = [['glow', 'glow'], ['plain', 'plain'], ['stripes', 'stripes'], ['grid', 'grid'], ['club', 'club colours']];
const BANNER_KEYS = BANNERS.map(b => b[0]);
const DEFAULT_TITLE = 'Your dashboard';
const KINDS = {
  game: { label: 'Game analysis', seg: 'Games' },
  opp: { label: 'Scouting report', seg: 'Scouting' },
  team: { label: 'Team report', seg: 'Team' }
};
const PAGE = 12;
const DAY = 864e5;

/* ------------------------------------------------------------- the words --- */
const kindOf = k => KINDS[k] || { label: 'Report', seg: 'Other' };
function sizeWords(b) {
  const n = Number(b);
  if (!(n > 0)) return '';
  return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
}
/* "Today", "Yesterday", "Fri 2 Oct", with the year when it is not this one */
function dayWords(iso, now = Date.now()) {
  const d = new Date(iso || '');
  if (!isFinite(d.getTime())) return '';
  const day = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const diff = Math.round((day(now) - day(d)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date(now).getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('en-GB', o);
}
const fileName = f => String((f && f.path) || 'report.pdf').split('/').pop();
const initialOf = s => { const m = String(s || '').replace(/^@/, '').match(/[A-Za-z0-9À-ɏ]/); return m ? m[0].toUpperCase() : '·'; };
const isNew = f => !!f && !f.seen_at;
/* the title the head shows: the fan's, else the page's */
const titleOf = prefs => (prefs && typeof prefs.dash_title === 'string' && prefs.dash_title.trim()) || DEFAULT_TITLE;
const bannerOf = prefs => (prefs && BANNER_KEYS.indexOf(prefs.dash_banner) >= 0 ? prefs.dash_banner : 'glow');

/* a final from one club's side: won or lost, the score theirs first, the opponent */
function resultOf(g, teamId) {
  if (!g || g.home_score == null || g.away_score == null) return null;
  const home = (g.home && g.home.id) === teamId || g.home_team_id === teamId;
  const us = home ? g.home_score : g.away_score, them = home ? g.away_score : g.home_score;
  const opp = home ? g.away : g.home;
  return { won: us > them, drawn: us === them, us, them, home, opp: (opp && (opp.short_name || opp.name)) || 'opponent' };
}
/* a player's line as pieces, each a number and its label: points, rebounds (both ends), assists (and minutes when there
   are any). Pieces, so a narrow screen wraps between them and never inside one ("30 / MIN"). */
function lineBits(s) {
  if (!s) return [];
  const n = v => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
  const pts = n(s.pts), reb = n(s.or) != null || n(s.dr) != null ? (n(s.or) || 0) + (n(s.dr) || 0) : n(s.reb), ast = n(s.ast);
  const bits = [];
  if (pts != null) bits.push({ n: String(pts), k: 'PTS' });
  if (reb != null) bits.push({ n: String(reb), k: 'REB' });
  if (ast != null) bits.push({ n: String(ast), k: 'AST' });
  /* minutes are stored as milliseconds on the clock (a game is 2,400,000); an older row in minutes is read as it is */
  let min = n(s.min);
  if (min != null && min > 100) min = min / 60000;
  if (min != null && min >= 0.5) bits.push({ n: String(Math.round(min)), k: 'MIN' });
  return bits;
}
const lineOf = s => lineBits(s).map(b => b.n + ' ' + b.k).join(' · ');
/* the latest line of each player among the rows (any order) */
function latestLines(rows) {
  const by = {};
  (rows || []).forEach(r => {
    const g = r.games || {}, t = Date.parse(g.tipoff_at || '') || 0, id = r.player_uuid;
    if (!id || g.status && g.status !== 'final') return;
    if (!by[id] || t > by[id].t) by[id] = { t, r };
  });
  const out = {};
  Object.keys(by).forEach(id => { out[id] = by[id].r; });
  return out;
}
/* the tiles at a glance: what is new first, then what is followed; nothing that is zero but the follows */
function glance(c) {
  const out = [];
  if (c.reports != null) out.push({ href: '#reports', n: c.newReports || 0, label: c.newReports === 1 ? 'new report' : 'new reports', hot: (c.newReports || 0) > 0 });
  out.push({ href: '#leagues', n: c.leagues || 0, label: c.leagues === 1 ? 'league' : 'leagues' });
  out.push({ href: '#clubs', n: c.clubs || 0, label: c.clubs === 1 ? 'club' : 'clubs' });
  out.push({ href: '#players', n: c.players || 0, label: c.players === 1 ? 'player' : 'players' });
  return out;
}

/* ------------------------------------------------------------------ DOM --- */
const doc = root.document;
const $ = s => doc.querySelector(s);
function el(tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const show = (sel, on) => { const n = typeof sel === 'string' ? $(sel) : sel; if (n) n.classList.toggle('hide', !on); };
const https = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || '').trim());

let S = null;   // the page's state: sb, prefs, fan, counts, files

/* ------------------------------------------------------------- the head --- */
function paintHead() {
  const h = $('#dashHead');
  if (!h) return;
  const p = S.prefs, f = S.fan || {};
  const title = titleOf(p);
  $('#dashTitle').textContent = title;
  try { doc.title = (title === DEFAULT_TITLE ? 'Profile' : title) + ' · Epinoia'; } catch (_) { /* a nicety */ }
  const who = f.username ? '@' + f.username : (S.email || '');
  const kick = $('#dashKick');
  kick.textContent = '';
  if (f.username && f.public) {
    const a = el('a', null, who); a.href = '../fan/?u=' + encodeURIComponent(f.username); a.setAttribute('translate', 'no');
    kick.append(a, doc.createTextNode(' · your hub'));
  } else kick.textContent = who ? who + ' · your hub' : 'Your hub';
  const c = HEX.test(p.colour || '') ? p.colour : '#93f2bf';
  h.style.setProperty('--dash-c', c);
  h.setAttribute('data-banner', bannerOf(p));
  const club = S.firstClub;
  h.style.setProperty('--dash-c1', HEX.test((club && club.colour) || '') ? club.colour : c);
  h.style.setProperty('--dash-c2', HEX.test((club && club.colour_2) || '') ? club.colour_2 : 'transparent');
  const av = $('#dashAv');
  av.textContent = '';
  const pic = https(f.avatar_url) ? f.avatar_url : null;
  if (pic) { const i = el('img'); i.alt = ''; i.src = pic; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => { i.remove(); av.textContent = initialOf(f.name || who); }, { once: true }); av.appendChild(i); }
  else av.textContent = initialOf(f.name || f.username || S.email);
}

function paintGlance() {
  const host = $('#dashGlance');
  if (!host) return;
  host.textContent = '';
  glance(S.counts).forEach(t => {
    const a = el('a', 'dash-gl' + (t.hot ? ' hot' : ''));
    a.href = t.href;
    a.append(el('b', null, String(t.n)), el('span', null, t.label));
    host.appendChild(a);
  });
  show(host, true);
}

/* the look the head and the page wear, as /me/ applies it */
function applyTheme(t) {
  if (t === 'light') doc.documentElement.setAttribute('data-theme', 'light');
  else doc.documentElement.removeAttribute('data-theme');
  if (root.epinoiaColourScheme) root.epinoiaColourScheme(t === 'light');
  try { root.localStorage.setItem('epinoia_theme', t === 'light' ? 'light' : 'dark'); } catch (_) { /* private mode */ }
}

let wiredCustom = false, wiredReports = false;   // a second mount (a username just chosen) redraws, never rewires
function wireCustomise() {
  const form = $('#dashCustom'), btn = $('#dashEdit');
  if (!form || !btn || wiredCustom) return;
  wiredCustom = true;
  show(btn, true);
  let draft = null, before = null;
  const say = (t, k) => { const m = $('#dcMsg'); m.textContent = t || ''; m.className = 'dash-msg' + (k ? ' ' + k : ''); };
  const seg = (host, keys, cur, onPick) => {
    host.textContent = '';
    keys.forEach(([k, label]) => {
      const b = el('button', null, label); b.type = 'button'; b.dataset.k = k;
      b.setAttribute('aria-pressed', String(k === cur));
      b.addEventListener('click', () => { [...host.children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); onPick(k); });
      host.appendChild(b);
    });
  };
  const preview = () => { Object.assign(S.prefs, draft); paintHead(); };
  const swatches = () => {
    const host = $('#dcSwatches'); host.textContent = '';
    const all = SWATCHES.indexOf(draft.colour) >= 0 || !HEX.test(draft.colour || '') ? SWATCHES : SWATCHES.concat([draft.colour]);
    all.forEach(c => {
      const s = el('button', 'swatch' + (c === draft.colour ? ' on' : '')); s.type = 'button'; s.style.background = c; s.title = c;
      s.setAttribute('aria-label', 'colour ' + c); s.setAttribute('aria-pressed', String(c === draft.colour));
      s.addEventListener('click', () => { draft.colour = c; swatches(); preview(); });
      host.appendChild(s);
    });
    const pick = el('input', 'ep-input dash-pick'); pick.type = 'color'; pick.value = HEX.test(draft.colour || '') ? draft.colour : '#93f2bf';
    pick.title = 'any colour'; pick.setAttribute('aria-label', 'any colour');
    pick.addEventListener('input', () => { draft.colour = pick.value; preview(); });
    pick.addEventListener('change', () => swatches());
    host.appendChild(pick);
  };
  const open = () => {
    /* the look as the page shows it now (this browser's choice can differ from the row's) */
    const shown = doc.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    before = { dash_title: S.prefs.dash_title || null, dash_banner: bannerOf(S.prefs), colour: S.prefs.colour, theme: shown };
    draft = Object.assign({}, before);
    $('#dcTitle').value = before.dash_title || '';
    swatches();
    seg($('#dcBanner'), BANNERS, draft.dash_banner, k => { draft.dash_banner = k; preview(); });
    seg($('#dcTheme'), [['dark', 'dark'], ['light', 'light']], draft.theme, k => { draft.theme = k; applyTheme(k); preview(); });
    say('');
    show(form, true); btn.setAttribute('aria-expanded', 'true');
    try { $('#dcTitle').focus({ preventScroll: true }); } catch (_) { /* old browser */ }
  };
  const close = revert => {
    if (revert && before) { Object.assign(S.prefs, before); applyTheme(before.theme); paintHead(); }
    show(form, false); btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => (form.classList.contains('hide') ? open() : close(true)));
  $('#dcCancel').addEventListener('click', () => close(true));
  $('#dcTitle').addEventListener('input', () => { draft.dash_title = $('#dcTitle').value.replace(/\s+/g, ' ').trim() || null; preview(); });
  form.addEventListener('keydown', e => { if (e.key === 'Escape') close(true); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const save = $('#dcSave');
    save.disabled = true; say('Saving…');
    try {
      const a = await S.sb.rpc('set_dashboard', { p_title: draft.dash_title || '', p_banner: draft.dash_banner });
      if (a.error) throw a.error;
      const b = await S.sb.rpc('set_fan_prefs', { p: { colour: draft.colour, theme: draft.theme } });
      if (b.error) throw b.error;
      S.prefs.dash_title = a.data && a.data.title || null;
      S.prefs.dash_banner = (a.data && a.data.banner) || draft.dash_banner;
      paintHead();
      before = null;
      say('Saved.', 'ok');
      setTimeout(() => close(false), 700);
    } catch (err) {
      const m = String((err && err.message) || err || '');
      say(/set_dashboard|schema cache|could not find/i.test(m) ? 'Not saved: the dashboard is not switched on yet (migration 0224).' : 'Not saved: ' + m, 'bad');
    } finally { save.disabled = false; }
  });
}

/* ------------------------------------------------------------- reports --- */
async function signed(f, download) {
  const st = S.sb.storage.from('reports');
  const r = await st.createSignedUrl(f.path, 300, download ? { download: fileName(f) } : undefined);
  if (r.error || !r.data || !r.data.signedUrl) throw new Error((r.error && r.error.message) || 'no link');
  return r.data.signedUrl;
}
async function seen(list) {
  const fresh = list.filter(isNew);
  if (!fresh.length) return;
  const now = new Date().toISOString();
  fresh.forEach(f => { f.seen_at = now; });
  S.counts.newReports = S.files.filter(isNew).length;
  paintGlance(); paintReports();
  try { await S.sb.rpc('report_seen', { p_ids: fresh.map(f => f.id) }); } catch (_) { /* shown as opened here; asked again next time */ }
}
let repKind = 'all', repShown = PAGE;
function reportRow(f) {
  const k = kindOf(f.kind);
  const a = el('article', 'rep' + (isNew(f) ? ' is-new' : ''));
  a.dataset.kind = f.kind;
  const top = el('div', 'rep-top');
  top.appendChild(el('span', 'rep-kind', k.label));
  if (isNew(f)) top.appendChild(el('span', 'rep-new', 'New'));
  const t = el('time', 'rep-when', dayWords(f.made_at));
  t.dateTime = f.made_at || '';
  try { t.title = new Date(f.made_at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' }); } catch (_) { /* the words are enough */ }
  top.appendChild(t);
  a.appendChild(top);
  a.appendChild(el('h3', 'rep-t', f.title || k.label));
  if (f.subtitle) a.appendChild(el('p', 'rep-s', f.subtitle));
  const meta = [f.club ? 'for ' + f.club : '', 'PDF' + (sizeWords(f.bytes) ? ', ' + sizeWords(f.bytes) : '')].filter(Boolean).join(' · ');
  a.appendChild(el('p', 'rep-m', meta));
  const acts = el('div', 'rep-acts');
  const op = el('button', 'ep-btn pri mini', 'Open'); op.type = 'button';
  const dl = el('button', 'ep-btn mini', 'Download'); dl.type = 'button';
  const msg = el('span', 'rep-msg'); msg.setAttribute('role', 'status');
  op.addEventListener('click', async () => {
    /* the tab is opened in the click itself, so no blocker stops it, and pointed at the file once the link is back */
    let w = null;
    try { w = root.open('', '_blank'); } catch (_) { w = null; }
    op.disabled = true; msg.textContent = 'Opening…';
    try {
      const url = await signed(f, false);
      if (w) { try { w.opener = null; } catch (_) { /* fine */ } w.location.href = url; } else root.location.href = url;
      msg.textContent = '';
      seen([f]);
    } catch (e) { if (w) w.close(); msg.textContent = 'Could not open it just now. Try again.'; }
    finally { op.disabled = false; }
  });
  dl.addEventListener('click', async () => {
    dl.disabled = true; msg.textContent = 'Preparing…';
    try {
      const url = await signed(f, true);
      const x = el('a'); x.href = url; x.rel = 'noopener'; x.download = fileName(f);
      doc.body.appendChild(x); x.click(); x.remove();
      msg.textContent = '';
      seen([f]);
    } catch (e) { msg.textContent = 'Could not download it just now. Try again.'; }
    finally { dl.disabled = false; }
  });
  acts.append(op, dl, msg);
  a.appendChild(acts);
  return a;
}
function paintReports() {
  const host = $('#repList');
  if (!host || !S.files) return;
  const kinds = ['all'].concat(Object.keys(KINDS).filter(k => S.files.some(f => f.kind === k)));
  const segHost = $('#repKinds');
  segHost.textContent = '';
  if (kinds.length > 2) {
    kinds.forEach(k => {
      const b = el('button', null, k === 'all' ? 'All' : kindOf(k).seg); b.type = 'button';
      b.setAttribute('aria-pressed', String(k === repKind));
      b.addEventListener('click', () => { repKind = k; repShown = PAGE; paintReports(); });
      segHost.appendChild(b);
    });
  }
  show(segHost, kinds.length > 2);
  const rows = S.files.filter(f => repKind === 'all' || f.kind === repKind);
  host.textContent = '';
  if (!S.files.length) {
    const e = el('div', 'pg-empty');
    e.appendChild(el('p', null, 'Your reports arrive here as they are made: a game analysis after each of your club\'s games, ' +
      'and on Sunday mornings the scouting reports on the week\'s opponents.'));
    host.appendChild(e);
  }
  rows.slice(0, repShown).forEach(f => host.appendChild(reportRow(f)));
  show('#repMore', rows.length > repShown);
  show('#repAllSeen', S.files.some(isNew));
}
async function loadReports() {
  let r;
  try { r = await S.sb.rpc('my_reports'); } catch (_) { return; }
  if (r.error || !r.data || !r.data.linked) return;               // no 0225, or no address of theirs: no section
  S.files = Array.isArray(r.data.files) ? r.data.files : [];
  S.counts.reports = S.files.length;
  S.counts.newReports = S.files.filter(isNew).length;
  paintReports();
  show('#reports', true);
  paintGlance();
  if (!wiredReports) {
    wiredReports = true;
    $('#repMore').addEventListener('click', () => { repShown += PAGE; paintReports(); });
    $('#repAllSeen').addEventListener('click', () => seen(S.files));
  }
  if (location.hash === '#reports') { try { $('#reports').scrollIntoView({ block: 'start' }); } catch (_) { /* old browser */ } }
}

/* ------------------------------------------------------------- follows --- */
function empty(host, text) {
  const e = el('div', 'pg-empty');
  e.appendChild(el('p', null, text));
  host.appendChild(e);
}
const nextWords = (g, G) => g ? (G.dayLabel(g.tipoff_at) + ' · ' + G.timeLabel(g.tipoff_at)) : '';
const teamName = t => (t && (t.name || t.short_name)) || '';

function leagueTile(l, next, G) {
  const a = el('a', 'dash-tile dash-lg');
  a.href = '../?l=' + encodeURIComponent(l.slug || '');
  /* the league's own logo, or its initials in its colour where it has none (or the picture fails) */
  const b = el('span', 'dash-badge');
  const mono = () => { b.textContent = ''; const m = el('span', 'dash-mono', String(l.name || 'L').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase());
    if (HEX.test(l.colour_a || '')) m.style.background = l.colour_a; b.appendChild(m); };
  const logo = root.epinoiaLogoUrl && l.logo_path ? root.epinoiaLogoUrl(l.logo_path, 104) : null;
  if (logo) { const i = el('img'); i.alt = ''; i.loading = 'lazy'; i.src = logo; i.addEventListener('error', mono, { once: true }); b.appendChild(i); }
  else mono();
  const tx = el('span', 'dash-tx');
  tx.append(el('b', 'dash-nm', l.name || 'League'), el('span', 'dash-sub', l.country || ''));
  if (next) {
    const n = el('span', 'dash-next');
    n.append(el('i', null, 'Next'), doc.createTextNode(' ' + nextWords(next, G) + ' · ' + teamName(next.home) + ' v ' + teamName(next.away)));
    tx.appendChild(n);
  } else tx.appendChild(el('span', 'dash-next quiet', 'No game in the diary yet'));
  a.append(b, tx);
  return a;
}
function clubTile(t, last, next, G) {
  const a = el('a', 'dash-tile dash-cl');
  a.href = '../t/?t=' + encodeURIComponent(t.slug || t.id);
  if (HEX.test(t.colour || '')) a.style.setProperty('--tc', t.colour);
  const c = el('span', 'dash-crest');
  if (root.epinoiaCrest) c.appendChild(root.epinoiaCrest(t));
  const tx = el('span', 'dash-tx');
  const lg = t.leagues && (Array.isArray(t.leagues) ? t.leagues[0] : t.leagues);
  tx.append(el('b', 'dash-nm', t.name), el('span', 'dash-sub', (lg && lg.name) || ''));
  const r = resultOf(last, t.id);
  if (r) {
    const l = el('span', 'dash-res ' + (r.won ? 'w' : r.drawn ? 'd' : 'l'));
    l.append(el('i', null, r.won ? 'W' : r.drawn ? 'D' : 'L'), doc.createTextNode(' ' + r.us + '–' + r.them + (r.home ? ' v ' : ' at ') + r.opp));
    tx.appendChild(l);
  }
  if (next) {
    const home = (next.home && next.home.id) === t.id;
    const opp = home ? next.away : next.home;
    const n = el('span', 'dash-next');
    n.append(el('i', null, next.status === 'live' ? 'Live' : 'Next'), doc.createTextNode(' ' + nextWords(next, G) + (home ? ' v ' : ' at ') + teamName(opp)));
    tx.appendChild(n);
  } else if (!r) tx.appendChild(el('span', 'dash-next quiet', 'No game in the diary yet'));
  a.append(c, tx);
  return a;
}
function playerTile(id, m, row) {
  const a = el('a', 'dash-tile dash-pl');
  a.href = '../p/?p=' + encodeURIComponent((m && m.slug) || id);
  /* data.js playerMeta: the club flattened onto the player (teamFull, colour) */
  const team = { name: m && (m.teamFull || m.teamName), colour: m && m.colour };
  if (HEX.test(team.colour || '')) a.style.setProperty('--tc', team.colour);
  const ph = el('span', 'dash-ph');
  if (m && https(m.photo_url)) { const i = el('img'); i.alt = ''; i.loading = 'lazy'; i.src = m.photo_url; i.addEventListener('error', () => { i.remove(); ph.textContent = initialOf(m.name); }, { once: true }); ph.appendChild(i); }
  else ph.textContent = initialOf(m && m.name);
  const tx = el('span', 'dash-tx');
  tx.append(el('b', 'dash-nm', (m && m.name) || 'Player'), el('span', 'dash-sub', [team.name, m && m.position].filter(Boolean).join(' · ')));
  if (row) {
    const g = row.games || {};
    const home = row.team_idx === 0;
    const opp = home ? g.away : g.home;
    const s = { pts: row.s_pts, or: row.s_or, dr: row.s_dr, ast: row.s_ast, min: row.s_min };
    /* the line (points, rebounds, assists, minutes), then where and when on a line of its own: "at" never dangles */
    const line = el('span', 'dash-line');
    const bits = lineBits(s);
    if (bits.length) bits.forEach(b => { const c = el('span'); c.append(el('b', null, b.n), doc.createTextNode(' ' + b.k)); line.appendChild(c); });
    else line.appendChild(el('span', null, 'Played'));
    tx.append(line, el('span', 'dash-when', (home ? 'v ' : 'at ') + teamName(opp) + ' · ' + dayWords(g.tipoff_at)));
  } else tx.appendChild(el('span', 'dash-next quiet', 'No game in the last two months'));
  a.append(ph, tx);
  return a;
}

async function loadFollows() {
  const G = root.EpinoiaGlobalGames, D = root.EpinoiaData;
  const p = S.prefs;
  const L = ids(p.fav_league_ids), T = ids(p.fav_team_ids), P = ids(p.fav_player_ids);
  S.counts.leagues = L.length; S.counts.clubs = T.length; S.counts.players = P.length;
  paintGlance();
  ['#leagues', '#clubs', '#players'].forEach(s => show(s, true));
  if (!G) return;
  const SEL = G.SEL + ',home_team_id,away_team_id';
  const from = new Date(Date.now() - G.STALE_MS).toISOString(), back = new Date(Date.now() - 45 * DAY).toISOString();
  const safe = q => G.request(q, false).catch(() => []);
  const soonQ = [], finalQ = [];
  const tail = '&status=in.(scheduled,live)&tipoff_at=gte.' + encodeURIComponent(from) + '&order=tipoff_at.asc,id.asc&limit=200';
  if (L.length) soonQ.push(safe('games?select=' + SEL + '&competitions.seasons.leagues.id=in.(' + list(L) + ')' + tail));
  if (T.length) {
    const mine = '&or=(home_team_id.in.(' + list(T) + '),away_team_id.in.(' + list(T) + '))';
    soonQ.push(safe('games?select=' + SEL + mine + tail));
    finalQ.push(safe('games?select=' + SEL + mine + '&status=eq.final&tipoff_at=gte.' + encodeURIComponent(back) + '&order=tipoff_at.desc,id.desc&limit=200'));
  }
  const [soon, finals, leagues, teams] = await Promise.all([
    Promise.all(soonQ).then(rs => G.dedupe([].concat.apply([], rs))),
    Promise.all(finalQ).then(rs => G.dedupe([].concat.apply([], rs))),
    L.length ? G.leagues().catch(() => []) : Promise.resolve([]),
    T.length ? safe('teams?id=in.(' + list(T) + ')&select=id,slug,name,short_name,colour,colour_2,logo_path,leagues(name,slug)') : Promise.resolve([])
  ]);
  const at = g => Date.parse((g && g.tipoff_at) || '') || 0;
  soon.sort((a, b) => at(a) - at(b));
  finals.sort((a, b) => at(b) - at(a));

  /* COMING UP */
  const grid = $('#soonGrid');
  grid.textContent = '';
  soon.slice(0, 8).forEach(g => grid.appendChild(G.card(g, { base: '../' })));
  if (grid.childElementCount) { if (G.wireBadges) G.wireBadges(grid); show('#soon', true); }

  /* LEAGUES */
  const lg = $('#lgGrid');
  lg.textContent = '';
  const byId = new Map((leagues || []).map(l => [l.id, l]));
  L.map(id => byId.get(id)).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach(l => lg.appendChild(leagueTile(l, soon.find(g => { const x = G.leagueOf(g); return x && x.id === l.id; }), G)));
  if (!lg.childElementCount) empty(lg, 'You do not follow a league yet. The bell on a league\'s page follows it, and its games appear here.');

  /* CLUBS */
  const cl = $('#clGrid');
  cl.textContent = '';
  const tm = new Map((teams || []).map(t => [t.id, t]));
  const ordered = T.map(id => tm.get(id)).filter(Boolean);
  S.firstClub = ordered[0] || null;
  paintHead();
  ordered.forEach(t => {
    const mine = g => (g.home && g.home.id) === t.id || (g.away && g.away.id) === t.id || g.home_team_id === t.id || g.away_team_id === t.id;
    cl.appendChild(clubTile(t, finals.find(mine), soon.find(mine), G));
  });
  if (!cl.childElementCount) empty(cl, 'You do not follow a club yet. Follow one with the bell on its page, or in personalisation.');

  /* PLAYERS */
  const pl = $('#plGrid');
  pl.textContent = '';
  if (!P.length) { empty(pl, 'You do not follow a player yet. The bell on a player\'s page follows them, and their latest line appears here.'); return; }
  let meta = {}, lines = {};
  try {
    const [m, rows] = await Promise.all([
      D && D.playerMeta ? D.playerMeta(P).catch(() => ({})) : Promise.resolve({}),
      safe('player_game_stats?player_uuid=in.(' + list(P) + ')&select=game_id,player_uuid,team_idx,s_pts:stats->pts,s_or:stats->or,s_dr:stats->dr,' +
        's_ast:stats->ast,s_min:stats->min,games!inner(tipoff_at,status,home:home_team_id(name,short_name),away:away_team_id(name,short_name))' +
        '&games.tipoff_at=gte.' + encodeURIComponent(new Date(Date.now() - 60 * DAY).toISOString()) + '&limit=600')
    ]);
    meta = m || {}; lines = latestLines(rows);
  } catch (_) { /* tiles without lines */ }
  P.forEach(id => pl.appendChild(playerTile(id, meta[id], lines[id])));
}

/* ---------------------------------------------------------------- mount --- */
async function mount(o) {
  const sb = o && o.sb;
  if (!sb || !doc) return;
  S = { sb, prefs: {}, fan: null, counts: {}, files: null, firstClub: null,
        email: (o.session && o.session.user && o.session.user.email) || '' };
  const [pr, fp] = await Promise.all([
    sb.from('fan_prefs').select('*').maybeSingle().then(r => r, () => ({ data: null })),
    sb.rpc('my_fan_profile').then(r => r, () => ({ data: null }))
  ]);
  S.prefs = (pr && pr.data) || { colour: '#93f2bf', theme: 'dark', fav_league_ids: [], fav_team_ids: [], fav_player_ids: [] };
  S.fan = (fp && !fp.error && fp.data) || null;
  paintHead();
  wireCustomise();
  await Promise.all([loadReports(), loadFollows().catch(() => { /* the sections stay as they are */ }), loadArenas().catch(() => { /* away */ })]);
}

/* ARENAS TICKED OFF: the fan's own stamps (only they may read them, 0165), an arena a tile */
async function loadArenas() {
  const sec = doc.getElementById('arenas'), host = doc.getElementById('arGrid'), T = root.EpinoiaArenaTicks;
  if (!sec || !host || !T) return;
  const r = await S.sb.from('stamps').select('id,stamped_at,venue_id,venues(id,name,city,country)').order('stamped_at', { ascending: false }).limit(1000);
  if (r.error) return;                                   // before EPINOIA GO's tables: the section stays away
  let fresh = null;
  try { fresh = new URLSearchParams(root.location.search).get('ticked'); } catch (_) { fresh = null; }
  T.draw(host, T.group(r.data || []), { goHref: '../go/', fresh,
    empty: 'No arenas ticked off yet. Go to a game, stamp the arena with your phone, and it is ticked off here.' });
  sec.classList.remove('hide');
}

return { mount, kindOf, sizeWords, dayWords, fileName, initialOf, isNew, titleOf, bannerOf, resultOf, lineOf, lineBits, latestLines, glance,
  BANNERS, SWATCHES, DEFAULT_TITLE };
}));
