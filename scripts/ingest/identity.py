"""identity.py - who a box-score line belongs to: canonical names and a HIERARCHY of evidence.

WHY A HIERARCHY. The ingest used to decide a player in three unrelated steps, each able to answer on its own: a
process cache keyed on the feed's slot ("<club code>:<pno>"), a stored stamp of that slot on a player row, and a
fuzzy name score. A slot is not a person - operators re-enter their squads every game - and a cache or a stamp
that answers without looking at the name gave the whole CIBACOPA 2026 season to the wrong people (Justin Moss's 27
points against Frayles, 22 Mar 2026, filed under Keith Higgins, who was not in the game). A fuzzy score alone
cannot tell "Alejandro Reyna" from "Alejandro Reyna Martinez" (the same man) apart from "J. Martinez" and
"J. Martinez" (two men). So every candidate is placed in a TIER by the strongest thing that is true of it, and a
lower tier never beats a higher one, whatever its score:

    tier 1  CANONICAL   the canonical full name is identical, on this club
    tier 2  CONFIRMED   the names are compatible (see below) and the shirt matches, on this club
    tier 3  ON CLUB     the names are compatible, on this club (alone it wins; beside another, the tie-breaks)
    tier 4  MOVED       the names are compatible and the shirt matches, at another club in the league
    tier 5  FUZZY       the name score (matching.py) clears the threshold, on this club or in the league
    (none)              no candidate: a new player

Inside a tier the order is: the shirt (a player wearing the number beats one who is not), the stored slot stamp
(this slot named this player last time - a tie-breaker only, never evidence on its own), then the name score.

COMPATIBLE NAMES are one person spelt two ways by one feed: word for word, the shorter surname is the start of the
longer ("Reyna" / "Reyna Martinez"; "Higgins" / "Higgins Jr" - suffixes are dropped), and the forenames agree on
their first word, or one is an initial of the other ("A." / "Alejandro"; "Keith" / "Keith Shondwell").

TWO PEOPLE WHO FIT THE SAME TIER EQUALLY are never split by guesswork. If they are two profiles of ONE person
(compatible with each other, same club, no shirt against it) the canonical - the fuller name - is the answer, so
the pair stops taking turns. If they are two people (two J. Martinez, shirts unknown) the answer is 'ambiguous'.

THE CANONICAL NAME is the fullest spelling the feed gives that is compatible with the short one: CIBACOPA's
"Justin" / "Moss" beside its registration's "JUSTIN TREVON" / "MOSS" is Justin Trevon Moss, which is also how the
platform already names him. An incompatible pair (a nickname in one field) keeps the ordinary spelling.
"""
from __future__ import annotations

import re

import names
from matching import match_player, normalize as normalize_name

TIER_NAMES = {1: "canonical name", 2: "name + shirt", 3: "compatible name on the club",
              4: "name + shirt at another club", 5: "name score"}


# ------------------------------------------------------------------ names
def words(s) -> list:
    return [w for w in normalize_name(s).split(" ") if w]


def surname_compatible(a, b) -> bool:
    A, B = words(a), words(b)
    if not A or not B:
        return False
    short, long_ = (A, B) if len(A) <= len(B) else (B, A)
    return long_[:len(short)] == short


def forename_compatible(a, b) -> bool:
    A, B = words(a), words(b)
    if not A or not B:
        return True                     # nothing to contradict
    x, y = A[0], B[0]
    if len(x) == 1 or len(y) == 1:
        return x[0] == y[0]
    return x == y


def compatible(first_a, last_a, first_b, last_b) -> bool:
    return surname_compatible(last_a, last_b) and forename_compatible(first_a, first_b)


def shirt(v) -> str:
    s = str(v if v is not None else "").strip()
    return s.lstrip("0") or ("0" if s else "")


def _title(s: str) -> str:
    return names._shaped(names.latinise(s), keep_case=False) if s else ""


