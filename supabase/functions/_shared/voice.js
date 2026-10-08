/* GENERATED from epinoia/voice.js by supabase/tests/extract-shared.mjs — do not edit. */
'use strict';
/* ============================================================================
   THE HOUSE VOICE: how the newsroom (newsroom.js) and the storylines (narrative.js) write English.

   Written for fans, not analysts (Louie, 2026-10-08): stakes, characters and feeling first; a number only where it
   lands, said the way a fan would say it ("nearly half their shots are threes", "unbeaten", "a different team when he
   sits"). Never model-speak: no "the numbers say", "points a chance", "per 100 possessions", "one standard step".

   HOW A SENTENCE IS MADE - a pipeline in the SimpleNLG tradition, on jsRealB (tools/vendor/jsrealb, the builder only):
     1. CONTENT   a format decides what to say and passes a context: the facts, and the people and clubs in them as
                  ENTITIES (club(name, {role, id}) / person(name, {g, id})), never as bare strings.
     2. PLAN      a phrasebook SLOT (below) holds ENTRIES - the situation each fits (when) and its options. An option is
                  a canned sentence ("Too close to call.") or a PLAN built from CLAUSES:
                    cl(subject, verb lemma, the rest, {t, perf, prog, neg, mod})     one clause, SimpleNLG-style
                    join(relation, a, b)     two clauses by what links them: contrast, clash, addition, cause, result,
                                             condition, concession, time. The planner chooses the FORM - a compound
                                             sentence ("a, but b"), a complex one ("Although a, b", "b because a"), two
                                             sentences ("a. Even so, b") - avoiding the form, the conjunction and the
                                             sentence type it used last, so the rhythm varies.
                    rel(a, b)                b's subject described by a relative clause: "X, who have won five straight,
                                             come to Athens" (a and b share their subject, or it is not done)
                    part(a, b)               a participle phrase: "Having won five straight, X arrive in form" (only with
                                             the same subject: no dangling modifier)
     3. REALISE   jsRealB makes the grammar: agreement (a club takes the plural, as British English does: "Panathinaikos
                  have"; a player the singular), tense and aspect, negation, modals, articles, number words, pronouns,
                  possessives, the commas of coordination and subordination.
                  REFERRING EXPRESSIONS: a club or a player is named in full the first time; after that a club is "the
                  hosts" or "the visitors" in a game, a player by surname, and either is "they" / "he" / "she" only as the
                  subject of a sentence that follows one about them and nobody else of the kind.
     4. PROOF     every sentence is read back against what the piece has said so far (the autocorrect of a phone, done
                  properly): spacing and punctuation, a/an by sound, doubled words, a numeral opening a sentence, "1
                  points", a club's plural verb in canned text, British spelling, "in the league" said twice. A sentence
                  that opens like the one before, repeats a phrase the piece has used, or runs past forty words is sent
                  back, and the next option is tried.
   Where jsRealB is not loaded (a page in the browser) only the canned options are said.

       const W = EpinoiaVoice.writer('seed of the piece');
       W.say('game.stakes', { A: club('Panathinaikos'), B: club('Fenerbahce'), bothUnbeaten: true })
       W.all('watch.head', {...})    every headline that fits (each said alone), for the headline test

   To add a way of saying something: add an option to its slot. To add a situation: add an entry with its when.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EpinoiaVoice = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const seedOf = s => { let h = 2166136261; const t = String(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const cap = s => String(s || '').replace(/^(\s*["“‘(]?)([a-z])/, (m, w, c) => w + c.toUpperCase());

/* ----------------------------------------------------------------- the grammar --- */
/* jsRealB (Apache-2.0; its English lexicon CC-BY-SA-4.0), vendored for the builder in tools/vendor/jsrealb */
const J = (() => {
  let j = root.jsRealB || null;
  if (!j && typeof require === 'function') { try { j = require('../tools/vendor/jsrealb/jsRealB.js'); } catch (_) { j = null; } }
  if (j) { try { j.loadEn(); if (j.setQuoteOOV) j.setQuoteOOV(true); } catch (_) { j = null; } }
  return j;
})();

