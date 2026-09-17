"""Placeholder sides are never clubs: python scripts/ingest/placeholders_test.py"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from placeholders import PATTERNS, is_placeholder_team  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
vectors = json.load(open(os.path.join(ROOT, "supabase", "tests", "fixtures", "placeholder_teams.json"), encoding="utf-8"))

fails = 0
for name in vectors["placeholders"]:
    if not is_placeholder_team(name):
        fails += 1
        print("  FAIL  a placeholder was taken for a club:", repr(name))
for name in vectors["clubs"]:
    if is_placeholder_team(name):
        fails += 1
        print("  FAIL  a club was taken for a placeholder:", repr(name))
for name in ("", None, "   "):
    if is_placeholder_team(name):
        fails += 1
        print("  FAIL  an empty name counted as a placeholder:", repr(name))

# the database copy (0126) must hold exactly these patterns
mig = os.path.join(ROOT, "supabase", "migrations", "0126_placeholder_teams.sql")
if os.path.exists(mig):
    sql = open(mig, encoding="utf-8").read()
    for p in PATTERNS:
        if "'" + p.replace("'", "''") + "'" not in sql:
            fails += 1
            print("  FAIL  0126 does not carry the pattern", p)
else:
    fails += 1
    print("  FAIL  supabase/migrations/0126_placeholder_teams.sql is missing")

# the console's copy must hold them too
admin = open(os.path.join(ROOT, "epinoia", "admin", "admin.js"), encoding="utf-8").read()
for p in PATTERNS:
    if "'" + p.replace("\\", "\\\\").replace("'", "\\'") + "'" not in admin:
        fails += 1
        print("  FAIL  admin.js does not carry the pattern", p)

total = len(vectors["placeholders"]) + len(vectors["clubs"]) + 3 + 2 * len(PATTERNS)
print(f"\n{total - fails} passed, {fails} failed")
sys.exit(1 if fails else 0)
