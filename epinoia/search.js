'use strict';
/* ============================================================================
   THE RAIL'S SEARCH - teams, players and leagues, across the whole site (migration 0179).

   A row at the top of the rail's foot (where the HOME row used to be) that opens into a search box:
   what is typed is matched as it is typed, the best matches listed under it as leagues, teams and
   players, each with where it is (a team's league, a player's team), and a grey completion after the
   caret that Tab or the right arrow takes. On a desktop the box opens in the rail and the list opens
   above it (fixed to the window, so the rail does not clip it); on a phone the row opens a sheet over
   the page with the box at the top, because the keyboard would cover a list opening upward.

   SMART MATCHING is the database's (site_search): words in any order with any other words between
   (no middle name needed), initials, nicknames, a club's league words, a name without its sponsor,
   accents and punctuation ignored, and - when the first look finds next to nothing - one typing
   mistake forgiven. This file asks, shows, and helps: it debounces, drops answers that arrive late,
   remembers what it was asked, asks a second time (forgiving a typing mistake) when the first look found nothing, shows the words that matched
   in bold, and keeps the last few things a fan picked.

   BEFORE 0179 IS APPLIED the function is not there: the box says so once and asks the tables
   directly (leagues and clubs by their names, players by first or last name, every word typed
   having to be in one of them), which is the same idea without the nicknames, the accents and the
   ranking, and slower for players. It works either way.

   What was searched is recorded ANONYMOUSLY for the console's Analytics tab (0180, track.js) when
   a result is picked or the box closes: the folded words, how many results there were, what was
   picked. Nothing that identifies the person; nothing at all when the browser asks not to be
   tracked, and never a query that looks like an address, a phone number or a web address.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSearch = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const MIN = 2, WAIT = 160, LIMIT = 6, FUZZY_BELOW = 1, RECENT_N = 5;
const RECENT_KEY = 'epinoia_search_recent';
const GROUPS = [['team', 'Teams'], ['player', 'Players'], ['league', 'Leagues']];
const NOISE = new Set(['jr', 'sr', 'jnr', 'snr', 'ii', 'iii', 'iv', 'junior', 'senior',
  'de', 'da', 'do', 'dos', 'das', 'del', 'della', 'di', 'van', 'von', 'der', 'den', 'la', 'le', 'el', 'al', 'bin', 'ibn']);

/* ---------------------------------------------------------------- pure --- */

