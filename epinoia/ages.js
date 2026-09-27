'use strict';
/* ============================================================================
   AGE, AND ONLY AGE - the site never shows a date of birth.

   The ingest keeps an adult's full date of birth in a players column added by 0184 that no browser can read, so that his age
   moves by itself on his birthday. The one way it reaches a page is the database function player_ages(ids), which returns
   {player_id, age} for a player who has a date and is not withheld, and nothing else. This file asks it, and turns the answers into
   the two things the pages show:

     bornWords(year, age)     'born 1996' + 'age 30'  (age only when the database gave one; a year alone stays 'born 1996')
     summary(players, ages)   a squad's average age, height and weight, over the players who HAVE the number, and how many that was

   A server without 0184 answers 404: no ages, and the pages read as they always did. Nothing here throws into a page.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAges = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const BATCH = 500;                         // the function answers for at most this many at once

/* {playerId: age} for the ids the database will give an age for. `cfg` is the page's EPINOIA_CONFIG. Never rejects. */
async function load(cfg, ids, fetchFn) {
  const out = {};
  const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!f || !cfg || !cfg.supabaseUrl || !list.length) return out;
  for (let i = 0; i < list.length; i += BATCH) {
    try {
      const r = await f(cfg.supabaseUrl + '/rest/v1/rpc/player_ages', {
        method: 'POST', cache: 'no-store',
        headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_ids: list.slice(i, i + BATCH) })
      });
      if (!r.ok) return out;               // before 0184 there is no such function: no ages
      (await r.json() || []).forEach(x => { if (x && x.player_id != null && Number.isFinite(x.age)) out[x.player_id] = x.age; });
    } catch (_) { return out; }
  }
  return out;
}

/* the words beside a name: ['born 1996', 'age 30'] - or just the year, or nothing */
function bornWords(year, age) {
  const w = [];
  if (year) w.push('born ' + year);
  if (Number.isFinite(age)) w.push('age ' + age);
  return w;
}

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/* players: [{id, height_cm, weight_kg}]; ages: load()'s answer. Each average is over the players who have that number. */
function summary(players, ages) {
  const list = (players || []).filter(Boolean);
  const num = k => list.map(p => p[k]).filter(v => Number.isFinite(v) && v > 0);
  const ag = list.map(p => (ages || {})[p.id]).filter(v => Number.isFinite(v));
  const ht = num('height_cm'), wt = num('weight_kg');
  return {
    players: list.length,
    age: mean(ag), ageN: ag.length,
    height: mean(ht), heightN: ht.length,
    weight: mean(wt), weightN: wt.length
  };
}

/* AGE, HEIGHT AND WEIGHT FOR A TABLE'S WORTH OF PLAYERS - the stats tables' AGE / HT / WT columns. One call to player_bio() (0185) per
   five hundred players, and what came back is kept in the browser for half an hour (a player who has nothing is kept as
   nothing, so a table of thousands is not asked about again on every visit, yet a bio filled in meanwhile shows soon).
   Returns {id: {h, w, a}} for players who have at least one of the three; never rejects. `store` is a localStorage-like object. */
const KEY = 'epinoia.bio.v1';
const TTL_MS = 30 * 60 * 1000;
async function loadBio(cfg, ids, fetchFn, store, now) {
  const out = {};
  const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
  const t = now == null ? Date.now() : now;
  let cache = { t, m: {} };
  const st = store === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : store;
  try { const c = st && JSON.parse(st.getItem(KEY) || 'null'); if (c && c.m && t - c.t >= 0 && t - c.t < TTL_MS) cache = c; } catch (_) { /* no cache */ }
  const want = [];
  [...new Set((ids || []).filter(Boolean))].forEach(id => {
    const c = cache.m[id];
    if (c === undefined) want.push(id);
    else if (c) out[id] = { h: c[0], w: c[1], a: c[2] };
  });
  if (!f || !cfg || !cfg.supabaseUrl || !want.length) return out;
  let fresh = false;
  for (let i = 0; i < want.length; i += BATCH) {
    const chunk = want.slice(i, i + BATCH);
    try {
      const r = await f(cfg.supabaseUrl + '/rest/v1/rpc/player_bio', {
        method: 'POST', cache: 'no-store',
        headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_ids: chunk })
      });
      if (!r.ok) break;                     // before 0185 there is no such function: no columns' worth, and nothing is remembered
      const got = new Map((await r.json() || []).filter(x => x && x.player_id != null).map(x => [x.player_id, x]));
      chunk.forEach(id => {
        const x = got.get(id);
        cache.m[id] = x ? [x.height_cm == null ? null : x.height_cm, x.weight_kg == null ? null : x.weight_kg, x.age == null ? null : x.age] : 0;
        if (x) out[id] = { h: cache.m[id][0], w: cache.m[id][1], a: cache.m[id][2] };
      });
      fresh = true;
    } catch (_) { break; }
  }
  if (fresh && st) { try { st.setItem(KEY, JSON.stringify(cache)); } catch (_) { /* full or blocked: asked again next time */ } }
  return out;
}

return { load, loadBio, bornWords, summary, BATCH };
}));
