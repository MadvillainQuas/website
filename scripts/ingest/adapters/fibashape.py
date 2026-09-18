"""Put a league's own payload into the shape the platform already knows how to read.

WHY THIS EXISTS. Everything downstream of an adapter — the box score, the team totals, the four
factors, the shot zones, the clubs, the players, the rosters — is written against ONE shape: the
FIBA LiveStats data.json, with `tm.{"1","2"}` holding a club and `pl.{pno}` holding a player.
feedplatform.ensure_game_people reads bundle.raw as exactly that, and
FibaLiveStatsAdapter.bundle_from_raw builds every table from it.

So the cheapest correct way to add a league that is NOT on FIBA LiveStats is not to write a second
pipeline. It is to translate that league's payload into this shape and hand it to the pipeline that
exists. An adapter then consists of two small things: fetch the league's own JSON, and map its
field names onto these. Nothing below the adapter has to learn a new league.

WHAT bundle_from_raw ACTUALLY READS, which is all any translation has to fill:
    tm[side]        name, code, score, p1_score..p4_score, tot_<stat>, pl, shot, logoT/logoS
    tm[side].pl[n]  firstName/familyName (or name), shirtNumber, starter, active, sMinutes, <stat>
    pbp             only to tell live from final; the sentinel end action is enough
The stat names are FIBA's own (sPoints, sAssists, sReboundsOffensive …) and are listed in STATS.

SHOT COORDINATES ARE A PERCENTAGE OF THE CHART, not metres and not centimetres — that is what
shot_dist_to_nearest_rim expects, and getting it wrong silently files every lay-up as a jump shot.
at_rim_offset() converts a "centimetres from the basket" feed (the EuroLeague's Points rows, the
ACB's shot chart) into it.
"""
from __future__ import annotations

from .fiba_livestats import CHART_H_M, CHART_W_M, RIM_X_LEFT, RIM_Y

#: every per-player and per-team stat the pipeline reads, in FIBA's own spelling
STATS = (
    "sPoints", "sFieldGoalsMade", "sFieldGoalsAttempted",
    "sTwoPointersMade", "sTwoPointersAttempted", "sThreePointersMade", "sThreePointersAttempted",
    "sFreeThrowsMade", "sFreeThrowsAttempted",
    "sReboundsOffensive", "sReboundsDefensive", "sReboundsTotal",
    "sAssists", "sTurnovers", "sSteals", "sBlocks", "sBlocksReceived",
    "sFoulsPersonal", "sFoulsOn",
    "sPointsSecondChance", "sPointsFastBreak", "sPointsFromTurnovers", "sPointsInThePaint",
    "sPlusMinusPoints",
)

#: totals the pipeline reads off the team but that no player has
TEAM_ONLY = ("sBenchPoints", "sBiggestLead", "sLeadChanges")


def num(v, default=0):
    """A feed's idea of a number — '12', 12.0, '', None, '-' — as a number."""
    if v is None or v == "" or v == "-":
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default


def player(first="", last="", *, shirt="", starter=0, active=1, minutes="0:00",
           position="", stats=None, name="") -> dict:
    """One player, in the shape pl[pno] has.

    Names are passed through as the feed wrote them: scripts/ingest/names.py is the only thing that
    decides what a player is CALLED, and it wants the raw fields to work from."""
    p = {"firstName": first, "familyName": last, "name": name or f"{first} {last}".strip(),
         "shirtNumber": str(shirt or ""), "playingPosition": position,
         "starter": int(starter or 0), "active": int(active or 0), "sMinutes": minutes or "0:00"}
    for k in STATS:
        p[k] = num((stats or {}).get(k))
    return p


def totals_of(players: dict) -> dict:
    """Team totals summed from its players — for a feed that publishes no team row of its own.

    Summing is not always identical to the club's official total (a team rebound belongs to nobody),
    so a feed that DOES publish team totals should pass them instead; this is the fallback."""
    out = {k: 0 for k in STATS}
    for p in players.values():
        for k in STATS:
            out[k] += num(p.get(k))
    return out


def team(name, code, *, score=None, quarters=(), players=None, shots=None, logo=None,
         totals=None, short_name="") -> dict:
    """One club, in the shape tm["1"|"2"] has."""
    players = players or {}
    tot = dict(totals or totals_of(players))
    t = {"name": name or "", "code": (code or "").strip(), "shortName": short_name or (code or ""),
         "score": num(score if score is not None else tot.get("sPoints")),
         "pl": players, "shot": list(shots or [])}
    for i, q in enumerate(list(quarters)[:4], start=1):
        t[f"p{i}_score"] = num(q)
    for k in STATS:
        t["tot_" + k] = num(tot.get(k))
    for k in TEAM_ONLY:
        if k in tot:
            t["tot_" + k] = num(tot[k])
    if logo:
        t["logoT"] = {"url": logo}
        t["logoS"] = {"url": logo}
    return t


def shot(x_pct, y_pct, made, three=False, *, pno=None, period=None) -> dict:
    """One shot, in the shape tm[].shot[] has. x/y are PERCENTAGES of the chart."""
    s = {"x": x_pct, "y": y_pct, "r": 1 if made else 0,
         "actionType": "3pt" if three else "2pt"}
    if pno is not None:
        s["pno"] = pno
    if period is not None:
        s["per"] = period
    return s


def at_rim_offset(across_cm, toward_cm) -> tuple:
    """Centimetres from the basket -> the chart percentages the pipeline measures in.

    A feed that gives a shot as an offset from the basket it was taken at (the EuroLeague's
    COORD_X/COORD_Y, and the ACB's the same way) is placed against the LEFT rim, which is where
    shot_dist_to_nearest_rim measures from; the right rim is the same distance by symmetry, so
    which end a shot was taken at does not change its zone."""
    x = RIM_X_LEFT + (num(toward_cm, 0) / 100.0) / CHART_W_M * 100.0
    y = RIM_Y + (num(across_cm, 0) / 100.0) / CHART_H_M * 100.0
    return x, y


def game(home: dict, away: dict, *, played=True, pbp=None) -> dict:
    """The whole payload. `played` writes the sentinel the pipeline reads as 'this game is over'."""
    events = list(pbp or [])
    if played and not any(e.get("actionType") == "game" and e.get("subType") == "end" for e in events):
        events.append({"actionType": "game", "subType": "end", "period": 4})
    return {"tm": {"1": home, "2": away}, "pbp": events}