const SPECIAL = { 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ħ': 'h', 'ı': 'i', 'ð': 'd', 'ŧ': 't', 'ŋ': 'n', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe' };
/* one character as the database folds it: lower case, accents off, dots and apostrophes gone, - _ / , as a space */
function foldChar(ch) {
  const l = ch.toLowerCase();
  if (SPECIAL[l]) return SPECIAL[l];
  const d = l.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^[.'’‘`%\\]$/.test(d)) return '';
  if (/^[-_/,\s]$/.test(d)) return ' ';
  return d;
}
/* the folded text and, for each of its characters, where it came from in the original */
function foldMap(s) {
  let f = '';
  const idx = [];
  const chars = Array.from(String(s == null ? '' : s));
  let pos = 0;
  chars.forEach(ch => {
    const out = foldChar(ch);
    for (const c of out) {
      if (c === ' ' && (f === '' || f[f.length - 1] === ' ')) continue;       // no leading or doubled space
      f += c; idx.push(pos);
    }
    pos += ch.length;
  });
  if (f.endsWith(' ')) { f = f.slice(0, -1); idx.pop(); }
  return { f, idx };
}
const fold = s => foldMap(s).f;

/* the words typed, folded, a suffix or a particle dropped when other words were typed (as the database does) */
function words(q) {
  const all = fold(q).split(' ').filter(Boolean);
  const kept = all.filter(w => !NOISE.has(w));
  return kept.length ? kept : all;
}

/* a name cut into what matched (bold) and what did not, [{ t, hit }] */
function segments(name, q) {
  const text = String(name == null ? '' : name);
  const m = foldMap(text);
  const marks = [];
  words(q).forEach(tok => {
    let at = -1;
    const re = new RegExp('(^| )' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const hit = re.exec(m.f);
    if (hit) at = hit.index + hit[1].length;
    else if (tok.length >= 3) at = m.f.indexOf(tok);
    if (at >= 0) marks.push([m.idx[at], m.idx[at + tok.length - 1] + 1]);
  });
  marks.sort((a, b) => a[0] - b[0]);
  const merged = [];
  marks.forEach(([a, b]) => {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  });
  const out = [];
  let at = 0;
  merged.forEach(([a, b]) => {
    if (a > at) out.push({ t: text.slice(at, a), hit: false });
    out.push({ t: text.slice(a, b), hit: true });
    at = b;
  });
  if (at < text.length) out.push({ t: text.slice(at), hit: false });
  return out.length ? out : [{ t: text, hit: false }];
}

/* what to grey in after the caret: the rest of the name, when what is typed is the start of it */
function completion(name, q) {
  const fq = fold(q);
  if (fq.length < MIN) return '';
  const m = foldMap(name);
  if (!m.f.startsWith(fq) || m.f === fq) return '';
  const rest = String(name).slice(m.idx[fq.length - 1] + 1);
  return /\s$/.test(String(q)) ? rest.replace(/^\s+/, '') : rest;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* where a result is: a league's front page, a club's page, a player's profile */
function hrefOf(base, r) {
  const b = base || '';
  if (r.kind === 'league') return b + '?l=' + encodeURIComponent(r.slug);
  if (r.kind === 'team') return b + 't/?t=' + encodeURIComponent(r.slug);
  return b + 'p/?p=' + encodeURIComponent(UUID.test(r.id || '') ? r.id : r.slug);
}

const rowKey = r => r.kind + ':' + r.id;
/* rows in the order they came, one of each, grouped for the list; near misses go after the rest of their kind */
function merge(a, b) {
  const seen = new Set(a.map(rowKey));
  return a.concat((b || []).filter(r => !seen.has(rowKey(r))).map(r => Object.assign({ close: true }, r)));
}
function grouped(rows) {
  return GROUPS.map(([kind, label]) => ({ kind, label, rows: rows.filter(r => r.kind === kind) })).filter(g => g.rows.length);
}
/* the flat order the arrow keys walk: the list as it is drawn */
const flat = rows => [].concat(...grouped(rows).map(g => g.rows));

/* the region's name in the reader's language, from its code */
function regionName(code, lang) {
  try {
    if (/^[A-Za-z]{2}$/.test(code || '') && typeof Intl !== 'undefined' && Intl.DisplayNames) {
      return new Intl.DisplayNames([lang || 'en'], { type: 'region' }).of(String(code).toUpperCase()) || '';
    }
  } catch (_) { /* the code will do */ }
  return code || '';
}
/* the line under a name: a league's country, a team's league, a player's team and league */
function subOf(r, lang) {
  if (r.kind === 'league') return regionName(r.sub, lang);
  if (r.kind === 'team') return r.league_name || '';
  return [r.sub, r.league_name].filter(Boolean).join(' · ');
}

/* ---- the tables, before 0179: the same idea with what PostgREST can say -------------------------------------------- */
const esc = s => String(s).replace(/[*,()\\:%]/g, ' ').trim();
/* every word has to be in the name (or, for a player, in his first or last name) */
function restQueries(q) {
  const toks = [].concat(...words(q).map(w => esc(w).split(/\s+/))).filter(Boolean).slice(0, 5);
  if (!toks.length) return null;
  const name = col => 'and=(' + toks.map(t => col + '.ilike.*' + encodeURIComponent(t) + '*').join(',') + ')';
  const who = 'and=(' + toks.map(t => 'or(first_name.ilike.*' + encodeURIComponent(t) + '*,last_name.ilike.*' + encodeURIComponent(t) + '*)').join(',') + ')';
  return {
    league: 'leagues?select=id,slug,name,country,colour_a,logo_path&' + name('name') + '&order=name&limit=4',
    team: 'teams?select=id,slug,name,short_name,colour,logo_path,leagues!inner(slug,name)&' + name('name') + '&order=name&limit=' + LIMIT,
    player: 'players?select=id,slug,first_name,last_name&' + who + '&order=last_name&limit=' + LIMIT
  };
}
function fromRest(kind, x) {
  if (kind === 'league') return { kind, id: x.id, name: x.name, slug: x.slug, sub: x.country || null, league_slug: x.slug, league_name: x.name, colour: x.colour_a, logo: x.logo_path, short_name: null };
  if (kind === 'team') return { kind, id: x.id, name: x.name, slug: x.slug, sub: null, league_slug: x.leagues && x.leagues.slug, league_name: x.leagues && x.leagues.name, colour: x.colour, logo: x.logo_path, short_name: x.short_name };
  return { kind, id: x.id, name: (x.first_name + ' ' + (x.last_name || '')).trim(), slug: x.slug, sub: null, league_slug: null, league_name: null, colour: null, logo: null, short_name: null };
}

/* ------------------------------------------------------------ the recents --- */
function readRecent(store) {
  try { const a = JSON.parse(store.getItem(RECENT_KEY)); return Array.isArray(a) ? a.filter(r => r && r.kind && r.id && r.name).slice(0, RECENT_N) : []; } catch (_) { return []; }
}
function keepRecent(store, r) {
  const one = { kind: r.kind, id: r.id, name: r.name, slug: r.slug, sub: r.sub, league_slug: r.league_slug, league_name: r.league_name,
                colour: r.colour, logo: r.logo, short_name: r.short_name };
  const next = [one].concat(readRecent(store).filter(x => rowKey(x) !== rowKey(one))).slice(0, RECENT_N);
  try { store.setItem(RECENT_KEY, JSON.stringify(next)); } catch (_) { /* private mode: not kept */ }
  return next;
}

/* ------------------------------------------------------------- asking --- */
let rpcState = 'unknown';                       // 'yes', 'no' (0179 is not applied) or 'unknown'
const memo = new Map();

async function askRpc(cfg, q, fuzzy, signal) {
  const r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/site_search', {
    method: 'POST', signal, headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ p_q: q, p_limit: LIMIT, p_fuzzy: !!fuzzy })
  });
  if (r.status === 404 || r.status === 400) return null;             // not there (0179 not applied)
  if (!r.ok) throw new Error('search ' + r.status);
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

