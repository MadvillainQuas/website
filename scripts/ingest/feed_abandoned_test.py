"""A live game whose feed never sends its own close is closed on the clock's word once nobody
could still be playing it: python scripts/ingest/feed_abandoned_test.py

THE GAMES THIS PINS (2026-09-26/27, all still read 'live' hours after their last play, the payload
byte-for-byte the one before): British Championship Basketball's Plymouth Raiders 58-84 Bristol
Hurricanes, NBL Division One's London Elite 79-63 Greenwich Titans, Czech 1. liga's Slavia Tygři
Praha 96-80 Slavoj BK Litoměřice. Re-fetching each changed nothing, because nothing upstream had:
the scorer never sent the pbp's closing action, so _status() (fiba_livestats.py, correctly) never
called them final, and with no finalise-game call the games sat LIVE - Q4 / End Q4 for good."""
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_ingest as RI  # noqa: E402

NOW = datetime(2026, 9, 28, 12, 0, 0, tzinfo=timezone.utc)
fails = 0


def ok(what, cond):
    global fails
    if not cond:
        fails += 1
        print("  FAIL ", what)


def iso(delta_s):
    return (NOW + timedelta(seconds=delta_s)).isoformat().replace("+00:00", "Z")


def raw(period=4, clock="0:00", period_type="REGULAR"):
    return {"period": period, "periodType": period_type, "clock": clock}


# ---- the three real games, long after their last play --------------------------
ok("BCB's Plymouth Raiders 58-84 Bristol Hurricanes: Q4, 0:00, tipped off a day ago",
   RI.feed_abandoned(raw(), iso(-26 * 3600), NOW))
ok("NBL Division One's London Elite 79-63 Greenwich Titans: same shape",
   RI.feed_abandoned(raw(), iso(-30 * 3600), NOW))
ok("an overtime game abandoned the same way (period counts from 1 in OT, not 5)",
   RI.feed_abandoned(raw(period=2, period_type="OVERTIME"), iso(-20 * 3600), NOW))

# ---- what must never be closed early --------------------------------------------
ok("mid-game at a quarter break is not abandoned (2 h after tip, Q1 0:00)",
   not RI.feed_abandoned(raw(period=1), iso(-2 * 3600), NOW))
ok("the clock still running is not abandoned", not RI.feed_abandoned(raw(clock="3:45"), iso(-26 * 3600), NOW))
ok("no clock in the payload is not abandoned (nothing to read)", not RI.feed_abandoned({}, iso(-26 * 3600), NOW))
ok("just past tip-off, Q4 0:00 (an 8-minute blowout, not abandoned)", not RI.feed_abandoned(raw(), iso(-600), NOW))
ok("no tip-off known is not abandoned (nothing to measure the silence against)",
   not RI.feed_abandoned(raw(), None, NOW))

# ---- the boundary is LIVE_STALE, the live lane's own cut-off for giving up ------
ok("exactly at LIVE_STALE the game is abandoned", RI.feed_abandoned(raw(), iso(-RI.LIVE_STALE), NOW))
ok("one second short of it, not yet", not RI.feed_abandoned(raw(), iso(-RI.LIVE_STALE + 1), NOW))

if fails:
    print(f"\n{fails} failed")
    sys.exit(1)
print("feed abandoned: a live game whose feed never says so is closed on the clock's word, "
      "and only once nobody could still be playing it")
