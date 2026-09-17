'use strict';
/* ============================================================================
   INITIALS — a club's letters, for the screens too narrow for its name.

   HOME's fixture cards on a phone have room for about four letters beside a crest. The letters
   are worked out for EVERY club in a league at once, so two clubs in one league never share
   them, and the obvious code is not simply handed to whichever club comes first:

     London Lions, London Cavaliers   both make LON, so neither gets it: LLI and LCA
                                      (unless one already carries LON: see 2 below)
     Milton Keynes Breakers            three words: MKB
     Nottingham Hoods                  NOT

   WHAT A CLUB IS CALLED, IN ORDER OF AUTHORITY:
     1. teams.initials, the club's own choice (0129, set in the club portal); the database keeps
        these unique within a league, and nobody else is given one
     2. a short name that is already a code (2-4 capitals or digits: "LRB"), then a code from a
        feed (external_ids, e.g. fiba_livestats)
     3. codes made from the name: the first letters of three words, the first three letters,
        then mixes of the first two words, then letters from further in
   A code two clubs both want at the same step is given to neither. Every club moves on
   together each round, so the answer does not depend on the order the clubs arrive in, and
   adding a club to a league can only change the codes of clubs that collide with it.

     EpinoiaInitials.assign(teams)        -> Map(team id -> code)   pure; teams of one league
     EpinoiaInitials.candidates(team)     -> [code, ...]            pure
     EpinoiaInitials.load(leagueIds, d)   -> Promise                every club of those leagues,
                                                                    once a session (sessionStorage)
     EpinoiaInitials.code(team | id)      -> code or ''             after load
     EpinoiaInitials.want(leagueId)       batches load() and then fill(document): what a card calls
     EpinoiaInitials.fill(scope)          writes codes into [data-initials-team] nodes

   node supabase/tests/initials.test.mjs
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaInitials = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const CODE = /^[A-Z0-9]{2,4}$/;
/* words that say what kind of club it is, not which club */
const FILLER = new Set(['THE', 'OF', 'AND', 'BASKETBALL', 'BBALL', 'CLUB', 'BC', 'FC', 'CB', 'BK', 'KK', 'SC', 'AC',
  'MEN', 'MENS', 'WOMEN', 'WOMENS', 'LADIES', 'ACADEMY']);
const AGE = /^U\d{1,2}S?$/;
const VOWEL = /[AEIOU]/;

