'use strict';
/* ============================================================================
   MANAGER - NAMES (core). A team's name and a manager's name: 2-28 characters of letters (any alphabet), digits,
   spaces and . ' & -, no swearing (Louie: "team naming (preventing swear words)"). The check reads through spacing,
   punctuation and number-for-letter swaps (sh1t, f.u.c.k), and leaves whole words that only contain a bad string
   alone (Scunthorpe, Essex, Dickinson). English and Spanish, the site's languages, and the common slurs.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.names = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* stems: a word that is, starts with or ends with one of these (after folding) is refused */
const BAD = ['fuck', 'fuk', 'fck', 'shit', 'shyt', 'cunt', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'twat', 'wank', 'whore', 'slut',
  'prick', 'arse', 'asshole', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'spastic', 'spaz', 'paki', 'chink', 'kike', 'tranny', 'nazi', 'hitler',
  'rape', 'rapist', 'penis', 'vagina', 'boob', 'tits', 'porn', 'sex', 'cum', 'jizz', 'dildo', 'puta', 'puto', 'mierda', 'cabron', 'cabrón',
  'joder', 'coño', 'cono', 'polla', 'pendejo', 'maricon', 'maricón', 'gilipollas', 'zorra', 'culo', 'verga', 'chingar', 'chinga', 'hijueputa'];
/* whole words only (too short or too common inside other words to match as a stem) */
const WORDS = ['ass', 'arse', 'tit', 'cum', 'fag', 'sex', 'puta', 'culo', 'cono', 'nazi'];
const ALLOW = ['scunthorpe', 'essex', 'sussex', 'middlesex', 'dickinson', 'dickens', 'cockburn', 'hancock', 'peacock', 'cocktail', 'shitake',
  'shiitake', 'assist', 'assists', 'class', 'classic', 'bass', 'pass', 'passer', 'assassin', 'massive', 'cumberland', 'cumbria', 'titans', 'titan',
  'title', 'grape', 'drape', 'therapist', 'arsenal', 'sextet', 'hitlist', 'fagan', 'pakistan', 'skunthorpe'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const deleet = s => s.replace(/[0134578@$!|+9]/g, c => LEET[c] || c);
const BADF = BAD.map(fold), WORDSF = WORDS.map(fold), ALLOWF = ALLOW.map(fold);

/* the text as words (spacing and punctuation inside a word taken out: f.u.c.k, f u c k) and as one run of letters */
function variants(s) {
  const f = deleet(fold(s));
  const words = f.split(/[^a-zÀ-￿0-9]+/).filter(Boolean);
  const squeezed = f.replace(/[^a-zÀ-￿]/g, '');
  /* single letters spaced out (f u c k) joined back into a word */
  const joined = f.replace(/\b([a-z])[\s._-]+(?=[a-z]\b)/g, '$1');
  return { words, squeezed, joinedWords: joined.split(/[^a-zÀ-￿]+/).filter(Boolean) };
}
function profane(s) {
  const v = variants(s);
  const bad = w => !ALLOWF.includes(w) && (WORDSF.includes(w) || BADF.some(b => b.length >= 3 && (w === b || w.startsWith(b) || w.endsWith(b))));
  if (v.words.some(bad) || v.joinedWords.some(bad)) return true;
  /* the whole name run together (Fu Ck Ers): a long stem anywhere in it */
  const run = v.squeezed;
  if (ALLOWF.some(a => run.includes(a))) return BADF.filter(b => b.length >= 5).some(b => run.replace(new RegExp(ALLOWF.join('|'), 'g'), '').includes(b));
  return BADF.filter(b => b.length >= 4).some(b => run.includes(b));
}
/* -> '' when the name is fine, else why not */
function check(s, o) {
  o = o || {};
  const t = String(s || '').replace(/\s+/g, ' ').trim(), min = o.min || 2, max = o.max || 28;
  if (t.length < min) return 'too short';
  if (t.length > max) return 'too long';
  if (!/^[\p{L}\p{N} .'&-]+$/u.test(t)) return 'letters, numbers, spaces and . \' & - only';
  if (profane(t)) return 'not allowed';
  return '';
}
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

return { check, profane, clean };
}));
