"""shrink_crests: a copied crest becomes a <= 256 px WebP, keeps its transparency, and is only ever done once.
No network, no database: python scripts/ingest/shrink_crests_test.py"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shrink_crests as S  # noqa: E402
from PIL import Image  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


def png(size, mode="RGBA", colour=(200, 30, 30, 255)):
    im = Image.new(mode, size, colour)
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def opened(data):
    im = Image.open(io.BytesIO(data)); im.load(); return im


print("-- one image")
big = png((1200, 600))
out, size = S.shrink(big)
im = opened(out)
ok("a big crest comes out as WebP", im.format == "WEBP", im.format)
ok("...no larger than 256 on its long edge, aspect kept", size == (256, 128) and im.size == (256, 128), (size, im.size))
ok("...and far smaller than it was", len(out) < len(big), (len(out), len(big)))

small = png((64, 64))
_, s2 = S.shrink(small)
ok("a crest already small is not enlarged", s2 == (64, 64), s2)

trans = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
trans.paste((255, 255, 255, 255), (200, 200, 400, 400))
b = io.BytesIO(); trans.save(b, "PNG")
o3, _ = S.shrink(b.getvalue())
im3 = opened(o3)
ok("transparency survives", im3.mode == "RGBA" and im3.getpixel((2, 2))[3] == 0 and im3.getpixel((128, 128))[3] == 255, im3.getpixel((2, 2)))

pal = Image.new("P", (500, 500)); pal.putpalette([255, 0, 0] * 256); pal.info["transparency"] = 0
b = io.BytesIO(); pal.save(b, "PNG", transparency=0)
o4, _ = S.shrink(b.getvalue())
ok("a palette image with a transparent index keeps its alpha channel", opened(o4).mode == "RGBA", opened(o4).mode)

jb = io.BytesIO(); Image.new("RGB", (900, 900), (10, 100, 200)).save(jb, "JPEG")
o5, s5 = S.shrink(jb.getvalue())
ok("a JPEG works too", opened(o5).mode == "RGB" and s5 == (256, 256), s5)

frames = [Image.new("RGB", (400, 300), c) for c in ((255, 0, 0), (0, 255, 0))]
gb = io.BytesIO(); frames[0].save(gb, "GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
o6, s6 = S.shrink(gb.getvalue())
ok("an animated GIF becomes its first frame, still", s6 == (256, 192) and getattr(opened(o6), "n_frames", 1) == 1, s6)

try:
    S.shrink(b"<html>not an image</html>")
    ok("a file that is not an image is refused", False)
except Exception:
    ok("a file that is not an image is refused", True)

print("\n-- the sweep")


class Fake:
    def __init__(self, files):
        self.files = dict(files)
        self.meta = {k: {"url": "u-" + k, "key": k, "bytes": len(v), "content_type": "image/png"} for k, v in files.items()}
        self.up, self.marked = [], []

    def rows(self):
        return [m for m in self.meta.values() if m["content_type"] != "image/webp"]

    def download(self, key):
        return self.files[key]

    def upload(self, key, data):
        self.up.append(key); self.files[key] = data

    def mark(self, url, n):
        k = url[2:]; self.meta[k].update(content_type="image/webp", bytes=n); self.marked.append(k)


f = Fake({"a": png((1000, 1000)), "b": png((90, 90)), "c": b"garbage"})
r = S.run(f, say=lambda *_: None)
ok("every readable copy is shrunk, uploaded under its own key and marked", sorted(f.up) == ["a", "b"] and sorted(f.marked) == ["a", "b"], (f.up, f.marked))
ok("an unreadable copy is left alone, and counted", "c" not in f.up and r["failed"] == 1 and r["done"] == 2, r)
ok("what was written is a small WebP", opened(f.files["a"]).format == "WEBP" and max(opened(f.files["a"]).size) == 256)
n_up = len(f.up)
S.run(f, say=lambda *_: None)
ok("a second pass touches nothing that is finished (only the unreadable one is looked at again)", len(f.up) == n_up)

g = Fake({"a": png((1000, 1000))})
S.run(g, dry=True, say=lambda *_: None)
ok("a dry run writes nothing", g.up == [] and g.marked == [])
h = Fake({"a": png((500, 500)), "b": png((500, 500))})
S.run(h, limit=1, say=lambda *_: None)
ok("--limit stops after that many", len(h.up) == 1)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
