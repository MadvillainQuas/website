"""Two seamless tiles: the marble floor of the pool, and the caustics on it.

Generated rather than filtered in the browser on purpose. An animated
feTurbulence recomputes its noise every frame across the whole viewport, which
is the sort of thing that makes a fan spin on a laptop; a pair of pre-rendered
tiles translated by transform is composited on the GPU and costs nothing.

Tileable is done properly — a periodic lattice, upsampled with wraparound —
rather than by mirroring, which leaves an axis of symmetry that the eye finds
immediately once something starts moving across it.
"""
import numpy as np
from PIL import Image, ImageFilter

N = 1024
rng = np.random.default_rng(11)


def lattice(p):
    """Periodic value noise at period p, smoothly upsampled to N."""
    g = rng.random((p, p))
    # wrap one row/col so the interpolation closes on itself
    g = np.pad(g, ((0, 1), (0, 1)), mode='wrap')
    y = np.linspace(0, p, N, endpoint=False)
    x = np.linspace(0, p, N, endpoint=False)
    xi, yi = np.meshgrid(x, y)
    x0, y0 = np.floor(xi).astype(int), np.floor(yi).astype(int)
    fx, fy = xi - x0, yi - y0
    # smoothstep, so the lattice does not show as a grid of diamonds
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = g[y0, x0] * (1 - fx) + g[y0, x0 + 1] * fx
    b = g[y0 + 1, x0] * (1 - fx) + g[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def fbm(octaves, p0=4, gain=0.5):
    out, amp, p, norm = 0.0, 1.0, p0, 0.0
    for _ in range(octaves):
        out = out + amp * lattice(p)
        norm += amp
        amp *= gain
        p *= 2
    return out / norm


# ------------------------------------------------------------------ marble ---
# Veining is a smooth gradient warped by noise and then folded — the fold is
# what makes a vein rather than a cloud.
warp = fbm(5) - 0.5
yy, xx = np.mgrid[0:N, 0:N] / N
field = np.sin((xx * 3.1 + yy * 1.7 + warp * 2.6) * np.pi * 2)
veins = 1.0 - np.abs(field) ** 0.42
veins = np.clip(veins, 0, 1)
grain = fbm(6, p0=16)

# a warm off-white stone, veins a touch grey and cool
base = 0.955 + 0.03 * (grain - 0.5)
marble = base - veins * 0.16
rgb = np.dstack([marble * 1.000, marble * 1.002, marble * 1.012])
img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
img = img.filter(ImageFilter.GaussianBlur(0.4))
img.save('marble.png', optimize=True)
print('marble.png', img.size)

# ---------------------------------------------------------------- caustics ---
# Ridged noise: the ridge lines of a couple of octaves, which is what a
# caustic net looks like from directly above.
def ridged(seedshift):
    global rng
    rng = np.random.default_rng(seedshift)
    n = fbm(4, p0=6)
    r = 1.0 - np.abs(n * 2 - 1)
    return np.clip(r, 0, 1) ** 3.2

c = 0.62 * ridged(21) + 0.48 * ridged(97)
c = np.clip(c / c.max(), 0, 1) ** 1.25
a = (c * 255).astype(np.uint8)
# white light, alpha from the ridges: laid over the marble with screen blending
caus = Image.merge('RGBA', (Image.new('L', (N, N), 255),) * 3 + (Image.fromarray(a),))
caus = caus.filter(ImageFilter.GaussianBlur(1.1))
caus.save('caustics.png', optimize=True)
print('caustics.png', caus.size)

# a preview of the two together, on the pale blue
prev = Image.new('RGB', (N, N), (150, 205, 224))
prev = Image.blend(prev, img.convert('RGB'), 0.42)
prev = Image.alpha_composite(prev.convert('RGBA'), caus).convert('RGB')
prev.resize((520, 520), Image.LANCZOS).save('poolprev.png')
print('poolprev.png')
