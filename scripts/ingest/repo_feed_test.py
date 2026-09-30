"""A big league's payloads stay out of git, offline:

    python scripts/ingest/repo_feed_test.py

run_ingest.repo_feed_of decides, source by source, whether the ingest writes data/feed/<CODE>/ (the
payloads and the index committed to the repository). What this holds:
  * every source writes it, as before, unless it says "repo_feed": false - at its top level (a
    config/ingest-sources.json source) or in its adapter_config (a schedule_sources row);
  * a run with no repo feed at all (a dry run, --feed-out '') is none for every source;
  * the ingest's four writes and reads of the feed all go through this source's answer, never the shared one.
"""
import os
import re
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_ingest as R  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


feed = R.RepoFeed(Path(tempfile.mkdtemp()))
print("\nwhich sources write the repo feed")
ok("a source that says nothing writes it, as before", R.repo_feed_of({"code": "SLB"}, feed) is feed)
ok("\"repo_feed\": false at the top (config/ingest-sources.json) keeps it out", R.repo_feed_of({"code": "NCAA", "repo_feed": False}, feed) is None)
ok("...and in adapter_config (a schedule_sources row)", R.repo_feed_of({"code": "T3", "adapter_config": {"repo_feed": False}}, feed) is None)
ok("true, or anything but false, writes it", R.repo_feed_of({"code": "X", "repo_feed": True}, feed) is feed and
   R.repo_feed_of({"code": "X", "adapter_config": {"repo_feed": None}}, feed) is feed)
ok("the top level wins over adapter_config", R.repo_feed_of({"code": "X", "repo_feed": True, "adapter_config": {"repo_feed": False}}, feed) is feed)
ok("no repo feed for the run (dry run, --feed-out ''): none for any source", R.repo_feed_of({"code": "SLB"}, None) is None)

print("\nthe ingest reads and writes it through the source's answer")
src = Path(R.__file__).read_text(encoding="utf-8")
main = src[src.index("    for src_i, src in enumerate(sources):"):]
ok("each source's answer is taken at the top of its pass", "sfeed = repo_feed_of(src, feed)" in main[:400])
uses = re.findall(r"\b(s?feed)\.(known|write_game|update_index)\(", main)
ok("its payload, its index and what it knows are all this source's (" + str(len(uses)) + " uses)",
   len(uses) == 4 and all(u[0] == "sfeed" for u in uses), uses)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
