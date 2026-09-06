"""auto_video.py — find a fed game's broadcast and line it up, with nobody typing anything.

FIBA LiveStats carries no time of day for a play and no link to a broadcast (checked 2026-09-06:
data.json, bs.html, pbp.html and the webcast page hold neither). What the platform does have is
its OWN clock on every play (the ingest worker stamps each event with the moment its poll saw
it), and YouTube knows when a live stream actually began. Put together, a stream is anchored
with no human step at all.

TWO WAYS IN, NEITHER NEEDS A HUMAN:

  THE LEAGUE'S CHANNEL, NO KEY. A league that streams its games has a channel
  (adapter_config.youtube_channel — BCB: UCbx2AZS5az8q39mI_MB_RkA). YouTube publishes an RSS feed
  of a channel's newest fifteen videos (id, title, published), and every watch page carries the
  stream's real start and end (liveBroadcastDetails.startTimestamp / endTimestamp) in its own
  markup. Titles name both clubs and usually the date ("Loughborough Riders Vs Hemel Storm_06.09.26"),
  so the shared matcher's team scoring picks the game out.

  THE DATA API, WITH A KEY. A free read-only YouTube Data API key (repo secret YOUTUBE_API_KEY)
  reaches further back than fifteen videos and searches beyond one channel. Used when present,
  the channel feed is tried first either way because it is free and exact.

WHAT GETS WRITTEN. One game_videos row per game (never replacing one somebody attached):
  provider youtube, url, video_ref, is_live, stream_started_at (the stream's real start),
  tip_at (+ tip_wall: the first period_start's poll stamp, else that row's insert time).
  With both instants the page places every play; with only tip_at (a plain upload) the
  offset waits for a person or the scoreboard reader on the game page.
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from matching import team_score  # noqa: E402

API = "https://www.googleapis.com/youtube/v3"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
HDR = {"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI"}
_feed_cache: dict[str, tuple[float, list]] = {}
_watch_cache: dict[str, dict] = {}


# ------------------------------------------------------------------ the channel, no key
def channel_videos(channel_id: str) -> list[dict]:
    """The channel's newest fifteen videos from its RSS feed: [{video_id, title, published}]."""
    if not channel_id:
        return []
    hit = _feed_cache.get(channel_id)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    out = []
    try:
        r = requests.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}", headers=HDR, timeout=30)
        if r.status_code == 200:
            for e in re.findall(r"<entry>.*?</entry>", r.text, re.S):
                vid = re.search(r"<yt:videoId>([^<]+)", e); t = re.search(r"<title>([^<]+)", e); p = re.search(r"<published>([^<]+)", e)
                if vid and t:
                    out.append({"video_id": vid.group(1), "title": _unescape(t.group(1)), "published": p.group(1) if p else None})
    except Exception:
        pass
    _feed_cache[channel_id] = (time.time(), out)
    return out


def _unescape(s: str) -> str:
    return s.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")


def watch_details(video_id: str) -> dict:
    """What the watch page says about a video: {live, started_at, ended_at, duration_s, title}."""
    hit = _watch_cache.get(video_id)
    # a stream not yet started has no start time; ask again after five minutes, not never
    if hit and (hit[1].get("started_at") or time.time() - hit[0] < 300):
        return hit[1]
    d = {"live": False, "started_at": None, "ended_at": None, "duration_s": 0, "title": None}
    try:
        r = requests.get(f"https://www.youtube.com/watch?v={video_id}", headers=HDR, timeout=40)
        if r.status_code == 200:
            w = r.text
            g = lambda k: (re.search('"' + k + r'":"?([^",}]+)', w) or [None, None])[1]
            d["started_at"] = g("startTimestamp"); d["ended_at"] = g("endTimestamp")
            d["live"] = (g("isLiveContent") == "true") or bool(d["started_at"])
            try:
                d["duration_s"] = int(g("lengthSeconds") or 0)
            except ValueError:
                pass
            t = re.search(r'"title":"([^"]+)"', w)
            d["title"] = t.group(1) if t else None
    except Exception:
        pass
    _watch_cache[video_id] = (time.time(), d)
    return d


# ------------------------------------------------------------------ matching a title to a game
_DATE = re.compile(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})")


def _title_date(title: str):
    m = _DATE.search(title or "")
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    y = y + 2000 if y < 100 else y
    try:
        return datetime(y, mo, d).date()
    except ValueError:
        return None


