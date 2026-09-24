"""Which characters the display faces can actually draw, written into epinoia/glyphs.js.

    python tools/font-coverage.py          rewrite the table in epinoia/glyphs.js from the fonts
    python tools/font-coverage.py --check  exit 1 if the table and the fonts disagree

epinoia/glyphs.js transliterates a letter a display face does not have (Ę in "1 LIGA MĘŻCZYZN"
under Jersey 25) instead of letting the browser draw it in a fallback font in the middle of a word.
It needs to know what each face covers; that is read from the woff2 cmaps here, never typed by hand,
so a re-subset font (one that gains Latin Extended-A) stops being transliterated on its own.
Needs fontTools (pip install fonttools brotli).
"""
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = {"Jersey25": "jersey25.woff2", "Silkscreen": "silkscreen.woff2"}
TARGET = ROOT / "epinoia" / "glyphs.js"
BEGIN, END = "/* coverage:begin (tools/font-coverage.py) */", "/* coverage:end */"


def ranges(cps):
    """Code points above U+007F as 'a-b' hex ranges: ASCII is assumed, everything else listed."""
    cps = sorted(c for c in cps if c > 0x7F)
    out, i = [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f"{cps[i]:x}" if i == j else f"{cps[i]:x}-{cps[j]:x}")
        i = j + 1
    return ",".join(out)


def table() -> str:
    lines = [BEGIN, "  var COVER = {"]
    for fam, f in FONTS.items():
        cmap = TTFont(ROOT / "epinoia" / "kit" / "fonts" / f).getBestCmap()
        lines.append(f"    '{fam}': '{ranges(cmap)}',")
    lines.append("  };")
    lines.append("  " + END)
    return "\n".join(lines)


def main():
    src = TARGET.read_text(encoding="utf-8")
    new = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda m: table().lstrip(), src, flags=re.S)
    if "--check" in sys.argv:
        if new != src:
            print("epinoia/glyphs.js coverage table is stale: run python tools/font-coverage.py")
            sys.exit(1)
        print("glyph coverage table matches the fonts")
        return
    TARGET.write_text(new, encoding="utf-8", newline="\n")
    print("written", TARGET)


if __name__ == "__main__":
    main()
