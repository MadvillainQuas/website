'use strict';
/* ============================================================================
   THE TRANSFER MATRIX'S ENGINE: window.EpinoiaTransferEngine (and module.exports under node).

   How a player's numbers change when he moves from one league to another, worked out from every player who made a
   move. This is the data and the maths of the older standalone Transfer Matrix (transfermatrix/index.html, v3), lifted
   out whole so the page (scouting/transfer/page.js), the build tool (tools/build-transfer.mjs) and the tests share one
   copy. Same algorithms, same defaults, same rounding; no DOM, no globals. The page's own words live in page.js.

   THE DATA
     A stint is one player in one league in one season: {pid, season, y, league, name, teams, GP, MIN, vals[9]}, vals the
     nine rate stats (STATS) weighted by minutes across his clubs in that league that season. Players are matched by the
     id their source gives them, never by name (dozens of names are shared). Two ways in:
       ingestCSV(texts)        the scraped player-stats files, merged and de-duplicated (tools/build-transfer.mjs)
       decodeStore(bytes)      the binary store the page loads, members only (encodeStore writes it; transferdata.js
                               fetches it through the analytics-file function and gunzips it)
     Both give RAW = {stints, years (newest first), yearLabel, allLeagues, allTransfers, globalMeans}.

   THE MODEL (deriveD, for a season window and the reader's settings)
     * a move is the same player in two leagues in the same or the next season, 120 minutes or more in each (MIN_FLOOR);
       its weight is the smaller of the two minute totals and its shift is the later stint minus the earlier one;
     * NETWORK SCALE: per stat, a weighted least-squares solve over every move between every pair of leagues, Spanish
       ACB held at 0 (else the league with the most minutes), ridge 1: each league's coefficient (D.net);
     * ROUTE EVIDENCE: the moves on one route, both ways (the reverse sign-flipped), minutes-weighted (D.pairs);
     * BLEND (the default): diff = w x route + (1 - w) x (net[F] - net[T]), w = n / (n + 30);
       DIRECT uses the route alone; SPANISH SCALE uses a Gauss-Seidel solve anchored on the Spanish pyramid (50-minute gate);
     * ROBUST (on by default): one vote per player per route, and each route's weight saturated at 25,000 minutes;
     * TALENT CURVE (off by default): each shift less beta x the mover's distance from his old league's average, beta
       estimated within routes;
     * the projection is the input plus the route's shift, held inside each stat's range (META lo..hi).
   THE LEAGUE INDEX (computeIndex): the same solve per season over a trailing window of seasons, for one stat or a
   composite of z-scored stats; ledger() says which neighbouring leagues set a league's rating, and how much.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTransferEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ------------------------------------------------------------------ constants --- */
const STATS = ['BPM', 'TS_pct', 'USG_pct', 'ORB_pct', 'DRB_pct', 'AST_pct', 'TOV_pct', 'STL_pct', 'BLK_pct'];
const META = [
  { k: 'BPM',     lab: 'BPM',  dec: 1, lo: -30, hi: 30, signed: true },
  { k: 'TS_pct',  lab: 'TS%',  dec: 1, lo: 0, hi: 100 },
  { k: 'USG_pct', lab: 'USG%', dec: 1, lo: 0, hi: 60 },
  { k: 'ORB_pct', lab: 'ORB%', dec: 1, lo: 0, hi: 35 },
  { k: 'DRB_pct', lab: 'DRB%', dec: 1, lo: 0, hi: 50 },
  { k: 'AST_pct', lab: 'AST%', dec: 1, lo: 0, hi: 70 },
  { k: 'TOV_pct', lab: 'TOV%', dec: 1, lo: 0, hi: 60, inverse: true },
  { k: 'STL_pct', lab: 'STL%', dec: 1, lo: 0, hi: 12 },
  { k: 'BLK_pct', lab: 'BLK%', dec: 1, lo: 0, hi: 18 }
];
const MIN_FLOOR = 120, K_BLEND = 30, ANCHOR = 'Spanish ACB';
const SAT_CAP = 25000;            // about 35-40 full-season moves' worth of weight on one directed route
const SPAIN_MIN_MINUTES = 50;     // the Spanish scale's own gate
const SPAIN_PATTERNS = [['acb'], ['primera feb', 'leb gold', 'leb oro'], ['segunda feb', 'leb silver', 'leb plata']];
const STABILISE_K = 350;          // stabilise: the input moves toward the league average by MIN / (MIN + 350)
const CONF = { high: 150, moderate: 40, sparse: 10 };
const DEFAULTS = Object.freeze({ mode: 'blend', robust: true, talent: false });
/* the League Index's measures: a single stat ranks by its coefficient against the anchor (TOV% turned round, so higher
   is a tougher league); a composite averages the z-scored ladders of its parts (x100) */
const STAT_ORIENT = STATS.map(s => (s === 'TOV_pct' ? -1 : 1));
const IDX_METRICS = {
  'bpm':     { label: 'BPM', comps: [0], dec: 0 },
  'c:phys':  { label: 'Physicality', comps: [3, 4], dec: 0 },
  'c:aggr':  { label: 'Aggression', comps: [7, 6], dec: 0 },
  'c:event': { label: 'Event generation', comps: [7, 8], dec: 0 },
  'c:score': { label: 'Scoring', comps: [1, 2], dec: 0 },
  'c:play':  { label: 'Playmaking', comps: [2, 5], dec: 0 },
  's:1': { label: 'TS%', comps: [1], dec: 1 }, 's:2': { label: 'USG%', comps: [2], dec: 1 },
  's:3': { label: 'ORB%', comps: [3], dec: 1 }, 's:4': { label: 'DRB%', comps: [4], dec: 1 },
  's:5': { label: 'AST%', comps: [5], dec: 1 }, 's:6': { label: 'TOV%', comps: [6], dec: 1 },
  's:7': { label: 'STL%', comps: [7], dec: 1 }, 's:8': { label: 'BLK%', comps: [8], dec: 1 }
};
const COMPACT_SCALE = 100;          // the store keeps every stat to two decimals

const nf = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };
const toSet = x => (x instanceof Set ? x : new Set(x || []));
const optsOf = o => Object.assign({}, DEFAULTS, o || {});

/* ------------------------------------------------------------------ the CSV reader --- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/), rows = [];
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (!line) continue;
    if (line.indexOf('"') === -1) { rows.push(line.split(',')); continue; }
    const fields = []; let cur = '', inQ = false;
    for (;;) {
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
          else cur += ch;
        } else {
          if (ch === '"') inQ = true;
          else if (ch === ',') { fields.push(cur); cur = ''; }
          else cur += ch;
        }
      }
      if (inQ && li < lines.length - 1) { cur += '\n'; line = lines[++li]; } else break;
    }
    fields.push(cur); rows.push(fields);
  }
  return rows;
}

/* ------------------------------------------------------------------ archive identities --- */
/* One older national archive keys its players 'MSL-…' and prints full legal names ("Ryell Rodney Etyle-Rock") where the
   main files print short forms ("R.J. Eytle-Rock"), with typos, broken apostrophes and Jr/Jnr on both sides. Its
   identities are re-keyed onto the main files' when the names are compatible AND the main-file player was not playing a
   real season elsewhere at the same time (more than 10 games in an overlapping season = a different person). */