def canonical_name(p) -> dict:
    """{first, last, key, aliases} for a feed's player (payload dict) or a platform row (first_name/last_name).

    The ordinary spelling is names.person(); where the payload also carries the registration's international
    fields and they are a compatible, FULLER spelling of the same name, those win."""
    if isinstance(p, dict) and ("first_name" in p or "last_name" in p) and "firstName" not in p:
        first, last, aliases = p.get("first_name") or "", p.get("last_name") or "", list(p.get("aliases") or [])
    else:
        first, last, aliases = names.person(p)
        if isinstance(p, dict):
            i_first = str(p.get("internationalFirstName") or "").strip()
            i_last = str(p.get("internationalFamilyName") or "").strip()
            if i_last and not names.has_cjk(i_last) and compatible(first, last, i_first, i_last) \
                    and len(words(i_first)) + len(words(i_last)) > len(words(first)) + len(words(last)):
                full_first, full_last = _title(i_first), _title(i_last)
                if f"{first} {last}".strip() not in aliases:
                    aliases = [f"{first} {last}".strip()] + list(aliases)
                first, last = full_first or first, full_last or last
    key = " ".join(words(first) + words(last))
    return {"first": first.strip(), "last": last.strip(), "key": key, "aliases": aliases}


# ------------------------------------------------------------------ tiers
def tier_of(q: dict, c: dict, club: str, others_compatible: int) -> tuple:
    """(tier or None, reasons) for one candidate. `q` = {first, last, key, shirt}; `c` = a candidate row with
    first_name, last_name, number (its roster shirt), team (its club's name); `others_compatible` = how many OTHER
    players on this club are also name-compatible with q."""
    cn = canonical_name(c)
    same_club = (c.get("team") or "") == (club or "")
    comp = compatible(q["first"], q["last"], cn["first"], cn["last"])
    alias_keys = {" ".join(words(a)) for a in cn["aliases"] or []}
    shirt_ok = bool(q.get("shirt")) and shirt(c.get("number")) == q["shirt"]
    if same_club and (cn["key"] == q["key"] or q["key"] in alias_keys) and q["key"]:
        return 1, ["canonical name"]
    if comp and same_club and shirt_ok:
        return 2, ["compatible name", "shirt"]
    if comp and same_club:
        # alone, it is the answer; beside another compatible teammate, the shirt and then the slot stamp decide,
        # and with neither the line stays unmatched (resolve)
        return 3, ["compatible name", "only one on the club" if others_compatible == 0 else "one of several on the club"]
    if comp and not same_club and shirt_ok:
        return 4, ["compatible name", "shirt", "other club"]
    return None, []


