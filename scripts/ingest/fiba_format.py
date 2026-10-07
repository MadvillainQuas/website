"""
fiba_format.py - a FIBA competition's FORMAT, read off its own standings page, as EPINOIA's
competitions, groups and brackets.

WHY. Every competition FIBA runs on its own site (the Basketball Champions League, the FIBA Europe
Cup, and by the same pages any FIBA event) publishes its structure on /standings: a list of STAGES,
each one of three kinds (adapters/fiba_events.competition_format reads them):

    groups     tables - the BCL's eight groups of four, the Europe Cup's second-round groups I-L
    pairings   one round of ties - the BCL's best-of-three play-ins, two-legged qualifiers
    bracket    rounds that feed each other - a final four with its third-place game

EPINOIA already has the pieces (0018 formats, 0046 bracket designer): one competition per phase,
a club's group on its competition_teams entry, and bracket_ties with legs and a decider that
advance_bracket settles from the games filed on them. What it did not have was anything that READ a
format, so a league with stages had to be split by hand in the config, one entry per phase (ABA,
BNXT). This does it from the page, for every FIBA competition:

  1. stage_sources() turns ONE fiba_events source into one source PER STAGE that has fixtures:
     the stage's rounds (adapter_config.round_ids, which discover() filters on), its name as the
     competition, 'groups' or 'knockout' as the competition's format, and groups_from_feed for a
     group stage (each fixture names its group: groups.learn). The main group phase keeps the
     source's own label, so it is the league's default competition - the one the live lane, which
     writes games without knowing their stage, already files under.

  2. sync_stage() runs once per pass per stage, after its fixtures are written:
       - competitions.qualifiers (how many go through, from the later stages' "2nd of group H"),
         and the stage as FIBA describes it in competitions.format_config.fiba (feeder labels,
         dates, status, game systems), which the console's bracket designer does not read;
       - for a knockout stage, its bracket_ties: one per pairing, legs + decider from the game
         system (best of three: 3 legs, first to two; home-and-away: 2 legs on aggregate), a
         later round fed by an earlier one ("Winner of Game 157" -> that tie), the third-place
         game beside the final; and every game filed on its tie with its leg.

A stage whose clubs are all still unknown (a final four in October) is left until its first fixture
has both clubs: an empty competition for every future stage would be noise on the league's page.
"""
from __future__ import annotations

import re

#: the competitions.kind of each kind of stage (0018: a phase on the league's Table tab)
KIND = {"groups": "league", "pairings": "playoff", "bracket": "playoff"}

_WINNER = re.compile(r"^\s*winner\s+of\s+game\s+(\S+)\s*$", re.I)


def legs_of(system: str | None, system_name: str | None = None) -> tuple:
    """(legs, decider) for a FIBA game system: 'S' one game, 'BOF3' / 'Best of 3' first to two,
    'HA' (home-away) two legs on aggregate."""
    s = str(system or "").upper()
    m = re.match(r"BOF(\d)", s) or re.search(r"best\s+of\s+(\d)", str(system_name or ""), re.I)
    if m:
        return int(m.group(1)), "wins"
    if s == "HA" or re.search(r"home.?away|two.?leg", str(system_name or ""), re.I):
        return 2, "aggregate"
    return 1, "wins"


def main_stage(fmt: dict) -> dict | None:
    """The competition's main phase: its regular-season group stage, else its first group stage,
    else its first stage."""
    st = fmt.get("stages") or []
    return (next((s for s in st if s["kind"] == "groups" and str(s.get("code") or "").upper() == "RS"), None)
            or next((s for s in st if s["kind"] == "groups"), None) or (st[0] if st else None))


def _base_url(url: str) -> str:
    return (url or "").split("#")[0]


