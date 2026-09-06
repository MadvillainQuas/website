'use strict';
/* ============================================================================
   EPINOIA MATCH — the same person, spelled three ways in three systems.

   A statistician types "M. King-Danchie"; a federation feed says "Moziah
   KING-DANCHIE"; a CSV from the analytics app has "Moziah King Danchie"; a
   league site has "King-Danchie, Moziah". They are one player, and every
   surface that joins two of those systems has been guessing with its own
   half-rule. This is the one rule, shared by index_9, the Epinoia pages and
   (as a Python port, scripts/ingest/matching.py) the ingest worker.

   HOW A MATCH IS SCORED. Never a single string distance. Each candidate gets
   a score from several independent facts, so a coincidence in one is not a
   match on its own:

     surname   exact / near-exact (Jaro-Winkler) / one of the tokens
     forename  exact / nickname (Mike-Michael) / initial / near-exact
     club      the same club is strong evidence; a different club in the same
               league counts against, because the same name at two clubs is
               two people until proven otherwise
     number    a matching shirt number is a small confirmation
     position  a matching position is a whisper
     aliases   every spelling a record already carries is tried

   The best candidate must clear a threshold AND beat the runner-up by a
   margin, or the answer is "ambiguous" — which is the honest answer, and the
   one a worker must not paper over by picking the first.

   Nothing here touches the DOM or the network. It is arithmetic over records
   the caller already holds.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ------------------------------------------------------------ normalise --- */
