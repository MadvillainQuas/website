#!/usr/bin/env python3
"""
Stamp every local script and stylesheet under epinoia/ with a version query.

A browser told nothing about freshness invents its own, and once it has decided
a file is fresh it will not even ASK the server again — so fixing the server's
headers does nothing for anybody who already loaded the page. The only reliable
cure is to change the URL, because a URL the browser has never seen cannot be
in its cache.

That is what this does: epinoia/version.txt holds a number, and every
    src="nav.js"   ->   src="nav.js?v=<number>"
Bump the number whenever a shipped asset changes and every visitor gets the new
file on their next page load, with no clearing, no hard refresh, and no
depending on what their service worker decided months ago.

    python tools/stamp-assets.py          # apply the current version
    python tools/stamp-assets.py --bump   # increment first
"""
import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAGUE = os.path.join(ROOT, 'epinoia')
VERSION_FILE = os.path.join(LEAGUE, 'version.txt')

# local assets only. A vendored bundle is versioned by its own filename, and an
# absolute or cross-origin URL is not ours to stamp.
PATTERN = re.compile(
    r'((?:src|href)=")([^":]*?\.(?:js|css))(\?v=\d+)?(")'
)


def read_version():
    try:
        return int(io.open(VERSION_FILE, encoding='utf-8').read().strip())
    except Exception:
        return 1


def write_version(v):
    io.open(VERSION_FILE, 'w', encoding='utf-8', newline='').write(str(v) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bump', action='store_true')
    ap.add_argument('--check', action='store_true',
                    help='exit non-zero if anything would change')
    args = ap.parse_args()

    v = read_version()
    if args.bump:
        v += 1
        write_version(v)

    changed = []
    for base, _dirs, files in os.walk(LEAGUE):
        if 'vendor' in base.split(os.sep):
            continue
        for f in files:
            if not f.endswith('.html'):
                continue
            p = os.path.join(base, f)
            s = io.open(p, encoding='utf-8').read()
            out = PATTERN.sub(lambda m: m.group(1) + m.group(2) + '?v=' + str(v) + m.group(4), s)
            if out != s:
                changed.append(os.path.relpath(p, ROOT))
                if not args.check:
                    io.open(p, 'w', encoding='utf-8', newline='').write(out)

    if args.check:
        if changed:
            print('these pages are not stamped at v%d:' % v)
            for c in changed:
                print('  ' + c)
            print('\nrun: python tools/stamp-assets.py')
            sys.exit(1)
        print('every page is stamped at v%d' % v)
        return

    print('stamped %d page(s) at v%d' % (len(changed), v))
    for c in changed:
        print('  ' + c)


if __name__ == '__main__':
    main()
