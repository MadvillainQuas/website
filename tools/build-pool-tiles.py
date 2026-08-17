"""The four tiles the splash pool is built from.

WHY THIS WAS REBUILT. The first version produced long horizontal streaks and
almost no visible caustic, which composited into something that read as brushed
metal or a blurred photograph rather than water. Three things were wrong, and
they are the three things worth knowing about drawing water from above:

  CAUSTICS ARE CELLULAR, NOT LINEAR. Light refracted through a rippled surface
  converges onto a net of interlocking bright curves — closed cells with thin
  bright walls. A ridged fractal noise gives you streaks; a WORLEY distance
  field gives you cells, and the difference is the whole effect.

  WATER IS NOT UNIFORM. A real pool has broad patches of lighter and darker
  across it, an order of magnitude larger than the ripples. Without that
  low-frequency variation every part of the surface looks the same and the eye
  reads a texture rather than a volume, however good the ripple is.

  THE RIPPLE IS ALMOST NOTHING. Calm water moves a few per cent of the light.
  The first version pushed the anisotropic layer hard to make it visible, which
  is what turned it into streaks.

SEAMLESS IS STILL THE WHOLE JOB. Two things break it and both are easy to do by
accident: a non-wrapping resize or blur (PIL treats the edge as an edge — work
on a 3x3 tiling and crop the middle back out), and a photograph that was never
tileable in the first place (Moisan's periodic-plus-smooth decomposition, which
is exact and a few lines of FFT).

Run from the repository root:
    python tools/build-pool-tiles.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter

OUT = 'epinoia/brand/'
MARBLE_SRC = 'D:/Download/img-b1d58051-ed3b-40e8-af1f-147aa8dfee0c-1783309775030-0_1783309775030_vnabdwdl.jpg'
N = 1024

rng = np.random.default_rng(7)


# --------------------------------------------------------------- utilities ---
def wrap_blur(arr, radius):
    """Gaussian blur that respects the wrap, by blurring a 3x3 tiling."""
    h, w = arr.shape[:2]
    mode = 'L' if arr.ndim == 2 else 'RGB'
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode)
    big = Image.new(mode, (w * 3, h * 3))
    for y in range(3):
        for x in range(3):
            big.paste(im, (x * w, y * h))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(big.crop((w, h, w * 2, h * 2))).astype(np.float32)


def periodic(img):
    """Moisan's periodic component: the part of an image that tiles exactly."""
    a = img.astype(np.float64)
    h, w = a.shape[:2]
    v = np.zeros_like(a)
    v[0, :] = a[-1, :] - a[0, :]
    v[-1, :] = -v[0, :]
    v[:, 0] += a[:, -1] - a[:, 0]
    v[:, -1] -= a[:, -1] - a[:, 0]

    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    denom = (2 * np.cos(2 * np.pi * fx) + 2 * np.cos(2 * np.pi * fy) - 4)
    denom[0, 0] = 1

    if a.ndim == 3:
        out = np.empty_like(a)
        for c in range(a.shape[2]):
            fs = np.fft.fft2(v[:, :, c]) / denom
            fs[0, 0] = 0
            out[:, :, c] = a[:, :, c] - np.real(np.fft.ifft2(fs))
        return out
    fs = np.fft.fft2(v) / denom
    fs[0, 0] = 0
    return a - np.real(np.fft.ifft2(fs))


def seam(a):
    """Edge step against the texture's own local step. Under about 1.2 the
    seam is inside the noise floor and cannot be seen."""
    h = np.abs(a[:, 0] - a[:, -1]).mean()
    v = np.abs(a[0] - a[-1]).mean()
    inner = (np.abs(a[:, 300] - a[:, 301]).mean() +
             np.abs(a[300] - a[301]).mean()) / 2
    return h / max(inner, 1e-6), v / max(inner, 1e-6)


