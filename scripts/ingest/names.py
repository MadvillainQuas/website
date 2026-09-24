"""One shape for a player's name, whatever the feed calls them.

Ten leagues in five alphabets write a name ten ways. Genius gives firstName and familyName in
separate fields; EuroLeague gives "DONCIC, LUKA"; the ACB gives "Doncic, Luka" with Spanish
capitalisation; the B.LEAGUE gives 富樫 勇樹 and, in another field, "Yuki Togashi"; the Czech and
Swedish feeds give perfectly good Latin names with diacritics the rest of the site cannot search
for. Left alone, one player becomes four players and a scouting table reads like four different
websites stapled together.

So everything that reaches the platform goes through here first, and comes out as:

    ("Luka", "Doncic")      first name, then family name
                            title case, never caps
                            ASCII, transliterated where the source is not
                            no full stops (the stint engine drops an action whose player name
                            contains one, which is how "K.J. Williams" used to vanish)

AND THE ORIGINAL IS KEPT. Every form this throws away comes back as an alias, so a supporter
searching "Dončić" or "富樫" finds the player, and the identity matcher still has the native
spelling to match a feed against. Folding a name for display and losing the real one is how a
database ends up unable to find its own players.

WHAT IS NOT DONE HERE. Kanji is not romanised by rule: there is no reliable mapping without a
dictionary, and guessing at somebody's name is worse than leaving it. A CJK name is used as-is
(and kept as an alias) unless the feed also carries a Latin form, which every league here does —
the B.LEAGUE's own API has both, and that is the field the adapter is told to prefer.

KANA ARE A DIFFERENT MATTER. A reading written in kana (the furigana a league prints above a
name) is a spelling, not a guess: every kana is one sound, so kana_romaji() turns 「やまもと まい」
into "yamamoto mai" by table, the way a Japanese passport writes it. That is how the W League
(adapters/wjbl.py) names the players its API gives no English spelling for; the kanji is still
the familyName and still an alias, exactly as on the B.LEAGUE.

Cyrillic and Greek ARE transliterated, because those are one-to-one enough to be safe and the
alternative is a Latin-alphabet site with unreadable rows in it.
"""
from __future__ import annotations

import re
import unicodedata

# Letters NFKD will not take apart: they are letters in their own right, not letter + accent.
_LETTERS = {
    "Æ": "Ae", "æ": "ae", "Ø": "O", "ø": "o", "Å": "A", "å": "a", "Þ": "Th", "þ": "th",
    "Ð": "D", "ð": "d", "ß": "ss", "Œ": "Oe", "œ": "oe", "Ł": "L", "ł": "l",
    "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "Ŋ": "N", "ŋ": "n", "Ŧ": "T", "ŧ": "t",
    "I": "I", "ı": "i", "İ": "I", "Ʉ": "U", "ʉ": "u",
}

# Cyrillic, in the transliteration a British reader expects from a basketball page.
_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh",
    "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "ђ": "dj", "ј": "j", "љ": "lj", "њ": "nj", "ћ": "c", "џ": "dz", "і": "i", "ї": "yi",
    "є": "ye", "ґ": "g",
}

_GREEK = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i",
    "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
    "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
}

# Name particles, for a caps feed turned back into a name.
#
# THE LEADING ONE IS CAPITALISED AND THE INTERIOR ONES ARE NOT: "Nando De Colo", "Jan Van der
# Berg". Dutch would write "van der Berg" and French "De Colo", and a feed that SHOUTS tells us
# neither the nationality nor the convention -- so the rule has to be one rule, and this is the one
# English-language basketball writes. A feed that sends mixed case already knows better and is left
# alone, which is where "van der Berg" survives intact.
_LOWER_PARTICLES = {
    "de", "del", "della", "der", "di", "da", "das", "dos", "du", "van", "von", "vander",
    "den", "ter", "te", "la", "le", "el", "al", "bin", "ibn", "af", "av", "y", "e",
}

# Suffixes are part of the family name, and never carry a full stop.
_SUFFIXES = {"jr": "Jr", "jnr": "Jr", "sr": "Sr", "snr": "Sr",
             "ii": "II", "iii": "III", "iv": "IV", "v": "V"}

_CJK = re.compile("[" + "぀-ヿ" + "㐀-䶿" + "一-鿿" + "豈-﫿" + "가-힯" + "]")