const NICK_GROUPS = [
  ['michael', 'mike', 'mikey', 'mick', 'micky', 'mickey'],
  ['william', 'will', 'willie', 'bill', 'billy', 'liam'],
  ['robert', 'rob', 'robbie', 'robby', 'bob', 'bobby', 'bert'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'johnny', 'jack', 'jackie', 'jon', 'jonathan', 'johnathan', 'jonathon'],
  ['joseph', 'joe', 'joey'], ['anthony', 'tony', 'antony'],
  ['andrew', 'andy', 'drew'], ['daniel', 'dan', 'danny'],
  ['thomas', 'tom', 'tommy'], ['nicholas', 'nick', 'nicky', 'nikolas'],
  ['alexander', 'alex', 'sasha'], ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'], ['zachary', 'zach', 'zack'],
  ['patrick', 'pat', 'paddy', 'padraig'],
  ['richard', 'rick', 'ricky', 'rich', 'richie', 'dick'],
  ['edward', 'ed', 'eddie', 'eddy', 'ted', 'teddy'],
  ['kenneth', 'ken', 'kenny'], ['gregory', 'greg'], ['jeffrey', 'jeff', 'geoff', 'geoffrey'],
  ['frederick', 'fred', 'freddie', 'freddy'], ['francis', 'frank', 'frankie'],
  ['charles', 'charlie', 'chuck'], ['henry', 'hank', 'harry'],
  ['lawrence', 'larry', 'laurence'], ['gerald', 'jerry', 'gerry'], ['terence', 'terry', 'terrence'],
  ['christopher', 'chris', 'kristopher', 'kris', 'christian', 'kristian'],
  ['cameron', 'cam'], ['nathan', 'nate', 'nathaniel'],
  ['donald', 'don', 'donny'], ['ronald', 'ron', 'ronnie'], ['vincent', 'vince', 'vinny'],
  ['martin', 'marty'], ['bradley', 'brad'], ['douglas', 'doug'], ['russell', 'russ'],
  ['wesley', 'wes'], ['walter', 'walt'], ['raymond', 'ray'], ['eugene', 'gene'],
  ['arthur', 'art', 'artie'], ['bernard', 'bernie'], ['calvin', 'cal'],
  ['clifford', 'cliff'], ['dennis', 'denny'], ['philip', 'phil', 'phillip'],
  ['reginald', 'reggie'], ['stanley', 'stan'], ['stuart', 'stu'], ['theodore', 'theo'],
  ['timothy', 'tim', 'timmy'], ['trevor', 'trev'], ['victor', 'vic'], ['ezekiel', 'zeke'],
  ['stephen', 'steve', 'steven', 'stevie'], ['matthew', 'matt', 'matty'],
  ['david', 'dave', 'davy'], ['jacob', 'jake'], ['joshua', 'josh'],
  ['maxwell', 'max'], ['gabriel', 'gabe'], ['isaac', 'ike'],
  ['derek', 'derrick', 'deric'], ['eric', 'erik', 'erick'], ['brian', 'bryan'],
  ['marc', 'mark'], ['dominic', 'dom', 'dominick'], ['emanuel', 'manny', 'emmanuel']
];
const NICK = new Map();
NICK_GROUPS.forEach(g => g.forEach(n => { let s = NICK.get(n); if (!s) { s = new Set(); NICK.set(n, s); } g.forEach(m => { if (m !== n) s.add(m); }); }));

function nrmName(s) {
  s = (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/'/g, '');                      // O'Reilly / O' Hanlon -> oreilly / o hanlon
  s = s.replace(/[^a-z]+/g, ' ').trim();        // dots, hyphens, digits -> space
  const t = s.split(' ').filter(w => w && !/^(jr|jnr|sr|snr|junior|senior|ii|iii|iv|v)$/.test(w));
  while (t.length > 1 && t[0].length === 1 && t[1].length === 1) t.splice(0, 2, t[0] + t[1]);  // "c j fulton" -> "cj fulton"
  return t;
}
function dl1(a, b) {                            // Damerau-Levenshtein distance <= 1 ?
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length === 1) return true;                                          // substitution
    return diff.length === 2 && diff[1] === diff[0] + 1 &&
           a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];               // transposition
  }
  const s = la < lb ? a : b, l = la < lb ? b : a;                                // insert/delete
  let i = 0, j = 0, skips = 0;
  while (i < s.length && j < l.length) { if (s[i] === l[j]) { i++; j++; } else { j++; if (++skips > 1) return false; } }
  return true;
}
function firstKind(a, b) {
  if (!a || !b) return '';
  if (a === b) return 'exact';
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 'strong';   // dan/daniel
  const s = NICK.get(a); if (s && s.has(b)) return 'strong';
  if ((a.length <= 2 || b.length <= 2) && a[0] === b[0]) return 'initial';                       // rj/ryell
  return '';
}
/* a fuzzy surname may not change its first letter, except by an adjacent transposition (etyle/eytle) */
function flOK(a, b) { return a[0] === b[0] || (a.length > 1 && b.length > 1 && a[0] === b[1] && a[1] === b[0]); }
function smartMatchIrish(best) {
  const map = new Map();
  const irish = new Map(), feed = new Map();
  for (const e of best.values()) {
    const nm = (e.row[e.H.player_name] || '').trim();
    const y = parseInt(String(e.row[e.H.season]).split('-')[1], 10) || 0;
    const gp = Math.round(nf(e.row[e.H.GP]) || 0);
    if (e.pid.startsWith('MSL-')) {
      let r = irish.get(e.pid); if (!r) { r = { names: new Set(), years: new Set() }; irish.set(e.pid, r); }
      r.names.add(nm); r.years.add(y);
    } else {
      let r = feed.get(e.pid); if (!r) { r = { names: new Set(), gpY: new Map() }; feed.set(e.pid, r); }
      r.names.add(nm); r.gpY.set(y, (r.gpY.get(y) || 0) + gp);
    }
  }
  if (!irish.size || !feed.size) return map;
  /* the main files' identities by surname keys; token lists kept for the fuzzy pass */
  const idx = new Map(); const feedNames = [];
  for (const [pid, r] of feed) {
    for (const nm of r.names) {
      const t = nrmName(nm); if (t.length < 2) continue;
      feedNames.push({ pid, toks: t });
      const keys = new Set([t[t.length - 1], t.slice(-2).join(''), t.slice(-2).join(' ')]);
      for (const k of keys) {
        if (k.length < 3) continue;
        let s = idx.get(k); if (!s) { s = new Set(); idx.set(k, s); } s.add(pid);
      }
    }
  }
  for (const [mpid, r] of irish) {
    let t = null;
    for (const nm of r.names) { const tt = nrmName(nm); if (!t || tt.length > t.length) t = tt; }
    if (!t || t.length < 2) continue;
    const first = t[0], fullKey = t.join(' ');
    /* surname suffix keys: the last 1..3 tokens, spaced and collapsed ("o sullivan" / "osullivan") */
    const sufKeys = new Set();
    for (let k = 1; k <= 3 && k < t.length; k++) {
      const suf = t.slice(t.length - k);
      sufKeys.add(suf.join(' ')); sufKeys.add(suf.join(''));
    }
    /* candidates: pid -> the size of the smallest shared surname key (how rare the evidence is) */
    const cands = new Map();
    for (const k of sufKeys) {
      const s = idx.get(k); if (!s) continue;
      s.forEach(p => { const cur = cands.get(p); cands.set(p, cur === undefined ? s.size : Math.min(cur, s.size)); });
    }
    let fuzzy = false;
    if (!cands.size) {
      /* the fuzzy surname pass (typos and transpositions: "etyle rock" against "eytle rock") */
      fuzzy = true;
      const last = t[t.length - 1], last2 = t.slice(-2).join('');
      for (const f of feedNames) {
        const fl = f.toks[f.toks.length - 1], fl2 = f.toks.slice(-2).join('');
        if ((last.length >= 5 && flOK(last, fl) && dl1(last, fl)) ||
            (last2.length >= 6 && flOK(last, fl) && flOK(last2, fl2) && dl1(last2, fl2)) ||
            (last.length >= 5 && flOK(last, fl2) && dl1(last, fl2)) ||
            (last2.length >= 6 && flOK(last2, fl) && dl1(last2, fl)))
          cands.set(f.pid, 0);
      }
      for (const p of cands.keys()) cands.set(p, cands.size);    // rarity = the fuzzy pool's size
    }
    if (!cands.size) continue;
    /* tiers: 3 = full name equal, 2 = first name equal (middles dropped), 1 = short form or nickname; initial-only
       evidence ("dj" / "dailin") also needs a rare surname (2 owners or fewer), or every D.J. Davis claims the stint */
    const tiers = { 3: [], 2: [], 1: [] };
    for (const [pid, rar] of cands) {
      const fr = feed.get(pid);
      /* initial-only evidence must also be near in time (a career within 2 years of the archive stint) */
      let gap = Infinity;
      for (const fy of fr.gpY.keys()) for (const iy of r.years) gap = Math.min(gap, Math.abs(fy - iy));
      let tier = 0;
      for (const nm of fr.names) {
        const ft = nrmName(nm); if (!ft.length) continue;
        if (ft.join(' ') === fullKey) { tier = 3; break; }
        const kind = firstKind(first, ft[0]);
        if (kind === 'exact') tier = Math.max(tier, 2);
        else if (kind === 'strong' && !fuzzy) tier = Math.max(tier, 1);
        else if (kind === 'initial' && !fuzzy && rar <= 2 && gap <= 2) tier = Math.max(tier, 1);
      }
      if (!tier) continue;
      /* the season-overlap guard: more than 10 games elsewhere in any archive season = a different person */
      let clash = false;
      for (const y of r.years) { if ((fr.gpY.get(y) || 0) > 10) { clash = true; break; } }
      if (clash) continue;
      tiers[tier].push(pid);
    }
    const pool = tiers[3].length ? tiers[3] : (tiers[2].length ? tiers[2] : tiers[1]);
    if (pool.length === 1) map.set(mpid, pool[0]);
  }
  /* two archive identities claiming one main identity: fine when their seasons do not overlap (spelling splits like
     "Randolph Jnr" / "Randolph Jr."), otherwise all of them are dropped */
  const byTarget = new Map();
  for (const [m, p] of map) { let a = byTarget.get(p); if (!a) { a = []; byTarget.set(p, a); } a.push(m); }
  for (const [, arr] of byTarget) {
    if (arr.length < 2) continue;
    const seen = new Set(); let clash = false;
    for (const m of arr) for (const y of irish.get(m).years) { if (seen.has(y)) clash = true; seen.add(y); }
    if (clash) arr.forEach(m => map.delete(m));
  }
  return map;
}

