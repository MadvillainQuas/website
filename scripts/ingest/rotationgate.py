# -*- coding: utf-8 -*-
"""A LEAGUE WHOSE SOURCE RECORDS NO ROTATION IS DROPPED (Louie, 2026-10-08).

The Greek Elite League's 2026-27 source (stats.basket.gr) published its opening game with no minutes,
no starters and not one substitution - the action alone. The site's replay can only guess then: the
first five players to act "start" and play all 40 minutes, everybody else 0:00, and every minute-based
number (BPM, per-40, lineups, on/off) is built on that guess. Louie: read one more game, and if it has
no minutes either, drop the league.

So a source row whose adapter_config says "rotation_gate": true is judged on its FINISHED games, read
back from their archived raw payloads (external_games.raw_ref, the FIBA data.json shape every adapter
writes): a game HAS a rotation when its play-by-play logs a substitution or any player has minutes in
its box. Once at least MIN_GAMES have finished and NONE of them has one, the league is dropped:
leagues.visibility goes to 'private' (off the public site, still there for its administrators, put back
from the console) and every source row of a dropped league is skipped by the ingest from then on. A
single game WITH a rotation settles it the other way for good - the gate never drops that league.

Stateless on purpose: it is worked out again from what is stored, so the GitHub runners and the PC's
lane agree without a ledger of their own. To keep a gated league that the gate dropped, set the row's
"rotation_gate": false as well as making the league public again, or the next pass drops it again.
"""
from __future__ import annotations

import re
from typing import Callable, Iterable, Optional

#: finished games needed before a league is judged: the one already in, and one more (Louie's words)
MIN_GAMES = 2
#: the most recent finished games read when judging (a payload is ~0.3-1 MB)
MAX_READ = 8


def gated(src: dict) -> bool:
    return bool((src.get("adapter_config") or {}).get("rotation_gate"))


def _secs(v) -> int:
    m = re.match(r"\s*(?:PT)?(\d+)[:M](\d+)", str(v or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def has_rotation(raw: dict) -> bool:
    """A substitution in the play-by-play, or minutes on any player of either club's box."""
    if any(str(e.get("actionType") or "").lower() == "substitution" for e in (raw.get("pbp") or []) if isinstance(e, dict)):
        return True
    for t in ((raw.get("tm") or {}).get(k) or {} for k in ("1", "2")):
        for p in (t.get("pl") or {}).values():
            if _secs(p.get("sMinutes")) > 0:
                return True
    return False


def verdict(raws: Iterable[Optional[dict]]) -> Optional[str]:
    """The reason to drop the league, or None to keep it. `raws` are the finished games' payloads, newest
    first; one that could not be read (None) is not evidence either way."""
    read = 0
    for raw in raws:
        if raw is None:
            continue
        if has_rotation(raw):
            return None
        read += 1
    if read < MIN_GAMES:
        return None
    return f"{read} finished games and none has minutes or a substitution"


def finished_refs(sb, src: dict) -> list:
    """raw_ref of every finished game of this source's code, newest first."""
    rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}"
                                       f"&external_status=eq.final&raw_ref=not.is.null&select=raw_ref,tipoff_at"
                                       f"&order=tipoff_at.desc&limit={MAX_READ}")
    return [r["raw_ref"] for r in rows if r.get("raw_ref")]


def league_of(sb, src: dict) -> Optional[dict]:
    if src.get("league_id"):
        rows = sb.select("leagues", f"id=eq.{src['league_id']}&select=id,slug,visibility")
    elif src.get("league_slug"):
        rows = sb.select("leagues", f"slug=eq.{src['league_slug']}&select=id,slug,visibility")
    else:
        return None
    return rows[0] if rows else None


def dropped(sb, src: dict) -> bool:
    """A gated source whose league has been dropped (is private): the ingest skips it."""
    if not gated(src) or sb is None:
        return False
    try:
        lg = league_of(sb, src)
    except Exception:
        return False
    return bool(lg) and lg.get("visibility") == "private"


def judge(sb, src: dict, get_json: Callable[[str], Optional[dict]]) -> Optional[str]:
    """Judge a gated source's league now; drop it (visibility 'private') when the verdict says so.
    Returns what was done, for the log, or None when nothing was."""
    if not gated(src) or sb is None:
        return None
    lg = league_of(sb, src)
    if not lg or lg.get("visibility") != "public":
        return None
    why = verdict(get_json(ref) for ref in finished_refs(sb, src))
    if not why:
        return None
    sb.patch("leagues", f"id=eq.{lg['id']}", {"visibility": "private"})
    return f"DROPPED {lg['slug']}: {why} (the league is now private; its sources are skipped)"