def has_cjk(s: str) -> bool:
    """Japanese, Chinese or Korean characters — which this module will not romanise by rule."""
    return bool(_CJK.search(str(s or "")))


def latinise(s: str) -> str:
    """Any alphabet in, ASCII out — except CJK, which is returned untouched.

    NFKD splits a letter from its accent so the accent can be dropped; the letters NFKD will not
    split (ø, ł, đ, ß …) are mapped by hand, because they are letters rather than decorated ones."""
    s = str(s or "")
    if has_cjk(s):
        return s
    # Greek by its own standard (ELOT 743, greek_latin) rather than the letter table below, which
    # gets every pair wrong (Evangelos, Antetokounmpo, Angelopoulos); what is left of the string is
    # Latin, and passes through the rest unchanged
    s = greek_latin(s)
    out = []
    for ch in s:
        if ch in _LETTERS:
            out.append(_LETTERS[ch])
            continue
        low = ch.lower()
        if low in _CYRILLIC:
            t = _CYRILLIC[low]
            out.append(t.capitalize() if ch.isupper() and t else t)
            continue
        if low in _GREEK:
            t = _GREEK[low]
            out.append(t.capitalize() if ch.isupper() and t else t)
            continue
        out.append(ch)
    s = "".join(out)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s


# ------------------------------------------------------------------ Bulgarian -> Latin
# BULGARIA'S OWN STANDARD, not the Russian-style table above: the Transliteration Act (State
# Gazette 19/2009), the "Streamlined System" on Bulgarian passports and road signs. It differs
# exactly where it matters for names: х h (Hristo, not Khristo), щ sht (Shterev), ъ a (Lachezar),
# ь y, ц ts, and "ия" at the end of a word is "ia" (Maria, Sofia). The country itself is Bulgaria.
# The scraper spells Bulgarian feeds with the same table (scraper files/bg_translit.py), so a
# player reads the same on the site as in the CSVs.
_BULGARIAN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht", "ъ": "a",
    "ь": "y", "ю": "yu", "я": "ya",
    # not Bulgarian letters, but met in names typed into a Bulgarian feed
    "ѝ": "i", "ё": "yo", "ы": "y", "э": "e", "ї": "yi", "і": "i", "є": "ye", "ґ": "g",
    "ђ": "dj", "ј": "j", "љ": "lj", "њ": "nj", "ћ": "c", "џ": "dz",
}
_CYR = re.compile("[Ѐ-ӿ]")
_BG_COUNTRY = re.compile(r"(?<![\w])(България|БЪЛГАРИЯ)(?![\w])")


def bulgarian_latin(s: str) -> str:
    """One string in Bulgaria's official transliteration; anything not Cyrillic passes through.
    Capitals follow the source: Живков -> Zhivkov, ЖИВКОВ -> ZHIVKOV."""
    if not isinstance(s, str) or not _CYR.search(s):
        return s
    s = _BG_COUNTRY.sub(lambda m: "BULGARIA" if m.group(1).isupper() else "Bulgaria", s)
    out: list = []
    n, i = len(s), 0
    while i < n:
        ch = s[i]
        low = ch.lower()
        if low not in _BULGARIAN:
            out.append(ch)
            i += 1
            continue
        start = i
        if low == "и" and i + 1 < n and s[i + 1].lower() == "я" and (i + 2 >= n or not s[i + 2].isalpha()):
            pair = [("i", ch), ("a", s[i + 1])]
            i += 2
        else:
            pair = [(_BULGARIAN[low], ch)]
            i += 1
        # ALL CAPS when a neighbouring letter is a capital too; otherwise only the first letter
        caps = (start > 0 and s[start - 1].isupper()) or (i < n and s[i].isupper())
        for t, src in pair:
            if not src.isupper() or not t:
                out.append(t)
            else:
                out.append(t.upper() if caps else t[0].upper() + t[1:])
    return "".join(out)


