"""POLITE TO EVERY SITE WE READ (2026-10-14).

Every adapter asks its site through the `requests` library, and each kept its own gap between
requests - per adapter OBJECT. Two objects reading one site (EuroLeague and EuroCup are one host,
live.euroleague.net), a thread pool, or a second process on the same machine (a backfill audit
beside the live lane) never saw each other's gaps, and nothing anywhere listened when a site said
stop. On 14 Oct 2026 the EuroCup's live games came back "429 Too Many Requests" for a whole round:
Cloudflare in front of the EuroLeague's API had had enough, said so with Retry-After: 85, and the
lane asked again fifteen seconds later, and again, every game, every pass.

install() puts one layer under every request the ingest makes (requests.Session.request, which
requests.get goes through too), so no adapter has to remember any of this:

  * ONE PACE PER SITE, for the whole process: requests to one host are spaced by its gap (HOST_GAP_S,
    DEFAULT_GAP_S otherwise), whichever adapter, object or thread is asking. An adapter's own longer
    gap (NKL's robots.txt Crawl-delay: 10, Liga Ouro's 3 s) still applies on top; this is the floor.
  * A SITE THAT SAYS STOP IS LISTENED TO. 429 or 503 starts a cool-down for that host - Retry-After
    when the site gives one, else 2, 4, 8, 16 s - and every request to it waits it out together,
    instead of each thread hammering the door in turn.
  * WHO MAY WAIT. A backfill, a discovery pass, an audit: patient (the default) - it waits the
    cool-down out (up to MAX_PATIENT_WAIT_S) and asks again. The live lane is not: one site cooling
    down must not hold every other league's live game back, so in the lane (configure(patient=False))
    a request to a host still cooling down for more than SHORT_WAIT_S is answered here, at once,
    with a 429 of our own - NOTHING IS SENT to the site - and the game is simply read on the next
    pass after the cool-down. The adapters already treat a 429 as "not this pass".
  * OUR OWN SERVICES ARE NOT PACED: the database and storage (*.supabase.co), GitHub, this machine.

Kill switch: EPINOIA_POLITE=0 leaves requests exactly as it was.
"""
from __future__ import annotations

import os
import random
import threading
import time
from email.utils import parsedate_to_datetime
from typing import Callable, Dict, Optional
from urllib.parse import urlsplit

import requests

DEFAULT_GAP_S = 0.5
#: a host's floor, where it is not the default. Longest suffix wins ("x.y.com" before "y.com").
HOST_GAP_S: Dict[str, float] = {
    # Cloudflare in front of the EuroLeague's live API (EuroLeague and EuroCup both): 429 with
    # Retry-After 85 on 14 Oct 2026. 0.75 s still reads six live games x three feeds in 14 s.
    "live.euroleague.net": 0.75,
    "feeds.incrowdsports.com": 1.0,
    # FIBA LiveStats' CloudFront CDN: the live observer's conditional GETs (mostly empty 304s), up to
    # forty games on a Saturday - a CDN built for exactly this, so a short floor keeps every game seen
    "fibalivestats.dcd.shared.geniussports.com": 0.1,
    # the Genius hosted pages (schedules, competition lists): somebody's web server, not a CDN
    "hosted.wh.geniussports.com": 1.0,
}
#: our own services - the database and storage, GitHub, this machine: a host is exempt when it is one of these
#: or ends in ".<one of these>"
EXEMPT = ("supabase.co", "supabase.in", "github.com", "githubusercontent.com", "localhost", "127.0.0.1", "::1")
RETRY_STATUS = (429, 503)
RETRIES = 3
SHORT_WAIT_S = 5.0            # the longest the live lane sleeps for one host
MAX_PATIENT_WAIT_S = 300.0    # the longest anything sleeps for one host (a Retry-After beyond is capped)
BACKOFF_MAX_S = 60.0

_lock = threading.Lock()
_next: Dict[str, float] = {}      # host -> the earliest moment its next request may go
_cool: Dict[str, float] = {}      # host -> cooling down until
_said: Dict[str, float] = {}      # host -> the cool-down last reported (one line per cool-down, not per request)
STATS: Dict[str, Dict[str, float]] = {}
STATE = {"patient": True, "installed": False}

# the clock and the sleep, swapped by the test
_now: Callable[[], float] = time.monotonic
_sleep: Callable[[float], None] = time.sleep
_log: Callable[[str], None] = print


def configure(patient: Optional[bool] = None) -> None:
    if patient is not None:
        STATE["patient"] = bool(patient)


def host_of(url: str) -> str:
    try:
        return (urlsplit(str(url)).hostname or "").lower()
    except ValueError:
        return ""


