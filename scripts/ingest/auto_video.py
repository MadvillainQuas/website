"""auto_video.py — find a fed game's broadcast and line it up, with nobody typing anything.

FIBA LiveStats carries no time of day for a play and no link to a broadcast (checked 2026-09-06:
data.json, bs.html, pbp.html and the webcast page hold neither). What the platform does have is
its OWN clock on every play (the ingest worker stamps each event with the moment its poll saw
it, roadmap Phase 0), and YouTube knows when a live stream actually began. Put together:

    1. search YouTube for a video naming both clubs, published within a day of the tip-off
       (a league's own channel first when the registry names one: adapter_config.youtube_channel)
    2. prefer a live stream (it carries liveStreamingDetails.actualStartTime), then the longest
       ordinary upload (a full-game recording is ninety minutes; a highlights reel is three)
    3. tip_at = the first period_start's poll stamp; stream_started_at = the platform's actual
       start; the recording path leaves the offset for a person (or the scoreboard reader on
       the game page) because a plain upload's start is not the stream's

Runs only with a YOUTUBE_API_KEY (a free, read-only Data API key in the repo's secrets). Writes
one game_videos row per game and never replaces one somebody attached by hand.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import requests

API = "https://www.googleapis.com/youtube/v3"
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).strip()


def _club_words(name: str) -> list[str]:
    noise = {"basketball", "club", "bc", "the", "men", "women", "ii"}
    return [w for w in _norm(name).split() if w not in noise and len(w) > 2]


def _mentions(title: str, name: str) -> bool:
    t = _norm(title)
    words = _club_words(name)
    return bool(words) and any(w in t for w in words)


def _iso_dur_s(d: str) -> int:
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return 0
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)


def find_broadcast(key: str, home: str, away: str, tipoff_iso: str, channel_id: str | None = None,
                   league_words: str = "") -> dict | None:
    """The best YouTube video for this game, or None. {video_id, url, title, channel, live, started_at, duration_s}."""
    if not key or not tipoff_iso:
        return None
    tip = datetime.fromisoformat(tipoff_iso.replace("Z", "+00:00"))
    after = (tip - timedelta(hours=6)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    before = (tip + timedelta(days=3)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    hw, aw = _club_words(home), _club_words(away)
    q = " ".join([hw[0] if hw else home, aw[0] if aw else away, league_words]).strip()
    params = {"part": "snippet", "type": "video", "maxResults": 25, "q": q, "order": "relevance",
              "publishedAfter": after, "publishedBefore": before, "key": key}
    if channel_id:
        params["channelId"] = channel_id
    try:
        r = requests.get(f"{API}/search", params=params, timeout=30)
        if r.status_code != 200:
            return None
        items = r.json().get("items") or []
    except Exception:
        return None
    ids = [it["id"]["videoId"] for it in items if it.get("id", {}).get("videoId")]
    if not ids:
        return None
    try:
        r = requests.get(f"{API}/videos", params={"part": "snippet,contentDetails,liveStreamingDetails", "id": ",".join(ids), "key": key}, timeout=30)
        vids = r.json().get("items") or [] if r.status_code == 200 else []
    except Exception:
        return None
    best, best_score = None, 0.0
    for v in vids:
        sn = v.get("snippet") or {}
        title = sn.get("title") or ""
        if not (_mentions(title, home) and _mentions(title, away)):
            continue
        lsd = v.get("liveStreamingDetails") or {}
        dur = _iso_dur_s((v.get("contentDetails") or {}).get("duration"))
        if dur and dur < 20 * 60 and not lsd.get("actualStartTime"):
            continue                                                  # a highlights reel is not the game
        score = 1.0
        if lsd.get("actualStartTime"):
            score += 1.0                                              # a stream: the anchor comes free
            try:
                st = datetime.fromisoformat(lsd["actualStartTime"].replace("Z", "+00:00"))
                gap = (tip - st).total_seconds()
                if -30 * 60 <= gap <= 90 * 60:
                    score += 1.0                                      # started within a sensible window of tip
                elif abs(gap) > 6 * 3600:
                    score -= 1.5
            except ValueError:
                pass
        if channel_id and sn.get("channelId") == channel_id:
            score += 0.5
        if dur >= 60 * 60:
            score += 0.5                                              # long enough to be the whole game
        if re.search(r"highlight|recap|top plays|best of", title, re.I):
            score -= 1.0
        if score > best_score:
            best_score, best = score, {
                "video_id": v["id"], "url": f"https://www.youtube.com/watch?v={v['id']}", "title": title,
                "channel": sn.get("channelTitle"), "live": bool(lsd.get("actualStartTime")),
                "started_at": lsd.get("actualStartTime"), "duration_s": dur, "score": round(best_score, 2) if best else round(score, 2),
            }
    return best if best_score >= 2.0 else None


def attach(sb, game_id: str, home: str, away: str, tipoff_iso: str, cfg: dict, log=print) -> bool:
    """Attach the broadcast to a game that has none yet. Returns True when a row was written."""
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return False
    try:
        if sb.select("game_videos", f"game_id=eq.{game_id}&select=id&limit=1"):
            return False                                              # somebody (or we) already did
    except Exception:
        return False
    found = find_broadcast(key, home, away, tipoff_iso, cfg.get("youtube_channel"), cfg.get("youtube_words") or "")
    if not found:
        return False
    # the tip's wall clock as THIS platform saw it: the first period_start's poll stamp, else its insert time
    tip_at = None; tip_wall = None
    try:
        ev = sb.select("game_events", f"game_id=eq.{game_id}&t=eq.period_start&period=eq.1&select=payload,created_at&order=seq&limit=1")
        if ev:
            w = (ev[0].get("payload") or {}).get("wall")
            if isinstance(w, (int, float)) and w > 0:
                tip_wall = int(w)
                tip_at = datetime.fromtimestamp(w / 1000, tz=timezone.utc).isoformat()
            else:
                tip_at = ev[0].get("created_at")
    except Exception:
        pass
    row = {"game_id": game_id, "provider": "youtube", "url": found["url"], "video_ref": found["video_id"],
           "label": "Full game" if not found["live"] else "Live stream", "is_live": found["live"], "is_primary": True}
    if found["live"] and found.get("started_at") and tip_at:
        row["stream_started_at"] = found["started_at"]
        row["tip_at"] = tip_at
        if tip_wall:
            row["tip_wall"] = tip_wall
    elif tip_at:
        row["tip_at"] = tip_at                                         # the offset waits for a person / the scoreboard reader
        if tip_wall:
            row["tip_wall"] = tip_wall
    try:
        sb.insert("game_videos", row)
        log(f"    = video attached: {found['title'][:70]} ({'stream, anchored' if row.get('stream_started_at') else 'recording, offset pending'})")
        return True
    except Exception as exc:
        log(f"    (video attach failed: {exc})")
        return False