# ------------------------------------------------------------------ Greek -> Latin (ELOT 743)
# GREECE'S OWN STANDARD: ELOT 743 (= ISO 843 transcription), the system on Greek passports - which
# is why the famous names read Antetokounmpo, Spanoulis, Diamantidis. The letter table alone gets
# the pairs wrong, so they are handled first: ου ou; αυ ευ ηυ av/ev/iv before a vowel or a voiced
# consonant (β γ δ ζ λ μ ν ρ), af/ef/if otherwise (Evangelos, Efthymios); γγ ng, γκ gk, γξ nx,
# γχ nch; μπ b at a word's start or end, mp inside it (Bourousis, Antetokounmpo); ντ nt. Accents
# are dropped; a diaeresis breaks a pair (Taygetos). The scraper spells Greek with the same rules
# (scraper files/gr_translit.py).
_GR_LETTERS = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i",
    "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
    "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
}
_GR_VOICED = set("αεηιουωβγδζλμνρ")
_GR_PAIRS = {"γγ": "ng", "γκ": "gk", "γξ": "nx", "γχ": "nch", "ντ": "nt", "ου": "ou"}
_GR = re.compile("[Ͱ-Ͽἀ-῿]")
# capitals that look alike, Greek -> Latin: a league's data entry types one into the other script's
# word ("ΕVERTECH" is a Greek Epsilon + VERTECH), which letter-by-letter would half-transliterate
_GR_LOOKALIKE = {"Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M",
                 "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X"}
_LA_LOOKALIKE = {v: k for k, v in _GR_LOOKALIKE.items()}


def has_greek(s) -> bool:
    return bool(_GR.search(str(s or "")))


def _gr_repair(w: str) -> str:
    greek_only = sum(1 for c in w if _GR.match(c) and c not in _GR_LOOKALIKE)
    latin_only = sum(1 for c in w if c.isascii() and c.isalpha() and c.upper() not in _LA_LOOKALIKE)
    if greek_only and latin_only:
        return w
    if latin_only and any(c in _GR_LOOKALIKE for c in w):
        return "".join(_GR_LOOKALIKE.get(c, c) for c in w)
    if greek_only and any(c in _LA_LOOKALIKE for c in w):
        return "".join(_LA_LOOKALIKE.get(c, c) for c in w)
    return w


def _gr_word(w: str) -> str:
    """One Greek word, lower case and decomposed (NFD): accents gone, a diaeresis marks its letter."""
    chars, marks = [], []
    for c in w:
        if c == "̈":
            if marks:
                marks[-1] = True
            continue
        if unicodedata.combining(c):
            continue
        chars.append(c)
        marks.append(False)
    out, i, n = [], 0, len(chars)
    while i < n:
        c = chars[i]
        nxt = chars[i + 1] if i + 1 < n else ""
        nxt_marked = marks[i + 1] if i + 1 < n else False
        if c in "αεη" and nxt == "υ" and not nxt_marked:
            after = chars[i + 2] if i + 2 < n else ""
            out.append({"α": "a", "ε": "e", "η": "i"}[c] + ("v" if after in _GR_VOICED else "f"))
            i += 2
            continue
        if c == "μ" and nxt == "π":
            out.append("b" if i == 0 or i + 2 >= n else "mp")
            i += 2
            continue
        if c + nxt in _GR_PAIRS and not nxt_marked:
            out.append(_GR_PAIRS[c + nxt])
            i += 2
            continue
        out.append(_GR_LETTERS.get(c, c))
        i += 1
    return "".join(out)


def greek_latin(s: str) -> str:
    """Greek words by ELOT 743; everything else untouched. A word all in capitals stays capitals,
    a Capitalised word stays Capitalised."""
    if not isinstance(s, str) or not _GR.search(s):
        return s
    s = re.sub(r"[^\W\d_]+", lambda m: _gr_repair(m.group(0)), s)

    def one(m):
        w = m.group(0)
        if not _GR.search(w):
            return w
        lat = _gr_word(unicodedata.normalize("NFD", w.lower()))
        letters = [c for c in w if c.isalpha()]
        if len(letters) > 1 and all(c.isupper() for c in letters):
            return lat.upper()
        return lat[:1].upper() + lat[1:] if w[:1].isupper() else lat
    return re.sub(r"[^\W\d_]+", one, s)


def bulgarian_payload(obj):
    """Every string of a parsed JSON payload through bulgarian_latin (keys left alone)."""
    if isinstance(obj, str):
        return bulgarian_latin(obj)
    if isinstance(obj, list):
        return [bulgarian_payload(v) for v in obj]
    if isinstance(obj, dict):
        return {k: bulgarian_payload(v) for k, v in obj.items()}
    return obj


