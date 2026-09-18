"""B.LEAGUE club names never sit in Japanese waiting for a game to be played, and the game
feed's own SHOUTED "TeamNameE" never overwrites a good name with a shouted one:

    python scripts/ingest/bleague_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adapters.bleague import EN_NAME, _en_name  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


print("-- _en_name(): the crest code resolves to a club's real name, or falls back cleanly")
ok("a known code (Alvark Tokyo's crest file)", _en_name("at", "A東京") == "Alvark Tokyo")
ok("...case-insensitively, the way a feed's own casing varies", _en_name("AT", "A東京") == "Alvark Tokyo")
ok("...and with incidental whitespace", _en_name(" at ", "A東京") == "Alvark Tokyo")
ok("an unknown code falls back to whatever the feed gave, unchanged", _en_name("zz", "何か") == "何か")
ok("no code at all falls back the same way", _en_name(None, "何か") == "何か")
ok("empty code falls back the same way", _en_name("", "何か") == "何か")

print("\n-- EN_NAME: every entry is real data, not a placeholder or a copy-paste")
ok("fifty-one clubs (B1's 26, Altiri Chiba included, + B2's 25) currently on the platform",
   len(EN_NAME) == 51, len(EN_NAME))
ok("every key is the lowercase 2-3 letter crest code bleague.jp itself uses",
   all(k == k.lower() and 2 <= len(k) <= 3 and k.isalpha() for k in EN_NAME), sorted(EN_NAME))
ok("every value is real English text -- not empty, and never the shouted form the game feed writes",
   all(v and v == v[0].upper() + v[1:] and not v.isupper() for v in EN_NAME.values()),
   [v for v in EN_NAME.values() if not v or v.isupper()])
ok("no two codes share a name (a copy-paste of one club's row onto another's key)",
   len(set(EN_NAME.values())) == len(EN_NAME),
   [v for v in EN_NAME.values() if list(EN_NAME.values()).count(v) > 1])

print("\n-- spot checks against the real crest codes seen on the live schedule")
SPOT = {
    "at": "Alvark Tokyo", "rg": "Ryukyu Golden Kings", "hd": "Hiroshima Dragonflies",
    "cj": "Chiba Jets", "kb": "Kawasaki Brave Thunders", "ub": "Utsunomiya Brex",
    "ez": "Earthfriends Tokyo Z", "tu": "Tokyo United BC", "na": "Niigata Albirex BB",
    "fe": "Fighting Eagles Nagoya",
}
for code, want in SPOT.items():
    ok(f"{code} -> {want}", EN_NAME.get(code) == want, EN_NAME.get(code))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
