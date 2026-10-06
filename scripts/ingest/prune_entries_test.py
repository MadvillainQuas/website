"""prune_empty_entries (run_ingest.py): a club entered in a competition with no game in it is dropped from that season's field - but only
when the schedule is clearly complete. Run: python scripts/ingest/prune_entries_test.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import run_ingest as R  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


class SB:
    def __init__(self, entries, games):
        self.entries, self.games, self.deleted = entries, games, []

    def select(self, table, q):
        if table == "competition_teams":
            return [{"team_id": t} for t in self.entries]
        return [{"home_team_id": h, "away_team_id": a} for h, a in self.games]

    select_all = select

    def delete(self, table, q):
        self.deleted.append((table, q))


def round_robin(teams, laps=1):
    return [(a, b) for _ in range(laps) for i, a in enumerate(teams) for b in teams[i + 1:]]


clubs = [f"t{i}" for i in range(12)]
games = round_robin(clubs)                       # 66 games, every club plays

sb = SB(clubs + ["gone"], games)
run = {}
n = R.prune_empty_entries(sb, {"c1"}, run, log=lambda m: None)
ok("a club with no game in a complete schedule is dropped, with its standings row", n == 1 and
   ("competition_teams", "competition_id=eq.c1&team_id=eq.gone") in sb.deleted and ("standings", "competition_id=eq.c1&team_id=eq.gone") in sb.deleted, sb.deleted)
ok("the standings are rebuilt after", run.get("_recompute") == {"c1"}, run)

sb = SB(clubs, games)
ok("every club having a game removes nothing", R.prune_empty_entries(sb, {"c1"}, {}, log=lambda m: None) == 0 and not sb.deleted)

sb = SB(clubs[:6] + [f"x{i}" for i in range(6)], round_robin(clubs[:6]))
ok("a half-published schedule (half the clubs have no fixture yet) is never pruned", R.prune_empty_entries(sb, {"c1"}, {}, log=lambda m: None) == 0 and not sb.deleted, sb.deleted)

sb = SB(["a", "b", "gone"], [("a", "b")] * 3)
ok("a competition with a handful of games is never pruned", R.prune_empty_entries(sb, {"c1"}, {}, log=lambda m: None) == 0 and not sb.deleted)

class Boom(SB):
    def select(self, table, q):
        raise RuntimeError("503")
    select_all = select
ok("a failed read removes nothing", R.prune_empty_entries(Boom([], []), {"c1"}, {}, log=lambda m: None) == 0)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