def _sides(title: str) -> tuple[str, str]:
    """'A Vs B_06.09.26' / 'A vs B - 06.09.26' / 'A v B' -> (A, B)."""
    t = _DATE.sub(" ", title or "")
    t = re.sub(r"[_|]+", " ", t)
    m = re.split(r"\s+(?:vs?\.?|v)\s+", t, maxsplit=1, flags=re.I)
    if len(m) != 2:
        return (t.strip(), "")
    a, b = m[0], re.sub(r"\s+-\s*$", "", m[1])
    return (a.strip(" -"), b.strip(" -"))


def score_title(title: str, home: str, away: str, tip, published: str | None = None) -> float:
    """How well a video title fits this fixture: both clubs (either order), and the date — the one
    in the title, or failing that the video's own publish time (a stream is scheduled a day or two
    ahead). A title date that contradicts a publish time that fits is a typo, not another game.
    0 when a club is missing."""
    a, b = _sides(title)
    if not a:
        return 0.0
    s_home = max(team_score(home, a), team_score(home, b))
    s_away = max(team_score(away, a), team_score(away, b))
    if s_home < 0.5 or s_away < 0.5:
        return 0.0
    s = s_home + s_away
    td = _title_date(title)
    pub_days = None
    if published and tip:
        try:
            pub_days = abs((datetime.fromisoformat(published.replace("Z", "+00:00")) - tip).total_seconds()) / 86400
        except ValueError:
            pub_days = None
    if td and tip:
        diff = abs((td - tip.date()).days)
        if diff == 0:
            s += 1.0
        elif diff == 1:
            s += 0.3
        elif pub_days is not None and pub_days <= 4:
            s += 0.2                                                  # title date is a typo; the publish time fits
        else:
            s -= 1.5
    elif pub_days is not None:
        s += 0.5 if pub_days <= 4 else -1.0
    return s


def find_on_channel(channel_id: str, home: str, away: str, tip: datetime) -> dict | None:
    best, best_s = None, 0.0
    for v in channel_videos(channel_id):
        s = score_title(v["title"], home, away, tip, v.get("published"))
        if s <= best_s:
            continue
        if v.get("published") and tip:
            try:
                pub = datetime.fromisoformat(v["published"].replace("Z", "+00:00"))
                if abs((pub - tip).total_seconds()) > 10 * 86400:     # a stream is scheduled days ahead at most
                    continue
            except ValueError:
                pass
        best, best_s = v, s
    if not best or best_s < 1.6:
        return None
    d = watch_details(best["video_id"])
    return {"video_id": best["video_id"], "url": f"https://www.youtube.com/watch?v={best['video_id']}", "title": best["title"],
            "live": d["live"], "started_at": d["started_at"], "ended_at": d["ended_at"], "duration_s": d["duration_s"], "how": "channel"}


# ------------------------------------------------------------------ the Data API, with a key
def _iso_dur_s(d: str) -> int:
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    return (int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)) if m else 0


