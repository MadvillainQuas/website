"""Assemble the public website into one folder, from an ALLOWLIST.

The site used to be published straight from the repository root, so every file in the
repository was downloadable from the website: the database migrations, the Edge
Functions, the ingest scripts, the internal docs, the tools, the app sources and the
ingest configuration. This copies only what the website needs, and fails if anything
from the never-publish list gets in, so a new internal folder stays private by default.

    python tools/build-site.py <out dir>          (the Pages workflow runs it)

It also writes epinoia/livestats-clients.json, the one fact the game page needs from the
ingest configuration (each FIBA LiveStats feed's client code), so the configuration
itself is never published.
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# folders published whole (minus the per-file exclusions below)
PUBLIC_DIRS = ["epinoia", "share", ".well-known", "league", "transfermatrix", "data", "config"]
# single files at the root
PUBLIC_FILES = [
    "CNAME", "robots.txt", "index.html", "admin.html", "allstats.html", "basketball-analyzer-profiles_9.html",
    "gamevis.html", "GAMEVIS_with_ShotChart_v2_6.html", "index_9.html", "lineup.html", "pitch.html",
    "player_stats_viewer_pro.html", "gate.js", "topnav.js", "stat-glossary.js", "sw.js",
    "manifest.webmanifest", "logo.jpg",
]
# never published (checked again at the end): the repository's own top-level folders for
# code, docs and app sources (epinoia/android/ and epinoia/ios/, the download pages, are
# public: these names only count at the top), anything version-control or cache anywhere,
# and the files below wherever they are
TOP_NEVER = {".git", ".github", "supabase", "scripts", "tools", "docs", "android", "ios", "brand-source"}
NESTED_NEVER = {".git", "node_modules", "__pycache__"}
NEVER_PATHS = ("config/groups/",)
NEVER_FILES = {"ingest-sources.json", "github-token.json", ".gitignore", ".nojekyll"}
NEVER_SUFFIXES = (".md", ".py", ".pyc", ".mjs", ".ts", ".sql", ".jks", ".keystore", ".p8", ".pem", ".env")


def skipped(rel):
    rel = rel.replace("\\", "/")
    parts = rel.split("/")
    if parts[0] in TOP_NEVER or any(p in NESTED_NEVER for p in parts[:-1]):
        return True
    if rel.startswith(NEVER_PATHS):
        return True
    name = parts[-1]
    return name in NEVER_FILES or name.lower().endswith(NEVER_SUFFIXES)


def copy(rel, out):
    src = os.path.join(ROOT, rel)
    dst = os.path.join(out, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def livestats_clients(out):
    """competition code -> LiveStats client code, from the ingest configuration"""
    reg = json.load(open(os.path.join(ROOT, "config", "ingest-sources.json"), encoding="utf-8"))
    clients = {}
    for s in reg.get("sources") or []:
        code = s.get("code")
        cfg = s.get("adapter_config") or {}
        if code and s.get("adapter") == "fiba_livestats":
            clients[code] = cfg.get("client_code") or code
    path = os.path.join(out, "epinoia", "livestats-clients.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"clients": dict(sorted(clients.items()))}, f, separators=(",", ":"))
    return len(clients)


def main(out):
    out = os.path.abspath(out)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    n = 0
    for f in PUBLIC_FILES:
        if os.path.isfile(os.path.join(ROOT, f)):
            copy(f, out); n += 1
    for d in PUBLIC_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in NESTED_NEVER]
            for name in filenames:
                rel = os.path.relpath(os.path.join(dirpath, name), ROOT)
                if not skipped(rel):
                    copy(rel, out); n += 1
    k = livestats_clients(out)

    # THE CHECK: nothing from the never-publish list, anywhere in what is about to go out
    bad = []
    for dirpath, dirnames, filenames in os.walk(out):
        for name in filenames:
            rel = os.path.relpath(os.path.join(dirpath, name), out)
            if skipped(rel) and not rel.replace("\\", "/").endswith("epinoia/livestats-clients.json"):
                bad.append(rel)
    if bad:
        print("REFUSED: never-publish files in the site:", *bad[:20], sep="\n  ")
        sys.exit(1)
    print(f"site assembled in {out}: {n} files, {k} LiveStats client codes")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