# ------------------------------------------------------------------ kana -> romaji
# Hepburn as a Japanese passport writes a name: no macrons, no apostrophes, long vowels not
# written (さとう Sato, おおわき Owaki, ゆうき Yuki), ん as m before b/m/p (なんば Namba) and n
# everywhere else, っ doubling the next consonant (っち -> tchi).
_KANA_ROMAJI = {
    "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
    "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
    "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
    "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
    "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
    "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
    "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
    "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
    "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
    "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
    "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
    "や": "ya", "ゆ": "yu", "よ": "yo",
    "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
    "わ": "wa", "ゐ": "i", "ゑ": "e", "を": "o", "ゔ": "vu",
    "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o", "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ゎ": "wa",
}
_SMALL_Y = {"ゃ": "a", "ゅ": "u", "ょ": "o"}
_SMALL_V = {"ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o"}
#: a kana + a small vowel whose sound is not "the kana's consonant + that vowel"
_KANA_PAIRS = {"うぃ": "wi", "うぇ": "we", "うぉ": "wo", "いぇ": "ye", "くぁ": "kwa", "ぐぁ": "gwa",
               "てゅ": "tyu", "でゅ": "dyu", "ふゅ": "fyu"}
_VOWELS = set("aeiou")


def _hira(ch: str) -> str:
    """Katakana to hiragana (ヴ to ゔ); anything else unchanged. ー is kept: it is not a kana."""
    o = ord(ch)
    return chr(o - 0x60) if 0x30A1 <= o <= 0x30F6 else ch


def is_kana(s: str) -> bool:
    """Only kana (either script), spaces and the name dot: a reading, which kana_romaji can spell."""
    s = str(s or "").strip()
    return bool(s) and all(c in " 　・ー" or "ぁ" <= c <= "ゖ" or "ァ" <= c <= "ヺ"
                           for c in s)


def kana_romaji(s: str) -> str:
    """A kana reading -> lower-case Hepburn, word breaks kept ("やまもと まい" -> "yamamoto mai").

    Either script: furigana is hiragana, a foreign player's name is katakana (チドム オデラ ->
    "chidomu odera"), and the extended katakana a foreign name needs (ティ di ファ ジェ ウォ ヴ)
    are spelt as they sound. The long-vowel mark is dropped, as passports drop long vowels.

    ONE HEURISTIC, stated: おう/おお/うう are a long vowel and written once, EXCEPT before え,
    where the う is the "ue" of 上 (いのうえ Inoue, not Inoe). Kana cannot say which, and this
    is the case names actually hit.

    Anything that is not kana (kanji, Latin) comes back untouched, so a caller can see it failed."""
    words = re.split(r"[\s　・]+", str(s or "").strip())
    return " ".join(w for w in (_kana_word([_hira(c) for c in w]) for w in words) if w)


def _kana_word(k: list) -> str:
    # one syllable at a time: (romaji, kana it came from)
    syl = []
    i = 0
    while i < len(k):
        c, nxt = k[i], (k[i + 1] if i + 1 < len(k) else "")
        pair = c + nxt
        if pair in _KANA_PAIRS:
            syl.append(_KANA_PAIRS[pair])
            i += 2
            continue
        base = _KANA_ROMAJI.get(c)
        if base and nxt in _SMALL_Y and base.endswith("i") and c not in "いぃ":
            head = base[:-1]
            syl.append(head + _SMALL_Y[nxt] if head in ("sh", "ch", "j") else head + "y" + _SMALL_Y[nxt])
            i += 2
            continue
        if base and nxt in _SMALL_V and c not in _SMALL_V and len(base) > 1:
            syl.append(base.rstrip("aeiou") + _SMALL_V[nxt])     # ふぁ fa, てぃ ti, じぇ je, ゔぁ va
            i += 2
            continue
        if c in ("っ", "ー", "ん"):
            syl.append(c)                     # resolved against their neighbours below
        elif base:
            syl.append(base)
        else:
            syl.append(c)                     # not kana: left as it is
        i += 1

    out = []
    for j, s in enumerate(syl):
        nxt = syl[j + 1] if j + 1 < len(syl) else ""
        if s == "ー":
            continue
        if s == "っ":
            if nxt[:1] and nxt[:1] not in _VOWELS and nxt[:1].isascii() and nxt[:1].isalpha():
                out.append("t" if nxt.startswith("ch") else nxt[0])
            continue
        if s == "ん":
            out.append("m" if nxt[:1] in ("b", "m", "p") else "n")
            continue
        # a long vowel: o+u, o+o, u+u written once -- unless the second one opens "ue"
        if s in ("u", "o") and out and out[-1][-1:] in ("o", "u") and nxt != "e":
            if (out[-1][-1], s) in (("o", "u"), ("o", "o"), ("u", "u")):
                continue
        out.append(s)
    return "".join(out)