/* ------------------------------------------------------------------ the ways in --- */
const yearOf = season => parseInt(String(season).split('-')[1], 10) || 0;
/* the scraped player-stats files (texts in file order: player_stats, player_stats2, ...) -> RAW. Rows merge on
   id + season + league + club, the row with the most minutes kept (the latest scrape); then one stint per player,
   league and season, minutes-weighted. log(msg) hears what the original app printed while loading. */
function ingestCSV(texts, o) {
  o = o || {};
  const log = typeof o.log === 'function' ? o.log : () => {};
  const best = new Map(); let total = 0, dupes = 0, files = 0;
  for (const text of texts) {
    const rows = parseCSV(text);
    if (!rows.length) continue;
    const H = {}; rows[0].forEach((h, i) => { if (!(h in H)) H[h] = i; });
    const missing = ['league', 'season', 'team', 'player_name', 'GP', 'MIN', 'player_url'].concat(STATS).filter(c => H[c] === undefined);
    if (missing.length) { log('file skipped: missing columns ' + missing.join(', ')); continue; }
    files++;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 8) continue;
      total++;
      const url = (row[H.player_url] || '').replace(/\/+$/, '');
      const pid = url.split('/').pop();
      const mins = nf(row[H.MIN]);
      if (!pid || mins === null || mins <= 0) continue;
      const key = pid + '|' + row[H.season] + '|' + row[H.league] + '|' + row[H.team];
      const prev = best.get(key);
      if (prev) { dupes++; if (mins <= prev.mins) continue; }
      best.set(key, { H, row, pid, mins });
    }
  }
  log(total + ' rows read, ' + best.size + ' unique (' + dupes + ' duplicates merged)');
  const pidMap = smartMatchIrish(best);
  if (pidMap.size) log(pidMap.size + ' archive identities matched');
  const acc = new Map();
  for (const e of best.values()) {
    const { H, row, mins } = e;
    const pid = pidMap.get(e.pid) || e.pid;
    const key = pid + '|' + row[H.season] + '|' + row[H.league];
    let a = acc.get(key);
    if (!a) {
      a = { pid, season: row[H.season], league: row[H.league], name: (row[H.player_name] || '').trim(),
            nameMin: mins, teams: [], GP: 0, MIN: 0, s: STATS.map(() => [0, 0]) };
      acc.set(key, a);
    }
    if (mins > a.nameMin) { a.name = (row[H.player_name] || '').trim(); a.nameMin = mins; }
    a.teams.push(row[H.team]); a.GP += Math.round(nf(row[H.GP]) || 0); a.MIN += mins;
    STATS.forEach((s, k) => { const v = nf(row[H[s]]); if (v !== null) { a.s[k][0] += mins * v; a.s[k][1] += mins; } });
  }
  const sv = a => a.s.map(([sw, w]) => (w ? sw / w : null));
  const stints = [];
  for (const a of acc.values()) {
    stints.push({ pid: a.pid, season: a.season, y: yearOf(a.season), league: a.league, name: a.name,
      teams: [...new Set(a.teams)].join(' / ').slice(0, 48), GP: a.GP, MIN: Math.round(a.MIN), vals: sv(a) });
  }
  log(stints.length + ' player-league-season stints from ' + files + ' files');
  return finishRaw(stints, { files, rows: total, unique: best.size, dupes, matched: pidMap.size });
}
/* what every way in ends with: the seasons, the leagues, every move and the leagues' averages over all of it */
function finishRaw(stints, info) {
  const RAW = { stints, info: info || {} };
  RAW.years = [...new Set(stints.map(s => s.y).filter(Boolean))].sort((a, b) => b - a);
  RAW.yearLabel = new Map();
  stints.forEach(s => { if (s.y && !RAW.yearLabel.has(s.y)) RAW.yearLabel.set(s.y, s.season); });
  RAW.allTransfers = traceTransfers(stints);
  RAW.allLeagues = [...new Set(stints.map(s => s.league))].sort();
  RAW.globalMeans = leagueMeansOf(stints);
  return RAW;
}

/* THE STORE AS THE PAGE GETS IT (format 2, 'TMS2'): every stint, in the order the CSV path makes them, as binary
   columns; gzipped by the build tool (1.8 MB) and gunzipped by the loader (transferdata.js). A player is a number counted
   from 1 in order of first appearance (the source's own ids are not kept); every stat is its value to two decimals.
     'TMS2', u32 header length, the header as UTF-8 JSON, then the blocks the header places ([offset, length] from the
     start of the blocks):
       header  {v: 2, built, stats, scale: 10, n, players, leagues, seasons, teams, names (one a player, his most used
                spelling), nameEx: [[row, name]...] (a stint printed otherwise), blocks: {p, s, l, t, g, m, v0..v8, x}}
       p       varint a row: 0 = a player not seen yet (the next number), else how many rows back he was last seen
       s l t g varint a row: season, league and clubs (indices into their tables), games
       m       minutes, u16 in two byte planes (all the low bytes, then all the high bytes)
       v0..v8  a stat each, u16 code in two byte planes: 0 = no value, 1 = in x (a season split between clubs, whose
               minutes-weighted mean needs the second decimal), else zigzag(value x 10) + 2
       x       varints, stat by stat: how many, then (rows since the last, zigzag(value x 100)) each
   The JSON columns this replaced (format 1, 2.5 MB gzipped) gave the same stints to the bit: a value is x/10 when its
   hundredths digit is 0, x/100 otherwise, the same double either way. */
