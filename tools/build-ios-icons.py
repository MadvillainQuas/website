"""The iPhone app's icon and launch mark, from Louie's logo.

THE SAME LOGO TREATMENT AS THE ANDROID APP. android/icon/epinoia-logo.png (1254 px) is a picture of
an icon: a blue rounded square with the EPINOIΛ wordmark, on white, with a drop shadow. The fit
below is copied from tools/build-android-icons.py (everything up to `visible`), so both apps and the
web app's icons (epinoia/brand/epinoia-app-*) share one blue. If that fit changes, change it here
too: the printed "fit rms" line of the two scripts should agree.

  THE BLUE IS REFITTED, NOT CROPPED. A cubic gradient is fitted to the square's own pixels (away
  from its rim, its corners and the wordmark) and evaluated past its edges, so the square has no
  corners of its own to show.

  THE WORDMARK IS THE SOURCE'S OWN PIXELS, letters and glow, feathered into the fit.

WHY iOS NEEDS A SQUARE WITH NO CORNERS AND NO ALPHA. iOS cuts every app icon with its own
continuous-corner mask, on the Home Screen, in Settings, in notifications and on the App Store. A
picture that brings its own rounded corners would show a second, slightly different corner inside
Apple's. And App Store Connect rejects an upload whose 1024 px marketing icon has an alpha channel
(ITMS-90717), even a fully opaque one, so that PNG is saved as plain RGB. Since Xcode 14 one 1024 px
image is enough: Xcode renders every smaller size from it at build time.

WHERE EACH FILE IS USED:
  ios/Epinoia/Assets.xcassets/AppIcon.appiconset/icon-1024.png
        the app icon, 1024 x 1024 RGB, no alpha, square corners (iOS masks it)
  ios/Epinoia/Assets.xcassets/LaunchLogo.imageset/launch-logo{,@2x,@3x}.png
        the launch screen's mark: the icon as a rounded square, LAUNCH_PT points wide, on a
        transparent canvas. Info.plist's UILaunchScreen draws it centred on LaunchBackground
        (#f3faf6, HOME's colour), so the launch hands over to HOME with no flash. Its corners ARE
        rounded, because nothing masks a launch image.
  epinoia/ios/icon-192.png, icon-384.png
        the website's iPhone download page. Square corners, like the store icon: Safari shows
        them in a page, where the page's own CSS rounds them if it wants to.

Run from the repository root:
    python tools/build-ios-icons.py
(needs numpy, Pillow and scipy, like the Android script)
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SOURCE = 'android/icon/epinoia-logo.png'
ASSETS = 'ios/Epinoia/Assets.xcassets'
DEG = 3                  # gradient fit: 2 leaves ~11 levels at the edges, 4 extrapolates the corners badly
T = 3.0                  # residual below this many levels is the source's mottling, not the wordmark
RADIUS = 0.225           # corner radius of the launch mark, as a share of its side (the Android shapes' radius)
LAUNCH_PT = 200          # the launch mark's width in points; 1x, 2x and 3x are written

src = np.asarray(Image.open(SOURCE).convert('RGB')).astype(np.float64)
H, W, _ = src.shape
yy, xx = np.mgrid[0:H, 0:W]

# ------------------------------------------------------------------ the square and its gradient ---
# (from tools/build-android-icons.py, unchanged)
blue = ndimage.binary_fill_holes((src[..., 2] - src[..., 0]) > 60)
ys, xs = np.nonzero(blue)
X0, X1, Y0, Y1 = xs.min(), xs.max(), ys.min(), ys.max()
CX, CY = (X0 + X1) / 2, (Y0 + Y1) / 2
SX, SY = (X1 - X0) / 2, (Y1 - Y0) / 2
S = (X1 - X0 + Y1 - Y0) / 2                         # the visible square, in source pixels


def basis(u, v, deg):
    return np.stack([(u ** i) * (v ** j) for i in range(deg + 1) for j in range(deg + 1 - i)], -1)


def uv(x, y, clip=False):
    u, v = (x - CX) / SX, (y - CY) / SY
    return (np.clip(u, -1, 1), np.clip(v, -1, 1)) if clip else (u, v)


u, v = uv(xx, yy)
interior = ndimage.binary_erosion(blue, iterations=40)   # clear of the rim's shading

# the wordmark: well away from a rough fit, in the middle of the square, no specks
A0 = basis(u[interior], v[interior], 2)
rough = np.stack([basis(u, v, 2) @ np.linalg.lstsq(A0, src[..., k][interior], rcond=None)[0]
                  for k in range(3)], -1)
far = interior & (np.sqrt(((src - rough) ** 2).sum(-1)) > 40) & (np.abs(v) < 0.4)
lab, n = ndimage.label(far)
big = np.isin(lab, 1 + np.nonzero(ndimage.sum(far, lab, range(1, n + 1)) > 400)[0])
ty, tx = np.nonzero(big)
TX0, TX1, TY0, TY1 = tx.min(), tx.max(), ty.min(), ty.max()

fitmask = interior & ~((xx > TX0 - 60) & (xx < TX1 + 60) & (yy > TY0 - 60) & (yy < TY1 + 90))
A = basis(u[fitmask], v[fitmask], DEG)
coef = [np.linalg.lstsq(A, src[..., k][fitmask], rcond=None)[0] for k in range(3)]
resid = src[fitmask] - np.stack([A @ c for c in coef], -1)
print(f'square {X1 - X0}x{Y1 - Y0}px, wordmark x {TX0}..{TX1} y {TY0}..{TY1}, '
      f'fit rms {np.sqrt((resid ** 2).mean()):.2f} levels')


def gradient(x, y):
    cu, cv = uv(x, y, clip=True)
    B = basis(cu, cv, DEG)
    return np.stack([B @ c for c in coef], -1)


# -------------------------------------------------------------------- the full-bleed layer ---
E = int(round(S * 1.5))
gy, gx = np.mgrid[0:E, 0:E]
sx, sy = gx + CX - E / 2 + 0.5, gy + CY - E / 2 + 0.5
ix, iy = np.clip(np.floor(sx).astype(int), 0, W - 1), np.clip(np.floor(sy).astype(int), 0, H - 1)
on_source = ((sx >= 0) & (sx < W) & (sy >= 0) & (sy < H))[..., None]


def ramp(dist, width):
    t = np.clip(dist / width, 0, 1)
    return 1 - t * t * (3 - 2 * t)


# weight 1 over the letters and their glow, feathering to 0 over the next few dozen pixels
dx = np.maximum(np.maximum((TX0 - 22) - sx, sx - (TX1 + 22)), 0)
dy = np.maximum(np.maximum((TY0 - 22) - sy, sy - (TY1 + 40)), 0)
w = (ramp(dx, 26) * np.where(sy < TY0, ramp(dy, 26), ramp(dy, 40)))[..., None] * on_source

ground = gradient(sx, sy)
diff = src[iy, ix] - ground
size = np.sqrt((diff ** 2).sum(-1, keepdims=True))
diff = diff * np.maximum(size - T, 0) / np.maximum(size, 1e-6)
layer = Image.fromarray(np.clip(np.round(ground + w * diff), 0, 255).astype(np.uint8), 'RGB')

off = (E - S) / 2
visible = layer.crop((round(off), round(off), round(off + S), round(off + S)))   # the square itself

# ------------------------------------------------------------------------------ the launch mark ---
SS = 8   # the corners are cut at 8x and box-averaged down: exact coverage, no ringing past the edge


def rounded(size):
    """The icon as a rounded square filling a transparent size x size canvas.

    THE RGB UNDER THE TRANSPARENT CORNER PIXELS IS THE LOGO'S OWN BLUE, not black: iOS scales the
    launch image, and a filter that mixes in the colour of a transparent-black pixel leaves a grey
    rim on the antialiased edge (the Android splash had exactly that bug)."""
    n = size * SS
    q, p = np.mgrid[0:n, 0:n] + 0.5
    half = n / 2
    ax, ay = np.abs(p - half), np.abs(q - half)
    rad = RADIUS * n
    ex, ey = np.maximum(ax - (half - rad), 0), np.maximum(ay - (half - rad), 0)
    m = (ax <= half) & (ay <= half) & (ex * ex + ey * ey <= rad * rad)
    alpha = Image.fromarray((m * 255).astype(np.uint8), 'L').reduce(SS)
    out = visible.resize((size, size), Image.LANCZOS).convert('RGBA')
    out.putalpha(alpha)
    return out


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


# App Store Connect refuses a marketing icon with an alpha channel: plain RGB, never RGBA.
icon = visible.resize((1024, 1024), Image.LANCZOS)
assert icon.mode == 'RGB'
save(icon, f'{ASSETS}/AppIcon.appiconset/icon-1024.png')

for scale, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
    save(rounded(LAUNCH_PT * scale), f'{ASSETS}/LaunchLogo.imageset/launch-logo{suffix}.png')

for px in (192, 384):
    save(visible.resize((px, px), Image.LANCZOS), f'epinoia/ios/icon-{px}.png')
print('written')