def stage_sources(sources: list, get_adapter, log=print) -> list:
    """Each fiba_events source, as one source per stage of its competition that has a fixture with
    both clubs. A source whose format cannot be read this pass is kept as it is (one competition,
    named by its label) rather than dropped: the games still arrive, only the split waits."""
    out = []
    for src in sources:
        if src.get("adapter") != "fiba_events" or src.get("_fiba_stage") \
                or (src.get("adapter_config") or {}).get("round_ids"):
            out.append(src)
            continue
        ac = src.get("adapter_config") or {}
        adapter = get_adapter(src["adapter"])
        try:
            fmt = adapter.competition_format_for(src["schedule_url"], ac)
            games = adapter.season_games(src["schedule_url"], ac) if fmt else []
        except Exception as exc:
            log(f"   (format unavailable for {src.get('code')}: {exc})")
            fmt, games = None, []
        if not fmt:
            out.append(src)
            continue
        playable = set()
        for g in games:
            a, b = g.get("teamA"), g.get("teamB")
            if isinstance(a, dict) and isinstance(b, dict) and (a.get("shortName") or a.get("officialName")) \
                    and (b.get("shortName") or b.get("officialName")):
                rid = (g.get("round") or {}).get("roundId")
                if rid is not None:
                    playable.add(int(rid))
        main = main_stage(fmt)
        picked = []
        for st in fmt["stages"]:
            if not playable & {int(r) for r in st["round_ids"]}:
                continue
            grouped = st["kind"] == "groups"
            label = (src.get("label") or st["name"]) if st is main else st["name"]
            picked.append({**src,
                           "schedule_url": f"{_base_url(src['schedule_url'])}#{st.get('code') or st['name']}",
                           "competition_label": label, "competition_kind": KIND.get(st["kind"], "league"),
                           "competition_id": None,
                           "adapter_config": {**ac, "round_ids": list(st["round_ids"]),
                                              "groups_from_feed": grouped,
                                              "competition_format": "groups" if grouped else "knockout"},
                           "_fiba_stage": st, "_fiba_teams": fmt.get("teams") or {}})
        if not picked:
            out.append(src)
            continue
        log(f"-> {src.get('code')}: {len(picked)} stage(s) with fixtures: "
            + ", ".join(f"{s['competition_label']} [{s['_fiba_stage']['kind']}]" for s in picked))
        out.extend(picked)
    return out


# ------------------------------------------------------------------ writing a stage ---
def stage_summary(st: dict) -> dict:
    """What competitions.format_config.fiba keeps: the stage as FIBA describes it, team ids as FIBA's."""
    return {"source": "fiba", "name": st["name"], "code": st.get("code"), "kind": st["kind"],
            "status": st.get("status"), "current": st.get("current"), "start": st.get("start"), "end": st.get("end"),
            "round_ids": st.get("round_ids"), "qualifiers": st.get("qualifiers") or 0,
            "groups": [{"name": g["name"], "slots": g.get("slots"), "qualify": g.get("qualify"), "from": g.get("from") or []}
                       for g in st.get("groups") or []],
            "rounds": [{"name": r["name"], "system": r.get("system"), "system_name": r.get("system_name"),
                        "pairings": [{k: p.get(k) for k in ("code", "from_a", "from_b")} for p in r["pairings"]]}
                       for r in (st.get("rounds") or []) + ([st["third_place"]] if st.get("third_place") else [])]}


def tie_plan(st: dict) -> list:
    """The bracket_ties a knockout stage needs, in order: [{round, slot, label, legs, decider,
    game_ids, feeds: {"home": game number, "away": game number}, numbers}].

    Round 1 is the stage's first round and the final the last (0018's numbering); slots are
    0-based within a round, which is what epinoia/l/bracket.js prints (slot + 1). A pairings
    stage is one round, labelled with the stage's name ("Play-ins", "Quarter-Finals") because
    FIBA calls its single round only "Standard Round". The third-place game sits in the final's
    round, after the final; game_significance reads its label ("3rd Place Game") as an ordinary tie."""
    rounds = list(st.get("rounds") or [])
    plan = []
    for r_i, rnd in enumerate(rounds, start=1):
        generic = not rnd.get("name") or rnd["name"].lower() in ("standard round", st["name"].lower())
        label = st["name"] if (st["kind"] == "pairings" or generic) else rnd["name"]
        legs, decider = legs_of(rnd.get("system"), rnd.get("system_name"))
        pairs = sorted(rnd["pairings"], key=lambda p: (int(p["code"]) if str(p.get("code")).isdigit() else 10 ** 6, str(p.get("code"))))
        for slot, p in enumerate(pairs):
            plan.append(_tie(r_i, slot, label, legs, decider, p))
    if st.get("third_place") and rounds:
        rnd = st["third_place"]
        legs, decider = legs_of(rnd.get("system"), rnd.get("system_name"))
        last = len(rounds)
        used = sum(1 for t in plan if t["round"] == last)
        for k, p in enumerate(rnd["pairings"]):
            plan.append(dict(_tie(last, used + k, rnd.get("name") or "3rd Place Game", legs, decider, p), third=True))
    _resolve_feeders(plan)
    return plan


