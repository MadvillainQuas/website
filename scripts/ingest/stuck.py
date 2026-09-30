"""Games still 'live' (or 'finalising') long after they could have been played: find them, and close what
the feed cannot finish. Used by run_ingest.py --repair-stalled; mirrored in SQL by
supabase/migrations/0203_close_stuck_games.sql (close_stuck_games), which pg_cron runs hourly with a 24 h
cap as the backstop when no runner does.

WHY THIS EXISTS. Four games sat LIVE on the front page for days (26-30 Sep 2026) because every fix so far
covered the game that caused it and only games from then on: the catch-up looked at games whose tip-off was
under a week old and whose FEED row was not final (Oaklands Wolves v Cardiff Met tipped off in Oct 2025 and
the feed said final, so it was outside both), and nothing ever ended a game whose feed stopped. The rule here
does not care why: a game live more than REPAIR_MIN_AGE after tip-off is read again and finalised through
the normal path (write_event_log -> finalise-game); one still open REPAIR_HARD_CAP after tip-off is closed on
what it last showed - FINAL when the fourth period or later was over or decided, or the feed had called it
final; VOID otherwise, because a result nobody can vouch for is worse than none.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

REPAIR_MIN_AGE = 4 * 3600      # a live game this long after tip-off is read again and finalised
REPAIR_HARD_CAP = 6 * 3600     # ...and closed on its last state if it is still open this long after tip-off
SWING_MS = 12_000              # one 3-point swing per 12 s of clock left: the most a game could still turn


def _zulu(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _tip(v):
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00")) if v else None
    except ValueError:
        return None
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def verdict(period: int, clock_ms: int, home: int, away: int, feed_status: str | None) -> tuple[str, str]:
    """('final' | 'void', reason) for a game that is over as far as anybody can tell. Same rule as
    close_stuck_games in 0203 - change one, change both (stuck_test.py and close-stuck-games.test.mjs)."""
    period, clock_ms, home, away = int(period or 0), int(clock_ms or 0), int(home or 0), int(away or 0)
    lead = abs(home - away)
    left = f"{clock_ms // 60000:02d}:{clock_ms // 1000 % 60:02d}"
    if home != away and period >= 4 and (clock_ms == 0 or lead > 3 * math.ceil(clock_ms / SWING_MS)):
        return "final", f"period {period}, {left} left, {home}-{away}: over or decided when the feed stopped"
    if home != away and feed_status == "final":
        return "final", f"the feed called it final ({home}-{away}); finalise-game never accepted it"
    return "void", f"the feed stopped in period {period} with {left} left at {home}-{away}: no result to stand on"


def stuck_games(sb, now: datetime, ids=None, min_age: int = REPAIR_MIN_AGE) -> list[dict]:
    """Every game live or finalising more than min_age after tip-off, with what the platform and the feed
    say about it: [{id, status, tipoff_at, age_s, home, away, period, clock_ms, comp, ext: [external_games rows]}].
    `ids` narrows to game ids or external ids (a workflow input). Oldest first; ANY age - the catch-up's week
    is exactly what let a game from October sit here."""
    rows = sb.select_all("games", f"status=in.(live,finalising)&tipoff_at=lt.{_zulu(now - timedelta(seconds=min_age))}"
                                  "&select=id,status,tipoff_at,home_score,away_score,period,competition_id,stalled_since&order=tipoff_at,id")
    want = {str(x).strip() for x in (ids or []) if str(x).strip()}     # "".split(",") is [""]: no ids asked for is not one empty id
    if want:
        keep_ext: set = set()
        if rows:
            for i in range(0, len(rows), 60):
                chunk = ",".join(r["id"] for r in rows[i:i + 60])
                for e in sb.select("external_games", f"game_id=in.({chunk})&select=game_id,external_id"):
                    if str(e["external_id"]) in want:
                        keep_ext.add(e["game_id"])
        rows = [r for r in rows if r["id"] in want or r["id"] in keep_ext]
    out = []
    for i in range(0, len(rows), 60):
        chunk = rows[i:i + 60]
        gid = ",".join(r["id"] for r in chunk)
        ext: dict = {}
        for e in sb.select("external_games", f"game_id=in.({gid})&select=game_id,adapter,external_id,competition_code,external_status,home_name,away_name,tipoff_at,error"):
            ext.setdefault(e["game_id"], []).append(e)
        state = {s["game_id"]: s for s in sb.select("game_state", f"game_id=in.({gid})&select=game_id,period,clock_ms,score_home,score_away")}
        for r in chunk:
            s = state.get(r["id"]) or {}
            tip = _tip(r.get("tipoff_at"))
            out.append({"id": r["id"], "status": r["status"], "tipoff_at": r.get("tipoff_at"), "comp": r.get("competition_id"),
                        "age_s": (now - tip).total_seconds() if tip else None,
                        "home": s.get("score_home") if s.get("score_home") is not None else r.get("home_score"),
                        "away": s.get("score_away") if s.get("score_away") is not None else r.get("away_score"),
                        "period": s.get("period") if s.get("period") is not None else r.get("period"),
                        "clock_ms": s.get("clock_ms"), "ext": ext.get(r["id"], []), "stalled": bool(r.get("stalled_since"))})
    return out


def by_source(games: list[dict]) -> dict:
    """{(adapter, competition_code): [external_games rows]} - what the catch-up's loop takes."""
    out: dict = {}
    for g in games:
        for e in g["ext"]:
            out.setdefault((e["adapter"], e.get("competition_code")), []).append(
                {**e, "tipoff_at": e.get("tipoff_at") or g["tipoff_at"]})
    return out


