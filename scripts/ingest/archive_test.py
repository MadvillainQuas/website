"""archive.py (0262): the order that keeps a game readable at every step, and the seasons that are over."""
import gzip
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import archive as A  # noqa: E402

PASS = FAIL = 0


def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  PASS  " + name)
    else:
        FAIL += 1; print("  FAIL  " + name + (f"  -- {detail}" if detail else ""))


print("\n-- the seasons that are over")
d = lambda y, m: datetime(y, m, 15, tzinfo=timezone.utc)
ok("in October 2026: 2025-26 is over, 2026-27 is not", A.season_is_over("2025-26", d(2026, 10)) and not A.season_is_over("2026-27", d(2026, 10)))
ok("in July 2027 the 2026-27 season is still the one being played", not A.season_is_over("2026-27", d(2027, 7)))
ok("...and from August 2027 it is over (the turn to 2027-28)", A.season_is_over("2026-27", d(2027, 8)))
ok("a calendar league: 2025 is over in 2026, 2026 is not", A.season_is_over("2025", d(2026, 10)) and not A.season_is_over("2026", d(2026, 10)))
ok("...and 2026 is over on 1 January 2027", A.season_is_over("2026", datetime(2027, 1, 1, tzinfo=timezone.utc)))
ok("a season with no name is never over", not A.season_is_over("", d(2026, 10)) and not A.season_is_over(None, d(2026, 10)))


class FakeSB:
    """A database of one game, its log and its page rows."""

    def __init__(self, rows):
        self.url, self.key = "https://db.example", "k"
        self.rows = list(rows)
        self.games = {"g1": {"id": "g1", "finalised_at": "2025-03-01T20:00:00+00:00", "archived_at": None,
                             "home_team_id": "t1", "away_team_id": "t2", "competition_id": "c1"}}
        self.deleted, self.patched, self.upserted = [], [], []

    def select(self, table, q):
        if table == "game_events":
            after = None
            if "seq=gt." in q:
                after = int(q.split("seq=gt.")[1].split("&")[0])
            out = [r for r in self.rows if after is None or r["seq"] > after]
            return out[:1000]
        if table == "games":
            return [dict(self.games["g1"])]
        if table == "player_game_stats":
            return [{"game_id": "g1", "player_id": "p1", "team_idx": 0, "stats": {"pts": 10}}]
        if table == "competitions":
            return [{"id": "c1", "season_id": "s1", "name": "League"}]
        if table == "seasons":
            return [{"id": "s1", "name": "2024-25", "league_id": "l1"}]
        if table == "external_games":
            return []
        return [{"table": table}]

    def patch(self, table, q, body):
        self.patched.append((table, q, body))
        if table == "games" and "archived_at" in body:
            self.games["g1"]["archived_at"] = body["archived_at"]

    def delete(self, table, q):
        self.deleted.append((table, q))
        if table == "game_events":
            self.rows = []

    def upsert(self, table, rows, on):
        self.upserted.append((table, rows if isinstance(rows, list) else [rows]))
        if table == "game_events":
            self.rows = sorted(self.rows + list(rows), key=lambda r: r["seq"])


class FakeStore:
    def __init__(self, corrupt=False, plain=None):
        self.url, self.files, self.corrupt = "https://db.example", {}, corrupt
        if plain is not None:
            self.files[self.public("snapshots", "events/g1.json")] = plain

    def public(self, bucket, path):
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"

    def put(self, bucket, path, data, ct, cache="3600"):
        u = self.public(bucket, path)
        self.files[u] = data if not (self.corrupt and path.endswith(".gz")) else gzip.compress(b'{"game":"g1","rows":[]}')
        return u

    def get(self, url):
        return self.files.get(url)

    def remove(self, bucket, paths):
        for p in paths:
            self.files.pop(self.public(bucket, p), None)


LOG = [{"id": i, "game_id": "g1", "seq": i, "t": "shot", "team": 0, "pid": 7, "period": 1, "clock": 600000 - i,
        "payload": {"made": i % 2 == 0}, "created_at": "2025-03-01T19:00:00+00:00", "created_by": None} for i in range(1, 1201)]

print("\n-- one game into the archive")
sb, st = FakeSB(LOG), FakeStore()
what = A.archive_game(sb, st, sb.games["g1"], log=lambda *a: None)
ok("archived", what == "archived", what)
plain = json.loads(st.files[st.public("snapshots", "events/g1.json")])
ok("a missing plain log is written first, in the pages' columns, every row (1,200: paged past 1,000)",
   plain["game"] == "g1" and len(plain["rows"]) == 1200 and set(plain["rows"][0]) == set(A.LOG_COLS))
arc = json.loads(gzip.decompress(st.files[st.public("feed", "archive/g1.json.gz")]))
ok("the archive holds every event row as stored (created_by too)", len(arc["rows"]) == 1200 and "created_by" in arc["rows"][0])
ok("...and the page's rows and the names they point at", arc["page"]["player_game_stats"][0]["player_id"] == "p1"
   and arc["meta"]["seasons"][0]["name"] == "2024-25" and "games" in arc["page"])
