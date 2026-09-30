"""The link-preview picture: epinoia/brand/epinoia-share-1200x630.png (og:image / twitter:image).

    python tools/build-share-image.py

1200x630 is the size Google, Facebook, X, WhatsApp, iMessage and Slack all draw a large preview at, so one
file serves every page that has no picture of its own (a player with no photo, a league without a logo,
the home page). It is the site's own look, not a new logo: the near-black ground of the app (theme-color
#04100b), the mint the wordmark is drawn in, the mark and the EPINOI(lambda) wordmark exactly as the brand
files hold them (epinoia/brand/mark-512.png, wordmark-1026.png - the same two tools/build-brand-icons.py
un-mattes), the tagline set in Archivo, and a row of what the site is for. Nothing is photographed, so the
file is small (well under the 300 KB that some scrapers give up at).

The fonts are the site's own (epinoia/kit/fonts/*.woff2), unpacked in memory: no font is installed or shipped
for it. Needs Pillow, fontTools and brotli (the woff2 codec); the build workflow does NOT run this - the
PNG is committed, and re-run this only when the brand or the tagline changes.
"""
import io
import os

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(os.path.dirname(HERE), "epinoia")
OUT = os.path.join(SITE, "brand", "epinoia-share-1200x630.png")
W, H = 1200, 630
GROUND = (4, 16, 11)          # --theme-color of the app
MINT = (147, 242, 191)        # --lume
AQUA = (143, 245, 255)        # --aqua
INK = (232, 244, 238)
DIM = (150, 178, 164)

TAGLINE = "Live basketball scores, fixtures, standings & advanced stats"
CHIPS = ["Box scores", "Player stats", "Standings", "Scouting", "Fixtures"]


def woff2(name, size, weight=None):
    f = TTFont(os.path.join(SITE, "kit", "fonts", name))
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    buf.seek(0)
    font = ImageFont.truetype(buf, size)
    if weight:
        try:
            font.set_variation_by_axes([weight])
        except Exception:                      # a static font, or an axis order we do not know: regular is fine
            pass
    return font


def tint(img):
    """The brand files are teal for a white page; on the app's dark ground they are drawn in the site's own mint-to-aqua
    gradient (the .wordmark of the front page), through the artwork's own alpha."""
    w, h = img.size
    grad = Image.new("RGBA", (w, h))
    px = grad.load()
    for x in range(w):
        t = x / max(1, w - 1)
        c = tuple(round(MINT[i] + (AQUA[i] - MINT[i]) * t) for i in range(3)) + (255,)
        for y in range(h):
            px[x, y] = c
    grad.putalpha(img.getchannel("A"))
    return grad


def glow(base, centre, radius, colour, alpha):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = centre
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=colour + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius / 2.2))
    return Image.alpha_composite(base, layer)


def main():
    img = Image.new("RGBA", (W, H), GROUND + (255,))
    img = glow(img, (1010, 120), 330, MINT, 46)          # the light the site's hero gives the corner
    img = glow(img, (140, 640), 300, AQUA, 26)
    d = ImageDraw.Draw(img)
    # a thin court-line frame and centre arc: the only decoration, drawn not photographed
    d.rounded_rectangle([28, 28, W - 29, H - 29], radius=26, outline=MINT + (70,), width=2)
    d.arc([W - 250, -190, W + 190, 250], 90, 180, fill=MINT + (70,), width=3)
    d.ellipse([W - 90, 50, W - 70, 70], outline=MINT + (70,), width=3)

    mark = tint(Image.open(os.path.join(SITE, "brand", "mark-512.png")).convert("RGBA").resize((190, 190), Image.LANCZOS))
    img.alpha_composite(mark, (80, 92))
    wm = Image.open(os.path.join(SITE, "brand", "wordmark-1026.png")).convert("RGBA")
    wm = wm.crop(wm.getchannel("A").getbbox())
    wm = tint(wm.resize((600, round(wm.height * 600 / wm.width)), Image.LANCZOS))
    img.alpha_composite(wm, (310, 92 + (190 - wm.height) // 2))

    d = ImageDraw.Draw(img)
    big = woff2("archivo.woff2", 60, 700)
    small = woff2("archivo.woff2", 30, 500)
    chip = woff2("martian.woff2", 21)
    # the tagline, wrapped to two lines
    lines = ["Live basketball scores, fixtures,", "standings & advanced stats"]
    y = 318
    for ln in lines:
        d.text((80, y), ln, font=big, fill=INK)
        y += 78
    d.text((82, 488), "Every league, every club, every player - box scores from the scorer's table.", font=small, fill=DIM)
    x = 80
    for label in CHIPS:
        w = d.textlength(label.upper(), font=chip)
        d.rounded_rectangle([x, 550, x + w + 34, 590], radius=20, outline=MINT + (150,), width=2)
        d.text((x + 17, 559), label.upper(), font=chip, fill=MINT)
        x += w + 34 + 14
    out = img.convert("RGB").quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) \
        if os.environ.get("SHARE_QUANTIZE") else img.convert("RGB")
    out.save(OUT, optimize=True)
    print(OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
