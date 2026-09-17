"""Every icon the platform ships, from Louie's two brand files.

THE SOURCES ARE CLEAN ARTWORK ON WHITE (brand-source/): the mark — three teal blades cut into an
E — and the EPINOIA wordmark with its lambda A. Both are flat colour on pure white with no shadow
and no texture, which is why this script is a tenth of the size of the two it replaces: those
fitted a cubic gradient to a photographed blue square and feathered the wordmark's own pixels back
in, because the source was a picture OF an icon. There is nothing to refit here.

WHITE IS NOT A BACKGROUND, IT IS A MATTE. Saved from the design tool the artwork sits on opaque
white, so on the site's near-black ground it would be a white postage stamp. Every pixel is
un-matted instead: how far it is from white gives its alpha, and the colour is divided back out of
it, so an antialiased edge keeps its own teal rather than a white fringe. That gives one
transparent mark and one transparent wordmark, which is what the pages use.

THE ICON IS THE MARK ON WHITE, on purpose. The site is near-black, but an app icon is not part of
the site — it sits on somebody's home screen, next to forty others, and the brand as drawn is teal
on white. Reversing it out on dark would be a second, unapproved version of the logo.

WHAT ANDROID NEEDS, AND WHY THE SIZES LOOK ODD: a launcher icon is two 108 dp layers with the
phone's own mask cutting the centre 72 dp (a squircle on a Samsung, a circle on a Pixel), so the
ground must run past every edge and the mark must sit inside the middle two thirds. The same
picture at 1.5x the pixels (162 dp) is the Android 12+ system splash, which draws the 108 dp
canvas over 162 dp and shows a centred circle of two thirds.

    python tools/build-brand-icons.py
"""
import os

import numpy as np
from PIL import Image

MARK = 'brand-source/mark.png'
WORDMARK = 'brand-source/wordmark.png'
RES = 'android/app/src/main/res'
ASSETS = 'ios/Epinoia/Assets.xcassets'

GROUND = (255, 255, 255)   # the brand sheet's own ground
MARK_IN_VISIBLE = 0.62     # the mark's share of the 72 dp the mask leaves visible
RADIUS = 0.225             # corner radius of the unmasked shapes, as a share of the side
SPLASH = 0.52              # the icon's share of the splash canvas
LAUNCH_PT = 200            # iOS launch mark width in points
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
SS = 8                     # corners are cut at 8x and box-averaged down: exact coverage, no ringing

SOLID = 200.0              # distance from white, in levels, at which a pixel counts as fully the logo


# ------------------------------------------------------------------- un-matting the white ---
def unmatte(path):
    """Artwork drawn on opaque white -> RGBA with the white removed and the colour recovered.

    alpha comes from how far the pixel is from white, capped so every solid pixel is fully
    opaque; the colour is then un-premultiplied, C = (P - (1-a) * 255) / a, which is the exact
    inverse of drawing C over white at that alpha. Without that second step every edge pixel
    keeps the white mixed into it and the mark wears a pale halo on a dark page."""
    p = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    a = np.clip((255.0 - p.min(axis=2)) / SOLID, 0.0, 1.0)
    with np.errstate(invalid='ignore', divide='ignore'):
        c = (p - (1.0 - a)[..., None] * 255.0) / np.maximum(a, 1e-6)[..., None]
    c = np.where(a[..., None] > 0, np.clip(c, 0, 255), 0)
    out = np.dstack([c, a * 255.0]).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    return img.crop(img.getchannel('A').getbbox())      # trim the margin the design tool left


mark = unmatte(MARK)
wordmark = unmatte(WORDMARK)


