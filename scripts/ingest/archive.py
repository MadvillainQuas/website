"""THE ARCHIVE TIER (0262, 2026-10-14).

A season that is over keeps in the database everything its tables, profiles, careers and records are made of - the
game rows, each player's and club's line, the lineup stints, the standings - and gives up its play-by-play rows
(game_events: ~775 a game, three quarters of the database). For each game:

  snapshots/events/<game>.json         the log every page already reads first (0156). Kept, and written from the
                                       database first if it is missing or holds a different number of rows - so every
                                       page, season file and model that reads a game's log reads exactly what it read
                                       before (no effect on any output).
  feed/archive/<game>.json.gz          THE WHOLE GAME, gzipped: every event row as stored (select *: restored
                                       exactly), and every row the box score page reads for this game (PAGE_TABLES)
                                       with the clubs', players' and competition's rows it names. One file rebuilds
                                       the game's page in a reader's session, and --restore puts the rows back.
  the raw feed copy                    gzipped beside itself (<name>.json.gz), external_games.raw_ref following.

Order, so that a crash at any step leaves a game readable: the plain log is checked (written if needed) -> the
archive is written and READ BACK and compared row for row -> games.archived_at is set -> only then are the rows
deleted. A second run finishes whatever the first left. 0262's guard stops an archived game being finalised again
until it is restored (finalise-game would rebuild every line from no rows).

What is archived (due_games): finished games of a season that is over for its league (a split season other than the
one being played - so at the August turn 2026-27 becomes due; a calendar year before this one), that a signed-out
reader may read (game_rows_public: what the snapshots function writes event files for) and that came from a
feed (an external_games row: an app-scored game stays, its scorer may reopen it).

  python archive.py --worker-config --due [--limit 300] [--dry-run]
  python archive.py --worker-config --league slb-men --season 2024-25 [--dry-run]
  python archive.py --worker-config --restore <game id>[,<game id>...]
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BUCKET = "snapshots"
ARCHIVE_BUCKET = "feed"          # public and of any type: the snapshots bucket takes JSON only
VERSION = 2
DRY = {"on": False}

# THE ROWS THE BOX SCORE PAGE READS FOR ONE GAME, bundled into its archive with the play-by-play (Louie, 2026-10-14:
# "all the info needed to perfectly reconstruct a box score page with full detail"). (table, filter on the game's id,
# columns). The rows stay in the database too - they are small, and the season's numbers are made of several of them;
# the bundle is so the archive alone can rebuild the page and nothing about the game depends on rows that might later
# be pruned.
PAGE_TABLES = [
    ("games",             "id=eq.{id}",       "*"),
    ("game_state",        "game_id=eq.{id}",  "*"),
    ("game_advanced",     "game_id=eq.{id}",  "*"),
    ("player_game_stats", "game_id=eq.{id}",  "*"),
    ("team_game_stats",   "game_id=eq.{id}",  "*"),
    ("lineup_stints",     "game_id=eq.{id}",  "*"),
    ("game_sit_lines",    "game_id=eq.{id}",  "*"),
    ("game_features",     "game_id=eq.{id}",  "*"),
    ("game_officials",    "game_id=eq.{id}",  "*"),
    ("game_videos",       "game_id=eq.{id}",  "*"),
    ("game_predictions",  "game_id=eq.{id}",  "*"),
    ("external_games",    "game_id=eq.{id}",  "*"),
]
# EVERY PLAYER THE GAME NAMES: its roster as it stood that night (games.roster_snapshot, which the page draws from),
# and anybody with a line
def _player_ids(page: dict) -> set:
    ids = {r.get("player_id") for r in page.get("player_game_stats", [])} | {r.get("player_uuid") for r in page.get("player_game_stats", [])}
    for g in page.get("games", []):
        for t in ((g.get("roster_snapshot") or {}).get("teams") or []):
            ids |= {p.get("id") for p in (t.get("players") or []) if isinstance(p, dict)}
    return {x for x in ids if x}


# and the rows those name, so the bundle reads without the database: (table, the ids' column, where they come from)
META = [
    ("teams",        "id",  lambda page: {g.get(k) for g in page.get("games", []) for k in ("home_team_id", "away_team_id")}),
    ("players",      "id",  _player_ids),
    ("competitions", "id",  lambda page: {g.get("competition_id") for g in page.get("games", [])}),
]
# the log as the pages read it (data.js gameLog): what snapshots/events/<game>.json holds
LOG_COLS = ("game_id", "seq", "t", "team", "pid", "period", "clock", "payload", "created_at")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def season_is_over(name: str, now: datetime | None = None) -> bool:
    """Is a season, named as its league names it, over? A calendar year before this one; a split season that is not
    the one being played and started before it."""
    from feedplatform import season_name_for
    now = now or datetime.now(timezone.utc)
    s = str(name or "").strip()
    if len(s) == 4 and s.isdigit():
        return int(s) < now.year
    if len(s) >= 7 and s[:4].isdigit():
        live = season_name_for(now)
        return s != live and int(s[:4]) < int(live[:4])
    return False


class Store:
    """The bucket, with the service key: write, read back through the public URL, remove."""

    def __init__(self, url: str, key: str):
        self.url, self.key = url.rstrip("/"), key
        self.s = requests.Session()

    def public(self, bucket: str, path: str) -> str:
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"

    def put(self, bucket: str, path: str, data: bytes, content_type: str, cache: str = "3600") -> str:
        r = self.s.post(f"{self.url}/storage/v1/object/{bucket}/{path}", data=data, timeout=120,
                        headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": content_type,
                                 "x-upsert": "true", "cache-control": f"max-age={cache}"})
        if r.status_code >= 300:
            raise RuntimeError(f"storage put {path}: HTTP {r.status_code} {r.text[:200]}")
        return self.public(bucket, path)

    def get(self, url: str) -> bytes | None:
        # the origin, not a cached edge copy: a file just written must be read as written
        r = self.s.get(url, params={"_": str(time.time())}, timeout=120,
                       headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Cache-Control": "no-cache"})
        return r.content if r.status_code == 200 else None

    def remove(self, bucket: str, paths: list[str]) -> None:
        if not paths:
            return
        r = self.s.delete(f"{self.url}/storage/v1/object/{bucket}", json={"prefixes": paths}, timeout=120,
                          headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"})
        if r.status_code >= 300:
            raise RuntimeError(f"storage remove: HTTP {r.status_code} {r.text[:200]}")


def read_log(sb, game_id: str) -> list[dict]:
    out, after = [], None
    while True:
        q = f"game_id=eq.{game_id}&select=*&order=seq&limit=1000" + (f"&seq=gt.{after}" if after is not None else "")
        page = sb.select("game_events", q)
        out += page
        if len(page) < 1000:
            return out
        after = page[-1]["seq"]


def bundle_for(sb, game: dict, rows: list[dict]) -> dict:
    gid = game["id"]
    page: dict = {}
    for table, filt, cols in PAGE_TABLES:
        try:
            page[table] = sb.select(table, f"{filt.format(id=gid)}&select={cols}")
        except Exception as exc:                       # a table this database does not have: said, not fatal
            page[table] = []
            page.setdefault("_missing", []).append(f"{table}: {str(exc)[:120]}")
    meta: dict = {}
    for table, col, ids_of in META:
        ids = sorted(x for x in ids_of(page) if x)
        meta[table] = sb.select(table, f"{col}=in.({','.join(ids)})&select=*") if ids else []
    comp = (meta.get("competitions") or [{}])[0]
    if comp.get("season_id"):
        meta["seasons"] = sb.select("seasons", f"id=eq.{comp['season_id']}&select=*")
        lid = (meta["seasons"] or [{}])[0].get("league_id")
        meta["leagues"] = sb.select("leagues", f"id=eq.{lid}&select=*") if lid else []
        # THE TABLE AS IT STOOD, for the scoreboard's places and the report: this competition's, and the season's league
        # competition's when this one is a cup or the play-offs (tablepos.js reads the league table)
        comps = sb.select("competitions", f"season_id=eq.{comp['season_id']}&select=id,name,kind")
        meta["season_competitions"] = comps
        cids = sorted({comp.get("id")} | {c["id"] for c in comps if c.get("kind") == "league"})
        meta["standings"] = sb.select("standings", f"competition_id=in.({','.join(cids)})&select=*") if cids else []
    # WHAT THE PAGE ASKS FUNCTIONS FOR, as they answered at archiving: the players' ages and heights (player_bio), the
    # channels' videos (game_highlights), the fans' picks (prediction_tally), and the players' approved photos
    pids = sorted(_player_ids(page))
    extra = {}
    for name, call in (("player_bio", lambda: sb.rpc("player_bio", {"p_ids": pids}) if pids else []),
                       ("game_highlights", lambda: sb.rpc("game_highlights", {"p_game": gid})),
                       ("prediction_tally", lambda: sb.rpc("prediction_tally", {"p_games": [gid]}))):
        try:
            extra[name] = call()
        except Exception as exc:
            extra[name] = None
            page.setdefault("_missing", []).append(f"{name}: {str(exc)[:120]}")
    try:
        extra["media"] = sb.select("media", f"owner_type=eq.player&kind=eq.photo&status=eq.approved&owner_id=in.({','.join(pids)})"
                                            "&select=owner_id,storage_path,created_at&order=created_at.desc") if pids else []
    except Exception as exc:
        extra["media"] = []
        page.setdefault("_missing", []).append(f"media: {str(exc)[:120]}")
    return {"v": VERSION, "game": gid, "finalised_at": game.get("finalised_at"), "archived_at": now_iso(),
            # what each part is, so the file explains itself to whoever opens it in a year
            "contents": {"rows": "every game_events row as stored (select *), seq order - the play-by-play the box score is replayed from",
                         "page": "this game's rows of each table the box score page reads, by table",
                         "meta": "the clubs, players, competition, season, league and standings those rows name",
                         "extra": "what the page asks functions for: player_bio, game_highlights, prediction_tally, and player photos"},
            "rows": rows, "page": page, "meta": meta, "extra": extra}


def same_log(a: list[dict], b: list[dict]) -> bool:
    key = lambda r: (r.get("seq"), r.get("t"), r.get("team"), r.get("pid"), r.get("period"), r.get("clock"),
                     json.dumps(r.get("payload"), sort_keys=True))
    return len(a) == len(b) and [key(x) for x in a] == [key(x) for x in b]


def archive_game(sb, store: Store, game: dict, dry: bool = False, log=print) -> str:
    """One game into the archive tier. Returns what happened, in a word."""
    gid = game["id"]
    rows = read_log(sb, gid)
    if not rows:
        return "no-log"                                 # nothing to move: the game keeps what it has
    # 1. THE PLAIN LOG, as every page reads it: kept, and written from the database if missing or different
    plain_url = store.public(BUCKET, f"events/{gid}.json")
    raw = store.get(plain_url)
    plain = None
    try:
        plain = json.loads(raw) if raw else None
    except ValueError:
        plain = None
    want = [{k: r.get(k) for k in LOG_COLS} for r in rows]
    if not plain or plain.get("game") != gid or not same_log(plain.get("rows") or [], want):
        if dry:
            log(f"    [dry] {gid}: would write its event file ({len(want)} rows; it had {len((plain or {}).get('rows') or [])})")
        else:
            store.put(BUCKET, f"events/{gid}.json",
                      json.dumps({"v": 1, "game": gid, "finalised_at": game.get("finalised_at"), "rows": want},
                                 ensure_ascii=False).encode("utf-8"), "application/json", cache="300")
            sb.upsert("event_files", {"game_id": gid, "finalised_at": game.get("finalised_at"), "events": len(want),
                                      "built_at": now_iso()}, "game_id")
    # 2. THE ARCHIVE, written and read back
    b = bundle_for(sb, game, rows)
    gz = gzip.compress(json.dumps(b, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    if dry:
        log(f"    [dry] {gid}: {len(rows)} events, archive {len(gz) // 1024} KB gzipped")
        return "dry"
    url = store.put(ARCHIVE_BUCKET, f"archive/{gid}.json.gz", gz, "application/gzip", cache="86400")
    back = store.get(url)
    try:
        got = json.loads(gzip.decompress(back)) if back else None
    except Exception:
        got = None
    if not got or got.get("game") != gid or not same_log(got.get("rows") or [], rows):
        raise RuntimeError(f"{gid}: the archive read back does not match the log - nothing deleted")
    # 3. MARKED, THEN THE ROWS GO
    sb.patch("games", f"id=eq.{gid}&archived_at=is.null", {"archived_at": b["archived_at"]})
    sb.delete("game_events", f"game_id=eq.{gid}")
    # 4. THE RAW FEED, gzipped beside itself (a failure here leaves it as it was)
    try:
        gzip_raw(sb, store, gid)
    except Exception as exc:
        log(f"    (raw feed of {gid} left as it was: {str(exc)[:160]})")
    return "archived"


def gzip_raw(sb, store: Store, gid: str) -> None:
    ext = sb.select("external_games", f"game_id=eq.{gid}&select=id,raw_ref")
    for e in ext:
        ref = e.get("raw_ref") or ""
        marker = "/storage/v1/object/public/"
        if not ref.endswith(".json") or marker not in ref or not ref.startswith(store.url):
            continue
        bucket, path = ref.split(marker, 1)[1].split("/", 1)
        data = store.get(ref)
        if not data:
            continue
        gz = gzip.compress(data, 9)
        new = store.put(bucket, path + ".gz", gz, "application/gzip", cache="86400")
        back = store.get(new)
        if not back or gzip.decompress(back) != data:
            raise RuntimeError("the gzipped feed read back differently")
        sb.patch("external_games", f"id=eq.{e['id']}", {"raw_ref": new})
        store.remove(bucket, [path])


def restore_game(sb, store: Store, gid: str, log=print) -> int:
    """The rows back from the archive, exactly as stored; the game is then an ordinary one again."""
    data = store.get(store.public(ARCHIVE_BUCKET, f"archive/{gid}.json.gz"))
    if not data:
        raise RuntimeError(f"{gid}: no archive file")
    b = json.loads(gzip.decompress(data))
    rows = b.get("rows") or []
    for i in range(0, len(rows), 500):
        sb.upsert("game_events", rows[i:i + 500], "id")
    sb.patch("games", f"id=eq.{gid}", {"archived_at": None})
    log(f"    restored {gid}: {len(rows)} events")
    return len(rows)


def publishable_key() -> str | None:
    """The site's own publishable key (epinoia/config.js): what a signed-out reader reads with. game_rows_public - the
    games such a reader may see - is granted to it and not to the service role."""
    import re
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "epinoia", "config.js")
    try:
        m = re.search(r"supabaseAnonKey\s*:\s*['\"]([^'\"]{20,})['\"]", open(p, encoding="utf-8").read())
        return m.group(1) if m else None
    except OSError:
        return None


def public_ids(url: str, ids: list[str]) -> set:
    key = publishable_key()
    if not key:
        raise RuntimeError("no publishable key in epinoia/config.js - cannot tell which games are public")
    out, s = set(), requests.Session()
    for i in range(0, len(ids), 150):
        r = s.get(f"{url.rstrip('/')}/rest/v1/game_rows_public", params={"id": f"in.({','.join(ids[i:i + 150])})", "select": "id"},
                  headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=60)
        r.raise_for_status()
        out |= {x["id"] for x in r.json()}
    return out


def due_games(sb, league: str | None = None, season: str | None = None, limit: int = 300) -> list[dict]:
    """Finished, not archived, of a season that is over (or the one named), public (an event file), from a feed."""
    q = ("games?select=id,finalised_at,competition_id,competitions!inner(id,seasons!inner(name,league_id,leagues!inner(slug)))"
         "&status=eq.final&archived_at=is.null&order=tipoff_at.asc")
    if league:
        q += f"&competitions.seasons.leagues.slug=eq.{league}"
    if season:
        q += f"&competitions.seasons.name=eq.{season}"
    try:
        games = sb.select_all(q.split("?", 1)[0], q.split("?", 1)[1])
    except Exception as exc:
        if "archived_at" not in str(exc):
            raise
        # 0262 not applied yet: a dry run can still say what would be archived; a real one must not run
        if not DRY["on"]:
            raise RuntimeError("games.archived_at does not exist - apply 0262 (supabase db push) before archiving")
        q = q.replace("&archived_at=is.null", "")
        games = sb.select_all(q.split("?", 1)[0], q.split("?", 1)[1])
    games = [g for g in games if (season or season_is_over(g["competitions"]["seasons"]["name"]))]
    if not games:
        return []
    ids = [g["id"] for g in games]
    # A SIGNED-OUT READER'S GAME (game_rows_public, read as one: what the snapshots function writes event files for):
    # a members-only or private league's game is never put in a public bucket, so it keeps its rows
    public, fed = public_ids(sb.url, ids), set()
    for i in range(0, len(ids), 150):
        chunk = ",".join(ids[i:i + 150])
        fed |= {r["game_id"] for r in sb.select("external_games", f"game_id=in.({chunk})&select=game_id")}
    out = [g for g in games if g["id"] in public and g["id"] in fed]
    return out[:limit] if limit else out


def run(sb, store: Store, games: list[dict], dry: bool = False, log=print) -> dict:
    tally: dict = {}
    for i, g in enumerate(games):
        try:
            what = archive_game(sb, store, g, dry=dry, log=log)
        except Exception as exc:
            what = "failed"
            log(f"    ! {g['id']}: {str(exc)[:200]}")
        tally[what] = tally.get(what, 0) + 1
        if (i + 1) % 25 == 0:
            log(f"   {i + 1} of {len(games)}: {tally}")
    return tally


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-config", action="store_true")
    ap.add_argument("--due", action="store_true", help="every finished game of a season that is over")
    ap.add_argument("--league"); ap.add_argument("--season")
    ap.add_argument("--restore", help="game ids, comma-separated")
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.worker_config:
        w = json.load(open(os.path.join(os.environ.get("APPDATA", ""), "epinoia", "worker.json"), encoding="utf-8"))
        os.environ.setdefault("SUPABASE_URL", w["supabase_url"]); os.environ.setdefault("SUPABASE_SERVICE_KEY", w["service_key"])
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("archive.py needs SUPABASE_URL and SUPABASE_SERVICE_KEY"); return 2
    DRY["on"] = bool(a.dry_run)
    import run_ingest as R
    sb, store = R.Supabase(url, key), Store(url, key)
    if a.restore:
        for gid in [x.strip() for x in a.restore.split(",") if x.strip()]:
            restore_game(sb, store, gid)
        return 0
    if not (a.due or a.league):
        print("say --due, or --league (and --season)"); return 2
    if a.season and not season_is_over(a.season):
        print(f"{a.season} is the season being played (or later): it is archived when it is over, not before"); return 2
    games = due_games(sb, a.league, a.season, a.limit)
    print(f"{len(games)} game(s) to archive" + (" (dry run)" if a.dry_run else ""))
    tally = run(sb, store, games, dry=a.dry_run)
    print(f"archive: {tally}")
    return 1 if tally.get("failed") else 0


if __name__ == "__main__":
    sys.exit(main())