const SUFFIX = /\b(jr|sr|ii|iii|iv)\b\.?/g;
function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')     // diacritics off
    .toLowerCase()
    .replace(/['’`´]/g, '')                              // O'Neal -> oneal, D'Angelo -> dangelo
    .replace(/[-–—_.,/]+/g, ' ')                          // King-Danchie -> king danchie
    .replace(SUFFIX, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* The common short forms. Both directions; a first name that is itself a
   nickname of the other counts as the same forename. */
const NICK = {
  michael: ['mike', 'mikey', 'mick', 'mickey'], matthew: ['matt', 'matty'], daniel: ['dan', 'danny'],
  christopher: ['chris', 'kit'], thomas: ['tom', 'tommy'], benjamin: ['ben', 'benny', 'benji'],
  samuel: ['sam', 'sammy'], alexander: ['alex', 'xander', 'sasha'], nicholas: ['nick', 'nicky'],
  joshua: ['josh'], jacob: ['jake'], william: ['will', 'bill', 'billy', 'liam'], joseph: ['joe', 'joey'],
  robert: ['rob', 'bob', 'bobby', 'robbie'], james: ['jim', 'jimmy', 'jamie'], david: ['dave', 'davey'],
  stephen: ['steve', 'stevie'], steven: ['steve', 'stevie'], andrew: ['andy', 'drew'], oliver: ['ollie', 'oli'],
  henry: ['harry', 'hal'], edward: ['ed', 'eddie', 'ted', 'teddy'], anthony: ['tony', 'ant'],
  jonathan: ['jon', 'jonny', 'johnny'], john: ['johnny', 'jack'], richard: ['rich', 'rick', 'ricky', 'dick'],
  charles: ['charlie', 'chuck'], patrick: ['pat', 'paddy'], timothy: ['tim', 'timmy'],
  nathaniel: ['nate', 'nat'], nathan: ['nate'], zachary: ['zach', 'zack'], isaiah: ['zay'],
  cameron: ['cam'], dominic: ['dom'], frederick: ['fred', 'freddie'], gregory: ['greg'],
  jeremiah: ['jerry'], leonard: ['leo', 'lenny'], maximilian: ['max'], theodore: ['theo', 'ted'],
  louis: ['lou', 'louie'], lewis: ['lew'], kenneth: ['ken', 'kenny'], raymond: ['ray'],
  elizabeth: ['liz', 'beth', 'lizzie'], katherine: ['kate', 'katie', 'kathy'], jennifer: ['jen', 'jenny'],
  rebecca: ['becky', 'bex'], victoria: ['vicky', 'tori'], alexandra: ['alex', 'lexi'],
  jessica: ['jess'], stephanie: ['steph'], samantha: ['sam'], charlotte: ['lottie', 'charlie'],
  isabella: ['bella', 'izzy'], gabriella: ['gabby'], josephine: ['jo', 'josie']
};
const NICK_OF = {};
Object.keys(NICK).forEach(full => {
  NICK[full].forEach(n => { (NICK_OF[n] = NICK_OF[n] || new Set()).add(full); });
  (NICK_OF[full] = NICK_OF[full] || new Set()).add(full);
});
function sameForename(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = NICK_OF[a], B = NICK_OF[b];
  if (A && A.has(b)) return true;
  if (B && B.has(a)) return true;
  if (A && B) for (const x of A) if (B.has(x)) return true;
  return false;
}

/* ---------------------------------------------------------- name parsing --- */
/* {first, last, initial, tokens}. Understands "Last, First", "F. Last",
   "First LAST" (federation capitals mark the surname), "First Middle Last"
   and a bare surname. Particles (van, de, da, del, di, le, la, mac, mc, st)
   stay with the surname. */
const PARTICLE = new Set(['van', 'von', 'de', 'da', 'del', 'della', 'di', 'du', 'le', 'la', 'st', 'saint', 'mac', 'mc', 'o', 'bin', 'al', 'el', 'ben']);
function parseName(input) {
  if (input && typeof input === 'object') {
    const f = normalize(input.first || input.first_name || input.firstName || '');
    const l = normalize(input.last || input.last_name || input.lastName || input.familyName || '');
    if (f || l) return finish(f, l);
    input = input.name || '';
  }
  const raw = String(input || '').trim();
  if (!raw) return finish('', '');
  if (raw.includes(',')) {                                // Last, First
    const [l, f] = raw.split(',');
    return finish(normalize(f), normalize(l));
  }
  const capsLast = raw.match(/^(.+?)\s+([A-ZÀ-Ý][A-ZÀ-Ý' -]{1,})$/);   // First LAST
  if (capsLast && capsLast[2].length > 1 && capsLast[2] === capsLast[2].toUpperCase()) {
    return finish(normalize(capsLast[1]), normalize(capsLast[2]));
  }
  const capsFirst = raw.match(/^([A-ZÀ-Ý][A-ZÀ-Ý' -]{1,})\s+(.+)$/);    // LAST First
  if (capsFirst && capsFirst[1] === capsFirst[1].toUpperCase() && capsFirst[2] !== capsFirst[2].toUpperCase()) {
    return finish(normalize(capsFirst[2]), normalize(capsFirst[1]));
  }
  const toks = normalize(raw).split(' ').filter(Boolean);
  if (toks.length === 1) return finish('', toks[0]);
  // "m king danchie": an initial then the surname
  if (toks[0].length === 1) return finish(toks[0], toks.slice(1).join(' '));
  // surname = last token plus any particles before it
  let i = toks.length - 1;
  while (i > 1 && PARTICLE.has(toks[i - 1])) i--;
  return finish(toks.slice(0, i).join(' '), toks.slice(i).join(' '));
}
function finish(first, last) {
  const f = first.split(' ').filter(Boolean), l = last.split(' ').filter(Boolean);
  return { first, last, firstTok: f[0] || '', initial: (f[0] || '')[0] || '',
           lastTokens: l, tokens: f.concat(l), full: (first + ' ' + last).trim() };
}

/* --------------------------------------------------------- jaro-winkler --- */
function jaroWinkler(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - m), hi = Math.min(b.length - 1, i + m);
    for (let j = lo; j <= hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const j = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/* --------------------------------------------------------- name scoring --- */
/* 0..1. Surname carries most of it; the forename confirms or contradicts.
   An initial-only query can only ever be a confident match with the club or
   the shirt number agreeing (see matchPlayer) — on its own it tops out below
   the threshold, on purpose. */
function nameScore(qName, cName) {
  const q = typeof qName === 'string' || !qName.tokens ? parseName(qName) : qName;
  const c = typeof cName === 'string' || !cName.tokens ? parseName(cName) : cName;
  if (!q.full || !c.full) return 0;
  let s = 0;
  const reasons = [];
  // surname
  if (q.last && c.last) {
    if (q.last === c.last) { s += 0.58; reasons.push('surname'); }
    else {
      const jw = jaroWinkler(q.last.replace(/ /g, ''), c.last.replace(/ /g, ''));
      const shared = q.lastTokens.some(t => t.length > 2 && c.lastTokens.includes(t));
      if (jw >= 0.93) { s += 0.48; reasons.push('surname~'); }
      else if (shared) { s += 0.42; reasons.push('surname-part'); }
      else if (jw >= 0.86) { s += 0.3; reasons.push('surname?'); }
      else return 0;                                  // different surname: not the same person
    }
  } else if (q.last === c.last) { s += 0.3; }
  // forename
  if (q.firstTok && c.firstTok) {
    if (sameForename(q.firstTok, c.firstTok)) { s += 0.36; reasons.push(q.firstTok === c.firstTok ? 'forename' : 'nickname'); }
    else if (q.firstTok.length === 1 || c.firstTok.length === 1) {
      if (q.initial === c.initial) { s += 0.2; reasons.push('initial'); }
      else return 0;                                  // A. Smith is not B. Smith
    } else {
      const jw = jaroWinkler(q.firstTok, c.firstTok);
      if (jw >= 0.9) { s += 0.3; reasons.push('forename~'); }
      else if (q.initial === c.initial && (q.first.includes(c.firstTok) || c.first.includes(q.firstTok))) { s += 0.28; reasons.push('forename-part'); }
      else if (q.initial === c.initial) { s += 0.08; reasons.push('initial-only'); }
      else s -= 0.25;                                 // two different forenames on one surname
    }
  } else if (!q.firstTok || !c.firstTok) {
    s += 0.14;                                        // one side has no forename at all
    reasons.push('surname-only');
  }
  // a whole-string floor for orderings the parser did not expect
  const jwFull = jaroWinkler(q.tokens.slice().sort().join(' '), c.tokens.slice().sort().join(' '));
  s = Math.max(s, jwFull >= 0.97 ? 0.9 : 0);
  return { score: Math.max(0, Math.min(1, s)), reasons };
}

/* ----------------------------------------------------------- team names --- */
/* "Loughborough Riders" ~ "Riders" ~ "LOU" ~ "Loughborough Riders Basketball Club" */
const TEAM_NOISE = new Set(['basketball', 'club', 'bc', 'the', 'team', 'men', 'women', 'mens', 'womens', 'ii', '2', 'b']);
function teamTokens(name) { return normalize(name).split(' ').filter(t => t && !TEAM_NOISE.has(t)); }
function teamScore(a, b) {
  if (!a || !b) return 0;
  const A = teamTokens(a), B = teamTokens(b);
  if (!A.length || !B.length) return 0;
  const na = A.join(' '), nb = B.join(' ');
  if (na === nb) return 1;
  const setB = new Set(B), inter = A.filter(t => setB.has(t)).length;
  const jac = inter / (A.length + B.length - inter);
  const code = (x) => x.length <= 4 && x === x.toUpperCase();
  if (code(String(a)) || code(String(b))) {           // a club code against a name
    const c = normalize(code(String(a)) ? a : b), n = code(String(a)) ? B : A;
    const initials = n.map(t => t[0]).join('');
    if (initials.startsWith(c) || n.some(t => t.startsWith(c))) return 0.8;
  }
  return Math.max(jac, jaroWinkler(na, nb) >= 0.94 ? 0.85 : 0, inter ? 0.55 : 0);
}
function matchTeam(name, teams, opts) {
  const o = opts || {};
  const rows = (teams || []).map(t => {
    const names = [t.name, t.short_name, t.code, t.slug].concat(t.aliases || []).filter(Boolean);
    const score = Math.max.apply(null, names.map(n => teamScore(name, n)).concat([0]));
    return { team: t, score };
  }).sort((x, y) => y.score - x.score);
  const best = rows[0], next = rows[1];
  const ok = best && best.score >= (o.threshold != null ? o.threshold : 0.55) &&
             (!next || best.score - next.score >= 0.1 || best.score === 1);
  return { best: ok ? best.team : null, score: best ? best.score : 0, ranked: rows };
}

/* ---------------------------------------------------------- the matcher --- */
/* query:      {name | first,last, team, number, position}
   candidate:  {id, name | first_name,last_name, aliases[], team | teams[], number, position, ...}
   opts:       {threshold=0.82, margin=0.06, teamsKnown}   */
function matchPlayer(query, candidates, opts) {
  const o = opts || {};
  const threshold = o.threshold != null ? o.threshold : 0.82;
  const margin = o.margin != null ? o.margin : 0.06;
  const q = parseName(query.name || query);
  const qTeam = query.team || null, qNum = query.number != null && query.number !== '' ? String(query.number) : null;
  const qPos = query.position ? String(query.position).toLowerCase()[0] : null;
  const ranked = (candidates || []).map(c => {
    const names = [c.name || { first: c.first_name || c.first, last: c.last_name || c.last }].concat(c.aliases || []);
    let best = { score: 0, reasons: [] };
    names.forEach(n => { const r = nameScore(q, n); if (r && r.score > best.score) best = r; });
    if (!best.score) return { candidate: c, score: 0, reasons: [] };
    let s = best.score; const reasons = best.reasons.slice();
    const cTeams = [].concat(c.teams || [], c.team ? [c.team] : []).filter(Boolean);
    if (qTeam && cTeams.length) {
      const ts = Math.max.apply(null, cTeams.map(t => teamScore(qTeam, typeof t === 'string' ? t : (t.name || t.short_name || ''))));
      if (ts >= 0.8) { s += 0.16; reasons.push('club'); }
      else if (ts >= 0.55) { s += 0.08; reasons.push('club~'); }
      else { s -= 0.14; reasons.push('other-club'); }
    }
    if (qNum && c.number != null && String(c.number) !== '') {
      if (String(c.number) === qNum) { s += 0.1; reasons.push('number'); }
      else { s -= 0.05; reasons.push('other-number'); }
    }
    if (qPos && c.position && String(c.position).toLowerCase()[0] === qPos) { s += 0.03; reasons.push('position'); }
    return { candidate: c, score: Math.max(0, Math.min(1.2, s)), reasons };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  const best = ranked[0], next = ranked[1];
  let status = 'none', match = null;
  if (best && best.score >= threshold) {
    if (!next || best.score - next.score >= margin) { status = 'match'; match = best.candidate; }
    else status = 'ambiguous';
  } else if (best) status = 'weak';
  return { status, match, best: best || null, ranked };
}

return { normalize, parseName, jaroWinkler, nameScore, sameForename, teamScore, matchTeam, matchPlayer, VERSION: '1.0.0' };
}));
