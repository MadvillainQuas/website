"""matching.py — the Python port of epinoia/match.js: the same person, spelled three ways.

Kept in step with the JavaScript by hand (the scoring weights and the parse rules are the same
numbers); the worker uses it to decide whether a feed's "M. King-Danchie" is the platform's
Moziah King-Danchie before it creates a second player. Surname carries most of a score, the
forename confirms or contradicts, the club and shirt number settle what the name alone cannot,
and a best candidate that does not clear the threshold by a margin is 'ambiguous' — never
silently the first row.
"""
from __future__ import annotations

import re
import unicodedata

_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv)\b\.?")
_PARTICLE = {"van", "von", "de", "da", "del", "della", "di", "du", "le", "la", "st", "saint", "mac", "mc", "o", "bin", "al", "el", "ben"}
_NICK = {
    "michael": ["mike", "mikey", "mick", "mickey"], "matthew": ["matt", "matty"], "daniel": ["dan", "danny"],
    "christopher": ["chris", "kit"], "thomas": ["tom", "tommy"], "benjamin": ["ben", "benny", "benji"],
    "samuel": ["sam", "sammy"], "alexander": ["alex", "xander", "sasha"], "nicholas": ["nick", "nicky"],
    "joshua": ["josh"], "jacob": ["jake"], "william": ["will", "bill", "billy", "liam"], "joseph": ["joe", "joey"],
    "robert": ["rob", "bob", "bobby", "robbie"], "james": ["jim", "jimmy", "jamie"], "david": ["dave", "davey"],
    "stephen": ["steve", "stevie"], "steven": ["steve", "stevie"], "andrew": ["andy", "drew"], "oliver": ["ollie", "oli"],
    "henry": ["harry", "hal"], "edward": ["ed", "eddie", "ted", "teddy"], "anthony": ["tony", "ant"],
    "jonathan": ["jon", "jonny", "johnny"], "john": ["johnny", "jack"], "richard": ["rich", "rick", "ricky", "dick"],
    "charles": ["charlie", "chuck"], "patrick": ["pat", "paddy"], "timothy": ["tim", "timmy"],
    "nathaniel": ["nate", "nat"], "nathan": ["nate"], "zachary": ["zach", "zack"], "isaiah": ["zay"],
    "cameron": ["cam"], "dominic": ["dom"], "frederick": ["fred", "freddie"], "gregory": ["greg"],
    "jeremiah": ["jerry"], "leonard": ["leo", "lenny"], "maximilian": ["max"], "theodore": ["theo", "ted"],
    "louis": ["lou", "louie"], "lewis": ["lew"], "kenneth": ["ken", "kenny"], "raymond": ["ray"],
    "elizabeth": ["liz", "beth", "lizzie"], "katherine": ["kate", "katie", "kathy"], "jennifer": ["jen", "jenny"],
    "rebecca": ["becky", "bex"], "victoria": ["vicky", "tori"], "alexandra": ["alex", "lexi"],
    "jessica": ["jess"], "stephanie": ["steph"], "samantha": ["sam"], "charlotte": ["lottie", "charlie"],
    "isabella": ["bella", "izzy"], "gabriella": ["gabby"], "josephine": ["jo", "josie"],
}
_NICK_OF: dict[str, set] = {}
for _full, _ns in _NICK.items():
    _NICK_OF.setdefault(_full, set()).add(_full)
    for _n in _ns:
        _NICK_OF.setdefault(_n, set()).add(_full)


