"""Shrink the copied crests to the size they are drawn at: 256 px on the long edge, WebP.

    python scripts/ingest/shrink_crests.py                    # SUPABASE_URL / SUPABASE_SERVICE_KEY in the environment
    python scripts/ingest/shrink_crests.py --worker-config    # ... or from %APPDATA%\\epinoia\\worker.json
    python scripts/ingest/shrink_crests.py --dry-run          # what it would do, nothing written
    python scripts/ingest/shrink_crests.py --limit 50

WHY. The snapshots function copies every crest that is another site's URL into the public 'crests' bucket
exactly as the club's site serves it (median 58 KB, but 216 of 651 over 100 KB and one of 3 MB - 72 MB in all),
and pages draw them at 32-128 px. Storage's own resizing (render/image) would shrink them per request, but Pro
includes 100 transformed images a month and the site asked for 671 (2026-09-26), so config.js serves the stored
copy instead (crestSizes:false) and this makes the stored copy small: one pass over each file, once.

HOW IT KNOWS IT IS DONE. crest_files.content_type. The function writes what the host sent (png / jpeg / gif /
webp / avif); this writes image/webp at <= 256 px, so a row already image/webp is finished and never downloaded
again. A row whose copy this cannot read is left alone and reported. The key (crests/<crestKey(url)>) is
unchanged, so nothing that points at a crest needs to know.

NOT DONE HERE: fetching another site's image (the function does that once and remembers it), and any change to
a stored upload - those are already resized to 512 px in the browser (epinoia/upload.js).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys

import requests

MAX_EDGE = 256
QUALITY = 88
CACHE = "604800"          # what the function stored them with: a week


def shrink(data: bytes) -> tuple[bytes, tuple[int, int]]:
    """The bytes of a crest as a WebP no larger than MAX_EDGE on its long edge, and its size.
    Transparency is kept; an animated image is reduced to its first frame (a crest is a still)."""
    from PIL import Image, ImageOps
    im = Image.open(io.BytesIO(data))
    im.seek(0)
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "RGBA"):
        # palette and greyscale images with transparency carry it in info, not in a channel
        im = im.convert("RGBA" if (im.mode in ("P", "LA", "PA") or "transparency" in im.info) else "RGB")
    if max(im.size) > MAX_EDGE:
        im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=QUALITY, method=6)
    return out.getvalue(), im.size


class Api:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": "Bearer " + key})

    def rows(self) -> list[dict]:
        r = self.s.get(f"{self.url}/rest/v1/crest_files",
                       params={"ok": "eq.true", "content_type": "neq.image/webp", "select": "url,key,bytes,content_type", "order": "bytes.desc.nullslast"},
                       timeout=60)
        r.raise_for_status()
        return r.json()

    def download(self, key: str) -> bytes:
        r = self.s.get(f"{self.url}/storage/v1/object/public/crests/{key}", timeout=60)
        r.raise_for_status()
        return r.content

    def upload(self, key: str, data: bytes) -> None:
        r = self.s.post(f"{self.url}/storage/v1/object/crests/{key}", data=data, timeout=60,
                        headers={"Content-Type": "image/webp", "x-upsert": "true", "cache-control": "max-age=" + CACHE})
        r.raise_for_status()

    def mark(self, url: str, nbytes: int) -> None:
        r = self.s.patch(f"{self.url}/rest/v1/crest_files", params={"url": "eq." + url}, timeout=60,
                         json={"content_type": "image/webp", "bytes": nbytes}, headers={"Prefer": "return=minimal"})
        r.raise_for_status()


def run(api, limit: int | None = None, dry: bool = False, say=print) -> dict:
    todo = api.rows()
    if limit:
        todo = todo[:limit]
    done = saved = failed = 0
    for row in todo:
        key = row["key"]
        try:
            before = api.download(key)
            after, size = shrink(before)
        except Exception as exc:
            failed += 1
            say(f"  ! {key}: cannot read the copy ({exc}) - left as it is")
            continue
        saved += len(before) - len(after)
        say(f"  {key}: {len(before):>8,} -> {len(after):>7,} bytes, {size[0]}x{size[1]}" + ("  (dry run)" if dry else ""))
        if not dry:
            api.upload(key, after)
            api.mark(row["url"], len(after))
        done += 1
    say(f"shrunk {done}, could not read {failed}, {saved / 1e6:.1f} MB {'would be ' if dry else ''}saved")
    return {"done": done, "failed": failed, "saved": saved}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--worker-config", action="store_true", help=r"take SUPABASE_URL / SUPABASE_SERVICE_KEY from %%APPDATA%%\epinoia\worker.json")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if a.worker_config:
        cfg = json.load(open(os.path.join(os.environ["APPDATA"], "epinoia", "worker.json"), encoding="utf-8"))
        url, key = cfg["supabase_url"], cfg["service_key"]
    if not url or not key:
        print("needs SUPABASE_URL and SUPABASE_SERVICE_KEY (or --worker-config)")
        return 2
    out = run(Api(url, key), a.limit, a.dry_run)
    return 1 if out["failed"] and not out["done"] else 0


if __name__ == "__main__":
    sys.exit(main())
