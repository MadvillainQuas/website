"""NCAA play-by-play against the OFFICIAL box score, game by game, through the website's own path.

    python scripts/ingest/ncaa_accuracy.py                      # every game in the sample (fetches what is not cached)
    python scripts/ingest/ncaa_accuracy.py --cached             # only games already on disk, never a request
    python scripts/ingest/ncaa_accuracy.py --sport WBB          # one sport
    python scripts/ingest/ncaa_accuracy.py 6538157 6512522      # these games (sport read from the box)
    python scripts/ingest/ncaa_accuracy.py --discover           # (re)build the sample from the scoreboards
    python scripts/ingest/ncaa_accuracy.py --json out.json      # the full comparison, for digging
    python scripts/ingest/ncaa_accuracy.py --captures "<scraper>/validation/ncaa/captures"   # another set, offline

WHAT IS COMPARED, AND WHY THIS WAY. A published NCAA game's numbers are not the box ncaa.com prints: they are
what epinoia/engine.js deriveGame replays out of the event log, because finalise-game builds every player's and
club's line from that replay. So the only honest check is to run the same chain the live lane runs -
adapters/ncaa.py (the scraper's parse, to_fiba, bundle_from_raw and its result-only gate) -> translate/fiba_events
.translate -> deriveGame in node - and hold what comes out against the official box, stat by stat:

  per player  PTS, FGM/FGA, 2PM/2PA, 3PM/3PA, FTM/FTA, OREB, DREB, REB, AST, STL, BLK, TOV, PF (exact),
              minutes (within --min-tol minutes: the box prints whole minutes and the log's changes are
              entered by hand, so a minute's drift is the feed's, not ours);
  per team    the same counts against teamStats (which carry the team rebounds and team turnovers no
              player is charged with), and the final score;
  per period  the replay's points against the feed's own running score at each period's end (the box has no
              line score; this is the witness to WHEN the points went in).

The official side is read straight off the GraphQL box, never off the scraper's site_box, so a parse that
mangles the box cannot also mark its own homework. Where the box contradicts ITSELF (a team line below the sum of
its own players) the game says so: then players and team cannot both be matched.

A game is EXACT when every count and the score match; DIFF when the replay is published but some count is off
(each one is listed, replay/official); RESULT-ONLY when bundle_from_raw refuses to replay it (the reason is the
adapter's own); NO-PBP when ncaa.com has no play-by-play for it at all. Minutes and the line score are reported
beside, not folded into, the verdict; so is what the parse's box reconciliation did (voided, surplus_dropped,
injected, team_added, team_dropped - see validation/ncaa/ncaa_adapter.py in the scraper checkout).

EVERY DOCUMENT FETCHED IS KEPT (data/ncaa/captures/<contestId>.json.gz, `__typename` stripped; git ignores it - the
sample's own documents are in the scraper's private checkout, validation/ncaa/captures_d2), and the sample the
scoreboards gave (data/ncaa/sample.json), so a re-run never asks ncaa.com again. Requests go one at a time,
at least REQUEST_GAP_S apart (under two a second), through the adapter's own _gql.
"""
from __future__ import annotations

import argparse
import contextlib
import gzip
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
from adapters import ncaa as N  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = HERE / "data" / "ncaa"
CAP = DATA / "captures"
SAMPLE = DATA / "sample.json"
REQUEST_GAP_S = 0.6

#: the 2025-26 sample: early season, conference play, conference tournaments, the national championship (the
#: games picked are kept in data/ncaa/sample.json; the men's Elite Eight dates were added to it afterwards)
DATES = ["2025-11-15", "2025-12-06", "2026-01-03", "2026-01-17", "2026-01-31", "2026-02-14",
         "2026-03-07", "2026-03-14", "2026-03-16", "2026-03-24", "2026-03-25", "2026-03-28"]
PER_DATE = 5

#: every count compared; 2P and REB are derived on both sides
COUNTS =["PTS", "FGM", "FGA", "2PM", "2PA", "3PM", "3PA", "FTM", "FTA", "OREB", "DREB", "REB",
          "AST", "STL", "BLK", "TOV", "PF"]


