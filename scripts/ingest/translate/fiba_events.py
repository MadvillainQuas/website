"""
fiba_events.py — roadmap Phase B: translate a FIBA LiveStats data.json into the
Epinoia scorer's event grammar, so a fed game IS an Epinoia game.

Target (from epinoia/engine.js deriveGame, inventoried 2026-09-06):
  game_events(seq, t, team, pid, period, clock, payload)
    seq     1-based, replay order == play order (FIBA actionNumber ascending)
    team    0 = home (tm.1), 1 = away (tm.2)
    pid     roster_snapshot.teams[team].players[].id
    period  1-4, OT = 5+
    clock   ms REMAINING in the period (integer)
    t       period_start | game_end | jump | timeout | sub{in,out} |
            p2_made p2_miss p3_made p3_miss ft_made ft_miss |
            reb{off} | ast | stl | blk | to | foul{kind,drawn} |
            loc{ref,x,y} stype{ref,v} tag{ref,tag}      (satellites, no pbp line)

Known defects of the older JS importer (epinoia/livestats.js) that this one
avoids: 'disq' (not 'disqualifying'); half-court portrait shot frame (not
x/100); engine shot-type vocabulary (not raw FIBA subTypes); `drawn` folded
from `foulon`; no offensive-foul double count; finalise body key `gameId`;
`games.period` set; a fouled-out player is never left on court.

Pure function: translate(raw, pid_for) -> dict. No I/O.
"""
from __future__ import annotations

import math
from typing import Callable, Optional

PLEN = lambda p: 600000 if p <= 4 else 300000  # noqa: E731

# FIBA subType -> the engine's shot-type vocabulary (RIM_TYPE / FAR_TYPE in engine.js)
STYPE = {
    "layup": "layup", "drivinglayup": "layup", "reverselayup": "layup", "eurostep": "layup",
    "dunk": "dunk", "alleyoopdunk": "dunk", "alleyoop": "alley-oop",
    "tipin": "tip-in", "tipinlayup": "tip-in", "tipindunk": "tip-in", "putback": "putback",
    "jumpshot": "jump shot", "pullupjumpshot": "pull-up", "stepbackjumpshot": "step-back",
    "turnaroundjumpshot": "fadeaway", "fadeawayjumpshot": "fadeaway", "fallawayjumpshot": "fadeaway",
    "floatingjumpshot": "floater", "hookshot": "hook",
}
TO_STYPE = {
    "badpass": "bad pass", "travel": "travel", "24sec": "24s", "outofbounds": "out of bounds",
    "doubledribble": "double dribble", "ballhandling": "other", "offensive": "other", "3sec": "other",
    "backcourt": "other", "5sec": "other", "8sec": "other", "shotclock": "24s", "lostball": "other",
}
FOUL_KIND = {
    "personal": "personal", "offensive": "offensive", "technical": "tech", "unsportsmanlike": "unsport",
    "disqualifying": "disq", "benchtechnical": "tech", "coachtechnical": "tech", "coachdisqualifying": "disq",
}
FOUL_BENCH = {"benchtechnical", "coachtechnical", "coachdisqualifying"}

# FIBA shot frame: full court 0-100 along x (rims at ~5.6 and ~94.4), 0-100 across y.
# Epinoia frame: one half court, portrait, x across the width 0-1, y from the attacking baseline 0-1.
def shot_xy(fx, fy) -> Optional[tuple[float, float]]:
    try:
        fx = float(fx); fy = float(fy)
    except (TypeError, ValueError):
        return None
    if fx < 50:                       # attacking the left basket
        y = (fx * 0.28) / 14.0
        x = fy / 100.0
    else:                             # attacking the right basket — rotate 180°
        y = ((100.0 - fx) * 0.28) / 14.0
        x = 1.0 - fy / 100.0
    return (round(max(0.0, min(1.0, x)), 3), round(max(0.0, min(1.0, y)), 3))


def clock_ms(gt: str) -> int:
    s = str(gt or "").strip()
    try:
        if ":" in s:
            m, rest = s.split(":", 1)
            return int(round((int(m) * 60 + float(rest)) * 1000))
        return int(round(float(s) * 1000))
    except ValueError:
        return 0


def period_of(ev: dict) -> int:
    p = int(ev.get("period") or 1)
    if str(ev.get("periodType", "")).upper() == "OVERTIME" and p <= 4:
        p = 4 + p
    return p


def team_idx(ev: dict) -> Optional[int]:
    t = ev.get("tno")
    return None if t in (None, 0, "0", "") else int(t) - 1


def default_pid(team: int, pno) -> str:
    return f"{team}:{pno}"