def square(img):
    """The mark on a transparent square, so every later resize is one scale factor."""
    s = max(img.size)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(img, ((s - img.width) // 2, (s - img.height) // 2), img)
    return out


marksq = square(mark)


def on_ground(size, frac):
    """The mark at `frac` of `size`, centred on an opaque ground of that size."""
    out = Image.new('RGB', (size, size), GROUND)
    w = max(1, round(size * frac))
    m = marksq.resize((w, w), Image.LANCZOS)
    off = (size - w) // 2
    out.paste(m, (off, off), m)
    return out


def rounded_alpha(size, frac, kind):
    """A mask for a rounded square (or circle) of side frac * size, antialiased by supersampling."""
    n = size * SS
    q, p = np.mgrid[0:n, 0:n] + 0.5
    half = frac * n / 2
    ax, ay = np.abs(p - n / 2), np.abs(q - n / 2)
    if kind == 'circle':
        m = ax * ax + ay * ay <= half * half
    else:
        rad = RADIUS * 2 * half
        ex, ey = np.maximum(ax - (half - rad), 0), np.maximum(ay - (half - rad), 0)
        m = (ax <= half) & (ay <= half) & (ex * ex + ey * ey <= rad * rad)
    return Image.fromarray((m * 255).astype(np.uint8), 'L').reduce(SS)


def shape(size, frac, kind, inner):
    """The icon as a rounded square or circle on a transparent canvas.

    THE GROUND RUNS UNDER THE TRANSPARENT PIXELS, it is not pasted as a block of whole ones: a
    scaler that mixes in the colour of a transparent-black pixel leaves a grey rim on the
    antialiased edge, which is exactly what the old splash had."""
    out = on_ground(size, inner).convert('RGBA')
    out.putalpha(rounded_alpha(size, frac, kind))
    return out


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


# ------------------------------------------------------------------------------- the layers ---
# 108 dp full bleed: the ground to every edge, the mark sized so it spans MARK_IN_VISIBLE of the
# 72 dp the phone's mask leaves showing.
LAYER = 1080
layer = on_ground(LAYER, MARK_IN_VISIBLE * 72 / 108)
visible = on_ground(LAYER, MARK_IN_VISIBLE)             # the icon as it is seen, for round holes
mono = Image.new('L', (LAYER, LAYER), 0)                # the themed icon: the mark alone, as alpha
w = round(LAYER * MARK_IN_VISIBLE * 72 / 108)
mono.paste(marksq.getchannel('A').resize((w, w), Image.LANCZOS), ((LAYER - w) // 2,) * 2)

written = []

# ---- Android ---------------------------------------------------------------------------------
for name, k in DENSITIES.items():
    s108, s48 = round(108 * k), round(48 * k)
    written.append(save(layer.resize((s108, s108), Image.LANCZOS).convert('RGBA'),
                        f'{RES}/drawable-{name}/ic_launcher_background.png'))
    themed = Image.new('RGBA', (s108, s108), (255, 255, 255, 0))
    themed.putalpha(mono.resize((s108, s108), Image.LANCZOS))
    written.append(save(themed, f'{RES}/drawable-{name}/ic_launcher_monochrome.png'))
    written.append(save(shape(s108, SPLASH, 'rounded', MARK_IN_VISIBLE * SPLASH),
                        f'{RES}/drawable-{name}/splash.png'))
    written.append(save(shape(round(162 * k), SPLASH, 'rounded', MARK_IN_VISIBLE * SPLASH),
                        f'{RES}/drawable-{name}/splash_system.png'))
    written.append(save(shape(s48, 44 / 48, 'rounded', MARK_IN_VISIBLE * 44 / 48),
                        f'{RES}/mipmap-{name}/ic_launcher.png'))
    written.append(save(shape(s48, 44 / 48, 'circle', MARK_IN_VISIBLE * 44 / 48),
                        f'{RES}/mipmap-{name}/ic_launcher_round.png'))

# Play Console asks for a 32-bit PNG
written.append(save(visible.resize((512, 512), Image.LANCZOS).convert('RGBA'), 'android/store/icon-512.png'))
for px in (192, 384):
    written.append(save(visible.resize((px, px), Image.LANCZOS), f'epinoia/android/icon-{px}.png'))

# ---- iOS -------------------------------------------------------------------------------------
# App Store Connect refuses a marketing icon with an alpha channel: plain RGB, never RGBA.
icon = visible.resize((1024, 1024), Image.LANCZOS)
assert icon.mode == 'RGB'
written.append(save(icon, f'{ASSETS}/AppIcon.appiconset/icon-1024.png'))
for scale, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
    written.append(save(shape(LAUNCH_PT * scale, 1.0, 'rounded', MARK_IN_VISIBLE),
                        f'{ASSETS}/LaunchLogo.imageset/launch-logo{suffix}.png'))
for px in (192, 384):
    written.append(save(visible.resize((px, px), Image.LANCZOS), f'epinoia/ios/icon-{px}.png'))

# ---- the web app, its notifications, and every page's favicon --------------------------------
# epinoia-app-*: the installed web app's icons (manifest and apple-touch-icon) and the picture on
# a notification (sw.js ICON). epinoia-mark-*: the favicon every page links, and clockcam's own
# manifest. A maskable icon's safe zone is the centre circle of 80%, so it comes from the
# full-bleed layer rather than from the visible square.
for px in (180, 192, 512):
    written.append(save(visible.resize((px, px), Image.LANCZOS), f'epinoia/brand/epinoia-app-{px}.png'))
for px in (192, 512):
    written.append(save(layer.resize((px, px), Image.LANCZOS), f'epinoia/brand/epinoia-app-{px}-maskable.png'))
for px in (32, 180, 192, 512):
    written.append(save(visible.resize((px, px), Image.LANCZOS), f'epinoia/brand/epinoia-mark-{px}.png'))
for px in (192, 512):
    written.append(save(layer.resize((px, px), Image.LANCZOS), f'epinoia/brand/epinoia-mark-{px}-maskable.png'))

# THE NOTIFICATION BADGE is drawn by Android as a silhouette in whatever colour the system picks,
# so only the alpha matters — white keeps it right if a launcher ever draws it as it is.
badge = Image.new('RGBA', (96, 96), (255, 255, 255, 0))
bw = round(96 * 0.78)
badge.putalpha(Image.new('L', (96, 96), 0))
sil = marksq.getchannel('A').resize((bw, bw), Image.LANCZOS)
white = Image.new('RGBA', (96, 96), (255, 255, 255, 0))
white.paste(Image.new('RGB', (bw, bw), (255, 255, 255)), ((96 - bw) // 2,) * 2, sil)
written.append(save(white, 'epinoia/brand/epinoia-badge-96.png'))

# ---- the two logos themselves, for the pages ---------------------------------------------------
# Transparent, trimmed, at the widths the pages draw them.
#
# NOTHING IS ENLARGED. The drawn wordmark is 1012 px wide inside its 1600 px sheet, so exporting
# it at 1280 stretched it by a quarter and HOME's hero came out visibly soft. Every width here is
# clamped to what the artwork actually has, and the page draws it at half that so a 2x screen has
# a real pixel for each of its own.
for px in (256, 512):
    written.append(save(marksq.resize((px, px), Image.LANCZOS), f'epinoia/brand/mark-{px}.png'))
for px in (640, wordmark.width):
    px = min(px, wordmark.width)
    h = max(1, round(wordmark.height * px / wordmark.width))
    written.append(save(wordmark.resize((px, h), Image.LANCZOS), f'epinoia/brand/wordmark-{px}.png'))

print('written ' + str(len(written)) + ' files')