def _tie(rnd: int, slot: int, label: str, legs: int, decider: str, p: dict) -> dict:
    feeds = {}
    for side, key in (("home", "from_a"), ("away", "from_b")):
        m = _WINNER.match(str(p.get(key) or ""))
        if m:
            feeds[side] = m.group(1)
    return {"round": rnd, "slot": slot, "label": label, "legs": legs, "decider": decider,
            "game_ids": sorted(int(x) for x in p.get("game_ids") or []),
            "code": str(p.get("code") or ""), "feeds": feeds, "from": {}}


def _resolve_feeders(plan: list) -> None:
    """"Winner of Game N" -> the tie that game N is, as {"home": (round, slot)} on each tie's "from".

    N IS NOT ONE NUMBERING. On the Europe Cup it is the pairing's own code ("Winner of Game 6" is
    pairing 6); on the Champions League it is a game count that runs on from somewhere else (its
    final is fed by "Game 157" and "Game 158", the semi-finals being pairings 37 and 38). So a feeder
    is matched to a pairing code in an EARLIER round first, and a round whose feeders do not all
    match is paired off in order with the round before it, lowest number with the first slot -
    which is what both numberings do. Anything still unmatched is left without a feeder."""
    for r in sorted({t["round"] for t in plan}):
        ties = [t for t in plan if t["round"] == r and t["feeds"]]
        if not ties:
            continue
        prev = [t for t in plan if t["round"] == r - 1 and not t.get("third")]
        refs = {(id(t), side): n for t in ties for side, n in t["feeds"].items()}
        direct = {k: next((x for x in prev if x["code"] == n), None) for k, n in refs.items()}
        if all(direct.values()):
            hit = direct
        else:
            nums = sorted(set(refs.values()), key=lambda n: (int(n) if n.isdigit() else 10 ** 9, n))
            order = sorted(prev, key=lambda x: x["slot"])
            hit = {k: (order[nums.index(n)] if len(nums) == len(order) else None) for k, n in refs.items()}
        for t in ties:
            for side in t["feeds"]:
                src = hit.get((id(t), side))
                if src:
                    t["from"][side] = (src["round"], src["slot"])


_DONE: set = set()


def sync_stage(sb, src: dict, comp_id: str, run: dict, log=print) -> None:
    """The stage's facts onto its competition, and a knockout stage's ties and legs. Once per pass."""
    st = src.get("_fiba_stage")
    if not st or not comp_id or (comp_id, id(st)) in _DONE:
        return
    _DONE.add((comp_id, id(st)))
    summary = stage_summary(st)
    try:
        cur = sb.select("competitions", f"id=eq.{comp_id}&select=qualifiers,format_config")
        cur = cur[0] if cur else {}
        patch = {}
        q = int(st.get("qualifiers") or 0)
        if q and cur.get("qualifiers") != q:
            patch["qualifiers"] = q
        fc = dict(cur.get("format_config") or {})
        if fc.get("fiba") != summary:
            fc["fiba"] = summary
            patch["format_config"] = fc
        if patch:
            sb.patch("competitions", f"id=eq.{comp_id}", patch)
            log(f"   format: {st['name']} [{st['kind']}]" + (f", {q} qualify" if q else ""))
    except Exception as exc:
        log(f"   (format of {st['name']}: {exc})")
    if st["kind"] != "groups":
        write_ties(sb, src, comp_id, st, run, log)