function words(name) {
  const all = String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[’'`.]/g, '')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const kept = all.filter(w => !FILLER.has(w) && !AGE.test(w));
  return kept.length ? kept : all;
}

/* A CARRIED CODE MUST READ AS THE NAME. Feeds carry codes a reader cannot place: British
   Championship Basketball's LiveStats codes end in a B for basketball (NHB for Nottingham Hoods,
   RRB for Reading Rockets), and Birmingham Rockets is CBR. A code counts only when it starts one
   of the name's words and its letters come in order within the name: LEI for Leicester Riders,
   MKB for Milton Keynes Breakers and CMA for Cardiff Met Archers do; NHB and CBR do not, and
   those clubs make theirs from the name instead (NOT, BIR). */
function readsAs(code, team) {
  const w = words((team && (team.name || team.short_name)) || '');
  if (!w.length || !w.some(x => x[0] === code[0])) return false;
  const letters = w.join('');
  let i = letters.indexOf(code[0]);
  for (let k = 1; k < code.length; k++) {
    i = letters.indexOf(code[k], i + 1);
    if (i < 0) return false;
  }
  return true;
}

/* the codes a club already carries: a short name that is a code, then a feed's code */
function official(team) {
  const t = team || {};
  const out = [];
  const add = c => {
    c = String(c || '').trim().toUpperCase();
    if (CODE.test(c) && !out.includes(c) && readsAs(c, t)) out.push(c);
  };
  if (CODE.test(String(t.short_name || '').trim())) add(t.short_name);
  const ext = t.external_ids && typeof t.external_ids === 'object' ? t.external_ids : {};
  Object.keys(ext).sort().forEach(k => { if (CODE.test(String(ext[k] || '').trim())) add(ext[k]); });
  return out;
}

/* the codes made from the name, best first */
function made(team) {
  const t = team || {};
  const out = [];
  const add = c => { c = String(c || '').toUpperCase(); if (CODE.test(c) && !out.includes(c)) out.push(c); };
  const w = words(t.name || t.short_name);
  if (!w.length) return out;
  const [a, b = '', c = ''] = w;
  if (w.length >= 3) add(a[0] + b[0] + c[0]);
  add(a.slice(0, 3));
  if (b) {
    add(a[0] + b.slice(0, 2));
    add(a.slice(0, 2) + b[0]);
    add(a[0] + b[0] + b[b.length - 1]);
  }
  /* further into the words: the first letter, then its consonants (NTT), then any two later
     letters in order */
  const cons = a.slice(1).split('').filter(ch => !VOWEL.test(ch));
  if (cons.length >= 2) add(a[0] + cons[0] + cons[1]);
  const pool = (a + b + c).slice(1);
  for (let i = 0; i < pool.length && out.length < 40; i++) {
    for (let j = i + 1; j < pool.length && out.length < 40; j++) add(a[0] + pool[i] + pool[j]);
  }
  return out;
}

function candidates(team) {
  const out = official(team);
  made(team).forEach(c => { if (!out.includes(c)) out.push(c); });
  return out;
}

/* ROUNDS: every open club asks for its next code that is neither taken nor banned; a code asked
   for by exactly one club is theirs, a code asked for by two or more is banned for everybody.
   All clubs move together, so arrival order never decides. Returns the clubs that ran out. */
function rounds(open, listFor, taken, banned, result) {
  const cands = new Map(open.map(t => [t.id, listFor(t)]));
  const at = new Map(open.map(t => [t.id, 0]));
  const next = t => {
    const cs = cands.get(t.id);
    let i = at.get(t.id);
    while (i < cs.length && (taken.has(cs[i]) || banned.has(cs[i]))) i++;
    at.set(t.id, i);
    return i < cs.length ? cs[i] : null;
  };
  let live = open.slice();
  const out = [];
  while (live.length) {
    const wants = new Map();
    live.forEach(t => {
      const c = next(t);
      if (c === null) { out.push(t); return; }
      if (!wants.has(c)) wants.set(c, []);
      wants.get(c).push(t);
    });
    wants.forEach((ts, c) => {
      if (ts.length === 1) { result.set(ts[0].id, c); taken.add(c); }
      else banned.add(c);
    });
    live = live.filter(t => !result.has(t.id) && !out.includes(t));
  }
  return out;
}

function assign(teams) {
  const list = (teams || []).filter(t => t && t.id);
  const result = new Map();
  const taken = new Set();
  /* 1. the clubs' own choices (the database keeps them unique within the league) */
  list.forEach(t => {
    const own = String(t.initials || '').toUpperCase();
    if (CODE.test(own) && !taken.has(own)) { result.set(t.id, own); taken.add(own); }
  });
  /* 2. codes clubs already carry settle among themselves first, so a made-up code can never
     push a club off its own ("LON" stays London Lions' even if another London club's name
     would make LON too) */
  const banned = new Set();
  const noOfficial = rounds(list.filter(t => !result.has(t.id)), official, taken, banned, result);
  /* 3. everyone else makes one from their name, around everything settled above; a code
     banned in step 2 stays banned, because two clubs already carry it */
  const stuck = rounds(noOfficial, made, taken, banned, result);
  /* 4. a club out of codes takes a numbered one, in a fixed order so the answer is stable */
  stuck.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')) || String(x.id).localeCompare(String(y.id)))
    .forEach(t => {
      const base = ((words(t.name)[0] || 'TM') + 'XX').slice(0, 2);
      for (let n = 2; n < 100; n++) {
        const c = base + n;
        if (!taken.has(c)) { result.set(t.id, c); taken.add(c); break; }
      }
    });
  return result;
}

/* ------------------------------------------------------------- the browser --- */
const STORE_KEY = 'epinoia_initials_v1';
const TTL = 10 * 60 * 1000;
const byId = new Map();
const loaded = new Set();
let pending = null;

function remember(leagueCodes, store) {
  try {
    const s = store || (root.sessionStorage || null);
    if (!s) return;
    const j = JSON.parse(s.getItem(STORE_KEY) || '{}');
    j.at = Date.now();
    j.leagues = Object.assign(j.leagues || {}, leagueCodes);
    s.setItem(STORE_KEY, JSON.stringify(j));
  } catch (_) { /* private mode: asked again next page */ }
}
function recall(ids, store) {
  try {
    const s = store || (root.sessionStorage || null);
    const j = s && JSON.parse(s.getItem(STORE_KEY) || 'null');
    if (!j || !j.leagues || Date.now() - (j.at || 0) > TTL) return [];
    return ids.filter(id => {
      const codes = j.leagues[id];
      if (!codes) return false;
      Object.keys(codes).forEach(tid => byId.set(tid, codes[tid]));
      loaded.add(id);
      return true;
    });
  } catch (_) { return []; }
}

async function load(leagueIds, deps) {
  const d = deps || {};
  const cfg = d.config || root.EPINOIA_CONFIG || {};
  const get = d.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
  const ids = [...new Set((leagueIds || []).filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))]
    .filter(id => !loaded.has(id));
  if (!ids.length) return;
  const have = recall(ids, d.store);
  const want = ids.filter(id => !have.includes(id));
  if (!want.length || !get || !cfg.supabaseUrl) return;
  const url = fields => cfg.supabaseUrl + '/rest/v1/teams?select=' + fields +
    '&league_id=in.(' + want.join(',') + ')';
  const headers = { apikey: cfg.supabaseAnonKey, Accept: 'application/json' };
  /* before 0129 the column is not there and PostgREST answers 400: ask again without it */
  let r = await get(url('id,league_id,name,short_name,initials,external_ids'), { headers, cache: 'no-store' });
  if (r && r.status === 400) r = await get(url('id,league_id,name,short_name,external_ids'), { headers, cache: 'no-store' });
  if (!r || !r.ok) return;
  const rows = await r.json();
  const perLeague = {};
  want.forEach(id => { perLeague[id] = []; });
  (rows || []).forEach(t => { if (perLeague[t.league_id]) perLeague[t.league_id].push(t); });
  const toStore = {};
  Object.keys(perLeague).forEach(id => {
    const codes = {};
    assign(perLeague[id]).forEach((c, tid) => { byId.set(tid, c); codes[tid] = c; });
    toStore[id] = codes;
    loaded.add(id);
  });
  remember(toStore, d.store);
}

function code(team) {
  const id = team && typeof team === 'object' ? team.id : team;
  return (id && byId.get(id)) || '';
}

function fill(scope) {
  const s = scope || root.document;
  if (!s || typeof s.querySelectorAll !== 'function') return 0;
  let n = 0;
  s.querySelectorAll('[data-initials-team]').forEach(node => {
    const c = byId.get(node.getAttribute('data-initials-team'));
    if (c && node.textContent !== c) { node.textContent = c; n++; }
    if (c) node.classList.add('is-code');
  });
  return n;
}

/* A card asks for its league; one load and one fill follow for every card drawn in the same turn. */
const asked = new Set();
function want(leagueId) {
  if (!leagueId || loaded.has(leagueId)) return;
  asked.add(leagueId);
  if (pending) return;
  pending = Promise.resolve().then(() => {
    const ids = [...asked];
    asked.clear();
    return load(ids);
  }).catch(() => {}).then(() => {
    pending = null;
    fill(root.document);
    if (asked.size) want([...asked][0]);
  });
}

return { assign, candidates, official, made, readsAs, words, load, code, fill, want, _byId: byId, _loaded: loaded };
}));
