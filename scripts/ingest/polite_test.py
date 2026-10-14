"""polite.py, offline: a fake clock, a fake site, no network.

    python scripts/ingest/polite_test.py

What it holds the layer to: one pace per site for the whole process (whichever object asks), our own
services never paced, a 429's Retry-After obeyed by everybody asking that site, a site that gives no
Retry-After backed off 2, 4, 8 s, a backfill waiting a cool-down out while the live lane is answered
at once with a 429 of its own and nothing is sent, and the switch that leaves requests alone.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests  # noqa: E402
import polite as P  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  PASS  " + what)
    else:
        FAIL += 1; print("  FAIL  " + what + ("" if saw is None else f"  -- saw {saw!r}"))


class Clock:
    def __init__(self):
        self.t = 1000.0
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(round(s, 3)); self.t += s


def reset():
    c = Clock()
    P._now, P._sleep, P._log = c.now, c.sleep, (lambda *_: None)
    P._next.clear(); P._cool.clear(); P._said.clear(); P.STATS.clear()
    P.configure(patient=True)
    return c


def resp(code, **headers):
    r = requests.Response(); r.status_code = code; r._content = b"{}"; r.headers.update(headers)
    return r


class Site:
    """answers a scripted list of statuses, and remembers when each request arrived"""
    def __init__(self, clock, answers):
        self.clock, self.answers, self.at = clock, list(answers), []

    def __call__(self, session, method, url, *a, **k):
        self.at.append(round(self.clock.t, 3))
        a_ = self.answers.pop(0) if self.answers else 200
        return a_ if isinstance(a_, requests.Response) else resp(a_)


EL = "https://live.euroleague.net/api/Boxscore?gamecode=35&seasoncode=U2026"

print("\n-- one pace per site")
c = reset(); site = Site(c, [])
for _ in range(3):
    P.polite_request(site, None, "GET", EL)
ok("three requests to live.euroleague.net, 0.75 s apart (its floor), not all at once",
   [round(b - a, 3) for a, b in zip(site.at, site.at[1:])] == [0.75, 0.75], site.at)
c = reset(); site = Site(c, [])
P.polite_request(site, None, "GET", "https://example.org/a")
P.polite_request(site, None, "GET", "https://other.example.net/b")
ok("two different sites do not wait for each other", site.at[1] == site.at[0], site.at)
c = reset(); site = Site(c, [])
P.polite_request(site, None, "GET", "https://hhvofgqqadtyvcjudhjx.supabase.co/rest/v1/games")
P.polite_request(site, None, "GET", "https://hhvofgqqadtyvcjudhjx.supabase.co/rest/v1/games")
P.polite_request(site, None, "POST", "https://api.github.com/repos/x/y/dispatches")
ok("our own database and GitHub are never paced or counted", c.slept == [] and P.STATS == {}, (c.slept, P.STATS))
ok("the floor: the CDN short, a schedule host long, anything else the default",
   (P.gap_for("fibalivestats.dcd.shared.geniussports.com"), P.gap_for("hosted.wh.geniussports.com"), P.gap_for("www.lnb.fr"))
   == (0.1, 1.0, P.DEFAULT_GAP_S))

print("\n-- a site that says stop")
c = reset(); site = Site(c, [resp(429, **{"Retry-After": "85"}), 200])
r = P.polite_request(site, None, "GET", EL)
ok("a backfill: told 429 Retry-After 85, it waits the 85 s and asks once more - and gets its answer",
   r.status_code == 200 and len(site.at) == 2 and site.at[1] - site.at[0] >= 85, site.at)
c = reset(); site = Site(c, [resp(429, **{"Retry-After": "85"})])
P.configure(patient=False)
r = P.polite_request(site, None, "GET", EL)
ok("the live lane: the 429 comes straight back (no 85 s sleep holding every other league)",
   r.status_code == 429 and len(site.at) == 1 and sum(c.slept) < 1, (r.status_code, site.at, c.slept))
r2 = P.polite_request(site, None, "GET", EL.replace("35", "46"))
ok("...and the next game on that site is NOT sent while it cools down: a 429 of our own, at once",
   r2.status_code == 429 and len(site.at) == 1 and "cooling down" in r2.reason, (r2.status_code, r2.reason, site.at))
ok("...which says how long is left", int(r2.headers["Retry-After"]) >= 80)
try:
    r2.raise_for_status(); raised = False
except requests.HTTPError as exc:
    raised = "429" in str(exc)
ok("...and raises like a real 429, so the adapter skips the game for this pass", raised)
P.polite_request(site, None, "GET", "https://www.lnb.fr/x")
ok("other sites carry on meanwhile", len(site.at) == 2)
c.t += 90
r3 = P.polite_request(site, None, "GET", EL)
ok("once the cool-down is over the site is asked again", r3.status_code == 200 and len(site.at) == 3)

c = reset(); site = Site(c, [503, 503, 503, 200])
r = P.polite_request(site, None, "GET", "https://example.org/feed")
gaps = [round(b - a) for a, b in zip(site.at, site.at[1:])]
ok("no Retry-After: backed off about 2, 4, 8 s, then the answer", r.status_code == 200 and len(site.at) == 4
   and 2 <= gaps[0] <= 3 and 4 <= gaps[1] <= 5 and 8 <= gaps[2] <= 10, gaps)
c = reset(); site = Site(c, [429, 429, 429, 429, 429])
r = P.polite_request(site, None, "GET", "https://example.org/feed")
ok("a site that keeps saying stop is asked at most four times, then its 429 is returned", r.status_code == 429 and len(site.at) == 4)
c = reset(); site = Site(c, [429, 200])
r = P.polite_request(site, None, "POST", "https://example.org/form")
ok("a POST is never repeated: its 429 goes back as it is", r.status_code == 429 and len(site.at) == 1)
c = reset()
ok("Retry-After as an HTTP date is read too", 0 < (P.retry_after(resp(429, **{"Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT"})) or 0))
ok("no Retry-After is None", P.retry_after(resp(429)) is None)

print("\n-- EuroLeague and EuroCup: the shot chart only when there is a new shot")
from adapters.euroleague import EuroLeagueAdapter  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
FibaLiveStatsAdapter._pipeline = False; FibaLiveStatsAdapter._pipeline_warned = True


def side(name, fga2):
    return {"Team": name, "PlayersStats": [
        {"Player_ID": name + "1", "Player": "DOE, JOHN", "Dorsal": "1", "IsStarter": 1, "Minutes": "10:00",
         "Points": 2 * fga2, "FieldGoalsAttempted2": fga2, "FieldGoalsMade2": fga2}]}


class Feed(EuroLeagueAdapter):
    def __init__(self):
        self.asked, self.fga = [], 3

    def _json(self, url):
        feed = url.split("/api/")[1].split("?")[0]
        self.asked.append(feed)
        if feed == "Boxscore":
            return {"Stats": [side("AAA", self.fga), side("BBB", 2)]}
        return {}


EuroLeagueAdapter._points_seen.clear()
f = Feed()
live = {"_live": True}
f.fetch("U2026_35", live); f.fetch("U2026_35", live)
ok("live: the second poll with no new shot asks Boxscore and PlayByPlay only",
   f.asked == ["Boxscore", "PlayByPlay", "Points", "Boxscore", "PlayByPlay"], f.asked)
f.asked.clear(); f.fga = 4
f.fetch("U2026_35", live)
ok("...a new shot, and the Points feed is asked again", f.asked == ["Boxscore", "PlayByPlay", "Points"], f.asked)
f.asked.clear()
f.fetch("U2026_35", dict(live, _fresh=True))
ok("...a fresh read (the stall rule's) always asks all three", f.asked == ["Boxscore", "PlayByPlay", "Points"], f.asked)
f.asked.clear()
f.fetch("U2026_36", {}); f.fetch("U2026_36", {})
ok("outside the live lane (a backfill, discovery): all three every time",
   f.asked.count("Points") == 2 and "U2026_36" not in EuroLeagueAdapter._points_seen, f.asked)

print("\n-- the layer under requests")
calls = []
real = requests.sessions.Session.request
os.environ["EPINOIA_POLITE"] = "0"
ok("EPINOIA_POLITE=0 leaves requests alone", P.install() is False and requests.sessions.Session.request is real)
os.environ.pop("EPINOIA_POLITE")
ok("install() puts it under Session.request (requests.get goes through it), once",
   P.install() is True and getattr(requests.sessions.Session.request, "_polite", False) and P.install() is True)
requests.sessions.Session.request = real; P.STATE["installed"] = False

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