def write_ties(sb, src: dict, comp_id: str, st: dict, run: dict, log=print) -> int:
    """bracket_ties for a knockout stage, and its games filed on them. Returns the ties written."""
    plan = tie_plan(st)
    if not plan:
        return 0
    adapter = src.get("adapter") or "fiba_events"
    all_ids = sorted({g for t in plan for g in t["game_ids"]})
    ext = {}
    for i in range(0, len(all_ids), 80):
        chunk = ",".join(str(x) for x in all_ids[i:i + 80])
        for r in sb.select("external_games", f"adapter=eq.{adapter}&external_id=in.({chunk})&select=external_id,game_id"):
            if r.get("game_id"):
                ext[int(r["external_id"])] = r["game_id"]
    games = {}
    gids = sorted(set(ext.values()))
    for i in range(0, len(gids), 80):
        chunk = ",".join(gids[i:i + 80])
        for r in sb.select("games", f"id=in.({chunk})&select=id,home_team_id,away_team_id,tie_id,leg,competition_id"):
            games[r["id"]] = r

    rows = []
    for t in plan:
        first = next((games.get(ext.get(g)) for g in t["game_ids"] if games.get(ext.get(g))), None)
        rows.append({"competition_id": comp_id, "round": t["round"], "slot": t["slot"], "label": t["label"],
                     "legs": t["legs"], "decider": t["decider"], "is_bye": False,
                     "home_team_id": (first or {}).get("home_team_id"), "away_team_id": (first or {}).get("away_team_id")})
    try:
        have = {(r["round"], r["slot"]): r for r in sb.select(
            "bracket_ties", f"competition_id=eq.{comp_id}&select=id,round,slot,label,legs,decider,home_team_id,away_team_id,home_from_tie,away_from_tie")}
    except Exception as exc:
        log(f"   (bracket of {st['name']}: {exc})")
        return 0
    keys = ("label", "legs", "decider", "home_team_id", "away_team_id")
    changed = [r for r in rows if not have.get((r["round"], r["slot"]))
               or any(have[(r["round"], r["slot"])].get(k) != r[k] for k in keys
                      if not (k.endswith("_team_id") and r[k] is None))]
    for r in changed:
        h = have.get((r["round"], r["slot"]))
        if h and r["home_team_id"] is None:     # a side advance_bracket already filled stays filled
            r = {k: v for k, v in r.items() if k not in ("home_team_id", "away_team_id")}
        got = sb.upsert("bracket_ties", r, "competition_id,round,slot")
        if got:
            have[(r["round"], r["slot"])] = {**(h or {}), **got[0]}
    # feeders: "Winner of Game 157" is the tie tie_plan resolved it to
    for t in plan:
        tie = have.get((t["round"], t["slot"])) or {}
        want = {f"{side}_from_tie": (have.get(key) or {}).get("id") for side, key in t["from"].items()}
        want = {k: v for k, v in want.items() if v}
        if tie.get("id") and want and any(tie.get(k) != v for k, v in want.items()):
            sb.patch("bracket_ties", f"id=eq.{tie['id']}", want)
            tie.update(want)
    # a pairing that is no longer on the page (FIBA redrew a round) goes; nothing else is touched
    planned = {(t["round"], t["slot"]) for t in plan}
    for key, h in have.items():
        if key not in planned and h.get("id"):
            sb.delete("bracket_ties", f"id=eq.{h['id']}")
    # each game on its tie, as leg 1, 2, 3 in the order FIBA numbered them
    filed = 0
    for t in plan:
        tie_id = (have.get((t["round"], t["slot"])) or {}).get("id")
        if not tie_id:
            continue
        for leg, fid in enumerate(t["game_ids"], start=1):
            g = games.get(ext.get(fid))
            if g and (g.get("tie_id") != tie_id or g.get("leg") != leg):
                sb.patch("games", f"id=eq.{g['id']}", {"tie_id": tie_id, "leg": leg})
                filed += 1
    if changed or filed:
        run.setdefault("_recompute", set()).add(comp_id)
        log(f"   bracket: {st['name']} - {len(plan)} tie(s), {len(changed)} written, {filed} game(s) filed on them")
    return len(changed)