# ------------------------------------------------------------------ captures
def _strip(o):
    """The GraphQL documents without `__typename` (a third of their bytes, read by nothing)."""
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k != "__typename"}
    if isinstance(o, list):
        return [_strip(v) for v in o]
    return o


def cap_path(cid: str) -> Path:
    return CAP / f"{cid}.json.gz"


def scraper_captures() -> Path:
    """THE SAMPLE'S DOCUMENTS LIVE IN THE SCRAPER'S PRIVATE CHECKOUT (validation/ncaa/captures_d2), not in this
    repository: it is public, and ncaa.com's documents are not ours to publish. A game fetched afresh is cached in
    data/ncaa/captures, which git ignores."""
    return Path(os.environ.get("SCRAPER_DIR") or N.DEFAULT_SCRAPER_DIR) / "validation" / "ncaa" / "captures_d2"


EXTRA_DIRS: list = []           # --captures: more directories of <contestId>.json[.gz] to read from


def load_capture(cid: str):
    dirs = [scraper_captures()] + [Path(d) for d in EXTRA_DIRS]
    for p in [cap_path(cid)] + [d / f"{cid}.json.gz" for d in dirs] + [d / f"{cid}.json" for d in dirs]:
        if p.exists():
            opener = gzip.open if p.suffix == ".gz" else open
            with opener(p, "rt", encoding="utf-8") as f:
                return _strip(json.load(f))
    return None