def _cap_word(w: str, first_in_name: bool) -> str:
    """One word of a name, capitalised the way that word is written.

    A feed that shouts (EuroLeague, most Genius clients) has to be turned back into a name, and
    the naive .title() gets four things wrong: McDonald, O'Neal, Smith-Jones, and the particles in
    van der Berg — which stay lower case unless they open the name."""
    if not w:
        return w
    low = w.lower()
    if low.strip(".") in _SUFFIXES:
        return _SUFFIXES[low.strip(".")]
    if low in _LOWER_PARTICLES and not first_in_name:
        return low
    # hyphens and apostrophes each start a new capital: Smith-Jones, O'Neal, D'Angelo
    def cap(token: str) -> str:
        return token[:1].upper() + token[1:] if token else token
    w = "-".join(cap(p) for p in low.split("-"))
    w = "'".join(cap(p) for p in w.split("'"))
    if w.lower().startswith("mc") and len(w) > 2:
        w = "Mc" + w[2:3].upper() + w[3:]
    elif w.lower().startswith("mac") and len(w) > 4:
        w = "Mac" + w[3:4].upper() + w[4:]
    return w


def _shaped(s: str, keep_case: bool) -> str:
    """Trim, drop full stops, and case the words.

    keep_case leaves a name that is already mixed case alone — a feed that writes "van Basten" or
    "DeAndre" knows something this module does not, and only a SHOUTED name needs rebuilding."""
    s = str(s or "").replace(".", " ").strip()
    s = re.sub(r"\s+", " ", s)
    if not s:
        return ""
    words = s.split(" ")
    if keep_case:
        return " ".join(_SUFFIXES.get(w.lower(), w) for w in words)
    return " ".join(_cap_word(w, i == 0) for i, w in enumerate(words))