const STORE_MAGIC = [84, 77, 83, 50], STORE_V = 2;
function bytesOut() {
  let buf = new Uint8Array(1 << 16), len = 0;
  const room = k => { if (len + k <= buf.length) return; let n = buf.length; while (n < len + k) n *= 2; const b = new Uint8Array(n); b.set(buf.subarray(0, len)); buf = b; };
  return {
    byte(x) { room(1); buf[len++] = x; },
    varint(u) { room(5); while (u >= 128) { buf[len++] = (u & 127) | 128; u = Math.floor(u / 128); } buf[len++] = u; },
    bytes(b) { room(b.length); buf.set(b, len); len += b.length; },
    get length() { return len; },
    done() { return buf.slice(0, len); }
  };
}
const zz = x => (x >= 0 ? 2 * x : -2 * x - 1);
const unzz = u => (u % 2 ? -(u + 1) / 2 : u / 2);
function planes16(codes) {
  const n = codes.length, b = new Uint8Array(2 * n);
  for (let i = 0; i < n; i++) { const c = codes[i]; if (!(c >= 0 && c < 65536)) throw new Error('store: a u16 out of range'); b[i] = c & 255; b[n + i] = c >>> 8; }
  return b;
}
function encodeStore(RAW, o) {
  o = o || {};
  const st = RAW.stints, N = st.length;
  const leagues = RAW.allLeagues.slice(), lgAt = new Map(leagues.map((l, i) => [l, i]));
  const seasons = [...new Set(st.map(s => s.season))].sort(), sAt = new Map(seasons.map((s, i) => [s, i]));
  const teams = [], tAt = new Map();
  const num = new Map(), names = [], spell = [];          // player -> his number; his spellings, counted, in first-seen order
  for (const s of st) {
    let p = num.get(s.pid);
    if (p === undefined) { p = num.size + 1; num.set(s.pid, p); spell.push(new Map()); }
    const m = spell[p - 1]; m.set(s.name, (m.get(s.name) || 0) + 1);
  }
  spell.forEach(m => { let best = null, bn = -1; for (const [nm, c] of m) if (c > bn) { best = nm; bn = c; } names.push(best); });
  const B = { p: bytesOut(), s: bytesOut(), l: bytesOut(), t: bytesOut(), g: bytesOut() };
  const last = new Map(), mins = new Array(N), vcodes = STATS.map(() => new Array(N)), vEx = [], nameEx = [];
  st.forEach((s, i) => {
    const p = num.get(s.pid), j = last.get(p);
    B.p.varint(j === undefined ? 0 : i - j); last.set(p, i);
    B.s.varint(sAt.get(s.season)); B.l.varint(lgAt.get(s.league));
    let ti = tAt.get(s.teams); if (ti === undefined) { ti = teams.length; tAt.set(s.teams, ti); teams.push(s.teams); }
    B.t.varint(ti);
    if (!(Number.isInteger(s.GP) && s.GP >= 0)) throw new Error('store: games not a count at row ' + i);
    B.g.varint(s.GP);
    mins[i] = s.MIN;
    if (s.name !== names[p - 1]) nameEx.push([i, s.name]);
    s.vals.forEach((v, k) => {
      if (v === null) { vcodes[k][i] = 0; return; }
      const h = Math.round(v * COMPACT_SCALE);                    // the value as the JSON columns held it (two decimals)
      const c = h % 10 === 0 ? zz(h / 10) + 2 : -1;
      if (c >= 2 && c < 65536) vcodes[k][i] = c; else { vcodes[k][i] = 1; vEx.push([k, i, h]); }
    });
  });
  const blocks = {}, body = bytesOut();
  const put = (name, b) => { blocks[name] = [body.length, b.length]; body.bytes(b); };
  ['p', 's', 'l', 't', 'g'].forEach(k => put(k, B[k].done()));
  put('m', planes16(mins));
  vcodes.forEach((codes, k) => put('v' + k, planes16(codes)));
  /* the second-decimal values, stat by stat: how many, then (rows since the last one, zigzag(value x 100)) */
  const x = bytesOut();
  STATS.forEach((_, k) => {
    const mine = vEx.filter(e => e[0] === k);
    x.varint(mine.length);
    let prev = 0;
    mine.forEach(([, i, h]) => { x.varint(i - prev); x.varint(zz(h)); prev = i; });
  });
  put('x', x.done());
  const head = new TextEncoder().encode(JSON.stringify({ v: STORE_V, built: o.built || null, stats: STATS.slice(), scale: 10, n: N, players: names.length,
    leagues, seasons, teams, names, nameEx, blocks }));
  const out = new Uint8Array(8 + head.length + body.length);
  out.set(STORE_MAGIC, 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  out.set(body.done(), 8 + head.length);
  return out;
}
function decodeStore(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 8 || STORE_MAGIC.some((b, i) => u8[i] !== b)) throw new Error('not a transfer matrix store (TMS2)');
  const hl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
  const H = JSON.parse(new TextDecoder('utf-8').decode(u8.subarray(8, 8 + hl)));
  if (H.v !== STORE_V) throw new Error('store format ' + H.v + ', this page reads ' + STORE_V);
  const base = 8 + hl, N = H.n;
  const block = k => { const [off, len] = H.blocks[k]; return u8.subarray(base + off, base + off + len); };
  const varints = k => {
    const b = block(k), out = new Array(N); let at = 0;
    for (let i = 0; i < N; i++) { let u = 0, mul = 1, x; do { x = b[at++]; u += (x & 127) * mul; mul *= 128; } while (x & 128); out[i] = u; }
    return out;
  };
  const u16 = k => { const b = block(k), out = new Array(N); for (let i = 0; i < N; i++) out[i] = b[i] | (b[N + i] << 8); return out; };
  const P = varints('p'), S = varints('s'), L = varints('l'), Tm = varints('t'), G = varints('g'), M = u16('m');
  const V = H.stats.map((_, k) => u16('v' + k));
  const ex = new Map();
  {
    const b = block('x'); let at = 0;
    const next = () => { let u = 0, mul = 1, c; do { c = b[at++]; u += (c & 127) * mul; mul *= 128; } while (c & 128); return u; };
    H.stats.forEach((_, k) => { const n = next(); let row = 0; for (let j = 0; j < n; j++) { row += next(); ex.set(k * N + row, unzz(next())); } });
  }
  const nameEx = new Map(H.nameEx);
  const pid = new Array(N); let next = 0;
  const stints = new Array(N);
  for (let i = 0; i < N; i++) {
    pid[i] = P[i] === 0 ? ++next : pid[i - P[i]];
    const season = H.seasons[S[i]];
    const vals = new Array(H.stats.length);
    for (let k = 0; k < vals.length; k++) {
      const c = V[k][i];
      vals[k] = c === 0 ? null : c === 1 ? ex.get(k * N + i) / COMPACT_SCALE : unzz(c - 2) / H.scale;
    }
    stints[i] = { pid: pid[i], season, y: yearOf(season), league: H.leagues[L[i]], name: nameEx.has(i) ? nameEx.get(i) : H.names[pid[i] - 1],
      teams: H.teams[Tm[i]], GP: G[i], MIN: M[i], vals };
  }
  return finishRaw(stints, { built: H.built || null, players: H.players });
}

