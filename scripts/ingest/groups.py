"""
groups.py — which conference (or group) and division a club plays in, for a source that says.

WHY THIS EXISTS. A competition can be several tables (0018's groups: ProB Nord and Süd) or a
college league split into conferences with divisions inside them (0144: U SPORTS' Canada West,
OUA East/West, RSEQ, AUS). The table is ranked per group, and a conference game is a game
between two members of the same conference - so the ingest has to know who is in which.

Nothing in a feed says so reliably. A schedule lists games, not memberships, and the one place
membership is written down cleanly is outside the feed (for U SPORTS: masseyratings.com's
conference pages). So membership lives in a file in the repo, named by the source:

    "groups_file": "config/groups/usports.json"      (top level or adapter_config)

and this module turns a club's name into {"group_name": ..., "division_name": ...} at the moment
the ingest enters the club in the competition. Only sources with a file get the keys at all: every
other league's competition_teams rows are written exactly as before, and a group an administrator
set by hand in the console is never touched.

THE FILE:

    {
      "format": "conferences",                 # the competition's format (0144), optional
      "default": {                             # membership when no season overrides it
        "OUA":   {"divisions": {"East": ["Toronto Metropolitan", ...], "West": [...]}},
        "RSEQ":  {"teams": ["Bishop's", "McGill", ...]}
      },
      "seasons": {"2024-25": {...}}            # a season whose membership differed
    }

A team is a string or a list of spellings (["Toronto Metropolitan", "TMU", "Ryerson"]): the feed
names a club one way and the site another, and the first spelling is only the canonical one for a
reader of this file. Names are matched folded - case, accents, punctuation and "&"/"and" do not
matter - because "St. Francis Xavier" and "St Francis Xavier" are one university.

A club the file does not know is reported once per run and entered with no group (it still plays,
it still has a record; it just appears under no conference until the file names it). That is the
case for a non-conference opponent from outside the league, which is exactly right.

A FEED THAT STATES MEMBERSHIP ITSELF needs no file: "groups_from_feed": true in adapter_config, and
the adapter names each fixture's group (NBL1: its conference). See learn() below.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

_FILES: dict = {}
_WARNED: set = set()


def fold(name: str) -> str:
    """A club's name reduced to what identifies it: no case, accents, punctuation or '&'."""
    s = str(name or "")
    # an apostrophe joins rather than splits: "Bishop's" and "Bishops", "St. Mary's" and
    # "St Marys" are one club each (the curly forms first - NFKD would drop them anyway)
    s = re.sub(r"['‘’`]", "", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def _path_of(src: dict) -> str | None:
    ac = src.get("adapter_config") or {}
    return src.get("groups_file") or ac.get("groups_file")


def load(path: str) -> dict:
    """The groups file, parsed once per run. A relative path is from the repo root."""
    if path not in _FILES:
        p = Path(path)
        if not p.is_absolute():
            p = REPO_ROOT / p
        _FILES[path] = json.loads(p.read_text(encoding="utf-8"))
    return _FILES[path]


def spec_for(src: dict) -> dict | None:
    path = _path_of(src)
    if path:
        return load(path)
    return _learnt_spec(src)


# ------------------------------------------------------------------ membership the feed states
# SOME FEEDS SAY IT THEMSELVES. NBL1's schedule is served one season per conference ("2026 South
# Men"), so every fixture arrives already knowing its conference - more reliably than any file could,
# for a hundred and forty clubs that change every year. A source with
#     "groups_from_feed": true                       (adapter_config)
# has its adapter put ScheduleGame.extra["home_group"] / ["away_group"] on each fixture, and
# run_ingest hands the discovered games to learn() before anything is written. The membership then
# works exactly like a file's - spec_for returns it in a file's shape - for the rest of the run. A run
# that learnt nothing (the live lane, which does not discover) has no spec, so it leaves every club's
# group as the last discovery pass set it.
_LEARNT: dict = {}                   # source key -> {season: {group: set(names)}}


def _feed_key(src: dict) -> tuple:
    return (src.get("adapter"), src.get("code"), src.get("schedule_url") or tuple(src.get("scheduleUrls") or ()))


def learn(src: dict, season: str | None, games) -> int:
    """Take each fixture's group from the feed (extra home_group / away_group). Returns how many
    club-in-group facts were read; 0 for a source that does not take its groups from the feed."""
    ac = src.get("adapter_config") or {}
    if not ac.get("groups_from_feed"):
        return 0
    book = _LEARNT.setdefault(_feed_key(src), {}).setdefault(season, {})
    n = 0
    for g in games or []:
        ex = getattr(g, "extra", None) or {}
        for side, name in (("home", getattr(g, "home_name", "")), ("away", getattr(g, "away_name", ""))):
            grp = str(ex.get(f"{side}_group") or "").strip()
            if grp and name:
                book.setdefault(grp, set()).add(name)
                n += 1
    return n


def _learnt_spec(src: dict) -> dict | None:
    ac = src.get("adapter_config") or {}
    if not ac.get("groups_from_feed"):
        return None
    learnt = _LEARNT.get(_feed_key(src)) or {}
    if not any(learnt.values()):
        return None
    return {"format": src.get("competition_format") or ac.get("competition_format"),
            "seasons": {season: {grp: sorted(names) for grp, names in book.items()}
                        for season, book in learnt.items()}}


def _spellings(entry) -> list:
    return [entry] if isinstance(entry, str) else [e for e in (entry or []) if e]


def membership(spec: dict, season: str | None) -> dict:
    """{folded spelling: (group, division or None)} for one season."""
    seasons = spec.get("seasons") or {}
    groups = seasons.get(season) if season in seasons else spec.get("default") or {}
    out: dict = {}
    for gname, g in (groups or {}).items():
        if isinstance(g, list):                      # {"Nord": ["Team", ...]}: a group, no divisions
            g = {"teams": g}
        for entry in g.get("teams") or []:
            for s in _spellings(entry):
                out[fold(s)] = (gname, None)
        for dname, teams in (g.get("divisions") or {}).items():
            for entry in teams or []:
                for s in _spellings(entry):
                    out[fold(s)] = (gname, dname)
    return out


def has_divisions(spec: dict) -> bool:
    """Whether any season of this file splits a group into divisions. Only then is
    competition_teams.division_name written at all - it exists only once 0144 is applied, and a
    league without divisions has no reason to depend on that."""
    blocks = [spec.get("default") or {}] + list((spec.get("seasons") or {}).values())
    return any(isinstance(g, dict) and g.get("divisions") for b in blocks for g in (b or {}).values())


def competition_format(src: dict) -> str | None:
    """The format the source's competition should carry ('groups', 'conferences'), if it says."""
    ac = src.get("adapter_config") or {}
    spec = spec_for(src) or {}
    return src.get("competition_format") or ac.get("competition_format") or spec.get("format")


def entry(src: dict, season: str | None, *names: str) -> dict:
    """The group (and division) fields for a club's competition_teams row: {} for a source with no
    groups file, so every other league's row is written exactly as it always was."""
    spec = spec_for(src)
    if not spec:
        return {}
    table = membership(spec, season)
    for n in names:
        hit = table.get(fold(n)) if n else None
        if hit:
            row = {"group_name": hit[0]}
            if has_divisions(spec):
                row["division_name"] = hit[1]
            return row
    key = (_path_of(src), season, tuple(fold(n) for n in names if n))
    if key not in _WARNED:
        _WARNED.add(key)
        shown = next((n for n in names if n), "?")
        where = _path_of(src) or "the groups its feed named this run"
        print(f"    ! {shown} is in no group of {where} ({season or 'default'}) - entered with none")
    return {}


def same_group(src: dict, season: str | None, home: str, away: str) -> bool | None:
    """Whether two clubs share a group this season: None when the source has no groups file or
    either club is unknown to it (the database then works it out, 0144)."""
    spec = spec_for(src)
    if not spec:
        return None
    table = membership(spec, season)
    h, a = table.get(fold(home)), table.get(fold(away))
    if not h or not a:
        return None
    return h[0] == a[0]
