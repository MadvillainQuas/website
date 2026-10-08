'use strict';
/* ============================================================================
   THE NEWSROOM — window.EpinoiaNewsroom.

   The newsdesk (narrative.js) knows what is running in a league; the newsroom writes it up. Every hour, beside the
   storylines, it looks for what deserves a whole article - the games to watch, a player gone cold, the MVP case, a
   young player out of the ordinary, what a club is built on, a run seen from the inside, the five who are winning
   their minutes, who wins when the shot clock runs down - scores each for salience and writes the ones that clear the
   bar, in full: headline, standfirst, body and the numbers.

   THE FACTS ARE THE DATA'S. Every figure comes from what the hourly build already holds, and nothing more is read for
   an article: the season file (each club's and player's season, with the events splits - half court, transition,
   second chances, off turnovers, after timeouts, by zone, for and against - and every player's on/off), the season's
   game lines, the last fortnight's games replayed through the match-report engine (each side's shot clock and the
   fives on the floor: recaps[id].deep) and the league's own What Wins model. A sentence whose slot has nothing to fill
   it is not written.

   THE VOICE IS LEARNED. The words come from a phrasebook, widened by what the newsroom has learned from articles fed
   to it in the platform console (digest, learn): the verbs a writer uses for a rout and for a narrow win, for a hot
   hand and a cold one, how they open a paragraph or turn an argument, the shapes of their headlines. It learns short,
   generic phrasing - never anybody's sentence - and every slot in it is filled from the data, so nothing a fed
   article says can become a fact here.

   SALIENCE. Each candidate is scored 0-1 (how far from normal, how much rides on it, how fresh) and only those at
   SALIENCE or above are written: at most two new an hour, eight a week, one a fortnight on the same subject. An
   article, once written, stays as it was for three weeks: a reader's link never changes under them.

     EpinoiaNewsroom.publish(input, build, { style, previous, nowMs }) -> the league's articles, newest first
     EpinoiaNewsroom.candidates(input, build, { style, nowMs })      -> every candidate, with its salience
     EpinoiaNewsroom.digest(text, title)                              -> what one fed article teaches
     EpinoiaNewsroom.learn(digests)                                   -> the style, merged
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsroom = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const NARR = () => root.EpinoiaNarrative || (typeof require === 'function' ? require('./narrative.js') : null);
const SALIENCE = 0.6, MAX_NEW = 2, MAX_WEEK = 8, KEEP_DAYS = 21, SUBJECT_DAYS = 14, MAX_KEEP = 16;
const HOUR = 3600000, DAY = 86400000;

/* ------------------------------------------------------------------ words --- */
const num = v => (v == null || v === '' || isNaN(v) ? null : +v);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = n => { const v = Math.round(+n); return v >= 0 && v <= 12 ? WORDS[v] : String(v); };
const ORDW = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const place = n => { const v = Math.round(+n); if (v >= 1 && v <= 10) return ORDW[v]; const t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
const one = v => (Math.round(v * 10) / 10).toFixed(1);
const two = v => (Math.round(v * 100) / 100).toFixed(2);
const pc = v => one(v) + '%';
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + one(Math.abs(v));
const cap = s => String(s || '').replace(/^\s*([a-z])/, (m, c) => m.replace(c, c.toUpperCase()));
const possOf = n => String(n) + (/s$/i.test(String(n)) ? '’' : '’s');
const list = xs => { const a = xs.filter(Boolean); return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
const time = t => { const x = Date.parse(t); return isFinite(x) ? x : null; };
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp = (v, lo, hi) => Math.max(lo == null ? 0 : lo, Math.min(hi == null ? 1 : hi, v));
const surname = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : p[0] || ''; };
/* a sentence with an empty slot is never printed (the newsdesk's and the match reports' rule) */
const LEAK = /\b(?:undefined|NaN|Infinity|null)\b|\[object |\{[a-zA-Z]+\}/;
const ok = s => (s && !LEAK.test(s) ? s : null);
/* the article before a number said aloud: an 8-point, an 11-game, an 80-81 */
const an = n => (/^(8|11|18|8\d|8\d\d)\b/.test(String(n)) ? 'an' : 'a');
const seedOf = s => { let h = 2166136261; const t = String(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const pick = (seed, xs) => xs[seedOf(seed) % xs.length];
/* every headline a piece could take, the seed's choice first (what pick() would give); publish() orders them by the
   click-through model where there is one, and keeps three for the headline test */
const headsOf = (seed, xs) => { const l = xs.filter((x, i) => x && xs.indexOf(x) === i), k = l.length ? seedOf(seed) % l.length : 0; return l.slice(k).concat(l.slice(0, k)); };
function dayWords(ms, tz) {
  const d = new Date(ms);
  if (isNaN(d)) return null;
  const o = { weekday: 'long', day: 'numeric', month: 'long' };
  try { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz || undefined }, o)).format(d); }
  catch (_) { return new Intl.DateTimeFormat('en-GB', o).format(d); }
}
const WOMEN = /\b(women|womens|women’s|femenin|féminin|feminin|femminil|damen|naisten|kvinde|dam|wnbl|weabl|wjbl|w league|ladies|girls|female)/i;

/* ============================================================== the phrasebook ===
   The house words, by what they are for. The learned style adds its own beside them (say): what a fed article used
   for the same job. {he} {him} {his} are the player's pronouns. */
const BOOK = {
  turn: ['Still,', 'Even so,', 'That said,', 'For all that,', 'Then again,'],
  caveat: ['That said,', 'A word of caution:', 'The caveat:', 'One note of caution:'],
  add: ['What is more,', 'Beyond that,', 'On top of that,', 'There is more.'],
  winBig: ['routed', 'swept aside', 'ran away from', 'overwhelmed'],
  winClose: ['edged', 'held off', 'squeezed past', 'outlasted'],
  win: ['beat', 'saw off', 'got the better of'],
  lose: ['lost to', 'fell to', 'went down to'],
  score: ['scored', 'put up', 'finished with', 'poured in'],
  cold: ['has gone cold', 'has hit a rough patch', 'is struggling for form', 'has lost {his} touch'],
  hot: ['is in the form of {his} season', 'has been close to unstoppable', 'is playing the best basketball of {his} season']
};

/* ========================================================== the learned style ===
   DIGEST: one fed article, read for its phrasing. What it keeps, each short and generic:
     winBig / winClose / win / lose   the verb between two clubs before a score ("Boston routed Miami 120-95": routed,
                                      a rout because the score says so)
     score                            the verb between a name and "N points" ("poured in", "finished with")
     cold / hot                       the predicate around a word of form ("has hit a rough patch", "is red-hot")
     turn / add                       a paragraph's opening connective ("Still,", "Meanwhile,")
     heads                            a question headline, its subject made {X} ("Is {X} the real deal?"), by theme
     rhythm                           sentences, words a sentence, questions
   LEARN: the digests merged, each phrase with the number of articles it came from, most used first. */
const DIGEST_V = 1;
const CONTRAST = /^(however|still|yet|even so|that said|then again|nevertheless|nonetheless|on the other hand|for all that|despite that|all the same|mind you|by contrast)$/i;
const ADDITIVE = /^(meanwhile|in fact|indeed|crucially|tellingly|notably|moreover|what is more|what’s more|better still|worse still|elsewhere|ultimately|in the end|for now|either way|put simply|in short|above all|to be fair|in truth|again|then|now)$/i;
const COLD_W = /\b(struggl\w*|slump\w*|cold|rough patch|off night|out of sorts|misfir\w*|lost (?:his|her) touch|woes|funk|dry spell|off the boil)\b/i;
const HOT_W = /\b(on fire|red[- ]hot|unstoppable|in form|scorching|torrid|hot streak|rolling|can(?:no|’|')t miss|purple patch|on a tear)\b/i;
const THEMES = [['mvp', /\b(mvp|most valuable|best player)\b/i], ['slump', /\b(wrong|struggl|slump|cold|woes|trouble|happened|fallen|funk)\b/i],
  ['prospect', /\b(rookie|young|kid|teen|prospect|talent|future|breakout|next big|in the making|phenom|real deal)\b/i],
  ['run', /\b(streak|run|unbeaten|for real|keep (?:this|it) up|stop)\b/i]];
const sentencesOf = t => String(t).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"“‘(])/).map(s => s.trim()).filter(Boolean);
const NAMEISH = /^[A-Z][\w.'’&-]*$/;
const PARTICLE = /^(de|del|la|le|di|da|van|von|der|den|dos|el|al|bin|ibn|ter|du|des)$/;

function digest(text, title) {
  const body = String(text || '').replace(/\r/g, '');
  const lines = body.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const head = String(title || '').trim() || (lines.length > 1 && lines[0].split(/\s+/).length <= 16 && !/\.$/.test(lines[0]) ? lines[0] : '');
  const sents = sentencesOf(lines.filter(l => l !== head).join(' '));
  const out = { v: DIGEST_V, sentences: sents.length, words: 0, questions: 0, lex: {}, heads: [] };
  const add = (cat, p) => {
    const s = String(p || '').replace(/\b(his|her)\b/gi, '{his}').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!s || s.split(' ').length > 6 || /\d/.test(s) || !/^[a-z{}’' ,-]+$/.test(s)) return;
    (out.lex[cat] = out.lex[cat] || []).indexOf(s) < 0 && out.lex[cat].push(s);
  };
  sents.forEach(s => {
    const w = s.split(/\s+/);
    out.words += w.length;
    if (/\?$/.test(s)) out.questions++;
    /* a paragraph's opening connective: "Still," "In fact," (one to three words, no name in it) */
    const c = /^([A-Z][a-z]+(?: [a-z’']+){0,2}),\s/.exec(s);
    if (c && !/\d/.test(c[1])) { if (CONTRAST.test(c[1])) add('turn', c[1] + ','); else if (ADDITIVE.test(c[1])) add('add', c[1] + ','); }
    /* two clubs and a score: the verb between them, filed by the margin the score shows */
    let from = 0;
    for (const sc of s.matchAll(/(\d{2,3})\s*[-–—]\s*(\d{2,3})/g)) {
      const toks = s.slice(from, sc.index).replace(/^[\s,;]*(?:and|but|while|as|then)\b/i, '').trim().split(/\s+/);
      from = sc.index + sc[0].length;
      let j = toks.length - 1;
      while (j >= 0 && (NAMEISH.test(toks[j]) || PARTICLE.test(toks[j]))) j--;                 // the second club
      if (j >= 0 && /^the$/i.test(toks[j])) j--;
      const verb = [];
      while (j >= 0 && /^[a-z]+$/.test(toks[j]) && verb.length < 3) verb.unshift(toks[j--]);
      if (verb.length && j >= 0 && NAMEISH.test(toks[j].replace(/[,’']s?$/, '')) && !/^(the|a|an|and|but|as|with|by|of|in|on|at|to|for)$/.test(verb[0])) {
        const m = Math.abs(+sc[1] - +sc[2]), v = verb.join(' ');
        if (/\b(to|by)$/.test(v)) add('lose', v); else add(m >= 15 ? 'winBig' : m <= 5 ? 'winClose' : 'win', v);
      }
    }
    /* a name and "N points": the scoring verb, every one in the sentence */
    for (const pts of s.matchAll(/\b([A-Z][\w.'’-]+)\s+((?:[a-z]+\s+){0,2}[a-z]+)\s+\d{1,2}\s+points\b/g)) if (!/^(had|with|and|of|the|for|to|in|on|at|by)$/.test(pts[2])) add('score', pts[2]);
    /* form: the predicate around a word of a hot or a cold hand, from its auxiliary ("has hit a rough patch") */
    [['cold', COLD_W], ['hot', HOT_W]].forEach(([cat, re]) => {
      const m = re.exec(s);
      if (!m) return;
      const pre = s.slice(0, m.index + m[0].length);
      const aux = /\b((?:has|have|is|are|was|were|had)(?: (?:been|gone|hit|run|looked|lost|found|struggled))?(?: [a-z’'-]+){0,3})$/.exec(pre);
      if (aux) add(cat, aux[1]);
    });
  });
  /* a question headline, its one subject made {X} (sentence case only: a title-case headline hides its names) */
  if (head && /\?$/.test(head)) {
    const toks = head.replace(/\?$/, '').split(/\s+/), lower = toks.slice(1).filter(t => /^[a-z]/.test(t)).length;
    if (lower >= Math.ceil((toks.length - 1) / 2)) {
      const shape = [];
      toks.forEach((t, i) => { const name = i > 0 && (NAMEISH.test(t) || (PARTICLE.test(t) && shape[shape.length - 1] === '{X}'));
        if (name) { if (shape[shape.length - 1] !== '{X}') shape.push('{X}'); } else shape.push(t); });
      const x = shape.filter(t => t === '{X}').length;
      const theme = (THEMES.find(([, re]) => re.test(head)) || [null])[0];
      if (x === 1 && shape.length <= 11 && theme && !/\d/.test(head)) out.heads.push({ theme, shape: shape.join(' ').replace(/’s\b/, '’s') + '?' });
    }
  }
  return out;
}

function learn(digests) {
  const lex = {}, heads = {};
  let sentences = 0, words = 0, questions = 0, n = 0;
  (digests || []).forEach(d => {
    if (!d || d.v !== DIGEST_V) return;
    n++; sentences += d.sentences || 0; words += d.words || 0; questions += d.questions || 0;
    Object.keys(d.lex || {}).forEach(cat => (d.lex[cat] || []).forEach(p => { const m = (lex[cat] = lex[cat] || new Map()); m.set(p, (m.get(p) || 0) + 1); }));
    (d.heads || []).forEach(h => { const m = (heads[h.theme] = heads[h.theme] || new Map()); m.set(h.shape, (m.get(h.shape) || 0) + 1); });
  });
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 40).map(([p, c]) => ({ p, n: c }));
  const L = {}, H = {};
  Object.keys(lex).forEach(k => { L[k] = top(lex[k]); });
  Object.keys(heads).forEach(k => { H[k] = top(heads[k]); });
  return { v: DIGEST_V, articles: n, lex: L, heads: H,
           rhythm: { wordsPerSentence: sentences ? Math.round(words / sentences * 10) / 10 : null, questionShare: sentences ? Math.round(questions / sentences * 1000) / 1000 : null } };
}

/* a phrase for a job: the house's, or one the style learned (the learned ones weighted by how many articles used them) */
function sayer(style, pr) {
  const S = style && style.lex ? style.lex : {};
  return (cat, seed) => {
    const pool = (BOOK[cat] || []).slice();
    (S[cat] || []).slice(0, 12).forEach(x => { if (pool.indexOf(x.p) < 0) for (let i = 0; i < Math.min(3, x.n); i++) pool.push(x.p); });
    const p0 = pool.length ? pool[seedOf(seed + '|' + cat) % pool.length] : '';
    const p = /^(turn|add|caveat)$/.test(cat) ? cap(p0) : p0;          // a connective opens a sentence
    return p.replace(/\{his\}/g, pr.his).replace(/\{him\}/g, pr.him).replace(/\{he\}/g, pr.he);
  };
}

/* ================================================================== the league ===
   One read of what the build holds, shaped for writing: club and player season rows, ranks among them, the game logs,
   the fortnight's replayed games (deep), the table and the next fixtures. */
function league(o, b, opts) {
  const NR = NARR();
  const nowMs = opts && opts.nowMs ? opts.nowMs : (o.now instanceof Date ? o.now.getTime() : time(o.now) || Date.now());
  const tz = o.league && o.league.timezone || null;
  const lname = (o.league && o.league.name) || 'league';
  const gender = o.league && o.league.gender ? o.league.gender : WOMEN.test([o.league && o.league.name, o.league && o.league.slug].join(' ')) ? 'women' : 'men';
  const pr = gender === 'women' ? { he: 'she', him: 'her', his: 'her', He: 'She', His: 'Her' } : { he: 'he', him: 'him', his: 'his', He: 'He', His: 'His' };
  const tmap = o.teams instanceof Map ? o.teams : new Map(Object.keys(o.teams || {}).map(k => [k, o.teams[k]]));
  const club = id => { const t = tmap.get(id); return t ? String(t.name || t.short_name || '') : (b && b.clubs && b.clubs[id] ? b.clubs[id].name : ''); };
  const leagueIds = new Set((o.comps || []).filter(c => (c.kind || 'league') === 'league').map(c => c.id));
  const games = (o.games || []).filter(g => g && num(g.home_score) != null && time(g.tipoff_at) != null && time(g.tipoff_at) <= nowMs)
    .sort((a, b2) => time(a.tipoff_at) - time(b2.tipoff_at));
  const regular = leagueIds.size ? games.filter(g => !g.competition_id || leagueIds.has(g.competition_id)) : games;
  const C = NR ? NR.__x.clubs(regular) : new Map();
  const PL = NR ? NR.__x.playerSeason(o.lines || [], games) : new Map();
  const T = (o.teamRows || []).filter(t => t && t.id && num(t.gp) >= 3);
  const trow = id => T.find(t => t.id === id) || null;
  const maxGp = Math.max(1, ...[...PL.values()].map(p => p.gp));
  const names = o.names || {};
  const pname = id => (names[id] && names[id].name) || null;
  const P = (o.players || []).filter(p => p && p.id && pname(p.id) && num(p.gp) > 0);
  const teamOf = p => p._teamId || (PL.get(p.id) && PL.get(p.id).team) || null;
  /* a regular by the season file's own count (the file can lag the game lines by a round: B.LEAGUE's was three games
     behind on 8 October), and every games-played said in a sentence from the lines */
  const fileGp = Math.max(1, ...P.map(p => num(p.gp) || 0));
  const regulars = P.filter(p => num(p.gp) >= Math.max(3, Math.ceil(fileGp * 0.5)) && num(p.mpg) >= 15);
  const gpOf = p => { const x = PL.get(p.id); return x ? x.gp : num(p.gp); };
  /* where a value ranks among rows (1 the best); dir -1 when less is better */
  const rank = (rows, key, id, dir) => {
    const d = dir || 1, xs = rows.filter(r => num(r[key]) != null).sort((a, c) => d * (num(c[key]) - num(a[key])));
    const i = xs.findIndex(r => r.id === id);
    if (i < 0 || xs.length < 4) return null;
    const vals = xs.map(r => num(r[key])), m = mean(vals), sd = Math.sqrt(mean(vals.map(v => (v - m) * (v - m)))) || 1;
    return { r: i + 1, n: xs.length, v: num(xs[i][key]), avg: m, z: d * (num(xs[i][key]) - m) / sd };
  };
  const standing = new Map();
  ((o.table && o.table.rows) || []).forEach(r => { if (r && r.team_id) standing.set(r.team_id, r); });
  const pos = id => { const r = standing.get(id); return r && num(r.rank) ? { rank: +r.rank, n: standing.size, w: num(r.w), l: num(r.l) } : null; };
  const nextOf = id => (o.fixtures || []).filter(f => time(f.tipoff_at) > nowMs && (f.home_team_id === id || f.away_team_id === id))
    .sort((a, c) => time(a.tipoff_at) - time(c.tipoff_at))[0] || null;
  /* the fortnight's replayed games, per club: the shot clock in three windows and the fives on the floor */
  const deep = new Map();
  Object.keys(o.recaps || {}).forEach(gid => {
    const r = o.recaps[gid], g = games.find(x => x.id === gid);
    if (!r || !r.deep || !g) return;
    [g.home_team_id, g.away_team_id].forEach((id, s) => {
      if (!deep.has(id)) deep.set(id, { games: 0, clock: [0, 0, 0, 0, 0, 0], durSum: 0, durN: 0, fives: new Map(), dur: 0, pf: 0, pa: 0 });
      const D = deep.get(id), c = r.deep.clock && r.deep.clock[s], f = r.deep.fives && r.deep.fives[s], tot = r.deep.total && r.deep.total[s];
      D.games++;
      if (c) { for (let i = 0; i < 6; i++) D.clock[i] += num(c[i]) || 0; if (num(c[6]) != null) { D.durSum += c[6]; D.durN++; } }
      (f || []).forEach(x => { const k = x.n.slice().sort().join('|'); const a = D.fives.get(k) || { n: x.n, dur: 0, pf: 0, pa: 0, games: 0 };
        a.dur += x.dur; a.pf += x.pf; a.pa += x.pa; a.games++; D.fives.set(k, a); });
      if (tot) { D.dur += tot[0]; D.pf += tot[1]; D.pa += tot[2]; }
    });
  });
  const lensOf = NR && NR.__x.lens ? NR.__x.lens(o.model, T) : null;
  return { o, b, nowMs, tz, lname, gender, pr, club, games, regular, C, PL, T, trow, P, pname, teamOf, regulars, gpOf, rank, pos, nextOf, deep, lens: lensOf,
           day: ms => dayWords(ms, tz), slug: id => (names[id] && names[id].slug) || null };
}

/* where a rank sits, said: "the best in the league", "second-best in the league", "the league's worst", "ninth".
   o.among narrows the field ("among the league’s regulars"), o.best / o.worst rename its ends ("highest share", "lowest
   share": a share is high or low, not good or bad); either way it is never "the league's best", which is the whole league's */
function rankText(R, seed, o) {
  if (!R) return '';
  const op = o || {}, where = op.among || 'in the league', best = op.best || 'best', worst = op.worst || 'worst', whole = !op.among && !op.best && !op.worst;
  if (R.r === 1) return pick(seed, whole ? ['the best in the league', 'the league’s best', 'first in the league'] : ['the ' + best + ' ' + where, 'first ' + where]);
  if (R.r === R.n) return pick(seed, whole ? ['the worst in the league', 'the league’s worst', 'last in the league'] : ['the ' + worst + ' ' + where, 'last ' + where]);
  if (R.r <= 3) return place(R.r) + '-' + best + ' ' + where;
  if (R.r > R.n - 3) return place(R.n - R.r + 1) + '-' + worst + ' ' + where;
  return place(R.r) + ' ' + where;
}
/* a club's last result, said: "a 92–70 win over X", "an 81–79 defeat at X" */
function resultText(L, x, say, seed) {
  const sc = Math.max(x.for, x.against) + '–' + Math.min(x.for, x.against);
  const opp = L.club(x.opp);
  if (x.won) return an(sc) + ' ' + sc + ' ' + (x.home ? 'home win over ' : 'win at ') + opp;
  return an(sc) + ' ' + sc + ' ' + (x.home ? 'home defeat to ' : 'defeat at ') + opp;
}
const nextText = (L, id) => { const f = L.nextOf(id); if (!f) return null; const home = f.home_team_id === id;
  return { line: (home ? 'at home to ' : 'away at ') + L.club(home ? f.away_team_id : f.home_team_id) + ' on ' + L.day(time(f.tipoff_at)), opp: home ? f.away_team_id : f.home_team_id, game: f.id }; };
const teamLink = (L, id) => { const t = L.o.teams && (L.o.teams instanceof Map ? L.o.teams.get(id) : L.o.teams[id]); return t && t.slug ? { label: L.club(id), href: 't/?t=' + t.slug } : null; };
const playerLink = (L, id) => (L.slug(id) ? { label: L.pname(id), href: 'p/?p=' + L.slug(id) } : null);

/* ============================================================== the formats ===
   Each format looks at the league and returns its candidates: { kind, id, subject, salience, write() }. write() is
   called only for the ones chosen, and returns the article or null (a candidate whose evidence will not fill a body). */

/* THE SITUATIONS, as the season file keeps them: a club's points a chance and share of its chances in each, for and
   against (ev_ / evd_), and the zones its shots in them came from */
const SIT = { transition: 'transition', half: 'the half court', second: 'second chances', offTo: 'points off turnovers', ato: 'after timeouts' };

/* ---------------------------------------------------------- games to watch --- */
/* the season's lean on a game, said in its band: a toss-up, slightly, better, clear favourites */
const leanText = (L, ex) => {
  if (!ex || !isFinite(ex.margin)) return null;
  const m = Math.abs(ex.margin), fav = L.club(ex.favourite);
  return m < 2 ? 'On the season’s numbers it is close to a toss-up.'
    : m < 4.5 ? 'The season’s numbers make ' + fav + ' slightly better, by about ' + one(m) + ' points.'
    : m < 7 ? 'The season’s numbers make ' + fav + ' about ' + one(m) + ' points better.'
    : 'The season’s numbers make ' + fav + ' clear favourites, by about ' + one(m) + ' points.';
};
function fWatch(L, say) {
  const slate = ((L.b && L.b.coverage && L.b.coverage.slate) || []).filter(x => time(x.at) > L.nowMs && time(x.at) < L.nowMs + 7 * DAY && x.stakes >= 0.5)
    .sort((a, c) => c.stakes - a.stakes).slice(0, 3);
  if (slate.length < 2) return [];
  const first = new Date(Math.min(...slate.map(x => time(x.at))));
  const wk = first.getUTCFullYear() + '-' + Math.ceil(((first - Date.UTC(first.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  const salience = clamp(0.35 + slate[0].stakes / 2.6 + (slate.length >= 3 ? 0.08 : 0) + (slate[1].stakes >= 1 ? 0.07 : 0) + (slate.some(x => x.rival) ? 0.08 : 0));
  return [{ kind: 'watch', id: 'watch:' + wk, subject: 'week:' + wk, salience, write: () => {
    /* seeded by the league too: every league writes its week's piece the same week, and a feed showing several should not
       read the same headline shape down the page */
    const seed = 'watch' + wk + ((L.o.league && L.o.league.id) || ''), top = slate[0];
    const A = L.club(top.home.id), B = L.club(top.away.id);
    const head = headsOf(seed + 'h', [A + ' v ' + B + ' heads the week’s games to watch', 'The week ahead: ' + A + ' v ' + B + ' and the games that matter',
      'Games to watch: ' + A + ' v ' + B + ' leads a big week']);
    const dek = pick(seed + 'd', ['The ' + spell(slate.length) + ' games worth your time this week, and where the numbers say each will be decided.',
      'Where this week’s biggest games will be won and lost, according to the numbers.']);
    const side = s => L.club(s.id) + (s.rec || s.rank ? ' (' + [s.rec, s.rank ? place(s.rank) : null].filter(Boolean).join(', ') + ')' : '');
    const body = [ok(cap(top.day) + ' brings the pick of the week: ' + side(top.home) + ' host ' + side(top.away) + '.' +
      ((top.threads || []).length ? ' ' + cap(top.threads[0].line.replace(/\.$/, '')) + '.' : ''))];
    const used = new Set(), named = new Set();
    slate.forEach((g, i) => {
      const h = g.home.id, a = g.away.id;
      body.push({ h: L.club(h) + ' v ' + L.club(a) + ' · ' + g.day });
      const e = reasons(L, h, a, seed + i).filter(x => !used.has(x.key))[0];
      if (e) { body.push(e.text); used.add(e.key); }
      const onoff = [h, a].map(t => onOffLine(L, t, seed + i + t, named)).filter(Boolean)[0];
      if (onoff) body.push(onoff);
      const w = [g.home.watch, g.away.watch].find(x => x && !named.has(x.name));
      if (w) named.add(w.name);
      body.push(ok([leanText(L, g.expect), w ? 'Keep an eye on ' + w.name + ' (' + w.line + ').' : null].filter(Boolean).join(' ')));
    });
    return { kicker: 'Games to watch', head, dek, body: body.filter(Boolean), teams: [top.home.id, top.away.id],
      links: slate.map(g => ({ label: L.club(g.home.id) + ' v ' + L.club(g.away.id), href: 'game/?g=' + g.game })),
      facts: slate.map(g => ({ label: g.day, value: L.club(g.home.id) + ' v ' + L.club(g.away.id) })) };
  } }];
}
/* WHY A GAME WILL GO THE WAY IT GOES: the reasons a preview writer would give, from the season file. Not a figure set
   beside a figure ("they shoot better at the rim") but what the two clubs want to do and what that means here:
     a clash of styles      one wants it fast and the other slow; a three-point side against a wall on the perimeter
     the mismatch           what one does best against what the other does worst ("if they get into the paint, it is
                            their game"), or strength on strength ("something has to give")
     the matchup at a spot  each side's main player at the point, on the wing and at the big spot (the season file's
                            positional BPM: bpm_pos 1 = point guard, 5 = centre), set against each other by box
                            plus-minus and value over a replacement player (VORP)
   Each reason: { key, title, text, s (how sharp), a / b: the two figures with their ranks, for the card's meters }.
   rankWord says a rank the way its measure reads: "the second-quickest in the league", "the most in the league". */
function rankWord(R, hi, lo) {
  if (!R) return '';
  if (R.r === 1) return 'the ' + hi + ' in the league';
  if (R.r <= 5) return 'the ' + place(R.r) + '-' + hi + ' in the league';
  if (R.r === R.n) return 'the ' + lo + ' in the league';
  if (R.r > R.n - 5) return 'the ' + place(R.n - R.r + 1) + '-' + lo + ' in the league';
  return place(R.r) + ' in the league';
}
const top = R => R && R.r <= Math.max(3, Math.round(R.n / 5)), bottom = R => R && R.r > R.n - Math.max(3, Math.round(R.n / 5));
const fig = (team, label, value, R) => ({ team, label, value, rank: R.r, of: R.n });
function reasons(L, A, B, seed) {
  const ta = L.trow(A), tb = L.trow(B);
  if (!ta || !tb) return [];
  const R = (k, id, d) => L.rank(L.T, k, id, d), nA = L.club(A), nB = L.club(B), out = [];
  const add = (key, s, title, text, a, b) => { if (ok(text)) out.push({ key, s, title, text, a, b }); };
  /* the tempo: one wants it fast, the other slow */
  const pa = R('pace', A), pb = R('pace', B);
  if (pa && pb && ((top(pa) && bottom(pb)) || (top(pb) && bottom(pa)))) {
    const [f, sl, Rf, Rs] = top(pa) ? [A, B, pa, pb] : [B, A, pb, pa];
    add('tempo', 2.2 + (Rf.z - Rs.z) / 3, 'A clash of tempos', pick(seed + 'pace', [
      L.club(f) + ' want this game played fast, ' + one(Rf.v) + ' possessions per 40, ' + rankWord(Rf, 'quickest', 'slowest') + '; ' + L.club(sl) + ' want it slow, at ' + one(Rs.v) + ', ' + rankWord(Rs, 'quickest', 'slowest') + '. Whoever sets the pace will be playing their own game.',
      'Two speeds meet here. ' + L.club(f) + ' play at ' + one(Rf.v) + ' possessions per 40 (' + rankWord(Rf, 'quickest', 'slowest') + '), ' + L.club(sl) + ' at ' + one(Rs.v) + ' (' + rankWord(Rs, 'quickest', 'slowest') + '): the side that drags the game to its tempo has most of the work done.']),
      fig(f, 'possessions per 40', one(Rf.v), Rf), fig(sl, 'possessions per 40', one(Rs.v), { r: Rs.n - Rs.r + 1, n: Rs.n }));
  }
  /* each side's attack against the other's defence, both ways round */
  [[A, B, ta, tb], [B, A, tb, ta]].forEach(([o, d, to, td]) => {
    const no = L.club(o), nd = L.club(d);
    const rim = R('rim_share', o), rimD = R('evd_all_rim_pct', d, -1);
    if (rim && rimD && top(rim) && (bottom(rimD) || top(rimD))) {
      const weak = bottom(rimD);
      add(o + ':rim', (weak ? 2.4 : 1.9) + rim.z / 3, weak ? 'The mismatch inside' : 'Strength on strength inside', weak
        ? pick(seed + 'rim' + o, [no + ' live at the rim, ' + pc(rim.v) + ' of their shots, ' + rankWord(rim, 'most', 'fewest') + ', and ' + nd + ' have been one of the league’s softest touches there: opponents make ' + pc(rimD.v) + ' at the rim against them (' + rankWord(rimD, 'best', 'worst') + '). If ' + no + ' get into the paint, it is their game.',
          (rimD.r === rimD.n ? 'Nobody has been easier to score on inside than ' + nd + ' (' + pc(rimD.v) + ' allowed at the rim)' : 'Few sides have been easier to score on inside than ' + nd + ' (' + pc(rimD.v) + ' allowed at the rim, ' + rankWord(rimD, 'best', 'worst') + ')') +
            ', and few go there as often as ' + no + ' (' + pc(rim.v) + ' of their shots). That is the matchup ' + no + ' will hunt.'])
        : no + ' go to the rim more than almost anybody (' + pc(rim.v) + ' of their shots, ' + rankWord(rim, 'most', 'fewest') + '), and ' + nd + ' protect it better than almost anybody (' + pc(rimD.v) + ' allowed, ' + rankWord(rimD, 'best', 'worst') + '). Something has to give.',
        fig(o, 'of their shots at the rim', pc(rim.v), rim), fig(d, 'allowed at the rim', pc(rimD.v), rimD));
    }
    const three = R('p3_share', o), p3D = R('evd_all_p3_pct', d, -1);
    if (three && p3D && top(three) && (bottom(p3D) || top(p3D))) {
      const weak = bottom(p3D);
      add(o + ':three', (weak ? 2.2 : 1.8) + three.z / 3, weak ? 'Space to shoot' : 'Something has to give from three', weak
        ? no + ' take ' + pc(three.v) + ' of their shots from three, ' + rankWord(three, 'most', 'fewest') + ', and ' + nd + ' have let opponents make ' + pc(p3D.v) + ' from deep (' + rankWord(p3D, 'best', 'worst') + '). It has the look of a night a hot hand from the arc decides.'
        : no + ' shoot more threes than almost anybody (' + pc(three.v) + ' of their shots), and ' + nd + ' defend the arc as well as anybody: opponents make ' + pc(p3D.v) + ' from three against them, ' + rankWord(p3D, 'best', 'worst') + '.',
        fig(o, 'of their shots from three', pc(three.v), three), fig(d, 'allowed from three', pc(p3D.v), p3D));
    }
    const tr = R('ev_transition_freq', o), trD = R('evd_transition_ppp', d, -1);
    if (tr && trD && top(tr) && (bottom(trD) || top(trD)) && num(to.ev_transition_ppp) != null) {
      const weak = bottom(trD);
      add(o + ':run', (weak ? 2.3 : 1.8) + tr.z / 3, weak ? 'Open court' : 'Can ' + nd + ' slow them down?', weak
        ? no + ' get ' + pc(tr.v) + ' of their chances on the break, ' + rankWord(tr, 'most', 'fewest') + ', and ' + nd + ' have been one of the easiest sides in the league to run on: ' + two(trD.v) + ' points a chance allowed in transition (' + rankWord(trD, 'best', 'worst') + '). Every long rebound is an invitation.'
        : no + ' want to run (' + pc(tr.v) + ' of their chances in transition, ' + rankWord(tr, 'most', 'fewest') + '), and ' + nd + ' get back as well as anybody (' + two(trD.v) + ' points a chance allowed on the break, ' + rankWord(trD, 'best', 'worst') + '). If ' + no + ' have to play in the half court, the game changes.',
        fig(o, 'of their chances in transition', pc(tr.v), tr), fig(d, 'allowed a chance on the break', two(trD.v), trD));
    }
    const ob = R('ff_oreb', o), obD = R('dff_oreb', d, -1);
    if (ob && obD && top(ob) && bottom(obD)) add(o + ':glass', 2 + ob.z / 3, 'The battle of the boards',
      no + ' rebound ' + pc(ob.v) + ' of their own misses, ' + rankWord(ob, 'most', 'fewest') + ', and ' + nd + ' give up offensive rebounds on ' + pc(obD.v) + ' of opponents’ misses (' + rankWord(obD, 'best', 'worst') + '). Second chances could be the difference.',
      fig(o, 'of their misses rebounded', pc(ob.v), ob), fig(d, 'offensive rebounds allowed', pc(obD.v), obD));
    const to2 = R('ff_tov', o, -1), toD = R('dff_tov', d);
    if (to2 && toD && bottom(to2) && top(toD)) add(o + ':ball', 2.1 - to2.z / 3, 'Look after the ball',
      no + ' turn it over on ' + pc(to2.v) + ' of their possessions (' + rankWord(to2, 'best', 'worst') + '), and ' + nd + ' force turnovers on ' + pc(toD.v) + ' (' + rankWord(toD, 'best', 'worst') + '). Every loose pass will cost them.',
      fig(o, 'turnover rate', pc(to2.v), to2), fig(d, 'turnovers forced', pc(toD.v), toD));
  });
  /* THE MATCHUP AT A SPOT: each side's main player at the point, on the wing and at the big spot (most minutes there),
     by box plus-minus and VORP, ranked among the league's regulars at the same spot */
  const SPOTS = [['the point', 'point guards', p => p.bpm_pos < 2], ['the wing', 'wings', p => p.bpm_pos >= 2 && p.bpm_pos < 3.6], ['the big spot', 'bigs', p => p.bpm_pos >= 3.6]];
  SPOTS.forEach(([spot, group, inSpot]) => {
    /* five games before a box plus-minus is said at all (three games of +16 is noise, not a player), ten before its VORP
       (the site's is BPM above replacement times the share of minutes: it does not grow with the games, so early it is the
       same noise, larger) */
    const pool = L.regulars.filter(p => num(p.bpm_pos) != null && num(p.bpm) != null && num(p.mpg) >= 18 && num(p.gp) >= 5 && inSpot(p));
    if (pool.length < 6) return;
    const main = id => pool.filter(p => L.teamOf(p) === id).sort((a, c) => c.mpg - a.mpg)[0];
    const pa2 = main(A), pb2 = main(B);
    if (!pa2 || !pb2) return;
    const [hi, lo] = pa2.bpm >= pb2.bpm ? [pa2, pb2] : [pb2, pa2];
    const gap = hi.bpm - lo.bpm, Rh = L.rank(pool, 'bpm', hi.id), Rl = L.rank(pool, 'bpm', lo.id);
    if (!Rh || !Rl || (gap < 3 && !(Rh.r <= 5 && Rl.r <= 5))) return;
    const th = L.teamOf(hi), nh = L.pname(hi.id), nl = L.pname(lo.id), vorp = p => (num(p.vorp) != null && num(p.gp) >= 10 ? one(p.vorp) + ' VORP' : null);
    const both = Rh.r <= 5 && Rl.r <= 5;
    add(spot, both ? 2.1 : 1.7 + gap / 6, both ? 'The heavyweights at ' + spot : cap(spot), both
      ? 'The matchup of the night may be at ' + spot + ': ' + nh + ' (' + signed(hi.bpm) + ' box plus-minus, ' + rankWord(Rh, 'best', 'worst').replace('in the league', 'among the league’s ' + group) + ') against ' + nl + ' (' + signed(lo.bpm) + ', ' + rankWord(Rl, 'best', 'worst').replace('in the league', 'among the league’s ' + group) + ').'
      : 'At ' + spot + ', ' + nh + ' has been one of the league’s most valuable ' + group + ': ' + [signed(hi.bpm) + ' box plus-minus', vorp(hi)].filter(Boolean).join(' and ') + ', ' + rankWord(Rh, 'best', 'worst').replace('in the league', 'among the league’s ' + group) +
        '. Across from ' + L.pr.him + ', ' + possOf(L.club(L.teamOf(lo))) + ' ' + nl + ' is at ' + signed(lo.bpm) + '. It is the matchup ' + L.club(th) + ' will want.',
      fig(th, nh + ', box plus-minus', signed(hi.bpm), Rh), fig(L.teamOf(lo), nl + ', box plus-minus', signed(lo.bpm), Rl));
  });
  /* FORM: the two runs they bring (the season's games in order) */
  const run = id => { const c = L.C.get(id); return c && c.streak && c.streak.n >= 3 ? c.streak : null; };
  const ra = run(A), rb = run(B);
  if (ra && rb && (ra.won || rb.won)) {
    const both = ra.won && rb.won, [h, c2] = ra.won && !rb.won ? [A, B] : rb.won && !ra.won ? [B, A] : [A, B];
    const sh = both ? null : (h === A ? ra : rb), sc = both ? null : (h === A ? rb : ra);
    add('form', both ? 1.6 + Math.min(ra.n, rb.n) / 4 : 1.4 + (sh.n + sc.n) / 6, both ? 'Something has to give' : 'Form going in', both
      ? nA + ' have won ' + spell(ra.n) + ' in a row and ' + nB + ' ' + spell(rb.n) + ': one of those runs ends here.'
      : L.club(h) + ' come in on ' + spell(sh.n) + ' straight wins; ' + L.club(c2) + ' have lost ' + spell(sc.n) + ' in a row. The table and the numbers say one thing, the mood around the two clubs another.',
      { team: A, label: ra.won ? 'wins in a row' : 'defeats in a row', value: String(ra.n), rank: ra.won ? 1 : 2, of: 2 }, { team: B, label: rb.won ? 'wins in a row' : 'defeats in a row', value: String(rb.n), rank: rb.won ? 1 : 2, of: 2 });
  }
  return out.sort((a, c) => c.s - a.s);
}

/* a club's player whose minutes swing it most, said as on and off */
function onOffLine(L, team, seed, named) {
  const pr = L.pr;
  const xs = L.regulars.filter(p => L.teamOf(p) === team && num(p.on_poss) >= 250 && num(p.diff_net) != null && num(p.diff_net) >= 8 && !(named && named.has(L.pname(p.id))))
    .sort((a, c) => c.diff_net - a.diff_net);
  const p = xs[0];
  if (!p) return null;
  if (named) named.add(L.pname(p.id));
  const by = L.club(team) + ' are ' + one(p.diff_net) + ' points per 100 possessions better with ' + L.pname(p.id) + ' on the floor (' + signed(p.on_net) + ') than without ' + pr.him + ' (' + signed(p.off_net) + ').';
  /* "outscored opponents by" only when they have: a side outscored even with him on the floor is said by the difference */
  return ok(num(p.on_net) > 0 ? pick(seed, ['With ' + L.pname(p.id) + ' on the floor, ' + L.club(team) + ' have outscored opponents by ' + one(p.on_net) + ' points per 100 possessions; without ' + pr.him + ', ' + signed(p.off_net) + '.', by]) : by);
}

/* ------------------------------------------------------------------ a slump --- */
function fSlump(L, say) {
  const out = [];
  L.PL.forEach((pl, pid) => {
    const p = L.P.find(x => x.id === pid);
    if (!p || pl.gp < 8 || !L.pname(pid)) return;
    const xs = pl.games, recent = xs.slice(-4), before = xs.slice(0, -4);
    const avg = (arr, k) => mean(arr.map(x => x[k] || 0));
    const bp = avg(before, 'pts'), rp = avg(recent, 'pts'), bm = avg(before, 'min'), rm = avg(recent, 'min');
    if (bp == null || bp < 11 || rp > bp - 5 || rp > bp * 0.65 || rm < bm * 0.7 || L.nowMs - recent[recent.length - 1].at > 9 * DAY) return;
    const teamTop = [...L.PL.values()].filter(q => q.team === pl.team && q.gp >= 5).sort((a, c) => c.ppg - a.ppg).slice(0, 2).map(q => q.pid);
    if (teamTop.indexOf(pid) < 0) return;
    const drop = 1 - rp / bp, ps = L.pos(pl.team);
    const salience = clamp(0.32 + (drop - 0.35) * 0.9 + (teamTop[0] === pid ? 0.14 : 0.06) + (ps && ps.rank <= Math.ceil(ps.n / 2) ? 0.08 : 0) + (bp >= 16 ? 0.08 : 0));
    const wk = Math.floor(L.nowMs / (7 * DAY));
    out.push({ kind: 'slump', id: 'slump:' + pid + ':' + wk, subject: pid, salience, write: () => {
      const pr = L.pr, nm = L.pname(pid), sn = surname(nm), team = L.club(pl.team), seed = 'slump' + pid + wk;
      const last = recent[recent.length - 1], cg = L.C.get(pl.team), res = cg ? cg.games.find(x => x.id === last.game) : null;
      const sum = k => recent.reduce((s, x) => s + (x[k] || 0), 0), bsum = k => before.reduce((s, x) => s + (x[k] || 0), 0);
      const fg = sum('fga') ? [sum('fgm'), sum('fga')] : null, bfg = bsum('fga') ? bsum('fgm') / bsum('fga') * 100 : null;
      const p3 = sum('p3a') >= 6 ? [sum('p3m'), sum('p3a')] : null, bp3 = bsum('p3a') ? bsum('p3m') / bsum('p3a') * 100 : null;
      const won = recent.map(x => (cg ? cg.games.find(y => y.id === x.game) : null)).filter(Boolean);
      const w = won.filter(x => x.won).length;
      const heads = [ 'What has happened to ' + nm + '?', 'Searching for ' + nm, nm + '’s quiet spell, in numbers', nm + ' ' + say('cold', seed + 'hv') + ' — and ' + team + ' have noticed']
        .concat(learnedHeads(L, 'slump', nm));
      const head = headsOf(seed + 'h', heads);
      const dek = one(rp) + ' points a game in ' + pr.his + ' last four, down from ' + one(bp) + '. What has changed, and what has not.';
      const body = [];
      body.push(ok(res ? nm + ' had ' + last.pts + (last.pts === 1 ? ' point' : ' points') + (last.fga ? ' on ' + last.fgm + '-of-' + last.fga + ' shooting' : '') + ' in ' + possOf(team) + ' ' + resultText(L, res, say, seed).replace(/^an? /, '') + ' on ' + L.day(res.at) + '.'
        : nm + ' had ' + last.pts + (last.pts === 1 ? ' point' : ' points') + ' last time out.'));
      const scR = L.rank(L.regulars, 'ppg', pid);
      body.push(ok('It was the fourth game in a row well short of ' + pr.his + ' standard. Through ' + spell(before.length) + ' games ' + pr.he + ' had averaged ' + one(bp) + ' points' +
        (scR && scR.r <= 15 ? ', ' + rankText(scR, seed + 'r', { among: 'among the league’s regulars' }) : '') + '; over the last four it is ' + one(rp) + '.'));
      if (fg) body.push(ok('The shots are not falling. ' + cap(pr.he) + ' is ' + fg[0] + '-of-' + fg[1] + ' from the field across the four (' + pc(fg[0] / fg[1] * 100) + ')' +
        (bfg != null ? ', against ' + pc(bfg) + ' before' : '') + (p3 ? '; from three, ' + p3[0] + ' of ' + p3[1] + (bp3 != null ? ' after ' + pc(bp3) + ' earlier in the season' : '') : '') + '.'));
      const steady = Math.abs(rm - bm) <= 3;
      body.push(ok(steady ? 'It is not a question of opportunity: ' + pr.he + ' has played ' + one(rm) + ' minutes a game over the four, against ' + one(bm) + ' before' +
        (fg && bsum('fga') ? ', and ' + pr.his + ' shot attempts are steady at ' + one(fg[1] / recent.length) + ' a game' : '') + '. That points to a shooting slump rather than a change of role.'
        : 'The minutes have moved too: ' + one(rm) + ' a game over the four, against ' + one(bm) + ' before.'));
      const prof = shotProfile(L, p, pr, seed);
      if (prof) body.push(prof);
      if (num(p.on_net) != null && num(p.off_net) != null && num(p.on_poss) >= 200) body.push(ok(p.diff_net > 0
        ? team + ' have still been better with ' + pr.him + ' this season: ' + signed(p.on_net) + ' points per 100 possessions when ' + pr.he + ' plays, ' + signed(p.off_net) + ' when ' + pr.he + ' sits.'
        : 'The season’s on/off numbers were already against ' + pr.him + ': ' + team + ' are ' + signed(p.on_net) + ' per 100 possessions with ' + pr.him + ' and ' + signed(p.off_net) + ' without.'));
      if (won.length) body.push(ok(team + ' have gone ' + w + '–' + (won.length - w) + ' in those four games.'));
      const ts = L.rank(L.regulars, 'ts', pid);
      body.push(ok('Four games are four games. ' + possOf(sn) + ' true shooting for the season is ' + pc(p.ts) + (ts ? ', ' + rankText(ts, seed + 'ts', { among: 'among the regulars' }) : '') + ', and that is the standard ' + pr.he + ' will be measured against.'));
      const nx = nextText(L, pl.team);
      if (nx) body.push(ok('Next for ' + team + ': ' + nx.line + '.'));
      return { kicker: 'Under the microscope', head, dek, body: body.filter(Boolean), players: [pid], teams: [pl.team],
        links: [playerLink(L, pid), teamLink(L, pl.team)].filter(Boolean),
        facts: [{ label: 'last four', value: one(rp) + ' ppg' }, { label: 'before', value: one(bp) + ' ppg' }, fg ? { label: 'shooting, last four', value: fg[0] + '/' + fg[1] } : null,
          { label: 'minutes, last four', value: one(rm) }, won.length ? { label: 'team, last four', value: w + '–' + (won.length - w) } : null].filter(Boolean) };
    } });
  });
  return out;
}
/* where a player's shots come from, and which situation suits them: one sentence, the most telling half of it */
function shotProfile(L, p, pr, seed) {
  if (num(p.rim_rate) == null || num(p.p3_rate) == null) return null;
  const rr = L.rank(L.regulars, 'rim_rate', p.id), tr = L.rank(L.regulars, 'p3_rate', p.id);
  const lead = rr && rr.r <= 5 && rr.r <= Math.ceil(rr.n / 2) ? (num(p.rim_rate) >= 50 ? 'Most of ' : 'Much of ') + pr.his + ' work is at the rim: ' + pc(p.rim_rate) + ' of ' + pr.his + ' shots come there, ' + rankText(rr, seed + 'rr', { best: 'highest share', worst: 'lowest share' })
    : tr && tr.r <= 5 ? cap(pr.he) + ' lives behind the arc: ' + pc(p.p3_rate) + ' of ' + pr.his + ' shots are threes'
    : 'Over the season ' + pr.his + ' shots split ' + pc(p.rim_rate) + ' at the rim, ' + pc(p.mid_rate) + ' from mid-range and ' + pc(p.p3_rate) + ' from three';
  const t = num(p.ev_transition_efg), h = num(p.ev_half_efg);
  const tail = t != null && h != null && num(p.ev_transition_fga) >= 15 && num(p.ev_half_fga) >= 40
    ? (t - h >= 8 ? ', and ' + pr.he + ' is at ' + pr.his + ' most dangerous in transition (' + pc(t) + ' effective shooting, against ' + pc(h) + ' in the half court)'
      : h - t >= 5 ? ', and ' + pr.he + ' is more efficient in the half court (' + pc(h) + ' effective) than on the break (' + pc(t) + ')' : '') : '';
  return ok(lead + tail + '.');
}
function learnedHeads(L, theme, x) {
  const H = L.style && L.style.heads && L.style.heads[theme];
  return (H || []).slice(0, 4).map(h => h.shape.replace('{X}', x));
}

/* ------------------------------------------------------------------- the MVP --- */
function fMvp(L, say) {
  const q = L.regulars.filter(p => num(p.bpm) != null && num(p.mpg) >= 20).sort((a, c) => c.bpm - a.bpm);
  if (q.length < 6) return [];
  const p = q[0], p2 = q[1], team = L.teamOf(p), ps = L.pos(team);
  if (!ps || ps.rank > Math.max(3, Math.ceil(ps.n / 4)) || num(p.gp) < 6) return [];
  const gap = p.bpm - p2.bpm, fort = Math.floor(L.nowMs / (14 * DAY));
  const salience = clamp(0.42 + Math.min(0.25, gap / 8) + (ps.rank === 1 ? 0.15 : 0.07) + (num(p.gp) >= 10 ? 0.1 : 0.04) + (num(p.diff_net) >= 10 ? 0.05 : 0));
  return [{ kind: 'mvp', id: 'mvp:' + p.id + ':' + fort, subject: p.id, salience, write: () => {
    const pr = L.pr, nm = L.pname(p.id), sn = surname(nm), tn = L.club(team), seed = 'mvp' + p.id + fort, lg = L.lname;
    const head = headsOf(seed + 'h', ['Is ' + nm + ' the best player in the ' + lg + '?', 'The case for ' + nm, nm + ' and the MVP question',
      'Nobody in the ' + lg + ' is doing more than ' + nm].concat(learnedHeads(L, 'mvp', nm)));
    const swing = num(p.diff_net) != null && num(p.on_poss) >= 250 ? p.diff_net : null;
    const dek = one(p.bpm) + ' box plus-minus, ' + tn + ' ' + place(ps.rank) + ' in the table' + (swing != null && swing >= 3 ? ', and a ' + one(swing) + '-point on/off swing' : '') + ': the numbers behind the case.';
    const body = [];
    body.push(ok(pick(seed + 'l', ['In ' + L.gpOf(p) + ' games this season, nobody in the ' + lg + ' has been more productive by box plus-minus than ' + nm + '.',
      'Nobody in the ' + lg + ' has been more productive this season, by box plus-minus, than ' + nm + '.']) + ' ' + cap(pr.his) + ' ' + one(p.bpm) + ' leads the league, ' +
      one(gap) + ' clear of ' + L.pname(p2.id) + '.'));
    body.push(ok(cap(pr.he) + ' is averaging ' + one(p.ppg) + ' points, ' + one(p.rpg) + ' rebounds and ' + one(p.apg) + ' assists in ' + one(p.mpg) + ' minutes, on ' + pc(p.ts) + ' true shooting' +
      (num(p.usg) != null ? ', while using ' + pc(p.usg) + ' of ' + possOf(tn) + ' possessions when ' + pr.he + ' is on the floor' : '') + '.'));
    if (swing != null) {
      const dr = L.rank(L.regulars.filter(x => num(x.on_poss) >= 250), 'diff_net', p.id);
      const on = 'With ' + pr.him + ' on the floor ' + tn + ' have ' + (p.on_net >= 0 ? 'outscored opponents by ' + one(p.on_net) : 'been outscored by ' + one(-p.on_net)) + ' points per 100 possessions; without ' + pr.him + ', ' +
        (p.off_net >= 0 ? (p.on_net >= 0 ? 'by ' : 'they outscore opponents by ') + one(p.off_net) : 'they are outscored by ' + one(-p.off_net)) + '.';
      /* the swing said for what it is: the case made, a deep side (neutral), or the one number against it */
      body.push(ok(swing >= 4 ? 'The team numbers say the same thing. ' + on + (dr && dr.r <= 5 ? ' That swing is ' + rankText(dr, seed + 'd', { among: 'among the league’s regulars' }) + '.' : '')
        : swing > -4 ? 'The team numbers are more even. ' + on + ' That is the mark of a deep side as much as of one player.'
        : 'One number does not fit. ' + on + ' Voters will ask about that.'));
      const ff = [['efg', 'effective shooting', 'on_efg', 'off_efg', 1], ['tov', 'turnover rate', 'on_tov', 'off_tov', -1], ['oreb', 'offensive rebounding', 'on_oreb', 'off_oreb', 1]]
        .map(([k, lab, a, b2, d]) => ({ lab, a: num(p[a]), b: num(p[b2]), g: num(p[a]) != null && num(p[b2]) != null ? d * (p[a] - p[b2]) : -1 })).sort((a, c) => c.g - a.g)[0];
      if (ff && ff.g >= 2 && swing >= 4) body.push(ok('Most of it shows in ' + possOf(tn) + ' ' + ff.lab + ': ' + pc(ff.a) + ' with ' + pr.him + ', ' + pc(ff.b) + ' without.'));
    }
    const prof = shotProfile(L, p, pr, seed);
    if (prof) body.push(prof);
    if (!(prof && /half court/.test(prof)) && num(p.ev_half_ppg) != null && num(p.ev_half_efg) != null && num(p.ev_half_fga) >= 40) body.push(ok('In the half court, where most of a game is played, ' + pr.he + ' has scored ' + one(p.ev_half_ppg) + ' points a game on ' + pc(p.ev_half_efg) + ' effective shooting.'));
    if (num(p.def_rim_fg_on) != null && num(p.def_rim_fg_off) != null && num(p.def_rim_a_on) >= 40 && p.def_rim_fg_off - p.def_rim_fg_on >= 5)
      body.push(ok('At the other end, opponents have made ' + pc(p.def_rim_fg_on) + ' at the rim with ' + pr.him + ' on the floor and ' + pc(p.def_rim_fg_off) + ' without.'));
    const ps2 = L.pos(L.teamOf(p2));
    body.push(ok(say('turn', seed + 't') + ' ' + L.pname(p2.id) + ' has a case of ' + (L.pr.his) + ' own: ' + one(p2.bpm) + ' box plus-minus for ' + L.club(L.teamOf(p2)) + (ps2 ? ', ' + place(ps2.rank) + ' in the table' : '') + '.'));
    const nx = nextText(L, team);
    if (nx) body.push(ok('Next for ' + sn + ' and ' + tn + ': ' + nx.line + '.'));
    return { kicker: 'The MVP race', head, dek, body: body.filter(Boolean), players: [p.id, p2.id], teams: [team], links: [playerLink(L, p.id), teamLink(L, team)].filter(Boolean),
      facts: [{ label: 'box plus-minus', value: one(p.bpm) }, { label: 'points, rebounds, assists', value: one(p.ppg) + ' / ' + one(p.rpg) + ' / ' + one(p.apg) },
        { label: 'true shooting', value: pc(p.ts) }, swing != null ? { label: 'on/off, per 100', value: signed(swing) } : null, { label: tn + ', in the table', value: ordShortN(ps.rank) }].filter(Boolean) };
  } }];
}

/* ---------------------------------------------------------- a young talent --- */
function fProspect(L, say) {
  const bio = L.o.bio || {}, q = L.P.filter(p => num(p.gp) >= 5 && num(p.mpg) >= 14 && num(p.bpm) != null);
  if (q.length < 10) return [];
  const sorted = q.slice().sort((a, c) => c.bpm - a.bpm);
  const out = [];
  q.forEach(p => {
    const age = bio[p.id] && num(bio[p.id].age);
    if (age == null || age >= 22) return;
    const r = sorted.indexOf(p) + 1, pctl = 1 - (r - 1) / sorted.length;
    if (pctl < 0.7) return;
    const month = Math.floor(L.nowMs / (30 * DAY));
    const salience = clamp(0.3 + (pctl - 0.7) * 1.2 + (22 - age) * 0.06 + (num(p.mpg) >= 24 ? 0.06 : 0));
    out.push({ kind: 'prospect', id: 'prospect:' + p.id + ':' + month, subject: p.id, salience, write: () => {
      const pr = L.pr, nm = L.pname(p.id), team = L.teamOf(p), tn = L.club(team), seed = 'young' + p.id + month, a = Math.floor(age);
      const head = headsOf(seed + 'h', ['Is ' + nm + ' the real thing?', a + ' and already among the ' + L.lname + '’s best: ' + nm, 'How good is ' + nm + '?']
        .concat(learnedHeads(L, 'prospect', nm)));
      const dek = 'At ' + a + ', ' + nm + ' is ' + (r === 1 ? 'the league’s best player' : place(r) + ' in the league') + ' by box plus-minus. Here is what the detail says.';
      const per = k => (num(p[k]) != null && num(p.mpg) > 0 ? one(p[k] * 36 / p.mpg) : null);
      const older = sorted.slice(0, r - 1).filter(x => bio[x.id] && num(bio[x.id].age) != null);
      const youngest = older.length === r - 1 && older.every(x => bio[x.id].age > age);
      const body = [];
      body.push(ok(nm + ' is ' + a + '. Of the ' + sorted.length + ' players who have played 14 or more minutes a game in the ' + L.lname + ' this season, ' +
        (r === 1 ? 'none has a better box plus-minus.' : (r === 2 ? 'only one has a better box plus-minus' : 'only ' + spell(r - 1) + ' have a better box plus-minus') + (youngest ? (r === 2 ? ', and that player is older.' : ', and every one of them is older.') : '.'))));
      body.push(ok('Per 36 minutes ' + pr.he + ' is producing ' + per('ppg') + ' points, ' + per('rpg') + ' rebounds and ' + per('apg') + ' assists, on ' + pc(p.ts) + ' true shooting' +
        (mean(L.regulars.map(x => num(x.ts)).filter(v => v != null)) ? ' (the regulars’ average is ' + pc(mean(L.regulars.map(x => num(x.ts)).filter(v => v != null))) + ')' : '') + '.'));
      if (num(p.usg) != null) body.push(ok(cap(pr.he) + ' is using ' + pc(p.usg) + ' of ' + possOf(tn) + ' possessions while on the floor' + (p.usg >= 24 ? ', a lead role at any age' : p.usg <= 16 ? ', and doing it without needing the ball' : '') + '.'));
      const prof = shotProfile(L, p, pr, seed);
      if (prof) body.push(prof);
      if (num(p.diff_net) != null && num(p.on_poss) >= 150) body.push(ok(p.diff_net > 0 ? tn + ' are ' + one(p.diff_net) + ' points per 100 possessions better with ' + pr.him + ' on the floor.'
        : 'The one number against ' + pr.him + ': ' + tn + ' have been ' + one(-p.diff_net) + ' points per 100 possessions better without ' + pr.him + '.'));
      body.push(ok(say('caveat', seed + 't') + ' the sample is ' + spell(p.gp) + ' games and ' + Math.round(num(p.min) || p.mpg * p.gp) + ' minutes — enough to notice, not yet enough to be sure.'));
      const nx = nextText(L, team);
      if (nx) body.push(ok('Next for ' + nm + ': ' + nx.line + '.'));
      return { kicker: 'One for the future', head, dek, body: body.filter(Boolean), players: [p.id], teams: [team], links: [playerLink(L, p.id), teamLink(L, team)].filter(Boolean),
        facts: [{ label: 'age', value: String(a) }, { label: 'box plus-minus', value: one(p.bpm) + ' (' + place(r) + ')' }, { label: 'per 36', value: per('ppg') + ' / ' + per('rpg') + ' / ' + per('apg') },
          { label: 'true shooting', value: pc(p.ts) }].filter(Boolean) };
    } });
  });
  return out;
}

/* ------------------------------------------------------------ what a club is --- */
/* THE TRAITS a club can be built on, each with: its key in the season file, the volume behind it, whether less is
   better, its words (headlines for a strength and for a weakness, the clause that says it, the label on its figure),
   and the next opponent's number that meets it (mirror) */
const FACETS = [
  { k: 'transition', key: 'ev_transition_ppp', vol: 'ev_transition_ch_pg', sit: 'transition', label: 'transition points a chance', noun: 'transition attack', fmt: 'ppp',
    good: ['How {T} became the {L}’s most dangerous team on the break', '{T} are at their best in transition', 'Run with {T} at your peril'],
    bad: ['{T} cannot get anything going on the break'], clause: (T, v) => T + ' score ' + two(v) + ' points a chance in transition',
    mirror: ['evd_transition_ppp', -1, (T, v) => T + ' allow ' + two(v) + ' a chance in transition'] },
  { k: 'half', key: 'ev_half_ppp', vol: 'ev_half_ch_pg', sit: 'half', label: 'half-court points a chance', noun: 'half-court offence', fmt: 'ppp',
    good: ['Inside {T}’s half-court offence', '{T} have the {L}’s best half-court offence'], bad: ['{T}’s half-court problem', 'Where {T}’s offence gets stuck'],
    clause: (T, v) => T + ' score ' + two(v) + ' points a chance in the half court',
    mirror: ['evd_half_ppp', -1, (T, v) => T + ' allow ' + two(v) + ' a chance in the half court'] },
  { k: 'halfD', key: 'evd_half_ppp', vol: 'evd_half_ch_pg', dir: -1, sit: 'half', def: true, label: 'half-court points a chance allowed', noun: 'half-court defence', fmt: 'ppp',
    good: ['Why nobody can score against {T} in the half court', 'The half-court wall: inside {T}’s defence'], bad: ['Where {T} are leaking points', '{T} cannot get stops in the half court'],
    clause: (T, v) => T + ' allow ' + two(v) + ' points a chance in the half court',
    mirror: ['ev_half_ppp', 1, (T, v) => T + ' score ' + two(v) + ' a chance in the half court'] },
  { k: 'second', key: 'ff_oreb', sit: 'second', label: 'offensive rebound rate', noun: 'offensive rebounding', fmt: 'pct',
    good: ['{T} and the art of the second chance', 'Why {T} keep getting a second shot'], bad: ['{T} are not getting second chances'],
    clause: (T, v) => T + ' rebound ' + pc(v) + ' of their own misses',
    mirror: ['dff_oreb', -1, (T, v) => T + ' give up ' + pc(v) + ' of their opponents’ misses'] },
  { k: 'rimD', key: 'evd_all_rim_pct', dir: -1, def: true, label: 'opponents’ shooting at the rim', noun: 'rim protection', fmt: 'pct',
    good: ['Why nobody gets to the rim against {T}', '{T} have made the paint a no-go area'], bad: ['{T} cannot protect the rim', 'The open door: {T} and the rim'],
    clause: (T, v) => 'opponents make ' + pc(v) + ' of their shots at the rim against ' + T,
    mirror: ['rim_share', 1, (T, v) => T + ' take ' + pc(v) + ' of their shots there', { best: 'highest share', worst: 'lowest share' }] },
  { k: 'tovD', key: 'dff_tov', def: true, label: 'turnovers forced', noun: 'ball pressure', fmt: 'pct',
    good: ['{T}’s defence lives on turnovers', 'Ball-hawks: how {T} force the turnovers'], bad: ['{T} are not forcing turnovers'],
    clause: (T, v) => T + ' force a turnover on ' + pc(v) + ' of their opponents’ possessions',
    mirror: ['ff_tov', -1, (T, v) => T + ' turn it over on ' + pc(v) + ' of their possessions'] },
  { k: 'tov', key: 'ff_tov', dir: -1, label: 'turnover rate', noun: 'ball security', fmt: 'pct',
    good: ['{T} do not give the ball away', 'Safe hands: inside {T}’s ball security'], bad: ['{T}’s turnover trouble', 'The numbers behind {T}’s turnover problem'],
    clause: (T, v) => T + ' turn it over on ' + pc(v) + ' of their possessions',
    mirror: ['dff_tov', 1, (T, v) => T + ' force a turnover on ' + pc(v) + ' of possessions'] }
];
const fmtV = (f, v) => (f.fmt === 'ppp' ? two(v) : pc(v));
function fIdentity(L, say) {
  if (L.T.length < 6) return [];
  const out = [], month = Math.floor(L.nowMs / (30 * DAY));
  L.T.forEach(t => {
    if (num(t.gp) < 5) return;
    const best = FACETS.map(f => ({ f, R: L.rank(L.T, f.key, t.id, f.dir) })).filter(x => x.R && (!x.f.vol || num(t[x.f.vol]) >= 4))
      .sort((a, c) => Math.abs(c.R.z) - Math.abs(a.R.z))[0];
    if (!best || Math.abs(best.R.z) < 1.5 || (best.R.r > 1 && best.R.r < best.R.n)) return;
    const ps = L.pos(t.id), good = best.R.z > 0;
    const salience = clamp(0.25 + (Math.abs(best.R.z) - 1.5) * 0.3 + (ps && ps.rank <= Math.ceil(ps.n / 2) ? 0.12 : 0.04) + (good ? 0.06 : 0.03) + 0.12);
    out.push({ kind: 'identity', id: 'identity:' + t.id + ':' + best.f.k + ':' + month, subject: t.id, salience, write: () => identityPiece(L, say, t, best.f, best.R, month) });
  });
  return out;
}
function identityPiece(L, say, t, f, R, month) {
  const tn = L.club(t.id), seed = 'id' + t.id + f.k + month, good = R.z > 0, ps = L.pos(t.id), cg = L.C.get(t.id), pr = L.pr;
  const head = headsOf(seed + 'h', (good ? f.good : f.bad).map(h => h.replace('{T}', tn).replace('{L}', L.lname)));
  const said = cap(f.clause(tn, R.v)) + ', ' + rankText(R, seed + 'r');
  const dek = pick(seed + 'd', good ? [said + '. How they do it, who does it and what it is worth.', 'The numbers behind ' + possOf(tn) + ' ' + f.noun + ', ' + rankText(R, seed + 'r') + '.']
    : [said + '. Where it goes wrong, and what it costs.', 'Inside ' + possOf(tn) + ' ' + f.noun + ', ' + rankText(R, seed + 'r') + ', and what it costs them.']);
  const body = [];
  const wl = cg ? cg.w + '–' + cg.l : null, rec = wl ? wl + (ps ? ', ' + place(ps.rank) + ' in the table' : '') : null;
  /* the hook, then the number */
  if (rec) body.push(ok(pick(seed + 'k', good ? [tn + ' are ' + rec + ', and one number explains a good deal of it.', 'There is one thing ' + tn + ' (' + rec + ') do better than anybody in the ' + L.lname + '.',
      'Ask what ' + tn + ' are built on and the numbers give a clear answer: their ' + f.noun + '.', 'Every good side has something it can lean on. For ' + tn + ' (' + rec + ') it is their ' + f.noun + '.',
      'Look past the ' + wl + ' record and one part of ' + possOf(tn) + ' game stands out from the rest of the ' + L.lname + '.']
    : [tn + ' are ' + rec + ', and one number goes a long way to explaining it.', 'For ' + tn + ' (' + rec + '), one number keeps coming back.',
      'If ' + tn + ' (' + rec + ') want to know where their season is going wrong, their ' + f.noun + ' is the place to start.'])
    .replace('better than anybody in the', R.r === 1 ? 'better than anybody in the' : 'as well as almost anybody in the')));
  body.push(ok((rec ? cap(f.clause(f.k === 'rimD' ? 'them' : 'They', R.v)) + ', ' + rankText(R, seed + 'r') : said) + ', against a league average of ' + fmtV(f, R.avg) + '.'));
  const pre = f.def ? 'evd_' : 'ev_', s = f.sit;
  /* HOW: where the shots in that situation come from, or what the facet turns into */
  if (s && num(t[pre + s + '_rim_sh']) != null && num(t[pre + s + '_fga']) >= 30) {
    const rim = num(t[pre + s + '_rim_sh']), p3 = num(t[pre + s + '_p3_sh']), rp = num(t[pre + s + '_rim_pct']), p3p = num(t[pre + s + '_p3_pct']);
    body.push(ok((f.def ? 'Against them, ' + pc(rim) + ' of the shots opponents take' : cap(pc(rim)) + ' of the shots they take') + ' in ' + (SIT[s] || s) + ' come at the rim' +
      (rp != null ? ', where ' + pc(rp) + ' go in' : '') + (p3 != null ? '; ' + pc(p3) + ' are threes' + (p3p != null ? ', made at ' + pc(p3p) : '') : '') + '.'));
  }
  if (f.k === 'tovD' && num(t.ev_offTo_ppg) != null && num(t.ev_offTo_ppp) != null) {
    const r2 = L.rank(L.T, 'ev_offTo_ppp', t.id);
    body.push(ok((r2 && r2.r > r2.n / 2 ? 'What they do with them is another matter: ' : 'And they make them count: ') + one(t.ev_offTo_ppg) + ' points a game off turnovers, at ' + two(t.ev_offTo_ppp) + ' a chance' + (r2 ? ', ' + rankText(r2, seed + 'o') : '') + '.'));
  }
  if (f.k === 'tov') {
    const h = num(t.ev_half_tov_pct), tr = num(t.ev_transition_tov_pct);
    if (h != null && tr != null && Math.abs(h - tr) >= 3) body.push(ok('Most of the damage is ' + (h > tr ? 'in the half court, where ' + pc(h) + ' of their chances end in a turnover against ' + pc(tr) + ' on the break'
      : 'on the break, where ' + pc(tr) + ' of their chances end in a turnover against ' + pc(h) + ' in the half court') + '.'));
    if (num(t.evd_offTo_ppg) != null) body.push(ok('Opponents score ' + one(t.evd_offTo_ppg) + ' points a game off them.'));
  }
  if (f.k === 'rimD' && num(t.evd_all_rim_sh) != null) {
    const r2 = L.rank(L.T, 'evd_all_rim_sh', t.id, -1);
    if (r2) body.push(ok(r2.r <= 3 ? 'Opponents have mostly stopped trying: only ' + pc(t.evd_all_rim_sh) + ' of their shots against them come at the rim, ' + (r2.r === 1 ? 'the lowest share in the league' : place(r2.r) + '-lowest in the league') + '.'
      : r2.r > r2.n - 3 ? 'Opponents keep coming, ' + pc(t.evd_all_rim_sh) + ' of their shots at the rim, one of the highest shares in the league; they just do not finish.'
      : 'Opponents still take ' + pc(t.evd_all_rim_sh) + ' of their shots at the rim against them, about the league’s norm (' + pc(r2.avg) + '); they just make fewer.'));
  }
  /* WHAT IT IS WORTH: the points a game against an average side's return, or the league's model's step */
  if (f.fmt === 'ppp' && f.vol && num(t[f.vol]) != null) {
    const w = (f.dir === -1 ? -1 : 1) * (R.v - R.avg) * num(t[f.vol]);
    if (Math.abs(w) >= 0.8) body.push(ok('Against the league’s average return, that is worth about ' + one(Math.abs(w)) + ' points a game ' + (w > 0 ? 'to them' : 'against them') + '.'));
  } else if (L.lens && L.lens.rows) {
    const lr = L.lens.rows.find(x => x.k === ({ second: 'orebp', tovD: 'tovp', tov: 'tovp' })[f.k]);
    if (lr) body.push(ok('In this league, one standard step on ' + lr.label + ' has been worth about ' + one(lr.pts) + ' points a game' + (L.lens.model ? ', by the league’s own model of what wins' : '') + '.'));
  }
  /* WHO: the players carrying it */
  const mine = L.regulars.filter(p => L.teamOf(p) === t.id);
  const two2 = (key, unit) => mine.filter(p => num(p[key]) != null).sort((a, c) => c[key] - a[key]).slice(0, 2);
  if (s && !f.def && f.k !== 'second') {
    const who = two2('ev_' + s + '_ppg');
    if (who.length === 2 && num(who[1]['ev_' + s + '_ppg']) >= 1) body.push(ok(L.pname(who[0].id) + ' (' + one(who[0]['ev_' + s + '_ppg']) + ' a game) and ' + L.pname(who[1].id) + ' (' + one(who[1]['ev_' + s + '_ppg']) + ') score the most of it.'));
  }
  const pair = (key, what) => { const w = two2(key); return w.length === 2 && num(w[1][key]) > 0 ? L.pname(w[0].id) + ' (' + one(w[0][key]) + ' ' + what + ' a game) and ' + L.pname(w[1].id) + ' (' + one(w[1][key]) + ')' : null; };
  if (f.k === 'second') { const w = pair('orpg', 'offensive rebounds'); if (w) body.push(ok(w + ' lead the charge on the glass.')); }
  if (f.k === 'tovD') { const w = pair('spg', 'steals'); if (w) body.push(ok(w + ' do the most to take it away.')); }
  if (f.k === 'tov' && !good) { const w = pair('topg', 'turnovers'); if (w) body.push(ok(w + ' give it away the most.')); }
  if (f.k === 'rimD') {
    const guard = mine.filter(p => num(p.def_rim_fg_on) != null && num(p.def_rim_fg_off) != null && num(p.def_rim_a_on) >= 40)
      .sort((a, c) => (c.def_rim_fg_off - c.def_rim_fg_on) - (a.def_rim_fg_off - a.def_rim_fg_on))[0];
    if (guard && guard.def_rim_fg_off - guard.def_rim_fg_on >= 4) body.push(ok('The anchor is ' + L.pname(guard.id) + ': opponents make ' + pc(guard.def_rim_fg_on) + ' at the rim with ' + pr.him + ' on the floor and ' + pc(guard.def_rim_fg_off) + ' without.'));
    else { const w = pair('bpg', 'blocks'); if (w) body.push(ok(w + ' do most of the shot-blocking.')); }
  }
  /* THE OTHER SIDE OF THEM: the facet furthest the other way */
  const other = FACETS.filter(x => x.k !== f.k).map(x => ({ x, R: L.rank(L.T, x.key, t.id, x.dir) })).filter(x => x.R).sort((a, c) => (good ? a.R.z - c.R.z : c.R.z - a.R.z))[0];
  if (other && (good ? other.R.z < -0.8 : other.R.z > 0.8)) body.push(ok((good ? say('turn', seed + 't') + ' there is another side to them: ' : 'It is not all bad: ') + other.x.clause(tn, other.R.v) + ', ' + rankText(other.R, seed + 'w') + '.'));
  /* NEXT: the opponent's number that meets it */
  const nx = nextText(L, t.id);
  if (nx) {
    const mr = f.mirror ? L.rank(L.T, f.mirror[0], nx.opp, f.mirror[1]) : null;
    body.push(ok('Next: ' + nx.line + '.' + (mr ? ' ' + cap(f.mirror[2](L.club(nx.opp), mr.v)) + ', ' + rankText(mr, seed + 'n', f.mirror[3]) + '.' : '')));
  }
  return { kicker: good ? 'What makes them tick' : 'The problem', head, dek, body: body.filter(Boolean), teams: [t.id], links: [teamLink(L, t.id)].filter(Boolean),
    facts: [{ label: f.label, value: fmtV(f, R.v) }, { label: 'league rank', value: ordShortN(R.r) + ' of ' + R.n }, { label: 'league average', value: fmtV(f, R.avg) },
      cg ? { label: 'record', value: cg.w + '–' + cg.l } : null].filter(Boolean) };
}
const ordShortN = n => { const v = Math.round(+n), t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };

/* ---------------------------------------------------------- a run, inside --- */
function fRun(L, say) {
  const out = [];
  ((L.b && L.b.stories) || []).filter(s => (s.kind === 'run' || s.kind === 'skid') && s.status !== 'resolved').forEach(s => {
    const id = (s.teams || [])[0], cg = id ? L.C.get(id) : null;
    if (!cg || !cg.streak || cg.streak.n < 5) return;
    const won = s.kind === 'run', run = cg.games.filter(x => cg.streak.games.indexOf(x.id) >= 0), rest = cg.games.filter(x => cg.streak.games.indexOf(x.id) < 0 && !x.tied);
    if (rest.length < 2) return;
    const salience = clamp(0.35 + Math.min(0.3, (cg.streak.n - 4) * 0.07) + (won ? 0.08 : 0.05) + (s.score ? Math.min(0.15, s.score / 60) : 0));
    out.push({ kind: won ? 'run' : 'skid', id: 'run:' + id + ':' + cg.streak.from, subject: id, salience, write: () => {
      const tn = L.club(id), n = cg.streak.n, seed = 'run' + id + cg.streak.from;
      const head = won ? headsOf(seed + 'h', ['Inside ' + possOf(tn) + ' ' + spell(n) + '-game winning run', 'How ' + tn + ' won ' + spell(n) + ' in a row', 'What is behind ' + possOf(tn) + ' run'].concat(learnedHeads(L, 'run', tn)))
        : headsOf(seed + 'h', ['What has gone wrong at ' + tn + '?', possOf(tn) + ' slide, in numbers', spell(n) + ' straight defeats: inside ' + possOf(tn) + ' slump'].map(cap));
      const avgM = mean(run.map(x => x.for - x.against));
      const ff = factorsOver(L, id, run, rest);
      const lead = ff[0];
      const dek = cap(spell(n)) + ' straight ' + (won ? 'wins' : 'defeats') + ', by an average of ' + one(Math.abs(avgM)) + ' points.' + (lead ? ' The numbers say it comes down to ' + lead.label + '.' : '');
      const last = run[run.length - 1], body = [];
      body.push(ok(tn + ' have ' + (won ? 'won ' : 'lost ') + spell(n) + ' in a row, the latest ' + resultText(L, last, say, seed) + ' on ' + L.day(last.at) + '.'));
      if (ff.length) body.push(ok((won ? 'In the run' : 'In the slide') + ' they have ' + ff.slice(0, 2).map(x => x.say).join(', and ') + '.'));
      body.push(ok('They are scoring ' + one(mean(run.map(x => x.for))) + ' and allowing ' + one(mean(run.map(x => x.against))) + ' a game in it, against ' + one(mean(rest.map(x => x.for))) + ' and ' + one(mean(rest.map(x => x.against))) + ' before.'));
      const star = [...L.PL.values()].filter(p => p.team === id).map(p => { const g = p.games.filter(x => cg.streak.games.indexOf(x.game) >= 0), b2 = p.games.filter(x => cg.streak.games.indexOf(x.game) < 0);
        return { p, r: mean(g.map(x => x.pts)), b: mean(b2.map(x => x.pts)), n: g.length }; }).filter(x => x.n >= Math.ceil(n / 2) && x.r != null && x.b != null && L.pname(x.p.pid))
        .sort((a, c) => (won ? (c.r - c.b) - (a.r - a.b) : (a.r - a.b) - (c.r - c.b)))[0];
      if (star && Math.abs(star.r - star.b) >= 3) body.push(ok(L.pname(star.p.pid) + ' has averaged ' + one(star.r) + ' points in the run, ' + (star.r > star.b ? 'up' : 'down') + ' from ' + one(star.b) + ' before.'));
      const five = bestFive(L, id);
      if (five) body.push(ok('The five on the floor most in the replayed games, ' + list(five.n.map(surname)) + ', have ' + (five.pf >= five.pa ? 'outscored opponents by ' + (five.pf - five.pa) : 'been outscored by ' + (five.pa - five.pf)) + ' in ' + Math.round(five.dur / 60) + ' minutes together.'));
      const close = run.filter(x => Math.abs(x.for - x.against) <= 5).length;
      if (close >= 2) body.push(ok(say('turn', seed + 't') + ' ' + spell(close) + ' of the ' + spell(n) + ' were decided by five points or fewer.'));
      const nx = nextText(L, id);
      if (nx) body.push(ok((won ? 'The run is on the line ' : 'The next chance to stop it: ') + nx.line + '.'));
      return { kicker: won ? 'Inside the run' : 'Inside the slide', head, dek, body: body.filter(Boolean), teams: [id], links: [teamLink(L, id)].filter(Boolean),
        facts: [{ label: won ? 'wins in a row' : 'defeats in a row', value: String(n) }, { label: 'average margin', value: signed(avgM) }].concat(ff.slice(0, 2).map(x => ({ label: x.label, value: x.now + ' (was ' + x.was + ')' }))) };
    } });
  });
  return out;
}
/* the four factors in a set of a club's games against the rest, the changes ranked by what they are worth here */
function factorsOver(L, id, run, rest) {
  const lines = new Map();
  (L.o.teamLines || []).forEach(r => { if (!lines.has(r.game_id)) lines.set(r.game_id, {}); lines.get(r.game_id)[r.team_idx] = r.adv || {}; });
  const side = x => { const g = L.games.find(y => y.id === x.id); return g ? (g.home_team_id === id ? 0 : 1) : null; };
  const avg = (xs, k, opp) => mean(xs.map(x => { const l = lines.get(x.id), s = side(x); return l && s != null && l[opp ? 1 - s : s] ? num(l[opp ? 1 - s : s][k]) : null; }).filter(v => v != null));
  const W = { efg: 2, tovp: 1.4, orebp: 0.7, ftr: 0.4 };
  /* each: the key, its label, the opponents' number or the club's own, and how it is said (better, worse) */
  const F = [['efg', 'shooting', false, ['shot ', '% effective']], ['tovp', 'ball security', false, ['turned it over on ', '% of possessions']],
    ['orebp', 'the offensive glass', false, ['rebounded ', '% of their own misses']],
    ['efg', 'their defence', true, ['held opponents to ', '% effective shooting'], ['let opponents shoot ', '% effective']]];
  return F.map(([k, label, opp, good, bad]) => {
    const a = avg(run, k, opp), b2 = avg(rest, k, opp);
    if (a == null || b2 == null) return null;
    const better = (k === 'tovp' || opp ? -1 : 1) * (a - b2), w = better < 0 && bad ? bad : good;
    return { label, value: Math.abs(a - b2) * (W[k] || 1), better, now: one(a) + '%', was: one(b2) + '%', say: w[0] + one(a) + w[1] + ' (' + one(b2) + '% before)' };
  }).filter(x => x && x.value >= 1.5).sort((a, c) => c.value - a.value);
}
/* a club's five with the most minutes together in the replayed games (15 minutes or more) */
function bestFive(L, id) {
  const D = L.deep.get(id);
  if (!D) return null;
  return [...D.fives.values()].filter(f => f.dur >= 900).sort((a, c) => c.dur - a.dur)[0] || null;
}

/* ------------------------------------------------------------ the best five --- */
function fFive(L, say) {
  const out = [], wk = Math.floor(L.nowMs / (7 * DAY));
  L.deep.forEach((D, id) => {
    const f = [...D.fives.values()].filter(x => x.dur >= 1200 && x.pf - x.pa >= 15 && x.games >= 2).sort((a, c) => (c.pf - c.pa) - (a.pf - a.pa))[0];
    if (!f) return;
    const pm = f.pf - f.pa, ps = L.pos(id);
    const salience = clamp(0.3 + Math.min(0.35, pm / 60) + Math.min(0.12, (f.dur / 60 - 20) / 150) + (ps && ps.rank <= Math.ceil(ps.n / 2) ? 0.1 : 0.04));
    out.push({ kind: 'five', id: 'five:' + id + ':' + wk, subject: id, salience, write: () => {
      const tn = L.club(id), seed = 'five' + id + wk, mins = Math.round(f.dur / 60), names = f.n.map(surname);
      const head = headsOf(seed + 'h', ['The five who are winning games for ' + tn, possOf(tn) + ' best five, by the numbers', 'Inside the ' + L.lname + '’s most effective lineup']);
      const dek = list(names) + ': +' + pm + ' in ' + mins + ' minutes together over the last fortnight.';
      const share = D.dur ? f.dur / D.dur : null;
      const body = [];
      body.push(ok('Over the last fortnight, in ' + spell(f.games) + ' replayed games, ' + list(f.n) + ' have shared the floor for ' + mins + ' minutes for ' + tn + ' and outscored opponents by ' + pm + ', ' + f.pf + ' points to ' + f.pa + '.'));
      body.push(ok('That is ' + signed(pm / mins * 40) + ' points per 40 minutes' + (D.dur ? ', against ' + signed((D.pf - D.pa) / (D.dur / 60) * 40) + ' per 40 for the club as a whole in the same games' : '') + '.'));
      if (share) body.push(ok('They have played ' + Math.round(share * 100) + '% of the club’s minutes in those games together' + (share < 0.25 ? ' — an argument for more' : '') + '.'));
      body.push(ok(say('caveat', seed + 't') + ' ' + mins + ' minutes is a small sample, and a lineup’s numbers move quickly.'));
      const nx = nextText(L, id);
      if (nx) body.push(ok('Next: ' + nx.line + '.'));
      return { kicker: 'Lineup lab', head, dek, body: body.filter(Boolean), teams: [id], links: [teamLink(L, id)].filter(Boolean),
        facts: [{ label: 'together', value: mins + ' min' }, { label: 'plus-minus', value: '+' + pm }, { label: 'per 40', value: signed(pm / mins * 40) }] };
    } });
  });
  return out;
}

/* ---------------------------------------------------------- the shot clock --- */
function fClock(L, say) {
  const rows = [];
  L.deep.forEach((D, id) => {
    const [nE, pE, nM, pM, nL, pL] = D.clock;
    if (nE + nM + nL < 120 || nL < 25) return;
    rows.push({ id, late: pL / nL, lateN: nL, early: (nE + nM) ? (pE + pM) / (nE + nM) : null, share: nL / (nE + nM + nL), dur: D.durN ? D.durSum / D.durN : null });
  });
  if (rows.length < 6) return [];
  const R = (k, id, d) => L.rank(rows, k, id, d);
  const best = rows.map(r => ({ r, R: R('late', r.id) })).filter(x => x.R && x.R.r === 1)[0];
  if (!best || best.R.z < 1.3) return [];
  const wk = Math.floor(L.nowMs / (7 * DAY)), id = best.r.id;
  const salience = clamp(0.3 + (best.R.z - 1.3) * 0.25 + 0.15);
  return [{ kind: 'clock', id: 'clock:' + id + ':' + wk, subject: id, salience, write: () => {
    const tn = L.club(id), r = best.r, seed = 'clock' + id + wk, dr = R('dur', id);
    const head = headsOf(seed + 'h', [tn + ' are the ' + L.lname + '’s late-clock specialists', 'Beat the clock: how ' + tn + ' score when time runs short']);
    const dek = two(r.late) + ' points a chance when the shot clock is past 16 seconds, the best in the league over the last fortnight.';
    const body = [];
    const lgLate = mean(rows.map(x => x.late)), lgDrop = mean(rows.filter(x => x.early != null).map(x => x.early - x.late));
    body.push(ok('When the shot clock runs down, the ' + L.lname + ' scores ' + two(lgLate) + ' points a chance. ' + tn + ' score ' + two(r.late) + ': over the last fortnight’s replayed games they have taken ' + r.lateN + ' first chances past 16 seconds of the clock, and nobody has done more with them.'));
    if (r.early != null) body.push(ok('Earlier in the clock they score ' + two(r.early) + ' a chance, so a long possession costs them ' + (r.late >= r.early ? 'nothing at all' : two(r.early - r.late) + ' a chance, against ' + two(lgDrop) + ' for the league as a whole') + '.'));
    if (dr) body.push(ok('Their possessions last ' + one(r.dur) + ' seconds on average, ' + (dr.r <= 3 ? 'among the longest in the league' : dr.r > dr.n - 3 ? 'among the shortest in the league' : place(dr.r) + ' in the league by length') + '.'));
    body.push(ok(say('caveat', seed + 't') + ' it is ' + r.lateN + ' possessions, not a season — a few late threes either way would move it.'));
    const nx = nextText(L, id);
    if (nx) body.push(ok('Next: ' + nx.line + '.'));
    return { kicker: 'The shot clock', head, dek, body: body.filter(Boolean), teams: [id], links: [teamLink(L, id)].filter(Boolean),
      facts: [{ label: 'late-clock points a chance', value: two(r.late) }, { label: 'late chances', value: String(r.lateN) }, r.dur ? { label: 'average possession', value: one(r.dur) + ' s' } : null].filter(Boolean) };
  } }];
}

/* ------------------------------------------------------------ a star missing --- */
/* HOW MUCH A MISSING PLAYER CARRIES: what each player is worth to his club, as box plus-minus above a replacement player
   (BPM + 2, the baseline VORP itself uses) times the minutes he has played, and his share of every player's on the club.
   A missing player with a big share is a story; one with a small share is not. The newsdesk's absence storylines say who
   is missing and for how many games (and give a suspension as the reason only when the league has recorded one); this
   weighs it, and says what the games without him have looked like and who has had his minutes. */
function valueOf(L, team) {
  const xs = L.P.filter(p => L.teamOf(p) === team && num(p.bpm) != null && num(p.min) > 0);
  const v = p => Math.max(0, p.bpm + 2) * num(p.min);
  const tot = xs.reduce((a, p) => a + v(p), 0);
  const order = xs.slice().sort((a, c) => v(c) - v(a)).map(p => p.id);
  return { share: id => { const p = xs.find(x => x.id === id); return p && tot > 0 ? v(p) / tot : null; }, rank: id => order.indexOf(id) + 1 };
}
function fAbsence(L, say) {
  const out = [];
  ((L.b && L.b.stories) || []).filter(s => s.kind === 'absence' && s.status !== 'resolved').forEach(s => {
    const pid = (s.players || [])[0], team = (s.teams || [])[0], p = L.P.find(x => x.id === pid), pl = L.PL.get(pid);
    if (!p || !team || !pl) return;
    const V = valueOf(L, team), share = V.share(pid), r = V.rank(pid);
    if (share == null || share < 0.12) return;
    const ps = L.pos(team), missed = num(s.tracks && s.tracks.value) || (s.games || []).length;
    const salience = clamp(0.28 + share * 1.3 + (r === 1 ? 0.1 : 0) + (ps && ps.rank <= Math.ceil(ps.n / 2) ? 0.06 : 0) + Math.min(0.08, missed * 0.025));
    out.push({ kind: 'absence', id: 'absence:' + pid + ':' + pl.lastAt, subject: pid, salience, write: () => {
      const pr = L.pr, nm = L.pname(pid), sn = surname(nm), tn = L.club(team), seed = 'abs' + pid + pl.lastAt, banned = /suspension/i.test(s.kicker || '');
      const cg = L.C.get(team), without = cg ? cg.games.filter(x => x.at > pl.lastAt) : [], withIt = cg ? cg.games.filter(x => x.at <= pl.lastAt && pl.games.some(y => y.game === x.id)) : [];
      if (without.length < 2) return null;                       // the league's own games without him: two at least to say anything
      const w = without.filter(x => x.won).length, l = without.filter(x => !x.won && !x.tied).length;
      const pctS = Math.round(share * 100) + '%';
      const head = headsOf(seed + 'h', [tn + ' without ' + nm + ': what the numbers say they are missing', 'How much is ' + nm + ' worth to ' + tn + '?',
        'The ' + sn + '-shaped hole in ' + possOf(tn) + ' side', tn + ' are learning to live without ' + nm]);
      const nMiss = without.length;
      const dek = nm + ' has missed ' + possOf(tn) + ' last ' + spell(nMiss) + ' games' + (banned ? ', suspended' : '') + '. By box plus-minus and minutes, ' + pr.he + ' carries ' + pctS + ' of what the club’s players are worth.';
      const body = [];
      body.push(ok(tn + ' have played ' + spell(nMiss) + ' games without ' + nm + (banned ? ', who is serving a suspension' : '') + ', and gone ' + w + '–' + l + ' in them.'));
      const br = L.rank(L.regulars, 'bpm', pid);
      body.push(ok('Put how good a player has been together with how much of the game ' + pr.he + ' plays, and ' + nm + ' accounts for ' + pctS + ' of ' + possOf(tn) + ' value this season, ' +
        (r === 1 ? 'the most of anybody on the club' : r === 2 ? 'the second-most on the club' : place(r) + ' on the club') + '. ' + cap(pr.his) + ' box plus-minus is ' + signed(p.bpm) + ' in ' + one(p.mpg) + ' minutes a game' +
        (br && br.r <= 20 ? ', ' + rankText(br, seed + 'b', { among: 'among the league’s regulars' }) : '') + '.'));
      if (num(p.on_net) != null && num(p.off_net) != null && num(p.on_poss) >= 200) body.push(ok(p.diff_net >= 3
        ? 'The team numbers say the same: ' + tn + ' have been ' + signed(p.on_net) + ' per 100 possessions with ' + pr.him + ' on the floor and ' + signed(p.off_net) + ' without.'
        : 'The team numbers soften it: ' + tn + ' have been ' + signed(p.on_net) + ' per 100 possessions with ' + pr.him + ' on the floor and ' + signed(p.off_net) + ' without, a side used to coping.'));
      const ppg = xs => mean(xs.map(x => x.for)), papg = xs => mean(xs.map(x => x.against));
      if (without.length >= 2 && withIt.length >= 3) body.push(ok('In the games without ' + pr.him + ', ' + tn + ' have scored ' + one(ppg(without)) + ' and allowed ' + one(papg(without)) +
        ' a game, against ' + one(ppg(withIt)) + ' and ' + one(papg(withIt)) + ' with ' + pr.him + '.'));
      /* who has had the minutes: the biggest rise in minutes a game, without him against with him */
      const ids = new Set(without.map(x => x.id)), had = new Set(withIt.map(x => x.id));
      const rise = [...L.PL.values()].filter(q => q.team === team && q.pid !== pid && L.pname(q.pid)).map(q => {
        const a = q.games.filter(x => ids.has(x.game)), b2 = q.games.filter(x => had.has(x.game));
        return { q, a: mean(a.map(x => x.min)), b: mean(b2.map(x => x.min)), n: a.length };
      }).filter(x => x.n >= Math.min(2, without.length) && x.a != null && x.b != null).sort((x, y) => (y.a - y.b) - (x.a - x.b))[0];
      if (rise && rise.a - rise.b >= 4) body.push(ok(L.pname(rise.q.pid) + ' has taken on the most of the minutes: ' + one(rise.a) + ' a game without ' + sn + ', up from ' + one(rise.b) + '.'));
      const nx = nextText(L, team);
      if (nx) body.push(ok('Next for ' + tn + ': ' + nx.line + '.'));
      return { kicker: banned ? 'Serving a suspension' : 'The missing piece', head, dek, body: body.filter(Boolean), players: [pid], teams: [team],
        links: [playerLink(L, pid), teamLink(L, team)].filter(Boolean),
        facts: [{ label: 'games missed', value: String(nMiss) }, { label: 'share of the club’s value', value: pctS }, { label: 'box plus-minus', value: signed(p.bpm) },
          { label: 'record without', value: w + '–' + l }] };
    } });
  });
  return out;
}

/* ===================================================== the game to watch, as a card ===
   THE WEEK'S GAME ON A LEAGUE'S FRONT PAGE (newsdesk.js watchCardHTML): the slate's highest stakes in the next seven
   days, with what a card draws - both clubs (record, place, form, run), why it matters (the table, the storylines it
   touches), where it will be decided (the sharpest clashes of the season's numbers, both sides' figures and ranks), the
   season's lean as a chance, a player on each side and the article, if the newsroom wrote one. Built with the file, so
   the page asks for nothing. */
function gameCard(o, b, opts) {
  const L = league(o || {}, b || {}, opts || {});
  const slate = ((b && b.coverage && b.coverage.slate) || []).filter(x => time(x.at) > L.nowMs && time(x.at) < L.nowMs + 7 * DAY)
    .sort((a, c) => c.stakes - a.stakes);
  const g = slate[0];
  if (!g || !g.home || !g.away) return null;
  const side = s => ({ id: s.id, rec: s.rec || null, rank: s.rank || null, form: s.form || null, streak: s.streak || null });
  const why = reasons(L, g.home.id, g.away.id, 'card' + g.game).slice(0, g.rival ? 2 : 3)
    .map(r => ({ title: r.title, text: r.text, off: r.a, def: r.b }));
  /* a rivalry an administrator has named leads the reasons: it is why many will watch */
  if (g.rival) {
    const met = (L.games || []).filter(x => (x.home_team_id === g.home.id && x.away_team_id === g.away.id) || (x.home_team_id === g.away.id && x.away_team_id === g.home.id)).slice(-1)[0];
    const last = met ? (num(met.home_score) > num(met.away_score) ? L.club(met.home_team_id) : L.club(met.away_team_id)) + ' won the last meeting, ' + Math.max(met.home_score, met.away_score) + '\u2013' + Math.min(met.home_score, met.away_score) + '.' : 'Their first meeting of the season.';
    why.unshift({ title: 'The rivalry', text: L.club(g.home.id) + ' and ' + L.club(g.away.id) + ' are rivals, and nobody needs the table to tell them what this one means. ' + last, off: null, def: null });
  }
  const ex = g.expect && isFinite(g.expect.margin) ? g.expect : null;
  const pFav = ex ? 1 / (1 + Math.exp(-0.15 * Math.abs(ex.margin))) : null;
  const named = new Set();
  const players = [g.home, g.away].map(s => {
    const team = s.id, sw = L.regulars.filter(p => L.teamOf(p) === team && num(p.on_poss) >= 250 && num(p.diff_net) >= 6).sort((a, c) => c.diff_net - a.diff_net)[0];
    const w = s.watch && s.watch.name ? s.watch : null;
    const pid = w ? w.pid : sw ? sw.id : null;
    if (!pid || named.has(pid)) return null;
    named.add(pid);
    const row = L.P.find(p => p.id === pid) || null;
    return { team, pid, name: (w && w.name) || L.pname(pid), line: w ? w.line : null, slug: L.slug(pid),
             onoff: row && num(row.on_poss) >= 250 && num(row.on_net) != null && num(row.off_net) != null ? { on: Math.round(row.on_net * 10) / 10, off: Math.round(row.off_net * 10) / 10 } : null };
  }).filter(Boolean);
  const art = ((b && b.articles) || []).find(a => a.kind === 'watch' && (a.links || []).some(l => l.href === 'game/?g=' + g.game));
  return { game: g.game, at: g.at, day: g.day, stakes: g.stakes, rival: !!g.rival, angle: g.angle || null, threads: (g.threads || []).slice(0, 3).map(t => t.line),
           home: side(g.home), away: side(g.away), lean: ex ? { favourite: ex.favourite, margin: Math.round(Math.abs(ex.margin) * 10) / 10, chance: Math.round(pFav * 100) } : null,
           reasons: why, players, article: art ? art.id : null, line: leanText(L, ex) };
}

/* ============================================================ the newsroom === */
const FORMATS = [fWatch, fSlump, fMvp, fProspect, fIdentity, fRun, fFive, fClock, fAbsence];
function candidates(o, b, opts) {
  const L = league(o || {}, b || {}, opts || {});
  L.style = (opts && opts.style) || null;
  const say = sayer(L.style, L.pr);
  const all = [];
  FORMATS.forEach(f => { try { all.push(...f(L, say)); } catch (_) { /* one format's failure leaves the others */ } });
  all.forEach(c => { c.salience = Math.round(c.salience * 1000) / 1000; c.L = L; });
  return all.sort((a, c) => c.salience - a.salience);
}
/* THE HEADLINE TEST (0252): a piece goes out with up to three headlines, readers are shown one each (newsdesk.js), and the
   counts decide. Once its headlines have been shown TEST_SHOWN times between them (the counts as the build reads them,
   halving every fortnight), the one with the best click-through (each pulled towards the test's average) becomes the
   piece's headline for good. */
const TEST_SHOWN = 300;
function decide(a, counts) {
  if (!a || !Array.isArray(a.heads) || a.heads.length < 2 || a.locked) return a;
  const c = counts || [], shown = c.reduce((s2, x) => s2 + (num(x.shown) || 0), 0);
  if (shown < TEST_SHOWN) return a;
  /* each headline's rate pulled towards the test's own average by twenty showings' worth of it, so one barely shown cannot win */
  const avg = c.reduce((s2, x) => s2 + (num(x.opened) || 0), 0) / shown;
  const rate = v => { const x = c.find(y => +y.variant === v) || {}; return ((num(x.opened) || 0) + 20 * avg) / ((num(x.shown) || 0) + 20); };
  const best = a.heads.map((h, v) => v).sort((x, y) => rate(y) - rate(x))[0];
  return Object.assign({}, a, { head: a.heads[best], heads: [a.heads[best]], locked: { v: best, shown: Math.round(shown) } });
}
/* the headlines in the model's order (its guess at each one's click-through, as a newsroom piece of this league), three kept */
function orderHeads(heads, model, league) {
  const FR = root.EpinoiaFeedRank || (typeof require === 'function' ? (() => { try { return require('./feedrank.js'); } catch (_) { return null; } })() : null);
  const list = (Array.isArray(heads) ? heads : [heads]).filter(Boolean);
  if (!model || !FR || !FR.ctrPredict) return list.slice(0, 3);
  return list.map((h, i) => ({ h, i, p: FR.ctrPredict(model, { kind: 'desk', title: h, league_slug: league }) || 0 }))
    .sort((x, y) => y.p - x.p || x.i - y.i).slice(0, 3).map(x => x.h);
}
/* A FORMAT'S WRITER, by version: a piece out already, written by an older writer of its format, is written again from its
   candidate under the same id - its link, its date and the headlines it is being tested with kept, the rest from the
   writer as it is now - and dropped if it no longer has one. How a correction reaches what readers can already open.
     five 2 (2026-10-08): the club's rate per 40 and the five's share of its minutes had been divided by five twice */
const WRITER = { five: 2 };
const writerOf = kind => WRITER[kind] || 1;
function publish(o, b, opts) {
  const op = opts || {};
  const nowMs = op.nowMs || (o && o.now instanceof Date ? o.now.getTime() : Date.now());
  const lslug = o && o.league ? o.league.slug : null;
  const cands = candidates(o, b, Object.assign({}, op, { nowMs }));
  /* the pieces already out: kept as written (or written again, above), a headline test decided once it has run long enough */
  const prev = (op.previous || []).filter(a => a && a.id && time(a.written) != null && nowMs - time(a.written) < KEEP_DAYS * DAY)
    .map(a => {
      if ((a.wv || 1) >= writerOf(a.kind)) return a;
      const c = cands.find(x => x.id === a.id);
      let w = null;
      try { w = c ? c.write() : null; } catch (_) { w = null; }
      if (!w || (w.body || []).filter(x => typeof x === 'string').length < 3) return null;
      return Object.assign({}, a, { kicker: w.kicker, dek: w.dek, body: w.body, facts: w.facts, links: w.links, teams: w.teams, players: w.players,
                                    wv: writerOf(a.kind), corrected: new Date(nowMs).toISOString() });
    }).filter(Boolean)
    .map(a => decide(a, op.ctr ? op.ctr[a.id] : null));
  const have = new Set(prev.map(a => a.id));
  const lately = new Map(prev.map(a => [a.kind + '|' + a.subject, time(a.written)]));
  const week = prev.filter(a => nowMs - time(a.written) < 7 * DAY).length;
  /* op.all (a local run's --articles all): every candidate written, whatever its salience, to read them */
  let room = op.all ? 99 : Math.max(0, Math.min(MAX_NEW, MAX_WEEK - week));
  const fresh = [];
  const weighed = c => c.salience * (op.kindW && op.kindW[c.kind] ? op.kindW[c.kind] : 1);
  for (const c of cands.slice().sort((x, y) => weighed(y) - weighed(x))) {
    if (!room) break;
    /* what readers open: a format whose pieces they open more than the newsroom's average is a little more salient */
    const kw = op.kindW && op.kindW[c.kind] ? op.kindW[c.kind] : 1;
    if ((c.salience * kw < SALIENCE && !op.all) || have.has(c.id)) continue;
    const at = lately.get(c.kind + '|' + c.subject);
    if (at != null && nowMs - at < SUBJECT_DAYS * DAY && !op.all) continue;
    let a = null;
    try { a = c.write(); } catch (_) { a = null; }
    if (a) { const hs = orderHeads(a.head, op.model, lslug).filter(ok); a.head = hs[0] || null; if (hs.length > 1) a.heads = hs; }
    if (!a || !a.head || (a.body || []).filter(x => typeof x === 'string').length < 3) continue;
    fresh.push(Object.assign({ id: c.id, kind: c.kind, subject: c.subject, salience: c.salience, written: new Date(nowMs).toISOString(), wv: writerOf(c.kind) }, a));
    lately.set(c.kind + '|' + c.subject, nowMs);
    room--;
  }
  return fresh.concat(prev).sort((a, c) => time(c.written) - time(a.written)).slice(0, MAX_KEEP);
}

return { publish, candidates, digest, learn, gameCard, SALIENCE, BOOK, __x: { rankText, rankWord, reasons, onOffLine, sayer, league, leanText } };
}));
