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
const CARD_BAR = 0.4;           // the game to watch: stakes x what its card can say x quality, at least
const SALIENCE = 0.6, MAX_NEW = 2, MAX_WEEK = 8, KEEP_DAYS = 21, SUBJECT_DAYS = 14, MAX_KEEP = 16;
/* A WEEK'S PREVIEW HAS A BAR OF ITS OWN (Louie, 2026-10-08: "loosen the bar for weekly previews"): a league's week is worth
   its preview even early in a season, when less is at stake and fewer games have something to say (the editor sends
   those to the preview's round-up). Every other format posts at SALIENCE. */
const BAR = { watch: 0.45 };
const barOf = kind => (BAR[kind] != null ? BAR[kind] : SALIENCE);
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
/* THE HOUSE VOICE (voice.js): every piece is written by a writer that plans its sentences, makes them grammatical and
   reads them back; the clubs and players in a piece go to it as entities, so it can name them, then call them "the
   hosts" or by surname, then "they" or "she" */
const VOICE = () => root.EpinoiaVoice || (typeof require === 'function' ? require('./voice.js') : null);
/* THE EDITOR (scrutiny.js): the last reader of every piece and card before it is posted */
const EDITOR = () => root.EpinoiaScrutiny || (typeof require === 'function' ? (() => { try { return require('./scrutiny.js'); } catch (_) { return null; } })() : null);
/* the league's next game for each club (a record claimed for a later game can change before it), its clubs' names */
function editorMeta(L, o) {
  const schedule = {}, clubs = [];
  const tm = o && o.teams ? (o.teams instanceof Map ? [...o.teams.keys()] : Object.keys(o.teams)) : [];
  tm.forEach(id => { const f = L.nextOf(id); if (f) schedule[id] = f.id; const n = L.club(id); if (n) clubs.push(n); });
  return { schedule, clubs };
}
/* a piece through the editor: { piece (fixed, its report as qa), ok } */
function edit(a, meta, nowMs, game) {
  const E = EDITOR();
  const log = a.__log || [], sections = a.__sections || null, roundup = !!a.__roundup;
  delete a.__log; delete a.__sections; delete a.__roundup;
  if (!E) return { piece: a, ok: true };
  const q = E.scrutinise(a, { log, schedule: meta.schedule, clubs: meta.clubs, sectionGame: sections, game: game || null, nowMs, roundup });
  return { piece: Object.assign(q.piece, { qa: q.report }), ok: q.report.ok };
}
const eClub = (L, id, role) => VOICE().club(L.club(id), { id, role: role || null });
const ePlayer = (L, pid) => VOICE().person(L.pname(pid), { id: pid, g: L.gender === 'women' ? 'f' : 'm' });
const prons = L => ({ he: L.pr.he, his: L.pr.his, him: L.pr.him, He: cap(L.pr.he), His: cap(L.pr.his) });
const nextCtx = (L, id) => { const f = L.nextOf(id); if (!f) return null; const home = f.home_team_id === id, opp = home ? f.away_team_id : f.home_team_id;
  return { day: L.day(time(f.tipoff_at)), where: (home ? 'at home to ' : 'away at ') + L.club(opp), opp, game: f.id }; };

/* ============================================================== the formats ===
   Each format looks at the league and returns its candidates: { kind, id, subject, salience, write() }. write() is
   called only for the ones chosen, and returns the article or null (a candidate whose evidence will not fill a body). */

/* THE SITUATIONS, as the season file keeps them: a club's points a chance and share of its chances in each, for and
   against (ev_ / evd_), and the zones its shots in them came from */
const SIT = { transition: 'transition', half: 'the half court', second: 'second chances', offTo: 'points off turnovers', ato: 'after timeouts' };

/* ---------------------------------------------------------- games to watch --- */
/* the season's lean on a game, said in its band: a toss-up, slightly, better, clear favourites */
const leanText = (L, ex, W, eFav, eDog) => {
  if (!ex || !isFinite(ex.margin)) return null;
  const m = Math.abs(ex.margin), w = W || VOICE().writer('lean' + ex.favourite);
  return w.say('game.lean', { band: m < 2 ? 'tossup' : m < 4.5 ? 'slight' : m < 8 ? 'clear' : 'heavy', Fav: eFav || eClub(L, ex.favourite), Dog: eDog || null });
};
/* WHY A GAME MATTERS, said (voice.js stakes): both unbeaten, the top two, a streak against a slide, the rematch; early on,
   matching records and the last results. `said`: the results a piece has already told (a Set of game ids), never told twice */