def save_capture(cid: str, data: dict) -> None:
    CAP.mkdir(parents=True, exist_ok=True)
    with gzip.open(cap_path(cid), "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(_strip(data), f, ensure_ascii=False, separators=(",", ":"))


_ADAPTER = None


def adapter():
    global _ADAPTER
    if _ADAPTER is None:
        _ADAPTER = N.NcaaAdapter()
        _ADAPTER.min_request_gap_s = REQUEST_GAP_S
    return _ADAPTER


def fetch(cid: str, cached_only: bool):
    d = load_capture(cid)
    if d is not None or cached_only:
        return d
    A = adapter()
    d = {"pbp": A._gql("NCAA_GetGamecenterPbpBasketballById_web", {"contestId": str(cid)}),
         "box": A._gql("NCAA_GetGamecenterBoxscoreBasketballById_web", {"contestId": str(cid)})}
    save_capture(cid, d)
    return _strip(d)


# ------------------------------------------------------------------ the sample
def discover(sports, dates, per_date) -> dict:
    """Pick games off each date's scoreboard: overtime and championship games first (they are where the
    period arithmetic and the tournament feeds differ), then evenly across the rest, finals only - and only
    games between two Division II schools, by the adapter's own rule (adapters/ncaa.py outside_division), each
    entry keeping both teams' conferenceSeo so the rule can be checked again offline."""
    A = adapter()
    out = {}
    for sport in sports:
        picked = []
        for ds in dates:
            day = datetime.strptime(ds, "%Y-%m-%d").date()
            try:
                lines = A.board(sport, 2, day, max_age=10 ** 9)
            except Exception as exc:
                print(f"  {sport} {ds}: scoreboard unreadable ({exc})")
                continue
            fin = sorted((c for c in lines.values() if str(c.get("gameState")).upper() == "F"
                          and not A.outside(c, sport, 2, day)), key=lambda c: int(c["contestId"]))
            ot = [c for c in fin if "OT" in str(c.get("currentPeriod") or "").upper()]
            ch = [c for c in fin if c.get("isChampionship") and c not in ot]
            rest = [c for c in fin if c not in ot and c not in ch]
            take = ot[:2] + ch[:2]
            need = max(0, per_date - len(take))
            if rest and need:
                step = max(1, len(rest) // need)
                take += rest[::step][:need]
            for c in take[:per_date + 1]:
                t = c.get("teams") or []
                h = next((x for x in t if x.get("isHome")), {})
                a = next((x for x in t if not x.get("isHome")), {})
                picked.append({"id": str(c["contestId"]), "date": ds, "ot": "OT" in str(c.get("currentPeriod") or "").upper(),
                               "champ": bool(c.get("isChampionship")),
                               "game": f"{h.get('nameShort')} {h.get('score')}-{a.get('score')} {a.get('nameShort')}",
                               "conferences": [h.get("conferenceSeo"), a.get("conferenceSeo")],
                               "teams": [h.get("seoname"), a.get("seoname")]})
            print(f"  {sport} {ds}: {len(fin)} final, took {len(take[:per_date + 1])} ({len(ot)} OT, {len(ch)} championship)")
        out[sport] = picked
    return out


# ------------------------------------------------------------------ the website's path
def run_site(data: dict, sport: str, cid: str) -> dict:
    """adapters/ncaa.py exactly as NcaaAdapter.fetch runs it, from the parse to the bundle, then translate."""
    A = adapter()
    mod = A._scraper({})
    if not mod:
        raise RuntimeError(f"the scraper's NCAA parse is not importable ({A._mod_error})")
    parsed = A.parse(mod, data, sport)
    raw = N.to_fiba(data, parsed, N.SPORTS[sport])
    with contextlib.redirect_stdout(io.StringIO()):
        b = A.bundle_from_raw(raw, cid, {"sport": sport, "division": 2})
    T = translate(raw)
    return {"parsed": parsed, "raw": raw, "bundle": b, "T": T, "why": N.log_disagrees(raw)}


ENGINE_JS = r"""
const E = require(process.argv[1]);
const games = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = {};
for (const [id, T] of Object.entries(games)) {
  const evs = T.events.map(r => Object.assign({ id: r.seq, t: r.t, team: r.team, pid: r.pid, period: r.period, clock: r.clock }, r.payload));
  const g = { teams: T.roster_snapshot.teams, starters: T.starters, events: evs, period: T.period, clockMs: 0,
              tipWinner: T.tip_winner, arrowInit: T.arrow_init };
  const d = E.deriveGame(g);
  const pl = {};
  g.teams.forEach(tm => tm.players.forEach(p => { const s = d.stats[p.id];
    pl[p.id] = { pts: s.pts, p2m: s.p2m, p2a: s.p2a, p3m: s.p3m, p3a: s.p3a, ftm: s.ftm, fta: s.fta, or: s.or, dr: s.dr,
                 ast: s.ast, stl: s.stl, blk: s.blk, to: s.to, pf: s.pf, min: s.min }; }));
  const tt = [0, 1].map(t => Object.assign(E.teamTotals(g, d, t), { pf: d.team[t].foulTot, score: d.score[t] }));
  out[id] = { pl, tt, score: d.score, perQ: d.perQ };
}
process.stdout.write(JSON.stringify(out));
"""


def engine(batch: dict) -> dict:
    """deriveGame over every translation in one node process: {id: T} -> {id: {pl, tt, score}}."""
    if not batch:
        return {}
    p = subprocess.run(["node", "-e", ENGINE_JS, str(REPO / "epinoia" / "engine.js")], input=json.dumps(batch),
                       capture_output=True, text=True, encoding="utf-8")
    if p.returncode:
        raise RuntimeError(f"engine.js failed: {p.stderr[-800:]}")
    return json.loads(p.stdout)


# ------------------------------------------------------------------ the official box
def _n(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _mins(v) -> float:
    s = str(v or "0")
    try:
        if ":" in s:
            m, sec = s.split(":")[:2]
            return int(m) + int(sec) / 60.0
        return float(s)
    except ValueError:
        return 0.0


def official_line(r: dict) -> dict:
    fgm, fga, tm, ta = _n(r.get("fieldGoalsMade")), _n(r.get("fieldGoalsAttempted")), _n(r.get("threePointsMade")), _n(r.get("threePointsAttempted"))
    o, t = _n(r.get("offensiveRebounds")), _n(r.get("totalRebounds"))
    return {"PTS": _n(r.get("points")), "FGM": fgm, "FGA": fga, "2PM": fgm - tm, "2PA": fga - ta, "3PM": tm, "3PA": ta,
            "FTM": _n(r.get("freeThrowsMade")), "FTA": _n(r.get("freeThrowsAttempted")), "OREB": o, "DREB": t - o, "REB": t,
            "AST": _n(r.get("assists")), "STL": _n(r.get("steals")), "BLK": _n(r.get("blockedShots")),
            "TOV": _n(r.get("turnovers")), "PF": _n(r.get("personalFouls"))}


def engine_line(s: dict) -> dict:
    return {"PTS": s["pts"], "FGM": s["p2m"] + s["p3m"], "FGA": s["p2a"] + s["p3a"], "2PM": s["p2m"], "2PA": s["p2a"],
            "3PM": s["p3m"], "3PA": s["p3a"], "FTM": s["ftm"], "FTA": s["fta"], "OREB": s["or"], "DREB": s["dr"],
            "REB": s["or"] + s["dr"], "AST": s["ast"], "STL": s["stl"], "BLK": s["blk"], "TOV": s["to"], "PF": s["pf"]}


def engine_team(t: dict) -> dict:
    return {"PTS": t["score"], "FGM": t["fgm"], "FGA": t["fga"], "2PM": t["fg2m"], "2PA": t["fg2a"], "3PM": t["fg3m"],
            "3PA": t["fg3a"], "FTM": t["ftm"], "FTA": t["fta"], "OREB": t["oreb"], "DREB": t["dreb"],
            "REB": t["oreb"] + t["dreb"], "AST": t["ast"], "STL": t["stl"], "BLK": t["blk"], "TOV": t["tov"], "PF": t["pf"]}


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[.,'’`-]", " ", s)).lower().strip()


def box_inconsistent(data: dict) -> list:
    """Where the official box contradicts itself: a team line BELOW the sum of its own players (team rebounds and
    team turnovers may only add to it, so those two are left out). Then the players and the team cannot both be
    matched, and which one is wrong is the provider's secret (2025-26: Cal St. East Bay's line twice leaves out a
    Chase Page the play-by-play never mentions)."""
    box = ((data.get("box") or {}).get("data") or {}).get("boxscore") or {}
    out = []
    for tb in box.get("teamBoxscore") or []:
        ts, ps = tb.get("teamStats") or {}, tb.get("playerStats") or []
        if not ts or len(ps) < 5:
            continue
        line = official_line(ts)
        summed = {c: sum(official_line(p)[c] for p in ps) for c in COUNTS}
        bad = {c: summed[c] - line[c] for c in COUNTS
               if c not in ("OREB", "DREB", "REB", "TOV") and summed[c] != line[c]}
        if bad:
            out.append({"teamId": tb.get("teamId"), "players_minus_team": bad})
    return out


def feed_line_score(data: dict) -> dict:
    """({period number: (home, visitor) points in it}, (home, visitor) at the end) from the feed's own running
    score - the last scored row of each period. The caller trusts it only when it ends on the official score."""
    pbp = ((data.get("pbp") or {}).get("data") or {}).get("playbyplay") or {}
    cum, out = (0, 0), {}
    for per in pbp.get("periods") or []:
        last = None
        for e in per.get("playbyplayStats") or []:
            hv = (_n(e.get("homeScore")), _n(e.get("visitorScore")))
            if hv != (0, 0):
                last = hv
        if last is None:
            continue
        out[int(per.get("periodNumber") or 0)] = (last[0] - cum[0], last[1] - cum[1])
        cum = last
    return out, cum


def official(data: dict) -> dict:
    """{side: {'rows': [playerStats in box order], 'team': teamStats line, 'name'}} with side 0 = home."""
    box = ((data.get("box") or {}).get("data") or {}).get("boxscore") or {}
    pbp = ((data.get("pbp") or {}).get("data") or {}).get("playbyplay") or {}
    side = {str(t.get("teamId")): (0 if t.get("isHome") else 1) for t in (pbp.get("teams") or box.get("teams") or [])}
    names = {(0 if t.get("isHome") else 1): t.get("nameShort") for t in (pbp.get("teams") or box.get("teams") or [])}
    out = {0: {"rows": [], "team": None, "name": names.get(0)}, 1: {"rows": [], "team": None, "name": names.get(1)}}
    for tb in box.get("teamBoxscore") or []:
        i = side.get(str(tb.get("teamId")))
        if i is None:
            continue
        out[i]["rows"] = list(tb.get("playerStats") or [])
        out[i]["team"] = official_line(tb.get("teamStats") or {}) if tb.get("teamStats") else None
    return out


# ------------------------------------------------------------------ one game, compared
def compare(cid: str, sport: str, data: dict, site: dict, eng: dict, min_tol: float) -> dict:
    off = official(data)
    parsed, b = site["parsed"], site["bundle"]
    res = {"id": cid, "sport": sport, "players": [], "teams": [], "minutes": [], "pbp_only": [],
           "flags": {"degraded_feed": parsed.get("degraded_feed") or [], "partial_box": parsed.get("partial_box") or [],
                     "unmapped": sum((parsed.get("unmapped") or {}).values()),
                     "box_inconsistent": box_inconsistent(data),
                     "reconciled": {k: v for k, v in (parsed.get("reconciled") or {}).items() if v}}}
    # THE LINE SCORE, against the feed's own running score: the official box has no periods, so this is the one
    # witness to WHEN the points were scored (a free throw the reconciliation adds at the wrong moment moves them)
    fl, end = feed_line_score(data)
    want_end = ((off[0]["team"] or {}).get("PTS"), (off[1]["team"] or {}).get("PTS"))
    res["line"] = []
    if fl and end == want_end:
        for p, (h, v) in sorted(fl.items()):
            got = (int((eng.get("perQ") or [{}, {}])[0].get(str(p), 0)), int((eng.get("perQ") or [{}, {}])[1].get(str(p), 0)))
            if got != (h, v):
                res["line"].append({"period": p, "log": got, "feed": (h, v)})
    res["game"] = f"{off[0]['name']} {(off[0]['team'] or {}).get('PTS')}-{(off[1]['team'] or {}).get('PTS')} {off[1]['name']}"
    res["published"] = "result-only" if b.translate is False else ("not-final" if b.status != "final" else "replayed")
    res["why"] = site["why"]
    for i in (0, 1):
        keys = list(((parsed.get("site_box") or {}).get(i) or {}).keys())
        rows = off[i]["rows"]
        for k, key in enumerate(keys, start=1):
            pid = f"{i}:{k}"
            s = (eng.get("pl") or {}).get(pid)
            if s is None:
                continue
            got = engine_line(s)
            sb = parsed["site_box"][i][key]
            if sb.get("synthetic") or k > len(rows):
                # a player the play-by-play names and the box does not: everything credited to him is a
                # difference from the official box, which has nobody to hold it
                if any(got.values()):
                    res["pbp_only"].append({"side": i, "name": sb.get("name"), "line": {c: v for c, v in got.items() if v}})
                continue
            r = rows[k - 1]
            want = official_line(r)
            nm = f"{(r.get('firstName') or '').strip()} {(r.get('lastName') or '').strip()}".strip()
            if _fold(nm.replace(".", "")) != _fold(sb.get("name") or ""):
                res.setdefault("slot_mismatch", []).append((i, k, nm, sb.get("name")))
            d = {c: (got[c], want[c]) for c in COUNTS if got[c] != want[c]}
            if d:
                res["players"].append({"side": i, "num": r.get("number"), "name": nm, "diff": d})
            bm, em = _mins(r.get("minutesPlayed")), s["min"] / 60000.0
            if (bm or em) and abs(bm - em) > min_tol:
                res["minutes"].append({"side": i, "num": r.get("number"), "name": nm, "log": round(em, 1), "box": bm})
        if off[i]["team"]:
            got = engine_team(eng["tt"][i])
            d = {c: (got[c], off[i]["team"][c]) for c in COUNTS if got[c] != off[i]["team"][c]}
            if d:
                res["teams"].append({"side": i, "diff": d})
    exact = not (res["players"] or res["teams"] or res["pbp_only"])
    has_pbp = bool((((data.get("pbp") or {}).get("data") or {}).get("playbyplay") or {}).get("periods"))
    res["verdict"] = ("NO-PBP" if not has_pbp else
                      "RESULT-ONLY" if res["published"] == "result-only" else
                      "NOT-FINAL" if res["published"] == "not-final" else "EXACT" if exact else "DIFF")
    return res


def show(r: dict, verbose: bool) -> None:
    fl = r["flags"]
    tag = []
    if fl["degraded_feed"]:
        tag.append("degraded:" + ",".join(fl["degraded_feed"]))
    if fl["partial_box"]:
        tag.append(f"partial box {fl['partial_box']}")
    if fl["unmapped"]:
        tag.append(f"{fl['unmapped']} unmapped rows")
    if fl["box_inconsistent"]:
        tag.append("box contradicts itself")
    if r["minutes"]:
        tag.append(f"{len(r['minutes'])} minutes off")
    if r["line"]:
        tag.append(f"line score off in {len(r['line'])} period(s)")
    if fl["reconciled"]:
        tag.append("reconciled " + ",".join(f"{k} {v}" for k, v in fl["reconciled"].items()))
    print(f"[{r['sport']} {r['id']}] {r['verdict']:<11} {r['game']}" + (f"  ({'; '.join(tag)})" if tag else ""))
    if r["verdict"] == "RESULT-ONLY":
        print(f"      result only: {r['why']}")
    if not verbose:
        return
    side = lambda i: "H" if i == 0 else "A"  # noqa: E731
    for t in r["teams"]:
        print(f"      team {side(t['side'])}: " + " ".join(f"{c} {a}/{b}" for c, (a, b) in t["diff"].items()))
    for p in r["players"]:
        print(f"      {side(p['side'])} #{p['num']} {p['name']}: " + " ".join(f"{c} {a}/{b}" for c, (a, b) in p["diff"].items()))
    for p in r["pbp_only"]:
        print(f"      {side(p['side'])} (not in box) {p['name']}: " + " ".join(f"{c} {v}" for c, v in p["line"].items()))
    for x in r.get("slot_mismatch") or []:
        print(f"      ! slot {x} does not match the box row")
    for b in fl["box_inconsistent"]:
        print(f"      box: team {b['teamId']}'s players add up to more than its line: "
              + " ".join(f"{c} +{v}" for c, v in b["players_minus_team"].items()))
    if r["line"]:
        print("      line score (log/feed): " + "  ".join(f"P{x['period']} {x['log'][0]}-{x['log'][1]}/{x['feed'][0]}-{x['feed'][1]}"
                                                    for x in r["line"]))
    for m in r["minutes"]:
        print(f"      minutes {side(m['side'])} #{m['num']} {m['name']}: log {m['log']} / box {m['box']}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--sport", choices=["MBB", "WBB"])
    ap.add_argument("--cached", action="store_true", help="never fetch; games not on disk are skipped")
    ap.add_argument("--discover", action="store_true", help="rebuild data/ncaa/sample.json from the scoreboards")
    ap.add_argument("--dates", default=",".join(DATES))
    ap.add_argument("--per-date", type=int, default=PER_DATE)
    ap.add_argument("--min-tol", type=float, default=2.0, help="minutes tolerance per player (default 2)")
    ap.add_argument("--json", help="write every comparison here")
    ap.add_argument("--captures", action="append", default=[],
                    help="another directory of <contestId>.json[.gz] (the scraper's validation/ncaa/captures): every "
                         "game in it is compared, never fetched")
    ap.add_argument("-q", "--quiet", action="store_true", help="one line a game")
    a = ap.parse_args(argv)
    os.environ.setdefault("SCRAPER_DIR", N.DEFAULT_SCRAPER_DIR)
    EXTRA_DIRS.extend(a.captures)
    if a.captures and not a.ids:
        a.ids = sorted({p.name.split(".")[0] for d in a.captures for p in Path(d).glob("*.json*")})
        a.cached = True

    sports = [a.sport] if a.sport else ["MBB", "WBB"]
    if a.discover or (not a.ids and not SAMPLE.exists()):
        if a.cached:
            print("no sample on disk and --cached: nothing to do")
            return 1
        smp = json.loads(SAMPLE.read_text()) if SAMPLE.exists() else {}
        smp.update(discover(sports, [d.strip() for d in a.dates.split(",") if d.strip()], a.per_date))
        DATA.mkdir(parents=True, exist_ok=True)
        SAMPLE.write_text(json.dumps(smp, indent=1) + "\n", newline="\n")
        print(f"sample written: {', '.join(f'{k} {len(v)}' for k, v in smp.items())}")
    if a.ids:
        todo = [(None, x) for x in a.ids]
    else:
        smp = json.loads(SAMPLE.read_text())
        # the division's conferences as ncaa.com listed them for the sample's season (NCAA_GetConferences_web):
        # a game whose two teams are not both on it is not the league's, and is not compared
        listed = next((v for k, v in smp.items() if k.startswith("_d2_conferences")), {})
        todo = []
        for s in sports:
            for g in smp.get(s, []):
                confs = g.get("conferences")
                if listed.get(s) and confs and any(c not in listed[s] for c in confs):
                    print(f"[{s} {g['id']}] {g.get('game')}: outside Division II {confs} - left out")
                    continue
                # ...nor one against a school in the D2 membership process that season (adapters/ncaa.py D2_PROVISIONAL)
                season = N.season_year({}, datetime.strptime(g["date"], "%Y-%m-%d").date()) if g.get("date") else None
                prov = [t for t in g.get("teams") or [] if season and t in N.D2_PROVISIONAL.get(season, ())]
                if prov:
                    print(f"[{s} {g['id']}] {g.get('game')}: provisional D2 member {prov} - left out")
                    continue
                todo.append((s, g["id"]))

    sites, datas, batch, results = {}, {}, {}, []
    for sport, cid in todo:
        try:
            data = fetch(cid, a.cached)
        except Exception as exc:
            print(f"[{cid}] fetch failed: {exc}")
            continue
        if data is None:
            continue
        box = ((data.get("box") or {}).get("data") or {}).get("boxscore") or {}
        sport = sport or str(box.get("sportCode") or "MBB").upper()
        if str(box.get("status") or "").upper() != "F":
            print(f"[{sport} {cid}] not final ({box.get('status')}) - skipped")
            continue
        try:
            sites[cid] = (sport, run_site(data, sport, cid))
        except Exception as exc:
            print(f"[{sport} {cid}] the website's path raised: {exc!r}")
            continue
        datas[cid] = data
        batch[cid] = sites[cid][1]["T"]
    eng = engine(batch)
    for cid, (sport, site) in sites.items():
        r = compare(cid, sport, datas[cid], site, eng[cid], a.min_tol)
        results.append(r)
        show(r, not a.quiet)

    print()
    for sport in sports:
        rs = [r for r in results if r["sport"] == sport]
        if not rs:
            continue
        c = {k: sum(1 for r in rs if r["verdict"] == k) for k in ("EXACT", "DIFF", "RESULT-ONLY", "NOT-FINAL", "NO-PBP")}
        mins = sum(1 for r in rs if r["minutes"])
        line = sum(1 for r in rs if r["line"] and r["verdict"] in ("EXACT", "DIFF"))
        print(f"{sport}: {len(rs)} games - {c['EXACT']} exact, {c['DIFF']} with stat differences, "
              f"{c['RESULT-ONLY']} result-only" + (f", {c['NO-PBP']} with no play-by-play" if c["NO-PBP"] else "")
              + (f"; {mins} with a player's minutes off by more than {a.min_tol:g}" if mins else "")
              + (f"; {line} replayed with a period's score off the feed's" if line else ""))
    if a.json:
        Path(a.json).write_text(json.dumps(results, indent=1, default=str))
    return 0 if all(r["verdict"] in ("EXACT", "NO-PBP") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
