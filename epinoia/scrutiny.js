'use strict';
/* ============================================================================
   THE EDITOR: the last reader before anything the newsroom writes is posted (Louie, 2026-10-08).

   voice.js proofreads each sentence as it is made. This reads the whole piece - every sentence against the ones around
   it, every paragraph against the piece - and checks what only a whole piece shows. Each FINDING is located (the
   headline, the standfirst, paragraph and sentence: "p4.s2", and the section it sits in), classed - incorrect,
   illogical, unwieldy, style - and FIXED where it stands; the piece is posted with its report (qa). A finding that
   cannot be fixed and is incorrect or illogical HOLDS the piece back: it is not posted.

   What it checks (each a rule in the report):
     grammar      the proof again, on the final text (a/an, agreement, doubled words, spacing, a numeral opening)
     model-speak  the words of a model, not a writer: "the numbers say", "points a chance", "standard step" ...
     reference    a role ("the hosts") or a pronoun before the club has been named in its section; a paragraph opening on
                  "they" / "she"; a "they" after a sentence that named two clubs
     time         a record or a run claimed for a game when the club plays another game first (it can change)
     claim-twice  the same claim made twice in the piece (both unbeaten, in the stakes and again in a reason)
     near-copy    two sentences that say the same thing in nearly the same words
     unwieldy     a sentence past forty words (split at its seam), a paragraph past 110 (split at a sentence)
     thin         a section with nothing to say (a lean and a name, no reason, stake or player who swings it) goes;
                  a piece left with fewer than two sections, or three paragraphs, is held back
     count        a number in the standfirst that the piece does not bear out ("the three games", two sections)
     headline     a full stop, a doubled word, a headline past 100 characters

       const q = EpinoiaScrutiny.scrutinise(piece, { log, schedule, clubs });   q.piece, q.report { fixes, held, ok, quality, substance }

   QUALITY (0.4-1): how ready the piece is, for the salience that decides what is posted (newsroom.js publish: salience x
   the format's weight x quality must clear the bar). What the edit had to fix weighs it down (illogical most, style least),
   and so does too little left to say: SUBSTANCE is the sentences that carry a fact or a judgement - not the boilerplate of
   a lean, a name to watch, the next fixture, a caveat.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EpinoiaScrutiny = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const VOICE = () => root.EpinoiaVoice || (typeof require === 'function' ? require('./voice.js') : null);
const cap = s => String(s || '').replace(/^(\s*["“‘(]?)([a-z])/, (m, w, c) => w + c.toUpperCase());

/* sentences: a full stop that ends one, not one inside "Jr." "St." "C.B." or a decimal */
const ABBR = /(?:\b(?:Jr|Sr|St|Mt|Dr|Mr|Mrs|Ms|vs|v|No|Nos|approx|etc)|\b[A-Z](?:\.[A-Z])*)\.$/;
function sentences(par) {
  const t = String(par || '').trim();
  if (!t) return [];
  const out = [];
  let start = 0;
  const re = /[.!?](?=\s+[“‘"(]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(t))) {
    const cand = t.slice(start, m.index + 1);
    if (ABBR.test(cand)) continue;
    out.push(cand.trim());
    start = m.index + 1;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
const words = s => String(s).toLowerCase().replace(/[^a-z’' ]/g, ' ').split(/\s+/).filter(w => w && w.length > 2 && !STOP.has(w));
const STOP = new Set('the and for with that this they their them have has had are was were but yet from into over than then when while who which what one two its his her she him not been will would could can just also more most very only about after before again'.split(' '));
const jac = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return n / (A.size + B.size - n); };

/* the model's words, and what a writer says instead (null: the sentence goes) */
const MODEL = [
  [/\bwhere the numbers say each will be decided\b/gi, 'what will decide each one'],
  [/\bwhere this week’s biggest games will be won and lost, according to the numbers\b/gi, 'where this week’s biggest games will be won and lost'],
  [/\bthe numbers say (?:it|this|that) (?:comes down to|turns on)\b/gi, 'it comes down to'],
  [/,?\s*(?:according to|by) the numbers\b/gi, ''],
  [/\bthe numbers say\b/gi, null],
  [/\bpoints a chance\b/gi, 'points a possession'],
  [/\ba chance in (transition|the half court)\b/gi, 'a possession in $1'],
  [/\bone standard step\b/gi, null],
  [/\bfour factors\b/gi, null],
  [/\b(?:the league’s own model|model of what wins)\b/gi, null],
  [/\breplayed games?\b/gi, m => (/s$/i.test(m) ? 'games' : 'game')]
];

function scrutinise(piece0, o) {
  const op = o || {}, V = VOICE();
  const piece = JSON.parse(JSON.stringify(piece0));
  const fixes = [], held = [];
  const LOG = (op.log || []).slice();
  const clubs = op.clubs || [];
  const note = (at, kind, rule, why, before, after) => fixes.push({ at, kind, rule, note: why, before: before == null ? null : String(before).slice(0, 220), after: after == null ? null : String(after).slice(0, 220) });
  const hold = (at, kind, rule, why, text) => held.push({ at, kind, rule, note: why, text: String(text || '').slice(0, 220) });
  const logOf = s => LOG.find(x => x.text === s) || LOG.find(x => x.section >= 0 && x.text.indexOf(s.replace(/[.!?]$/, '')) >= 0)
    || LOG.find(x => x.section >= 0 && s.indexOf(x.text.replace(/[.!?]$/, '')) >= 0) || null;

  /* -------- the units: headline(s), standfirst, paragraphs by section; each sentence with what the writer logged of it
     (paired once, on the words as written: a rule that changes the words keeps the pairing) -------- */
  const isCard = piece.kind === 'card';
  const P = [];                                   // { where, section, label, sents: [{ t, lg }] }
  const S = text => sentences(text).map(t => ({ t, lg: logOf(t) }));
  let section = 0, label = null, pn = 0;
  if (isCard) {
    if (piece.line) P.push({ where: 'lean', section: 0, sents: S(piece.line), set: x => { piece.line = x; } });
    const why = [piece.angle].concat(piece.threads || []).filter(Boolean);
    why.forEach((x, i) => P.push({ where: 'why' + (i + 1), section: 0, sents: S(x), set: y => { if (i === 0) piece.angle = y; else piece.threads[i - 1] = y; } }));
    (piece.reasons || []).forEach((r, i) => P.push({ where: 'reason' + (i + 1), section: 0, sents: S(r.text), label: r.title, set: y => { r.text = y; } }));
  } else {
    (piece.body || []).forEach((x, i) => {
      if (x && typeof x === 'object' && x.h) { section++; label = x.h; return; }
      if (typeof x !== 'string') return;
      pn++;
      P.push({ where: 'p' + pn, section, label, idx: i, sents: S(x), set: y => { piece.body[i] = y; } });
    });
  }
  const at = (u, k) => u.where + '.s' + (k + 1) + (u.label ? ' (' + u.label + ')' : '');

  /* -------- grammar and model-speak, sentence by sentence -------- */
  P.forEach(u => {
    u.sents = u.sents.map((x, k) => {
      let t = x.t;
      for (const [re, to] of MODEL) {
        if (!re.test(t)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        if (to === null) { note(at(u, k), 'style', 'model-speak', 'the words of a model, not a writer: the sentence goes', t, null); return null; }
        const n = t.replace(re, to).replace(/\s{2,}/g, ' ');
        note(at(u, k), 'style', 'model-speak', 'said as a writer would', t, n);
        t = n;
      }
      const pr = V ? V.proof(t, { clubs }) : { text: t };
      if (pr.text !== t) { note(at(u, k), 'incorrect', 'grammar', 'mechanics: punctuation, agreement, articles, spelling', t, pr.text); t = pr.text; }
      return { t, lg: x.lg };
    }).filter(Boolean);
  });

  /* -------- references: a role or a pronoun before the name, in its section -------- */
  const namedIn = {};                              // section -> names said so far
  P.forEach(u => {
    const said = namedIn[u.section] = namedIn[u.section] || new Set(clubs.filter(n => u.label && u.label.indexOf(n) >= 0));
    u.sents = u.sents.map((x, k) => {
      const lg = x.lg;
      let t = x.t;
      (lg ? lg.ents : []).forEach(e => {
        if (e.ent === 'club' && e.role) {
          const re = new RegExp('\\b' + e.role.replace(/^the /, '(?:the|The) ') + '\\b');
          if (re.test(t) && !said.has(e.name) && t.indexOf(e.name) < 0) {
            const n = t.replace(re, m => (m.charAt(0) === 'T' ? cap(e.name) : e.name));
            note(at(u, k), 'incorrect', 'reference', '"' + e.role + '" before ' + e.name + ' had been named in this part: named instead', t, n);
            t = n;
          }
        }
        if (t.indexOf(e.name) >= 0) said.add(e.name);
      });
      clubs.forEach(n => { if (t.indexOf(n) >= 0) said.add(n); });
      /* a pronoun opening a paragraph: the paragraph says who it means. The writer's own pronoun (its log knows whom it
         stood for) is resolved; one written into a phrase is reported for the phrasebook, never guessed at */
      if (k === 0 && /^(They|He|She|Their|His|Her)\b/.test(t)) {
        const e = lg && lg.pron ? lg.ents.find(y => y.id === lg.pron) : null;
        if (e) {
          const n = t.replace(/^(They|He|She)\b/, e.name).replace(/^(Their|His|Her)\b/, e.name + (/s$/.test(e.name) ? '’' : '’s'));
          note(at(u, k), 'incorrect', 'reference', 'a paragraph opening on a pronoun: it names who it means', t, n);
          t = n; said.add(e.name);
        } else note(at(u, k), 'style', 'reference', 'a paragraph opening on a pronoun the editor cannot resolve: for the phrasebook', t, t);
      }
      /* "they" after a sentence that named two clubs: whose? */
      if (k > 0 && /^They\b/.test(t) && lg && lg.pron) {
        const prev = u.sents[k - 1] && u.sents[k - 1].lg;
        const clubsBefore = prev ? prev.ents.filter(y => y.ent === 'club').length : 0;
        const e = lg.ents.find(y => y.id === lg.pron);
        if (clubsBefore >= 2 && e && e.ent === 'club') { const n = t.replace(/^They\b/, e.name); note(at(u, k), 'incorrect', 'reference', 'an ambiguous "they": the previous sentence named two clubs', t, n); t = n; }
      }
      return { t, lg };
    });
  });

  /* -------- time: a record or a run claimed when a club plays another game first -------- */
  const sch = op.schedule || {};
  P.forEach(u => {
    u.sents = u.sents.filter((x, k) => {
      const lg = x.lg;
      const g = (lg && op.sectionGame && op.sectionGame[lg.section]) || op.game || null;
      const bad = lg && g && (lg.claims || []).find(c => (c.k === 'record' || c.k === 'run') && (c.ids || []).some(id => sch[id] && sch[id] !== g));
      if (bad) { note(at(u, k), 'illogical', 'time', 'a ' + (bad.k === 'record' ? 'record' : 'run') + ' said to be on the line, but a club plays another game first: it can change before this one', x.t, null); return false; }
      return true;
    });
  });

  /* -------- the same claim twice; two sentences saying the same thing -------- */
  const claimSeen = new Map(), sentSeen = [];
  const clubRe = new RegExp(clubs.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '^$', 'g');
  P.forEach(u => {
    u.sents = u.sents.filter((x, k) => {
      const lg = x.lg;
      /* a claim is made once by one statement: the sentences of that statement (an option of two sentences) are not repeats */
      const keys = (lg ? lg.claims || [] : []).filter(c => c.k === 'record' || c.k === 'run').map(c => c.k + ':' + (c.ids || []).slice().sort().join(','));
      if (keys.length && keys.every(y => claimSeen.has(y) && claimSeen.get(y) !== lg)) { note(at(u, k), 'unwieldy', 'claim-twice', 'the piece has said this already', x.t, null); return false; }
      keys.forEach(y => { if (!claimSeen.has(y)) claimSeen.set(y, lg); });
      const w = words(x.t.replace(clubRe, ''));
      const twin = w.length >= 5 && sentSeen.find(y => jac(y, w) >= 0.6);
      if (twin) { note(at(u, k), 'unwieldy', 'near-copy', 'two sentences saying the same thing in nearly the same words', x.t, null); return false; }
      sentSeen.push(w);
      return true;
    });
  });
  /* a card: a reason's closing line that only repeats its title */
  if (isCard) (piece.reasons || []).forEach((r, i) => {
    const u = P.find(y => y.where === 'reason' + (i + 1));
    if (!u || u.sents.length < 2) return;
    const tt = String(r.title || '').toLowerCase().replace(/[^a-z ]/g, '');
    const lastS = u.sents[u.sents.length - 1].t;
    if (tt && lastS.toLowerCase().replace(/[^a-z ]/g, '').indexOf(tt) >= 0) { note(at(u, u.sents.length - 1), 'unwieldy', 'claim-twice', 'the closing line repeats the title', lastS, null); u.sents.pop(); }
  });

  /* -------- unwieldy: a sentence too long to follow -------- */
  P.forEach(u => {
    const out = [];
    u.sents.forEach((x, k) => {
      const t = x.t, n = t.split(/\s+/).length;
      if (n <= 40) { out.push(x); return; }
      const seam = /; /.test(t) ? '; ' : / but /.test(t) ? ', but ' : /, and /.test(t) ? ', and ' : null;
      if (!seam || t.indexOf(seam) < 0) { out.push(x); note(at(u, k), 'unwieldy', 'unwieldy', 'a long sentence with no clean seam: left whole', t, t); return; }
      const i = t.indexOf(seam), a1 = t.slice(0, i).replace(/,$/, '') + '.', b1 = cap(t.slice(i + 2));
      note(at(u, k), 'unwieldy', 'unwieldy', 'over forty words: split at its seam', t, a1 + ' ' + b1);
      out.push({ t: a1, lg: x.lg }, { t: b1, lg: x.lg });
    });
    u.sents = out;
  });

  /* -------- a pronoun after a sentence that named two clubs, in a sentence that names none: reported -------- */
  P.forEach(u => u.sents.forEach((x, k) => {
    const t = x.t;
    if (k === 0 || !/\b(they|them|their)\b/i.test(t) || clubs.some(n => t.indexOf(n) >= 0) || /\bthe (hosts|visitors)\b/i.test(t)) return;
    const prev = u.sents[k - 1].t, n2 = clubs.filter(n => prev.indexOf(n) >= 0).length + (prev.match(/\bthe (hosts|visitors)\b/gi) || []).length;
    if (n2 >= 2) note(at(u, k), 'style', 'reference', 'a "they" after a sentence about two clubs: whose? (for the phrasebook)', t, t);
  }));

  /* -------- thin: a section with nothing to say -------- */
  if (!isCard && LOG.length) {
    const SUB = /^(reason\.|game\.stakes|game\.meetings|game\.onoff)/;
    const secs = [...new Set(P.filter(u => u.section > 0).map(u => u.section))];
    const thin = secs.filter(sec => !P.filter(u => u.section === sec).some(u => u.sents.some(x => x.lg && SUB.test(x.lg.slot || ''))));
    thin.forEach(sec => P.filter(u => u.section === sec).forEach(u => {
      note(u.where + (u.label ? ' (' + u.label + ')' : ''), 'unwieldy', 'thin', 'a section with nothing to say beyond a lean and a name: it goes', u.sents.map(x => x.t).join(' '), null);
      u.sents = []; u.dropHead = true;
    }));
  }

  /* -------- write back, and a paragraph too long split at a sentence -------- */
  P.forEach(u => {
    const text = u.sents.map(x => x.t).join(' ').trim();
    u.set(text || null);
  });
  if (!isCard) {
    const body = [];
    (piece.body || []).forEach((x, i) => {
      if (x == null || x === '') return;
      if (typeof x === 'string' && x.split(/\s+/).length > 110) {
        const ss = sentences(x), half = Math.ceil(ss.length / 2);
        if (ss.length >= 4) { note('p?', 'unwieldy', 'unwieldy', 'a paragraph past 110 words: split at a sentence', x, null); body.push(ss.slice(0, half).join(' '), ss.slice(half).join(' ')); return; }
      }
      body.push(x);
    });
    piece.body = body;
    /* two subheads in a row: a section left with nothing to say goes */
    piece.body = piece.body.filter((x, i, a) => !(x && x.h && (i === a.length - 1 || (a[i + 1] && a[i + 1].h))));
    const left = piece.body.filter(x => x && x.h).length;
    if (P.some(u => u.dropHead) && left < 2) hold('body', 'illogical', 'thin', 'a piece about the week\'s games with fewer than two games left worth a word', '');
  }

  /* -------- the standfirst's count against the piece (and its words) -------- */
  if (!isCard && piece.dek) {
    for (const [re, to] of MODEL) {
      if (!re.test(piece.dek)) { re.lastIndex = 0; continue; }
      re.lastIndex = 0;
      if (to === null) { hold('dek', 'style', 'model-speak', 'a standfirst in the words of a model', piece.dek); break; }
      const d = piece.dek.replace(re, to).replace(/\s{2,}/g, ' ');
      note('dek', 'style', 'model-speak', 'said as a writer would', piece.dek, d);
      piece.dek = d;
    }
    const m = /\b([Tt]he) (two|three|four|five) (games|pieces)\b/.exec(piece.dek), N = { two: 2, three: 3, four: 4, five: 5 }, W2 = ['', 'one', 'two', 'three', 'four', 'five'];
    const sections = (piece.body || []).filter(x => x && x.h).length;
    /* two or more left (with fewer, the piece is held back) */
    if (m && sections >= 2 && N[m[2]] !== sections && W2[sections]) { const d = piece.dek.replace(m[0], m[1] + ' ' + W2[sections] + ' ' + m[3]); note('dek', 'incorrect', 'count', 'the standfirst counted ' + m[2] + '; the piece has ' + sections, piece.dek, d); piece.dek = d; }
    const pr = V ? V.proof(piece.dek, { clubs }) : { text: piece.dek };
    if (pr.text !== piece.dek) { note('dek', 'incorrect', 'grammar', 'mechanics', piece.dek, pr.text); piece.dek = pr.text; }
  }

  /* -------- headlines -------- */
  const headFix = (h, where) => {
    let t = String(h || '').trim();
    const t0 = t;
    t = t.replace(/\.$/, '').replace(/\b(\w+) \1\b/gi, '$1').replace(/\s{2,}/g, ' ');
    t = cap(t);
    if (t !== t0) note(where, 'incorrect', 'headline', 'a headline has no full stop, no doubled word', t0, t);
    return t;
  };
  if (!isCard && piece.head) {
    if (Array.isArray(piece.heads)) {
      piece.heads = piece.heads.map((h, i) => headFix(h, 'head' + (i + 1))).filter((h, i) => { if (h.length > 100) { note('head' + (i + 1), 'unwieldy', 'headline', 'over 100 characters: not used', h, null); return false; } return true; });
      if (!piece.heads.length) hold('head', 'incorrect', 'headline', 'no headline left to use', piece.head);
      piece.head = piece.heads[0] || piece.head;
    } else piece.head = headFix(piece.head, 'head');
  }

  /* -------- the gate -------- */
  if (!isCard) {
    const paras = (piece.body || []).filter(x => typeof x === 'string');
    if (paras.length < 3) hold('body', 'incorrect', 'thin', 'fewer than three paragraphs left after the edit', paras.join(' '));
    if (!piece.dek) hold('dek', 'incorrect', 'thin', 'no standfirst', '');
  }
  /* -------- quality: how ready it is -------- */
  const W8 = { incorrect: 0.05, illogical: 0.1, unwieldy: 0.04, style: 0.01 };
  const pen = fixes.reduce((a, f) => a + (W8[f.kind] || 0), 0);
  const BOIL = /^(game\.lean|game\.player|watch\.lede|head)$|\.(next|caveat|dek|head|title)$/;
  const finalText = isCard ? [piece.line, piece.angle].concat(piece.threads || [], (piece.reasons || []).map(r => r.text)).filter(Boolean).join(' ')
    : (piece.body || []).filter(x => typeof x === 'string').join(' ');
  const substance = LOG.filter(x => x.section >= 0 && !BOIL.test(x.slot || '') && finalText.indexOf(x.text.replace(/[.!?]$/, '')) >= 0).length
    + (LOG.length ? 0 : sentences(finalText).length);
  const sectionsLeft = isCard ? 0 : (piece.body || []).filter(x => x && x.h).length;
  const expected = isCard ? 3 : sectionsLeft ? 2 * sectionsLeft : 4;
  const quality = Math.max(0.4, Math.min(1, Math.round((1 - pen) * Math.min(1, 0.5 + 0.5 * substance / expected) * 100) / 100));
  const report = { checked: new Date(op.nowMs || Date.now()).toISOString(), fixes: fixes.slice(0, 24), held, ok: !held.length, quality, substance };
  return { piece, report };
}

return { scrutinise, sentences };
}));
