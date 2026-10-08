# -*- coding: utf-8 -*-
"""rotationgate.py: a league whose source records no rotation is dropped after one more game (Louie,
2026-10-08). No network, no database: python scripts/ingest/rotationgate_test.py"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rotationgate as G  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


def raw(subs=0, mins="0:00"):
    """A finished game's payload: Komotini v Voulas's shape (actions only) unless told otherwise."""
    pbp = [{"actionType": "2pt", "pno": "1"}] * 3 + [{"actionType": "substitution", "subType": "in"}] * subs
    pl = {"p1": {"sMinutes": mins}, "p2": {"sMinutes": "0:00"}}
    return {"tm": {"1": {"pl": pl}, "2": {"pl": {"p3": {"sMinutes": "0:00"}}}}, "pbp": pbp}


print("-- what a rotation is")
ok("actions alone, every player on 0:00: no rotation (GAS Komotini v Protefs Voulas, 3 Oct 2026)", not G.has_rotation(raw()))
ok("one substitution is a rotation", G.has_rotation(raw(subs=1)))
ok("minutes on one player is a rotation", G.has_rotation(raw(mins="23:41")))
ok("...in either form a feed writes them", G.has_rotation(raw(mins="PT23M41S")))
ok("an empty payload is not one", not G.has_rotation({}))

print("\n-- the verdict, newest game first")
ok("one game without: not judged yet - one more is read first", G.verdict([raw()]) is None)
why = G.verdict([raw(), raw()])
ok("two without: drop", bool(why) and "2 finished games" in why, why)
ok("the newest with a rotation: keep", G.verdict([raw(subs=4), raw(), raw()]) is None)
ok("an older one with a rotation: keep for good", G.verdict([raw(), raw(), raw(mins="31:02")]) is None)
ok("a payload that could not be read is no evidence either way", G.verdict([raw(), None]) is None)


class FakeSb:
    def __init__(self, visibility="public", refs=()):
        self.vis = visibility
        self.refs = list(refs)
        self.patched = []
        self.asked = []

    def select(self, table, query):
        self.asked.append((table, query))
        if table == "leagues":
            return [{"id": "L1", "slug": "greek-elite-league", "visibility": self.vis}]
        if table == "external_games":
            return [{"raw_ref": r, "tipoff_at": "2026-10-10"} for r in self.refs]
        return []

    def patch(self, table, query, body):
        self.patched.append((table, query, body))
        if table == "leagues":
            self.vis = body.get("visibility", self.vis)


SRC = {"adapter": "grel", "code": "GREL", "league_slug": "greek-elite-league", "label": "Greek Elite League",
       "adapter_config": {"code": "GREL", "rotation_gate": True}}
PAYLOADS = {"a": raw(), "b": raw(), "c": raw(subs=9)}

print("\n-- judging a league")
sb = FakeSb(refs=["a"])
ok("one finished game: nothing done", G.judge(sb, SRC, PAYLOADS.get) is None and not sb.patched)
sb = FakeSb(refs=["b", "a"])
said = G.judge(sb, SRC, PAYLOADS.get)
ok("one more without minutes: the league goes private, and says so",
   sb.patched == [("leagues", "id=eq.L1", {"visibility": "private"})] and said and said.startswith("DROPPED greek-elite-league"), (sb.patched, said))
ok("...and from then on its sources are skipped", G.dropped(sb, SRC))
sb = FakeSb(refs=["c", "a"])
ok("one more WITH a rotation: kept", G.judge(sb, SRC, PAYLOADS.get) is None and not sb.patched)
ok("...and not skipped", not G.dropped(sb, SRC))
sb = FakeSb(visibility="private", refs=["b", "a"])
ok("a league already private is never patched again", G.judge(sb, SRC, PAYLOADS.get) is None and not sb.patched)
plain = dict(SRC, adapter_config={"code": "GREL"})
sb = FakeSb(refs=["b", "a"])
ok("a source without the gate is never judged, nor skipped", G.judge(sb, plain, PAYLOADS.get) is None and not sb.patched
   and not G.dropped(FakeSb(visibility="private"), plain))
sb = FakeSb(refs=["a"])
G.judge(sb, SRC, PAYLOADS.get)
ok("the finished games read are this source's own, newest first, a capped number",
   any(t == "external_games" and "adapter=eq.grel&competition_code=eq.GREL&external_status=eq.final" in q
       and "order=tipoff_at.desc" in q and "limit=%d" % G.MAX_READ in q for t, q in sb.asked), sb.asked)

print("\n-- the wiring")
src = open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().replace("\r\n", "\n")
ok("the ingest skips a dropped league's sources before any pass", "if rotationgate.dropped(sb, s_):" in src
   and src.index("if rotationgate.dropped(sb, s_):") < src.index("if args.live_only and not args.ids:"))
ok("...and judges a gated league at the end of every pass that writes", "said = rotationgate.judge(sb, src, gate_json)" in src)
cfg = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))
grel = [s for s in cfg["sources"] if s.get("code") == "GREL"]
ok("both Greek Elite League rows carry the gate", len(grel) == 2 and all(s["adapter_config"].get("rotation_gate") is True for s in grel))
ok("no other league does", all(not (s.get("adapter_config") or {}).get("rotation_gate") for s in cfg["sources"] if s.get("code") != "GREL"))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