def normalize(s) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"['’`´]", "", s)
    s = re.sub(r"[-–—_.,/]+", " ", s)
    s = _SUFFIX.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def same_forename(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    A, B = _NICK_OF.get(a), _NICK_OF.get(b)
    if A and b in A:
        return True
    if B and a in B:
        return True
    return bool(A and B and (A & B))


class Name:
    __slots__ = ("first", "last", "first_tok", "initial", "last_tokens", "tokens", "full")

    def __init__(self, first: str, last: str):
        f = first.split(); l = last.split()
        self.first, self.last = first, last
        self.first_tok = f[0] if f else ""
        self.initial = self.first_tok[:1]
        self.last_tokens = l
        self.tokens = f + l
        self.full = (first + " " + last).strip()


def parse_name(x) -> Name:
    if isinstance(x, Name):
        return x
    if isinstance(x, dict):
        f = normalize(x.get("first") or x.get("first_name") or x.get("firstName") or "")
        l = normalize(x.get("last") or x.get("last_name") or x.get("lastName") or x.get("familyName") or "")
        if f or l:
            return Name(f, l)
        x = x.get("name") or ""
    raw = str(x or "").strip()
    if not raw:
        return Name("", "")
    if "," in raw:
        l, f = raw.split(",", 1)
        return Name(normalize(f), normalize(l))
    m = re.match(r"^(.+?)\s+([A-ZÀ-Ý][A-ZÀ-Ý' -]{1,})$", raw)
    if m and m.group(2) == m.group(2).upper() and len(m.group(2)) > 1:
        return Name(normalize(m.group(1)), normalize(m.group(2)))
    m = re.match(r"^([A-ZÀ-Ý][A-ZÀ-Ý' -]{1,})\s+(.+)$", raw)
    if m and m.group(1) == m.group(1).upper() and m.group(2) != m.group(2).upper():
        return Name(normalize(m.group(2)), normalize(m.group(1)))
    toks = normalize(raw).split()
    if len(toks) == 1:
        return Name("", toks[0])
    if len(toks[0]) == 1:
        return Name(toks[0], " ".join(toks[1:]))
    i = len(toks) - 1
    while i > 1 and toks[i - 1] in _PARTICLE:
        i -= 1
    return Name(" ".join(toks[:i]), " ".join(toks[i:]))


def jaro_winkler(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    m = max(len(a), len(b)) // 2 - 1
    am = [False] * len(a); bm = [False] * len(b); matches = 0
    for i, ca in enumerate(a):
        lo, hi = max(0, i - m), min(len(b) - 1, i + m)
        for j in range(lo, hi + 1):
            if bm[j] or ca != b[j]:
                continue
            am[i] = bm[j] = True; matches += 1; break
    if not matches:
        return 0.0
    t = 0; k = 0
    for i, ca in enumerate(a):
        if not am[i]:
            continue
        while not bm[k]:
            k += 1
        if ca != b[k]:
            t += 1
        k += 1
    t /= 2
    j = (matches / len(a) + matches / len(b) + (matches - t) / matches) / 3
    p = 0
    while p < 4 and p < len(a) and p < len(b) and a[p] == b[p]:
        p += 1
    return j + p * 0.1 * (1 - j)


def name_score(q, c) -> tuple[float, list[str]]:
    q, c = parse_name(q), parse_name(c)
    if not q.full or not c.full:
        return 0.0, []
    s = 0.0; reasons: list[str] = []
    if q.last and c.last:
        if q.last == c.last:
            s += 0.58; reasons.append("surname")
        else:
            jw = jaro_winkler(q.last.replace(" ", ""), c.last.replace(" ", ""))
            shared = any(len(t) > 2 and t in c.last_tokens for t in q.last_tokens)
            if jw >= 0.93:
                s += 0.48; reasons.append("surname~")
            elif shared:
                s += 0.42; reasons.append("surname-part")
            elif jw >= 0.86:
                s += 0.3; reasons.append("surname?")
            else:
                return 0.0, []
    elif q.last == c.last:
        s += 0.3
    if q.first_tok and c.first_tok:
        if same_forename(q.first_tok, c.first_tok):
            s += 0.36; reasons.append("forename" if q.first_tok == c.first_tok else "nickname")
        elif len(q.first_tok) == 1 or len(c.first_tok) == 1:
            if q.initial == c.initial:
                s += 0.2; reasons.append("initial")
            else:
                return 0.0, []
        else:
            jw = jaro_winkler(q.first_tok, c.first_tok)
            if jw >= 0.9:
                s += 0.3; reasons.append("forename~")
            elif q.initial == c.initial and (c.first_tok in q.first or q.first_tok in c.first):
                s += 0.28; reasons.append("forename-part")
            elif q.initial == c.initial:
                s += 0.08; reasons.append("initial-only")
            else:
                s -= 0.25
    elif not q.first_tok or not c.first_tok:
        s += 0.14; reasons.append("surname-only")
    jw_full = jaro_winkler(" ".join(sorted(q.tokens)), " ".join(sorted(c.tokens)))
    s = max(s, 0.9 if jw_full >= 0.97 else 0.0)
    return max(0.0, min(1.0, s)), reasons


_TEAM_NOISE = {"basketball", "club", "bc", "the", "team", "men", "women", "mens", "womens", "ii", "2", "b"}


def team_score(a, b) -> float:
    if not a or not b:
        return 0.0
    A = [t for t in normalize(a).split() if t not in _TEAM_NOISE]
    B = [t for t in normalize(b).split() if t not in _TEAM_NOISE]
    if not A or not B:
        return 0.0
    na, nb = " ".join(A), " ".join(B)
    if na == nb:
        return 1.0
    inter = len([t for t in A if t in set(B)])
    jac = inter / (len(A) + len(B) - inter)
    def code(x): return len(str(x)) <= 4 and str(x) == str(x).upper()
    if code(a) or code(b):
        c = normalize(a if code(a) else b); n = B if code(a) else A
        if "".join(t[0] for t in n).startswith(c) or any(t.startswith(c) for t in n):
            return 0.8
    return max(jac, 0.85 if jaro_winkler(na, nb) >= 0.94 else 0.0, 0.55 if inter else 0.0)


def match_player(query: dict, candidates: list[dict], threshold: float = 0.82, margin: float = 0.06) -> dict:
    """query: {name | first,last, team, number, position}; candidate: {id, name | first_name,last_name,
    aliases, team | teams, number, position}. Returns {status, match, best, ranked}."""
    q = parse_name(query.get("name") or query)
    q_team = query.get("team"); q_num = str(query["number"]) if query.get("number") not in (None, "") else None
    q_pos = str(query["position"]).lower()[:1] if query.get("position") else None
    ranked = []
    for c in candidates:
        names = [c.get("name") or {"first": c.get("first_name") or c.get("first"), "last": c.get("last_name") or c.get("last")}] + list(c.get("aliases") or [])
        best = (0.0, [])
        for n in names:
            r = name_score(q, n)
            if r[0] > best[0]:
                best = r
        if not best[0]:
            continue
        s, reasons = best[0], list(best[1])
        c_teams = list(c.get("teams") or []) + ([c["team"]] if c.get("team") else [])
        if q_team and c_teams:
            ts = max(team_score(q_team, t if isinstance(t, str) else (t.get("name") or t.get("short_name") or "")) for t in c_teams)
            if ts >= 0.8:
                s += 0.16; reasons.append("club")
            elif ts >= 0.55:
                s += 0.08; reasons.append("club~")
            else:
                s -= 0.14; reasons.append("other-club")
        if q_num and c.get("number") not in (None, ""):
            if str(c["number"]) == q_num:
                s += 0.1; reasons.append("number")
            else:
                s -= 0.05; reasons.append("other-number")
        if q_pos and c.get("position") and str(c["position"]).lower()[:1] == q_pos:
            s += 0.03; reasons.append("position")
        ranked.append({"candidate": c, "score": max(0.0, min(1.2, s)), "reasons": reasons})
    ranked.sort(key=lambda r: -r["score"])
    best = ranked[0] if ranked else None
    nxt = ranked[1] if len(ranked) > 1 else None
    status, match = "none", None
    if best and best["score"] >= threshold:
        if not nxt or best["score"] - nxt["score"] >= margin:
            status, match = "match", best["candidate"]
        else:
            status = "ambiguous"
    elif best:
        status = "weak"
    return {"status": status, "match": match, "best": best, "ranked": ranked}