def resolve(p: dict, candidates: list, club: str, stamped: str | None = None, avoid: set | None = None) -> dict:
    """The player a feed's line belongs to. `p` is the payload's player dict (or {first, last, shirt}); `candidates`
    are platform rows ({id, first_name, last_name, aliases, number, team}); `stamped` the id the stored slot stamp
    names; `avoid` ids already given a line in this game.

    Returns {status: match | ambiguous | none, player, tier, reasons, ranked: [(tier, candidate)...]}."""
    avoid = avoid or set()
    if "firstName" in p or "familyName" in p or "internationalFamilyName" in p:
        cq = canonical_name(p)
        q = {"first": cq["first"], "last": cq["last"], "key": cq["key"], "shirt": shirt(p.get("shirtNumber"))}
    else:
        q = {"first": p.get("first", ""), "last": p.get("last", ""), "shirt": shirt(p.get("shirt"))}
        q["key"] = " ".join(words(q["first"]) + words(q["last"]))
    cands = [c for c in candidates if c.get("id") and c["id"] not in avoid]
    club_comp = [c for c in cands if (c.get("team") or "") == (club or "")
                 and compatible(q["first"], q["last"], *(lambda n: (n["first"], n["last"]))(canonical_name(c)))]

    ranked = []
    for c in cands:
        others = len([o for o in club_comp if o is not c and not _one_person(o, c)])
        t, why = tier_of(q, c, club, others)
        if t:
            ranked.append((t, c, why))

    if not ranked:
        # tier 5: the shared name score, only where nothing better exists
        res = match_player({"name": {"first": q["first"], "last": q["last"]}, "team": club, "number": q["shirt"]}, cands)
        if res["status"] == "match":
            return {"status": "match", "player": res["match"], "tier": 5, "reasons": res["best"]["reasons"], "ranked": []}
        if res["status"] == "ambiguous":
            return {"status": "ambiguous", "player": None, "tier": 5,
                    "reasons": ["name score too close"], "ranked": [(5, x["candidate"]) for x in res["ranked"][:3]]}
        return {"status": "none", "player": None, "tier": None, "reasons": [], "ranked": []}

    best_tier = min(t for t, _, _ in ranked)
    top = [(c, why) for t, c, why in ranked if t == best_tier]

    def order(cw):
        c, _ = cw
        return (0 if q["shirt"] and shirt(c.get("number")) == q["shirt"] else 1,
                0 if stamped and c["id"] == stamped else 1)
    top.sort(key=order)
    lead = [cw for cw in top if order(cw) == order(top[0])]
    if len(lead) == 1:
        c, why = lead[0]
        return {"status": "match", "player": _canonical_of(c, cands), "tier": best_tier,
                "reasons": why + (["slot stamp"] if stamped == c["id"] else []), "ranked": [(t, c) for t, c, _ in ranked]}
    # several fit equally: one person filed twice -> the canonical one; two people -> ambiguous
    group = [c for c, _ in lead]
    if all(_one_person(a, b) for a in group for b in group if a is not b):
        return {"status": "match", "player": _fullest(group), "tier": best_tier,
                "reasons": lead[0][1] + ["canonical of duplicate profiles"], "ranked": [(t, c) for t, c, _ in ranked]}
    return {"status": "ambiguous", "player": None, "tier": best_tier,
            "reasons": ["players of one name at this tier"], "ranked": [(best_tier, c) for c in group]}


def _one_person(a: dict, b: dict) -> bool:
    """Two platform rows that are one person filed twice: compatible names, one club, shirts not against it."""
    na, nb = canonical_name(a), canonical_name(b)
    if not compatible(na["first"], na["last"], nb["first"], nb["last"]):
        return False
    if (a.get("team") or "") != (b.get("team") or ""):
        return False
    sa, sb_ = shirt(a.get("number")), shirt(b.get("number"))
    return not (sa and sb_ and sa != sb_)


def _fullest(group: list) -> dict:
    return max(group, key=lambda c: (len(words(c.get("first_name"))) + len(words(c.get("last_name"))),
                                     len(normalize_name(f"{c.get('first_name')} {c.get('last_name')}")), str(c.get("id"))))


def _canonical_of(c: dict, cands: list) -> dict:
    """A winner that has a duplicate profile of itself among the candidates hands over to the canonical one."""
    dupes = [o for o in cands if o is not c and _one_person(o, c)]
    return _fullest([c] + dupes) if dupes else c


def assign(lines: list, candidates: list, club: str, stamps: dict | None = None) -> dict:
    """A whole club's lines in one game at once: {slot: resolve-result}. Strongest evidence is placed first, so a
    fuzzy line can never take a player a tier-1 or tier-2 line belongs to, and two teammates of one name are
    decided by their shirts before either is placed. `lines` = [(slot, payload player)], `stamps` = {slot: id}."""
    stamps = stamps or {}
    first_pass = {slot: resolve(p, candidates, club, stamps.get(slot)) for slot, p in lines}
    order = sorted(lines, key=lambda sp: (first_pass[sp[0]]["tier"] or 9, sp[0]))
    taken: set = set()
    out = {}
    for slot, p in order:
        r = first_pass[slot]
        if r["status"] != "match" or r["player"]["id"] in taken:
            r = resolve(p, candidates, club, stamps.get(slot), avoid=taken)
        if r["status"] == "match":
            taken.add(r["player"]["id"])
        out[slot] = r
    return out