function stakesOf(L, g, W, eA, eB, said) {
  const A = g.home.id, B = g.away.id, fresh = id => { const f = L.nextOf(id); return !!f && f.id === g.game; };
  const cA = fresh(A) ? L.C.get(A) : null, cB = fresh(B) ? L.C.get(B) : null;
  const met = (L.games || []).filter(x => (x.home_team_id === A && x.away_team_id === B) || (x.home_team_id === B && x.away_team_id === A));
  /* each club's last result (only for a club whose next game this is: another game first would change it) */
  const lastOf = id => {
    const gs = (L.games || []).filter(x => (x.home_team_id === id || x.away_team_id === id) && num(x.home_score) != null && num(x.away_score) != null && +x.home_score !== +x.away_score);
    const x = gs.sort((p, q) => time(q.tipoff_at) - time(p.tipoff_at))[0];
    if (!x) return null;
    const home = x.home_team_id === id;
    return { won: home === (+x.home_score > +x.away_score), opp: L.club(home ? x.away_team_id : x.home_team_id), id: x.id };
  };
  const fresh0 = r => (r && said && said.has(r.id) ? null : r);
  const la = cA ? fresh0(lastOf(A)) : null, lb = cB ? fresh0(lastOf(B)) : null;
  /* THE TABLE ONCE IT MEANS SOMETHING: three games each, as the slate's own angle asks (narrative.js). Before that a
     league's table is its default order, and "top of the table is up for grabs" would be said of two clubs yet to play */
  const gpOf = id => { const c = L.C.get(id); return c ? (c.gp != null ? +c.gp : (+c.w || 0) + (+c.l || 0)) : 0; };
  const enough = Math.min(gpOf(A), gpOf(B)) >= 3;
  const out = VOICE().stakes(W, { A: eA, B: eB, rankA: enough ? num(g.home.rank) : null, rankB: enough ? num(g.away.rank) : null, n: ((L.pos(A) || L.pos(B)) || {}).n || 0,
    recA: cA ? { w: cA.w, l: cA.l } : null, recB: cB ? { w: cB.w, l: cB.l } : null,
    lastA: la, lastB: lb,
    runA: cA && cA.streak ? { won: cA.streak.won, n: cA.streak.n } : null, runB: cB && cB.streak ? { won: cB.streak.won, n: cB.streak.n } : null,
    meetings: met.map(m => ({ aWon: (m.home_team_id === A) === (num(m.home_score) > num(m.away_score)), hi: Math.max(m.home_score, m.away_score), lo: Math.min(m.home_score, m.away_score) })) });
  /* the last results it could have told are told (kept from a second telling even when another line was chosen) */
  if (said && out.c && out.c.form) { if (la) said.add(la.id); if (lb) said.add(lb.id); }
  return out;
}
function fWatch(L, say) {
  const week = ((L.b && L.b.coverage && L.b.coverage.slate) || []).filter(x => time(x.at) > L.nowMs && time(x.at) < L.nowMs + 7 * DAY && x.stakes >= 0.5)
    .sort((a, c) => c.stakes - a.stakes);
  /* THE GAMES THERE IS SOMETHING TO SAY ABOUT, first (2026-10-08): a game both clubs play next (their records and last
     results can be told: another game first would change them), one with a lean, a player to watch or a reason. A club
     playing twice this week has nothing safe to say about its second game until it has played the first. */
  const next = (id, x) => { const n = L.nextOf(id); return !!n && n.id === x.game; };
  const sayable = x => (next(x.home.id, x) && next(x.away.id, x)) || !!x.expect || !!(x.home.watch || x.away.watch) ||
    (() => { try { return reasons(L, x.home.id, x.away.id, 'probe' + x.game).length > 0; } catch (_) { return false; } })();
  const pick = week.filter(sayable);
  const slate = (pick.length >= 2 ? pick : week).slice(0, 3);
  if (slate.length < 2) return [];
  const first = new Date(Math.min(...slate.map(x => time(x.at))));
  const wk = first.getUTCFullYear() + '-' + Math.ceil(((first - Date.UTC(first.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  const salience = clamp(0.35 + slate[0].stakes / 2.6 + (slate.length >= 3 ? 0.08 : 0) + (slate[1].stakes >= 1 ? 0.07 : 0) + (slate.some(x => x.rival) ? 0.08 : 0));
  return [{ kind: 'watch', id: 'watch:' + wk, subject: 'week:' + wk, salience, write: () => {
    /* seeded by the league too: every league writes its week's piece the same week, and a feed showing several should not
       read the same headline shape down the page */
    const seed = 'watch' + wk + ((L.o.league && L.o.league.id) || ''), top = slate[0];
    const V = VOICE(), W = V.writer(seed);
    const ent = g => [eClub(L, g.home.id, 'the hosts'), eClub(L, g.away.id, 'the visitors')];
    const [tA, tB] = ent(top);
    const c0 = { A: tA, B: tB, league: L.lname, count: spell(slate.length), day: top.day, Day: cap(top.day) };
    const head = headsOf(seed + 'h', W.all('watch.head', c0));
    const dek = W.say('watch.dek', c0);
    const body = [];
    const used = new Set(), named = new Set(), secGame = { 0: top.game }, said = new Set();
    /* WHAT THE PREVIEW SAID OF EACH GAME, kept on the piece (2026-10-08): the match report reads it back after the game -
       the favourite and by how much, the reason with its two figures, the player named - and says how it played out */
    const games = [];
    slate.forEach((g, i) => {
      const h = g.home.id, a = g.away.id, [eH, eA] = i === 0 ? [tA, tB] : ent(g);
      if (i === 0) body.push(ok([W.say('watch.lede', c0)].concat(stakesOf(L, g, W, eH, eA, said).lines).filter(Boolean).join(' ')));
      body.push({ h: L.club(h) + ' v ' + L.club(a) + ' · ' + g.day });
      W.section(g.game);
      secGame[i + 1] = g.game;
      if (i > 0) { const st = stakesOf(L, g, W, eH, eA, said).lines; if (st.length) body.push(st.join(' ')); }
      const e = reasons(L, h, a, seed + i, W, eH, eA).filter(x => !used.has(x.key))[0], ew = e ? e.write() : null;
      if (ew) { body.push(ew.text); used.add(e.key); }
      const onoff = [[h, eH], [a, eA]].map(([t, et]) => onOffLine(L, t, W, named, et)).filter(Boolean)[0];
      if (onoff) body.push(onoff);
      const w = [g.home.watch, g.away.watch].find(x => x && !named.has(x.name));
      if (w) named.add(w.name);
      const fav = g.expect ? g.expect.favourite : null;
      const [eF, eD] = fav === h ? [eH, eA] : [eA, eH];
      body.push(ok([leanText(L, g.expect, W, eF, eD), w && w.pid ? W.say('game.player', { P: ePlayer(L, w.pid), line: w.line }) : null].filter(Boolean).join(' ')));
      games.push({ game: g.game, at: g.at, home: h, away: a, top: i === 0,
        lean: g.expect && isFinite(g.expect.margin) && g.expect.favourite ? { favourite: g.expect.favourite, margin: Math.round(Math.abs(g.expect.margin) * 10) / 10 } : null,
        reason: ew && e ? { key: e.key, slot: e.slot, a: e.a || null, b: e.b || null } : null,
        player: w && w.pid ? { pid: w.pid, name: w.name, team: w === g.home.watch ? h : a, line: w.line || null } : null });
    });
    return { __log: W.log(), __sections: secGame, __roundup: true, kicker: 'Games to watch', head, dek, body: body.filter(Boolean), teams: [top.home.id, top.away.id],
      links: slate.map(g => ({ label: L.club(g.home.id) + ' v ' + L.club(g.away.id), href: 'game/?g=' + g.game })),
      facts: slate.map(g => ({ label: g.day, value: L.club(g.home.id) + ' v ' + L.club(g.away.id) })), games };
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
/* the top and the bottom of a ranking: a fifth of the league, at least three places - two in a pool under ten (early in a
   season six clubs may be ranked, and three of six is half the league, not "one of the easiest teams to run against") */
const band = R => Math.max(R.n >= 10 ? 3 : 2, Math.round(R.n / 5));
const top = R => R && R.r <= band(R), bottom = R => R && R.r > R.n - band(R);
const fig = (team, label, value, R) => ({ team, label, value, rank: R.r, of: R.n });
function reasons(L, A, B, seed, W0, eA0, eB0) {
  const ta = L.trow(A), tb = L.trow(B);
  if (!ta || !tb) return [];
  const V = VOICE(), W = W0 || V.writer('reasons' + seed);
  const eA = eA0 || eClub(L, A, 'the hosts'), eB = eB0 || eClub(L, B, 'the visitors'), E = id => (id === A ? eA : eB);
  const R = (k, id, d) => L.rank(L.T, k, id, d), out = [];
  /* a reason, chosen now and written when it is shown (write()): its title, then the clash said and what it means */
  const add = (key, s, slot, c, a, b) => out.push({ key, s, slot, a, b, write: () => {
    const title = W.say(slot + '.title', c), text = W.say(slot, c), coda = text ? W.say(slot + '.coda', c) : null;
    return title && ok(text) ? { title, text: [text, coda].filter(Boolean).join(' ') } : null;
  } });
  /* the tempo: one wants it fast, the other slow */
  const pa = R('pace', A), pb = R('pace', B);
  if (pa && pb && ((top(pa) && bottom(pb)) || (top(pb) && bottom(pa)))) {
    const [f, sl, Rf, Rs] = top(pa) ? [A, B, pa, pb] : [B, A, pb, pa];
    add('tempo', 2.2 + (Rf.z - Rs.z) / 3, 'reason.tempo', { F: E(f), Sl: E(sl), fastBest: Rf.r === 1 },
      fig(f, 'possessions per 40', one(Rf.v), Rf), fig(sl, 'possessions per 40', one(Rs.v), { r: Rs.n - Rs.r + 1, n: Rs.n }));
  }
  /* each side's attack against the other's defence, both ways round */
  [[A, B, ta, tb], [B, A, tb, ta]].forEach(([o, d, to, td]) => {
    const base = { O: E(o), D: E(d) };
    const rim = R('rim_share', o), rimD = R('evd_all_rim_pct', d, -1);
    if (rim && rimD && top(rim) && (bottom(rimD) || top(rimD))) {
      const weak = bottom(rimD);
      add(o + ':rim', (weak ? 2.4 : 1.9) + rim.z / 3, weak ? 'reason.rim' : 'reason.rimWall', Object.assign({ rimFrac: V.frac(rim.v), dWorst: rimD.r === rimD.n, dBest: rimD.r === 1 }, base),
        fig(o, 'of their shots at the rim', pc(rim.v), rim), fig(d, 'allowed at the rim', pc(rimD.v), rimD));
    }
    const three = R('p3_share', o), p3D = R('evd_all_p3_pct', d, -1);
    if (three && p3D && top(three) && (bottom(p3D) || top(p3D))) {
      const weak = bottom(p3D);
      add(o + ':three', (weak ? 2.2 : 1.8) + three.z / 3, weak ? 'reason.three' : 'reason.threeWall', Object.assign({ p3Frac: V.frac(three.v), dBest: p3D.r === 1 }, base),
        fig(o, 'of their shots from three', pc(three.v), three), fig(d, 'allowed from three', pc(p3D.v), p3D));
    }
    const tr = R('ev_transition_freq', o), trD = R('evd_transition_ppp', d, -1);
    if (tr && trD && top(tr) && (bottom(trD) || top(trD)) && num(to.ev_transition_ppp) != null) {
      const weak = bottom(trD);
      add(o + ':run', (weak ? 2.3 : 1.8) + tr.z / 3, weak ? 'reason.run' : 'reason.runWall', base,
        fig(o, 'of their chances on the break', pc(tr.v), tr), fig(d, 'points allowed per fast break', two(trD.v), trD));
    }
    const ob = R('ff_oreb', o), obD = R('dff_oreb', d, -1);
    if (ob && obD && top(ob) && bottom(obD)) add(o + ':glass', 2 + ob.z / 3, 'reason.glass', base,
      fig(o, 'of their misses rebounded', pc(ob.v), ob), fig(d, 'offensive rebounds allowed', pc(obD.v), obD));
    const to2 = R('ff_tov', o, -1), toD = R('dff_tov', d);
    if (to2 && toD && bottom(to2) && top(toD)) add(o + ':ball', 2.1 - to2.z / 3, 'reason.ball', base,
      fig(o, 'turnover rate', pc(to2.v), to2), fig(d, 'turnovers forced', pc(toD.v), toD));
  });
  /* THE MATCHUP AT A SPOT: each side's main player at the point, on the wing and in the middle (most minutes there), by
     box plus-minus, ranked among the league's regulars at the same spot */
  const SPOTS = [['at point guard', 'point guards', p => p.bpm_pos < 2], ['on the wing', 'wings', p => p.bpm_pos >= 2 && p.bpm_pos < 3.6], ['in the middle', 'bigs', p => p.bpm_pos >= 3.6]];
  SPOTS.forEach(([atSpot, group, inSpot]) => {
    /* five games before a box plus-minus is said at all (three games of +16 is noise, not a player) */
    const pool = L.regulars.filter(p => num(p.bpm_pos) != null && num(p.bpm) != null && num(p.mpg) >= 18 && num(p.gp) >= 5 && inSpot(p));
    if (pool.length < 6) return;
    const main = id => pool.filter(p => L.teamOf(p) === id).sort((a, c) => c.mpg - a.mpg)[0];
    const pa2 = main(A), pb2 = main(B);
    if (!pa2 || !pb2) return;
    const [hi, lo] = pa2.bpm >= pb2.bpm ? [pa2, pb2] : [pb2, pa2];
    const gap = hi.bpm - lo.bpm, Rh = L.rank(pool, 'bpm', hi.id), Rl = L.rank(pool, 'bpm', lo.id);
    if (!Rh || !Rl || (gap < 3 && !(Rh.r <= 5 && Rl.r <= 5))) return;
    const th = L.teamOf(hi), both = Rh.r <= 5 && Rl.r <= 5;
    add(atSpot, both ? 2.1 : 1.7 + gap / 6, both ? 'reason.duel' : 'reason.spot', { P1: ePlayer(L, hi.id), P2: ePlayer(L, lo.id), T1: E(th), group, atSpot },
      fig(th, L.pname(hi.id), signed(hi.bpm), Rh), fig(L.teamOf(lo), L.pname(lo.id), signed(lo.bpm), Rl));
  });
  return out.sort((a, c) => c.s - a.s);
}

/* a club's player whose minutes swing it most, said as on and off */
function onOffLine(L, team, W, named, eT) {
  const xs = L.regulars.filter(p => L.teamOf(p) === team && num(p.on_poss) >= 250 && num(p.diff_net) != null && num(p.diff_net) >= 8 && !(named && named.has(L.pname(p.id))))
    .sort((a, c) => c.diff_net - a.diff_net);
  const p = xs[0];
  if (!p) return null;
  if (named) named.add(L.pname(p.id));
  const w = !W || typeof W === 'string' ? VOICE().writer(String(W || team)) : W;
  return ok(w.say('game.onoff', { T: eT || eClub(L, team), P: ePlayer(L, p.id), flip: num(p.on_net) > 0 && num(p.off_net) < 0 }));
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
      const pr = L.pr, nm = L.pname(pid), sn = surname(nm), team = L.club(pl.team), seed = 'slump' + pid + wk, V = VOICE(), W = V.writer(seed);
      const P = Object.assign({ P: ePlayer(L, pid), T: eClub(L, pl.team) }, prons(L));
      const last = recent[recent.length - 1], cg = L.C.get(pl.team), res = cg ? cg.games.find(x => x.id === last.game) : null;
      const sum = k => recent.reduce((s, x) => s + (x[k] || 0), 0), bsum = k => before.reduce((s, x) => s + (x[k] || 0), 0);
      const fg = sum('fga') ? [sum('fgm'), sum('fga')] : null, bfg = bsum('fga') ? bsum('fgm') / bsum('fga') * 100 : null;
      const p3 = sum('p3a') >= 6 ? [sum('p3m'), sum('p3a')] : null, bp3 = bsum('p3a') ? bsum('p3m') / bsum('p3a') * 100 : null;
      const won = recent.map(x => (cg ? cg.games.find(y => y.id === x.game) : null)).filter(Boolean);
      const w = won.filter(x => x.won).length;
      const head = headsOf(seed + 'h', W.all('slump.head', Object.assign({ cold: say('cold', seed + 'hv') }, P)).concat(learnedHeads(L, 'slump', nm)));
      const dek = W.say('slump.dek', Object.assign({ rp: V.avg(rp), bp: V.avg(bp) }, P));
      const body = [];
      if (res) body.push(W.say('slump.lede', Object.assign({ pts: last.pts + (last.pts === 1 ? ' point' : ' points'), fg: last.fga ? last.fgm + '-of-' + last.fga : null,
        result: resultText(L, res, say, seed).replace(/^an? /, ''), day: L.day(res.at) }, P)));
      const scR = L.rank(L.regulars, 'ppg', pid);
      body.push(W.say('slump.context', Object.assign({ bp: V.avg(bp), rp: V.avg(rp), best: scR && scR.r === 1 ? ', more than anyone in the league' : scR && scR.r <= 5 ? ', one of the best marks in the league' : '' }, P)));
      if (fg) body.push(W.say('slump.shots', Object.assign({ fgm: fg[0], fga: fg[1], before: bfg != null ? V.frac(bfg) : null }, P)));
      body.push(W.say('slump.role', Object.assign({ steady: Math.abs(rm - bm) <= 3, rm: V.avg(rm), bm: V.avg(bm) }, P)));
      const prof = shotProfile(L, p, pr, seed, W);
      if (prof) body.push(prof);
      if (num(p.on_net) != null && num(p.off_net) != null && num(p.on_poss) >= 200) body.push(W.say('slump.onoff', Object.assign({ better: p.diff_net > 0 }, P)));
      if (won.length) body.push(W.say('slump.team', Object.assign({ w, l: won.length - w }, P)));
      const ts = L.rank(L.regulars, 'ts', pid);
      body.push(W.say('slump.verdict', Object.assign({ efficient: !!(ts && ts.r <= Math.max(5, Math.round(ts.n / 5))) }, P)));
      const nx = nextCtx(L, pl.team);
      if (nx) body.push(W.say('slump.next', Object.assign({ day: nx.day, where: nx.where }, P)));
      return { __log: W.log(), kicker: 'Under the microscope', head, dek, body: body.filter(Boolean), players: [pid], teams: [pl.team],
        links: [playerLink(L, pid), teamLink(L, pl.team)].filter(Boolean),
        facts: [{ label: 'last four', value: one(rp) + ' ppg' }, { label: 'before', value: one(bp) + ' ppg' }, fg ? { label: 'shooting, last four', value: fg[0] + '/' + fg[1] } : null,
          { label: 'minutes, last four', value: one(rm) }, won.length ? { label: 'team, last four', value: w + '–' + (won.length - w) } : null].filter(Boolean) };
    } });
  });
  return out;
}
/* where a player's shots come from, and which situation suits them: one sentence, the most telling half of it */
function shotProfile(L, p, pr, seed, W) {
  if (num(p.rim_rate) == null || num(p.p3_rate) == null) return null;
  const rr = L.rank(L.regulars, 'rim_rate', p.id), tr = L.rank(L.regulars, 'p3_rate', p.id);
  const rim = !!(rr && rr.r <= 5 && rr.r <= Math.ceil(rr.n / 2)), three = !!(tr && tr.r <= 5 && tr.r <= Math.ceil(tr.n / 2));
  /* a split of shares says nothing to a fan: only a profile that stands out is said */
  const w = W || VOICE().writer(seed + 'prof');
  return w.say('profile', { he: pr.he, his: pr.his, He: cap(pr.he), rim, rimMost: rim && num(p.rim_rate) >= 50, three, rimFrac: VOICE().frac(p.rim_rate), p3Frac: VOICE().frac(p.p3_rate) });
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
    const pr = L.pr, nm = L.pname(p.id), sn = surname(nm), tn = L.club(team), seed = 'mvp' + p.id + fort, lg = L.lname, V = VOICE(), W = V.writer(seed);
    const P = Object.assign({ P: ePlayer(L, p.id), T: eClub(L, team), league: lg }, prons(L));
    const head = headsOf(seed + 'h', W.all('mvp.head', P).concat(learnedHeads(L, 'mvp', nm)));
    const swing = num(p.diff_net) != null && num(p.on_poss) >= 250 ? p.diff_net : null;
    const dek = W.say('mvp.dek', Object.assign({ pos: place(ps.rank) }, P));
    const body = [];
    body.push(ok([W.say('mvp.lede', P), W.say('mvp.lead', Object.assign({ P2: ePlayer(L, p2.id), clear: gap >= 2 }, P))].filter(Boolean).join(' ')));
    const usg = num(p.usg), tsR = L.rank(L.regulars, 'ts', p.id);
    const style = usg != null && usg >= 28 ? ', with the offence running through ' + pr.him : tsR && tsR.r <= 5 ? ', and doing it efficiently' : usg != null && usg <= 18 ? ', without needing the ball to do it' : '';
    body.push(W.say('mvp.line', Object.assign({ ppg: V.avg(p.ppg), rpg: V.avg(p.rpg), apg: V.avg(p.apg), style }, P)));
    if (swing != null) body.push(W.say('mvp.onoff', Object.assign({ swing, onWords: p.on_net >= 0 ? 'outscore opponents' : 'barely hold their own', offWords: p.off_net >= 0 ? 'still get by' : 'get outscored' }, P)));
    const prof = shotProfile(L, p, pr, seed, W);
    if (prof) body.push(prof);
    if (num(p.def_rim_fg_on) != null && num(p.def_rim_fg_off) != null && num(p.def_rim_a_on) >= 40 && p.def_rim_fg_off - p.def_rim_fg_on >= 5) body.push(W.say('mvp.rimD', P));
    const ps2 = L.pos(L.teamOf(p2));
    body.push(W.say('mvp.rival', Object.assign({ P2: ePlayer(L, p2.id), T2: eClub(L, L.teamOf(p2)), pos2: ps2 ? place(ps2.rank) : 'high' }, P)));
    const nx = nextCtx(L, team);
    if (nx) body.push(W.say('mvp.next', Object.assign({ day: nx.day, where: nx.where }, P)));
    return { __log: W.log(), kicker: 'The MVP race', head, dek, body: body.filter(Boolean), players: [p.id, p2.id], teams: [team], links: [playerLink(L, p.id), teamLink(L, team)].filter(Boolean),
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
      const pr = L.pr, nm = L.pname(p.id), team = L.teamOf(p), tn = L.club(team), seed = 'young' + p.id + month, a = Math.floor(age), V = VOICE(), W = V.writer(seed);
      const P = Object.assign({ P: ePlayer(L, p.id), T: eClub(L, team), league: L.lname, age: a }, prons(L));
      const head = headsOf(seed + 'h', W.all('prospect.head', P).concat(learnedHeads(L, 'prospect', nm)));
      const dek = W.say('prospect.dek', Object.assign({ better: r === 1 ? null : r === 2 ? 'one player' : spell(r - 1) + ' players', have: r === 2 ? 'has' : 'have' }, P));
      const per = k => (num(p[k]) != null && num(p.mpg) > 0 ? String(Math.round(p[k] * 36 / p.mpg)) : null);
      const older = sorted.slice(0, r - 1).filter(x => bio[x.id] && num(bio[x.id].age) != null);
      const youngest = older.length === r - 1 && older.every(x => bio[x.id].age > age);
      const body = [];
      body.push(W.say('prospect.lede', Object.assign({ r, n: sorted.length, k: spell(r - 1), older: youngest ? (r === 2 ? ', and that player is older' : ', and every one of them is older') : '' }, P)));
      const tsAvg = mean(L.regulars.map(x => num(x.ts)).filter(v => v != null));
      body.push(W.say('prospect.line', Object.assign({ p36: per('ppg'), r36: per('rpg'), a36: per('apg'), eff: tsAvg != null && num(p.ts) >= tsAvg + 3 ? 'shooting it better than most veterans' : 'and still learning on the job' }, P)));
      if (num(p.usg) != null) body.push(W.say('prospect.role', Object.assign({ lead: p.usg >= 24, quiet: p.usg <= 16 }, P)));
      const prof = shotProfile(L, p, pr, seed, W);
      if (prof) body.push(prof);
      if (num(p.diff_net) != null && num(p.on_poss) >= 150) body.push(W.say('prospect.onoff', Object.assign({ better: p.diff_net > 0 }, P)));
      body.push(W.say('prospect.caveat', Object.assign({ gp: spell(p.gp) }, P)));
      const nx = nextCtx(L, team);
      if (nx) body.push(W.say('prospect.next', Object.assign({ day: nx.day, where: nx.where }, P)));
      return { __log: W.log(), kicker: 'One for the future', head, dek, body: body.filter(Boolean), players: [p.id], teams: [team], links: [playerLink(L, p.id), teamLink(L, team)].filter(Boolean),
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
  { k: 'transition', say: { best: 'nobody is more dangerous on the break', good: 'few teams are more dangerous on the break', worst: 'nobody gets less out of the fast break', bad: 'they rarely get anything going on the break', mirror: 'getting back in transition' }, key: 'ev_transition_ppp', vol: 'ev_transition_ch_pg', sit: 'transition', label: 'points per fast-break possession', noun: 'transition attack', fmt: 'ppp',
    good: ['How {T} became the {L}’s most dangerous team on the break', '{T} are at their best in transition', 'Run with {T} at your peril'],
    bad: ['{T} cannot get anything going on the break'], clause: (T, v) => T + ' score ' + two(v) + ' points every time they run',
    mirror: ['evd_transition_ppp', -1, (T, v) => T + ' allow ' + two(v) + ' a chance in transition'] },
  { k: 'half', say: { best: 'nobody runs a better half-court offence', good: 'few teams score as well when the game slows down', worst: 'nobody struggles more to score when the game slows down', bad: 'they struggle to score when the game slows down', mirror: 'defending the half court' }, key: 'ev_half_ppp', vol: 'ev_half_ch_pg', sit: 'half', label: 'half-court points per possession', noun: 'half-court offence', fmt: 'ppp',
    good: ['Inside {T}’s half-court offence', '{T} have the {L}’s best half-court offence'], bad: ['{T}’s half-court problem', 'Where {T}’s offence gets stuck'],
    clause: (T, v) => T + ' score ' + two(v) + ' points a possession in the half court',
    mirror: ['evd_half_ppp', -1, (T, v) => T + ' allow ' + two(v) + ' a chance in the half court'] },
  { k: 'halfD', say: { best: 'nobody gets easy baskets against them in the half court', good: 'few teams are harder to score on in the half court', worst: 'nobody has a harder time getting stops in the half court', bad: 'they struggle to get stops when the game slows down', mirror: 'scoring in the half court' }, key: 'evd_half_ppp', vol: 'evd_half_ch_pg', dir: -1, sit: 'half', def: true, label: 'half-court points allowed per possession', noun: 'half-court defence', fmt: 'ppp',
    good: ['Why nobody can score against {T} in the half court', 'The half-court wall: inside {T}’s defence'], bad: ['Where {T} are leaking points', '{T} cannot get stops in the half court'],
    clause: (T, v) => T + ' allow ' + two(v) + ' points a possession in the half court',
    mirror: ['ev_half_ppp', 1, (T, v) => T + ' score ' + two(v) + ' a chance in the half court'] },
  { k: 'second', say: { best: 'nobody turns misses into second chances like they do', good: 'few teams crash the offensive glass harder', worst: 'nobody gets fewer second chances', bad: 'they rarely get a second shot', mirror: 'keeping teams off the glass' }, key: 'ff_oreb', sit: 'second', label: 'offensive rebound rate', noun: 'offensive rebounding', fmt: 'pct',
    good: ['{T} and the art of the second chance', 'Why {T} keep getting a second shot'], bad: ['{T} are not getting second chances'],
    clause: (T, v) => T + ' rebound ' + pc(v) + ' of their own misses',
    mirror: ['dff_oreb', -1, (T, v) => T + ' give up ' + pc(v) + ' of their opponents’ misses'] },
  { k: 'rimD', say: { best: 'the paint is a no-go area against them', good: 'few teams are harder to score on at the rim', worst: 'teams walk straight to the rim against them', bad: 'they struggle to protect the rim', mirror: 'attacking the rim' }, key: 'evd_all_rim_pct', dir: -1, def: true, label: 'opponents’ shooting at the rim', noun: 'rim protection', fmt: 'pct',
    good: ['Why nobody gets to the rim against {T}', '{T} have made the paint a no-go area'], bad: ['{T} cannot protect the rim', 'The open door: {T} and the rim'],
    clause: (T, v) => 'opponents make ' + pc(v) + ' of their shots at the rim against ' + T,
    mirror: ['rim_share', 1, (T, v) => T + ' take ' + pc(v) + ' of their shots there', { best: 'highest share', worst: 'lowest share' }] },
  { k: 'tovD', say: { best: 'nobody forces more turnovers', good: 'they feed on turnovers', worst: 'nobody forces fewer turnovers', bad: 'they rarely force a mistake', mirror: 'looking after the ball' }, key: 'dff_tov', def: true, label: 'turnovers forced', noun: 'ball pressure', fmt: 'pct',
    good: ['{T}’s defence lives on turnovers', 'Ball-hawks: how {T} force the turnovers'], bad: ['{T} are not forcing turnovers'],
    clause: (T, v) => T + ' force a turnover on ' + pc(v) + ' of their opponents’ possessions',
    mirror: ['ff_tov', -1, (T, v) => T + ' turn it over on ' + pc(v) + ' of their possessions'] },
  { k: 'tov', say: { best: 'nobody looks after the ball better', good: 'they almost never give the ball away', worst: 'nobody gives the ball away more', bad: 'they keep giving the ball away', mirror: 'forcing turnovers' }, key: 'ff_tov', dir: -1, label: 'turnover rate', noun: 'ball security', fmt: 'pct',
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
  const V = VOICE(), tn = L.club(t.id), seed = 'id' + t.id + f.k + month, good = R.z > 0, ps = L.pos(t.id), cg = L.C.get(t.id), pr = L.pr;
  const W = V.writer(seed), T = eClub(L, t.id), best = R.r === 1, worst = R.r === R.n;
  const head = headsOf(seed + 'h', (good ? f.good : f.bad).map(h => h.replace('{T}', tn).replace('{L}', L.lname)));
  const wl = cg ? cg.w + '–' + cg.l : null, rec = wl ? wl + (ps ? ', ' + place(ps.rank) + ' in the table' : '') : null;
  const c0 = { T, good, trait: good ? (best ? f.say.best : f.say.good) : null, flaw: good ? null : (worst ? f.say.worst : f.say.bad),
    anyone: best || worst ? 'anybody' : 'almost anybody', league: L.lname, rec, wl };
  const dek = W.say('identity.dek', c0);
  const body = [];
  /* the hook, then its figure in the same paragraph: one number, said plainly, "they" plainly the club */
  body.push(ok([W.say('identity.lede', c0), W.line(cap(f.clause(f.k === 'rimD' ? 'them' : 'they', R.v)) + ', ' + rankText(R, seed + 'r') + '.')].filter(Boolean).join(' ')));
  /* WHAT IT IS WORTH: points a game, against an average side's return */
  if (f.fmt === 'ppp' && f.vol && num(t[f.vol]) != null) {
    const w = (f.dir === -1 ? -1 : 1) * (R.v - R.avg) * num(t[f.vol]);
    if (Math.abs(w) >= 0.8) body.push(W.say('identity.worth', { pts: Math.abs(w) >= 1.5 ? String(Math.round(Math.abs(w))) : one(Math.abs(w)), toWhom: w > 0 ? 'to them' : 'against them' }));
  }
  if (f.k === 'tovD' && num(t.ev_offTo_ppg) != null) {
    const r2 = L.rank(L.T, 'ev_offTo_ppp', t.id);
    body.push(W.line((r2 && r2.r > r2.n / 2 ? 'What they do with them is another matter: ' : 'And they make them count: ') + avgN(t.ev_offTo_ppg) + ' points a game off turnovers.'));
  }
  if (f.k === 'tov' && num(t.evd_offTo_ppg) != null) body.push(W.line('Opponents are scoring ' + avgN(t.evd_offTo_ppg) + ' points a game off them.'));
  if (f.k === 'rimD' && num(t.evd_all_rim_sh) != null) {
    const r2 = L.rank(L.T, 'evd_all_rim_sh', t.id, -1);
    if (r2) body.push(W.line(r2.r <= 3 ? 'Opponents have mostly stopped trying: fewer of their shots come at the rim against them than against almost anyone.'
      : r2.r > r2.n - 3 ? 'Opponents keep coming at the rim; they just do not finish.' : 'Opponents still go to the rim as often as anywhere else; they just make fewer.'));
  }
  /* WHO: the players carrying it */
  const mine = L.regulars.filter(p => L.teamOf(p) === t.id);
  const two2 = key => mine.filter(p => num(p[key]) != null).sort((a, c) => c[key] - a[key]).slice(0, 2);
  const pair = (key, what) => { const w = two2(key); return w.length === 2 && num(w[1][key]) > 0 ? L.pname(w[0].id) + ' and ' + L.pname(w[1].id) + ' ' + what : null; };
  const s0 = f.sit;
  if (good && s0 && !f.def && f.k !== 'second') { const w = pair('ev_' + s0 + '_ppg', 'do most of the scoring.'); if (w) body.push(W.line(w)); }
  if (good && f.k === 'second') { const w = pair('orpg', 'lead the charge on the glass.'); if (w) body.push(W.line(w)); }
  if (good && f.k === 'tovD') { const w = pair('spg', 'do the most to take it away.'); if (w) body.push(W.line(w)); }
  if (f.k === 'tov' && !good) { const w = pair('topg', 'give it away the most.'); if (w) body.push(W.line(w)); }
  if (good && f.k === 'rimD') {
    const guard = mine.filter(p => num(p.def_rim_fg_on) != null && num(p.def_rim_fg_off) != null && num(p.def_rim_a_on) >= 40)
      .sort((a, c) => (c.def_rim_fg_off - c.def_rim_fg_on) - (a.def_rim_fg_off - a.def_rim_fg_on))[0];
    if (guard && guard.def_rim_fg_off - guard.def_rim_fg_on >= 4) body.push(W.line('The anchor is ' + L.pname(guard.id) + ': opponents finish far worse at the rim with ' + pr.him + ' on the floor.'));
    else { const w = pair('bpg', 'do most of the shot-blocking.'); if (w) body.push(W.line(w)); }
  }
  /* THE OTHER SIDE OF THEM: the trait furthest the other way */
  const other = FACETS.filter(x => x.k !== f.k).map(x => ({ x, R: L.rank(L.T, x.key, t.id, x.dir) })).filter(x => x.R).sort((a, c) => (good ? a.R.z - c.R.z : c.R.z - a.R.z))[0];
  if (other && (good ? other.R.z < -0.8 : other.R.z > 0.8)) {
    const ob = other.R.r === 1, ow = other.R.r === other.R.n;
    body.push(W.say('identity.other', { good, turn: say('turn', seed + 't'), flaw: ow ? other.x.say.worst : other.x.say.bad, trait: ob ? other.x.say.best : other.x.say.good }));
  }
  /* NEXT: the opponent's number that meets it */
  const nx = nextCtx(L, t.id);
  if (nx) {
    const mr = f.mirror ? L.rank(L.T, f.mirror[0], nx.opp, f.mirror[1]) : null;
    const strong = !!(mr && mr.r <= 3), weak = !!(mr && mr.r > mr.n - 3);
    body.push(ok([W.say('identity.next', { day: nx.day, where: nx.where }), strong || weak ? W.say('identity.test', { good, strong, weak, Opp: eClub(L, nx.opp), mirror: f.say.mirror }) : null].filter(Boolean).join(' ')));
  }
  return { __log: W.log(), kicker: good ? 'What makes them tick' : 'The problem', head, dek, body: body.filter(Boolean), teams: [t.id], links: [teamLink(L, t.id)].filter(Boolean),
    facts: [{ label: f.label, value: fmtV(f, R.v) }, { label: 'league rank', value: ordShortN(R.r) + ' of ' + R.n }, { label: 'league average', value: fmtV(f, R.avg) },
      cg ? { label: 'record', value: cg.w + '–' + cg.l } : null].filter(Boolean) };
}
const avgN = v => (Math.abs(v) >= 10 ? String(Math.round(v)) : one(v));
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
      const tn = L.club(id), n = cg.streak.n, seed = 'run' + id + cg.streak.from, V = VOICE(), W = V.writer(seed), T = eClub(L, id);
      const head = won ? headsOf(seed + 'h', ['Inside ' + possOf(tn) + ' ' + spell(n) + '-game winning run', 'How ' + tn + ' won ' + spell(n) + ' in a row', 'What is behind ' + possOf(tn) + ' run'].concat(learnedHeads(L, 'run', tn)))
        : headsOf(seed + 'h', ['What has gone wrong at ' + tn + '?', 'Inside ' + possOf(tn) + ' slide', spell(n) + ' straight defeats: inside ' + possOf(tn) + ' slump'].map(cap));
      const avgM = mean(run.map(x => x.for - x.against));
      const ff = factorsOver(L, id, run, rest);
      const dek = W.say('run.dek', { T, N: cap(spell(n)), margin: V.avg(Math.abs(avgM)), won });
      const last = run[run.length - 1], body = [];
      body.push(W.line(tn + ' have ' + (won ? 'won ' : 'lost ') + spell(n) + ' in a row, the latest ' + resultText(L, last, say, seed) + ' on ' + L.day(last.at) + '.'));
      ff.slice(0, 2).forEach(x => body.push(W.say('run.change', { won, k: x.k2 })));
      const star = [...L.PL.values()].filter(p => p.team === id).map(p => { const g = p.games.filter(x => cg.streak.games.indexOf(x.game) >= 0), b2 = p.games.filter(x => cg.streak.games.indexOf(x.game) < 0);
        return { p, r: mean(g.map(x => x.pts)), b: mean(b2.map(x => x.pts)), n: g.length }; }).filter(x => x.n >= Math.ceil(n / 2) && x.r != null && x.b != null && L.pname(x.p.pid))
        .sort((a, c) => (won ? (c.r - c.b) - (a.r - a.b) : (a.r - a.b) - (c.r - c.b)))[0];
      if (star && Math.abs(star.r - star.b) >= 3) body.push(W.say('run.star', { T, P: ePlayer(L, star.p.pid), r: V.avg(star.r), b: V.avg(star.b), up: star.r > star.b }));
      const five = bestFive(L, id);
      if (five) body.push(W.say('run.five', { names: list(five.n.map(surname)), pm: Math.abs(five.pf - five.pa), mins: Math.round(five.dur / 60), up: five.pf >= five.pa }));
      const close = run.filter(x => Math.abs(x.for - x.against) <= 5).length;
      if (close >= 2) body.push(W.say('run.close', { won, close: spell(close), N2: spell(n) }));
      const nx = nextCtx(L, id);
      if (nx) body.push(W.say('run.next', { won, n: spell(n), day: nx.day, where: nx.where }));
      return { __log: W.log(), kicker: won ? 'Inside the run' : 'Inside the slide', head, dek, body: body.filter(Boolean), teams: [id], links: [teamLink(L, id)].filter(Boolean),
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
    return { label, value: Math.abs(a - b2) * (W[k] || 1), better, now: one(a) + '%', was: one(b2) + '%', say: w[0] + one(a) + w[1] + ' (' + one(b2) + '% before)',
             k2: opp ? 'def' : k === 'efg' ? 'shot' : k === 'tovp' ? 'ball' : 'glass' };
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
      const tn = L.club(id), seed = 'five' + id + wk, mins = Math.round(f.dur / 60), names = f.n.map(surname), V = VOICE(), W = V.writer(seed), T = eClub(L, id);
      const head = headsOf(seed + 'h', ['The five who are winning games for ' + tn, possOf(tn) + ' best five, by the numbers', 'Inside the ' + L.lname + '’s most effective lineup']);
      const dek = list(names) + ': +' + pm + ' in ' + mins + ' minutes together over the last fortnight.';
      const share = D.dur ? f.dur / D.dur : null;
      const body = [];
      body.push(W.say('five.lede', { T, names: list(f.n), pm, mins }));
      body.push(W.say('five.per40', { per40: Math.round(pm / mins * 40) }));
      if (D.dur) body.push(W.say('five.rest', { restLost: (D.pf - D.pa) - pm < 0 }));
      if (share) body.push(W.say('five.share', { T, shareFrac: V.frac(share * 100), rare: share < 0.25 }));
      body.push(W.say('five.caveat', { mins }));
      const nx = nextCtx(L, id);
      if (nx) body.push(W.line('Next: ' + nx.day + ', ' + nx.where + '.'));
      return { __log: W.log(), kicker: 'Lineup lab', head, dek, body: body.filter(Boolean), teams: [id], links: [teamLink(L, id)].filter(Boolean),
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
    const tn = L.club(id), r = best.r, seed = 'clock' + id + wk, dr = R('dur', id), V = VOICE(), W = V.writer(seed), T = eClub(L, id);
    const head = headsOf(seed + 'h', [tn + ' are the ' + L.lname + '’s late-clock specialists', 'Beat the clock: how ' + tn + ' score when time runs short']);
    const dek = W.say('clock.dek', { T, league: L.lname });
    const body = [];
    body.push(W.say('clock.lede', { T, league: L.lname }));
    if (r.early != null) body.push(W.say('clock.detail', { noCost: r.late >= r.early }));
    if (dr) body.push(W.say('clock.pace', { long: dr.r <= 3, short: dr.r > dr.n - 3 }));
    body.push(W.say('clock.caveat', { n: r.lateN }));
    const nx = nextCtx(L, id);
    if (nx) body.push(W.line('Next: ' + nx.day + ', ' + nx.where + '.'));
    return { __log: W.log(), kicker: 'The shot clock', head, dek, body: body.filter(Boolean), teams: [id], links: [teamLink(L, id)].filter(Boolean),
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
      const pctS = Math.round(share * 100) + '%', nMiss = without.length, VO = VOICE(), W = VO.writer(seed);
      const P = Object.assign({ P: ePlayer(L, pid), T: eClub(L, team), S: sn, top: r === 1 }, prons(L));
      const head = headsOf(seed + 'h', W.all('absence.head', P));
      const dek = W.say('absence.dek', Object.assign({ nMiss: spell(nMiss), ban: banned ? ', suspended' : '' }, P));
      const body = [];
      body.push(W.say('absence.lede', Object.assign({ nMiss: spell(nMiss), banTail: banned ? ', who is serving a suspension' : '', w, l }, P)));
      body.push(W.say('absence.value', Object.assign({ shareFrac: VO.frac(share * 100) }, P)));
      if (num(p.on_net) != null && num(p.off_net) != null && num(p.on_poss) >= 200) body.push(W.say('absence.onoff', Object.assign({ big: p.diff_net >= 3 }, P)));
      const ppg = xs => mean(xs.map(x => x.for)), papg = xs => mean(xs.map(x => x.against));
      if (without.length >= 2 && withIt.length >= 3) {
        const pf = ppg(without), pa = papg(without), pf0 = ppg(withIt), pa0 = papg(withIt);
        body.push(W.say('absence.games', Object.assign({ pf: VO.avg(pf), pa: VO.avg(pa), pf0: VO.avg(pf0), pa0: VO.avg(pa0), offence: pf0 - pf >= 5, defence: pa - pa0 >= 5 }, P)));
      }
      /* who has had the minutes: the biggest rise in minutes a game, without him against with him */
      const ids = new Set(without.map(x => x.id)), had = new Set(withIt.map(x => x.id));
      const rise = [...L.PL.values()].filter(q => q.team === team && q.pid !== pid && L.pname(q.pid)).map(q => {
        const a = q.games.filter(x => ids.has(x.game)), b2 = q.games.filter(x => had.has(x.game));
        return { q, a: mean(a.map(x => x.min)), b: mean(b2.map(x => x.min)), n: a.length };
      }).filter(x => x.n >= Math.min(2, without.length) && x.a != null && x.b != null).sort((x, y) => (y.a - y.b) - (x.a - x.b))[0];
      if (rise && rise.a - rise.b >= 4) body.push(W.say('absence.minutes', { Q: ePlayer(L, rise.q.pid), a: VO.avg(rise.a), b: VO.avg(rise.b) }));
      const nx = nextCtx(L, team);
      if (nx) body.push(W.say('absence.next', Object.assign({ day: nx.day, where: nx.where }, P)));
      return { __log: W.log(), kicker: banned ? 'Serving a suspension' : 'The missing piece', head, dek, body: body.filter(Boolean), players: [pid], teams: [team],
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
  /* THE GAME TO WATCH, chosen with the salience it is written for: the week's three biggest games by what is at stake, each
     written as a card and edited; the one shown matters most by how much its card can say (the editor's substance) and
     how ready it is (quality). A big game the numbers have nothing to say about yields to one nearly as big that they do */
  const cards = slate.slice(0, 3).filter(g => g && g.home && g.away).map(g => cardFor(L, o, b, g)).filter(Boolean);
  if (!cards.length) return null;
  cards.forEach(c => { const q = c.qa || {}; c.score = Math.round(c.stakes * (0.6 + 0.4 * Math.min(1, (q.substance != null ? q.substance : c.reasons.length) / 3)) * (q.quality != null ? q.quality : 1) * 1000) / 1000; });
  const best = cards.sort((a, c) => c.score - a.score || c.stakes - a.stakes)[0];
  /* the card's own bar: one with nothing to say (no stake, no reason) is not posted - a fixture is not a preview */
  return best.score >= CARD_BAR ? best : null;
}
function cardFor(L, o, b, g) {
  const side = s => ({ id: s.id, rec: s.rec || null, rank: s.rank || null, form: s.form || null, streak: s.streak || null });
  /* one writer for the card, in the order it is read: the lean under the bar, why it matters, where it will be decided */
  const W = VOICE().writer('card' + g.game), eH = eClub(L, g.home.id, 'the hosts'), eA = eClub(L, g.away.id, 'the visitors');
  W.section(g.game);
  const ex = g.expect && isFinite(g.expect.margin) ? g.expect : null;
  const pFav = ex ? 1 / (1 + Math.exp(-0.15 * Math.abs(ex.margin))) : null;
  const [eF, eD] = ex && ex.favourite === g.away.id ? [eA, eH] : [eH, eA];
  const line = leanText(L, ex, W, eF, eD);
  /* WHY IT MATTERS: the stakes said, then the storylines it touches - less what the stakes have said, and never the
     storylines that talk like a model ("results turn on shooting") */
  const ST = stakesOf(L, g, W, eH, eA);
  const covers = k => (k === 'race' || k === 'line') ? !!(ST.c.top2 || ST.c.top4 || ST.c.topBottom)
    : (k === 'run' || k === 'skid' || k === 'perfect' || k === 'winless') ? !!(ST.c.bothUnbeaten || ST.c.bothHot || ST.c.hotCold) : k === 'identity';
  const whyLines = ST.lines.concat((g.threads || []).filter(t => !covers(String(t.story || '').split(':')[0])).map(t => t.line)).slice(0, 3);
  /* WHERE IT WILL BE DECIDED: a rivalry an administrator has named leads, it is why many will watch */
  const why = reasons(L, g.home.id, g.away.id, 'card' + g.game, W, eH, eA).slice(0, g.rival ? 2 : 3)
    .map(r => { const w = r.write(); return w ? { title: w.title, text: w.text, off: r.a, def: r.b } : null; }).filter(Boolean);
  if (g.rival) {
    const met = (L.games || []).filter(x => (x.home_team_id === g.home.id && x.away_team_id === g.away.id) || (x.home_team_id === g.away.id && x.away_team_id === g.home.id)).slice(-1)[0];
    const last = met ? W.line((num(met.home_score) > num(met.away_score) ? L.club(met.home_team_id) : L.club(met.away_team_id)) + ' won the last meeting, ' + Math.max(met.home_score, met.away_score) + '\u2013' + Math.min(met.home_score, met.away_score) + '.')
      : W.line('This is their first meeting of the season.');
    why.unshift({ title: 'The rivalry', text: [W.say('reason.rivalry', { A: eH, B: eA }), last].filter(Boolean).join(' '), off: null, def: null });
  }
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
  const card = { game: g.game, at: g.at, day: g.day, stakes: g.stakes, rival: !!g.rival, angle: whyLines[0] || null, threads: whyLines.slice(1),
           home: side(g.home), away: side(g.away), lean: ex ? { favourite: ex.favourite, margin: Math.round(Math.abs(ex.margin) * 10) / 10, chance: Math.round(pFav * 100) } : null,
           reasons: why, players, article: art ? art.id : null, line };
  /* the editor reads the card's words (the lean, why it matters, each reason) as one piece */
  const E = EDITOR();
  if (!E) return card;
  const m = editorMeta(L, o || {});
  const q = E.scrutinise({ kind: 'card', line: card.line, angle: card.angle, threads: card.threads, reasons: card.reasons.map(r => ({ title: r.title, text: r.text })) },
    { log: W.log(), schedule: m.schedule, clubs: m.clubs, game: g.game, sectionGame: { 0: g.game, 1: g.game }, nowMs: L.nowMs });
  card.line = q.piece.line; card.angle = q.piece.angle; card.threads = (q.piece.threads || []).filter(Boolean);
  card.reasons = card.reasons.map((r, i) => Object.assign({}, r, { text: q.piece.reasons[i] && q.piece.reasons[i].text })).filter(r => r.text);
  card.qa = { checked: q.report.checked, fixes: q.report.fixes, quality: q.report.quality, substance: q.report.substance };
  return card;
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
   writer as it is now. Only while the candidate still carries the piece's headlines: never a new body under an old
   headline. One that cannot be written again (no candidate, or its subject has moved on: the week's top game played)
   is dropped when the old writer got a figure wrong (drop), and otherwise kept as it was written, marked so it is not
   tried again. How a correction reaches what readers can already open.
     five 2 (2026-10-08, drop): the club's rate per 40 and the five's share of its minutes had been divided by five twice
     watch 2 (2026-10-08): "outscored opponents by −0.8" of a side outscored with the player on; "give up N% of theirs"
     every format 3 (2026-10-08, heads): the house voice (voice.js) and the editor (scrutiny.js) - written again, the
       headlines too (heads: no headline test had counts yet, the click-through tables not being live)
     watch 4 (2026-10-08, drop): a week's games to watch from before the voice, its week gone, had been kept as written AND
       stamped as the voice's, so it was never read again ("where the numbers say each will be decided", "one of the easiest
       sides to run on ... the fourth-best in the league"): written again while its week is on, dropped after. A piece kept
       as written is now marked kept, never given a writer's version it was not written by.
     watch 5 (2026-10-08, drop): the week's games to watch keep what they said of each game (games: the lean, the reason,
       the player) for the match report to read back; and the preview keeps its week (round-up, its own bar)
     watch 6 (2026-10-08, drop): a piece written again kept only the fields it was written with before, so the 5s written
       again had no games and no round-up: they carry everything the writer gives now */
const VOICED = { v: 3, heads: true };
const WRITER = { five: { v: 3, drop: true, heads: true }, watch: { v: 6, drop: true, heads: true }, slump: VOICED, mvp: VOICED, prospect: VOICED, identity: VOICED, run: VOICED, skid: VOICED, clock: VOICED, absence: VOICED };
const writerOf = kind => (WRITER[kind] && WRITER[kind].v) || 1;
/* the writer a piece was last answered for: written by it (wv), or kept as it was when it could not be written again (kept) */
const answered = a => Math.max(a.wv || 1, a.kept || 0);
function publish(o, b, opts) {
  const op = opts || {};
  const nowMs = op.nowMs || (o && o.now instanceof Date ? o.now.getTime() : Date.now());
  const lslug = o && o.league ? o.league.slug : null;
  const cands = candidates(o, b, Object.assign({}, op, { nowMs }));
  const meta = editorMeta(cands.length ? cands[0].L : league(o || {}, b || {}, Object.assign({}, op, { nowMs })), o);
  const held = op.qa ? (op.qa.held = []) : [];
  /* the pieces already out: kept as written (or written again, above), a headline test decided once it has run long enough */
  const prev = (op.previous || []).filter(a => a && a.id && time(a.written) != null && nowMs - time(a.written) < KEEP_DAYS * DAY)
    .map(a => {
      if (answered(a) >= writerOf(a.kind)) {
        /* THE EDITOR READS IT AGAIN whenever it has learnt something since it last did (scrutiny.js VERSION): kept as it
           edits it - what it fixed before kept in the report - or it goes */
        const E = EDITOR();
        if (!E || !E.VERSION || (a.qa && a.qa.ev >= E.VERSION)) return a;
        const was = a.qa && Array.isArray(a.qa.fixes) ? a.qa.fixes : [];
        const re = edit(Object.assign({}, a), meta, nowMs);
        if (!re.ok) return null;
        re.piece.qa.fixes = was.concat(re.piece.qa.fixes).slice(-24);
        return re.piece;
      }
      const c = cands.find(x => x.id === a.id);
      let w = null;
      try { w = c ? c.write() : null; } catch (_) { w = null; }
      const hs = w ? [].concat(w.head || []) : [];
      const keeps = w && (Array.isArray(a.heads) ? a.heads : [a.head]).every(h => hs.indexOf(h) >= 0), anew = !!(WRITER[a.kind] && WRITER[a.kind].heads);
      if (w && (w.body || []).filter(x => typeof x === 'string').length >= 3 && (keeps || anew)) {
        /* a correction that may change the headlines (heads) takes the new ones, in the model's order; the test starts again */
        const nh = keeps ? null : orderHeads(w.head, op.model, lslug).filter(ok);
        const base = keeps ? a : Object.assign({}, a, { head: nh[0] || a.head, heads: nh.length > 1 ? nh : undefined, locked: undefined });
        const ed = edit(Object.assign({}, base, { kicker: w.kicker, dek: w.dek, body: w.body, facts: w.facts, links: w.links, teams: w.teams, players: w.players, games: w.games, __log: w.__log, __sections: w.__sections, __roundup: w.__roundup }), meta, nowMs);
        if (ed.ok) return Object.assign(ed.piece, { wv: writerOf(a.kind), corrected: new Date(nowMs).toISOString() });
      }
      if (WRITER[a.kind] && WRITER[a.kind].drop) return null;
      /* nothing to write it again from, or the new one held back: the editor reads the piece as it is - kept as it edits it,
         or it goes (everything on the site has passed the editor) */
      const old = edit(Object.assign({}, a), meta, nowMs);
      return old.ok ? Object.assign(old.piece, { kept: writerOf(a.kind) }) : null;
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
    if ((c.salience * kw < barOf(c.kind) && !op.all) || have.has(c.id)) continue;
    const at = lately.get(c.kind + '|' + c.subject);
    if (at != null && nowMs - at < SUBJECT_DAYS * DAY && !op.all) continue;
    let a = null;
    try { a = c.write(); } catch (_) { a = null; }
    if (a) { const hs = orderHeads(a.head, op.model, lslug).filter(ok); a.head = hs[0] || null; if (hs.length > 1) a.heads = hs; }
    if (!a || !a.head || (a.body || []).filter(x => typeof x === 'string').length < 3) continue;
    /* the gate: the editor reads it, fixes what it can, and holds back what it cannot */
    const ed = edit(a, meta, nowMs);
    if (!ed.ok) { held.push({ id: c.id, kind: c.kind, head: a.head, report: ed.piece.qa }); continue; }
    a = ed.piece;
    /* WHAT IS POSTED: how much it matters (salience, the format's weight) by how ready the edit left it (quality). A piece
       that matters but came out thin waits, and the next most salient one gets its place */
    const quality = a.qa && a.qa.quality != null ? a.qa.quality : 1, score = Math.round(c.salience * kw * quality * 1000) / 1000;
    if (a.qa) a.qa.score = score;
    if (!op.all && score < barOf(c.kind)) {
      held.push({ id: c.id, kind: c.kind, head: a.head, report: Object.assign({}, a.qa, { held: [{ at: 'piece', kind: 'unwieldy', rule: 'salience',
        note: 'salience ' + c.salience + (kw !== 1 ? ' x format ' + kw : '') + ' x quality ' + quality + ' = ' + score + ', under the bar (' + barOf(c.kind) + ')' }] }) });
      continue;
    }
    fresh.push(Object.assign({ id: c.id, kind: c.kind, subject: c.subject, salience: c.salience, written: new Date(nowMs).toISOString(), wv: writerOf(c.kind) }, a));
    lately.set(c.kind + '|' + c.subject, nowMs);
    room--;
  }
  return fresh.concat(prev).sort((a, c) => time(c.written) - time(a.written)).slice(0, MAX_KEEP);
}

return { publish, candidates, digest, learn, gameCard, SALIENCE, BAR, BOOK, __x: { rankText, rankWord, reasons, onOffLine, sayer, league, leanText, stakesOf } };
}));