def exempt(host: str) -> bool:
    return not host or any(host == s or host.endswith("." + s) for s in EXEMPT)


def gap_for(host: str) -> float:
    best, n = DEFAULT_GAP_S, -1
    for k, v in HOST_GAP_S.items():
        if (host == k or host.endswith("." + k)) and len(k) > n:
            best, n = v, len(k)
    return best


def _stat(host: str, key: str, by: float = 1) -> None:
    with _lock:
        s = STATS.setdefault(host, {"requests": 0, "refused": 0, "told_to_wait": 0, "waited_s": 0.0})
        s[key] = s.get(key, 0) + by


def retry_after(resp) -> Optional[float]:
    """Retry-After in seconds: a number, or an HTTP date. None when the site gave none."""
    v = (getattr(resp, "headers", None) or {}).get("Retry-After")
    if not v:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        pass
    try:
        d = parsedate_to_datetime(v)
        return max(0.0, d.timestamp() - time.time())
    except (TypeError, ValueError):
        return None


def _refusal(url: str, left: float):
    """The 429 the live lane gets for a host still cooling down - made here, nothing sent to the site."""
    r = requests.Response()
    r.status_code = 429
    r.url = str(url)
    r.reason = f"Too Many Requests (cooling down, {left:.0f} s left)"
    r.headers["Retry-After"] = str(int(left) + 1)
    r._content = b""
    return r


def _wait_turn(host: str) -> None:
    with _lock:
        now = _now()
        at = max(now, _next.get(host, 0.0))
        _next[host] = at + gap_for(host)
    if at > now:
        _sleep(at - now)
        _stat(host, "waited_s", at - now)


def _cooling(host: str) -> float:
    with _lock:
        return _cool.get(host, 0.0) - _now()


def _start_cool(host: str, wait: float) -> None:
    with _lock:
        _cool[host] = max(_cool.get(host, 0.0), _now() + wait)


def polite_request(orig, session, method, url, *args, **kwargs):
    host = host_of(url)
    if exempt(host):
        return orig(session, method, url, *args, **kwargs)
    idempotent = str(method).upper() in ("GET", "HEAD", "OPTIONS")
    attempt = 0
    while True:
        left = _cooling(host)
        if left > 0:
            patient = STATE["patient"]
            if left <= SHORT_WAIT_S or (patient and left <= MAX_PATIENT_WAIT_S):
                _sleep(left)
                _stat(host, "waited_s", left)
            elif patient:                                 # a Retry-After beyond the cap: wait the cap, then ask
                _sleep(MAX_PATIENT_WAIT_S)
                _stat(host, "waited_s", MAX_PATIENT_WAIT_S)
            else:
                _stat(host, "refused")
                return _refusal(url, left)
        _wait_turn(host)
        _stat(host, "requests")
        resp = orig(session, method, url, *args, **kwargs)
        if resp.status_code not in RETRY_STATUS or not idempotent:
            return resp
        _stat(host, "told_to_wait")
        given = retry_after(resp)
        wait = given if given is not None else min(BACKOFF_MAX_S, 2.0 ** (attempt + 1)) * (1 + random.random() * 0.25)
        _start_cool(host, wait)
        with _lock:
            first = _said.get(host, 0.0) < _now() - wait
            if first:
                _said[host] = _now()
        if first:
            _log(f"   (polite: {host} answered {resp.status_code} - nothing more is asked of it for {wait:.0f} s"
                 + (", as it said" if given is not None else "") + ")")
        attempt += 1
        if attempt > RETRIES or (not STATE["patient"] and wait > SHORT_WAIT_S):
            return resp
        # round again: the cool-down at the top decides whether to wait it out or give up


def install() -> bool:
    """Put the layer under requests, once per process. False when switched off (EPINOIA_POLITE=0)."""
    if os.environ.get("EPINOIA_POLITE", "") == "0":
        return False
    with _lock:
        if STATE["installed"]:
            return True
        orig = requests.sessions.Session.request

        def request(self, method, url, *args, **kwargs):
            return polite_request(orig, self, method, url, *args, **kwargs)

        request._polite = True                      # noqa: SLF001
        requests.sessions.Session.request = request
        STATE["installed"] = True
    return True


def summary() -> str:
    """One line per site that was paced, waited for, or refused - for the end of a pass."""
    rows = []
    for h, s in sorted(STATS.items(), key=lambda kv: -kv[1].get("requests", 0)):
        if s.get("told_to_wait") or s.get("refused"):
            rows.append(f"{h}: {int(s['requests'])} asked, told to wait {int(s['told_to_wait'])}x, "
                        f"{int(s['refused'])} not sent while it cooled down, {s['waited_s']:.0f} s waited")
    return "; ".join(rows)
