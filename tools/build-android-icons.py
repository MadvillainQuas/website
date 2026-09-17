"""The Android app's icon, splash mark and store icon, from Louie's logo.

THE SOURCE (android/icon/epinoia-logo.png, 1254 px) IS A PICTURE OF AN ICON: a blue rounded square
with the EPINOIΛ wordmark, on white, with a drop shadow. None of that can go into the app as it is.
Android draws a launcher icon as two 108 dp layers and cuts the centre 72 dp out with the phone's
own mask (a squircle on a Samsung, a circle on a Pixel), so the blue has to run past every edge,
and the shadow and the white must go. So:

  THE BLUE IS REFITTED, NOT CROPPED. A cubic gradient is fitted to the square's own pixels (away
  from its rim, its corners and the wordmark) and evaluated over the whole 108 dp. It matches the
  source to about one level (rms), and it has no corners to show.

  THE WORDMARK IS THE SOURCE'S OWN PIXELS, letters and glow, feathered into the fit. Only the
  residual above T levels comes across, which drops the source's faint mottling, so the pasted
  band cannot show as a patch.

  THE THEMED ICON (Android 13) needs the letters alone, as alpha. The blue letters are only about
  70 levels from the ground and the glow about 30, so the cut is between those (LO..HI); the N's
  colour change leaves a hairline, which a closing fills.

WHERE EACH SIZE IS USED:
  drawable-*/ic_launcher_background.png   108 dp, the adaptive icon (wordmark included; the
                                          foreground layer is transparent)
  drawable-*/ic_launcher_monochrome.png   108 dp, the themed icon's alpha
  drawable-*/splash.png                   108 dp with the icon at 52%: the TWA splash, the Android 12
                                          system splash (which shows only a centred circle of 2/3,
                                          so 52% keeps the rounded square whole) and the
                                          notification prompt's header
  mipmap-*/ic_launcher(_round).png        48 dp, Android 6 and 7, which have no masks
  android/store/icon-512.png              Play Console's store icon (Play applies its own mask)
  epinoia/android/icon-192/384.png        the download page and the site's app banners

Run from the repository root:
    python tools/build-android-icons.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SOURCE = 'android/icon/epinoia-logo.png'
RES = 'android/app/src/main/res'
DEG = 3                  # gradient fit: 2 leaves ~11 levels at the edges, 4 extrapolates the corners badly
T = 3.0                  # residual below this many levels is the source's mottling, not the wordmark
LO, HI = 36.0, 50.0      # themed-icon cut: above the glow, below the blue letters
SPLASH = 0.52            # the icon's share of the splash canvas
RADIUS = 0.225           # corner radius of the unmasked shapes, as a share of the side
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

src = np.asarray(Image.open(SOURCE).convert('RGB')).astype(np.float64)
H, W, _ = src.shape
yy, xx = np.mgrid[0:H, 0:W]

# ------------------------------------------------------------------ the square and its gradient ---
blue = ndimage.binary_fill_holes((src[..., 2] - src[..., 0]) > 60)
ys, xs = np.nonzero(blue)
X0, X1, Y0, Y1 = xs.min(), xs.max(), ys.min(), ys.max()
CX, CY = (X0 + X1) / 2, (Y0 + Y1) / 2
SX, SY = (X1 - X0) / 2, (Y1 - Y0) / 2
S = (X1 - X0 + Y1 - Y0) / 2                         # the visible 72 dp, in source pixels


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


# ------------------------------------------------------------------- the full-bleed 108 dp layer ---
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

# the letters alone, for the themed icon
d = np.sqrt(((src - gradient(xx, yy)) ** 2).sum(-1))
near = (xx > TX0 - 12) & (xx < TX1 + 12) & (yy > TY0 - 12) & (yy < TY1 + 12)
solid = near & (np.clip((d - LO) / (HI - LO), 0, 1) > 0.5)
solid = ndimage.binary_opening(ndimage.binary_closing(solid, np.ones((5, 5))), np.ones((3, 3)))
alpha = ndimage.gaussian_filter(solid.astype(np.float64), 0.8)
mono = Image.fromarray(np.clip(np.round(alpha[iy, ix] * on_source[..., 0] * 255), 0, 255).astype(np.uint8), 'L')

off = (E - S) / 2
visible = layer.crop((round(off), round(off), round(off + S), round(off + S)))   # the 72 dp


# ------------------------------------------------------------------------------------- shapes ---
def shape_mask(size, frac, kind, ss=4):
    n = size * ss
    q, p = np.mgrid[0:n, 0:n] + 0.5
    half = frac * n / 2
    ax, ay = np.abs(p - n / 2), np.abs(q - n / 2)
    if kind == 'circle':
        m = ax * ax + ay * ay <= half * half
    else:
        rad = RADIUS * 2 * half
        ex, ey = np.maximum(ax - (half - rad), 0), np.maximum(ay - (half - rad), 0)
        m = (ax <= half) & (ay <= half) & (ex * ex + ey * ey <= rad * rad)
    return Image.fromarray((m * 255).astype(np.uint8), 'L').resize((size, size), Image.LANCZOS)


def placed(size, frac, kind):
    inner = round(size * frac)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(visible.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2, (size - inner) // 2))
    out.putalpha(shape_mask(size, frac, kind))
    return out


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


for name, k in DENSITIES.items():
    s108, s48 = round(108 * k), round(48 * k)
    save(layer.resize((s108, s108), Image.LANCZOS), f'{RES}/drawable-{name}/ic_launcher_background.png')
    themed = Image.new('RGBA', (s108, s108), (255, 255, 255, 0))
    themed.putalpha(mono.resize((s108, s108), Image.LANCZOS))
    save(themed, f'{RES}/drawable-{name}/ic_launcher_monochrome.png')
    save(placed(s108, SPLASH, 'rounded'), f'{RES}/drawable-{name}/splash.png')
    save(placed(s48, 44 / 48, 'rounded'), f'{RES}/mipmap-{name}/ic_launcher.png')
    save(placed(s48, 44 / 48, 'circle'), f'{RES}/mipmap-{name}/ic_launcher_round.png')

save(visible.resize((512, 512), Image.LANCZOS), 'android/store/icon-512.png')
for px in (192, 384):
    save(visible.resize((px, px), Image.LANCZOS), f'epinoia/android/icon-{px}.png')
print('written')
