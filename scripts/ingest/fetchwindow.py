"""WHICH SCHEDULED GAMES ARE WORTH A REQUEST ON A DISCOVERY PASS.

A discovery pass used to ask the provider for every game on the schedule that
was not already final — which, at the start of a season, is the WHOLE season.
The feed has nothing to give for a game that has not tipped off: FIBA LiveStats
answers 403 until the scoresheet is opened, and the other providers 404. So the
run spent its time collecting refusals:

    173 on schedule, 173 to (re)fetch
    done in 156.8s - seen 173, fetched 0, written 0

That is 173 requests to one provider, every half hour, for one competition, all
of them answered "not yet". With every league of a full season behind them the
same pass would have made thousands, and the politeness gap between requests
(0.3-0.5 s) turns that straight into wall-clock time.

THE SCHEDULE ITSELF IS NOT WHAT IS SKIPPED. Dates, venues, clubs and crests are
read from the schedule page and written for every game discovered, tipped off or
not — that is a different loop, and a fixture appears on the site the moment the
league publishes it. This only decides which games are worth asking the game
feed about.

THE LEAD IS DELIBERATELY WIDER THAN THE LIVE LANE'S. The live lane starts
polling 20 minutes before a listed tip-off; discovery starts 30. A game is
therefore always picked up by the half-hourly pass before the lane that watches
it, and a game that tips a little early is still caught.

FAIL OPEN, ALWAYS. A game with no listed tip-off, or one whose timestamp cannot
be read, is fetched. Missing a played game is a hole in the record; one wasted
request is not. --refresh keeps fetching everything, so backfills are unchanged.
"""
from __future__ import annotations

from datetime import datetime, timezone

# Begin asking the feed about a game this long before its listed tip-off.
FETCH_LEAD_S = 30 * 60


def seconds_until_tip(tipoff_at, now: datetime | None = None) -> float | None:
    """Seconds from `now` until the listed tip-off. None when it cannot be read.

    Accepts what the schedules actually carry: ISO strings with a 'Z', with an
    offset, or with no zone at all (read as UTC, which is how the rest of the
    ingest treats a bare timestamp)."""
    if not tipoff_at:
        return None
    try:
        t = datetime.fromisoformat(str(tipoff_at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (t - (now or datetime.now(timezone.utc))).total_seconds()


def worth_fetching(tipoff_at, now: datetime | None = None,
                   lead_s: float = FETCH_LEAD_S) -> bool:
    """Is there any point asking the feed about this game yet?

    True for a game that has tipped off, is about to, or does not say when it
    tips. False only when the schedule places it beyond the lead — the one case
    where the provider has nothing to send."""
    until = seconds_until_tip(tipoff_at, now)
    return True if until is None else until <= lead_s
