"""Build the EPINOIA logotype face.

The supplied Epinoia_Logo.ttf is six glyphs set very loose, and none of the
site's four self-hosted faces carries a lambda — they are Latin-only subsets,
so writing EPINOIΛ in any of them drops the last letter into a system fallback
that matches nothing around it.

So: derive a small face from Archivo (SIL OFL, already self-hosted here),
pinned to one weight and width so it is static and predictable, with a REAL
lambda added by taking the V outline and flipping it. In a grotesque the A and
the V are the same triangle, so an inverted V is exactly the crossbar-less A
the logo uses — and because it comes from the same font at the same weight, the
stroke thickness and the terminals match the letters beside it perfectly.

Not named after Archivo, per the OFL's rule about reserved names.
"""
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Subsetter, Options
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.misc.transform import Transform
import sys

SRC = 'epinoia/kit/fonts/archivo.woff2'   # run from the repository root
OUT = 'epinoia/brand/epinoia-mark'
WGHT, WDTH = 620, 112          # a touch heavy, a touch wide — logotype weight

f = TTFont(SRC)
print('axes:', [(a.axisTag, a.minValue, a.defaultValue, a.maxValue)
                for a in f['fvar'].axes])

f = instancer.instantiateVariableFont(f, {'wght': WGHT, 'wdth': WDTH}, inplace=False)
print('pinned to wght=%s wdth=%s' % (WGHT, WDTH))

glyf, hmtx = f['glyf'], f['hmtx']
cmap = f.getBestCmap()
vname = cmap[ord('V')]
upem = f['head'].unitsPerEm
capHeight = f['OS/2'].sCapHeight if hasattr(f['OS/2'], 'sCapHeight') else int(upem * 0.72)
print('V glyph =', vname, ' capHeight =', capHeight)

# flip V about the middle of the cap height -> Λ
pen = TTGlyphPen(glyf)
tp = TransformPen(pen, Transform(1, 0, 0, -1, 0, capHeight))
glyf[vname].draw(tp, glyf)
lam = 'uni039B'
# glyf.__setitem__ appends to its OWN glyphOrder; the font's order has to be
# pointed at the same list or the two disagree and compiling asserts.
glyf[lam] = pen.glyph()
hmtx[lam] = hmtx[vname]
f.setGlyphOrder(glyf.glyphOrder)
for t in f['cmap'].tables:
    if t.isUnicode():
        t.cmap[0x039B] = lam

# keep the alphabet, space and the lambda; everything else goes
opt = Options()
opt.name_IDs = ['*']
opt.notdef_outline = True
opt.recalc_bounds = True
sub = Subsetter(options=opt)
sub.populate(unicodes=[0x20] + list(range(0x41, 0x5B)) + [0x039B])
sub.subset(f)

n = f['name']
for nid, val in [(1, 'Epinoia Mark'), (2, 'Regular'),
                 (4, 'Epinoia Mark Regular'), (6, 'EpinoiaMark-Regular'),
                 (0, 'Derived from Archivo (SIL Open Font License 1.1) by '
                     'pinning one instance and adding U+039B from a flipped V.')]:
    n.setName(val, nid, 3, 1, 0x409)
    n.setName(val, nid, 1, 0, 0)

f.flavor = 'woff2'
f.save(OUT + '.woff2')
f.flavor = None
f.save(OUT + '.ttf')
print('wrote', OUT + '.woff2', 'and .ttf — glyphs:', len(f.getGlyphOrder()))
print('lambda mapped:', 0x039B in f.getBestCmap())