ok("the game is marked, then its rows go", sb.games["g1"]["archived_at"] and sb.rows == []
   and [p[0] for p in sb.patched][-1] == "games" and sb.deleted == [("game_events", "game_id=eq.g1")])

print("\n-- an archive that does not read back is never trusted")
sb2, st2 = FakeSB(LOG), FakeStore(corrupt=True)
try:
    A.archive_game(sb2, st2, sb2.games["g1"], log=lambda *a: None); raised = False
except RuntimeError:
    raised = True
ok("it stops", raised)
ok("...with the rows still there and the game not marked", len(sb2.rows) == 1200 and not sb2.games["g1"]["archived_at"] and not sb2.deleted)

print("\n-- the plain log the pages read is left alone when it already matches")
same = {"v": 1, "game": "g1", "rows": [{k: r[k] for k in A.LOG_COLS} for r in LOG]}
sb3, st3 = FakeSB(LOG), FakeStore(plain=json.dumps(same).encode())
before = st3.files[st3.public("snapshots", "events/g1.json")]
A.archive_game(sb3, st3, sb3.games["g1"], log=lambda *a: None)
ok("not rewritten", st3.files[st3.public("snapshots", "events/g1.json")] == before and not [u for u in sb3.upserted if u[0] == "event_files"])
stale = dict(same, rows=same["rows"][:-1])
sb4, st4 = FakeSB(LOG), FakeStore(plain=json.dumps(stale).encode())
A.archive_game(sb4, st4, sb4.games["g1"], log=lambda *a: None)
ok("one that differs from the database is written from it", len(json.loads(st4.files[st4.public("snapshots", "events/g1.json")])["rows"]) == 1200)

print("\n-- restored exactly")
n = A.restore_game(sb, st, "g1", log=lambda *a: None)
ok("every row back, as stored", n == 1200 and sb.rows == LOG, (n, len(sb.rows)))
ok("...and the game is an ordinary one again", sb.games["g1"]["archived_at"] is None)

print("\n-- a game with no log has nothing to move")
sb5, st5 = FakeSB([]), FakeStore()
ok("no-log, nothing marked or deleted", A.archive_game(sb5, st5, sb5.games["g1"], log=lambda *a: None) == "no-log"
   and not sb5.patched and not sb5.deleted)

print("\n-- the live write before 0262 is pushed")
import run_ingest as R  # noqa: E402


class Pre0262:
    """a database with no games.archived_at: asking for it fails the read, as PostgREST does (42703)"""
    def __init__(self):
        self.asked = []

    def select(self, table, q):
        self.asked.append(q)
        if "archived_at" in q:
            raise RuntimeError('400 Client Error: {"code":"42703","message":"column games.archived_at does not exist"}')
        return [{"status": "live", "tipoff_at": None}]


R._HAS_ARCHIVED["v"] = None
db = Pre0262()
rows = R.game_now(db, "g1")
rows2 = R.game_now(db, "g2")
ok("a database without archived_at: the game is still read (14 Oct 2026: every live write failed)", rows and rows[0]["status"] == "live")
ok("...and the column is asked for once, not on every game", sum("archived_at" in q for q in db.asked) == 1 and rows2, db.asked)
R._HAS_ARCHIVED["v"] = None

print("\n-- a source that archives each game the moment it is final (NCAA)")


class GameRow:
    def __init__(self, row):
        self.row, self.asked = row, []
        self.url, self.key = "https://db.example", "k"

    def select(self, table, q):
        self.asked.append((table, q))
        return [dict(self.row)] if table == "games" else []


moved = []
real_archive = A.archive_game
A.archive_game = lambda sb, store, game, dry=False, log=print: (moved.append(game["id"]), "archived")[1]
R._HAS_ARCHIVED["v"] = True
ok("a final game, not yet archived: archived at once", R.archive_on_final(GameRow({"id": "g9", "status": "final", "archived_at": None}), "g9")
   == "archived" and moved == ["g9"], moved)
ok("...one already archived is left alone", R.archive_on_final(GameRow({"id": "g8", "status": "final", "archived_at": "2026-10-14"}), "g8")
   is None and moved == ["g9"])
ok("...and one that did not reach final (a finalise that failed) too", R.archive_on_final(GameRow({"id": "g7", "status": "live", "archived_at": None}), "g7")
   is None and moved == ["g9"])
R._HAS_ARCHIVED["v"] = False
db = GameRow({"id": "g6", "status": "final", "archived_at": None})
ok("a database without 0262: nothing is tried, not even a read", R.archive_on_final(db, "g6") is None and db.asked == [])
R._HAS_ARCHIVED["v"] = None
A.archive_game = real_archive

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
