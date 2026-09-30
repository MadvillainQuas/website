"""A live game whose feed stops: read again, then flagged, and cleared when it moves (0189), offline:

    python scripts/ingest/stall_test.py

NBL Division One's Liverpool v Tees Valley Mohawks stopped at Q1 7:15 (26 Sep 2026) and Kosovo's
Vellaznimi v Sigal Prishtina at Q4 0:35 (27 Sep); both sat on the front page as LIVE for days. What this
holds the live lane to (run_ingest.stall_step and the two writes):
  * nothing happens for the first half hour of quiet - no break in a game is that long;
  * at half an hour the game is read again from scratch, once;
  * ten minutes after that with still nothing new it is flagged: the reason on external_games, the time
    the feed last moved on games.stalled_since (kept, never moved later), and only while it is live;
  * a game at the end of the fourth with the scores apart is the stale-final rule's, never flagged;
  * the first new play clears the flag, and only this rule's own note - not another error.
"""
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_ingest as RI  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


print("-- the rule")
T = 1_000_000.0
ok("29 min of quiet: keep polling", RI.stall_step(29 * 60, None, T) is None)
ok("30 min of quiet: read it again", RI.stall_step(30 * 60, None, T) == "refresh")
ok("...9 min after that read: still waiting", RI.stall_step(39 * 60, T - 9 * 60, T) is None)
ok("...10 min after it, nothing new: flag", RI.stall_step(40 * 60, T - 10 * 60, T) == "flag")
ok("a finished-looking game (end of Q4, scores apart) is never flagged", RI.stall_step(3 * 3600, T - 3600, T, finished=True) is None)

print("\n-- the reason the console shows")
raw = {"period": 1, "clock": "07:15", "tm": {"1": {"score": 7}, "2": {"score": 8}}}
note = RI.stall_note(raw, datetime(2026, 9, 26, 14, 12, tzinfo=timezone.utc), datetime(2026, 9, 26, 14, 42, tzinfo=timezone.utc))
ok("says where the feed stopped and when it was read again",
   note.startswith(RI.STALLED_TAG) and "26 Sep 14:12Z" in note and "P1 07:15, 7-8" in note and "14:42Z" in note, note)


class SB:
    def __init__(self, fail_games=False):
        self.patches, self.fail_games = [], fail_games

    def patch(self, table, query, body):
        if table == "games" and self.fail_games:
            raise RuntimeError('400 column "stalled_since" does not exist')
        self.patches.append((table, query, body))
        return []


print("\n-- flagging")
src = {"adapter": "fiba_livestats", "code": "NBLD1"}
sb = SB()
since = datetime(2026, 9, 26, 14, 12, tzinfo=timezone.utc)
RI.flag_stalled(sb, src, "2907953", "g1", note, since)
eg = [p for p in sb.patches if p[0] == "external_games"]
gm = [p for p in sb.patches if p[0] == "games"]
ok("the reason goes on the game's external row", eg and eg[0][1] == "adapter=eq.fiba_livestats&external_id=eq.2907953" and eg[0][2]["error"] == note, eg)
ok("the flag goes on the game, only if it is live and not flagged already (the first time is kept)",
   gm and gm[0][1] == "id=eq.g1&status=eq.live&stalled_since=is.null" and gm[0][2]["stalled_since"].startswith("2026-09-26T14:12"), gm)
sb2 = SB(fail_games=True)
RI.flag_stalled(sb2, src, "2907953", "g1", note, since)
ok("a database without 0189 still gets the reason", len(sb2.patches) == 1 and sb2.patches[0][0] == "external_games", sb2.patches)

print("\n-- clearing")
sb = SB()
RI.clear_stalled(sb, src, "2907953", "g1")
eg = [p for p in sb.patches if p[0] == "external_games"]
gm = [p for p in sb.patches if p[0] == "games"]
ok("only this rule's own note is cleared (error=like.stalled:*)", eg and "error=like.stalled%3A*" in eg[0][1] and eg[0][2] == {"error": None}, eg)
ok("the flag is lifted", gm and gm[0][1] == "id=eq.g1&stalled_since=not.is.null" and gm[0][2] == {"stalled_since": None}, gm)

print("\n-- the live lane uses it")
src_text = open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read()
ok("a game read again is written through whatever the stored hash says", "if not force and version_in_db(sb, src, xid, b):" in src_text)
ok("the second look goes past the CDN's copy", "_fresh=True" in src_text and 'config.get("_fresh")' in
   open(os.path.join(HERE, "adapters", "fiba_livestats.py"), encoding="utf-8").read())
ok("a flag in the database is known to the lane from its first look (error column read with the due games)",
   "payload_hash,game_id,error" in src_text and "startswith(STALLED_TAG)" in src_text)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