/* ------------------------------------------------------------- numbers, said --- */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = n => { const v = Math.round(+n); return v >= 0 && v <= 12 ? WORDS[v] : String(v); };
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const TEENS = ['thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const spellOut = n => { const v = Math.round(+n); if (v <= 12) return spell(v); if (v < 20) return TEENS[v - 13]; if (v < 100) return TENS[Math.floor(v / 10)] + (v % 10 ? '-' + WORDS[v % 10] : ''); return String(v); };
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const nth = n => { const v = Math.round(+n); if (v >= 1 && v <= 10) return ORD[v]; const t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
/* a share as a fan says it: 47.2 -> "nearly half", 40.5 -> "two in five", 52 -> "just over half" */
const FRACS = [[0.1, 'one in ten'], [0.2, 'one in five'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.4, 'two in five'], [0.5, 'half'], [0.6, 'three in five'],
  [2 / 3, 'two thirds'], [0.75, 'three quarters'], [0.8, 'four in five'], [0.9, 'nine in ten']];
function frac(pct) {
  const p = +pct / 100;
  if (!isFinite(p)) return null;
  let best = FRACS[0];
  FRACS.forEach(f => { if (Math.abs(f[0] - p) < Math.abs(best[0] - p)) best = f; });
  const d = p - best[0];
  return (Math.abs(d) < 0.012 ? '' : d < 0 ? 'nearly ' : 'just over ') + best[1];
}
/* a game average as a fan says it: whole numbers ("19 a night"), a decimal only under ten */
const avg = v => (v == null || !isFinite(+v) ? null : Math.abs(+v) >= 10 ? String(Math.round(+v)) : (Math.round(+v * 10) / 10).toFixed(1));
/* a or an, by the sound of the word after it */
function article(word) {
  const w = String(word || '').replace(/^["“‘(]/, '');
  if (/^(8|11|18|8\d|8\d\d)(\b|\D)/.test(w)) return 'an';
  if (/^\d/.test(w)) return 'a';
  if (/^(honou?r|hour|heir|honest)/i.test(w)) return 'an';
  if (/^(uni|use|usu|uti|ufo|eu|ewe|one\b|once)/i.test(w)) return 'a';
  if (/^[A-Z]{2,}\b/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? 'an' : 'a';      // an initialism: "an NBA", "a BBL"
  return /^[aeiou]/i.test(w) ? 'an' : 'a';
}
const possOf = n => String(n) + (/s$/i.test(String(n)) ? '’' : '’s');
const surname = n => { const p = String(n || '').trim().split(/\s+/); if (p.length < 2) return p[0] || ''; const last = p[p.length - 1];
  return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && p.length > 2 ? p[p.length - 2] + ' ' + last : p.slice(1).join(' '); };

/* -------------------------------------------------------------------- entities --- */
let eid = 0;
/* club(name, { id, role, short }): `short` is how a report names the club after the first time ("Kėdainiai" for "Kėdainių
   Kėdainiai BC", game/matchwriter.js clubShort) -- every later mention, never alternating with the full name.
   person(name, { id, g }): g 'm' or 'f'; null when the league does not say, and then the player is never "he" or "she". */
const club = (name, o) => ({ ent: 'club', id: (o && o.id) || 'c' + (++eid), name: String(name), role: (o && o.role) || null, short: (o && o.short) || null, plural: true });
const person = (name, o) => ({ ent: 'person', id: (o && o.id) || 'p' + (++eid), name: String(name), short: (o && o.short) || surname(name),
  g: o && Object.prototype.hasOwnProperty.call(o, 'g') ? o.g : 'm', plural: false });
const isEnt = x => x && typeof x === 'object' && (x.ent === 'club' || x.ent === 'person');

/* --------------------------------------------------------------- clause plans --- */
const cl = (subj, v, c, o) => ({ k: 'cl', subj, v, c: c || '', o: o || {} });
const join = (rel, a, b) => ({ k: 'join', rel, a, b });
const relc = (a, b) => ({ k: 'rel', a, b });
const part = (a, b) => ({ k: 'part', a, b });
const B = { cl, join, rel: relc, part, club, person, frac, avg, spell, nth };
/* the forms each relation can take: [type, how, word]. type: simple | compound | complex | two (two sentences) */
const FORMS = {
  contrast:   [['compound', 'co', 'but'], ['compound', 'co', 'yet'], ['complex', 'front', 'while'], ['complex', 'trail', 'whereas']],
  clash:      [['compound', 'co', 'and'], ['compound', 'co', 'but'], ['complex', 'front', 'while'], ['compound', 'semi', '']],
  addition:   [['compound', 'co', 'and'], ['compound', 'semi', ''], ['two', 'two', 'What is more,'], ['two', 'two', 'On top of that,']],
  cause:      [['complex', 'trail-rev', 'because'], ['complex', 'front', 'because'], ['complex', 'front', 'as'], ['compound', 'co', 'so']],
  condition:  [['complex', 'front', 'if'], ['complex', 'trail-rev', 'if']],
  concession: [['complex', 'front', 'even though'], ['complex', 'front', 'although'], ['two', 'two', 'Even so,'], ['two', 'two', 'Still,']],
  time:       [['complex', 'front', 'when'], ['complex', 'trail-rev', 'when']]
};

/* ------------------------------------------------------------------- the proof --- */
const BRITISH = { offense: 'offence', defense: 'defence', favorite: 'favourite', favorites: 'favourites', center: 'centre', color: 'colour', honor: 'honour',
  analyze: 'analyse', realize: 'realise', recognize: 'recognise', organize: 'organise', apologize: 'apologise', criticize: 'criticise', toward: 'towards' };
const NOUNS = 'point|game|win|defeat|loss|rebound|assist|minute|possession|turnover|three|shot|season|block|steal|place|night|player|team|club|meeting';
/* the words that open a sentence or a clause in front of a club's name ("While Elm City have", "But Ash City are") */
const SENTENCE_WORDS = /^(while|but|and|when|although|though|because|if|as|so|both|then|now|still|yet|even|that|this|with|after|before|since|until|for|at|in|on|by|where|whereas|meanwhile|however|once|unless|whether|only|perhaps|today|tonight|here|there|nobody|everybody)$/i;
function proof(text, H) {
  const bare = !!(H && H.bare);
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { text: '', flags: ['empty'] };
  t = t.replace(/\s+([,.;:!?’])(?!\w)/g, '$1').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?=[A-Za-z“‘(])/g, '$1 ')
    .replace(/,\s*,/g, ',').replace(/,\s*\./g, '.').replace(/\.\s*\./g, '.').replace(/;\s*\./g, '.').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  t = t.replace(/\b(\w+) \1\b/gi, (m, w) => (/^(that|had|is)$/i.test(w) ? m : w));
  t = t.replace(/\b([Aa])n? ([“‘"(]?[\w’'-]+)/g, (m, a, w) => { const x = article(w); return (a === 'A' ? cap(x) : x) + ' ' + w; });
  t = t.replace(new RegExp('(?<![\\d.,])\\b(1|one|One) (' + NOUNS + ')s\\b', 'g'), '$1 $2');
  t = t.replace(/s’s\b/g, 's’');
  t = t.replace(/\b[a-z]+\b/g, w => BRITISH[w] || w);
  (H && H.clubs || []).forEach(n => { if (!n) return; const e = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* the club's name on its own, not the end of somebody's: "Ada Aces was" (a player named like the club) stays singular,
       "While Elm City have" (a capital that only opens the sentence) does not */
    t = t.replace(new RegExp('\\b' + e + ' (has|is|was|does)\\b', 'gu'), (m, v, off, str) => {
      const prev = (/([\p{L}’'-]+)\s$/u.exec(str.slice(0, off)) || [])[1];
      if (prev && /^\p{Lu}/u.test(prev) && !SENTENCE_WORDS.test(prev)) return m;
      return n + ' ' + ({ has: 'have', is: 'are', was: 'were', does: 'do' })[v];
    }); });
  t = t.replace(/\b(he|she|He|She) (have|are|were|do)\b/g, (m, p, v) => p + ' ' + ({ have: 'has', are: 'is', were: 'was', do: 'does' })[v]);
  t = t.replace(/\b(they|They) (has|is|was|does)\b/g, (m, p, v) => p + ' ' + ({ has: 'have', is: 'are', was: 'were', does: 'do' })[v]);
  { let k = 0; t = t.replace(/ in the league\b/g, m => (++k > 1 ? '' : m)); }
  const lead = /^(\d+)\b(?![.,:–-]\d)/.exec(t);
  if (lead && +lead[1] <= 99) t = spellOut(+lead[1]) + t.slice(lead[1].length);
  t = t.replace(/([a-z0-9”’)][.!?] )([a-z])/g, (m, p, c) => p + c.toUpperCase());
  t = cap(t);
  if (bare) t = t.replace(/\.$/, '');
  else if (!/[.!?…”’"]$/.test(t)) t += '.';
  /* what is sent back: an opening the sentence before had, a phrase the piece has used, a sentence too long to follow */
  const flags = [];
  const open = (t.match(/^[“‘"(]?([A-Za-z’']+)/) || [])[1];
  if (H && open && H.open && open.toLowerCase() === H.open.toLowerCase() && !/^(the)$/i.test(open)) flags.push('opening');
  const words = t.toLowerCase().replace(/[^a-z’' ]/g, ' ').split(/\s+/).filter(Boolean);
  if (H && H.grams) for (let i = 0; i + 4 <= words.length; i++) { const g = words.slice(i, i + 4).join(' '); if (H.grams.has(g) && !/^(the|in the|of the|a|and)/.test(g)) { flags.push('repeat'); break; } }
  if (words.length > 40) flags.push('long');
  return { text: t, flags };
}

/* ------------------------------------------------------------ the writer --- */
const fillCanned = (s, c, ref) => {
  let miss = false;
  const t = s.replace(/\{(\w+)\}(’s)?/g, (m, k, poss, at) => {
    const v = c[k];
    if (v == null) { miss = true; return ''; }
    if (isEnt(v)) return ref(v, at === 0 ? 'subj' : 'obj', !!poss);
    return String(v) + (poss ? '' : '') + (poss ? (/s$/i.test(String(v)) ? '’' : '’s') : '');
  });
  return miss ? null : t;
};
function options(slot, c) {
  const bank = BANK[slot] || [], ctx = c || {};
  /* an entry for a situation outranks one for any situation; a level, where given, decides between situations */
  const lv = e => (e.level != null ? e.level : e.when ? 1 : 0);
  const fits = bank.filter(e => !e.when || e.when(ctx));
  const top = Math.max(-1, ...fits.map(lv));
  const out = [];
  /* a function option is offered everywhere: it may return a canned sentence or a join of two (said without jsRealB); a plan
     it returns needs jsRealB, and where that is not loaded the option simply comes back empty and the next is tried */
  fits.filter(e => lv(e) === top).forEach(e => e.say.forEach(o => { if (typeof o === 'string' || typeof o === 'function' || J) out.push(o); }));
  return out;
}
/* MORE PHRASEBOOKS: a writer elsewhere (the match report, game/matchwriter.js) adds its slots to the house voice, so its
   sentences are planned, referred, proofread and edited exactly as the newsroom's are. A slot already here is not replaced. */
function extend(bank) { Object.keys(bank || {}).forEach(k => { if (!BANK[k]) BANK[k] = bank[k]; }); return Object.keys(BANK).length; }

/* TWO CANNED CLAUSES JOINED BY WHAT LINKS THEM, without jsRealB (a page in the browser): the same relations and the same
   rule as the planner's - not the form, the conjunction or the sentence type said last. Each clause is a whole sentence as
   written ("{W} made six of 30 threes."), its slots filled first. */
const TEXT_FORMS = {
  contrast:   [['compound', 'co', 'but'], ['complex', 'front', 'while'], ['two', 'two', 'But']],
  concession: [['complex', 'front', 'although'], ['complex', 'front', 'even though'], ['two', 'two', 'Even so,'], ['two', 'two', 'Still,']],
  addition:   [['compound', 'co', 'and'], ['compound', 'semi', ''], ['two', 'two', 'What is more,']],
  cause:      [['complex', 'trail-rev', 'because'], ['complex', 'front', 'because'], ['complex', 'front', 'as']],
  result:     [['compound', 'co', 'so'], ['two', 'two', 'That meant']],
  time:       [['complex', 'front', 'when'], ['complex', 'trail-rev', 'when']],
  clash:      [['compound', 'co', 'and'], ['compound', 'co', 'but'], ['compound', 'semi', '']]
};
/* THE CLAIMS a sentence's context makes, for the editor: whose record or run it rests on (a later game in the same piece
   can change them), and the explicit claims a format passes ({ claims: [...] }) */
function claimsOf(c) {
  if (!c) return [];
  const out = [].concat(c.claims || []);
  const id = e => (isEnt(e) ? e.id : null);
  if (c.bothUnbeaten) out.push({ k: 'record', ids: [id(c.A), id(c.B)].filter(Boolean) });
  if (c.bothHot) out.push({ k: 'run', ids: [id(c.A), id(c.B)].filter(Boolean) });
  if (c.hotCold) out.push({ k: 'run', ids: [id(c.Hot), id(c.Cold)].filter(Boolean) });
  if (c.top2 || c.top4 || c.topBottom) out.push({ k: 'table', ids: [id(c.A), id(c.B), id(c.Top), id(c.Bottom)].filter(Boolean) });
  if (c.sameRec || c.winless || c.form) out.push({ k: 'record', ids: [id(c.A), id(c.B)].filter(Boolean) });
  return out;
}
/* one piece's writer: the seed decides, the discourse is remembered, every sentence is proofread */
function writer(seed, o0) {
  const used = new Set(), turn = {}, LOG = [];
  const st = { seen: new Set(), lastForm: {}, prevSubj: null, prevEnts: [], open: null, types: [], words: [], grams: new Set(), clubs: new Set(), conj: [] };
  const opts0 = o0 || {};

  /* REFERRING EXPRESSIONS: the name, a role or surname, or a pronoun */
  function refText(e, pos, poss, S, cur) {
    const first = !S.seen.has(e.id);
    const sole = pos === 'subj2'
      ? !!(cur.length && cur[0].id === e.id && !cur.some(x => x.id !== e.id && x.ent === e.ent))
      : S.prevSubj === e.id && !S.prevEnts.some(x => x.id !== e.id && x.ent === e.ent) && !cur.some(x => x.id !== e.id && x.ent === e.ent);
    let out;
    /* a player whose gender the league does not give is named, never "he" (person g: null) */
    const pron = !opts0.noPronouns && (e.ent === 'club' || !!e.g);
    if (!first && (pos === 'subj' || pos === 'subj2') && sole && pron) out = e.ent === 'club' ? (poss ? 'their' : 'they') : (poss ? (e.g === 'f' ? 'her' : 'his') : (e.g === 'f' ? 'she' : 'he'));
    else if (first) out = e.name;
    else if (e.ent === 'club') out = e.short ? e.short : e.role && S.lastForm[e.id] !== 'role' ? e.role : e.name;
    else out = e.short || e.name;
    S.lastForm[e.id] = out === e.role ? 'role' : out === e.name ? 'name' : 'other';
    if (/^(they|he|she|their|his|her)$/.test(out) && !cur.length) S.subjPron = e.id;
    S.seen.add(e.id);
    cur.push(e);
    if (e.ent === 'club') S.clubs.add(e.name);
    return poss && !/^(their|his|her)$/.test(out) ? possOf(out) : out;
  }
  /* a clause as a jsRealB sentence */
  function sClause(k, S, cur, subjPos) {
    const e = k.subj;
    let np;
    if (isEnt(e)) {
      const txt = refText(e, subjPos || 'subj', false, S, cur);
      np = /^(they|he|she)$/.test(txt) ? J.Pro('I').pe(3).n(e.plural ? 'p' : 's').g(e.g || 'n') : J.NP(J.Q(txt)).n(e.plural ? 'p' : 's');
      if (!e.plural && np.g) np = np.g(e.g || 'm');
    } else np = J.NP(J.Q(String(e && e.text || e))).n(e && e.plural ? 'p' : 's');
    const rest = fillCanned(k.c || '', Object.assign({ their: isEnt(e) ? (e.ent === 'club' ? 'their' : e.g === 'f' ? 'her' : 'his') : 'their' }, k.ctx || {}), (x, pos, poss) => refText(x, 'obj', poss, S, cur));
    if (rest == null) return null;
    let s = J.S(np, rest ? J.VP(J.V(k.v), J.Q(rest)) : J.VP(J.V(k.v)));
    const o = k.o || {};
    if (o.t) s = s.t(o.t);
    const typ = {};
    ['perf', 'prog', 'neg'].forEach(x => { if (o[x]) typ[x] = true; });
    if (o.mod) typ.mod = o.mod;
    if (Object.keys(typ).length) s = s.typ(typ);
    return s;
  }
  const str = x => String(x).replace(/\s+$/, '');
  const LOWER = /^(The|They|He|She|It|Its|This|That|These|Those|There|A|An|Their|His|Her|One|Both|Neither|Nobody|Few|Every|Each|Some|Most|If|When|While|Although|Because|Whoever|What|Opponents|Teams)\b/;
  const lcFirst = s => (LOWER.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  /* a plan to text, the form chosen by the history; returns { text, type, word } */
  function realise(p, S, salt) {
    const cur = [];
    if (typeof p === 'string') { const t = fillCanned(p, S.ctx || {}, (x, pos, poss) => refText(x, pos, poss, S, cur)); return t == null ? null : { text: t, type: /,| and | but |;| because | although | while | which | who /.test(t) ? 'complex' : 'simple', cur }; }
    /* two canned clauses (TEXT_FORMS): filled in the order they are read, the second clause's subject a pronoun only when
       it is the first clause's and nobody else's of the kind */
    if (p && p.k === 'join' && typeof p.a === 'string' && typeof p.b === 'string') {
      const forms = TEXT_FORMS[p.rel] || TEXT_FORMS.addition;
      const lastType = S.types[S.types.length - 1], lastWord = S.conj.slice(-3);
      let pool = forms.filter(f => f[0] !== lastType && lastWord.indexOf(f[2]) < 0);
      if (!pool.length) pool = forms;
      const [type, how, word] = pool[seedOf(salt + '|' + p.rel) % pool.length];
      const [a, b] = how === 'trail-rev' ? [p.b, p.a] : [p.a, p.b];
      const x = fillCanned(a, S.ctx || {}, (e, pos, poss) => refText(e, pos, poss, S, cur));
      if (x == null) return null;
      const y = fillCanned(b, S.ctx || {}, (e, pos, poss) => refText(e, pos === 'subj' ? 'subj2' : pos, poss, S, cur));
      if (y == null) return null;
      const bare = t => String(t).trim().replace(/[.!?]+$/, '');
      const text = how === 'co' ? bare(x) + ', ' + word + ' ' + lcFirst(y)
        : how === 'semi' ? bare(x) + '; ' + lcFirst(y)
        : how === 'front' ? cap(word) + ' ' + lcFirst(bare(x)) + ', ' + lcFirst(y)
        : how === 'two' ? bare(x) + '. ' + word + ' ' + lcFirst(y)
        : bare(x) + ' ' + word + ' ' + lcFirst(y);
      return { text, type, word, cur };
    }
    if (!J) return null;
    if (p.k === 'cl') { const s = sClause(p, S, cur); return s ? { text: str(s.toString()), type: 'simple', cur } : null; }
    if (p.k === 'rel') {
      if (!isEnt(p.a.subj) || p.a.subj !== p.b.subj) return null;
      const e = p.a.subj, txt = refText(e, 'subj', false, S, cur);
      const rest1 = fillCanned(p.a.c, { their: e.ent === 'club' ? 'their' : e.g === 'f' ? 'her' : 'his' }, (x, pos, poss) => refText(x, 'obj', poss, S, cur));
      const rest2 = fillCanned(p.b.c, { their: e.ent === 'club' ? 'their' : e.g === 'f' ? 'her' : 'his' }, (x, pos, poss) => refText(x, 'obj', poss, S, cur));
      if (rest1 == null || rest2 == null) return null;
      let vp1 = J.VP(J.V(p.a.v), J.Q(rest1)); const t1 = {}; if (p.a.o.perf) t1.perf = true; if (p.a.o.prog) t1.prog = true; if (p.a.o.neg) t1.neg = true;
      let sp = J.SP(J.Pro(e.ent === 'club' || e.ent === 'person' ? 'who' : 'which'), vp1).a(',');
      if (Object.keys(t1).length) sp = sp.typ(t1);
      if (p.a.o.t) sp = sp.t(p.a.o.t);
      let s = J.S(J.NP(J.NP(J.Q(txt)).n(e.plural ? 'p' : 's').a(','), sp).n(e.plural ? 'p' : 's'), J.VP(J.V(p.b.v), J.Q(rest2)));
      if (p.b.o.t) s = s.t(p.b.o.t);
      const t2 = {}; ['perf', 'prog', 'neg'].forEach(x => { if (p.b.o[x]) t2[x] = true; }); if (p.b.o.mod) t2.mod = p.b.o.mod; if (Object.keys(t2).length) s = s.typ(t2);
      return { text: str(s.toString()), type: 'complex', cur };
    }
    if (p.k === 'part') {
      if (!isEnt(p.a.subj) || p.a.subj !== p.b.subj) return null;          // the same subject, or a dangling modifier
      const rest1 = fillCanned(p.a.c, { their: p.a.subj.ent === 'club' ? 'their' : p.a.subj.g === 'f' ? 'her' : 'his' }, (x, pos, poss) => refText(x, 'obj', poss, S, cur));
      if (rest1 == null) return null;
      const vp = p.a.o.perf ? J.VP(J.V('have').t('pr'), J.V(p.a.v).t('pp'), J.Q(rest1)) : J.VP(J.V(p.a.v).t('pr'), J.Q(rest1));
      const main = sClause(p.b, S, cur, 'obj');                              // the participle names it: the main clause says it in full
      if (!main) return null;
      return { text: str(J.S(vp.a(','), main).toString()), type: 'complex', cur };
    }
    if (p.k === 'join') {
      const forms = FORMS[p.rel] || FORMS.addition;
      const lastType = S.types[S.types.length - 1], lastWord = S.conj.slice(-3);
      let pool = forms.filter(f => f[0] !== lastType && lastWord.indexOf(f[2]) < 0);
      if (!pool.length) pool = forms;
      const f = pool[seedOf(salt + '|' + p.rel) % pool.length], [type, how, word] = f;
      if (how === 'two' || how === 'semi') {
        const s1 = sClause(p.a, S, cur), s2 = s1 && sClause(p.b, S, cur, 'subj2');
        if (!s1 || !s2) return null;
        const a = str(s1.toString()).replace(/[.!?]$/, ''), b = str(s2.toString());
        return { text: how === 'semi' ? a + '; ' + lcFirst(b) : a + '. ' + word + ' ' + lcFirst(b), type, word, cur };
      }
      const [x, y] = how === 'trail-rev' ? [p.b, p.a] : [p.a, p.b];
      const s1 = sClause(x, S, cur), s2 = s1 && sClause(y, S, cur, 'subj2');
      if (!s1 || !s2) return null;
      const s = how === 'co' ? J.S(J.CP(J.C(word), s1.a(','), s2))
        : how === 'front' ? J.S(J.SP(J.C(word), s1).a(','), s2)
        : how === 'trail' ? J.S(s1.a(','), J.SP(J.C(word), s2))
        : J.S(s1, J.SP(J.C(word), s2));
      return { text: str(s.toString()), type, word, cur };
    }
    return null;
  }
  function attempt(o, c, salt, how) {
    const S = { seen: new Set(st.seen), lastForm: Object.assign({}, st.lastForm), prevSubj: st.prevSubj, prevEnts: st.prevEnts.slice(), clubs: new Set(st.clubs), types: st.types, conj: st.conj, ctx: c, subjPron: null };
    let p = o;
    if (typeof o === 'function') { try { p = o(c, B); } catch (_) { p = null; } }
    if (!p) return null;
    const r = realise(p, S, salt);
    if (!r || !r.text) return null;
    const pr = proof(r.text, { open: st.open, grams: st.grams, clubs: [...S.clubs], bare: !!(how && how.bare) });
    return Object.assign(r, { text: pr.text, flags: pr.flags, S });
  }
  function commit(r, slot, c) {
    const ents0 = (r.cur || []).filter((e, i, a) => a.findIndex(x => x.id === e.id) === i);
    if (slot === 'head' || /\.(head|dek)$/.test(slot || '')) {
      LOG.push({ slot, text: r.text, type: r.type || 'simple', word: null, section: -1, ents: ents0.map(e => ({ id: e.id, ent: e.ent, name: e.name, role: e.role || null })), subj: null, claims: claimsOf(c), pron: null });
      return;
    }
    LOG.push({ slot: slot || null, text: r.text, type: r.type || 'simple', word: r.word || null, section: st.section || 0,
      ents: ents0.map(e => ({ id: e.id, ent: e.ent, name: e.name, role: e.role || null })), subj: ents0.length ? ents0[0].id : null,
      claims: claimsOf(c), pron: r.S.subjPron || null });
    st.seen = r.S.seen; st.lastForm = r.S.lastForm; st.clubs = r.S.clubs;
    const ents = r.cur || [];
    st.prevSubj = ents.length ? ents[0].id : null;
    st.prevEnts = ents.map(e => e.id).filter((x, i, a) => a.indexOf(x) === i).map(id => ents.find(e => e.id === id));
    st.open = (r.text.match(/^[“‘"(]?([A-Za-z’']+)/) || [])[1] || null;
    st.types.push(r.type || 'simple');
    if (r.word) st.conj.push(r.word);
    const words = r.text.toLowerCase().replace(/[^a-z’' ]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 4 <= words.length; i++) st.grams.add(words.slice(i, i + 4).join(' '));
  }
  return {
    say(slot, c, how) {
      const all = options(slot, c);
      const h = how || (/\.(title|head)$/.test(slot) ? { bare: true } : null);
      if (!all.length) return null;
      turn[slot] = (turn[slot] || 0) + 1;
      const fresh = all.filter(o => !used.has(o)), pool = fresh.length ? fresh : all;
      const k0 = seedOf(seed + '|' + slot + '|' + turn[slot]);
      let fallback = null;
      for (let i = 0; i < pool.length; i++) {
        const o = pool[(k0 + i) % pool.length];
        const r = attempt(o, c || {}, seed + slot + turn[slot] + i, h);
        if (!r) continue;
        if (r.flags.length && !fallback) fallback = { o, r };
        if (r.flags.length) continue;
        used.add(o); commit(r, slot, c);
        return r.text;
      }
      if (!fallback) return null;
      used.add(fallback.o); commit(fallback.r, slot, c);
      return fallback.r.text;
    },
    /* every option that fits, each said alone (headlines) */
    all(slot, c) {
      return options(slot, c).map((o, i) => writer(seed + '|all|' + i, o0).sayOne(o, c, { bare: true })).filter(Boolean);
    },
    sayOne(o, c, how) { const r = attempt(o, c || {}, seed + '|one', how); if (!r) return null; commit(r, 'head', c); return r.text; },
    /* a new section: names said again in full, nobody "they" from the section before */
    section(label) { st.seen = new Set(); st.lastForm = {}; st.prevSubj = null; st.prevEnts = []; st.open = null; st.section = (st.section || 0) + 1; st.label = label || null; },
    /* a new paragraph of the same piece (the match report: no headings): names stay as they are, short after the first
       time, but no paragraph opens on "they" from the one before */
    paragraph() { st.prevSubj = null; st.prevEnts = []; st.open = null; },
    /* what each sentence said, for the editor (scrutiny.js): its slot, text, entities, the subject, type, connective,
       section and the claims its context made */
    log: () => LOG.slice(),
    /* a sentence composed in code: proofread and remembered like the rest */
    line(text, claims) { if (!text) return null; const r = attempt(String(text), {}, seed + '|line'); if (!r) return null; commit(r, 'line', claims ? { claims } : null); return r.text; },
    /* what the piece has said, for a test or a note */
    state: () => ({ types: st.types.slice(), conj: st.conj.slice() })
  };
}

/* ================================================================= the phrasebook ===
   Context: clubs and players are ENTITIES (club / person); everything else is a word or a number already said.
     A, B     the two clubs of a game (A at home; their roles "the hosts" / "the visitors")
     O, D     the attacking and the defending club            P, P2, Q   players            T, T2  a club
     he his him   the player's pronouns, He His at a start      day where  "Saturday 10 October", "at home to X"
     league   the league's name (said after "the")
   An option is a canned sentence or a plan: (c, b) => b.join('contrast', b.cl(c.O, 'attack', 'the rim'), ...) */
const BANK = {

  /* ===================================== A GAME: the card, the week's piece, the briefing and previews === */
  'game.stakes': [
    { level: 3, when: c => c.bothUnbeaten, say: [
      'Both still unbeaten. Only one of them will be by the final buzzer.',
      'Two perfect records walk in; only one walks out.',
      (c, b) => b.join('contrast', b.cl({ text: 'neither side', plural: false }, 'lose', 'yet', { perf: true }), b.cl({ text: 'one of them', plural: false }, 'have', 'to by the end of the night', { t: 'f' }))] },
    { level: 2, when: c => c.top2, say: [
      'First against second, with top spot on the line.',
      'The top two in the league, head to head.',
      'Top of the table is up for grabs.'] },
    { level: 2, when: c => c.hotCold, say: [
      (c, b) => b.join('contrast', b.cl(c.Hot, 'arrive', 'on a {nHot}-game winning streak'.replace('{nHot}', c.nHot)), b.cl(c.Cold, 'lose', c.nCold + ' in a row', { perf: true })),
      'Momentum against desperation: {Hot} have won {nHot} straight, {Cold} have dropped {nCold} in a row.'] },
    { level: 2, when: c => c.bothHot, say: [
      '{A} have won {nA} straight, {B} {nB}. One of those streaks ends here.',
      (c, b) => b.join('clash', b.cl(c.A, 'win', c.nA + ' straight', { perf: true }), b.cl(c.B, 'win', c.nB, { perf: true }))] },
    { level: 1, when: c => c.top4, say: [
      'Two of the top four meet, and the table could look different by the end of the night.',
      'A meeting of contenders.',
      'Both sides are in the top four, and both want to stay there.'] },
    { level: 1, when: c => c.topBottom, say: [
      (c, b) => b.join('contrast', b.cl(c.Top, 'sit', c.posTop), b.cl(c.Bottom, 'sit', c.posBottom)),
      '{Top} are expected to win this one. {Bottom} have nothing to lose.'] },
    /* EARLY IN A SEASON, OR A GAME WITH NOTHING BIGGER ON IT (level 0: said only when nothing above fits, Louie 2026-10-08
       "loosen the bar for weekly previews"): matching records, a side still without a win, how each came out of its last
       game. Records only for a club whose next game this is (newsroom.js stakesOf), so nothing can change them first. */
    { level: 0, when: c => c.sameRec, say: [
      'Both come in at {rec}.',
      'Level at {rec} so far, and one of them leaves with a defeat.'] },
    { level: 0, when: c => c.winless, say: [
      '{Winless} are still looking for a first win.',
      'Still no win for {Winless}, and {Other} will not want to be the first side they beat.'] },
    { level: 0, when: c => c.form === 'won', say: ['Both won last time out.', 'Both come in off a win.'] },
    { level: 0, when: c => c.form === 'lost', say: ['Both lost last time out, so one of them gets back on track here.', 'Both are coming off a defeat.'] },
    { level: 0, when: c => c.form === 'split', say: [
      '{FW} come in off a win over {oppW}; {FL} lost to {oppL} last time out.',
      '{FW} won last time out, against {oppW}. {FL} lost to {oppL}.'] },
    /* one side's last result, when the other's has been told already in the piece */
    { level: 0, when: c => c.form === 'one' && c.oneWon, say: ['{One} come in off a win over {oneOpp}.', '{One} beat {oneOpp} last time out.'] },
    { level: 0, when: c => c.form === 'one' && !c.oneWon, say: ['{One} lost to {oneOpp} last time out, and will want a response.', '{One} come in off a defeat by {oneOpp}.'] }
  ],
  'game.meetings': [
    { level: 2, when: c => c.met === 1 && c.margin >= 15, say: [
      '{L} will want this one: {W} beat them by {margin} last time.',
      'Revenge is on the table. {W} won the first meeting {score}, and it was not close.'] },
    { level: 1, when: c => c.met === 1, say: [
      'A rematch: {W} won the first meeting, {score}.',
      'Round two. {W} took the first one, {score}.',
      '{L} have not forgotten the first meeting: {W} won it {score}.'] },
    { level: 1, when: c => c.met >= 2, say: [
      'Meeting number {nthMeet} this season, and {series}.',
      'They know each other well by now: this is meeting number {nthMeet}, and {series}.'] }
  ],

  /* WHERE IT WILL BE DECIDED: a title, then the reason - the card's meters carry the figures, the words say what they
     mean. O attacks, D defends. */
  'reason.tempo.title': [{ say: ['Fast against slow', 'Who sets the pace?', 'A battle of speeds'] }],
  'reason.tempo': [{ say: [
    (c, b) => b.join('contrast', b.cl(c.F, 'want', 'a track meet'), b.cl(c.Sl, 'grind', 'it out', { mod: 'poss' })),
    (c, b) => b.join('contrast', b.cl(c.F, 'play', (c.fastBest ? 'faster than anybody in the league' : 'faster than almost anyone in the league')), b.cl(c.Sl, 'play', 'slower than almost anyone')),
    'Watch the first five minutes. If it is end to end, that is {F}’s game; if every possession is a grind, {Sl} are in charge.'] }],
  'reason.tempo.coda': [{ say: ['Whoever sets the pace has won half the battle.', 'The tempo will tell you who is winning.'] }],

  'reason.rim.title': [{ say: ['The paint', 'Trouble inside', 'Inside the paint'] }],
  'reason.rim': [
    { level: 1, when: c => c.dWorst, say: [
      (c, b) => b.join('cause', b.cl(c.D, 'be', 'the easiest team in the league to score on at the rim', { perf: true }), b.cl(c.O, 'hunt', 'that matchup all night', { t: 'f' })),
      'Nobody in the league has been easier to score on at the rim than {D}, and few teams go there as often as {O}.'] },
    { say: [
      (c, b) => b.join('addition', b.cl(c.O, 'live', 'at the rim, with ' + c.rimFrac + ' of {their} shots right at the basket'), b.cl(c.D, 'be', 'one of the softest touches in the league in there', { perf: true })),
      (c, b) => b.join('cause', b.cl(c.D, 'struggle', 'to keep anybody out of the paint all season', { perf: true }), b.cl(c.O, 'go', 'straight at them', { t: 'f' })),
      'Get to the basket, win the game: that has been {O}’s plan all season, and {D} have struggled to keep anybody out of the paint.'] }
  ],
  'reason.rim.coda': [{ say: ['If {O} get downhill, this could get away from {D} in a hurry.', 'That is the matchup to watch.', 'Expect {O} to go there early and often.'] }],
  'reason.rimWall.title': [{ say: ['Strength against strength', 'The paint', 'The heavyweight bout'] }],
  'reason.rimWall': [
    { level: 1, when: c => c.dBest, say: [
      (c, b) => b.join('contrast', b.cl(c.O, 'attack', 'the rim as much as anyone'), b.cl(c.D, 'protect', 'it better than anybody in the league')),
      (c, b) => b.join('clash', b.cl(c.O, 'take', c.rimFrac + ' of {their} shots at the rim'), b.cl(c.D, 'be', 'the hardest team in the league to score on in there', { perf: true }))] },
    { say: [
      (c, b) => b.join('clash', b.cl(c.O, 'go', 'to the rim as much as almost anyone'), b.cl(c.D, 'protect', 'it as well as almost anyone')),
      'Something has to give inside: {O} live at the basket, and {D} have made the paint a hard place to be all season.'] }
  ],
  'reason.rimWall.coda': [{ say: ['Whoever wins the paint probably wins the game.', 'Something has to give.', 'It is the fight inside the fight.'] }],
  'reason.three.title': [{ say: ['Open season from deep', 'The three-point line', 'Let it fly'] }],
  'reason.three': [{ say: [
    (c, b) => b.join('addition', b.cl(c.O, 'shoot', 'it from everywhere, with ' + c.p3Frac + ' of {their} shots from three'), b.cl(c.D, 'give', 'up open looks all season', { perf: true })),
    (c, b) => b.join('cause', b.cl(c.D, 'struggle', 'to guard the three-point line', { perf: true }), b.cl(c.O, 'fancy', 'their chances from deep', { mod: 'poss' })),
    'If {O} get going from three, {D} are in trouble. Few teams shoot more threes, and few defend them worse.'] }],
  'reason.three.coda': [{ say: ['A hot night from deep and this could be over early.', 'Watch the first few threes: they could set the tone.'] }],
  'reason.threeWall.title': [{ say: ['Shooters against stoppers', 'The three-point line'] }],
  'reason.threeWall': [
    { level: 1, when: c => c.dBest, say: [
      (c, b) => b.join('contrast', b.cl(c.O, 'live', 'and die by the three, with ' + c.p3Frac + ' of {their} shots from deep'), b.cl(c.D, 'have', 'the best perimeter defence in the league'))] },
    { say: [
      (c, b) => b.join('clash', b.cl(c.O, 'let', 'it fly as often as anyone'), b.cl(c.D, 'make', 'life miserable for shooters all season', { perf: true })),
      '{O} want to win this from three. {D} have spent the season running shooters off the line.'] }
  ],
  'reason.threeWall.coda': [{ say: ['If the threes do not fall, {O} will need a plan B.', 'Something has to give from deep.'] }],
  'reason.run.title': [{ say: ['The fast break', 'Open court', 'Run, run, run'] }],
  'reason.run': [{ say: [
    (c, b) => b.join('addition', b.cl(c.O, 'want', 'to run'), b.cl(c.D, 'be', 'one of the easiest teams in the league to run against', { perf: true })),
    (c, b) => b.join('cause', b.cl(c.D, 'struggle', 'to get back all season', { perf: true }), b.cl(c.O, 'look', 'to push at every chance', { t: 'f' }))] }],
  'reason.run.coda': [{ say: ['Every missed shot is a chance to sprint the other way.', 'Turn it over against {O} and you pay for it.'] }],
  'reason.runWall.title': [{ say: ['Slow them down', 'The fast break'] }],
  'reason.runWall': [{ say: [
    (c, b) => b.join('contrast', b.cl(c.O, 'be', 'at their best in the open floor'), b.cl(c.D, 'get', 'back as well as anyone')),
    '{D} will want to drag this into the half court. Let {O} run and the game can get away from you.'] }],
  'reason.runWall.coda': [{ say: ['Make {O} play in the half court and this is a very different game.'] }],
  'reason.glass.title': [{ say: ['The glass', 'Second chances', 'Crash the boards'] }],
  'reason.glass': [{ say: [
    (c, b) => b.join('addition', b.cl(c.O, 'treat', 'every miss as a second chance'), b.cl(c.D, 'struggle', 'to finish possessions with a rebound', { perf: true })),
    'Box out or pay for it: {O} are one of the best offensive rebounding teams around, and {D} give up second chances as easily as anybody.'] }],
  'reason.glass.coda': [{ say: ['Extra shots add up fast.', 'Every second chance is a small win.'] }],
  'reason.ball.title': [{ say: ['Every possession counts', 'Pressure', 'Ball security'] }],
  'reason.ball': [{ say: [
    (c, b) => b.join('addition', b.cl(c.O, 'be', 'careless with the ball', { perf: true }), b.cl(c.D, 'feed', 'on mistakes')),
    '{D} make teams uncomfortable, and {O} have given the ball away more than most.'] }],
  'reason.ball.coda': [{ say: ['Every loose pass could be two points the other way.', 'Whoever wins the turnover battle has a big head start.'] }],
  'reason.duel.title': [{ say: ['Star against star', 'The duel {atSpot}'] }],
  'reason.duel': [{ say: [
    'The best individual matchup on the floor: {P1} against {P2}, two of the best {group} in the league.',
    (c, b) => b.join('clash', b.cl(c.P1, 'be', 'one of the league’s best ' + c.group + ' this season', { perf: true }), b.cl(c.P2, 'be', 'right there with ' + (c.P1.g === 'f' ? 'her' : 'him'), { perf: true }))] }],
  'reason.duel.coda': [{ say: ['Whoever wins that duel probably wins the night.', 'They will spend the night going at each other.'] }],
  'reason.spot.title': [{ say: ['An edge {atSpot}', 'The matchup to watch'] }],
  'reason.spot': [{ say: [
    (c, b) => b.join('cause', b.cl(c.P1, 'be', 'one of the most valuable ' + c.group + ' in the league', { perf: true }), b.cl(c.T1, 'want', 'the ball in {P1}’s hands', { t: 'f' })),
    'If you are watching one player, watch {P1}: one of the league’s best {group}, and {T1}’s biggest edge.'] }],
  'reason.spot.coda': [{ say: ['{P2} has the toughest job on the floor.', 'It is the matchup {T1} will want.'] }],
  'reason.rivalry': [{ say: [
    '{A} and {B} are rivals, and nobody needs the table to tell them what this one means.',
    'Throw the form book out: this is a rivalry game.'] }],

  'game.lean': [
    { when: c => c.band === 'tossup', say: ['Too close to call.', 'A coin flip on paper.', 'Nothing between them on this season’s evidence.'] },
    { when: c => c.band === 'slight', say: ['{Fav} shade it on paper, but only just.', 'A slight edge to {Fav}, and not much more.'] },
    { when: c => c.band === 'clear', say: ['{Fav} go in as favourites.', 'On form, {Fav} should win this.'] },
    { when: c => c.band === 'heavy', say: ['{Fav} are big favourites; {Dog} need something special.', 'Anything other than a {Fav} win would be a shock.'] }
  ],
  'game.player': [{ say: ['Keep an eye on {P}, {line}.', '{P} is the one to watch, {line}.', 'Watch {P}, {line}.'] }],
  'game.onoff': [
    { level: 1, when: c => c.flip, say: [
      (c, b) => b.join('contrast', b.cl(c.T, 'win', 'the minutes ' + (c.P.g === 'f' ? 'she' : 'he') + ' plays'), b.cl(c.T, 'lose', 'the ones ' + (c.P.g === 'f' ? 'she' : 'he') + ' sits')),
      'Watch what happens when {P} sits: with {P} on the floor {T} outscore teams, and without, they get outscored.'] },
    { say: ['{T} are much better with {P} on the floor than off it.', '{P} makes {T} better: the minutes on the floor are their best of the night.'] }
  ],

  /* =============================================================== THE WEEK'S GAMES TO WATCH (watch) === */
  'watch.head': [{ say: ['{A} v {B} leads a big week in the {league}', 'The games to watch this week, starting with {A} v {B}', '{A} v {B}: the week’s must-see game'] }],
  'watch.dek': [{ say: [
    'The {count} games worth your time this week, and what will decide each one.',
    'Where this week’s biggest games will be won and lost.',
    'Clear your diary: the {count} games that matter this week.'] }],
  'watch.lede': [{ say: [
    '{Day} is the one to circle: {A} host {B}.',
    'Start with {day}: {A} against {B}.',
    'If you only watch one game this week, make it {A} against {B}, {day}.'] }],

  /* ========================================================================= A SCORER GONE COLD (slump) === */
  'slump.head': [{ say: ['What has happened to {P}?', 'Inside {P}’s slump', '{P} {cold}, and {T} have noticed'] }],
  'slump.dek': [{ say: [
    '{rp} points a game over {his} last four, down from {bp}. What has gone wrong?',
    'Four quiet games from one of the league’s best scorers. What is going on with {P}?'] }],
  'slump.lede': [
    { when: c => c.fg, say: [
      'It was another quiet night for {P}: {pts} on {fg} shooting in {T}’s {result} on {day}.',
      '{P} had {pts} on {fg} shooting in {T}’s {result} on {day}. It is becoming a pattern.'] },
    { say: ['It was another quiet night for {P}: {pts} in {T}’s {result} on {day}.', '{P} had {pts} in {T}’s {result} on {day}. It is becoming a pattern.'] }
  ],
  'slump.context': [{ say: [
    (c, b) => b.join('contrast', b.cl(c.P, 'average', c.bp + ' points a night before this run' + c.best, { t: 'ps' }), b.cl(c.P, 'manage', 'just ' + c.rp + ' over the last four', { perf: true })),
    'That is four straight games well below {his} usual level. Before this run {he} was scoring {bp} a night{best}; over the last four, {rp}.'] }],
  'slump.shots': [{ say: [
    (c, b) => b.join('contrast', b.cl(c.P, 'make', c.before + ' of {their} shots earlier in the season', { t: 'ps' }), b.cl(c.P, 'make', c.fgm + ' of ' + c.fga + ' over the four games', { perf: true })),
    'The shots just are not going in: {fgm} of {fga} over the four games, after {he} made {before} of them earlier in the season.'] }],
  'slump.role': [
    { when: c => c.steady, say: [
      (c, b) => b.join('cause', b.cl(c.T, 'change', '{their} role for ' + (c.P.g === 'f' ? 'her' : 'him'), { perf: true, neg: true }), b.cl({ text: 'this', plural: false }, 'look', 'like a shooter in a slump rather than a player being phased out')),
      'It is not about minutes: {he} is still playing {rm} a night and still getting {his} shots.'] },
    { when: c => !c.steady, say: ['{His} minutes have moved too, from {bm} a night to {rm}. Is it form, or has {his} role changed?'] }
  ],
  'slump.onoff': [
    { when: c => c.better, say: ['Even now, {T} are a better team with {P} on the floor than off it.', 'The good news for {T}: slump and all, they are still better with {P} out there.'] },
    { when: c => !c.better, say: ['There is a harder question for {T}: they had been better without {P} on the floor before the slump began.'] }
  ],
  'slump.team': [
    { when: c => c.l > c.w, say: ['And {T} have felt it: {w}–{l} over the same stretch.', '{T} have gone {w}–{l} in those four games, and it is not a coincidence.'] },
    { say: ['{T} have held up, at {w}–{l} in those four games, but they need their scorer back.'] }
  ],
  'slump.verdict': [
    { when: c => c.efficient, say: [
      (c, b) => b.join('concession', b.cl({ text: 'the last four games', plural: true }, 'be', 'a worry'), b.cl(c.P, 'be', 'one of the league’s most efficient scorers this season, and players like that tend to find it again', { perf: true })),
      'Four games are four games, though. Over the season {he} has been one of the league’s most efficient scorers, and players like that tend to find it again.'] },
    { say: ['Four games are four games. The next few will tell us whether this is a blip or something more.'] }
  ],
  'slump.next': [{ say: ['The next chance to snap out of it: {day}, {where}.', 'Next up for {T}: {day}, {where}.'] }],

  /* ============================================================================== THE MVP CASE (mvp) === */
  'mvp.head': [{ say: ['Is {P} the best player in the {league}?', 'The case for {P}', '{P} and the MVP question', 'Nobody in the {league} is doing more than {P}'] }],
  'mvp.dek': [{ say: [
    '{T} are {pos} in the table, and {P} is the biggest reason why.',
    'The case for {P} as the {league}’s most valuable player.',
    '{T} sit {pos}. Here is why {P} belongs at the front of the MVP race.'] }],
  'mvp.lede': [{ say: [
    'No player in the {league} has done more to help {his} team win this season than {P}.',
    'Ask which player matters most in the {league} right now, and the answer keeps coming back to {P}.'] }],
  'mvp.lead': [
    { when: c => c.clear, say: ['By our all-in-one rating {he} leads the league comfortably, ahead of {P2}.'] },
    { say: ['By our all-in-one rating {he} leads the league, just ahead of {P2}.'] }
  ],
  'mvp.line': [{ say: [
    (c, b) => b.cl(c.P, 'put', 'up ' + c.ppg + ' points, ' + c.rpg + ' rebounds and ' + c.apg + ' assists a night' + c.style, { prog: true }),
    'The line: {ppg} points, {rpg} rebounds, {apg} assists a night{style}.'] }],
  'mvp.onoff': [
    { level: 2, when: c => c.swing >= 4, say: [
      'Watch what happens when {he} sits: {T} {onWords} with {P} on the floor and {offWords} without.',
      'The team numbers tell the same story: {T} {onWords} with {P} and {offWords} without.'] },
    { when: c => c.swing > -4, say: ['{T} are deep, too: they have been almost as good without {P} as with. That cuts both ways in an MVP argument.'] },
    { say: ['One number does not fit: {T} have been better without {P} on the floor. Voters will ask about that.'] }
  ],
  'mvp.rimD': [{ say: ['At the other end, opponents finish far worse at the rim when {P} is on the floor.', 'And {P} matters at the other end too: teams finish far worse at the rim with {him} out there.'] }],
  'mvp.rival': [{ say: [
    (c, b) => b.join('concession', b.cl(c.P, 'lead', 'the way'), b.cl(c.P2, 'have', 'a case of ' + (c.P2.g === 'f' ? 'her' : 'his') + ' own, with ' + c.T2.name + ' ' + c.pos2 + ' in the table')),
    'The race is not over: {P2} has {T2} {pos2}, and the numbers are close.'] }],
  'mvp.next': [{ say: ['Next up: {day}, {where}.', 'The case continues {day}, {where}.'] }],

  /* ============================================================================== A YOUNG TALENT (prospect) === */
  'prospect.head': [{ say: ['Is {P} the real thing?', '{age} and already among the {league}’s best: {P}', 'How good is {P}?'] }],
  'prospect.dek': [{ say: [
    'Only {better} in the {league} {have} been more productive this season, and {P} is just {age}.',
    'At {age}, {P} is already one of the best players in the {league}.'] }],
  'prospect.lede': [
    { when: c => c.r === 1, say: ['{P} is {age}, and nobody in the {league} has been more productive this season.'] },
    { when: c => c.r === 2, say: ['{P} is {age}. Only one player in the {league} has been more productive this season{older}.'] },
    { say: ['{P} is {age}. Of the {n} players who play real minutes in the {league}, only {k} have been more productive{older}.'] }
  ],
  'prospect.line': [{ say: [
    (c, b) => b.cl(c.P, 'give', 'you ' + c.p36 + ' points, ' + c.r36 + ' rebounds and ' + c.a36 + ' assists over a full game, ' + c.eff, { mod: 'poss', t: 'c' }),
    'Over a full game {he} would be giving you {p36} points, {r36} rebounds and {a36} assists, {eff}.'] }],
  'prospect.role': [
    { when: c => c.lead, say: ['{T} already run their offence through {P}: a lead role at any age.'] },
    { when: c => c.quiet, say: ['{P} does it without needing the ball, which is rarer than it sounds at {age}.'] }
  ],
  'prospect.onoff': [
    { when: c => c.better, say: ['{T} are a better team with {P} on the floor.', 'The minutes {P} plays are some of {T}’s best.'] },
    { say: ['The one thing to work on: {T} have been better with {P} on the bench.'] }
  ],
  'prospect.caveat': [{ say: [
    'It is {gp} games, so the usual warning applies: enough to notice, not yet enough to be sure.',
    'A word of caution: {gp} games is a small sample. But the signs are there.'] }],
  'prospect.next': [{ say: ['{P}’s next test: {day}, {where}.'] }],

  /* ======================================================================== WHAT A CLUB IS BUILT ON (identity) === */
  'identity.dek': [
    { when: c => c.good, say: ['{T} have a superpower: {trait}. How they do it, and who does it.', 'Inside the thing {T} do better than {anyone} in the {league}.'] },
    { say: ['{T}’s season keeps running into the same wall: {flaw}. Where it goes wrong, and what it costs.', 'The problem {T} cannot shake: {flaw}.'] }
  ],
  'identity.lede': [
    { when: c => c.good, say: [
      '{T} are {rec}, and one thing explains a lot of it.',
      'Every good side has something it can lean on. For {T} it is simple: {trait}.',
      'Look past the {wl} record and one part of {T}’s game stands out from the rest of the {league}.'] },
    { say: [
      'If {T} want to know where their season is going wrong, start here: {flaw}.',
      '{T} are {rec}, and one weakness keeps showing up.'] }
  ],
  'identity.worth': [{ say: ['That is worth about {pts} points a game {toWhom}: the difference between winning and losing a close one.', 'Over a season, that adds up to about {pts} points a game {toWhom}.'] }],
  'identity.other': [
    { when: c => c.good, say: ['{turn} there is another side to them: {flaw}.'] },
    { say: ['It is not all bad: {trait}.'] }
  ],
  'identity.test': [
    { when: c => c.good && c.strong, say: ['That will be tested: few teams are better at {mirror} than their next opponents.', 'It is a real test: their next opponents are one of the best in the league at {mirror}.'] },
    { when: c => c.good && c.weak, say: ['Expect it to show: their next opponents are among the worst in the league at {mirror}.'] },
    { when: c => !c.good && c.strong, say: ['It could be a long night: few teams are better at {mirror} than their next opponents.', 'Their next opponents are exactly the kind of team to make them pay: few are better at {mirror}.'] },
    { when: c => !c.good && c.weak, say: ['There is some relief: their next opponents are among the worst in the league at {mirror}.'] }
  ],
  'identity.next': [{ say: ['Next: {day}, {where}.', 'They are back at it {day}, {where}.'] }],

  /* =================================================================================== A RUN AND A SLIDE === */
  'run.dek': [
    { when: c => c.won, say: ['{N} straight wins, and they have not been close: {margin} points a game on average. What has changed?', '{N} in a row and counting. Inside {T}’s winning run.'] },
    { say: ['{N} straight defeats, by {margin} points a game on average. Where has it gone wrong?', '{N} defeats in a row. Inside {T}’s slide.'] }
  ],
  'run.change': [
    { when: c => c.won && c.k === 'shot', say: ['The shots are falling: they are making more of them than at any point before the run.'] },
    { when: c => c.won && c.k === 'def', say: ['It starts at the defensive end: opponents are shooting far worse against them than they were.'] },
    { when: c => c.won && c.k === 'ball', say: ['They have stopped giving the ball away, and it shows.'] },
    { when: c => c.won && c.k === 'glass', say: ['They are winning the fight on the glass, and every second chance counts.'] },
    { when: c => !c.won && c.k === 'shot', say: ['The shots have stopped falling: they are making far fewer than they were.'] },
    { when: c => !c.won && c.k === 'def', say: ['The defence has gone missing: opponents are shooting far better against them than they were.'] },
    { when: c => !c.won && c.k === 'ball', say: ['They keep giving the ball away, and opponents are making them pay.'] },
    { when: c => !c.won && c.k === 'glass', say: ['They are losing the fight on the glass, and second chances are hurting them.'] }
  ],
  'run.star': [
    { when: c => c.up, say: [
      (c, b) => b.join('time', b.cl(c.T, 'need', 'a lift', { t: 'ps' }), b.cl(c.P, 'provide', 'it: ' + c.r + ' points a night in the run, up from ' + c.b, { t: 'ps' })),
      '{P} has been at the heart of it: {r} points a night in the run, up from {b}.'] },
    { say: ['{P} has struggled with them: {r} a night, down from {b}.'] }
  ],
  'run.five': [
    { when: c => c.up, say: ['The lineup doing the most damage, {names}, has outscored opponents by {pm} in {mins} minutes together.'] },
    { say: ['Even the lineup they trust most, {names}, has been outscored by {pm} in {mins} minutes together.'] }
  ],
  'run.close': [
    { when: c => c.won, say: ['It has not all been easy: {close} of the {N2} were decided by five points or fewer.'] },
    { say: ['The frustrating part: {close} of the {N2} defeats came by five points or fewer.'] }
  ],
  'run.next': [
    { when: c => c.won, say: ['The run is on the line {day}, {where}.', 'Next up, with the streak at {n}: {day}, {where}.'] },
    { say: ['The next chance to stop the slide: {day}, {where}.'] }
  ],

  /* ======================================================================================== THE BEST FIVE === */
  'five.lede': [{ say: [
    'When {T} send out {names}, opponents have been in trouble: {pm} points better in {mins} minutes together over the last fortnight.',
    'Over the last fortnight, {names} have shared the floor for {mins} minutes for {T} and outscored opponents by {pm}.'] }],
  'five.per40': [{ say: ['Stretch that over a full game and it is a {per40}-point beating.', 'At that rate, over a full game, they would win by {per40}.'] }],
  'five.rest': [
    { when: c => c.restLost, say: ['Every other combination they have tried has been outscored.', 'The rest of the time, they have been outscored.'] },
    { say: ['The rest of the roster has held its own, but nothing like this.', 'Every other combination put together has been fine; this one has been something else.'] }
  ],
  'five.share': [
    { when: c => c.rare, say: ['Yet the five have only been on the floor together for about {shareFrac} of the minutes. Expect that to change.'] },
    { say: ['The five are already {T}’s go-to group, together for about {shareFrac} of the minutes.'] }
  ],
  'five.caveat': [{ say: ['{mins} minutes is a small sample, and lineups come and go. But this one is worth watching.'] }],

  /* ======================================================================================= THE SHOT CLOCK === */
  'clock.dek': [{ say: ['Most teams panic when the shot clock runs down. {T} get better.', 'With the shot clock running out, nobody in the {league} has been more dangerous than {T}.'] }],
  'clock.lede': [{ say: [
    'When the shot clock runs down, most teams settle for something ugly. {T} have been the exception: nobody in the {league} has done more with the last seconds of a possession over the last fortnight.'] }],
  'clock.detail': [
    { when: c => c.noCost, say: ['Remarkably, their late-clock possessions have been as good as their early ones: a long possession costs them nothing.'] },
    { say: ['A long possession still costs them a little, as it does everyone, but far less than it costs the rest of the league.'] }
  ],
  'clock.pace': [
    { when: c => c.long, say: ['They are patient, too: their possessions last longer than almost anyone’s.'] },
    { when: c => c.short, say: ['And they do not hang about: their possessions are among the shortest in the league.'] }
  ],
  'clock.caveat': [{ say: ['It is {n} possessions, not a season: a few late threes either way would move it.'] }],

  /* ===================================================================================== A STAR MISSING (absence) === */
  'absence.head': [{ say: ['What {T} are missing without {P}', 'How much is {P} worth to {T}?', 'The {S}-shaped hole in {T}’s side', '{T} are learning to live without {P}'] }],
  'absence.dek': [
    { when: c => c.top, say: ['{P} has missed {T}’s last {nMiss} games{ban}. Nobody on the roster matters more to them.'] },
    { say: ['{P} has missed {T}’s last {nMiss} games{ban}, and they are feeling it.'] }
  ],
  'absence.lede': [{ say: ['{T} have played {nMiss} games without {P}{banTail}, and gone {w}–{l}.'] }],
  'absence.value': [
    { when: c => c.top, say: [
      (c, b) => b.join('cause', b.cl(c.P, 'be', 'so good, for so many minutes', { perf: true }), b.cl(c.P, 'account', 'for ' + c.shareFrac + ' of {T}’s value this season, more than anyone else on the roster')),
      'Combine how good {he} has been with how much {he} plays, and {P} accounts for {shareFrac} of {T}’s value this season, more than anyone else on the roster.'] },
    { say: ['{P} has been one of {T}’s most important players: {shareFrac} of their value this season, by our numbers.'] }
  ],
  'absence.onoff': [
    { when: c => c.big, say: ['The team numbers say the same: {T} have been far better with {P} on the floor.'] },
    { say: ['The team numbers soften it a little: {T} have coped without {P} before.'] }
  ],
  'absence.games': [
    { when: c => c.offence, say: ['The offence has stalled without {him}: {pf} points a game, down from {pf0}.'] },
    { when: c => c.defence, say: ['The defence has suffered most: they are giving up {pa} a game without {him}, up from {pa0}.'] },
    { say: ['Without {him} they have scored {pf} and given up {pa} a game, against {pf0} and {pa0} with {him}.'] }
  ],
  'absence.minutes': [{ say: ['{Q} has taken on most of the minutes, up from {b} a game to {a}.'] }],
  'absence.next': [{ say: ['Next for {T}: {day}, {where}.'] }],

  /* ======================================================================== WHERE A PLAYER'S SHOTS COME FROM === */
  'profile': [
    { level: 2, when: c => c.rimMost, say: ['{He} does most of {his} damage at the rim.'] },
    { level: 1, when: c => c.rim, say: ['{He} loves to attack the basket: {rimFrac} of {his} shots come right at the rim.'] },
    { when: c => c.three, say: ['{He} lives behind the arc: {p3Frac} of {his} shots are threes.'] }
  ],

  /* ============================================================================ THE STORYLINES (narrative.js) === */
  'story.bpm.head': [{ say: ['{P} has been the best player in the league so far, by our numbers'] }],
  'story.bpm.why': [
    { when: c => c.P2, say: ['{gapWords} ahead of {P2}. Our all-in-one rating counts everything a player does on the floor, not just the points.'] },
    { say: ['Our all-in-one rating counts everything a player does on the floor, not just the points.'] }
  ],
  'story.quiet.dek': [{ say: ['{rank} in the league by our all-in-one rating, but only {scoring} in scoring{forT}.'] }],
  'story.quiet.why': [{ say: ['Only {k} have done more for their teams, and {s} score more. The box score does not tell the whole story.'] }],
  'story.closer.why': [{ say: ['These are the points people remember.', 'Close games are where seasons are won, and this is who wins them.'] }],
  'story.upset.decided': [
    { when: c => c.k === 'efg', say: ['They simply made more of their shots.'] },
    { when: c => c.k === 'tovp', say: ['They won it on turnovers.'] },
    { when: c => c.k === 'orebp', say: ['They won it on the offensive glass.'] },
    { when: c => c.k === 'ftr', say: ['They won it at the free-throw line.'] }
  ],
  'story.schedule.dek': [{ say: ['No side in the league has faced a tougher set of opponents so far; {E} have had the easiest.'] }],
  'story.bigPicture.decides': [{ say: ['In this league, {first} decides games more than anything else, then {second}.'] }]
};

/* ==================================================================== a game's stakes ===
   WHY A GAME MATTERS: the context game.stakes and game.meetings are said in, from a game's two sides.
     x: { A, B (entities, A at home), rankA, rankB, n (clubs in the table), recA / recB { w, l }, runA / runB { won, n },
          meetings [{ aWon, hi, lo }] (oldest first) }
   -> { lines: the sentences, c: the context (its flags say what has been said: bothUnbeaten, top2, hotCold ...) } */
function stakes(W, x) {
  const c = { A: x.A, B: x.B }, rA = x.rankA, rB = x.rankB, n = x.n || 0;
  const perfect = r => !!(r && r.l === 0 && r.w >= 2);
  c.bothUnbeaten = perfect(x.recA) && perfect(x.recB);
  if (rA && rB) {
    c.top2 = Math.min(rA, rB) === 1 && Math.max(rA, rB) === 2;
    c.top4 = !c.top2 && n >= 8 && Math.max(rA, rB) <= 4;
    if (n >= 8 && Math.min(rA, rB) <= 3 && Math.max(rA, rB) > n - 3) {
      const aTop = rA < rB;
      Object.assign(c, { topBottom: true, Top: aTop ? x.A : x.B, Bottom: aTop ? x.B : x.A, posTop: nth(Math.min(rA, rB)), posBottom: nth(Math.max(rA, rB)) });
    }
  }
  /* the modest facts (the level-0 lines): matching records after two games or more, a side still winless, the last result */
  const recOf = r => (r && r.w + r.l >= 1 ? r.w + '–' + r.l : null);
  if (recOf(x.recA) && recOf(x.recA) === recOf(x.recB) && x.recA.w + x.recA.l >= 2) Object.assign(c, { sameRec: true, rec: recOf(x.recA) });
  const winless = r => !!(r && r.w === 0 && r.l >= 2);
  if (x.recA && x.recB && winless(x.recA) !== winless(x.recB)) { const a0 = winless(x.recA); Object.assign(c, { winless: true, Winless: a0 ? x.A : x.B, Other: a0 ? x.B : x.A }); }
  if (!!x.lastA !== !!x.lastB) { const r = x.lastA || x.lastB; Object.assign(c, { form: 'one', One: x.lastA ? x.A : x.B, oneWon: !!r.won, oneOpp: r.opp }); }
  if (x.lastA && x.lastB) {
    if (x.lastA.won && x.lastB.won) c.form = 'won';
    else if (!x.lastA.won && !x.lastB.won) c.form = 'lost';
    else { const aW = x.lastA.won; Object.assign(c, { form: 'split', FW: aW ? x.A : x.B, FL: aW ? x.B : x.A, oppW: (aW ? x.lastA : x.lastB).opp, oppL: (aW ? x.lastB : x.lastA).opp }); }
  }
  const sA = x.runA && x.runA.n >= 3 ? x.runA : null, sB = x.runB && x.runB.n >= 3 ? x.runB : null;
  if (sA && sB && sA.won && sB.won) Object.assign(c, { bothHot: !c.bothUnbeaten, nA: spell(sA.n), nB: spell(sB.n) });
  else if (sA && sB && sA.won !== sB.won) {
    const aHot = sA.won;
    Object.assign(c, { hotCold: true, Hot: aHot ? x.A : x.B, Cold: aHot ? x.B : x.A, nHot: spell((aHot ? sA : sB).n), nCold: spell((aHot ? sB : sA).n) });
  }
  const M = x.meetings || [];
  if (M.length) {
    const last = M[M.length - 1], wA = M.filter(m => m.aWon).length, wB = M.length - wA;
    const nm = e => (isEnt(e) ? e.name : String(e));
    Object.assign(c, { met: M.length, W: last.aWon ? x.A : x.B, L: last.aWon ? x.B : x.A, score: last.hi + '–' + last.lo, margin: last.hi - last.lo, nthMeet: spell(M.length + 1),
      series: wA === wB ? 'the season series is level at ' + wA + '–' + wB : nm(wA > wB ? x.A : x.B) + ' lead the season series ' + Math.max(wA, wB) + '–' + Math.min(wA, wB) });
  }
  return { lines: [W.say('game.stakes', c), W.say('game.meetings', c)].filter(Boolean), c };
}

return { writer, options, extend, stakes, proof, club, person, cl, join, rel: relc, part, frac, avg, spell, spellOut, nth, cap, article, possOf, surname, BANK, grammar: !!J };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaVoice;
export const { writer, options, extend, stakes, proof, club, person, cl, join, rel, part, frac, avg, spell, spellOut, nth, cap, article, possOf, surname, BANK, grammar } = __api;
export default __api;
