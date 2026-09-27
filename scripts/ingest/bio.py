"""Player bio (height, weight, date of birth) from a league's own feed or club pages, matched to the players already on EPINOIA.

    bio_sync.py                    reads the sources; this file is the part that decides what may be written

WHAT IS WRITTEN, AND WHAT IS NEVER:
  * Only BLANKS are filled. A height, weight or birth year a person typed is never replaced by a feed's.
  * An ADULT's full date of birth goes to players.birth_date (0184): a column no browser can read. The site shows his age
    (player_ages()) and his birth year, so the age moves by itself on his birthday and the date stays private.
  * Under 18: the date is never stored, only the birth year (the database drops a date that would make him a minor, whoever
    writes it; this file simply does not send one). is_minor is not touched: that is a decision, not a fact from a roster.
  * A feed year that disagrees with the one already stored is left alone and reported.

MATCHING: a feed that names the same player key the game feed did (EuroLeague's person code is the box score's Player_ID) is matched by
that key alone. Everything else goes through the shared matcher (matching.match_player: surname, forename, club) and only an outright
"match" is accepted; "ambiguous" and "weak" are counted and left. A wrong height on a stranger is worse than a blank.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Callable, Iterable, Optional

import matching

MIN_AGE, MAX_AGE = 14, 50          # a player's age as a feed states it; outside this the feed is wrong about him, not right about something rare
ADULT_AT = 18
VERBOSE = False                    # bio_sync --verbose: also print every feed row that matched nobody


# ---------------------------------------------------------------- cleaners ---
def _num(v) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"\d+(?:[.,]\d+)?", str(v))
    return float(m.group(0).replace(",", ".")) if m else None


def clean_height(v) -> Optional[int]:
    """Centimetres, 130..250. 1.98 (metres) is read as 198; a feed's 0 is 'not given'."""
    n = _num(v)
    if not n:
        return None
    if n < 3:                                           # metres
        n *= 100
    n = round(n)
    return n if 130 <= n <= 250 else None


def clean_weight(v) -> Optional[int]:
    """Kilograms, 45..200 (a feed's 0 is 'not given')."""
    n = _num(v)
    if not n:
        return None
    n = round(n)
    return n if 45 <= n <= 200 else None