def roster_snapshot(raw: dict, pid_for: Callable[[int, str], str]) -> tuple[dict, list]:
    teams, starters = [], [[], []]
    for i, k in enumerate(("1", "2")):
        t = (raw.get("tm") or {}).get(k) or {}
        players = []
        for pno, p in (t.get("pl") or {}).items():
            first = (p.get("firstName") or "").strip(); last = (p.get("familyName") or "").strip()
            name = (first + " " + last).strip() or (p.get("name") or "").strip()
            pid = pid_for(i, str(pno))
            players.append({"id": pid, "name": name.strip(), "num": str(p.get("shirtNumber") or "")})
            if str(p.get("starter", "0")) == "1":
                starters[i].append(pid)
        teams.append({"name": (t.get("name") or f"team {k}").strip(), "color": "#93f2bf" if i == 0 else "#8ff5ff", "players": players})
    return {"teams": teams}, starters


def translate(raw: dict, pid_for: Callable[[int, str], str] = default_pid) -> dict:
    tm = raw.get("tm") or {}
    snap, starters = roster_snapshot(raw, pid_for)
    known = {p["id"] for t in snap["teams"] for p in t["players"]}
    shots_by_action = {}
    for k in ("1", "2"):
        for s in (tm.get(k) or {}).get("shot", []) or []:
            if s.get("actionNumber") is not None:
                shots_by_action[int(s["actionNumber"])] = s
    # A COORDINATE THAT REPEATS IS NOT AN OBSERVATION. A feed that hand-marks every shot chart
    # dot puts real variety even on shots from roughly the same spot -- a defender, a step, a
    # slightly different angle. Several UNRELATED shots landing on the EXACT same (x, y), to the
    # feed's own unit, is what a quick-tap default looks like instead: LNB's under-21 feed
    # names 92% of its shots the generic "jumpshot" and places dozens of them at a handful of
    # points sitting almost on top of the rim -- (5, 44), (8, 44), (7, 45) reused three, three
    # and two times across two games -- which is how a whole league's shooting from the restricted
    # area came out at 75-95% for BOTH sides of the same match (reported 2026-09-18). A genuine
    # dunk or lay-up is trusted at any repeated spot, because its type already says where it was;
    # a shot with no such label is not, and falls back to that label instead of a coordinate that
    # was never really taken there.
    RIM_LABELLED = {"layup", "drivinglayup", "reverselayup", "eurostep", "dunk", "alleyoopdunk",
                    "alleyoop", "tipin", "tipinlayup", "tipindunk", "putback"}
    xy_seen: dict[tuple, int] = {}
    for s in shots_by_action.values():
        if s.get("x") is None or s.get("y") is None:
            continue
        k = (s.get("x"), s.get("y"))
        xy_seen[k] = xy_seen.get(k, 0) + 1

    pbp = sorted((e for e in (raw.get("pbp") or []) if e.get("actionNumber") is not None), key=lambda e: int(e["actionNumber"]))
    events: list[dict] = []
    report = {"unmatched": 0, "warnings": [], "dropped": {}}
    seq_of_action: dict[int, int] = {}
    on_court = [set(starters[0]), set(starters[1])]
    pf = {}
    last_period = 1
    tip_winner = arrow_init = None
    pending_subs: dict[tuple, dict] = {}   # (team, period, clock) -> {"in": [], "out": [], "in_an": [], "out_an": []}
    # WHICH FEED ACTIONS AN EVENT CAME FROM (docs/feed-timing.md, step 3). The ingest stamps a
    # play with the moment the feed first showed it, and it learns that per LiveStats
    # actionNumber, so every event carries the numbers it was built from as `_ans`. In memory
    # only: game_rows copies named keys, so it never reaches the database, and nothing else in
    # an event changes (tools/feedtiming/golden.py froze the rows before this was added).
    #   - an event emitted while reading an action carries that action (satellites - loc, stype,
    #     tag - are emitted in their shot's iteration, so they inherit it for free);
    #   - a paired substitution carries BOTH halves, [out, in], passed explicitly, because the
    #     pair is flushed while the NEXT action is being read and the default would name that;
    #   - the fouled-out sub the translator invents carries [] - no action of the feed's.
    cur_an = None

    def emit(t, team=None, pid=None, period=None, clock=None, _ans=None, **payload):
        ev = {"seq": len(events) + 1, "t": t, "team": team, "pid": pid, "period": period, "clock": clock, "payload": payload}
        # `is None`, never `or`: the fabricated sub passes [] and must keep it
        ev["_ans"] = [cur_an] if _ans is None else list(_ans)
        events.append(ev)
        return ev["seq"]

    def pid_of(ev, team):
        pno = ev.get("pno")
        if team is None or pno in (None, 0, "0", ""):
            return None
        pid = pid_for(team, str(pno))
        if pid not in known:
            report["unmatched"] += 1
            return None
        return pid

    def flush_subs(final=False):
        """Emit every substitution whose two halves have both arrived.

        A HALF STILL MISSING WAITS FOR ITS PARTNER at the same side, period and clock, however
        far down the log it is. Operators split one substitution with other actions at its clock
        (an OUT, the free throws, then the IN), and enter a forgotten half minutes later as a
        correction stamped with the original clock. Flushing at every non-substitution action
        paired neither: both halves were dropped as "unpaired", the player who should have gone
        off stayed on, the one who should have come on never did, and the next ordinary change
        left a side with four or six on the floor. In 22 of 160 SLB games that ran from 19
        seconds to 23 minutes, and every minute, plus/minus and on-court figure of those players
        with it. Only at the end of the log is an unpaired half given up on."""
        for key in list(pending_subs):
            team, period, clock = key
            g = pending_subs[key]
            outs, ins = g["out"], g["in"]
            if len(outs) != len(ins) and not final:
                continue
            for o, i, ao, ai in zip(outs, ins, g["out_an"], g["in_an"]):
                on_court[team].discard(o); on_court[team].add(i)
                # EVERY CHANGE AT ONE INSTANT IS ONE CHANGE. A pair that continues an earlier one
                # at the same side, period and clock (A off for B, then B off for C; or B off for
                # C, then A off for B) is that one change: A off, C on. Applied one after the
                # other, the engine takes B off twice or puts him on twice -- a side of four, and
                # B's minutes restarted at the second. Seen when a late correction at an old clock
                # met the live change it amended (2778590: four on the floor for 409 s).
                prior = next((e for e in reversed(events) if e["t"] == "sub" and e["team"] == team
                              and e["period"] == period and e["clock"] == clock
                              and (e["payload"]["in"] == o) != (e["payload"]["out"] == i)), None)
                if prior is not None:
                    if prior["payload"]["in"] == o:
                        prior["payload"]["in"] = i
                    else:
                        prior["payload"]["out"] = o
                    prior["_ans"] = prior["_ans"] + [ao, ai]
                    continue
                emit("sub", team, None, period, clock, _ans=[ao, ai], **{"in": i, "out": o})
            if len(outs) != len(ins):
                report["warnings"].append(f"unpaired substitution at P{period} {clock}ms team {team}: {len(outs)} out / {len(ins)} in")
            del pending_subs[key]

    for ev in pbp:
        at = str(ev.get("actionType") or "").lower()
        sub = str(ev.get("subType") or "").lower()
        quals = {str(q).lower() for q in (ev.get("qualifier") or [])}
        team = team_idx(ev)
        period = period_of(ev)
        clock = clock_ms(ev.get("gt"))
        an = int(ev["actionNumber"])
        cur_an = an
        last_period = max(last_period, period)

        if at != "substitution":
            flush_subs()

        if at == "period" and sub == "start":
            emit("period_start", None, None, period, PLEN(period))
        elif at == "game" and sub == "end":
            emit("game_end", None, None, period, clock)
        elif at == "jumpball":
            if sub == "won" and team is not None and tip_winner is None:
                tip_winner = team
            elif sub == "lost" and team is not None and arrow_init is None:
                arrow_init = team
            elif sub not in ("startperiod", "won", "lost"):
                emit("jump", None, None, period, clock)
        elif at in ("2pt", "3pt"):
            pid = pid_of(ev, team)
            made = str(ev.get("success", "0")) == "1"
            t = f"p{2 if at == '2pt' else 3}_{'made' if made else 'miss'}"
            s = emit(t, team, pid, period, clock)
            seq_of_action[an] = s
            shot = shots_by_action.get(an)
            untrusted = (shot and sub not in RIM_LABELLED
                        and xy_seen.get((shot.get("x"), shot.get("y")), 0) >= 3)
            xy = shot_xy(shot.get("x"), shot.get("y")) if shot and not untrusted else None
            if xy:
                emit("loc", None, None, period, clock, ref=s, x=xy[0], y=xy[1])
            v = STYPE.get(sub)
            if v:
                emit("stype", None, None, period, clock, ref=s, v=v)
            if "pointsinthepaint" in quals and at == "2pt":
                emit("tag", None, None, period, clock, ref=s, tag="paint")
            if "fastbreak" in quals:
                emit("tag", None, None, period, clock, ref=s, tag="transition")
        elif at == "freethrow":
            pid = pid_of(ev, team)
            made = str(ev.get("success", "0")) == "1"
            s = emit("ft_made" if made else "ft_miss", team, pid, period, clock)
            seq_of_action[an] = s
            if "fastbreak" in quals:
                emit("tag", None, None, period, clock, ref=s, tag="transition")
        elif at == "rebound":
            if sub not in ("offensive", "defensive"):
                report["dropped"][f"rebound/{sub}"] = report["dropped"].get(f"rebound/{sub}", 0) + 1
                continue
            pid = None if "team" in quals else pid_of(ev, team)
            emit("reb", team, pid, period, clock, off=(sub == "offensive"))
        elif at == "assist":
            pid = pid_of(ev, team)
            if pid:
                emit("ast", team, pid, period, clock)
        elif at == "steal":
            pid = pid_of(ev, team)
            if pid:
                emit("stl", team, pid, period, clock)
        elif at == "block":
            pid = pid_of(ev, team)
            if pid:
                emit("blk", team, pid, period, clock)
        elif at == "turnover":
            pid = None if "team" in quals else pid_of(ev, team)
            s = emit("to", team, pid, period, clock)
            seq_of_action[an] = s
            v = TO_STYPE.get(sub)
            if v:
                emit("stype", None, None, period, clock, ref=s, v=v)
        elif at == "foul":
            kind = FOUL_KIND.get(sub, "personal")
            if kind == "personal" and "shooting" in quals:
                kind = "shooting"
            pid = None if sub in FOUL_BENCH else pid_of(ev, team)
            s = emit("foul", team, pid, period, clock, kind=kind, drawn=None)
            seq_of_action[an] = s
            if pid:
                pf[pid] = pf.get(pid, 0) + 1
                if pf[pid] >= 5 and pid in on_court[team]:
                    # FIBA subs the fouled-out player at the next dead ball; note it so the
                    # end-of-log check can fabricate a sub if the feed never did.
                    report.setdefault("fouled_out", []).append((pid, team, period, clock))
        elif at == "foulon":
            # the mirror of a foul: becomes `drawn` on the foul it references
            prev = ev.get("previousAction")
            try:
                s = seq_of_action.get(int(prev))
            except (TypeError, ValueError):
                s = None
            pid = pid_of(ev, team)
            if s and pid and events[s - 1]["t"] == "foul":
                events[s - 1]["payload"]["drawn"] = pid
        elif at == "substitution":
            pid = pid_of(ev, team)
            if pid and team is not None:
                g = pending_subs.setdefault((team, period, clock), {"in": [], "out": [], "in_an": [], "out_an": []})
                if sub in ("in", "out"):
                    g[sub].append(pid)
                    g[sub + "_an"].append(an)
        elif at == "timeout":
            if team is not None:
                emit("timeout", team, None, period, clock)
        elif at in ("game", "period", "clock"):
            pass
        else:
            report["dropped"][f"{at}/{sub}"] = report["dropped"].get(f"{at}/{sub}", 0) + 1
    flush_subs(final=True)

    # finalise gate: a player with 5 fouls may not be on court at the end
    for pid, team, period, clock in report.get("fouled_out", []):
        if pid in on_court[team]:
            bench = [p["id"] for p in snap["teams"][team]["players"] if p["id"] not in on_court[team]]
            if bench:
                emit("sub", team, None, last_period, 0, _ans=[], **{"in": bench[0], "out": pid})
                on_court[team].discard(pid); on_court[team].add(bench[0])
                report["warnings"].append(f"fabricated sub for fouled-out {pid}")
    if len(starters[0]) != 5 or len(starters[1]) != 5:
        report["warnings"].append(f"starters not 5/5: {len(starters[0])}/{len(starters[1])}")

    home_pts = int(float(((tm.get("1") or {}).get("tot_sPoints")) or (tm.get("1") or {}).get("score") or 0))
    away_pts = int(float(((tm.get("2") or {}).get("tot_sPoints")) or (tm.get("2") or {}).get("score") or 0))
    return {
        "roster_snapshot": snap, "starters": starters,
        "tip_winner": tip_winner, "arrow_init": arrow_init, "period": last_period,
        "home_score": home_pts, "away_score": away_pts,
        "events": events, "report": report,
    }


def game_rows(game_id: str, events: list[dict]) -> list[dict]:
    """Rows for public.game_events (the column split live.js / import-ui use)."""
    return [{"game_id": game_id, "seq": e["seq"], "t": e["t"], "team": e["team"], "pid": e["pid"],
             "period": e["period"], "clock": e["clock"], "payload": e["payload"]} for e in events]
