'use strict';
/* ============================================================================
   NEWS ART - a cover for every story that came without a picture, and the kit the creator hub's news posts are
   drawn with (newspost.js).   window.EpinoiaNewsArt

   A STORY WITHOUT A PICTURE STILL HAS A SUBJECT. Its headline and its first lines name it: the two clubs of a
   result, the club a piece is about, the player, the number that made the night (35 points, 10 down, a 12-0 run),
   what kind of news it is (a signing, an injury, a trade, a preview). analyse() reads those out of the words alone
   (no server, no model), and drawArt() makes the cover a sports desk would: the subject's colours deep across the
   field, the crowd's light behind, crests on their discs, the subject's name in heavy condensed capitals in two
   colours. Louie, 2026-10-16: "nice auto graphic covers for news articles (including articles sent into the website
   with no cover)".

     analyse(article, { clubs })   -> facts { layout, clubs, names, number, score, topic, palette, seed }
                                      layout: 'duel' (two clubs), 'club', 'number', 'name' or 'brand' (nothing found)
     drawArt(ctx, W, H, facts, images, opts)   one cover onto a 2D context (any size; the tests drive it)
     mount(host, item, opts)       a cover drawn into a plate on the page, at the plate's own size, redrawn when it
                                   changes; the plate's own print stays under it until it is drawn
     clubsFor(slugs)               a league's clubs (name, short, colours, crest), read once a page

   THE KIT (for newspost.js): font(), fit(), lines(), cover(), disc(), ground(), pill(), palette(), load().

   Canvas text cannot be translated by the page, so the few words drawn here go through EpinoiaI18n.t (context
   'newsart'); names are never translated.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsArt = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------------ colour --- */
