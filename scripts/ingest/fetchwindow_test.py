"""A fixture that has not tipped off is not requested: python scripts/ingest/fetchwindow_test.py"""
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetchwindow import FETCH_LEAD_S, seconds_until_tip, worth_fetching  # noqa: E402

NOW = datetime(2026, 9, 18, 12, 0, 0, tzinfo=timezone.utc)
fails = 0


def ok(what, cond):
    global fails
    if not cond:
        fails += 1
        print("  FAIL ", what)


def iso(delta_s):
    return (NOW + timedelta(seconds=delta_s)).isoformat().replace("+00:00", "Z")


# ---- what this exists to stop: a season of fixtures asked about every half hour ----
ok("a game three weeks away is left alone", not worth_fetching(iso(21 * 86400), NOW))
ok("a game tomorrow is left alone", not worth_fetching(iso(86400), NOW))
ok("a game in two hours is left alone", not worth_fetching(iso(2 * 3600), NOW))

# ---- and what must never be missed --------------------------------------------
ok("a game inside the lead is fetched", worth_fetching(iso(FETCH_LEAD_S - 60), NOW))
ok("a game exactly at the lead is fetched", worth_fetching(iso(FETCH_LEAD_S), NOW))
ok("a game tipping now is fetched", worth_fetching(iso(0), NOW))
ok("a game that tipped an hour ago is fetched", worth_fetching(iso(-3600), NOW))
ok("last week's unfinished game is still fetched", worth_fetching(iso(-7 * 86400), NOW))

# ---- fail open: a request wasted beats a game missed ---------------------------
ok("no tip-off time is fetched", worth_fetching(None, NOW))
ok("an empty tip-off is fetched", worth_fetching("", NOW))
ok("an unreadable tip-off is fetched", worth_fetching("not a date", NOW))
ok("a non-string tip-off is fetched", worth_fetching(12345, NOW))

# ---- the timestamp spellings the schedules actually carry ----------------------
ok("a 'Z' timestamp parses", seconds_until_tip("2026-09-18T13:00:00Z", NOW) == 3600)
ok("an offset timestamp parses",
   seconds_until_tip("2026-09-18T14:00:00+01:00", NOW) == 3600)
ok("a bare timestamp is read as UTC",
   seconds_until_tip("2026-09-18T13:00:00", NOW) == 3600)
ok("an offset game that evening is left alone",
   not worth_fetching("2026-09-18T20:00:00+01:00", NOW))
ok("an offset game just starting is fetched",
   worth_fetching("2026-09-18T13:00:00+01:00", NOW))

# ---- the live lane must never be the first to notice a game -------------------
# run_ingest's LIVE_BEFORE_TIP is 20 minutes; discovery has to be at least as early
# or a game would be polled by the live lane before discovery had ever fetched it.
ok("discovery leads the live lane", FETCH_LEAD_S >= 20 * 60)

# ---- a bare now (no argument) still answers -----------------------------------
ok("a real 'now' works for a past game", worth_fetching("2020-01-01T00:00:00Z"))
ok("a real 'now' works for a far future game", not worth_fetching("2099-01-01T00:00:00Z"))

if fails:
    print(f"\n{fails} failed")
    sys.exit(1)
print("fetch window: fixtures that have not tipped off are not requested; "
      "live, played and undated games still are")