def _is_shouted(s: str) -> bool:
    letters = [c for c in s if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


def split_display(raw: str) -> tuple[str, str]:
    """A single string into (first, last), whichever way round the feed wrote it.

    "DONCIC, LUKA" and "Doncic, Luka" are family-name-first, which the comma says outright.
    Without a comma the feed is in reading order, and everything after the first word is the
    family name — "Juan Carlos Navarro" is Juan / Carlos Navarro, which is wrong for Spanish
    double forenames and right for everything else; feeds that know better send separate fields,
    and this is only the fallback for the ones that do not."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    if not s:
        return "", ""
    if "," in s:
        last, _, first = s.partition(",")
        return first.strip(), last.strip()
    parts = s.split(" ")
    if len(parts) == 1:
        return "", parts[0]
    return parts[0], " ".join(parts[1:])


def person(p, prefer_latin: bool = True) -> tuple[str, str, list[str]]:
    """The one entry point: a feed's idea of a player -> (first, last, aliases).

    `p` is either the payload dict (Genius, EuroLeague, ACB, B.LEAGUE … all of them nest the name
    differently, so every key any of them uses is looked at) or a plain string.

    The aliases are every OTHER form seen — the native spelling, the shouted one, the "LAST, FIRST"
    one — so nothing that was in the feed becomes unsearchable."""
    seen: list[str] = []

    if isinstance(p, str):
        first, last = split_display(p)
        seen.append(p)
    else:
        p = p or {}
        first = (p.get("firstName") or p.get("first_name") or p.get("first")
                 or p.get("givenName") or p.get("nombre") or "")
        last = (p.get("familyName") or p.get("last_name") or p.get("lastName") or p.get("last")
                or p.get("surname") or p.get("apellidos") or "")
        # the international fields are the Latin ones where a feed carries both scripts
        if prefer_latin and (has_cjk(first) or has_cjk(last) or not (first or last)):
            i_first = p.get("internationalFirstName") or p.get("firstNameEn") or p.get("firstNameRomaji") or ""
            i_last = (p.get("internationalFamilyName") or p.get("lastNameEn")
                      or p.get("familyNameEn") or p.get("lastNameRomaji") or "")
            if i_first or i_last:
                if first or last:
                    seen.append(f"{first} {last}".strip())
                first, last = i_first or first, i_last or last
        if not (first or last):
            raw = (p.get("name") or p.get("playerName") or p.get("displayName")
                   or p.get("scoreboardName") or p.get("fullName") or "")
            first, last = split_display(raw)
            if raw:
                seen.append(str(raw))
        for k in ("name", "playerName", "displayName", "scoreboardName", "fullName",
                  "internationalFirstName", "internationalFamilyName"):
            v = p.get(k)
            if isinstance(v, str) and v.strip():
                seen.append(v.strip())

    native = f"{first} {last}".strip()
    shout = _is_shouted(first) or _is_shouted(last)
    first = _shaped(latinise(first), keep_case=not shout and not _is_shouted(first))
    last = _shaped(latinise(last), keep_case=not shout and not _is_shouted(last))

    full = f"{first} {last}".strip()
    aliases = []
    for a in seen + [native]:
        a = re.sub(r"\s+", " ", str(a or "").strip())
        if a and a != full and a not in aliases:
            aliases.append(a)
    return first, last, aliases[:6]


# Club words that stay capitals when a shouted name is turned back into a name: initials of a
# university or a sponsor, and clubs whose own spelling is capitals. Anything without a vowel
# (BC, MBC, KK, SC) is an abbreviation by construction and needs no listing.
_CLUB_ACRONYMS = {"uat", "uanl", "uag", "uach", "udg", "uabc", "unam", "itson", "iteso", "itesm",
                  "asvel", "cska", "aek", "paok", "unics", "ewe", "ldlc", "jl", "sig", "ucam",
                  "cbc", "usa", "uk", "ii", "iii", "iv"}
_CLUB_LOWER = _LOWER_PARTICLES | {"of", "the", "and", "los", "las", "do", "dos"}


def _cap_club(name: str) -> str:
    """A SHOUTED club name written the way a club is written: Abejas de Leon, not ABEJAS DE LEON.

    Only ever called on a name that is capitals throughout. Particles (de, del, la…) stay lower
    case unless they open the name; abbreviations stay capitals; a hyphen or an apostrophe starts
    a new capital, as it does in a person's name."""
    out = []
    for i, w in enumerate(name.split(" ")):
        low = w.lower()
        bare = re.sub(r"[^a-z0-9]", "", low)
        if not bare:
            out.append(w)
        elif bare in _CLUB_ACRONYMS or (bare.isalpha() and not re.search(r"[aeiouy]", bare)) \
                or any(c.isdigit() for c in bare):
            out.append(w)
        elif low in _CLUB_LOWER and i > 0:
            out.append(low)
        else:
            w = "-".join(p[:1].upper() + p[1:] for p in low.split("-"))
            out.append("'".join(p[:1].upper() + p[1:] for p in w.split("'")))
    return " ".join(out)


def team_name(raw: str) -> str:
    """A club's name, latinised, and turned back into a name if the feed SHOUTED it.

    A club is not a person: "Žalgiris Kaunas" and "BC SLOVAN" are the club's own spellings, and
    rewriting somebody's brand is not this function's job — so a name with any lower-case letter
    in it is left exactly as written, and all this does is make it ASCII so the rest of the site
    can slug, search and sort it. The exception is a name in CAPITALS THROUGHOUT (Liga Nacional
    de Baloncesto Profesional, the CIBACOPA, some Genius clients), which is a feed's habit rather
    than a club's spelling and sat beside Title Case names on every page ("ABEJAS DE LEON" v
    "Fresas de Irapuato"). Those come back as Abejas de Leon. A one-word name of four letters or
    fewer (CSKA, PAOK, AEK) is an abbreviation and is left alone."""
    s = re.sub(r"\s+", " ", latinise(raw).strip())
    if s and _is_shouted(s) and not (" " not in s and len(s) <= 4):
        return _cap_club(s)
    return s


def short_form(name: str, maxlen: int = 12) -> str:
    """A name cut to fit a short_name column WITHOUT cutting a word in half. "Patrioti Levice"
    fits nowhere under 12 characters whole, so a bare name[:12] gave "Patrioti Lev" -- readable
    as neither the club's name nor an abbreviation of it (found 2026-09-18, on every Slovak SBL
    club whose short_name had just been repaired away from a numeric feed id: see
    feedplatform.py's team() and repair_numeric_short_names.py, the two places a club's own name
    stands in for a short_name the feed never gave). This keeps whole words from the front for as
    long as they fit, so "Patrioti Levice" becomes "Patrioti" and "BC SLOVAN Bratislava" becomes
    "BC SLOVAN" -- and only cuts mid-word for the rare single word already longer than maxlen."""
    s = re.sub(r"\s+", " ", str(name or "").strip())
    if len(s) <= maxlen:
        return s
    words = s.split(" ")
    out = words[0][:maxlen]
    for w in words[1:]:
        if len(out) + 1 + len(w) > maxlen:
            break
        out += " " + w
    return out


# ---------------------------------------------------------------- one club, one row ---
# Words that say nothing about WHICH club this is.
_CLUB_NOISE = {"basketball", "basket", "basquet", "baloncesto", "bc", "cb", "kk", "bk", "bbc",
               "sc", "sk", "club", "team", "sports", "sport", "the", "de", "of", "el", "la"}

# Words that say a great deal about which club this is, and must never be treated as a sponsor:
# a second team, an academy side, a women's side and a men's side are DIFFERENT clubs that share
# a name. Bristol Flyers II is not Bristol Flyers with a sponsor on the front.
_CLUB_MARKERS = {"ii", "iii", "iv", "2", "3", "4", "b", "c", "w", "women", "womens", "men", "mens",
                 "ladies", "academy", "reserves", "development", "youth", "juniors", "junior",
                 "u18", "u19", "u20", "u21", "u23", "junioren", "jr"}


def club_core(name: str) -> frozenset:
    """The tokens that identify a club, with the words that identify nobody removed.

    latinise() does not romanise CJK script -- there is no safe rule for that, same as
    names.py's own player-name path -- so a kanji name reaches here untouched. The OLD
    tokenizer (re.split on [^0-9a-z]+) treated every kanji character as mere punctuation
    between ASCII runs, discarding the only content that actually says which club this is:
    "A東京" (Alvark Tokyo) and "A千葉" (Altiri Chiba) both collapsed to the single token {"a"},
    so same_club() called them the same club wearing a different sponsor -- two real, distinct
    clubs (found 2026-09-18, on B.LEAGUE's own schedule). A contiguous run of kana/kanji is kept
    as ONE token instead (splitting per-character would make Tokyo and Kyoto share a token on
    one shared kanji, the same false-positive shape this function exists to prevent)."""
    s = latinise(str(name or "")).lower()
    toks = re.findall(r"[0-9a-z]+|[぀-ヿ㐀-鿿]+", s)
    return frozenset(t for t in toks if t and t not in _CLUB_NOISE)


def same_club(a: str, b: str) -> bool:
    """Is this the same club wearing a different sponsor?

    THE PROBLEM THIS SOLVES. Sponsors are part of a club's name in most of Europe and they change:
    the ACB's Manresa is Baxi Manresa, Zaragoza is Casademont Zaragoza, and Crvena Zvezda is
    Crvena Zvezda Meridianbet until the sponsor changes and it is not. A fixture list that writes
    the sponsored form and a club created from the unsponsored one are the same club, and the
    platform registering them as two is how a league ends up with twenty-two clubs in a field of
    twenty, half the fixtures under each and a table that adds up to nothing.

    THE RULE: one side's identifying words are all present in the other's, and what is left over
    is not a word that MARKS A DIFFERENT SIDE. So Baxi Manresa is Manresa (left over: a sponsor),
    and Bristol Flyers II is not Bristol Flyers (left over: II). Overlap alone will not do it —
    Bristol Flyers and Bristol Hurricanes overlap on Bristol, and they are two clubs."""
    A, B = club_core(a), club_core(b)
    if not A or not B:
        return False
    if A == B:
        return True
    small, big = (A, B) if len(A) <= len(B) else (B, A)
    if not small < big:                      # proper subset, or they are simply different clubs
        return False
    if big - small & _CLUB_MARKERS:
        return False
    return True