def close_stuck(sb, games: list[dict], now: datetime, hard_cap: int = REPAIR_HARD_CAP, dry: bool = False) -> list[dict]:
    """Close, on its last state, every game of `games` that is still live or finalising past the hard cap.
    The database function (0203) when it is there, the same rule from here when it is not (a migration that
    has not been applied yet must not stop the repair). Returns [{id, was, verdict, reason, home, away}]."""
    ids = [g["id"] for g in games if g.get("age_s") is not None and g["age_s"] >= hard_cap]
    if not ids:
        return []
    still = {r["id"]: r for i in range(0, len(ids), 60)
             for r in sb.select("games", f"id=in.({','.join(ids[i:i + 60])})&status=in.(live,finalising)&select=id,status")}
    todo = [g for g in games if g["id"] in still]
    if not todo:
        return []
    if not dry:
        try:
            got = sb.rpc("close_stuck_games", {"p_hard_hours": hard_cap / 3600.0, "p_ids": [g["id"] for g in todo]})
            if isinstance(got, list):
                return [{"id": r["game_id"], "was": r["was"], "verdict": r["verdict"], "reason": r["reason"],
                         "home": r["home_score"], "away": r["away_score"]} for r in got]
        except Exception as exc:                                     # 0203 not applied yet, or the call failed
            print(f"   (close_stuck_games unavailable - {str(exc)[:160]} - closing from here)")
    out, comps = [], set()
    for g in todo:
        feed = next((e.get("external_status") for e in g["ext"]), None)
        v, why = verdict(g.get("period"), g.get("clock_ms"), g.get("home"), g.get("away"), feed)
        row = {"id": g["id"], "was": g["status"], "verdict": v, "reason": why, "home": int(g.get("home") or 0), "away": int(g.get("away") or 0)}
        out.append(row)
        if dry:
            continue
        if v == "final":
            sb.patch("games", f"id=eq.{g['id']}", {"status": "final", "home_score": row["home"], "away_score": row["away"],
                                                   "period": max(int(g.get("period") or 1), 1), "finalised_at": now.isoformat(), "stalled_since": None})
        else:
            sb.patch("games", f"id=eq.{g['id']}", {"status": "void", "stalled_since": None})
        for e in g["ext"]:
            sb.patch("external_games", f"adapter=eq.{e['adapter']}&external_id=eq.{e['external_id']}",
                     {"external_status": "final", "error": f"reconciled ({v}): {why}"[:500]})
        try:
            sb.insert("audit_log", {"action": "close_stuck_game", "subject": "game", "subject_id": g["id"],
                                    "detail": {"was": g["status"], "verdict": v, "reason": why, "by": "run_ingest --repair-stalled"}})
        except Exception:
            pass
        if g.get("comp"):
            comps.add(g["comp"])
    for c in sorted(comps):
        try:
            sb.rpc("recompute_standings", {"p_competition": c})
        except Exception as exc:
            print(f"   (standings of {c} not rebuilt: {str(exc)[:120]})")
    return out


def table(rows: list[dict]) -> str:
    """The per-game log the workflow prints: one line each, what it was and what became of it."""
    if not rows:
        return "   (none)"
    w = max(len(r["game"]) for r in rows)
    return "\n".join(f"   {r['game']:<{w}}  {r['was']:<10} -> {r['now']:<10} {r['how']}" for r in rows)