/* ------------------------------------------------------------------ the network scale --- */
function solveLinear(M, v) {
  const n = v.length, A = M.map((row, i) => row.concat([v[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    const t = A[c]; A[c] = A[p]; A[p] = t;
    const pv = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c || !A[r][c]) continue;
      const f = A[r][c] / pv;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / (row[i] || 1e-12));
}
/* THE NORMAL EQUATIONS of one stat's solve: a move from F to T says d = c[F] - c[T], weight w / 100; the anchor's column
   is left out (held at 0). The original built a list of [index, sign] pairs per move and looped over it; this is the same
   sums, term for term and in the same order (a product with a sign of +-1 is exact), without the allocation. */
function accumulate(M, v, transfers, k, nmIdx, aPos, vi) {
  for (const t of transfers) {
    const d = t.diffs[k];
    if (d === null) continue;
    const w = t.w / 100;
    const iF = nmIdx.get(t.F), iT = nmIdx.get(t.T);
    const a = iF !== aPos ? vi.get(iF) : -1, b = iT !== aPos ? vi.get(iT) : -1;
    const wd = w * d;
    if (a >= 0) {
      v[a] += wd;
      M[a][a] += w;
      if (b >= 0) M[a][b] += -w;
    }
    if (b >= 0) {
      v[b] += -wd;
      if (a >= 0) M[b][a] += -w;
      M[b][b] += w;
    }
  }
}
/* +v.toFixed(1), remembered: a hundred thousand player-seasons share far fewer distinct values */
const R1 = new Map();
const round1 = v => { let r = R1.get(v); if (r === undefined) { r = +v.toFixed(1); if (R1.size < 500000) R1.set(v, r); } return r; };
/* the window's model: playersRaw (stints with a BPM), transfers (prepared: talent and robust applied), ghostList (every
   raw move, for the examples) */
function finalize(playersRaw, transfers, ghostList) {
  const leagueNames = [...new Set(playersRaw.map(p => p.league).concat(transfers.flatMap(t => [t.F, t.T])))].sort();
  /* the anchor: Spanish ACB when it is in, else the league with the most minutes */
  let anchor = ANCHOR, anchorFallback = false;
  if (!leagueNames.includes(anchor)) {
    const minSum = new Map();
    playersRaw.forEach(p => minSum.set(p.league, (minSum.get(p.league) || 0) + p.MIN));
    anchor = leagueNames.reduce((a, b) => ((minSum.get(b) || 0) > (minSum.get(a) || 0) ? b : a), leagueNames[0]);
    anchorFallback = true;
  }
  const nmIdx = new Map(leagueNames.map((nm, i) => [nm, i]));
  const aPos = nmIdx.get(anchor);
  const varPos = leagueNames.map((_, i) => i).filter(i => i !== aPos);
  const vi = new Map(varPos.map((lp, j) => [lp, j]));
  const linked = new Set([anchor]);
  transfers.forEach(t => { linked.add(t.F); linked.add(t.T); });
  const unlinked = leagueNames.filter(nm => !linked.has(nm));
  const netByStat = [];
  for (let k = 0; k < STATS.length; k++) {
    const n = varPos.length;
    if (!n) { netByStat.push(leagueNames.map(() => 0)); continue; }
    const M = Array.from({ length: n }, () => new Array(n).fill(0)), v = new Array(n).fill(0);
    accumulate(M, v, transfers, k, nmIdx, aPos, vi);
    for (let j = 0; j < n; j++) M[j][j] += 1.0;      // ridge
    const sol = solveLinear(M, v);
    const col = leagueNames.map(() => 0);
    varPos.forEach((lp, j) => { col[lp] = sol[j]; });
    netByStat.push(col);
  }
  /* strongest to weakest by network BPM */
  const order = leagueNames.map((_, i) => i).sort((a, b) => netByStat[0][b] - netByStat[0][a]);
  const leagues = order.map(i => leagueNames[i]);
  const lgI = new Map(leagues.map((nm, i) => [nm, i]));
  const net = order.map(oi => STATS.map((_, k) => +netByStat[k][oi].toFixed(2)));
  /* the route evidence (both directions mirrored) and the examples */
  const pairAcc = new Map();
  const ghosts = [];
  const bump = (key, k, w, d) => {
    let a = pairAcc.get(key);
    if (!a) { a = STATS.map(() => [0, 0, 0]); pairAcc.set(key, a); }
    a[k][0] += w * d; a[k][1] += w; a[k][2]++;
  };
  for (const t of transfers) {
    const i = lgI.get(t.F), j = lgI.get(t.T), fwd = i + '>' + j, rev = j + '>' + i;
    t.diffs.forEach((d, k) => {
      if (d === null) return;
      bump(fwd, k, t.w, d);
      bump(rev, k, t.w, -d);
    });
  }
  for (const t of ghostList) {
    const i = lgI.get(t.F), j = lgI.get(t.T);
    if (i === undefined || j === undefined) continue;
    ghosts.push([i, j, t.name, t.sf, t.st, t.teamTo, t.m1, t.m2, +t.bpm1.toFixed(1), +t.bpm2.toFixed(1)]);
  }
  const pairs = {};
  for (const [key, per] of pairAcc) pairs[key] = per.map(([sw, w, n]) => (w ? [+(sw / w).toFixed(2), n] : [0, 0]));
  /* the players and the leagues' averages */
  const players = [];
  const meanAcc = leagues.map(() => STATS.map(() => [0, 0]));
  for (const p of playersRaw) {
    const li = lgI.get(p.league), row = [p.name, p.season, li, p.teams, p.GP, p.MIN], acc = meanAcc[li];
    for (let k = 0; k < STATS.length; k++) {
      const v = p.vals[k];
      row.push(v === null ? null : round1(v));
      if (v !== null) { acc[k][0] += p.MIN * v; acc[k][1] += p.MIN; }
    }
    row.push(p.pid);
    players.push(row);
  }
  const means = meanAcc.map(row => row.map(([sv2, sw]) => (sw ? +(sv2 / sw).toFixed(2) : 0)));
  /* the same, null where a league has no minutes for a stat (the published scale says "no data" rather than 0) */
  const meansOrNull = meanAcc.map(row => row.map(([sv2, sw]) => (sw ? +(sv2 / sw).toFixed(2) : null)));
  return { leagues, strength: net.map(c => [c[0], +(100 + 10 * c[0]).toFixed(1)]), net, spain: null,
           means, meansOrNull, pairs, players, ghosts, nTransfers: ghostList.length, anchor, anchorFallback, unlinked };
}

/* ------------------------------------------------------------------ moves --- */
function traceTransfers(stints, floor) {
  const fl = floor || MIN_FLOOR;
  const byPid = new Map();
  for (const s of stints) {
    if (!s.y || !s.pid) continue;
    if (!byPid.has(s.pid)) byPid.set(s.pid, []);
    byPid.get(s.pid).push(s);
  }
  const transfers = [];
  for (const lst of byPid.values()) {
    lst.sort((a, b) => a.y - b.y);
    for (let i = 0; i < lst.length; i++) for (let j = i + 1; j < lst.length; j++) {
      const a = lst[i], b = lst[j];
      if (b.y !== a.y && b.y !== a.y + 1) continue;
      if (a.league === b.league) continue;
      if (a.MIN < fl || b.MIN < fl) continue;
      if (a.vals[0] === null || b.vals[0] === null) continue;
      transfers.push({ F: a.league, T: b.league, w: Math.min(a.MIN, b.MIN), y1: a.y, y2: b.y, pid: a.pid,
        diffs: STATS.map((_, k) => ((a.vals[k] === null || b.vals[k] === null) ? null : b.vals[k] - a.vals[k])),
        v1: a.vals,
        name: b.name, sf: a.season, st: b.season, teamTo: b.teams.slice(0, 40),
        m1: a.MIN, m2: b.MIN, bpm1: +a.vals[0].toFixed(1), bpm2: +b.vals[0].toFixed(1) });
    }
  }
  return transfers;
}

/* ROBUST WEIGHTING: high-volume feeder routes can dominate a league's rating with many correlated, selection-biased moves.
   1. one vote per player per directed route (his shifts minutes-weighted, his weight the mean crossing);
   2. each directed route's total weight saturates at SAT_CAP (1 / (1/W + 1/CAP)), so volume cannot buy influence. */
function dedupTransfers(list) {
  const groups = new Map();
  for (const t of list) {
    const key = (t.pid || t.name) + '|' + t.F + '|' + t.T;
    let g = groups.get(key);
    if (!g) { g = { reps: [], best: t }; groups.set(key, g); }
    g.reps.push(t);
    if (t.w > g.best.w) g.best = t;
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.reps.length === 1) { out.push(g.reps[0]); continue; }
    const meanW = g.reps.reduce((a, t) => a + t.w, 0) / g.reps.length;
    const diffs = STATS.map((_, k) => {
      let s = 0, w = 0;
      for (const t of g.reps) { const d = t.diffs[k]; if (d !== null) { s += t.w * d; w += t.w; } }
      return w ? s / w : null;
    });
    out.push(Object.assign({}, g.best, { w: meanW, diffs }));
  }
  return out;
}
function satScale(list) {
  const pw = new Map();
  for (const t of list) pw.set(t.F + '>' + t.T, (pw.get(t.F + '>' + t.T) || 0) + t.w);
  return list.map(t => {
    const W = pw.get(t.F + '>' + t.T);
    const f = (1 / (1 / W + 1 / SAT_CAP)) / W;
    return f >= 0.999 ? t : Object.assign({}, t, { w: t.w * f });
  });
}

/* THE TALENT CURVE: a route's mean shift is skewed when its movers sit far from their old league's average (exceptional
   imports regress toward the mean). Per stat, beta = the slope of shift on that distance WITHIN routes (pair-centred
   weighted regression, so real gaps between leagues cannot leak in), clamped to [-0.9, 0.3]; each shift less beta x distance. */
function leagueMeansOf(stints) {
  const acc = new Map();
  for (const s of stints) {
    let a = acc.get(s.league);
    if (!a) { a = STATS.map(() => [0, 0]); acc.set(s.league, a); }
    s.vals.forEach((v, k) => { if (v !== null) { a[k][0] += s.MIN * v; a[k][1] += s.MIN; } });
  }
  const out = new Map();
  for (const [lg, a] of acc) out.set(lg, a.map(([sv, sw]) => (sw ? sv / sw : null)));
  return out;
}
function talentBeta(list, means) {
  const pair = new Map();
  const xy = t => {
    const mF = means.get(t.F);
    if (!t.v1 || !mF) return null;
    return STATS.map((_, k) => {
      const d = t.diffs[k];
      if (d === null || t.v1[k] === null || mF[k] === null) return null;
      return [t.v1[k] - mF[k], d];
    });
  };
  for (const t of list) {
    const rows = xy(t);
    if (!rows) continue;
    const key = t.F + '>' + t.T;
    let p = pair.get(key);
    if (!p) { p = STATS.map(() => [0, 0, 0]); pair.set(key, p); }
    rows.forEach((r, k) => { if (r) { p[k][0] += t.w; p[k][1] += t.w * r[0]; p[k][2] += t.w * r[1]; } });
  }
  const num = new Array(STATS.length).fill(0), den = new Array(STATS.length).fill(0);
  for (const t of list) {
    const rows = xy(t);
    if (!rows) continue;
    const p = pair.get(t.F + '>' + t.T);
    rows.forEach((r, k) => {
      if (!r || !p[k][0]) return;
      const xc = r[0] - p[k][1] / p[k][0], yc = r[1] - p[k][2] / p[k][0];
      num[k] += t.w * xc * yc; den[k] += t.w * xc * xc;
    });
  }
  const beta = num.map((n, k) => {
    if (den[k] < 1e-9) return 0;
    return Math.max(-0.9, Math.min(0.3, n / den[k]));
  });
  return { beta, xy };
}
function talentAdjust(list, means) {
  const { beta, xy } = talentBeta(list, means);
  return list.map(t => {
    const rows = xy(t);
    if (!rows) return t;
    const diffs = STATS.map((_, k) => (rows[k] === null ? t.diffs[k] : t.diffs[k] - beta[k] * rows[k][0]));
    return Object.assign({}, t, { diffs });
  });
}
/* the evidence as the solves use it: the talent correction first (per raw move), then robust weighting */
function prepTransfers(list, means, o) {
  o = optsOf(o);
  const t2 = o.talent ? talentAdjust(list, means) : list;
  return o.robust ? satScale(dedupTransfers(t2)) : t2;
}

/* ------------------------------------------------------------------ the window's model --- */
/* RAW, a season window (years, inclusive) and {robust, talent, excluded} -> D, as the original app's deriveD.
   {lazySpain: true} leaves the Spanish scale (a third of the work) until the first time it is asked for: D.spain is
   undefined until D.ensureSpain() (routeDiff calls it), and D.spainAvailable says at once whether there is one. */
function deriveD(RAW, yLo, yHi, o) {
  o = optsOf(o);
  if (yLo > yHi) { const t = yLo; yLo = yHi; yHi = t; }
  const ex = toSet(o.excluded);
  const st = RAW.stints.filter(s => s.y >= yLo && s.y <= yHi && !ex.has(s.league));
  const full = traceTransfers(st);
  const wmeans = leagueMeansOf(st);
  const D = finalize(st.filter(s => s.vals[0] !== null), prepTransfers(full, wmeans, o), full);
  const spainFrom = () => traceTransfers(st, SPAIN_MIN_MINUTES);
  const setSpain = sp => {
    D.spain = sp ? D.leagues.map(nm => sp.map.get(nm) || null) : null;
    D.spainAnchor = sp ? sp.anchor : null;
    D.spainAvailable = !!sp;
    return D.spain;
  };
  if (o.lazySpain) {
    const spainFull = spainFrom(), lgs = new Set();
    spainFull.forEach(t => { lgs.add(t.F); lgs.add(t.T); });
    const anchor = spainFull.length ? spainAnchor(lgs) : null;
    D.spain = undefined; D.spainAnchor = anchor; D.spainAvailable = !!anchor;
    D.ensureSpain = () => (D.spain === undefined ? setSpain(computeSpainScale(prepTransfers(spainFull, wmeans, o))) : D.spain);
  } else {
    setSpain(computeSpainScale(prepTransfers(spainFrom(), wmeans, o)));
  }
  D.window = [yLo, yHi];
  D.settings = { robust: !!o.robust, talent: !!o.talent, excluded: [...ex].sort() };
  return D;
}

/* THE SPANISH SCALE: per stat, the moves become league-pair edges weighted by minutes, and the leagues' offsets are
   solved over the graph by weighted Gauss-Seidel, d = R(from) - R(to), the anchor (ACB, else down the Spanish pyramid)
   held at 0 (1,000 sweeps, tolerance 1e-6). Only leagues connected to the anchor get a number: the expected change in
   that stat moving from that league to the anchor. */
function spainAnchor(leagues) {
  const sorted = [...leagues].sort();
  for (const pats of SPAIN_PATTERNS) {
    const hit = sorted.find(nm => { const ll = nm.toLowerCase(); return pats.some(p => ll.includes(p)); });
    if (hit) return hit;
  }
  return null;
}
function computeSpainScale(transfers) {
  if (!transfers.length) return null;
  const leagues = new Set();
  transfers.forEach(t => { leagues.add(t.F); leagues.add(t.T); });
  const anchor = spainAnchor(leagues);
  if (!anchor) return null;
  const map = new Map();
  for (let k = 0; k < STATS.length; k++) {
    const edges = new Map();                         // per directed pair: [sum w, sum w x d, from, to]
    for (const t of transfers) {
      const d = t.diffs[k];
      if (d === null || t.w <= 0) continue;
      const key = t.F + '>' + t.T;
      let e = edges.get(key);
      if (!e) { e = [0, 0, t.F, t.T]; edges.set(key, e); }
      e[0] += t.w; e[1] += t.w * d;
    }
    const nb = new Map();                            // d = R(a) - R(b): R[a] = R[b] + d, R[b] = R[a] - d
    const push = (x, ot, d, w) => { let l = nb.get(x); if (!l) { l = []; nb.set(x, l); } l.push([ot, d, w]); };
    for (const [w, wd, a, b] of edges.values()) {
      const d = wd / w;
      push(a, b, d, w); push(b, a, -d, w);
    }
    const reach = new Set([anchor]); const stack = [anchor];
    while (stack.length) {
      const c = stack.pop();
      for (const [ot] of (nb.get(c) || [])) if (!reach.has(ot)) { reach.add(ot); stack.push(ot); }
    }
    /* the sweeps over plain arrays (the original kept Maps: the same sums in the same order, about twenty times slower).
       Every neighbour of a reached league is reached, so each edge counts, as it did there. */
    const order = [...reach], at = new Map(order.map((l, i) => [l, i]));
    const R = new Float64Array(order.length);
    const nbi = order.map(lg => {
      const l = nb.get(lg) || [], o2 = new Int32Array(l.length), d2 = new Float64Array(l.length), w2 = new Float64Array(l.length);
      l.forEach(([ot, d, w], j) => { o2[j] = at.get(ot); d2[j] = d; w2[j] = w; });
      return { o: o2, d: d2, w: w2 };
    });
    for (let it = 0; it < 1000; it++) {
      let md = 0;
      for (let i = 1; i < order.length; i++) {             // order[0] is the anchor, held at 0
        const e = nbi[i], eo = e.o, ed = e.d, ew = e.w;
        let num = 0, den = 0;
        for (let j = 0; j < eo.length; j++) { num += ew[j] * (R[eo[j]] + ed[j]); den += ew[j]; }
        if (den > 0) {
          const nv = num / den;
          const dv = Math.abs(nv - R[i]);
          if (dv > md) md = dv;
          R[i] = nv;
        }
      }
      if (md < 1e-6) break;
    }
    order.forEach((lg, i) => {
      let arr = map.get(lg);
      if (!arr) { arr = new Array(STATS.length).fill(null); map.set(lg, arr); }
      arr[k] = +R[i].toFixed(2);
    });
  }
  return { anchor, map };
}

/* ------------------------------------------------------------------ the translation --- */
/* the shift on route F -> T (indices into D.leagues) for stat k: {diff, n, w}, or null when the mode has nothing to go on */
function routeDiff(D, F, T, k, mode) {
  const pair = D.pairs[F + '>' + T];
  const emp = (pair && pair[k][1]) ? pair[k] : null;           // [mean shift, n]
  if (mode === 'direct') return emp ? { diff: emp[0], n: emp[1], w: 1 } : null;
  if (mode === 'spain') {
    if (D.spain === undefined && typeof D.ensureSpain === 'function') D.ensureSpain();
    if (!D.spain || !D.spain[F] || !D.spain[T]) return null;
    const a = D.spain[F][k], b = D.spain[T][k];
    if (a === null || b === null) return null;
    return { diff: a - b, n: emp ? emp[1] : 0, w: 0 };
  }
  const coefDiff = D.net[F][k] - D.net[T][k];
  if (!emp) return { diff: coefDiff, n: 0, w: 0 };
  const w = emp[1] / (emp[1] + K_BLEND);
  return { diff: w * emp[0] + (1 - w) * coefDiff, n: emp[1], w };
}
/* how much to trust a route: 'same', 'nodirect', 'notconnected', 'spain', 'high', 'moderate', 'sparse' or 'model' */
function confidence(D, F, T, mode) {
  const r = routeDiff(D, F, T, 0, mode), n = r ? r.n : 0;
  let level;
  if (F === T) level = 'same';
  else if (mode === 'direct' && !r) level = 'nodirect';
  else if (mode === 'spain' && !r) level = 'notconnected';
  else if (mode === 'spain') level = 'spain';
  else if (n >= CONF.high) level = 'high';
  else if (n >= CONF.moderate) level = 'moderate';
  else if (n >= CONF.sparse) level = 'sparse';
  else level = 'model';
  return { level, n, w: r ? r.w : 0, route: r };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/* inputs: nine numbers (NaN or null = not given); o = {mode, minutes, stabilise}. Every stat's projection as the
   original app drew it: stabilised toward the old league's average when asked, the route's shift added, held in range. */
function translate(D, F, T, inputs, o) {
  o = Object.assign({ mode: DEFAULTS.mode, minutes: 0, stabilise: false }, o || {});
  const same = F === T;
  const MIN = +o.minutes || 0;
  const shrink = MIN / (MIN + STABILISE_K);
  const sF = D.strength[F], sT = D.strength[T];
  const gap = sF[0] - sT[0];
  const conf = confidence(D, F, T, o.mode);
  let bpmOut = null, bpmIn = null;
  const rows = META.map((m, k) => {
    const raw = inputs[k] == null ? NaN : +inputs[k];
    if (isNaN(raw)) return { k: m.k, raw: null, proj: null, d: null, noData: false };
    let v = raw;
    if (o.stabilise) v = D.means[F][k] + (v - D.means[F][k]) * shrink;
    const r = routeDiff(D, F, T, k, o.mode);
    if (!same && !r) { if (k === 0) { bpmOut = null; bpmIn = raw; } return { k: m.k, raw, proj: null, d: null, noData: true }; }
    const proj = clamp(v + (same ? 0 : r.diff), m.lo, m.hi);
    const d = proj - raw;
    if (k === 0) { bpmOut = proj; bpmIn = raw; }
    return { k: m.k, raw, proj, d, noData: false, good: Math.abs(d) < 0.05 ? 0 : ((m.inverse ? d < 0 : d > 0) ? 1 : -1) };
  });
  return { same, gap, climbing: gap < 0, level: conf.level, n: conf.n, w: conf.w, rows, bpmIn, bpmOut };
}
/* a player's seasons in league li whose name holds q (2 letters or more): names starting with it first, then by minutes */
function searchPlayers(D, li, q, limit) {
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  D.players.forEach((p, idx) => {
    if (p[2] !== li) return;
    const pos = p[0].toLowerCase().indexOf(q);
    if (pos >= 0) hits.push([pos === 0 ? 0 : 1, -p[5], idx]);
  });
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.slice(0, limit || 14).map(h => h[2]);
}
/* the players who made this move (F -> T), nearest in BPM to ref first; {rows, reverse} where reverse counts T -> F */
function ghostsFor(D, F, T, ref) {
  const rows = D.ghosts.filter(g => g[0] === F && g[1] === T);
  const r = ref == null || isNaN(ref) ? 0 : ref;
  rows.sort((a, b) => Math.abs(a[8] - r) - Math.abs(b[8] - r));
  return { rows, reverse: rows.length ? 0 : D.ghosts.filter(g => g[0] === T && g[1] === F).length };
}

/* ------------------------------------------------------------------ the League Index --- */
/* one stat's network solve over a set of moves (as finalize, one stat): Map league -> coefficient, anchor 0 */
function solveStatNet(transfers, k) {
  const names = [...new Set(transfers.flatMap(t => [t.F, t.T]))].sort();
  if (!names.length) return null;
  let anchor = names.includes(ANCHOR) ? ANCHOR : null;
  if (!anchor) {
    const wsum = new Map();
    transfers.forEach(t => { wsum.set(t.F, (wsum.get(t.F) || 0) + t.w); wsum.set(t.T, (wsum.get(t.T) || 0) + t.w); });
    anchor = names.reduce((a, b) => ((wsum.get(b) || 0) > (wsum.get(a) || 0) ? b : a), names[0]);
  }
  const nmIdx = new Map(names.map((nm, i) => [nm, i]));
  const aPos = nmIdx.get(anchor);
  const varPos = names.map((_, i) => i).filter(i => i !== aPos);
  const vi = new Map(varPos.map((lp, j) => [lp, j]));
  const n = varPos.length;
  if (!n) return new Map([[anchor, 0]]);
  const M = Array.from({ length: n }, () => new Array(n).fill(0)), v = new Array(n).fill(0);
  accumulate(M, v, transfers, k, nmIdx, aPos, vi);
  for (let j = 0; j < n; j++) M[j][j] += 1.0;
  const sol = solveLinear(M, v);
  const out = new Map([[anchor, 0]]);
  varPos.forEach((lp, j) => out.set(names[lp], sol[j]));
  return out;
}
/* every season from yLo to yHi, each rated from the moves inside its trailing window (win seasons; 99 = everything to
   date), for the measure mKey. The window ignores the translator's season window; exclusions and the toggles apply. */
function computeIndex(RAW, win, yLo, yHi, mKey, o) {
  o = optsOf(o);
  if (yLo > yHi) { const t = yLo; yLo = yHi; yHi = t; }
  const ex = toSet(o.excluded);
  const m = IDX_METRICS[mKey] || IDX_METRICS.bpm;
  const seasons = RAW.years.filter(y => y >= yLo && y <= yHi).sort((a, b) => a - b);
  const base = RAW.allTransfers.filter(t => !ex.has(t.F) && !ex.has(t.T));
  const per = [];
  for (const Y of seasons) {
    const lo = win >= 99 ? 0 : Y - win + 1;
    const tr = prepTransfers(base.filter(t => t.y1 >= lo && t.y1 <= Y && t.y2 >= lo && t.y2 <= Y), RAW.globalMeans, o);
    let list = [];
    if (m.comps.length === 1) {
      const k = m.comps[0];
      const sol = solveStatNet(tr, k);
      if (sol) for (const [nm, c] of sol) list.push({ league: nm, grade: mKey === 'bpm' ? +(100 + 10 * c).toFixed(1) : +(STAT_ORIENT[k] * c).toFixed(2) });
    } else {
      /* a composite: each part's ladder, z-scored across the leagues all of them rate, averaged */
      const sols = m.comps.map(k => solveStatNet(tr, k));
      if (sols.every(Boolean)) {
        const common = [...sols[0].keys()].filter(nm => sols.every(s => s.has(nm)));
        if (common.length >= 3) {
          const zmaps = m.comps.map((k, ci) => {
            const vals = common.map(nm => STAT_ORIENT[k] * sols[ci].get(nm));
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length) || 1e-9;
            return new Map(common.map((nm, i) => [nm, (vals[i] - mean) / sd]));
          });
          list = common.map(nm => ({ league: nm, grade: +(100 * zmaps.reduce((a, z) => a + z.get(nm), 0) / zmaps.length).toFixed(1) }));
        }
      }
    }
    list.sort((a, b) => b.grade - a.grade);
    list.forEach((r, i) => { r.rank = i + 1; });
    per.push({ y: Y, label: RAW.yearLabel.get(Y) || String(Y), list, byLeague: new Map(list.map(r => [r.league, r])), n: tr.length });
  }
  const lastRank = nm => {
    for (let i = per.length - 1; i >= 0; i--) {
      const r = per[i].byLeague.get(nm);
      if (r) return r.rank + (per.length - 1 - i) * 1000;      // unrated lately sinks
    }
    return 1e9;
  };
  const leagues = [...new Set(per.flatMap(p => p.list.map(r => r.league)))].sort((a, b) => lastRank(a) - lastRank(b));
  return { per, leagues, win, metric: mKey };
}
/* THE VOTE LEDGER: which neighbouring leagues set league nm's rating in the last season it was rated, and how much.
   A neighbour's vote is its own rating plus the shift seen on the edge; the league's rating is (about) the weighted mean
   of the votes. A composite's ledger shows BPM. */
function ledger(RAW, data, nm, o) {
  o = optsOf(o);
  const ex = toSet(o.excluded);
  const win = data.win;
  const m = IDX_METRICS[data.metric] || IDX_METRICS.bpm;
  const single = m.comps.length === 1;
  const k = single ? m.comps[0] : 0;
  let Y = null;
  for (let i = data.per.length - 1; i >= 0; i--) { if (data.per[i].byLeague.get(nm)) { Y = data.per[i].y; break; } }
  if (Y === null) return null;
  const wlo = win >= 99 ? 0 : Y - win + 1;
  const baseFull = RAW.allTransfers.filter(t => !ex.has(t.F) && !ex.has(t.T) && t.y1 >= wlo && t.y1 <= Y && t.y2 >= wlo && t.y2 <= Y);
  const solveList = prepTransfers(baseFull, RAW.globalMeans, o);
  const R = solveStatNet(solveList, k);
  if (!R || !R.has(nm)) return null;
  const agg = new Map();
  for (const t of solveList) {
    const d = t.diffs[k];
    if (d === null) continue;
    let ot = null, out = false;
    if (t.F === nm) { ot = t.T; out = true; }
    else if (t.T === nm) ot = t.F;
    else continue;
    const a = agg.get(ot) || { w1: 0, ds1: 0, n1: 0, w2: 0, ds2: 0, n2: 0 };
    if (out) { a.w1 += t.w; a.ds1 += t.w * d; a.n1++; }
    else { a.w2 += t.w; a.ds2 += t.w * d; a.n2++; }
    agg.set(ot, a);
  }
  const movers = new Map(), recs = new Map();
  for (const t of baseFull) {
    const ot = t.F === nm ? t.T : (t.T === nm ? t.F : null);
    if (!ot) continue;
    if (!movers.has(ot)) movers.set(ot, new Set());
    movers.get(ot).add(t.pid || t.name);
    recs.set(ot, (recs.get(ot) || 0) + 1);
  }
  const rows = []; let tw = 0;
  for (const [ot, a] of agg) {
    if (!R.has(ot)) continue;
    const w = a.w1 + a.w2; tw += w;
    const d1 = a.n1 ? a.ds1 / a.w1 : null;           // the mean shift leaving nm for ot
    const d2 = a.n2 ? a.ds2 / a.w2 : null;           // the mean shift arriving in nm from ot
    const v = ((a.w1 ? a.w1 * (R.get(ot) + d1) : 0) + (a.w2 ? a.w2 * (R.get(ot) - d2) : 0)) / w;
    rows.push({ league: ot, w, d1, d2, v, records: recs.get(ot) || 0, movers: (movers.get(ot) || new Set()).size, rating: R.get(ot) });
  }
  rows.sort((a, b) => b.w - a.w);
  rows.forEach(r => { r.share = tw ? r.w / tw : 0; });
  const rank = [...R.entries()].sort((a, b) => b[1] - a[1]).findIndex(e => e[0] === nm) + 1;
  return { league: nm, y: Y, label: RAW.yearLabel.get(Y) || String(Y), k, single, metric: data.metric, win, rating: R.get(nm), rank, of: R.size, rows };
}

/* ------------------------------------------------------------------ the league scale --- */
/* the members' scale file, 'tscale' (tools/build-transfer.mjs documents it): D in league names, nulls where there is no data */
function scaleFile(RAW, D, o) {
  o = o || {};
  const ys = RAW.years.slice().sort((a, b) => a - b);
  const lab = y => RAW.yearLabel.get(y) || String(y);
  const unl = new Set(D.unlinked || []);
  const per = new Map(D.leagues.map(nm => [nm, { n: 0, lo: Infinity, hi: -Infinity }]));
  for (const p of D.players) {
    const e = per.get(D.leagues[p[2]]);
    const y = yearOf(p[1]);
    e.n++; if (y && y < e.lo) e.lo = y; if (y && y > e.hi) e.hi = y;
  }
  const leagues = {};
  D.leagues.forEach((nm, i) => {
    const e = per.get(nm);
    leagues[nm] = {
      net: unl.has(nm) ? null : D.net[i].slice(),
      mean: D.meansOrNull[i].every(v => v === null) ? null : D.meansOrNull[i].slice(),
      strength: D.strength[i].slice(),
      stints: e.n,
      seasons: isFinite(e.lo) ? [lab(e.lo), lab(e.hi)] : null
    };
  });
  const pairs = {};
  Object.keys(D.pairs).sort((a, b) => {
    const [a1, a2] = a.split('>').map(Number), [b1, b2] = b.split('>').map(Number);
    return a1 - b1 || a2 - b2;
  }).forEach(key => {
    const [i, j] = key.split('>').map(Number);
    pairs[D.leagues[i] + '>' + D.leagues[j]] = D.pairs[key].map(([d, n]) => (n ? [d, n] : null));
  });
  const meta = META.map(m => {
    const x = { k: m.k, lab: m.lab, dec: m.dec, lo: m.lo, hi: m.hi };
    if (m.signed) x.signed = true;
    if (m.inverse) x.inverse = true;
    return x;
  });
  return {
    version: 1,
    built: o.built || new Date().toISOString().slice(0, 10),
    seasons: [lab(ys[0]), lab(ys[ys.length - 1])],
    settings: { mode: 'blend', robust: !!D.settings.robust, talent: !!D.settings.talent, kBlend: K_BLEND, anchor: D.anchor },
    stats: STATS.slice(),
    meta,
    leagues,
    pairs
  };
}

return {
  STATS, META, MIN_FLOOR, K_BLEND, ANCHOR, SAT_CAP, SPAIN_MIN_MINUTES, STABILISE_K, CONF, DEFAULTS, IDX_METRICS, STAT_ORIENT,
  parseCSV, ingestCSV, encodeStore, decodeStore, STORE_V, finishRaw, smartMatchIrish, nrmName,
  traceTransfers, dedupTransfers, satScale, leagueMeansOf, talentAdjust, talentBeta, prepTransfers,
  solveLinear, finalize, deriveD, spainAnchor, computeSpainScale,
  routeDiff, confidence, translate, searchPlayers, ghostsFor,
  solveStatNet, computeIndex, ledger, scaleFile
};
}));
