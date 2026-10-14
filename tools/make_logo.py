"""Build the MarceauxMarceaux wordmark as SVG outlines from AT Crows.
Uses the font's kerning (HarfBuzz) and drops the dot contour on the 'r'.
Writes public/assets/logo.svg (standalone, lime) and prints the inline path data."""
import io, sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen

FONT = 'public/assets/fonts/AT-Crows-Regular.woff2'
WORD, LINE = 'Marceaux', 920          # line-height .92em, 1000 units per em
f = TTFont(FONT); f.flavor = None; buf = io.BytesIO(); f.save(buf)
gs, order = f.getGlyphSet(), f.getGlyphOrder()
font = hb.Font(hb.Face(buf.getvalue()))

def contours(name):
    p = DecomposingRecordingPen(gs); gs[name].draw(p)
    out, cur = [], []
    for op, a in p.value:
        cur.append((op, a))
        if op in ('closePath', 'endPath'): out.append(cur); cur = []
    return out

def is_r_dot(c):                       # the small detached blob, upper right of the r
    xs = [pt[0] for op, a in c for pt in a]; ys = [pt[1] for op, a in c for pt in a]
    return min(xs) > 900 and min(ys) > 450 and max(xs) - min(xs) < 200

b = hb.Buffer(); b.add_str(WORD); b.guess_segment_properties(); hb.shape(font, b)
width = sum(p.x_advance for p in b.glyph_positions)
# Second line: same letters, each nudged a touch (rotate degrees, lift in font units, scale)
# so the two lines read as hand-drawn twins rather than a copy-paste.
JITTER = [(-1.6, 12, 1.02), (2.2, -14, .98), (-1.2, 8, 1.0), (2.6, -10, 1.02),
          (-2.0, 14, .98), (1.6, -8, 1.01), (-2.4, 10, .99), (2.0, -12, 1.02)]
import math
STRENGTH = 1.4                             # 1.0 = original subtle pass
def nudge(i, line, x, base, name, adv):
    if line == 0: return (1, 0, 0, -1, x, base)
    deg, lift, s = JITTER[i]
    deg, lift, s = deg * STRENGTH, lift * STRENGTH, 1 + (s - 1) * STRENGTH
    a = math.radians(deg); c, sn = math.cos(a) * s, math.sin(a) * s
    cx, cy = adv / 2, 350                      # pivot: glyph centre, mid x-height
    # font->svg: translate(x, base) * flipY * T(cx,cy) * R * S * T(-cx,-cy), then lift
    xx, xy, yx, yy = c, sn, -sn, c             # rotation+scale in font space
    dx = cx - (xx * cx + yx * cy); dy = cy - (xy * cx + yy * cy) + lift
    return (xx, -xy, yx, -yy, x + dx, base - dy)
pen = SVGPathPen(gs, ntos=lambda v: ('%g' % round(v, 1)))
for line in range(2):
    base = LINE * line + (LINE - 1000) / 2 + 750      # baseline as CSS places it
    x = 0
    for i, (info, pos) in enumerate(zip(b.glyph_infos, b.glyph_positions)):
        name = order[info.codepoint]
        tp = TransformPen(pen, nudge(i, line, x + pos.x_offset, base - pos.y_offset, name, pos.x_advance))
        for c in contours(name):
            if name == 'r' and is_r_dot(c): continue
            for op, a in c: getattr(tp, op)(*a)
        x += pos.x_advance
d = pen.getCommands()
H = LINE * 2
open('public/assets/logo.svg', 'w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -60 {width+80} {H+120}" fill="#c6ff00">'
    f'<title>MarceauxMarceaux</title><path d="{d}"/></svg>\n')
open('tools/logo/inline.txt', 'w').write(
    f'<svg class="lockup__name" viewBox="0 0 {width} {H}" aria-hidden="true" focusable="false"><path fill="currentColor" d="{d}"/></svg>')
print(width, H, len(d))
