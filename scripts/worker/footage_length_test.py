"""The AI worker's footage-length gate, offline:

    python scripts/worker/footage_length_test.py            (add --live to also ask YouTube about one real stream)

A game's primary video is sometimes its highlights, a press conference or a stream that died early, and the
worker used to download and read every one for an hour. Now it asks the video's length first (metadata only)
and sets it against the game's playing time from the game's own log. What this holds it to:
  * playing time from the log: FIBA 4 x 10, overtimes, a college 2 x 20, an 8-minute youth quarter, no log;
  * the rule: under MIN_FOOTAGE_FRAC of the playing time is too short; an unknown length never is;
  * a job on too-short footage fails with the reason BEFORE anything is downloaded, carrying result.too_short;
  * the hourly sweep never offers that footage again, while a new video for the same game is offered;
  * the probe reads yt-dlp's metadata and says nothing for a live or upcoming stream.
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ai_worker as W  # noqa: E402
import tempfile  # noqa: E402

# never into the real worker.log beside the worker's config: these jobs are made up
W.LOG_PATH = os.path.join(tempfile.mkdtemp(), "worker.log")

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def log_of(periods, ot=(), reg=10, otl=5, pmax=4):
    acts = [{"period": p, "periodType": "REGULAR"} for p in periods] + [{"period": p, "periodType": "OVERTIME"} for p in ot]
    return {"periodLengthREGULAR": reg, "periodLengthOVERTIME": otl, "periodsMax": pmax, "pbp": acts}


print("playing time from the game's own log")
ok("FIBA 4 x 10: 40 min", W.playing_s(log_of([1, 2, 3, 4])) == 2400, W.playing_s(log_of([1, 2, 3, 4])))
ok("one overtime: 45 min", W.playing_s(log_of([1, 2, 3, 4], ot=[5])) == 2700)
ok("two overtimes: 50 min", W.playing_s(log_of([1, 2, 3, 4], ot=[5, 6])) == 3000)
ok("a college game, 2 x 20: 40 min", W.playing_s(log_of([1, 2], reg=20, pmax=2)) == 2400)
ok("an 8-minute youth quarter: 32 min", W.playing_s(log_of([1, 2, 3, 4], reg=8)) == 1920)
ok("overtimes numbered past the regular periods with no periodType still count",
   W.playing_s({"periodsMax": 4, "periodLengthREGULAR": 10, "periodLengthOVERTIME": 5,
                "pbp": [{"period": p} for p in (1, 2, 3, 4, 5)]}) == 2700)
ok("no log: four ten-minute quarters", W.playing_s(None) == 2400)

print("the rule")
cfg = dict(W.DEFAULTS)
g40 = log_of([1, 2, 3, 4])
for secs, want, what in ((300, True, "a 5-minute highlights reel"), (900, True, "a 15-minute press conference"),
                         (2400, True, "40 minutes of footage for a 40-minute game"),
                         (3000, False, "50 minutes (the floor is 1.25 x 40 = 50)"),
                         (8395, False, "the real Manchester v Liverpool stream (2 h 20)"),
                         (None, False, "a length nobody could say"), (0, False, "a zero length")):
    short, why, need = W.footage_too_short(secs, g40, cfg)
    ok("%s: %s" % (what, "too short" if want else "kept"), short is want, (secs, short, why))
short, why, _ = W.footage_too_short(300, g40, cfg)
ok("the reason says how long the video is and how long the game is", "5 min" in why and "40 min" in why, why)
ok("the floor is the config's when it names one", W.footage_too_short(2900, g40, dict(cfg, min_footage_frac=1.0))[0] is False)

print("the probe")
calls = []


def fake_run(meta):
    def run(cmd, **kw):
        calls.append(cmd)
        import json
        return types.SimpleNamespace(stdout=json.dumps(meta), returncode=0)
    return run


real_run = W.subprocess.run
W.subprocess.run = fake_run({"duration": 312, "live_status": "not_live"})
ok("a YouTube video's length from its metadata", W.probe_duration_s("https://youtu.be/abcdefghijk", cfg) == (312, "not_live"))
ok("...asked without downloading it", "--skip-download" in calls[-1] and "-J" in calls[-1], calls[-1])
W.subprocess.run = fake_run({"live_status": "is_live"})
ok("a stream still live has no length", W.probe_duration_s("https://www.youtube.com/watch?v=abcdefghijk", cfg)[0] is None)
W.subprocess.run = fake_run({"live_status": "is_upcoming", "duration": 0})
ok("an upcoming stream has no length", W.probe_duration_s("https://www.youtube.com/watch?v=abcdefghijk", cfg)[0] is None)
ok("not a YouTube address: nothing asked", W.probe_duration_s("https://example.com/game.mp4", cfg)[0] is None)
W.subprocess.run = real_run

print("a job on too-short footage")


class FakeDB(object):
    def __init__(self):
        self.patches, self.url, self.h = [], "https://db.invalid", {}

    def patch(self, table, query, body):
        self.patches.append((table, query, body))
        return [{"cancel_requested": False, "status": "running"}]

    def select(self, table, query):
        return []

    def rpc(self, fn, body=None):
        return None


fetched = []
W.fetch_video = lambda url, cfg_, progress: fetched.append(url) or "/nowhere.mp4"
W.pbp_for_game = lambda db, gid: g40
W.probe_duration_s = lambda url, cfg_: (300, "not_live")
W.open_dashboard = lambda cfg_: None
W.heartbeat = lambda *a, **k: None
db = FakeDB()
job = W.Job(db, {"id": "job-1", "game_id": "game-1", "video_url": "https://www.youtube.com/watch?v=abcdefghijk"}, cfg)
done = job.run()
last = db.patches[-1][2]
ok("it does not download anything", fetched == [], fetched)
ok("it fails with the reason", done is False and last.get("status") == "failed" and str(last.get("error", "")).startswith("too short:"), last)
ok("...and carries result.too_short for the sweep", last.get("result", {}).get("too_short") == {"video_s": 300, "playing_s": 2400}, last.get("result"))
ok("...and says so on the dashboard", last.get("progress", {}).get("stage") == "skipped: too short", last.get("progress"))

W.probe_duration_s = lambda url, cfg_: (8395, "was_live")
W.fetch_video = lambda url, cfg_, progress: fetched.append(url) or (_ for _ in ()).throw(KeyboardInterrupt("stop here"))
db2 = FakeDB()
W.Job(db2, {"id": "job-2", "game_id": "game-2", "video_url": "https://www.youtube.com/watch?v=lBeGBg_Nc6M"}, cfg).run()
ok("a full-length stream goes on to the download", fetched == ["https://www.youtube.com/watch?v=lBeGBg_Nc6M"], fetched)

print("the hourly sweep")


class SweepDB(FakeDB):
    def __init__(self, videos, jobs):
        FakeDB.__init__(self)
        self.videos, self.jobs = videos, jobs

    def select(self, table, query):
        return self.videos if table == "game_videos" else self.jobs


posted = []
real_post = W.requests.post
W.requests.post = lambda url, headers=None, json=None, timeout=None: posted.append(json) or types.SimpleNamespace(raise_for_status=lambda: None)
W._last_backfill = 0
videos = [{"game_id": "g-short", "url": "https://youtu.be/AAAAAAAAAAA"}, {"game_id": "g-new", "url": "https://youtu.be/CCCCCCCCCCC"},
          {"game_id": "g-fresh", "url": "https://youtu.be/DDDDDDDDDDD"}]
jobs = [{"game_id": "g-short", "status": "failed", "video_url": "https://youtu.be/AAAAAAAAAAA", "short": {"video_s": 300}},
        # the same game's OLD footage was too short; a new video is new footage
        {"game_id": "g-new", "status": "failed", "video_url": "https://youtu.be/BBBBBBBBBBB", "short": {"video_s": 300}}]
W.backfill(SweepDB(videos, jobs), dict(cfg, backfill=True))
W.requests.post = real_post
queued = sorted(p["game_id"] for p in posted)
ok("footage measured too short is never offered again", "g-short" not in queued, queued)
ok("a new video for a game whose old one was too short is offered", "g-new" in queued, queued)
ok("an untouched game is offered as before", "g-fresh" in queued, queued)

if "--live" in sys.argv:
    print("live: one real stream")
    import importlib
    importlib.reload(W)
    W.LOG_PATH = os.path.join(tempfile.mkdtemp(), "worker.log")
    secs, live = W.probe_duration_s("https://www.youtube.com/watch?v=lBeGBg_Nc6M", dict(W.DEFAULTS))
    ok("Manchester v Liverpool (SLB, 4 Oct): about 2 h 20 and kept", secs and secs > 8000 and not W.footage_too_short(secs, g40, dict(W.DEFAULTS))[0], (secs, live))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
