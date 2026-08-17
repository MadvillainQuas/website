"""The three tiles the splash pool is built from, all genuinely seamless.

SEAMLESS IS THE WHOLE JOB HERE. A tile with a seam looks like exactly what it
is — a photograph sliding across the screen — and the eye finds the repeat
instantly once it starts moving. Two things broke it the first time round and
both are easy to do by accident:

  A NON-WRAPPING RESIZE OR BLUR. PIL's LANCZOS resize and GaussianBlur both
  treat the edge as an edge. Run either over a tileable texture and it is no
  longer tileable: the filter had nothing on the far side to average with. The
  fix is to work on a 3x3 tiling and crop the middle back out.

  A PHOTOGRAPH THAT WAS NEVER TILEABLE. The Carrara is a real photograph and
  its edges do not meet. A cross-fade feather was tried and measurably made
  the horizontal seam worse. What works is Moisan's periodic-plus-smooth
  decomposition: split the image into a periodic part, which tiles perfectly
  by construction, and a smooth part carrying the boundary mismatch, and keep
  the periodic part. It is a few lines of FFT and it is exact.

Run from the repository root:
    python tools/build-pool-tiles.py
"""
import numpy as np
from PIL import Image, ImageFilter

OUT = 'league/brand/'
MARBLE_SRC = 'D:/Download/img-b1d58051-ed3b-40e8-af1f-147aa8dfee0c-1783309775030-0_1783309775030_vnabdwdl.jpg'
N = 1024


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
    """Moisan's periodic component: the part of an image that tiles exactly.

    The boundary mismatch is expressed as a sparse field v, the smooth
    component is the solution of a Poisson equation with v as its Laplacian
    (one division in the Fourier domain), and what is left is periodic."""
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
    denom[0, 0] = 1                      # the mean is carried by the periodic part

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
    return h / inner, v / inner


rng = np.random.default_rng(5)


def lattice(px, py=None):
    """Periodic value noise. Separate periods per axis, so an anisotropic
    field can be generated DIRECTLY rather than by squashing a square one —
    squashing means a resize, and a resize is what breaks the wrap."""
    py = py or px
    g = rng.random((py, px))
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


# ------------------------------------------------------------------ marble ---
src = np.asarray(Image.open(MARBLE_SRC).convert('RGB').resize((N, N), Image.LANCZOS))
print('marble seam before  h %.2f  v %.2f' % seam(src.astype(np.float64)))
p = periodic(src)
print('marble seam after   h %.2f  v %.2f' % seam(p))
Image.fromarray(np.clip(p, 0, 255).astype(np.uint8)) \
     .save(OUT + 'pool-marble.jpg', quality=92, optimize=True, progressive=True)

# ---------------------------------------------------------------- caustics ---
def ridged(seed, p0):
    global rng
    rng = np.random.default_rng(seed)
    n = 0.6 * lattice(p0) + 0.3 * lattice(p0 * 2) + 0.1 * lattice(p0 * 4)
    return np.clip(1.0 - np.abs(n * 2 - 1), 0, 1) ** 2.6

c = 0.7 * ridged(21, 5) + 0.4 * ridged(97, 9)
c = np.clip(c / c.max(), 0, 1) ** 1.5
c = wrap_blur(c * 255, 2.4)
print('caustics seam       h %.2f  v %.2f' % seam(c))
Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'L') \
     .save(OUT + 'pool-caustics.jpg', quality=84, optimize=True)

# ----------------------------------------------------------------- surface ---
# Long low ridges lying across the flow. The anisotropy comes from the lattice
# periods, 4 across against 20 down, NOT from squashing a square tile.
rng = np.random.default_rng(5)
base = 0.60 * lattice(4, 20) + 0.28 * lattice(8, 40) + 0.12 * lattice(16, 80)
base = (base - base.min()) / np.ptp(base)
ridge = np.clip(1.0 - np.abs(base * 2 - 1), 0, 1) ** 1.7
surf = np.clip(0.5 + (ridge - ridge.mean()) * 1.9, 0, 1)
surf = wrap_blur(surf * 255, 1.6)
print('surface seam        h %.2f  v %.2f' % seam(surf))
Image.fromarray(np.clip(surf, 0, 255).astype(np.uint8), 'L') \
     .save(OUT + 'pool-surface.jpg', quality=88, optimize=True)

import os
for f in ('pool-marble.jpg', 'pool-caustics.jpg', 'pool-surface.jpg'):
    print('%-20s %4d KB' % (f, round(os.path.getsize(OUT + f) / 1024)))