const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null);
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function toHex(c) { return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); }
function lum(h) {
  const c = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function sat(h) { const c = rgb(h), mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; }
function rgba(h, a) { const c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
/* a colour from a name, the same every time (newscard.js tint, as hex) */
function tintHex(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const s = 0.52, l = 0.42, k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
const YELLOW = '#ffe14d';
/* THE PALETTE OF A SUBJECT: the field deep enough for white capitals on it, the subject's own colour in the light,
   and an accent that is a colour (a club's white or black second colour is no accent): its second colour, else its
   first lifted, else the desk's yellow */
/* THE DESK'S OWN COLOURWAYS, for a story whose publisher keeps no colour: deep grounds a sports desk prints on, each
   with its accent (a hue from the name would make every one of them the same orange) */
const HOUSE = [['#16305f', '#ffd23f'], ['#0f4a3a', '#f2e94e'], ['#3b1f63', '#ffcf4a'], ['#1d2733', '#4fd1c5'], ['#7a1222', '#ffd166'],
  ['#0e4c6b', '#ffe14d'], ['#202a44', '#ff5d73'], ['#123b2a', '#9cff57'], ['#2b2b2b', '#ff9f1c'], ['#3a1450', '#5ee7ff']];
function hue(h) {
  const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
}
function palette(c1, c2, seed) {
  if (!hex(c1)) {
    const pick = HOUSE[hash(seed || '') % HOUSE.length];
    return palette(pick[0], pick[1], null);
  }
  const base = hex(c1);
  const L = lum(base);
  const deep = L > 0.4 ? mix(base, '#05070a', 0.78) : L > 0.12 ? mix(base, '#05070a', 0.6) : mix(base, '#05070a', 0.35);
  const mid = L > 0.4 ? mix(base, '#05070a', 0.45) : L < 0.03 ? mix(base, '#3a4250', 0.35) : base;
  let accent = null;
  /* the second colour when it is a colour; the first, lifted, when it lifts to something bright (a green, a blue, a
     gold - a red lifts to pink, which is no accent); else the desk's yellow */
  for (const [c, own] of [[hex(c2), false], [base, true]]) {
    if (!c || sat(c) < 0.32) continue;
    let a = c;
    for (let i = 0; i < 6 && lum(a) < 0.32; i++) a = mix(a, '#ffffff', 0.2);
    const h = hue(a), reddish = h < 22 || h > 320;
    /* pink is no accent, and the club's own colour lifted must stand clear of the field it is lifted from */
    if (reddish && lum(a) > 0.3) continue;
    if (own && (reddish || sat(a) < 0.45 || Math.abs(lum(a) - lum(mid)) < 0.3)) continue;
    if (Math.abs(lum(a) - lum(deep)) > 0.25 && Math.abs(lum(a) - lum(mid)) > 0.12) { accent = a; break; }
  }
  return { base, deep, mid, accent: accent || YELLOW, ink: '#ffffff' };
}

/* ------------------------------------------------------------------ words --- */
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LETTER = /[\p{L}\p{N}]/u;
/* whole words only: "Lions" in "London Lions", never in "Lionsgate" */
function at(text, key) {
  if (!key) return -1;
  const t = fold(text), k = fold(key);
  let i = t.indexOf(k);
  while (i >= 0) {
    const before = i ? t[i - 1] : ' ', after = t[i + k.length] || ' ';
    if (!LETTER.test(before) && !LETTER.test(after)) return i;
    i = t.indexOf(k, i + 1);
  }
  return -1;
}
/* the words a club is called by: its name, its name without a sponsor in front (every tail of two words or more),
   its short name when it is a word, and - when no other club of the league shares it - its last word (Lions) and its
   first (Leicester), if long enough to mean something */
const COMMON = new Set(['basketball', 'basket', 'club', 'team', 'city', 'united', 'real', 'sporting', 'athletic', 'academy', 'royals',
  'national', 'the', 'new', 'north', 'south', 'east', 'west', 'saint', 'san', 'santa', 'union', 'olympic', 'women', 'men']);
function clubKeys(list) {
  const firsts = new Map(), lasts = new Map();
  const words = c => clean(c.name).split(' ').filter(Boolean);
  list.forEach(c => {
    const w = words(c);
    if (w.length < 2) return;
    const f = fold(w[0]), l = fold(w[w.length - 1]);
    firsts.set(f, (firsts.get(f) || 0) + 1); lasts.set(l, (lasts.get(l) || 0) + 1);
  });
  return list.map(c => {
    const w = words(c), keys = [clean(c.name)];
    for (let i = 1; i <= w.length - 2; i++) keys.push(w.slice(i).join(' '));
    if (c.short && /^[\p{L}][\p{L}.' -]{3,}$/u.test(c.short) && !/^[A-Z]{2,4}$/.test(c.short)) keys.push(clean(c.short));
    if (w.length >= 2) {
      const f = fold(w[0]), l = fold(w[w.length - 1]);
      if (lasts.get(l) === 1 && l.length >= 4 && !COMMON.has(l)) keys.push(w[w.length - 1]);
      if (firsts.get(f) === 1 && f.length >= 5 && !COMMON.has(f)) keys.push(w[0]);
    }
    return { club: c, keys: [...new Set(keys)].sort((a, b) => b.length - a.length) };
  });
}
/* ONE WORD IS A WEAKER CLAIM than a name: "Thunder" is Worthing's only where the text does not say "Oklahoma City
   Thunder", and "derby" in lower case is a kind of game, not Derby. So a one-word key must be written with its
   capital, and the words either side of it must not be capitalised words of some other name. */
function wordAt(text, key) {
  const src = clean(text), k = fold(key);
  const t = fold(src);
  let i = t.indexOf(k);
  while (i >= 0) {
    const before = i ? t[i - 1] : ' ', after = t[i + k.length] || ' ';
    if (!LETTER.test(before) && !LETTER.test(after) && /\p{Lu}/u.test(src[i] || '')) {
      const prev = (src.slice(0, i).trim().split(/\s+/).pop() || '').replace(/[^\p{L}]/gu, '');
      const next = (src.slice(i + k.length).trim().split(/\s+/)[0] || '').replace(/[^\p{L}]/gu, '');
      const sentenceStart = /(^|[.!?:;]\s*)$/.test(src.slice(0, i));
      const capWord = w => w.length > 1 && /^\p{Lu}/u.test(w) && !OPENERS.has(fold(w));
      if ((sentenceStart || !capWord(prev)) && !capWord(next)) return i;
    }
    i = t.indexOf(k, i + 1);
  }
  return -1;
}
/* the clubs a text names, in the order it names them: [{ club, at, key }]. whole: the story's every word, where a
   one-word key must not be some other team's last word anywhere ("Rockets dominate Thunder" over a summary that says
   "the Oklahoma City Thunder") */
function clubsIn(text, list, whole) {
  const out = [];
  clubKeys(list || []).forEach(({ club, keys }) => {
    for (const k of keys) {
      const one = !/\s/.test(k);
      const i = one ? wordAt(text, k) : at(text, k);
      if (i < 0) continue;
      if (one && whole && otherTeam(whole, k, club)) continue;
      out.push({ club, at: i, key: k }); break;
    }
  });
  return out.sort((a, b) => a.at - b.at);
}
function otherTeam(text, key, club) {
  const re = new RegExp('(\\p{Lu}[\\p{L}.’\'-]*)\\s+' + esc(key) + '(?![\\p{L}])', 'gu');
  const mine = new Set(clean(club.name).split(' ').map(fold));
  let m;
  while ((m = re.exec(clean(text)))) {
    const w = fold(m[1]);
    if (!mine.has(w) && !OPENERS.has(w)) return true;
  }
  return false;
}

/* THE PEOPLE (and the teams the site does not know) A STORY NAMES: runs of two or three capitalised words, in the
   sentence-case lines first (a title in Title Case capitalises everything); a run that opens a sentence loses an
   opening article; months, days and the game's own words are not names */
const OPENERS = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'after', 'before', 'with', 'from', 'for', 'how', 'why', 'what', 'when', 'who',
  'this', 'that', 'el', 'la', 'los', 'las', 'le', 'les', 'il', 'lo', 'gli', 'un', 'una', 'une', 'des', 'der', 'die', 'das', 'de', 'del',
  'pourquoi', 'comment', 'quand', 'según', 'segun', 'como', 'cómo', 'porque', 'perché', 'quando', 'dove', 'wie', 'warum', 'qué', 'que',
  'sur', 'avec', 'pour', 'par', 'dans', 'après', 'avant', 'tras', 'con', 'sin', 'per', 'nel', 'dopo', 'prima', 'but', 'and', 'as', 'if']);
/* the English articles, dropped from the front of any run (The Houston Rockets); the rest only where a sentence opens */
const ARTICLES = new Set(['the', 'a', 'an']);
const NOT_NAMES = new Set(['league', 'liga', 'lega', 'ligue', 'basketball', 'basket', 'baloncesto', 'season', 'regular', 'preseason', 'cup', 'final',
  'finals', 'round', 'week', 'game', 'games', 'nba', 'wnba', 'euroleague', 'eurocup', 'playoffs', 'playoff', 'national', 'conference', 'division',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december', 'mvp', 'all-star', 'report', 'preview', 'previa', 'world', 'europe', 'african',
  'jornada', 'giornata', 'journée', 'opening', 'night', 'centre', 'center', 'arena', 'olympic', 'reserve', 'aktor']);
const CAP = /^[\p{Lu}][\p{Ll}\p{Lu}'’.-]*$/u;
function runsIn(text) {
  const toks = clean(text).split(/\s+/);
  const out = [];
  let run = [], sentence = true;
  const flush = () => {
    /* one opening word off, at most (The Los Angeles Lakers keeps its Los) */
    if (run.length && (ARTICLES.has(fold(run[0].w)) || (run[0].sentence && OPENERS.has(fold(run[0].w))))) run.shift();
    if (run.length >= 2 && run.length <= 4 && run.every(r => !NOT_NAMES.has(fold(r.w))) && run.some(r => /\p{Ll}/u.test(r.w))) {
      out.push(run.map(r => r.w).join(' '));
    }
    run = [];
  };
  toks.forEach(raw => {
    const end = /[.!?:;]["'’”»)]*$/.test(raw);
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.'’-]+$/gu, '').replace(/[’']s$/u, '').replace(/\.$/, '');
    const isCap = w && CAP.test(w) && w.length > 1 && !/^[\p{Lu}]{2,}$/u.test(w) || /^(Jr|Sr|II|III)\.?$/.test(w) && run.length;
    if (isCap) run.push({ w, sentence }); else flush();
    if (/[,]$/.test(raw) || end || /[’']s$/u.test(raw)) flush();
    sentence = end;
  });
  flush();
  return out;
}
function titleCase(t) {
  const w = clean(t).split(' ').filter(x => /\p{L}/u.test(x) && x.length > 3);
  return w.length >= 3 && w.filter(x => /^\p{Lu}/u.test(x)).length / w.length > 0.6;
}
function namesOf(title, summary, avoid) {
  const bad = (avoid || []).map(fold).filter(Boolean);
  const ok = n => !bad.some(b => fold(n).includes(b) || b.includes(fold(n)));
  const fromTitle = titleCase(title) || /^[^\p{Ll}]*$/u.test(title) ? [] : runsIn(title);
  const fromSum = runsIn(summary);
  const all = [];
  fromTitle.forEach(n => { if (ok(n)) all.push(n); });
  /* a name the summary spells out and the title also says (any case) is the subject; the rest after */
  fromSum.filter(n => ok(n) && at(title, n) >= 0).forEach(n => all.push(n));
  fromSum.filter(n => ok(n)).forEach(n => all.push(n));
  const seen = new Set();
  return all.filter(n => { const k = fold(n); if (seen.has(k) || [...seen].some(s => s.includes(k) || k.includes(s))) return false; seen.add(k); return true; });
}

/* THE NUMBER THAT MADE IT A STORY: { value, label } - points, rebounds, a run, a comeback, a streak */
const STATW = { points: 'POINTS', point: 'POINTS', pts: 'POINTS', rebounds: 'REBOUNDS', assists: 'ASSISTS', steals: 'STEALS', blocks: 'BLOCKS',
  threes: 'THREES', 'three-pointers': 'THREES', triples: 'THREES', puntos: 'POINTS', punti: 'POINTS', rebotes: 'REBOUNDS', rimbalzi: 'REBOUNDS' };
const WORDN = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
function numberOf(text) {
  const t = clean(text);
  let m;
  if ((m = /\b(\d{1,2})[–—-](\d{1,2})\s+(run|parcial)\b/i.exec(t))) return { value: m[1] + '–' + m[2], label: 'RUN' };
  if ((m = /\bfrom\s+(\d{1,2})\s+(?:points\s+)?down\b/i.exec(t))) return { value: m[1], label: 'POINT COMEBACK' };
  if ((m = /\b(\d{1,2})[-\s]point\s+(game|night|performance|haul|effort|outing|comeback|win|victory|deficit)\b/i.exec(t))) {
    return /comeback|deficit/i.test(m[2]) ? { value: m[1], label: 'POINT COMEBACK' } : { value: m[1], label: 'POINTS' };
  }
  if ((m = /\b(\d{1,3})\s+(points|pts|rebounds|assists|steals|blocks|threes|three-pointers|triples|puntos|punti|rebotes|rimbalzi)\b/i.exec(t))) {
    if (+m[1] >= 5) return { value: m[1], label: STATW[m[2].toLowerCase()] };
  }
  if ((m = /\b(\w+)\s+(threes|three-pointers|triples)\b/i.exec(t)) && WORDN[m[1].toLowerCase()] >= 5) return { value: String(WORDN[m[1].toLowerCase()]), label: 'THREES' };
  if ((m = /\b(\d{1,2}|\w+)\s+(?:straight|consecutive|in a row)\s*(wins|games|losses|victories)?\b/i.exec(t))) {
    const v = /^\d+$/.test(m[1]) ? +m[1] : WORDN[m[1].toLowerCase()];
    if (v >= 3) return { value: String(v), label: (m[2] && /loss/i.test(m[2]) ? 'STRAIGHT LOSSES' : 'IN A ROW') };
  }
  if ((m = /\b(?:lost|won|lose|win)\s+(\w+)\s+in\s+a\s+row\b/i.exec(t))) {
    const v = /^\d+$/.test(m[1]) ? +m[1] : WORDN[m[1].toLowerCase()];
    if (v >= 3) return { value: String(v), label: /los/i.test(t.slice(m.index, m.index + 5)) ? 'STRAIGHT LOSSES' : 'STRAIGHT WINS' };
  }
  return null;
}
/* a final score in the words: two numbers between 30 and 200 joined by a dash */
function scoreOf(text) {
  const m = /\b(\d{2,3})\s?[–—-]\s?(\d{2,3})\b/.exec(clean(text));
  if (!m) return null;
  const a = +m[1], b = +m[2];
  return a >= 30 && b >= 30 && a <= 200 && b <= 200 ? [a, b] : null;
}

/* WHAT KIND OF NEWS: the two words a desk would put over it, the first in white and the second in the accent */
const TOPICS = [
  ['injury', /\b(injur\w*|infortun\w*|lesi[oó]n\w*|blessure\w*|sidelined|ruled out|out for the|surgery|torn|sprain\w*)\b/i, ['INJURY', 'UPDATE']],
  ['released', /\b(waive[sd]?|waiving|released?|releases|parts ways|part ways|cut by|cortan|terminate[sd]?|leaves|deja|lascia|quitte)\b/i, ['ROSTER', 'MOVE']],
  ['signing', /\b(signs?|signed|signing|joins|joined|re-signs?|agrees?|fich\w+|firma|ingaggi\w*|signe|rejoint|arrives?|lands|moves? to|heads? to|rumbo a)\b/i, ['NEW', 'SIGNING']],
  ['trade', /\b(trades?|traded|trading|swap|deal for|mercato|traspaso|échange)\b/i, ['TRADE', 'TALK']],
  ['contract', /\b(contract|extension|extends|contrato|contratto|prolong\w*)\b/i, ['CONTRACT', 'NEWS']],
  ['offcourt', /\b(sanctions?|fined?|suspen\w+|bans?|banned|appeal\w*|statement|legal|lawsuit|court case|governance|investigat\w+)\b/i, ['OFF THE', 'COURT']],
  ['preview', /\b(preview|previa|anteprima|avant[- ]match|look ahead|ahead of)\b/i, ['GAME', 'PREVIEW']],
  ['debut', /\b(debut|début|esordio)\b/i, ['THE', 'DEBUT']],
  ['award', /\b(mvp|award|honou?rs?|all-star|player of the|named to|trophy|premio)\b/i, ['AWARD', 'NEWS']],
  ['result', /\b(beat|beats|defeat\w*|edg\w+|cruis\w+ past|dominat\w*|rout\w*|wins? over|win at|victory|come from|comeback|stun\w*|upset)\b/i, ['FINAL', 'SCORE']],
  ['quote', /\b(says?|said|reveals?|believes?|insists?|admits?|explains?|speaks|interview|entrevista|intervista|dichiara|déclare)\b|[«“"]/i, ['IN THEIR', 'WORDS']],
  ['rumour', /\b(reportedly|rumou?rs?|could target|targets?|weighs?|eyes|explor\w+|interest in|linked|occhi su|negoci\w+|in talks|talks)\b/i, ['THE', 'LATEST']],
  ['schedule', /\b(schedule|fixtures|calendar|calendario|tip-off times|tickets?)\b/i, ['WHAT’S', 'NEXT']]
];
const KIND_TOPIC = { video: ['WATCH', 'NOW'], podcast: ['LISTEN', 'NOW'], social: ['THE', 'POST'] };
/* the headline says what it is before the lines under it do: "Knicks waive …" is a roster move, whatever injury the
   summary mentions */
function topicOf(text, kind, more) {
  if (KIND_TOPIC[kind]) return { key: kind, words: KIND_TOPIC[kind] };
  for (const t of [text, more]) {
    if (!t) continue;
    for (const [key, re, words] of TOPICS) if (re.test(t)) return { key, words };
  }
  return { key: 'news', words: ['LATEST', 'NEWS'] };
}

/* A QUOTE IN THE WORDS: the first thing said in quotation marks, long enough to be a sentence */
function quoteOf(text) {
  const m = /[“"«]([^”"»]{18,240})[”"»]/.exec(String(text || ''));
  return m ? clean(m[1]) : null;
}

function hash(s) { let h = 2166136261; for (const ch of String(s || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* EVERYTHING THE WORDS SAY, for a cover or a post.
   a: { title, summary | standfirst, kind, brand: { name, colour, colour2, logo }, home, away (clubs, when the story is a
        game's), homeScore, awayScore }
   o: { clubs: [{ name, short, colour, colour2, logo }] } - the leagues' clubs, to find in the words */
function analyse(a0, o) {
  const a = a0 || {}, opt = o || {};
  const title = clean(a.title), summary = clean(a.summary || a.standfirst);
  const both = title + ' . ' + summary;
  const brand = a.brand || {};
  let clubs = [];
  if (a.home && a.away) clubs = [a.home, a.away];
  else {
    const seen = new Set();
    [...clubsIn(title, opt.clubs, both), ...clubsIn(summary, opt.clubs, both)].forEach(x => {
      if (!seen.has(x.club) && clubs.length < 2) { seen.add(x.club); clubs.push(x.club); }
    });
  }
  const score = a.homeScore != null && a.awayScore != null ? [a.homeScore, a.awayScore] : scoreOf(both);
  const avoid = clubs.flatMap(c => [c.name, c.short]).concat([brand.name, a.league && a.league.name]).filter(Boolean);
  let names = namesOf(title, summary, avoid);
  /* two teams the site does not hold, in a result with its score: a duel all the same, on monograms */
  if (clubs.length < 2 && score && names.length >= 2 && /\b(beat|beats|defeat\w*|edg\w+|past|over|dominat\w*|win|won|loss|lost|vs?\.?)\b/i.test(both)) {
    const named = names.slice(0, 2).map(n => ({ name: n, guess: true }));
    clubs = clubs.length ? [clubs[0], named.find(n => fold(n.name) !== fold(clubs[0].name)) || named[1]] : named;
    names = names.slice(2);
  }
  const number = numberOf(title) || numberOf(summary);
  const topic = topicOf(title, a.kind, summary);
  const quote = quoteOf(a.quote || summary) || quoteOf(title);
  /* two clubs named make a game only when the story is one: a result, a preview, a score, "v" */
  const game = !!(a.home && a.away) || !!score || ['result', 'preview'].includes(topic.key) || /\b(vs?\.?|versus|against|derby|clash)\b/i.test(title);
  if (clubs.length >= 2 && !game && !clubs[1].guess) clubs = clubs.slice(0, 1);
  const layout = clubs.length >= 2 ? 'duel' : clubs.length === 1 ? 'club' : number ? 'number' : names.length ? 'name' : 'brand';
  const lead = clubs[0] || null;
  const pal = lead && !lead.guess ? palette(lead.colour, lead.colour2, lead.name)
    : palette(brand.colour, brand.colour2, brand.name || title);
  return { layout, clubs, names, number, score, topic, quote, palette: pal, seed: hash(title || brand.name || ''), title, summary,
           brand: { name: brand.name || '', logo: brand.logo || null, colour: brand.colour || null } };
}

/* ------------------------------------------------------------------- drawing --- */
const FACE = "Archivo, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
/* a canvas font: weight, the width (Archivo is variable from 62% to 125%: extra-condensed is its 62.5%), the size */
function font(ctx, px, weight, stretch) {
  const st = stretch || 'normal';
  ctx.font = (weight || 800) + ' ' + (st === 'normal' ? '' : st + ' ') + Math.max(1, Math.round(px)) + 'px ' + FACE;
  if ('fontStretch' in ctx) { try { ctx.fontStretch = st; } catch (_) { /* the shorthand did it */ } }
}
const T = (s) => (root && root.EpinoiaI18n && typeof root.EpinoiaI18n.t === 'function' ? root.EpinoiaI18n.t(s, 'newsart') : s);

/* THE BIGGEST SIZE AT WHICH LINES FIT A BOX: lines of segments [{ text, colour }], all at one size, each line no wider
   than w and all of them no taller than h. Widths are measured once at 100 px (they scale with the size). */
function fit(ctx, lines, w, h, o) {
  const opt = o || {};
  const lead = opt.lead || 0.92, max = opt.max || 400, min = opt.min || 8;
  font(ctx, 100, opt.weight || 900, opt.stretch || 'extra-condensed');
  const tracking = opt.tracking || 0;
  const widths = lines.map(l => l.reduce((s, seg) => s + ctx.measureText(seg.text).width + tracking * 100 * seg.text.length, 0));
  const byW = Math.min(...widths.map(x => (x > 0 ? (w / x) * 100 : max)));
  const byH = h / (lines.length * lead);
  return Math.max(min, Math.min(max, byW, byH));
}
/* lines drawn: x is the left edge (or the centre, align 'center'), y the first baseline */
function lines(ctx, list, x, y, size, o) {
  const opt = o || {};
  const lead = opt.lead || 0.92;
  font(ctx, size, opt.weight || 900, opt.stretch || 'extra-condensed');
  ctx.textBaseline = 'alphabetic';
  list.forEach((l, i) => {
    const total = l.reduce((s, seg) => s + ctx.measureText(seg.text).width, 0);
    let cx = opt.align === 'center' ? x - total / 2 : opt.align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    l.forEach(seg => {
      if (opt.shadow) { ctx.save(); ctx.shadowColor = opt.shadow; ctx.shadowBlur = size * 0.18; ctx.shadowOffsetY = size * 0.04; }
      if (seg.outline) { ctx.lineWidth = Math.max(1, size * 0.035); ctx.strokeStyle = seg.colour; ctx.strokeText(seg.text, cx, y + i * size * lead); }
      else { ctx.fillStyle = seg.colour; ctx.fillText(seg.text, cx, y + i * size * lead); }
      if (opt.shadow) ctx.restore();
      cx += ctx.measureText(seg.text).width;
    });
  });
  return y + (list.length - 1) * size * lead;
}
/* words into lines no wider than w at a size; [{ text, accent }] words keep their colour */
function wrap(ctx, words, w, size, o) {
  const opt = o || {};
  font(ctx, size, opt.weight || 900, opt.stretch || 'extra-condensed');
  const out = [];
  let cur = [], curW = 0;
  const space = ctx.measureText(' ').width;
  words.forEach(wd => {
    const ww = ctx.measureText(wd.text).width;
    if (cur.length && curW + space + ww > w) { out.push(cur); cur = []; curW = 0; }
    cur.push(wd); curW += (cur.length > 1 ? space : 0) + ww;
  });
  if (cur.length) out.push(cur);
  return out;
}

function rr(ctx, x, y, w, h, r) {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + q, y); ctx.lineTo(x + w - q, y); ctx.arcTo(x + w, y, x + w, y + q, q);
  ctx.lineTo(x + w, y + h - q); ctx.arcTo(x + w, y + h, x + w - q, y + h, q);
  ctx.lineTo(x + q, y + h); ctx.arcTo(x, y + h, x, y + h - q, q);
  ctx.lineTo(x, y + q); ctx.arcTo(x, y, x + q, y, q);
  ctx.closePath();
}
/* an image drawn to cover a box, as CSS object-fit: cover does, moved by pan (-1..1 each way) and zoomed */
function cover(ctx, img, x, y, w, h, o) {
  if (!img || !img.width) return;
  const opt = o || {};
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const z = Math.max(1, opt.zoom || 1);
  const s = Math.max(w / iw, h / ih) * z;
  const dw = iw * s, dh = ih * s;
  const px = Math.max(-1, Math.min(1, opt.panX || 0)), py = Math.max(-1, Math.min(1, opt.panY || 0));
  const dx = x + (w - dw) / 2 + px * (dw - w) / 2, dy = y + (h - dh) / 2 + py * (dh - h) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (opt.blur && 'filter' in ctx) ctx.filter = 'blur(' + Math.round(opt.blur) + 'px)';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}
/* an image inside a box, whole (contain), centred */
function contain(ctx, img, x, y, w, h) {
  if (!img || !img.width) return;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(w / iw, h / ih);
  ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}
function initials(name) {
  const w = String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
}
/* A CREST ON ITS DISC: white, a soft shadow under it, a ring in the club's colour; a club with no crest is its
   initials on its colour */
function disc(ctx, cx, cy, r, img, club, o) {
  const opt = o || {};
  const colour = hex(club && club.colour) || '#20262e';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = r * 0.35; ctx.shadowOffsetY = r * 0.08;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = img ? '#ffffff' : colour; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.strokeStyle = opt.ring || '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  if (img) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2); ctx.clip();
    contain(ctx, img, cx - r * 0.66, cy - r * 0.66, r * 1.32, r * 1.32);
    ctx.restore();
  } else {
    const txt = initials(club && club.name);
    font(ctx, r * 0.78, 900, 'condensed');
    ctx.fillStyle = lum(colour) > 0.55 ? '#111418' : '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, cy + r * 0.04);
    ctx.textBaseline = 'alphabetic';
  }
}
/* a pill of words: { x, y (top), size, fill, ink, align } -> its width */
function pill(ctx, text, x, y, size, fill, ink, align) {
  font(ctx, size, 800, 'semi-condensed');
  const t = String(text || '').toUpperCase();
  const tw = ctx.measureText(t).width + size * 0.08 * t.length;
  const w = tw + size * 1.3, h = size * 1.75;
  const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = fill; rr(ctx, lx, y, w, h, size * 0.28); ctx.fill();
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let cx = lx + size * 0.65;
  for (const ch of t) { ctx.fillText(ch, cx, y + h / 2 + size * 0.04); cx += ctx.measureText(ch).width + size * 0.08; }
  ctx.textBaseline = 'alphabetic';
  return w;
}

/* A SEEDED RANDOM, so a story's cover is the same every time it is drawn */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* THE GROUND: the field deep, lit from one side, the crowd's lights out of focus, a halftone in a corner and the
   edges darkened - what a photograph would be behind the subject, made of the subject's colours */
function ground(ctx, W, H, pal, seed, o) {
  const opt = o || {};
  const r = rng(seed || 1);
  const g = ctx.createLinearGradient(0, H, W, 0);
  g.addColorStop(0, pal.deep); g.addColorStop(0.55, mix(pal.deep, pal.mid, 0.55)); g.addColorStop(1, pal.mid);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (opt.lights !== false) {
    const n = 16, m = Math.max(W, H);
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H * 0.75, rad = m * (0.03 + r() * 0.09);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const c = i % 3 === 0 ? pal.accent : '#ffffff';
      glow.addColorStop(0, rgba(c, 0.10 + r() * 0.1)); glow.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = glow; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  /* the light from the subject's side */
  const lx = opt.lightX != null ? opt.lightX : W * 0.72, ly = H * 0.38;
  const light = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.62);
  light.addColorStop(0, rgba(pal.base, 0.55)); light.addColorStop(1, rgba(pal.base, 0));
  ctx.fillStyle = light; ctx.fillRect(0, 0, W, H);
  /* the halftone, fading out of the bottom-left corner */
  if (opt.dots !== false) {
    const step = Math.max(6, Math.min(W, H) / 26);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let x = step / 2; x < W * 0.55; x += step) {
      for (let y = H * 0.35 + step / 2; y < H; y += step) {
        const d = Math.hypot(x / W, (H - y) / H);
        const rad = step * 0.32 * Math.max(0, 1 - d / 0.62);
        if (rad < 0.4) continue;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}
/* the desk's slash: a band of the accent across the field, and a thin line beside it */
function slash(ctx, W, H, x, colour, o) {
  const opt = o || {};
  const lean = H * (opt.lean || 0.32), band = opt.band || W * 0.06;
  ctx.save();
  ctx.globalAlpha = opt.alpha || 0.16;
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.moveTo(x + lean, 0); ctx.lineTo(x + lean + band, 0); ctx.lineTo(x + band, H); ctx.lineTo(x, H); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = Math.min(1, (opt.alpha || 0.16) * 3.2);
  const off = band * 1.5, thin = Math.max(1.5, band * 0.08);
  ctx.beginPath(); ctx.moveTo(x + lean + off, 0); ctx.lineTo(x + lean + off + thin, 0); ctx.lineTo(x + off + thin, H); ctx.lineTo(x + off, H); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* A WORD AS TEXTURE: the subject's name in outline, enormous and faint, three rows across the field */
function ghost(ctx, W, H, word, pal) {
  const w = String(word || '').toUpperCase();
  if (!w) return;
  ctx.save();
  const s = H * 0.5;
  font(ctx, s, 900, 'extra-condensed');
  ctx.globalAlpha = 0.07; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, s * 0.012);
  const tw = ctx.measureText(w + '  ').width;
  [0.42, 0.9, 1.38].forEach((k, i) => {
    for (let x = -((i * tw) / 3) % tw - tw; x < W; x += tw) ctx.strokeText(w, x, H * k);
  });
  ctx.restore();
}
/* the subject's name as two lines: the given names over the family name, or one line when it is one word */
function nameLines(n) {
  const w = clean(n).split(' ');
  if (w.length === 1) return [w[0].toUpperCase()];
  const sfx = /^(jr|sr|ii|iii|iv)\.?$/i.test(w[w.length - 1]);
  const lastLen = sfx ? 2 : 1;
  return [w.slice(0, w.length - lastLen).join(' ').toUpperCase(), w.slice(w.length - lastLen).join(' ').toUpperCase()];
}
/* a club's name for the big type: the words after its sponsor (B. Braun Sheffield Sharks -> SHEFFIELD SHARKS) */
function clubWords(c) {
  const w = clean(c && c.name).replace(/\b(basketball|basket|bc|bk|kk|cb)\b\.?/gi, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const keep = w.length > 3 ? w.slice(-2) : w.length === 3 && w[0].length <= 3 ? w.slice(1) : w;
  return keep.length ? keep : [String((c && c.name) || '')];
}

/* ONE COVER. images: { clubs: [img|null, img|null], brand: img|null }; opts: { chrome (the brand and the kicker
   drawn too, for a cover standing on its own), safeTop (a share of the height the page lays its own badges over) } */
function drawArt(ctx, W, H, f, images, o) {
  const opt = o || {};
  const im = images || {};
  const pal = f.palette;
  const r = W / H, wide = r >= 1.2;
  const safeTop = H * (opt.safeTop != null ? opt.safeTop : 0.2);
  const pad = Math.min(W, H) * 0.075;
  ctx.save();
  if (f.layout === 'duel') {
    const [a, b] = f.clubs;
    const pa = a.guess ? palette(null, null, a.name) : palette(a.colour, a.colour2, a.name);
    const pb = b.guess ? palette(null, null, b.name) : palette(b.colour, b.colour2, b.name);
    ground(ctx, W, H, pa, f.seed, { lightX: W * 0.25, dots: false });
    /* the other club's half, cut on the slant */
    ctx.save();
    const cut = W * 0.5, lean = H * 0.22;
    ctx.beginPath(); ctx.moveTo(cut + lean, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(cut - lean, H); ctx.closePath(); ctx.clip();
    ground(ctx, W, H, pb, f.seed + 7, { lightX: W * 0.75 });
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, W * 0.008);
    ctx.beginPath(); ctx.moveTo(cut + lean, 0); ctx.lineTo(cut - lean, H); ctx.stroke();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = Math.max(1, W * 0.003);
    const o2 = W * 0.016;
    ctx.beginPath(); ctx.moveTo(cut + lean + o2, 0); ctx.lineTo(cut - lean + o2, H); ctx.stroke();
    ctx.restore();
    /* A FINISHED GAME (a match report's cover, opts.final): the league's mark at the top, FINAL under the score, the
       loser's number dimmed, and a strap only for a number worth saying (the topic would only say FINAL again) */
    const final = !!(opt.final && f.score);
    let top0 = safeTop;
    if (opt.leagueMark && im.brand) {
      const lr = Math.max(9, Math.min(H * 0.085, W * 0.05));
      disc(ctx, W / 2, pad * 0.3 + lr, lr, im.brand, { name: f.brand.name });
      top0 = Math.max(top0, pad * 0.3 + lr * 2 + pad * 0.15);
    }
    const strapS = Math.max(9, H * 0.036), strapH = strapS * 1.75;
    const avail = H - top0 - pad * 0.7 - strapH * 1.5;
    const R = Math.min(avail * 0.34, W * 0.15);
    const cy = top0 + R * 1.04;
    const xa = W * 0.2, xb = W - xa;
    disc(ctx, xa, cy, R, im.clubs && im.clubs[0], a);
    disc(ctx, xb, cy, R, im.clubs && im.clubs[1], b);
    /* their names under the discs, each inside its own half, and the score (or the v) between */
    const nameW = W * 0.3;
    let nameS = Infinity;
    const sizeOf = n => fit(ctx, [[{ text: n, colour: '#fff' }]], nameW, R * 0.5, { stretch: 'condensed', weight: 800, max: R * 0.5, min: 1 });
    /* a name too long for its half at a readable size gives way to the club's own last word (JACKJUMPERS) */
    const names = [a, b].map(c => {
      const w = clubWords(c), full = w.join(' ').toUpperCase();
      return w.length > 1 && sizeOf(full) < R * 0.3 ? w[w.length - 1].toUpperCase() : full;
    });
    names.forEach(n => { nameS = Math.min(nameS, sizeOf(n)); });
    /* too small to read on a small card: the clubs' three letters instead, as the result plate prints them */
    if (nameS < 10) {
      const code = c => (c.short && /^[\p{L}\p{N}]{2,5}$/u.test(c.short) ? c.short : clubWords(c).slice(-1)[0].replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3)).toUpperCase();
      names.splice(0, 2, code(a), code(b));
      nameS = Infinity;
      names.forEach(n => { nameS = Math.min(nameS, sizeOf(n)); });
    }
    [[names[0], xa], [names[1], xb]].forEach(([n, x]) => {
      lines(ctx, [[{ text: n, colour: '#ffffff' }]], x, cy + R + nameS * 1.25, nameS, { align: 'center', stretch: 'condensed', weight: 800, shadow: 'rgba(0,0,0,0.5)' });
    });
    const mid = f.score ? f.score[0] + '–' + f.score[1] : 'V';
    const sz = fit(ctx, [[{ text: mid, colour: '#fff' }]], W * (f.score ? 0.27 : 0.14), R * (f.score ? 0.95 : 1.25), { max: R * 1.25 });
    const dim = 'rgba(255,255,255,0.55)';
    const lose = final && +f.score[0] !== +f.score[1] ? (+f.score[0] < +f.score[1] ? 0 : 1) : -1;
    const segs = f.score ? [{ text: String(f.score[0]), colour: lose === 0 ? dim : '#ffffff' }, { text: '–', colour: final ? dim : '#ffffff' },
                            { text: String(f.score[1]), colour: lose === 1 ? dim : '#ffffff' }] : [{ text: mid, colour: '#ffffff' }];
    if (final) {
      /* THE BOARD: the score on a dark panel of its own, the divider passing behind it, FINAL under the numbers */
      font(ctx, sz, 900, 'extra-condensed');
      const tw = segs.reduce((w, x) => w + ctx.measureText(x.text).width, 0);
      const fs = Math.max(8, Math.min(strapS * 0.95, sz * 0.2));
      const bw = tw + sz * 0.5, bh = sz * 0.95 + fs * 2.2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = sz * 0.25;
      ctx.fillStyle = 'rgba(8,10,14,0.86)';
      rr(ctx, W / 2 - bw / 2, cy - sz * 0.6, bw, bh, sz * 0.12); ctx.fill();
      ctx.restore();
      lines(ctx, [segs], W / 2, cy + sz * 0.3, sz, { align: 'center' });
      pill(ctx, T('FINAL'), W / 2, cy + sz * 0.3 + fs * 0.45, fs, '#ffffff', '#0b0d10', 'center');
    } else {
      lines(ctx, [segs], W / 2, cy + sz * 0.36, sz, { align: 'center', shadow: 'rgba(0,0,0,0.55)' });
    }
    const strap = f.number ? f.number.value + ' ' + f.number.label : final ? null : T(f.topic.words.join(' '));
    if (strap && opt.strap !== false) pill(ctx, strap, W / 2, H - pad * 0.7 - strapH, strapS, pal.accent, '#0b0d10', 'center');
  } else if (f.layout === 'club') {
    const c = f.clubs[0];
    ground(ctx, W, H, pal, f.seed, { lightX: wide ? W * 0.72 : W * 0.5 });
    slash(ctx, W, H, wide ? W * 0.52 : W * 0.6, pal.accent, { alpha: 0.12, band: W * 0.08 });
    const R = wide ? Math.min((H - safeTop) * 0.42, W * 0.2) : Math.min(W * 0.26, (H - safeTop) * 0.28);
    const cx = wide ? W * 0.74 : W * 0.5, cy = wide ? safeTop + (H - safeTop) * 0.5 : safeTop + R * 1.05;
    /* a halo of rings behind the crest */
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = Math.max(1, R * 0.03);
    [1.28, 1.56, 1.86].forEach(k => { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); });
    ctx.restore();
    /* the crest again, enormous and faint, run off the left edge behind the words (a signing graphic's crest) */
    if (im.clubs && im.clubs[0]) {
      ctx.save(); ctx.globalAlpha = 0.11;
      const big = Math.max(W, H) * (wide ? 0.95 : 0.9);
      contain(ctx, im.clubs[0], wide ? -big * 0.28 : W * 0.5 - big / 2, wide ? H * 0.5 - big / 2 : H - big * 0.62, big, big);
      ctx.restore();
    }
    disc(ctx, cx, cy, R, im.clubs && im.clubs[0], c);
    const words = clubWords(c).map(x => x.toUpperCase());
    const ls = words.length >= 2 ? [[{ text: words.slice(0, -1).join(' '), colour: '#ffffff' }], [{ text: words[words.length - 1], colour: pal.accent }]]
                                 : [[{ text: words[0], colour: '#ffffff' }]];
    const boxX = pad, boxW = wide ? Math.max(W * 0.3, cx - R * 1.12 - pad) : W - pad * 2;
    const top = wide ? safeTop : cy + R * 1.25;
    const boxH = (H - pad - top) * (wide ? 0.62 : 0.6);
    const s = fit(ctx, ls, boxW, boxH, { max: H * 0.3 });
    const y0 = wide ? top + (H - pad - top - ls.length * s * 0.92) * 0.42 + s * 0.8 : top + s * 0.8;
    const yEnd = lines(ctx, ls, boxX, y0, s, { shadow: 'rgba(0,0,0,0.35)' });
    const strap = f.number ? f.number.value + ' ' + f.number.label : T(f.topic.words.join(' '));
    if (yEnd + s * 0.25 + H * 0.07 < H - pad * 0.4) pill(ctx, strap, boxX, yEnd + s * 0.3, Math.max(9, H * 0.034), pal.accent, '#0b0d10');
  } else if (f.layout === 'number') {
    ground(ctx, W, H, pal, f.seed);
    slash(ctx, W, H, W * 0.6, pal.accent, { alpha: 0.1 });
    const n = f.number;
    const who = f.names[0] ? f.names[0].toUpperCase() : null;
    const boxW = wide ? W * 0.62 : W - pad * 2;
    const ns = fit(ctx, [[{ text: n.value, colour: pal.accent }]], boxW * (n.value.length > 3 ? 1 : 0.62), (H - safeTop - pad) * 0.64, { max: H * 0.62 });
    const labelS = fit(ctx, [[{ text: n.label, colour: '#fff' }]], boxW, ns * 0.22, { stretch: 'condensed', max: ns * 0.2 });
    const whoS = who ? fit(ctx, [[{ text: who, colour: '#fff' }]], boxW, ns * 0.2, { stretch: 'condensed', weight: 800, max: ns * 0.17 }) : 0;
    const blockH = (who ? whoS * 1.15 : 0) + ns * 0.8 + labelS * 1.2;
    let y = safeTop + (H - safeTop - pad - blockH) * 0.5;
    if (who) { lines(ctx, [[{ text: who, colour: '#ffffff' }]], pad, y + whoS * 0.8, whoS, { stretch: 'condensed', weight: 800 }); y += whoS * 1.15; }
    lines(ctx, [[{ text: n.value, colour: pal.accent }]], pad - ns * 0.03, y + ns * 0.78, ns, { shadow: 'rgba(0,0,0,0.4)' });
    y += ns * 0.8;
    lines(ctx, [[{ text: n.label, colour: '#ffffff' }]], pad, y + labelS * 1.0, labelS, { stretch: 'condensed' });
    if (wide && im.brand) disc(ctx, W * 0.82, safeTop + (H - safeTop) * 0.48, Math.min(H * 0.2, W * 0.11), im.brand, { name: f.brand.name, colour: f.brand.colour });
  } else if (f.layout === 'name') {
    ground(ctx, W, H, pal, f.seed);
    slash(ctx, W, H, W * 0.64, pal.accent, { alpha: 0.12 });
    const nl = nameLines(f.names[0]);
    ghost(ctx, W, H, nl[nl.length - 1], pal);
    const ls = nl.length === 2 ? [[{ text: nl[0], colour: '#ffffff' }], [{ text: nl[1], colour: pal.accent }]] : [[{ text: nl[0], colour: pal.accent }]];
    /* the given names smaller, the family name as big as it goes */
    const boxW = wide ? W * (im.brand ? 0.66 : 0.86) : W - pad * 2;
    const avail = H - safeTop - pad;
    const big = fit(ctx, [ls[ls.length - 1]], boxW, avail * 0.56, { max: H * 0.5 });
    const small = ls.length === 2 ? fit(ctx, [ls[0]], boxW, big * 0.42, { stretch: 'condensed', weight: 800, max: big * 0.4 }) : 0;
    const strapS = Math.max(9, H * 0.034);
    const blockH = (small ? small * 1.05 : 0) + big * 0.86 + strapS * 2.6;
    let y = safeTop + (avail - blockH) * 0.5;
    if (small) { lines(ctx, [ls[0]], pad, y + small * 0.8, small, { stretch: 'condensed', weight: 800 }); y += small * 1.05; }
    lines(ctx, [ls[ls.length - 1]], pad - big * 0.02, y + big * 0.78, big, { shadow: 'rgba(0,0,0,0.4)' });
    y += big * 0.86;
    pill(ctx, T(f.topic.words.join(' ')), pad, y + strapS * 0.5, strapS, pal.accent, '#0b0d10');
    if (wide && im.brand) disc(ctx, W * 0.84, safeTop + avail * 0.5, Math.min(avail * 0.3, W * 0.1), im.brand, { name: f.brand.name, colour: f.brand.colour });
  } else {
    /* NOTHING TO NAME: the brand's mark on its disc and what kind of news it is, in the big type */
    ground(ctx, W, H, pal, f.seed);
    slash(ctx, W, H, W * 0.56, pal.accent, { alpha: 0.12 });
    const words = f.topic.words.map(T);
    const ls = [[{ text: words[0], colour: '#ffffff' }], [{ text: words[1], colour: pal.accent }]];
    const R = wide ? Math.min((H - safeTop) * 0.36, W * 0.17) : Math.min(W * 0.22, (H - safeTop) * 0.24);
    const cx = wide ? W * 0.76 : W * 0.5, cy = wide ? safeTop + (H - safeTop) * 0.5 : safeTop + R * 1.1;
    disc(ctx, cx, cy, R, im.brand, { name: f.brand.name, colour: f.brand.colour || pal.base });
    const top = wide ? safeTop : cy + R * 1.3;
    const boxW = wide ? W * 0.54 : W - pad * 2;
    const s = fit(ctx, ls, boxW, (H - pad - top) * 0.7, { max: H * 0.3 });
    const y0 = top + (H - pad - top - 2 * s * 0.92) * (wide ? 0.45 : 0.2) + s * 0.8;
    lines(ctx, ls, pad, y0, s, { shadow: 'rgba(0,0,0,0.35)' });
  }
  /* A COVER ON ITS OWN carries its brand and what it is, top left */
  if (opt.chrome) {
    const ks = Math.max(10, H * 0.034);
    let x = pad;
    if (im.brand) { disc(ctx, x + ks * 1.2, pad + ks * 1.2, ks * 1.2, im.brand, { name: f.brand.name }); x += ks * 3; }
    if (f.brand.name) pill(ctx, f.brand.name, x, pad + ks * 0.32, ks, 'rgba(0,0,0,0.55)', '#ffffff');
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- loading --- */
const IMGS = new Map();
/* an image, once a page; cors: asked for with CORS (a picture to be saved must be), and null when it will not load */
function load(url, cors) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  const key = (cors ? 'c|' : 'p|') + url;
  if (!IMGS.has(key)) {
    IMGS.set(key, new Promise(res => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    }));
  }
  return IMGS.get(key);
}
/* a club's crest by the site's own rule (config.js: the crests bucket's copy of another site's), the original when
   that copy is not there yet */
function crestUrl(path, px) {
  if (!path) return null;
  if (typeof root.epinoiaLogoUrl === 'function') return root.epinoiaLogoUrl(path, px || 256);
  return /^https:\/\//.test(path) ? path : null;
}
async function crest(path, cors) {
  const u = crestUrl(path);
  const img = await load(u, cors);
  if (img || !u || !/^https:\/\//.test(String(path))) return img;
  return u === path ? null : load(path, cors);
}

/* A LEAGUE'S CLUBS, by slug: one read for every slug a page asks about, kept for the page (and an hour in this tab) */
const CLUBS = new Map();
function clubsFor(slugs) {
  const want = [...new Set((slugs || []).filter(s => typeof s === 'string' && /^[a-z0-9-]+$/.test(s)))];
  if (!want.length) return Promise.resolve([]);
  const key = want.sort().join(',');
  if (CLUBS.has(key)) return CLUBS.get(key);
  const p = (async () => {
    const SK = 'epinoia_na_clubs:' + key;
    try {
      const kept = JSON.parse(sessionStorage.getItem(SK) || 'null');
      if (kept && Date.now() - kept.at < 3600e3) return kept.rows;
    } catch (_) { /* read it */ }
    const C = root.EPINOIA_CONFIG;
    if (!C || !C.supabaseUrl || typeof fetch !== 'function') return [];
    const r = await fetch(C.supabaseUrl + '/rest/v1/teams?select=name,short_name,colour,colour_2,logo_path,leagues!inner(slug)&leagues.slug=in.(' +
      want.join(',') + ')&limit=1000', { headers: { apikey: C.supabaseAnonKey, Accept: 'application/json' } });
    if (!r.ok) return [];
    const rows = (await r.json()).map(t => ({ name: t.name, short: t.short_name, colour: t.colour, colour2: t.colour_2, logo: t.logo_path }));
    try { sessionStorage.setItem(SK, JSON.stringify({ at: Date.now(), rows })); } catch (_) { /* fine */ }
    return rows;
  })().catch(() => []);
  CLUBS.set(key, p);
  return p;
}

/* fonts ready before the first cover: the canvas does not wait for them by itself */
let fontsReady = null;
function fonts() {
  if (!fontsReady) {
    const d = root.document;
    fontsReady = d && d.fonts && typeof d.fonts.load === 'function'
      ? Promise.all(['900 extra-condensed 64px Archivo', '800 condensed 64px Archivo', '800 semi-condensed 64px Archivo']
          .map(f => d.fonts.load(f).catch(() => null))).then(() => null)
      : Promise.resolve(null);
  }
  return fontsReady;
}

/* A COVER ON THE PAGE. host: the plate (position: relative); item: { title, summary, kind, brand, leagues: [slug],
   home, away, homeScore, awayScore }; opts: { safeTop, after (the plate's child it goes over) or before (a selector
   for the child it goes under), final (a finished game's cover), leagueMark (the brand's mark at the top) }. The canvas is laid over whatever the plate already shows,
   and only once it is drawn: a story whose cover cannot be drawn keeps its print. */
function mount(host, item, o) {
  const d = root.document;
  if (!host || !d) return null;
  const opt = o || {};
  const cv = d.createElement('canvas');
  cv.className = 'na-art';
  cv.setAttribute('aria-hidden', 'true');
  let facts = null, images = null, last = '';
  const paint = () => {
    if (!facts) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (w < 40 || h < 30) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const k = Math.round(w * dpr) + 'x' + Math.round(h * dpr);
    if (k === last) return;
    last = k;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawArt(ctx, w, h, facts, images, opt);
    if (!cv.parentNode) {
      const after = opt.after && opt.after.parentNode === host ? opt.after : null;
      const before = typeof opt.before === 'string' ? host.querySelector(':scope > ' + opt.before) : null;
      host.insertBefore(cv, before || (after ? after.nextSibling : host.firstChild));
      host.classList.add('has-art');
    }
  };
  const go = async () => {
    try {
      const clubs = item.home && item.away ? [] : await clubsFor(item.leagues || []);
      facts = analyse(item, { clubs });
      const crests = await Promise.all(facts.clubs.map(c => (c && !c.guess && c.logo ? crest(c.logo, false) : null)));
      const brand = item.brand && item.brand.logo ? await load(item.brand.logo, false) : null;
      images = { clubs: crests, brand };
      await fonts();
      paint();
      if (typeof ResizeObserver === 'function') {
        let t = 0;
        new ResizeObserver(() => { clearTimeout(t); t = setTimeout(paint, 120); }).observe(host);
      }
    } catch (_) { /* the plate's own print stays */ }
  };
  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px' });
    io.observe(host);
  } else go();
  return cv;
}

return { analyse, drawArt, mount, clubsFor, palette, font, fit, lines, wrap, cover, contain, disc, pill, ground, slash, rr, load, crest,
         fonts, nameLines, clubWords, initials, hex, lum, mix, rgba, numberOf, scoreOf, topicOf, quoteOf, namesOf, clubsIn, runsIn, tintHex, T };
}));