def lattice(px, py=None, seed=None):
    """Periodic value noise. Separate periods per axis, so an anisotropic field
    is generated DIRECTLY rather than by squashing a square one — squashing
    means a resize, and a resize is what breaks the wrap."""
    r = np.random.default_rng(seed) if seed is not None else rng
    py = py or px
    g = r.random((py, px))
    g = np.pad(g, ((0, 1), (0, 1)), mode='wrap')
    y = np.linspace(0, py, N, endpoint=False)
    x = np.linspace(0, px, N, endpoint=False)
    xi, yi = np.meshgrid(x, y)
    x0, y0 = np.floor(xi).astype(int), np.floor(yi).astype(int)
    fx, fy = xi - x0, yi - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = g[y0, x0] * (1 - fx) + g[y0, x0 + 1] * fx
    b = g[y0 + 1, x0] * (1 - fx) + g[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def worley(cells, seed, jitter=1.0):
    """Periodic Worley (cellular) noise: F2 - F1, which draws the WALLS between
    cells rather than their centres. This is the shape a caustic net has.

    Wrapping comes free from taking the feature points modulo the grid and
    searching the 3x3 neighbourhood of each pixel's cell — no filtering, so
    nothing can break the tile afterwards.
    """
    r = np.random.default_rng(seed)
    pts = (np.indices((cells, cells)).transpose(1, 2, 0).astype(np.float64)
           + r.random((cells, cells, 2)) * jitter)

    step = N / cells
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)
    cy = (ys / step).astype(int)
    cx = (xs / step).astype(int)

    f1 = np.full((N, N), 1e9)
    f2 = np.full((N, N), 1e9)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            gy = (cy + dy) % cells
            gx = (cx + dx) % cells
            # the feature point's position in continuous cell space, wrapped
            py = pts[gy, gx, 0] + (cy + dy - gy)
            px = pts[gy, gx, 1] + (cx + dx - gx)
            d = np.hypot(ys / step - py, xs / step - px)
            newf1 = np.minimum(f1, d)
            f2 = np.minimum(f2, np.maximum(f1, d))
            f1 = newf1
    return f1, f2


# ------------------------------------------------------------------ marble ---
# SUBTLER STONE. The photograph is real Carrara and, at the size a panel shows
# it, its veins read as cracks in laminate rather than as figure in marble. So:
# lift the whites, pull the darks up towards them (which is what compresses the
# veining), desaturate towards neutral-warm, and keep a fine grain so it is not
# a flat fill. The result is stone you can tell is stone without being able to
# follow a single vein across a button.
src = np.asarray(Image.open(MARBLE_SRC).convert('RGB').resize((N, N), Image.LANCZOS))
print('marble seam before  h %.2f  v %.2f' % seam(src.astype(np.float64)))
m = periodic(src)

lum = m.mean(axis=2, keepdims=True)
# compress the dark end towards the light: 0.34 keeps a hint of the vein
m = lum + (m - lum) * 0.62                       # desaturate the veins
m = 255 * (np.clip(m / 255, 0, 1) ** 0.86)       # lift midtones
m = 255 - (255 - m) * 0.52                       # compress towards white
# a whisper of warmth, so it is limestone-white rather than screen-white
m = m * np.array([1.0, 0.995, 0.984])[None, None, :]
# fine grain, wrapped: without it a compressed photograph looks like a fill
grain = wrap_blur(rng.normal(0, 1, (N, N)) * 255, 0.7)
grain = (grain - grain.mean()) / (grain.std() + 1e-6)
m = m + grain[:, :, None] * 1.7
m = np.clip(m, 0, 255)
print('marble seam after   h %.2f  v %.2f' % seam(m))
Image.fromarray(m.astype(np.uint8)) \
     .save(OUT + 'pool-marble.jpg', quality=94, optimize=True, progressive=True)

# ---------------------------------------------------------------- caustics ---
# THE NET. Two Worley fields at different scales, each turned into thin bright
# walls, added. F2-F1 is near zero at a cell wall and large in the middle, so
# 1 - normalised gives a bright line ON the wall; a high exponent thins it.
def net(cells, seed, power):
    f1, f2 = worley(cells, seed)
    edge = f2 - f1
    edge = edge / (edge.max() + 1e-9)
    return np.clip(1.0 - edge, 0, 1) ** power