def find_with_api(key: str, home: str, away: str, tip: datetime, channel_id: str | None, words: str = "") -> dict | None:
    if not key or not tip:
        return None
    after = (tip - timedelta(days=4)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    before = (tip + timedelta(days=3)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    params = {"part": "snippet", "type": "video", "maxResults": 25, "q": f"{home} {away} {words}".strip(), "order": "relevance",
              "publishedAfter": after, "publishedBefore": before, "key": key}
    if channel_id:
        params["channelId"] = channel_id
    try:
        r = requests.get(f"{API}/search", params=params, timeout=30)
        items = r.json().get("items") or [] if r.status_code == 200 else []
        ids = [it["id"]["videoId"] for it in items if it.get("id", {}).get("videoId")]
        if not ids:
            return None
        r = requests.get(f"{API}/videos", params={"part": "snippet,contentDetails,liveStreamingDetails", "id": ",".join(ids), "key": key}, timeout=30)
        vids = r.json().get("items") or [] if r.status_code == 200 else []
    except Exception:
        return None
    best, best_s = None, 0.0
    for v in vids:
        sn = v.get("snippet") or {}; lsd = v.get("liveStreamingDetails") or {}
        s = score_title(sn.get("title") or "", home, away, tip)
        if not s:
            continue
        dur = _iso_dur_s((v.get("contentDetails") or {}).get("duration"))
        if dur and dur < 20 * 60 and not lsd.get("actualStartTime"):
            continue
        if lsd.get("actualStartTime"):
            s += 1.0
        if re.search(r"highlight|recap|top plays|best of", sn.get("title") or "", re.I):
            s -= 1.0
        if s > best_s:
            best_s, best = s, {"video_id": v["id"], "url": f"https://www.youtube.com/watch?v={v['id']}", "title": sn.get("title"),
                               "live": bool(lsd.get("actualStartTime")), "started_at": lsd.get("actualStartTime"),
                               "ended_at": lsd.get("actualEndTime"), "duration_s": dur, "how": "api"}
    return best if best_s >= 1.6 else None


# ------------------------------------------------------------------ attach
def find_broadcast(home: str, away: str, tipoff_iso: str, cfg: dict) -> dict | None:
    if not tipoff_iso:
        return None
    tip = datetime.fromisoformat(tipoff_iso.replace("Z", "+00:00"))
    ch = (cfg or {}).get("youtube_channel")
    found = find_on_channel(ch, home, away, tip) if ch else None
    if not found and os.environ.get("YOUTUBE_API_KEY"):
        found = find_with_api(os.environ["YOUTUBE_API_KEY"], home, away, tip, ch, (cfg or {}).get("youtube_words") or "")
    return found


def tip_instant(sb, game_id: str) -> tuple[str | None, int | None]:
    """(tip_at iso, tip_wall ms): the first period_start's poll stamp, else that row's insert time."""
    try:
        ev = sb.select("game_events", f"game_id=eq.{game_id}&t=eq.period_start&period=eq.1&select=payload,created_at&order=seq&limit=1")
    except Exception:
        return None, None
    if not ev:
        return None, None
    w = (ev[0].get("payload") or {}).get("wall")
    if isinstance(w, (int, float)) and w > 0:
        return datetime.fromtimestamp(w / 1000, tz=timezone.utc).isoformat(), int(w)
    return ev[0].get("created_at"), None


def attach(sb, game_id: str, home: str, away: str, tipoff_iso: str, cfg: dict, log=print) -> bool:
    """Attach the broadcast to a game that has none yet. Returns True when a row was written."""
    if not (cfg or {}).get("youtube_channel") and not os.environ.get("YOUTUBE_API_KEY"):
        return False
    try:
        if sb.select("game_videos", f"game_id=eq.{game_id}&select=id&limit=1"):
            return False                                              # somebody (or we) already did
    except Exception:
        return False
    found = find_broadcast(home, away, tipoff_iso, cfg)
    if not found:
        return False
    tip_at, tip_wall = tip_instant(sb, game_id)
    row = {"game_id": game_id, "provider": "youtube", "url": found["url"], "video_ref": found["video_id"],
           "label": "Live stream" if found["live"] else "Full game", "is_live": bool(found["live"]), "is_primary": True}
    if found.get("started_at"):
        row["stream_started_at"] = found["started_at"]
    if tip_at:
        row["tip_at"] = tip_at
        if tip_wall:
            row["tip_wall"] = tip_wall
    try:
        sb.insert("game_videos", row)
        state = ("anchored" if row.get("stream_started_at") and row.get("tip_at")
                 else "stream start known, tip pending" if row.get("stream_started_at") else "offset pending")
        log(f"    = video attached ({found['how']}): {found['title'][:60]} - {state}")
        return True
    except Exception as exc:
        log(f"    (video attach failed: {exc})")
        return False


def complete(sb, game_id: str, log=print) -> bool:
    """A row attached while the game was still to come has no stream start (YouTube stamps it when
    the stream goes live) and maybe no tip yet: fill in whatever has since become known."""
    try:
        rows = sb.select("game_videos", f"game_id=eq.{game_id}&provider=eq.youtube&is_primary=eq.true&select=id,video_ref,stream_started_at,tip_at,tip_wall&limit=1")
    except Exception:
        return False
    if not rows:
        return False
    v = rows[0]; patch = {}
    if not v.get("stream_started_at") and v.get("video_ref"):
        d = watch_details(v["video_ref"])
        if d.get("started_at"):
            patch["stream_started_at"] = d["started_at"]
    if not v.get("tip_at"):
        tip_at, tip_wall = tip_instant(sb, game_id)
        if tip_at:
            patch["tip_at"] = tip_at
            if tip_wall:
                patch["tip_wall"] = tip_wall
    if not patch:
        return False
    try:
        sb.patch("game_videos", f"id=eq.{v['id']}", patch)
        log(f"    = video anchored: {', '.join(patch)}")
        return True
    except Exception as exc:
        log(f"    (video anchor failed: {exc})")
        return False
