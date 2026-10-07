"""A fixture's broadcast found on its league's channel (auto_video.find_on_channel), offline:

    python scripts/ingest/auto_video_test.py

What it holds it to, from FIBA's channel as it was on 2026-10-07 - when not one of the day's eleven FIBA Europe Cup
streams was attached to its game:
  * a title in segments ("LIVE - A v B | FIBA Europe Cup 2026-27 | Regular Season") gives the two clubs alone, without
    the competition stuck to the away side or "LIVE -" to the home one; the older shapes are read as before;
  * a stream published a week ahead (FIBA schedules them the Thursday before) is found by its own scheduled start,
    or its real one, when that is the fixture's tip;
  * the same two clubs' other meeting (the return leg, a stream set for another day) is not taken;
  * a title with a date of its own is still judged by it, not by YouTube's schedule.
"""
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import auto_video as A  # noqa: E402

n = {"ok": 0, "bad": 0}


def ok(what, cond, saw=None):
    print(("  PASS  " if cond else "  FAIL  ") + what + ("" if cond or saw is None else "  -- saw " + repr(saw)[:400]))
    n["ok" if cond else "bad"] += 1


FIBA = "UCtInrnU3QbWqFGsdKT1GZtg"
TIP = datetime(2026, 10, 7, 18, 0, tzinfo=timezone.utc)
FEED = [
    {"video_id": "fZ7i53g-FOY", "published": "2026-10-01T14:43:00+00:00",
     "title": "LIVE - Elan Chalon v Manchester Basketball | FIBA Europe Cup 2026-27 | Regular Season"},
    {"video_id": "RETURNLEG01", "published": "2026-11-26T14:44:00+00:00",
     "title": "LIVE - Manchester Basketball v Elan Chalon | FIBA Europe Cup 2026-27 | Regular Season"},
    {"video_id": "6r-vyXK4-E4", "published": "2026-10-01T14:42:00+00:00",
     "title": "LIVE - VEF Riga v Lokomotiv Plovdiv | FIBA Europe Cup 2026-27 | Regular Season"},
    {"video_id": "kb2W7Z98n2E", "published": "2026-10-01T14:42:00+00:00",
     "title": "Regular Season | LANDAU Lions v Lions de Geneve | Full Basketball Game | FIBA Europe Cup 2026-27"},
    {"video_id": "ryqtD0QMOgk", "published": "2026-10-01T14:43:00+00:00",
     "title": "LIVE -CSM CSU Raiffeisen Oradea v Fribourg Olympic Basket | FIBA Europe Cup 2026-27 | Regular Season"},
]
WATCH = {
    "fZ7i53g-FOY": {"scheduled_at": "2026-10-07T18:00:00+00:00", "started_at": None},
    "RETURNLEG01": {"scheduled_at": "2026-12-02T19:30:00+00:00", "started_at": None},
    "6r-vyXK4-E4": {"scheduled_at": None, "started_at": "2026-10-07T15:50:08+00:00"},
    "kb2W7Z98n2E": {"scheduled_at": None, "started_at": "2026-10-07T14:52:00+00:00"},
    "ryqtD0QMOgk": {"scheduled_at": None, "started_at": "2026-10-07T15:48:00+00:00"},
}
asked = []
A.channel_videos = lambda ch: FEED if ch == FIBA else []


def _watch(vid):
    asked.append(vid)
    d = {"live": True, "started_at": None, "scheduled_at": None, "ended_at": None, "duration_s": 0, "title": None,
         "upcoming": False, "channel": FIBA}
    d.update(WATCH.get(vid, {}))
    return d


A.watch_details = _watch

print("-- the two clubs, out of a title in segments")
ok("FIBA's live title: the clubs alone", A._sides(FEED[0]["title"]) == ("Elan Chalon", "Manchester Basketball"), A._sides(FEED[0]["title"]))
ok("...'LIVE -' with no space after it", A._sides(FEED[4]["title"]) == ("CSM CSU Raiffeisen Oradea", "Fribourg Olympic Basket"), A._sides(FEED[4]["title"]))
ok("...the round first, the clubs in the middle", A._sides(FEED[3]["title"]) == ("LANDAU Lions", "Lions de Geneve"), A._sides(FEED[3]["title"]))
ok("the older shapes as before: 'A Vs B_06.09.26'", A._sides("Falkirk Fury Vs Edinburgh Kings_06.09.26") == ("Falkirk Fury", "Edinburgh Kings"))
ok("...'A vs B - 06.09.26'", A._sides("Falkirk Fury vs Edinburgh Kings - 06.09.26") == ("Falkirk Fury", "Edinburgh Kings"))
ok("...'A v B'", A._sides("Falkirk Fury v Edinburgh Kings") == ("Falkirk Fury", "Edinburgh Kings"))

print("\n-- a stream published a week ahead, found by its own start")
f = A.find_on_channel(FIBA, "Elan Chalon", "Manchester Basketball", TIP)
ok("Elan Chalon v Manchester: FIBA's stream for tonight", f and f["video_id"] == "fZ7i53g-FOY" and f["channel"] == FIBA, f)
f = A.find_on_channel(FIBA, "Manchester Basketball", "Elan Chalon", datetime(2026, 12, 2, 19, 30, tzinfo=timezone.utc))
ok("...the return leg in December: the December stream, not tonight's", f and f["video_id"] == "RETURNLEG01", f)
f = A.find_on_channel(FIBA, "VEF Riga", "Lokomotiv Plovdiv", datetime(2026, 10, 7, 16, 0, tzinfo=timezone.utc))
ok("a stream already on: by its real start", f and f["video_id"] == "6r-vyXK4-E4", f)
f = A.find_on_channel(FIBA, "LANDAU Lions", "Lions de Geneve", datetime(2026, 10, 7, 15, 0, tzinfo=timezone.utc))
ok("a finished one, renamed 'Full Basketball Game'", f and f["video_id"] == "kb2W7Z98n2E", f)

print("\n-- what is not taken")
f = A.find_on_channel(FIBA, "Elan Chalon", "Manchester Basketball", datetime(2026, 10, 14, 18, 0, tzinfo=timezone.utc))
ok("the same clubs a week later: tonight's stream is not theirs", f is None, f)
f = A.find_on_channel(FIBA, "Bakken Bears", "SL Benfica", TIP)
ok("a fixture the channel has no stream for: nothing", f is None, f)
asked.clear()
A.find_on_channel(FIBA, "Bakken Bears", "SL Benfica", TIP)
ok("...and YouTube is not asked about streams of other clubs", asked == [], asked)
s = A.score_title("Elan Chalon v Manchester Basketball 30.09.26", "Elan Chalon", "Manchester Basketball", TIP, "2026-10-01T14:43:00+00:00")
ok("a title dated another day is still judged by its date", s < 1.6, s)

print(f"\n{n['ok']} passed, {n['bad']} failed")
sys.exit(1 if n["bad"] else 0)