# WEIGHTED TOWARDS THE LARGE. Round 1 used cells of one size and read as
# crackle glaze; round 2 shrank them and read as snakeskin. The size was never
# the problem — the UNIFORMITY was. A real net is mostly big irregular cells
# with a few smaller ones inside them, so the largest scale carries most of the
# weight and the rest is detail on top of it.
c = (0.62 * net(8, 11, 4.2) +
     0.26 * net(13, 29, 6.0) +
     0.12 * net(21, 47, 8.0))
# The ripple that bends the light: displace the net slightly so the walls are
# curved rather than straight-edged polygons.
warp = 0.5 * lattice(6, seed=71) + 0.5 * lattice(11, seed=83)
warp = (warp - warp.mean())
sh = np.round(warp * 44).astype(int)   # more warp: curved walls, not polygons
rows = (np.arange(N)[:, None] + sh) % N
cols = (np.arange(N)[None, :] + sh.T) % N
c = c[rows, np.arange(N)[None, :]]
c = c[np.arange(N)[:, None], cols]

c = c / (c.max() + 1e-9)

# AND THE NET IS NOT EVERYWHERE AT ONCE. Sunlight through a rippled surface
# concentrates: some square metres of a pool floor are covered in bright lines
# and the patch beside them is almost plain. Modulating the whole net by a
# smooth low-frequency mask is what turns a repeating mesh into light.
mask = 0.55 * lattice(4, seed=131) + 0.30 * lattice(7, seed=141) + 0.15 * lattice(12, seed=151)
mask = (mask - mask.min()) / np.ptp(mask)
c = c * (0.34 + 0.66 * mask)

c = c / (c.max() + 1e-9)
c = np.clip(c, 0, 1) ** 1.22      # thin walls, dark gaps
c = wrap_blur(c * 255, 1.1)   # crisp: a caustic line is a line
print('caustics seam       h %.2f  v %.2f' % seam(c))
Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'L') \
     .save(OUT + 'pool-caustics.jpg', quality=88, optimize=True)

# ----------------------------------------------------------------- surface ---
# Long low ridges lying across the flow, and only just there. The anisotropy
# comes from the lattice periods, 5 across against 17 down, NOT from squashing
# a square tile. Contrast is deliberately low: this layer is a few per cent.
# LESS ANISOTROPIC THAN IT WAS. 5 across against 17 down produced visible
# horizontal banding once the caustic net underneath was crisp — two regular
# patterns at right angles read as a weave rather than as water. 7 against 15
# still lies across the flow and no longer stripes.
base = 0.58 * lattice(7, 15, seed=5) + 0.30 * lattice(13, 29, seed=15) \
     + 0.12 * lattice(25, 57, seed=25)
base = (base - base.min()) / np.ptp(base)
ridge = np.clip(1.0 - np.abs(base * 2 - 1), 0, 1) ** 1.4
surf = np.clip(0.5 + (ridge - ridge.mean()) * 0.90, 0, 1)
surf = wrap_blur(surf * 255, 2.2)
print('surface seam        h %.2f  v %.2f' % seam(surf))
Image.fromarray(np.clip(surf, 0, 255).astype(np.uint8), 'L') \
     .save(OUT + 'pool-surface.jpg', quality=90, optimize=True)

# ------------------------------------------------------------------- depth ---
# THE LAYER THAT WAS MISSING ENTIRELY. Broad, soft, very low frequency: patches
# of lighter and darker water an order of magnitude larger than the ripples.
# Without it every part of the pool looks the same and the eye reads a texture
# rather than a volume — which is precisely what was wrong with the first pass.
d = 0.60 * lattice(3, seed=101) + 0.28 * lattice(5, seed=111) + 0.12 * lattice(8, seed=121)
d = (d - d.min()) / np.ptp(d)
d = wrap_blur(d * 255, 9)
d = (d - d.mean()) * 1.25 + 128            # centred, so it can multiply/screen
print('depth seam          h %.2f  v %.2f' % seam(d))
Image.fromarray(np.clip(d, 0, 255).astype(np.uint8), 'L') \
     .save(OUT + 'pool-depth.jpg', quality=90, optimize=True)

for f in ('pool-marble.jpg', 'pool-caustics.jpg', 'pool-surface.jpg', 'pool-depth.jpg'):
    print('%-20s %4d KB' % (f, round(os.path.getsize(OUT + f) / 1024)))
