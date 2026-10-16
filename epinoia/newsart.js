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
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').toLowerCase();
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
const GENERIC = /^(u-?\d{1,2}s?|under|men|women|mens|womens|men's|women's|boys|girls|academy|college|school|club|basketball|ii|iii|senior|seniors|junior|juniors|team|reserves?|-|–|—)$/i;
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
    /* its name, and every spelling a feed gives it ("Barking Abbey U19 Men" is Barking Abbey School) */
    const w = words(c), keys = [clean(c.name)].concat((c.aliases || []).map(clean));
    /* the tails of its name, but never one that is only an age, a sex or a kind of side ("U19 Men", "Academy U19 Men"):
       every academy's name ends that way */
    for (let i = 1; i <= w.length - 2; i++) {
      const tail = w.slice(i);
      if (!tail.every(x => GENERIC.test(x))) keys.push(tail.join(' '));
    }
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
/* A FEED'S SPELLINGS OF THE CLUBS put back as their own names (newscard.js canonText, for the cover's own reading) */
function canonWith(text, clubs) {
  let s = String(text || '');
  const pairs = [];
  (clubs || []).forEach(c => (c.aliases || []).forEach(a => {
    const al = clean(a);
    if (al && al !== c.name && al.length >= 4 && !String(c.name).toLowerCase().includes(al.toLowerCase())) pairs.push([al, c.name]);
  }));
  pairs.sort((x, y) => y[0].length - x[0].length).forEach(([al, name]) => {
    const re = new RegExp('(^|[^\\p{L}\\p{N}])' + esc(al).replace(/[-–—]/g, '[-–—]').replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'giu');
    s = s.replace(re, (m0, pre) => pre + name);
  });
  return s;
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
const LIST_NOUNS = 'predictions|takeaways|things|reasons|questions|storylines|thoughts|observations|lessons|keys|players|moments|stats|names|bold takes|takes';
function numberOf(text) {
  const t = clean(text);
  let m;
  /* A LIST PIECE opens on its count: "5 super-early predictions" is 5 PREDICTIONS */
  if ((m = new RegExp('^(\\d{1,2})\\s+(?:[\\p{L}’\'-]+\\s+){0,3}?(' + LIST_NOUNS + ')\\b', 'iu').exec(t))) return { value: m[1], label: m[2].toUpperCase(), list: true, phrase: m[0].slice(m[1].length).trim() };
  if ((m = /\b(\d{1,2})[–—-](\d{1,2})\s+(run|parcial)\b/i.exec(t))) return { value: m[1] + '–' + m[2], label: 'RUN' };
  if ((m = /\bfrom\s+(\d{1,2})\s+(?:points\s+)?down\b/i.exec(t))) return { value: m[1], label: 'POINT COMEBACK' };
  if ((m = /\b(\d{1,2})[-\s]point\s+(game|night|performance|haul|effort|outing|comeback|win|victory|deficit)\b/i.exec(t))) {
    return /comeback|deficit/i.test(m[2]) ? { value: m[1], label: 'POINT COMEBACK' } : { value: m[1], label: 'POINTS', player: true, at: m.index };
  }
  if ((m = /\b(\d{1,3})\s+(points|pts|rebounds|assists|steals|blocks|threes|three-pointers|triples|puntos|punti|rebotes|rimbalzi)\b/i.exec(t))) {
    if (+m[1] >= 5) return { value: m[1], label: STATW[m[2].toLowerCase()], player: true, at: m.index };
  }
  if ((m = /\b(\w+)\s+(threes|three-pointers|triples)\b/i.exec(t)) && WORDN[m[1].toLowerCase()] >= 5) return { value: String(WORDN[m[1].toLowerCase()]), label: 'THREES', player: true, at: m.index };
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
  ['predictions', /\b(predictions?|predict\w*|forecasts?|bold takes?|pronósticos?|pronostici|prédictions?)\b/i, ['THE', 'PREDICTIONS']],
  ['rankings', /\b(power rankings?|rankings?|ranked|ranking every|tier list)\b/i, ['POWER', 'RANKINGS']],
  ['breakdown', /\b(breakdown|deep dive|film study|tactical|tactics|x'?s and o'?s|analysis|análisis|analisi)\b/i, ['THE', 'BREAKDOWN']],
  ['review', /\b(review|report card|grades?|graded|takeaways|lessons|what we learned)\b/i, ['THE', 'REVIEW']],
  ['preview', /\b(preview|previa|anteprima|avant[- ]match|look ahead|ahead of)\b/i, ['GAME', 'PREVIEW']],
  ['debut', /\b(debut|début|esordio)\b/i, ['THE', 'DEBUT']],
  ['award', /\b(mvp|award|honou?rs?|all-star|player of the|named to|trophy|premio)\b/i, ['AWARD', 'NEWS']],
  ['result', /\b(beat|beats|defeat\w*|edg\w+|cruis\w+ past|dominat\w*|rout\w*|wins? over|win at|victory|come from|comeback|stun\w*|upset)\b/i, ['FINAL', 'SCORE']],
  ['quote', /\b(says?|said|reveals?|believes?|insists?|admits?|explains?|speaks|interview|entrevista|intervista|dichiara|déclare)\b/i, ['IN THEIR', 'WORDS']],
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
  const title = canonWith(clean(a.title), opt.clubs), summary = canonWith(clean(a.summary || a.standfirst), opt.clubs);
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
  /* IS IT A GAME? THE HEADLINE SAYS SO, not a score in the lines under it: "5 super-early predictions for the Sheffield
     Sharks" over a summary that mentions their 98-76 opener is about the Sharks, not that game (Louie, 2026-10-16). A
     game: a match report's own clubs, a score in the headline, a result or a preview in it, "v", or two clubs named in it */
  const scoreT = scoreOf(title);
  let score = a.homeScore != null && a.awayScore != null ? [a.homeScore, a.awayScore] : (scoreT || scoreOf(summary));
  const titleTopic = topicOf(title, a.kind);
  const resultWords = /\b(beat|beats|defeat\w*|edg\w+|past|over|dominat\w*|wins?|won|loss|lost|stun\w*|rout\w*|outlast\w*|vs?\.?|versus)\b/i;
  const game = !!(a.home && a.away) || !!scoreT || ['result', 'preview'].includes(titleTopic.key)
    || /\b(vs?\.?|versus|against|derby|clash)\b/i.test(title) || clubsIn(title, opt.clubs, both).length >= 2;
  const avoid = clubs.flatMap(c => [c.name, c.short]).concat([brand.name, a.league && a.league.name]).filter(Boolean);
  let names = namesOf(title, summary, avoid);
  /* two teams the site does not hold, in a result with its score: a duel all the same, on monograms */
  if (game && clubs.length < 2 && score && names.length >= 2 && resultWords.test(title)) {
    const named = names.slice(0, 2).map(n => ({ name: n, guess: true }));
    clubs = clubs.length ? [clubs[0], named.find(n => fold(n.name) !== fold(clubs[0].name)) || named[1]] : named;
    names = names.slice(2);
  }
  const inTitle = numberOf(title);
  const number = inTitle || numberOf(summary);
  /* A PLAYER'S NUMBER IS NOTHING WITHOUT THE PLAYER (Louie, 2026-10-16: "27 points" on its own "is very vague"): whose it
     is, from the sentence that says it - and a points haul nobody is named for is not put on a cover */
  if (number && number.player) {
    const text = inTitle ? title : summary;
    const start = Math.max(text.lastIndexOf('. ', number.at), text.lastIndexOf('! ', number.at), text.lastIndexOf('? ', number.at)) + 1;
    const ends = ['. ', '! ', '? '].map(x => text.indexOf(x, number.at)).filter(i => i >= 0);
    const sentence = text.slice(start, ends.length ? Math.min(...ends) + 1 : text.length);
    const bad = avoid.map(fold).filter(Boolean);
    /* the name nearest before the number ("as Andres Feliz hits eight threes"), else the first after it */
    const here = number.at - start;
    const named = runsIn(sentence).filter(n => !bad.some(b => fold(n).includes(b) || b.includes(fold(n))))
      .map(n => ({ n, i: sentence.indexOf(n) })).filter(x => x.i >= 0);
    const before = named.filter(x => x.i < here).pop();
    number.who = (before || named.find(x => x.i > here) || {}).n || null;
  }
  const topic = topicOf(title, a.kind, summary);
  const quote = quoteOf(a.quote || summary) || quoteOf(title);
  /* not a game: the club the headline is about (never a guessed one), and no score on it */
  if (!game) {
    score = null;
    clubs = clubs.filter(c => !c.guess).slice(0, 1);
  }
  /* WHO LEADS THE COVER: what the headline names first. A person before a club ("Caroline Lau: The Heartbeat of
     Manchester Basketball" is hers, in Manchester's colours with its crest beside her); a club before a person; a
     headline that opens on a count is the count's ("5 super-early predictions for the Sheffield Sharks"); a player's
     number in the words is that player's cover (Louie, 2026-10-16: "the auto layout logic can do with a lot of work") */
  const ctxClub = clubs.find(c => !c.guess) || null;
  const firstClub = clubsIn(title, opt.clubs, both)[0];
  const clubAt = firstClub ? firstClub.at : Infinity;
  /* a name in the headline leads only when the lines under it name the person too ("Go Bigger" is no one) */
  const person = names.find(nm => at(title, nm) >= 0 && (!summary || at(summary, nm) >= 0)) || null;
  const personAt = person ? at(title, person) : Infinity;
  const lift = nm => { if (nm) names = [nm].concat(names.filter(x => fold(x) !== fold(nm))); };
  let layout;
  if (clubs.length >= 2) layout = 'duel';
  else if (inTitle && inTitle.list) layout = 'number';
  else if (person && personAt < clubAt) { layout = 'name'; lift(person); }
  else if (clubs.length) layout = 'club';
  else if (number && number.player && number.who) { layout = 'name'; lift(number.who); }
  else if (number && !number.player) layout = 'number';
  else if (names.length) layout = 'name';
  else layout = 'brand';
  if (layout === 'name' || layout === 'number') clubs = ctxClub ? [ctxClub] : [];
  const lead = layout === 'duel' || layout === 'club' ? clubs[0] : ctxClub;
  const pal = lead && !lead.guess ? palette(lead.colour, lead.colour2, lead.name)
    : palette(brand.colour, brand.colour2, brand.name || title);
  return { layout, clubs, club: layout === 'name' || layout === 'number' ? ctxClub : null, names, number, score, topic, quote, palette: pal,
           seed: hash(title || brand.name || ''), title, summary,
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
    const txt = monogram(club);
    font(ctx, r * 0.78, 900, 'condensed');
    ctx.fillStyle = lum(colour) > 0.55 ? '#111418' : '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, cy + r * 0.04);
    ctx.textBaseline = 'alphabetic';
  }
}
/* a pill of words: { x, y (top), size, fill, ink, align } -> its width */
function pill(ctx, text, x, y, size0, fill, ink, align, maxW) {
  const t = String(text || '').toUpperCase();
  let size = size0;
  if (maxW) {
    font(ctx, size, 800, 'semi-condensed');
    const w0 = ctx.measureText(t).width + size * 0.08 * t.length + size * 1.3;
    if (w0 > maxW) size = Math.max(7, size * maxW / w0);
  }
  font(ctx, size, 800, 'semi-condensed');
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
    ctx.beginPath();
    for (let x = step / 2; x < W * 0.55; x += step) {
      for (let y = H * 0.35 + step / 2; y < H; y += step) {
        const d = Math.hypot(x / W, (H - y) / H);
        const rad = step * 0.32 * Math.max(0, 1 - d / 0.62);
        if (rad < 0.4) continue;
        ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2);
      }
    }
    ctx.fill();
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
/* THE STRAP A NUMBER MAKES: a club's (11 POINT COMEBACK, 11–0 RUN) as it is; a player's with the player's family name
   (POMES 27 PTS), or none at all when the words never say whose it is */
const SHORT = { POINTS: 'PTS', REBOUNDS: 'REB', ASSISTS: 'AST', STEALS: 'STL', BLOCKS: 'BLK' };
function strapOf(f) {
  const n = f && f.number;
  if (!n) return null;
  if (!n.player) return n.value + ' ' + n.label;
  if (!n.who) return null;
  const nl = nameLines(n.who);
  return nl[nl.length - 1] + ' ' + n.value + ' ' + (SHORT[n.label] || n.label);
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
  let w = clean(c && c.name).replace(/\b(basketball|basket|bc|bk|kk|cb)\b\.?/gi, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  /* what is only an age, a sex or a kind of side comes off ("Barking Abbey School" is BARKING ABBEY on a cover, "UTC
     Sheffield Olympic Legacy Park U19 Men" not U19 MEN) unless nothing else is left */
  const core = w.filter(x => !GENERIC.test(x));
  if (core.length) w = core;
  /* a long name is the club's own short name, where that is a word of its name (UTC); else the words after a sponsor */
  const sh = shortWord(c);
  const keep = w.length > 3 ? (sh ? [sh] : w.slice(-2)) : w.length === 3 && w[0].length <= 3 && !/^(of|de|la|el)$/i.test(w[1]) ? w.slice(1) : w;
  return keep.length ? keep : [String((c && c.name) || '')];
}
/* the club's short name when it is one of the words of its name (Barking, UTC, Manchester): the name a small cover
   gives it */
function shortWord(c) {
  const sh = clean(c && c.short);
  if (!sh || /\s/.test(sh)) return null;
  const words = clean(c && c.name).split(' ').map(x => x.toLowerCase());
  return words.includes(sh.toLowerCase()) ? sh : null;
}
/* the club's letters on a disc with no crest: its short name when that is a short word of its own (UTC), else the
   first and last letters of its name's own words (never of "U19 Men") */
function monogram(c) {
  const sh = shortWord(c);
  if (sh && sh.length <= 4) return sh.toUpperCase();
  const w = clean(c && c.name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(x => x && !GENERIC.test(x));
  return w.length ? initials(w.join(' ')) : initials(c && c.name);
}

/* WHAT THE STRAP SAYS: a number worth saying (a club's, or a player's with the player's name), else the headline's own
   second half where it has a short one ("Caroline Lau: The Heartbeat of Manchester Basketball"), else the kind of news -
   and never "latest news" as filler (Louie, 2026-10-16) */
function strapFor(f, o) {
  const opt = o || {};
  const n = f.number;
  if (n && !opt.noNumber) {
    /* the person the cover is about scored it: the number alone (35 PTS), the name is already the cover */
    if (n.player && n.who && f.layout === 'name' && f.names[0] && fold(f.names[0]) === fold(n.who)) return n.value + ' ' + (SHORT[n.label] || n.label);
    const s = strapOf(f);
    if (s) return s;
  }
  /* a colon or a bar splits a headline; a dash is too often inside a club's name ("City of London Academy - Southwark") */
  const m = /^[^:|]{3,70}\s*[:|]\s*([^"“«»”]{6,})$/.exec(f.title || '');
  if (m) {
    const words = clean(m[1]).replace(/[.!?]+$/, '').split(' ');
    if (words.length >= 2 && words.length <= 7) return words.join(' ').toUpperCase();
  }
  return f.topic && f.topic.key !== 'news' ? T(f.topic.words.join(' ')) : null;
}
const strapSize = H => Math.max(9, Math.min(26, H * 0.048));
/* A STRAP TOO LONG FOR ITS COLUMN loses words from its end before its type shrinks below readable (THE HEARTBEAT OF
   MANCHESTER BASKETBALL beside Manchester's crest is THE HEARTBEAT OF MANCHESTER); two words at the least */
function strapFit(ctx, text, S, maxW) {
  const width = (t, sz) => { font(ctx, sz, 800, 'semi-condensed'); return ctx.measureText(t).width + sz * 0.08 * t.length + sz * 1.3; };
  let words = String(text || '').toUpperCase().split(' ').filter(Boolean);
  while (words.length > 2 && width(words.join(' '), S * 0.85) > maxW) words = words.slice(0, -1);
  if (words.length > 2 || words.join(' ') === String(text || '').toUpperCase()) return words.join(' ');
  return words.join(' ');
}
const inkOn = c => (lum(c) > 0.5 ? '#0b0d10' : '#ffffff');
/* the size at which one line of text is exactly w wide (measured at 100 px: widths scale with the size) */
function fitW(ctx, text, w, weight, stretch) {
  font(ctx, 100, weight || 900, stretch || 'extra-condensed');
  const x = ctx.measureText(String(text)).width;
  return x > 0 ? (w / x) * 100 : 400;
}
/* THE ROOM A COVER HAS: under the page's own badges (top, px) and over its pills (bottom, px), or the shares of the
   height a caller gives (safeTop, safeBottom) */
function room(W, H, opt) {
  const top = opt.top != null ? opt.top : H * Math.max(opt.safeTop != null ? opt.safeTop : 0.2, opt.chrome ? 0.17 : 0);
  const bottom = opt.bottom != null ? opt.bottom : H * Math.max(0, Math.min(0.4, opt.safeBottom || 0));
  const pad = Math.min(W, H) * 0.07;
  const y0 = top + Math.min(W, H) * 0.02, y1 = H - bottom - pad * 0.5;
  return { pad, y0, y1, h: Math.max(12, y1 - y0) };
}
/* a disc with rings round it: the side of a cover that carries a crest */
function crestSide(ctx, cx, cy, R, img, club) {
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = Math.max(1, R * 0.03);
  [1.28, 1.56].forEach(k => { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); });
  ctx.restore();
  disc(ctx, cx, cy, R, img, club);
}

/* ONE COVER. images: { clubs: [img|null, img|null], brand: img|null }; opts: { top, bottom (px the page covers with its
   own badges and pills), or safeTop, safeBottom (shares of the height); chrome (the publisher's mark and name drawn
   in, for a cover standing on its own); final, leagueMark (a finished game's: FINAL and the league's mark); strap
   (false: none) } */
function drawArt(ctx, W, H, f, images, o) {
  const opt = o || {};
  const im = images || {};
  const pal = f.palette;
  const wide = W / H >= 1.2;
  const B = room(W, H, opt);
  const pad = B.pad;
  const S = strapSize(H);
  ctx.save();
  if (f.layout === 'duel') drawDuel(ctx, W, H, f, im, opt, B, S, pal);
  else if (f.layout === 'number') drawNumber(ctx, W, H, f, im, opt, B, S, pal, wide);
  else if (f.layout === 'name') drawPerson(ctx, W, H, f, im, opt, B, S, pal, wide);
  else if (f.layout === 'club') drawClub(ctx, W, H, f, im, opt, B, S, pal, wide);
  else drawBrand(ctx, W, H, f, im, opt, B, S, pal, wide);
  /* A COVER ON ITS OWN carries its publisher: the mark on its disc and the name, top left */
  if (opt.chrome) {
    const ks = Math.max(10, Math.min(20, H * 0.04));
    let x = pad;
    if (im.brand) { disc(ctx, x + ks * 1.2, pad * 0.6 + ks * 1.2, ks * 1.2, im.brand, { name: f.brand.name }); x += ks * 3; }
    if (f.brand.name) pill(ctx, f.brand.name, x, pad * 0.6 + ks * 0.35, ks, 'rgba(0,0,0,0.55)', '#ffffff');
  }
  ctx.restore();
}

/* A PERSON: the given names over the family name, as big as the room allows, in their club's colours with its crest
   beside them when the story names it (Caroline Lau in Manchester's), the strap under them */
function drawPerson(ctx, W, H, f, im, opt, B, S, pal, wide) {
  ground(ctx, W, H, pal, f.seed, { lightX: W * 0.78 });
  slash(ctx, W, H, W * 0.6, pal.accent, { alpha: 0.1, band: W * 0.06 });
  const nl = nameLines(f.names[0]);
  ghost(ctx, W, H, nl[nl.length - 1], pal);
  const club = f.club || null;
  const crestImg = club && im.clubs ? im.clubs[0] : null;
  const strap = opt.strap === false ? null : strapFor(f);
  const sh = strap ? S * 1.75 + S * 0.7 : 0;
  let tx = B.pad, tw = W - B.pad * 2, top = B.y0, h = B.h;
  if (club && wide) {
    const R = Math.min(B.h * 0.44, W * 0.16);
    const cx = W - B.pad - R, cy = B.y0 + B.h / 2;
    crestSide(ctx, cx, cy, R, crestImg, club);
    tw = cx - R * 1.3 - tx;
  } else if (club) {
    const R = Math.min(W * 0.16, B.h * 0.2);
    crestSide(ctx, W / 2, B.y0 + R, R, crestImg, club);
    top = B.y0 + R * 2 + B.pad * 0.4; h = B.y1 - top;
  }
  const two = nl.length === 2;
  const big = Math.min(fitW(ctx, nl[nl.length - 1], tw), (h - sh) / (0.8 + (two ? 0.46 : 0)), H * 0.5);
  const small = two ? Math.min(fitW(ctx, nl[0], tw, 800, 'condensed'), big * 0.42) : 0;
  const blockH = (two ? small * 1.06 : 0) + big * 0.8 + sh;
  let y = top + Math.max(0, (h - blockH) / 2);
  if (two) { lines(ctx, [[{ text: nl[0], colour: '#ffffff' }]], tx, y + small * 0.78, small, { stretch: 'condensed', weight: 800 }); y += small * 1.06; }
  lines(ctx, [[{ text: nl[nl.length - 1], colour: pal.accent }]], tx - big * 0.015, y + big * 0.76, big, { shadow: 'rgba(0,0,0,0.35)' });
  y += big * 0.8;
  if (strap) pill(ctx, strapFit(ctx, strap, S, tw), tx, y + S * 0.7, S, pal.accent, inkOn(pal.accent), 'left', tw);
}

/* A CLUB: its crest on its disc on one side, enormous and faint behind the words on the other, its name in two colours */
function drawClub(ctx, W, H, f, im, opt, B, S, pal, wide) {
  const c = f.clubs[0];
  ground(ctx, W, H, pal, f.seed, { lightX: wide ? W * 0.75 : W * 0.5 });
  slash(ctx, W, H, wide ? W * 0.52 : W * 0.6, pal.accent, { alpha: 0.12, band: W * 0.08 });
  const img = im.clubs && im.clubs[0];
  if (img) {
    ctx.save(); ctx.globalAlpha = 0.1;
    const big = Math.max(W, H) * 0.9;
    contain(ctx, img, wide ? -big * 0.3 : W / 2 - big / 2, wide ? H / 2 - big / 2 : H - big * 0.6, big, big);
    ctx.restore();
  }
  const words = clubWords(c).map(x => x.toUpperCase());
  const ls = words.length >= 2 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [words[0]];
  const strap = opt.strap === false ? null : strapFor(f);
  const sh = strap ? S * 1.75 + S * 0.7 : 0;
  let tx = B.pad, tw = W - B.pad * 2, top = B.y0, h = B.h, align = 'left';
  if (wide) {
    const R = Math.min(B.h * 0.46, W * 0.18);
    const cx = W - B.pad - R, cy = B.y0 + B.h / 2;
    crestSide(ctx, cx, cy, R, img, c);
    tw = cx - R * 1.3 - tx;
  } else {
    const R = Math.min(W * 0.2, B.h * 0.24);
    crestSide(ctx, W / 2, B.y0 + R, R, img, c);
    top = B.y0 + R * 2 + B.pad * 0.5; h = B.y1 - top; tx = W / 2; align = 'center';
  }
  let s = Math.min(...ls.map(l => fitW(ctx, l, tw)), (h - sh) / (ls.length * 0.86), H * 0.32);
  const blockH = ls.length * s * 0.86 + sh;
  let y = top + Math.max(0, (h - blockH) / 2) + s * 0.76;
  const segs = ls.map((l, i) => [{ text: l, colour: i === ls.length - 1 && ls.length > 1 ? pal.accent : '#ffffff' }]);
  const last = lines(ctx, segs, tx, y, s, { lead: 0.86, align, shadow: 'rgba(0,0,0,0.35)' });
  if (strap) pill(ctx, strapFit(ctx, strap, S, tw), tx, last + s * 0.04 + S * 0.7, S, pal.accent, inkOn(pal.accent), align, tw);
}

/* A NUMBER: the figure huge, what it counts and whose beside it (5 / SUPER-EARLY PREDICTIONS / SHEFFIELD SHARKS),
   the club's crest on the far side when the story is a club's */
function drawNumber(ctx, W, H, f, im, opt, B, S, pal, wide) {
  ground(ctx, W, H, pal, f.seed, { lightX: W * 0.3 });
  slash(ctx, W, H, W * 0.62, pal.accent, { alpha: 0.1 });
  const n = f.number;
  const club = f.club || null;
  const img = club && im.clubs ? im.clubs[0] : null;
  let right = W - B.pad;
  if (club && wide) {
    const R = Math.min(B.h * 0.4, W * 0.14);
    const cx = W - B.pad - R, cy = B.y0 + B.h / 2;
    crestSide(ctx, cx, cy, R, img, club);
    right = cx - R * 1.35;
  }
  const label = String(n.phrase || n.label || '').toUpperCase();
  const whose = String(n.who || (club ? clubWords(club).join(' ') : '') || f.names[0] || '').toUpperCase();
  const value = String(n.value);
  /* the figure: as tall as the room, and no more than half the width it shares with its words */
  const ns = Math.min(B.h / 0.8, fitW(ctx, value, (right - B.pad) * (value.length > 2 ? 0.55 : 0.42)), H * 0.75);
  font(ctx, ns, 900, 'extra-condensed');
  const nw = ctx.measureText(value).width;
  const mid = B.y0 + B.h / 2;
  lines(ctx, [[{ text: value, colour: pal.accent }]], B.pad - ns * 0.02, mid + ns * 0.36, ns, { shadow: 'rgba(0,0,0,0.4)' });
  /* the words beside it, as tall together as the figure's capitals */
  const lx = B.pad + nw + B.pad * 0.45, lw = right - lx;
  const capH = ns * 0.72;
  if (lw > W * 0.18) {
    const lab = wrapWords(ctx, label, lw, 2);
    const rows = lab.concat(whose ? [whose] : []);
    void rows;
    const s1 = Math.min(...lab.map(l => fitW(ctx, l, lw)), capH / (lab.length * 0.9 + (whose ? 0.8 : 0)));
    const s2 = whose ? Math.min(fitW(ctx, whose, lw, 800, 'condensed'), s1 * 0.85) : 0;
    const total = lab.length * s1 * 0.9 + (whose ? s2 * 1.0 : 0);
    let y = mid - total / 2 + s1 * 0.76;
    lab.forEach((l, i) => { if (i) y += s1 * 0.9; lines(ctx, [[{ text: l, colour: '#ffffff' }]], lx, y, s1); });
    if (whose) lines(ctx, [[{ text: whose, colour: pal.accent }]], lx, y + s1 * 0.2 + s2 * 0.8, s2, { stretch: 'condensed', weight: 800 });
  } else {
    /* too narrow beside it: under it */
    const s1 = Math.min(fitW(ctx, label, right - B.pad), B.h * 0.14);
    lines(ctx, [[{ text: label, colour: '#ffffff' }]], B.pad, Math.min(B.y1, mid + ns * 0.36 + s1 * 1.1), s1);
  }
}
/* words into at most n lines of a width, the last one taking the rest */
function wrapWords(ctx, text, w, n) {
  const words = clean(text).split(' ').filter(Boolean);
  if (words.length <= 1 || n <= 1) return [words.join(' ')];
  font(ctx, 100, 900, 'extra-condensed');
  /* the break that makes the two lines most even */
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const d = Math.abs(ctx.measureText(a).width - ctx.measureText(b).width);
    if (!best || d < best.d) best = { d, ls: [a, b] };
  }
  /* one line when it fits nearly as big as the two would (two lines take twice the height) */
  const one = fitW(ctx, words.join(' '), w), two = Math.min(fitW(ctx, best.ls[0], w), fitW(ctx, best.ls[1], w));
  return one >= two * 0.62 ? [words.join(' ')] : best.ls;
}

/* TWO CLUBS IN A GAME: their halves cut on the slant, their crests, the score (a finished game's on its board with
   FINAL, the loser's number dimmed), the league's mark at the top, and the strap */
function drawDuel(ctx, W, H, f, im, opt, B, S, pal) {
  const [a, b] = f.clubs;
  const pa = a.guess ? palette(null, null, a.name) : palette(a.colour, a.colour2, a.name);
  const pb = b.guess ? palette(null, null, b.name) : palette(b.colour, b.colour2, b.name);
  ground(ctx, W, H, pa, f.seed, { lightX: W * 0.25, dots: false });
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
  const final = !!(opt.final && f.score);
  let y0 = B.y0;
  if (opt.leagueMark && im.brand) {
    const lr = Math.max(9, Math.min(H * 0.085, W * 0.05));
    disc(ctx, W / 2, Math.max(B.pad * 0.3, y0 - lr * 2 - 2) + lr, lr, im.brand, { name: f.brand.name });
    y0 = Math.max(y0, B.pad * 0.3 + lr * 2 + B.pad * 0.15);
  }
  const strap = opt.strap === false ? null : strapFor(f, { noNumber: false });
  const showStrap = strap && !(final && !f.number);
  const sh = showStrap ? S * 1.75 + S * 0.5 : 0;
  const nameRoom = Math.max(9, (B.y1 - y0) * 0.16);
  const R = Math.max(8, Math.min(W * 0.15, (B.y1 - y0 - sh - nameRoom * 1.5) / 2.1));
  const cy = y0 + R * 1.04;
  const xa = W * 0.2, xb = W - xa;
  disc(ctx, xa, cy, R, im.clubs && im.clubs[0], a);
  disc(ctx, xb, cy, R, im.clubs && im.clubs[1], b);
  const nameW = W * 0.3;
  const sizeOf = nm => Math.min(fitW(ctx, nm, nameW, 800, 'condensed'), nameRoom, R * 0.5);
  /* a name too long for its half gives way to the club's short name, else its last word */
  let names = [a, b].map(c => { const w = clubWords(c), full = w.join(' ').toUpperCase(); return w.length > 1 && sizeOf(full) < R * 0.3 ? (shortWord(c) || w[w.length - 1]).toUpperCase() : full; });
  let nameS = Math.min(...names.map(sizeOf));
  if (nameS < 10) {
    /* the club's three letters: its short name when that is short, else its short word's, else its name's last real word's
       (Copleston High School is COP, City of London Academy LON) */
    const code = c => {
      if (c.short && /^[\p{L}\p{N}]{2,5}$/u.test(c.short)) return c.short.toUpperCase();
      const sw = shortWord(c);
      const words = clubWords(c).filter(x => !/^(of|de|la|el|the|and|&)$/i.test(x));
      return String(sw || words[words.length - 1] || c.name || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase();
    };
    names = [code(a), code(b)];
    nameS = Math.min(...names.map(sizeOf));
  }
  [[names[0], xa], [names[1], xb]].forEach(([nm, x]) => {
    lines(ctx, [[{ text: nm, colour: '#ffffff' }]], x, cy + R + nameS * 1.2, nameS, { align: 'center', stretch: 'condensed', weight: 800, shadow: 'rgba(0,0,0,0.5)' });
  });
  const midT = f.score ? f.score[0] + '–' + f.score[1] : 'V';
  const sz = Math.min(fitW(ctx, midT, W * (f.score ? 0.27 : 0.14)), R * (f.score ? 0.95 : 1.25));
  const dim = 'rgba(255,255,255,0.55)';
  const lose = final && +f.score[0] !== +f.score[1] ? (+f.score[0] < +f.score[1] ? 0 : 1) : -1;
  const segs = f.score ? [{ text: String(f.score[0]), colour: lose === 0 ? dim : '#ffffff' }, { text: '–', colour: final ? dim : '#ffffff' },
                          { text: String(f.score[1]), colour: lose === 1 ? dim : '#ffffff' }] : [{ text: midT, colour: '#ffffff' }];
  if (final) {
    font(ctx, sz, 900, 'extra-condensed');
    const tw = segs.reduce((w, x) => w + ctx.measureText(x.text).width, 0);
    const fs = Math.max(8, Math.min(S * 0.95, sz * 0.2));
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
  if (showStrap) pill(ctx, strap, W / 2, B.y1 - S * 1.75, S, pal.accent, inkOn(pal.accent), 'center', W - B.pad * 2);
}

/* NOTHING TO NAME: the kind of news in the big type, or the headline's own opening words when it is only news, and the
   publisher's mark on its disc */
function drawBrand(ctx, W, H, f, im, opt, B, S, pal, wide) {
  ground(ctx, W, H, pal, f.seed);
  slash(ctx, W, H, W * 0.56, pal.accent, { alpha: 0.12 });
  let ls;
  if (f.topic && f.topic.key !== 'news') {
    const w = f.topic.words.map(T);
    ls = [w[0], w[1]];
  } else {
    /* the headline's first clause: a few words, or a few characters of a language written without spaces */
    const head = clean(String(f.title || '').split(/[:|–—,.!?]/)[0]);
    const spaced = /\s/.test(head) && /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\d\s'’"“”«»&()-]+$/u.test(head);
    ls = spaced ? wrapLines(head.split(' ').slice(0, 5).join(' ').toUpperCase(), 2)
      : wrapLines(String(f.brand.name || '').toUpperCase(), 2);
  }
  ls = ls.filter(Boolean);
  let tx = B.pad, tw = W - B.pad * 2;
  if (wide && im.brand) {
    const R = Math.min(B.h * 0.4, W * 0.15);
    const cx = W - B.pad - R, cy = B.y0 + B.h / 2;
    crestSide(ctx, cx, cy, R, im.brand, { name: f.brand.name, colour: f.brand.colour || pal.base });
    tw = cx - R * 1.3 - tx;
  }
  const s = Math.min(...ls.map(l => fitW(ctx, l, tw)), B.h / (ls.length * 0.88), H * 0.3);
  const y = B.y0 + Math.max(0, (B.h - ls.length * s * 0.88) / 2) + s * 0.76;
  lines(ctx, ls.map((l, i) => [{ text: l, colour: i === ls.length - 1 && ls.length > 1 ? pal.accent : '#ffffff' }]), tx, y, s, { lead: 0.88, shadow: 'rgba(0,0,0,0.35)' });
}
function wrapLines(text, n) {
  const w = text.split(' ');
  if (w.length < 2 || n < 2) return [text];
  const half = Math.ceil(w.length / 2);
  return [w.slice(0, half).join(' '), w.slice(half).join(' ')];
}

/* ------------------------------------------------------------------ SVG --- */
/* A 2D CONTEXT THAT WRITES SVG. The covers on the site are drawn into this instead of a canvas (Louie, 2026-10-16:
   "the text still looks a bit blurry"): the same drawing calls, but the result is vectors and real text that the
   browser draws at the screen's own sharpness at any size and any zoom. It knows exactly the calls the covers make;
   widths are measured on a canvas in the page's own fonts, so the layout is the canvas's to the pixel. */
function svgContext(W, H) {
  const d = root.document;
  const meas = d ? d.createElement('canvas').getContext('2d') : null;
  const id = 'na' + Math.random().toString(36).slice(2, 8);
  let n = 0;
  const defs = [], out = [];
  const xs = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => (Math.round(v * 100) / 100);
  const st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', globalAlpha: 1, shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0,
               shadowOffsetX: 0, shadowOffsetY: 0, textAlign: 'start', textBaseline: 'alphabetic', letterSpacing: '0px', filter: 'none',
               fontStretch: 'normal', weight: '400', stretch: 'normal', size: 10, family: 'sans-serif', open: 0 };
  const stack = [];
  let path = '', cur = [0, 0], start = [0, 0];
  const filters = new Map();
  const colourOf = c => {
    if (c && typeof c === 'object' && c.__grad) {
      if (!c.id) {
        c.id = id + 'g' + (n++);
        const stops = c.stops.map(([o, col]) => '<stop offset="' + num(o) + '" stop-color="' + xs(col) + '"/>').join('');
        defs.push(c.kind === 'l'
          ? '<linearGradient id="' + c.id + '" gradientUnits="userSpaceOnUse" x1="' + num(c.a[0]) + '" y1="' + num(c.a[1]) + '" x2="' + num(c.a[2]) + '" y2="' + num(c.a[3]) + '">' + stops + '</linearGradient>'
          : '<radialGradient id="' + c.id + '" gradientUnits="userSpaceOnUse" fx="' + num(c.a[0]) + '" fy="' + num(c.a[1]) + '" fr="' + num(c.a[2]) + '" cx="' + num(c.a[3]) + '" cy="' + num(c.a[4]) + '" r="' + num(c.a[5]) + '">' + stops + '</radialGradient>');
      }
      return 'url(#' + c.id + ')';
    }
    return xs(c);
  };
  const common = () => {
    let a = '';
    if (st.globalAlpha < 1) a += ' opacity="' + num(st.globalAlpha) + '"';
    const m = /rgba?\(([^)]+)\)/.exec(st.shadowColor || '');
    const sa = m ? (m[1].split(',')[3] != null ? +m[1].split(',')[3] : 1) : (st.shadowColor && st.shadowColor !== 'transparent' ? 1 : 0);
    if (st.shadowBlur > 0 && sa > 0) {
      const key = num(st.shadowBlur) + '|' + num(st.shadowOffsetX) + '|' + num(st.shadowOffsetY) + '|' + st.shadowColor;
      if (!filters.has(key)) {
        const fid = id + 'f' + (n++);
        const rgb = m ? 'rgb(' + m[1].split(',').slice(0, 3).join(',') + ')' : st.shadowColor;
        defs.push('<filter id="' + fid + '" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="' + num(st.shadowOffsetX) + '" dy="' + num(st.shadowOffsetY) +
          '" stdDeviation="' + num(st.shadowBlur / 2) + '" flood-color="' + xs(rgb) + '" flood-opacity="' + num(sa) + '"/></filter>');
        filters.set(key, fid);
      }
      a += ' filter="url(#' + filters.get(key) + ')"';
    }
    return a;
  };
  const fontCss = () => 'font-family:' + xs(st.family) + ';font-weight:' + st.weight + ';font-size:' + num(st.size) + 'px;font-stretch:' + (st.fontStretch !== 'normal' ? st.fontStretch : st.stretch);
  const STRETCH = /^(ultra-condensed|extra-condensed|condensed|semi-condensed|normal|semi-expanded|expanded|extra-expanded|ultra-expanded)$/;
  const ctx = {
    canvas: null,
    get font() { return st.weight + ' ' + (st.stretch !== 'normal' ? st.stretch + ' ' : '') + st.size + 'px ' + st.family; },
    set font(v) {
      const parts = String(v).trim().split(/\s+/);
      let i = 0; st.weight = '400'; st.stretch = 'normal';
      while (i < parts.length && !/px$/.test(parts[i])) {
        if (/^\d{3}$|^bold$|^normal$/.test(parts[i])) st.weight = parts[i];
        else if (STRETCH.test(parts[i])) st.stretch = parts[i];
        i++;
      }
      if (i < parts.length) st.size = parseFloat(parts[i]);
      st.family = parts.slice(i + 1).join(' ') || 'sans-serif';
      st.fontStretch = st.stretch;
    },
    save() { stack.push(Object.assign({}, st)); st.open = 0; },
    restore() {
      for (let k = 0; k < st.open; k++) out.push('</g>');
      const s = stack.pop();
      if (s) Object.assign(st, s);
    },
    translate(x, y) { out.push('<g transform="translate(' + num(x) + ' ' + num(y) + ')">'); st.open++; },
    setTransform() {}, scale() {}, clearRect() {},
    beginPath() { path = ''; },
    moveTo(x, y) { path += 'M' + num(x) + ' ' + num(y); cur = [x, y]; start = [x, y]; },
    lineTo(x, y) { path += (path ? 'L' : 'M') + num(x) + ' ' + num(y); cur = [x, y]; if (path.length < 2) start = [x, y]; },
    closePath() { path += 'Z'; cur = start.slice(); },
    rect(x, y, w, h) { path += 'M' + num(x) + ' ' + num(y) + 'h' + num(w) + 'v' + num(h) + 'h' + num(-w) + 'Z'; cur = [x, y]; start = [x, y]; },
    arc(cx, cy, r, a0, a1, ccw) {
      const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
      const p = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const s0 = p(a0);
      path += (path ? 'L' : 'M') + num(s0[0]) + ' ' + num(s0[1]);
      if (full) {
        const m = p(a0 + Math.PI);
        path += 'A' + num(r) + ' ' + num(r) + ' 0 1 1 ' + num(m[0]) + ' ' + num(m[1]) + 'A' + num(r) + ' ' + num(r) + ' 0 1 1 ' + num(s0[0]) + ' ' + num(s0[1]);
        cur = s0; return;
      }
      let delta = ccw ? a0 - a1 : a1 - a0;
      while (delta < 0) delta += Math.PI * 2;
      const e = p(a1);
      path += 'A' + num(r) + ' ' + num(r) + ' 0 ' + (delta > Math.PI ? 1 : 0) + ' ' + (ccw ? 0 : 1) + ' ' + num(e[0]) + ' ' + num(e[1]);
      cur = e;
    },
    arcTo(x1, y1, x2, y2, r) {
      const [x0, y0] = cur;
      let v1 = [x0 - x1, y0 - y1], v2 = [x2 - x1, y2 - y1];
      const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
      if (!r || !l1 || !l2) { ctx.lineTo(x1, y1); return; }
      v1 = [v1[0] / l1, v1[1] / l1]; v2 = [v2[0] / l2, v2[1] / l2];
      const cos = v1[0] * v2[0] + v1[1] * v2[1];
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (ang < 1e-6 || Math.abs(ang - Math.PI) < 1e-6) { ctx.lineTo(x1, y1); return; }
      const t = r / Math.tan(ang / 2);
      const t1 = [x1 + v1[0] * t, y1 + v1[1] * t], t2 = [x1 + v2[0] * t, y1 + v2[1] * t];
      const cross = v1[0] * v2[1] - v1[1] * v2[0];
      ctx.lineTo(t1[0], t1[1]);
      path += 'A' + num(r) + ' ' + num(r) + ' 0 0 ' + (cross > 0 ? 0 : 1) + ' ' + num(t2[0]) + ' ' + num(t2[1]);
      cur = t2;
    },
    fill() { if (path) out.push('<path d="' + path + '" fill="' + colourOf(st.fillStyle) + '"' + common() + '/>'); },
    stroke() {
      if (path) out.push('<path d="' + path + '" fill="none" stroke="' + colourOf(st.strokeStyle) + '" stroke-width="' + num(st.lineWidth) + '" stroke-linecap="' + st.lineCap + '"' + common() + '/>');
    },
    fillRect(x, y, w, h) { out.push('<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' + colourOf(st.fillStyle) + '"' + common() + '/>'); },
    clip() {
      const cid = id + 'c' + (n++);
      defs.push('<clipPath id="' + cid + '"><path d="' + (path || 'M0 0') + '"/></clipPath>');
      out.push('<g clip-path="url(#' + cid + ')">'); st.open++;
    },
    createLinearGradient(x0, y0, x1, y1) { const g = { __grad: true, kind: 'l', a: [x0, y0, x1, y1], stops: [] }; g.addColorStop = (o, c) => g.stops.push([o, c]); return g; },
    createRadialGradient(x0, y0, r0, x1, y1, r1) { const g = { __grad: true, kind: 'r', a: [x0, y0, r0, x1, y1, r1], stops: [] }; g.addColorStop = (o, c) => g.stops.push([o, c]); return g; },
    measureText(t) {
      if (!meas) return { width: String(t).length * st.size * 0.5 };
      meas.font = ctx.font;
      if ('fontStretch' in meas) { try { meas.fontStretch = st.fontStretch !== 'normal' ? st.fontStretch : st.stretch; } catch (_) { /* the shorthand */ } }
      if ('letterSpacing' in meas) meas.letterSpacing = st.letterSpacing || '0px';
      return meas.measureText(String(t));
    },
    text(t, x, y, paint) {
      const anchor = st.textAlign === 'center' ? 'middle' : (st.textAlign === 'right' || st.textAlign === 'end') ? 'end' : 'start';
      const base = st.textBaseline === 'middle' ? ' dominant-baseline="central"' : st.textBaseline === 'top' ? ' dominant-baseline="text-before-edge"'
        : st.textBaseline === 'bottom' ? ' dominant-baseline="text-after-edge"' : '';
      const ls = st.letterSpacing && st.letterSpacing !== '0px' ? ' letter-spacing="' + xs(st.letterSpacing) + '"' : '';
      out.push('<text x="' + num(x) + '" y="' + num(y) + '" text-anchor="' + anchor + '"' + base + ls + ' style="' + fontCss() + '" ' + paint + common() + '>' + xs(t) + '</text>');
    },
    fillText(t, x, y) { ctx.text(t, x, y, 'fill="' + colourOf(st.fillStyle) + '"'); },
    strokeText(t, x, y) { ctx.text(t, x, y, 'fill="none" stroke="' + colourOf(st.strokeStyle) + '" stroke-width="' + num(st.lineWidth) + '"'); },
    drawImage(img, x, y, w, h) {
      const src = img && (img.currentSrc || img.src);
      if (!src) return;
      out.push('<image href="' + xs(src) + '" x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" preserveAspectRatio="none"' + common() + '/>');
    },
    svg() {
      while (stack.length) ctx.restore();
      for (let k = 0; k < st.open; k++) out.push('</g>');
      st.open = 0;
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + num(W) + ' ' + num(H) + '" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<defs>' + defs.join('') + '</defs>' + out.join('') + '</svg>';
    }
  };
  ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'textAlign',
   'textBaseline', 'letterSpacing', 'filter', 'fontStretch'].forEach(k => Object.defineProperty(ctx, k, { get: () => st[k], set: v => { st[k] = v; }, enumerable: true }));
  return ctx;
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
    const r = await fetch(C.supabaseUrl + '/rest/v1/teams?select=name,short_name,colour,colour_2,logo_path,aliases,leagues!inner(slug)&leagues.slug=in.(' +
      want.join(',') + ')&limit=1000', { headers: { apikey: C.supabaseAnonKey, Accept: 'application/json' } });
    if (!r.ok) return [];
    const rows = (await r.json()).map(t => ({ name: t.name, short: t.short_name, colour: t.colour, colour2: t.colour_2, logo: t.logo_path,
                                              aliases: Array.isArray(t.aliases) ? t.aliases.filter(a => typeof a === 'string' && a.length >= 4) : [] }));
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
  /* A VECTOR COVER (svgContext): crisp at any size and any zoom; out of the page's translation (its words are drawn) */
  const box = d.createElement('div');
  box.className = 'na-art notranslate';
  box.setAttribute('aria-hidden', 'true');
  box.setAttribute('translate', 'no');
  let facts = null, images = null, last = '';
  /* THE PAGE'S OWN BADGES over the plate (opts.avoid: a selector): the cover keeps its words above and below them, by
     where they really are, not a guess at their size */
  const overlays = () => {
    const hr = host.getBoundingClientRect();
    /* a page zoomed by CSS (the feed's legibility zoom) measures its boxes in zoomed pixels and its plate in its own:
       the badges are brought back into the plate's own units */
    const k = host.clientHeight ? hr.height / host.clientHeight : 1;
    const H0 = host.clientHeight;
    let top = 0, bottom = 0;
    host.querySelectorAll(opt.avoid).forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const y0 = (r.top - hr.top) / k, y1 = (r.bottom - hr.top) / k;
      if (y1 <= H0 * 0.55) top = Math.max(top, y1 + 3);
      else if (y0 >= H0 * 0.45) bottom = Math.max(bottom, H0 - y0 + 3);
    });
    return { top, bottom };
  };
  const paint = () => {
    if (!facts) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (w < 40 || h < 30) return;
    if (!box.parentNode) {
      const after = opt.after && opt.after.parentNode === host ? opt.after : null;
      const before = typeof opt.before === 'string' ? host.querySelector(':scope > ' + opt.before) : null;
      host.insertBefore(box, before || (after ? after.nextSibling : host.firstChild));
      host.classList.add('has-art');
    }
    const ov = opt.avoid ? overlays() : null;
    const k = w + 'x' + h + (ov ? '|' + Math.round(ov.top) + '|' + Math.round(ov.bottom) : '');
    if (k === last) return;
    last = k;
    const o2 = Object.assign({}, opt);
    if (ov) { o2.top = Math.max(ov.top, h * 0.05); o2.bottom = ov.bottom; }
    const ctx = svgContext(w, h);
    drawArt(ctx, w, h, facts, images, o2);
    box.innerHTML = ctx.svg();
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
      let t = 0;
      const later = () => { clearTimeout(t); t = setTimeout(paint, 120); };
      if (typeof ResizeObserver === 'function') new ResizeObserver(later).observe(host);
    } catch (_) { /* the plate's own print stays */ }
  };
  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px' });
    io.observe(host);
  } else go();
  return box;
}

return { analyse, strapOf, strapFor, svgContext, canonWith, monogram, drawArt, mount, clubsFor, palette, font, fit, lines, wrap, cover, contain, disc, pill, ground, slash, rr, load, crest,
         fonts, nameLines, clubWords, initials, hex, lum, mix, rgba, numberOf, scoreOf, topicOf, quoteOf, namesOf, clubsIn, runsIn, tintHex, T };
}));