/* the tables answer in three pieces (the players' is the slow one): `part` is told what there is so far, so the clubs
   and leagues are on screen while the players are still being looked for */
async function askTables(cfg, q, signal, part) {
  const qs = restQueries(q);
  if (!qs) return [];
  const get = async path => {
    try {
      const r = await fetch(cfg.supabaseUrl + '/rest/v1/' + path, { signal, headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' } });
      return r.ok ? await r.json() : [];
    } catch (e) { if (e && e.name === 'AbortError') throw e; return []; }
  };
  const acc = { league: [], team: [], player: [] };
  const tell = () => { if (part) part([].concat(acc.league, acc.team, acc.player)); };
  const leagues = get(qs.league).then(x => { acc.league = x.map(r => fromRest('league', r)); tell(); });
  const teams = get(qs.team).then(x => { acc.team = x.map(r => fromRest('team', r)); tell(); });
  const players = get(qs.player).then(async ps => {
    const rows = ps.map(x => fromRest('player', x));
    if (rows.length) {
      const ids = rows.map(p => p.id).join(',');
      const es = await get('roster_entries?select=player_id,active,created_at,teams(name,short_name,colour,logo_path,leagues(slug,name))&player_id=in.(' + ids + ')&order=active.desc,created_at.desc');
      const first = {};
      es.forEach(e => { if (!first[e.player_id] && e.teams) first[e.player_id] = e.teams; });
      rows.forEach(p => {
        const t = first[p.id];
        if (t) { p.sub = t.name; p.colour = t.colour; p.logo = t.logo_path; p.short_name = t.short_name; p.league_slug = t.leagues && t.leagues.slug; p.league_name = t.leagues && t.leagues.name; }
      });
    }
    acc.player = rows;
    tell();
  });
  await Promise.all([leagues, teams, players]);
  return [].concat(acc.league, acc.team, acc.player);
}

/* what to show for q: the function's answer (a second look for near misses), or the tables' */
async function search(cfg, q, signal, part) {
  const key = fold(q);
  if (memo.has(key)) return memo.get(key);
  let rows = null, via = 'rpc';
  if (rpcState !== 'no') {
    rows = await askRpc(cfg, q, false, signal);
    if (rows === null) rpcState = 'no'; else rpcState = 'yes';
  }
  if (rows === null) { via = 'tables'; rows = await askTables(cfg, q, signal, part); }
  let close = false;
  if (via === 'rpc' && rows.length < FUZZY_BELOW && key.length >= 4) {
    const more = await askRpc(cfg, q, true, signal);
    if (more && more.length) { const all = merge(rows, more); close = all.length > rows.length; rows = all; }
  }
  const out = { rows, via, close };
  memo.set(key, out);
  if (memo.size > 60) memo.delete(memo.keys().next().value);
  return out;
}

/* ------------------------------------------------------------------ page --- */
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/* the picture at the left of a result: a club's or league's crest, a player's initials in his club's colour */
function badge(r) {
  if (r.kind === 'player') {
    const b = el('span', 'sr-face');
    b.setAttribute('aria-hidden', 'true');
    b.setAttribute('translate', 'no');
    b.textContent = initials(r.name);
    if (/^#[0-9a-f]{6}$/i.test(r.colour || '')) b.style.setProperty('--c', r.colour);
    return b;
  }
  const t = { name: r.name, short_name: r.short_name || '', colour: r.colour, logo_path: r.logo };
  const n = root.epinoiaCrest ? root.epinoiaCrest(t, { cls: 'ep-crest sr-crest' }) : el('span', 'sr-face', initials(r.name));
  n.setAttribute('aria-hidden', 'true');
  return n;
}

function mount(host, ctx) {
  /* the site's settings, read when they are needed (a page that set them late still works) */
  const cfgNow = () => (ctx.cfg && ctx.cfg.supabaseUrl ? ctx.cfg : (root.EPINOIA_CONFIG || ctx.cfg || {}));
  const base = ctx.root || '';
  const lang = (document.documentElement.lang || 'en').slice(0, 2);
  const store = (() => { try { return root.localStorage; } catch (_) { return null; } })();
  const S = { q: '', rows: [], close: false, via: 'rpc', pending: false, active: 0, seq: 0, timer: 0, ctrl: null, opened: false,
              sheet: false, logged: false, picked: null, error: false, recent: store ? readRecent(store) : [] };

  /* ---- the field: a magnifier, the box with its grey completion, a way out ---- */
  const field = el('div', 'ep-sr-field');
  field.appendChild(el('span', 'ic', '⌕'));
  const wrap = field.appendChild(el('span', 'ep-sr-wrap'));
  const ghost = wrap.appendChild(el('span', 'ep-sr-ghost'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('translate', 'no');
  const input = wrap.appendChild(el('input', 'ep-sr-in'));
  input.type = 'text';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'both');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-label', 'Search teams, players and leagues');
  input.placeholder = 'teams, players, leagues';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'search';
  input.maxLength = 60;
  const x = field.appendChild(el('button', 'ep-sr-x'));
  x.type = 'button';
  x.textContent = '×';
  x.setAttribute('aria-label', 'Close search');
  x.title = 'Close search';

  /* ---- the list: fixed above the box on a desktop, the body of the sheet on a phone ---- */
  const list = el('div', 'ep-sr-list');
  list.id = 'epSrList';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Search results');
  const panel = el('div', 'ep-sr-panel');
  panel.hidden = true;
  panel.appendChild(list);
  const sheet = el('div', 'ep-sr-sheet');
  sheet.hidden = true;
  const sheetBar = sheet.appendChild(el('div', 'ep-sr-sbar'));
  input.setAttribute('aria-controls', 'epSrList');

  const items = () => Array.prototype.slice.call(list.querySelectorAll('.sr-o'));

  function setActive(i, scroll) {
    const os = items();
    if (!os.length) { S.active = -1; input.removeAttribute('aria-activedescendant'); return; }
    S.active = Math.max(0, Math.min(os.length - 1, i));
    os.forEach((o, k) => { o.classList.toggle('on', k === S.active); o.setAttribute('aria-selected', String(k === S.active)); });
    input.setAttribute('aria-activedescendant', os[S.active].id);
    if (scroll && os[S.active].scrollIntoView) os[S.active].scrollIntoView({ block: 'nearest' });
    paintGhost();
  }

  /* the grey rest of the top result's name, when what is typed starts it */
  function paintGhost() {
    ghost.textContent = '';
    if (!S.opened || !S.q) return;
    const rows = flat(S.rows);
    const top = rows[Math.max(0, S.active)] || rows[0];
    const rest = top ? completion(top.name, S.q) : '';
    S.completion = rest;
    if (!rest) return;
    const typed = el('i', null, input.value);
    ghost.append(typed, document.createTextNode(rest));
  }

  function sayRow(cls, text) {
    const d = el('div', 'sr-say ' + cls);
    d.appendChild(el('span', null, text));
    return d;
  }

  function optionEl(r, i) {
    const a = el('a', 'sr-o');
    a.id = 'epSrO' + i;
    a.href = hrefOf(base, r);
    a.setAttribute('role', 'option');
    a.setAttribute('aria-selected', 'false');
    a.dataset.kind = r.kind;
    a.appendChild(badge(r));
    const t = a.appendChild(el('span', 'sr-t'));
    const nm = t.appendChild(data('b', 'sr-n'));
    segments(r.name, S.q).forEach(sg => { if (sg.hit) nm.appendChild(el('mark', null, sg.t)); else nm.appendChild(document.createTextNode(sg.t)); });
    const sub = subOf(r, lang);
    if (sub) t.appendChild(data('small', 'sr-s', sub));
    a.addEventListener('mousemove', () => { if (S.active !== i) setActive(i, false); });
    a.addEventListener('click', ev => {
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) { pick(r, true); return; }
      ev.preventDefault();
      pick(r, false);
    });
    return a;
  }

  function render() {
    list.textContent = '';
    input.setAttribute('aria-expanded', String(S.opened));
    const fq = fold(S.q);
    let n = 0;
    if (fq.length < MIN) {
      if (S.recent.length) {
        list.appendChild(el('div', 'sr-h', 'Recent'));
        S.recent.forEach(r => list.appendChild(optionEl(r, n++)));
      } else {
        list.appendChild(sayRow('hint', 'Type a team, a player or a league.'));
      }
    } else {
      const gs = grouped(S.rows);
      if (gs.length) {
        gs.forEach(g => {
          list.appendChild(el('div', 'sr-h', g.label));
          g.rows.forEach(r => list.appendChild(optionEl(r, n++)));
        });
        if (S.close) list.appendChild(sayRow('near', 'Close matches are shown too.'));
        if (S.pending) list.appendChild(sayRow('busy', 'searching…'));
      } else if (S.pending) {
        list.appendChild(sayRow('busy', 'searching…'));
      } else if (S.error) {
        list.appendChild(sayRow('bad', 'Search is not available just now.'));
      } else {
        const d = el('div', 'sr-say none');
        d.appendChild(el('span', null, 'Nothing matches'));
        d.appendChild(document.createTextNode(' '));
        d.appendChild(data('b', null, '“' + S.q.trim() + '”'));
        list.appendChild(d);
      }
    }
    setActive(Math.min(S.active < 0 ? 0 : S.active, Math.max(0, n - 1)), false);
    place();
  }

  /* the list above the box, inside the window; the page is zoomed on a desktop (the kit's 1.25 / 1.5), and the list
     sits on the body, so the sums are done in screen pixels and divided back by the list's own scale */
  function place() {
    if (S.sheet) return;
    if (panel.hidden) return;
    const r = field.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    const k = panel.offsetWidth ? (b.width / panel.offsetWidth) || 1 : 1;
    const vw = root.innerWidth, vh = root.innerHeight;
    const w = Math.min(380 * k, vw - 16);
    panel.style.width = (w / k) + 'px';
    panel.style.left = (Math.max(8, Math.min(r.left, vw - w - 8)) / k) + 'px';
    panel.style.bottom = ((vh - r.top + 8) / k) + 'px';
    panel.style.maxHeight = (Math.max(140, r.top - 20) / k) + 'px';
  }

  /* ---- asking ---- */
  async function run() {
    const q = input.value;
    S.q = q;
    S.logged = false;
    S.picked = null;
    if (S.ctrl) S.ctrl.abort();
    clearTimeout(S.timer);
    if (fold(q).length < MIN) { S.rows = []; S.pending = false; S.error = false; S.close = false; render(); return; }
    S.pending = true;
    render();
    const my = ++S.seq;
    S.timer = setTimeout(async () => {
      S.ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const res = await search(cfgNow(), q, S.ctrl && S.ctrl.signal, rows => {
          if (my !== S.seq) return;
          S.rows = rows; S.via = 'tables'; S.error = false;
          render();
        });
        if (my !== S.seq) return;
        S.rows = res.rows; S.via = res.via; S.close = res.close; S.error = false;
      } catch (e) {
        if (my !== S.seq || (e && e.name === 'AbortError')) return;
        S.rows = []; S.error = true;
      }
      S.pending = false;
      S.active = 0;
      render();
    }, WAIT);
  }

  /* ---- finishing: a result picked, or the box closed ---- */
  function logIt() {
    if (S.logged) return;
    const fq = fold(S.q);
    if (fq.length < 3 || S.via === undefined) return;
    if (S.pending && !S.rows.length) return;
    S.logged = true;
    if (ctx.log) ctx.log({ q: S.q, n: S.rows.length, kind: S.picked ? S.picked.kind : null, ref: S.picked ? S.picked.slug : null });
  }

  function pick(r, newTab) {
    S.picked = r;
    if (store) S.recent = keepRecent(store, r);
    logIt();
    const href = hrefOf(base, r);
    if (newTab) { root.open(href, '_blank', 'noopener'); return; }
    close(true);
    root.location.href = href;
  }

  /* ---- opening and closing ---- */
  function open() {
    if (S.opened) { input.focus(); return; }
    S.opened = true;
    S.sheet = !!(ctx.phone && ctx.phone());
    host.classList.add('open');
    if (S.sheet) {
      if (ctx.closeSheet) ctx.closeSheet();
      sheetBar.textContent = '';
      sheetBar.appendChild(field);
      sheet.appendChild(list);
      document.body.appendChild(sheet);
      sheet.hidden = false;
      document.body.classList.add('ep-sr-locked');
    } else {
      host.appendChild(field);
      document.body.appendChild(panel);
      panel.hidden = false;
    }
    field.hidden = false;
    S.q = ''; input.value = '';
    S.recent = store ? readRecent(store) : [];
    render();
    input.focus();
  }

  function close(quiet) {
    if (!S.opened) return;
    if (!quiet) logIt();
    S.opened = false;
    clearTimeout(S.timer);
    if (S.ctrl) S.ctrl.abort();
    S.seq++;
    host.classList.remove('open');
    panel.hidden = true;
    sheet.hidden = true;
    document.body.classList.remove('ep-sr-locked');
    if (field.parentNode) field.parentNode.removeChild(field);
    if (list.parentNode !== panel) panel.appendChild(list);
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
    input.value = ''; S.q = ''; S.rows = []; ghost.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    if (ctx.closed) ctx.closed();
  }

  /* ---- the keys ---- */
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    const os = items();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(S.active + 1, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(S.active - 1, true); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0, true); }
    else if (e.key === 'Enter') {
      const o = os[S.active];
      if (o) {
        e.preventDefault();
        const rows = fold(S.q).length < MIN ? S.recent : flat(S.rows);
        const r = rows[S.active];
        if (r) pick(r, e.ctrlKey || e.metaKey);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) { input.value = ''; run(); } else { close(false); if (ctx.focusRow) ctx.focusRow(); }
    } else if ((e.key === 'Tab' && !e.shiftKey || e.key === 'ArrowRight') && S.completion &&
               input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      e.preventDefault();                                    // take the grey completion
      input.value = input.value + S.completion;
      run();
    }
  });
  x.addEventListener('click', () => { close(false); if (ctx.focusRow) ctx.focusRow(); });
  /* leaving the box for somewhere that is not the list closes it (a click on a result is handled above) */
  document.addEventListener('mousedown', e => {
    if (!S.opened || S.sheet) return;
    if (field.contains(e.target) || panel.contains(e.target) || host.contains(e.target)) return;
    close(false);
  });
  root.addEventListener('resize', () => { if (S.opened) place(); });
  root.addEventListener('pagehide', () => { if (S.opened) logIt(); });
  document.addEventListener('scroll', () => { if (S.opened && !S.sheet) place(); }, true);

  return { open, close, isOpen: () => S.opened, _state: S };
}

return { mount, fold, foldMap, words, segments, completion, hrefOf, merge, grouped, flat, regionName, subOf, restQueries, fromRest,
         readRecent, keepRecent, search, _reset() { rpcState = 'unknown'; memo.clear(); }, _consts: { MIN, WAIT, LIMIT, FUZZY_BELOW, RECENT_N } };
}));
