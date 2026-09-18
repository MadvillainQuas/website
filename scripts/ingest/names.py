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


def team_name(raw: str) -> str:
    """A club's name, latinised but otherwise left alone.

    A club is not a person: "Žalgiris Kaunas" is the club's name and title-casing it would be
    rewriting somebody's brand. All this does is make it ASCII so the rest of the site can slug,
    search and sort it."""
    return re.sub(r"\s+", " ", latinise(raw).strip())


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
    """The tokens that identify a club, with the words that identify nobody removed."""
    toks = re.split(r"[^0-9a-z]+", latinise(str(name or "")).lower())
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