def parse_birth(v) -> Optional[date]:
    """A date as feeds print it: 2004-08-28 (with or without a time), 2000/03/18, 28.08.2004, 28/08/2004, 23-03-1991,
    '14. 4. 2002', 19920507, 1991年9月3日. Anything else is None."""
    if not v:
        return None
    s = str(v).strip()
    m = (re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s) or re.match(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日", s)
         or re.match(r"(\d{4})(\d{2})(\d{2})$", s))
    if m:
        y, mo, d = (int(x) for x in m.groups())
    else:
        m = re.match(r"(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})", s)
        if not m:
            return None
        d, mo, y = (int(x) for x in m.groups())
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def age_on(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


# -------------------------------------------------------------------- plan ---
def plan(existing: dict, rec: dict, today: Optional[date] = None, has_dob: bool = True) -> tuple[dict, list]:
    """(patch, notes): the columns to write for one matched player, and anything worth telling the operator.
    `existing` is the player row (height_cm, weight_kg, birth_year, birth_date); `rec` the feed's height_cm/weight_kg/birth."""
    today = today or date.today()
    patch, notes = {}, []
    h, w, b = clean_height(rec.get("height_cm")), clean_weight(rec.get("weight_kg")), parse_birth(rec.get("birth"))
    if h and not existing.get("height_cm"):
        patch["height_cm"] = h
    if w and not existing.get("weight_kg"):
        patch["weight_kg"] = w
    if b:
        age = age_on(b, today)
        if not MIN_AGE <= age <= MAX_AGE:
            notes.append(f"implausible age {age} ({b.isoformat()}): left")
        else:
            have_year, have_date = existing.get("birth_year"), existing.get("birth_date")
            if have_year and have_year != b.year:
                notes.append(f"birth year {have_year} on file, feed says {b.year}: left")
            elif age >= ADULT_AT and has_dob:
                if not have_date:
                    patch["birth_date"] = b.isoformat()           # the trigger sets the year from it
            elif not have_year:
                patch["birth_year"] = b.year                       # a minor, or no date column yet: the year only
    elif rec.get("birth_year") and not existing.get("birth_year") and not existing.get("birth_date"):
        y = int(rec["birth_year"])
        if MIN_AGE <= today.year - y <= MAX_AGE:            # a feed that prints only a year (a youth licence): the year is the whole fact
            patch["birth_year"] = y
        else:
            notes.append(f"implausible birth year {y}: left")
    return patch, notes


# -------------------------------------------------------------- the players ---
def load_players(sb, league_slug: str, has_dob: bool = True) -> list[dict]:
    """Every player who has ever been on a roster in the league, with the columns bio needs. One row per player."""
    lg = sb.select("leagues", f"slug=eq.{league_slug}&select=id&limit=1")
    if not lg:
        raise SystemExit(f"no league '{league_slug}'")
    cols = "id,first_name,last_name,aliases,external_ids,birth_year,height_cm,weight_kg,is_minor" + (",birth_date" if has_dob else "")
    rows = sb.select_all("roster_entries", "select=jersey,teams!inner(name,short_name,league_id),players(" + cols + ")"
                                            f"&teams.league_id=eq.{lg[0]['id']}&order=id")
    by: dict = {}
    for r in rows:
        p = r.get("players")
        if not p:
            continue
        e = by.setdefault(p["id"], {"id": p["id"], "first_name": p.get("first_name"), "last_name": p.get("last_name"),
                                    "aliases": p.get("aliases") or [], "teams": [], "row": p, "keys": set()})
        t = r.get("teams") or {}
        for n in (t.get("name"), t.get("short_name")):
            if n and n not in e["teams"]:
                e["teams"].append(n)
        ext = p.get("external_ids") or {}
        for k in [ext.get("fiba_livestats")] + list(ext.get("also") or []):
            if k:
                e["keys"].add(str(k))
    return list(by.values())


def load_teams(sb, league_slug: str) -> list[dict]:
    """The league's clubs as {id, name, short_name, code}: code is the feed's own club id (external_ids.fiba_livestats), for a reader that
    goes club by club."""
    lg = sb.select("leagues", f"slug=eq.{league_slug}&select=id&limit=1")
    if not lg:
        raise SystemExit(f"no league '{league_slug}'")
    rows = sb.select_all("teams", f"league_id=eq.{lg[0]['id']}&select=id,name,short_name,external_ids&order=id")
    return [{"id": t["id"], "name": t.get("name"), "short_name": t.get("short_name"),
             "code": str((t.get("external_ids") or {}).get("fiba_livestats") or "")} for t in rows]


def probe_dob(sb) -> bool:
    """Is players.birth_date there (0184 applied)? Without it only birth years are written."""
    try:
        sb.select("players", "select=birth_date&limit=1")
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- matching ---
def _key_index(players: list) -> dict:
    idx: dict = {}
    for p in players:
        for k in p["keys"]:
            idx.setdefault(k.rsplit(":", 1)[-1], []).append(p)
    return idx


def find(rec: dict, players: list, key_idx: dict) -> tuple[Optional[dict], str]:
    """(player, how): by the feed's own key if it has one, otherwise by name and club. how = key | name | ambiguous | weak | none."""
    key = str(rec.get("key") or "")
    if key:
        hit = key_idx.get(key) or []
        if len(hit) == 1:
            return hit[0], "key"
        if len(hit) > 1:
            return None, "ambiguous"
    q = {"name": rec.get("name") or {"first": rec.get("first"), "last": rec.get("last")}, "team": rec.get("team")}
    r = matching.match_player(q, [{"id": p["id"], "first_name": p["first_name"], "last_name": p["last_name"],
                                    "aliases": p["aliases"], "teams": p["teams"]} for p in players])
    if r["status"] == "match":
        got = r["match"]
        return next((p for p in players if p["id"] == got["id"]), None), "name"
    return None, r["status"]


# -------------------------------------------------------------------- sync ---
def sync(sb, players: list, records: Iterable[dict], *, dry: bool, has_dob: bool = True, log: Callable = print,
         today: Optional[date] = None, limit: int = 0) -> dict:
    """Match each record, write the blanks it can fill. A record may carry `detail`: a function that fetches the height, weight and
    birth date lazily (called only for a player who has something missing, so a roster page costs one request per NEW bio, not per
    player)."""
    key_idx = _key_index(players)
    st = {"records": 0, "matched": 0, "written": 0, "nothing_new": 0, "ambiguous": 0, "unmatched": 0, "conflicts": 0, "detail_calls": 0}
    seen: dict = {}
    for rec in records:
        st["records"] += 1
        p, how = find(rec, players, key_idx)
        if not p:
            st["ambiguous" if how in ("ambiguous", "weak") else "unmatched"] += 1
            if how != "none" and VERBOSE:
                log(f"    ? {rec.get('label') or rec.get('name')}: {how}")
            continue
        if p["id"] in seen:
            continue                                        # two feed rows for one player: the first wins
        seen[p["id"]] = 1
        st["matched"] += 1
        ex = p["row"]
        full = dict(rec)
        yr, on = ex.get("birth_year"), (today or date.today()).year
        may_adult = not yr or yr + ADULT_AT <= on              # a year that still makes him a minor cannot give a date worth asking for
        need = (not ex.get("height_cm") or not ex.get("weight_kg")
                or (has_dob and not ex.get("birth_date") and may_adult) or (not has_dob and not yr))
        if rec.get("detail") and need and not (rec.get("height_cm") and rec.get("birth")):
            st["detail_calls"] += 1
            try:
                full.update({k: v for k, v in (rec["detail"]() or {}).items() if v})
            except Exception as exc:                        # one bad page is not the run
                log(f"    ! {rec.get('label') or rec.get('name')}: detail failed ({exc})")
        patch, notes = plan(ex, full, today, has_dob)
        for n in notes:
            st["conflicts"] += 1
            log(f"    ~ {p['first_name']} {p['last_name']}: {n}")
        if not patch:
            st["nothing_new"] += 1
            continue
        show = {k: ("<date>" if k == "birth_date" else v) for k, v in patch.items()}     # the date is secret: not in logs either
        log(f"    + {p['first_name']} {p['last_name']}: {show}")
        if not dry:
            sb.patch("players", f"id=eq.{p['id']}", patch)
        for k, v in patch.items():
            ex[k] = v                                        # what a later record of the run sees
        st["written"] += 1
        if limit and st["written"] >= limit:
            break
    return st
