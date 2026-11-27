"""Render the hex buildings (windmills, lodges, mines, palisades, orc stockades...) with the village houses'
camera and flat materials: one 64x96 sprite per building type, ground point at (32, 80), hex radius 1 = 32 px.
Each is named `k_<building id>` (or `k_lair_<kind>` for a monster camp) and packed into the house sheet by
tools/pack_houses.py, next to the houses.
Run: REPO=$PWD OUT=<dir> Blender --background --factory-startup --python tools/blender/render_buildings.py
     (ONLY=k_mill,k_lair to render some)"""
import bpy, bmesh, math, os, json, random
from mathutils import Vector, Matrix
REPO = os.environ['REPO']; OUT = os.environ['OUT']
# the house helpers (and, through them, the tile renderer's camera, box, cone...), without their render loop
_hsrc = open(REPO + '/tools/blender/render_houses.py').read()
_hsrc = _hsrc[:_hsrc.index('\nSIZES=')]
_env_out = OUT
exec(compile(_hsrc, REPO + '/tools/blender/render_houses.py', 'exec'), globals())
OUT = _env_out

# ------------------------------------------------------------------ colours
DIRT = '#b89466'; DIRT2 = '#a07c50'; MUD = '#7c6440'
WOOD = ('#b07a48', '#8e5c32', '#643e20'); LOG = ('#9a6a3c', '#7a5028', '#56361a'); LOGEND = '#e0b880'
DKWOOD = ('#6e5038', '#54392a', '#3a271c')
BRICK = ('#d0704c', '#b05438', '#803a26'); CLAY = ('#c89060', '#a87048', '#7a5030')
ROCK = ('#a8a294', '#888274', '#5e5a50'); DARK = '#1c140e'; IRON = '#4a4a52'
CLOTH = ('#e8e0c8', '#cfc4a6', '#a89c80'); HIDE = ('#a07850', '#80603c', '#5a4028')
WATER = '#4f8fd8'; FIRE = ('#ffd060', '#f08020', '#c04010')
LEAF = ('#6cbc48', '#4c9c34', '#347424'); WHEAT = ('#f0d070', '#d8b450', '#a88430')
ORC = ('#5c4a3a', '#46382c', '#2e241c'); BONE = '#ece4cc'; RED = '#c8302c'


# ------------------------------------------------------------------ roofs with a dark band under the edge
EAVE_DROP = 0.06  # how far the dark band hangs below a roof's edge, where the roof meets the wall
def _band_colour(pal):
    c = pal[2].lstrip('#'); r, g, b = (int(c[i:i + 2], 16) for i in (0, 2, 4))
    return '#%02x%02x%02x' % (int(r * 0.55), int(g * 0.55), int(b * 0.55))
def _roof(name, verts, faces, pal, skirt):
    """A roof solid (as `solid`) plus a dark band hanging from the quads in `skirt` (pairs of top-edge points)."""
    bm = bmesh.new(); vs = [bm.verts.new(Vector(v)) for v in verts]
    for f in faces: bm.faces.new([vs[i] for i in f])
    bm.normal_update()
    for f in bm.faces: f.material_index = lvl(f.normal)
    for (p0, p1) in skirt:
        q = [bm.verts.new(Vector(p0)), bm.verts.new(Vector(p1)), bm.verts.new(Vector((p1[0], p1[1], p1[2] - EAVE_DROP))), bm.verts.new(Vector((p0[0], p0[1], p0[2] - EAVE_DROP)))]
        bm.faces.new(q).material_index = 3
    return link(bm, name, [mat(c) for c in tuple(pal) + (_band_colour(pal),)])
def gable(xe, ye, z0, z1, pal, hip=0.0, ends=True):
    xr = xe - hip
    verts = [(-xe, -ye, z0), (xe, -ye, z0), (xr, 0, z1), (-xr, 0, z1), (-xe, ye, z0), (xe, ye, z0)]
    faces = [(0, 1, 2, 3), (3, 2, 5, 4)] + ([(0, 3, 4), (1, 5, 2)] if ends else [])
    skirt = [((-xe, -ye, z0), (xe, -ye, z0)), ((xe, ye, z0), (-xe, ye, z0))] + ([((xe, -ye, z0), (xe, ye, z0)), ((-xe, ye, z0), (-xe, -ye, z0))] if ends else [])
    return _roof('roof', verts, faces, pal, skirt)
def pyramid(c, half, z0, z1, pal):
    x, y, _ = c
    v = [(x - half, y - half, z0), (x + half, y - half, z0), (x + half, y + half, z0), (x - half, y + half, z0), (x, y, z1)]
    sk = [(v[0], v[1]), (v[1], v[2]), (v[2], v[3]), (v[3], v[0])]
    return _roof('pyr', v, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], pal, sk)

# ------------------------------------------------------------------ helpers
def T(objs, dx, dy, rz=0.0):
    """Move (and turn) a group of objects already built about the origin."""
    m = Matrix.Translation((dx, dy, 0)) @ Matrix.Rotation(rz, 4, 'Z')
    for ob in objs: ob.matrix_world = m @ ob.matrix_world
    return objs
def tag(objs, **kw):
    """Mark objects: ground=1 (drawn under roads, walked over), pit=1 (under roads, not walked into), sail=1."""
    for ob in objs:
        for k, v in kw.items(): ob[k] = v
    return objs
def G(objs): return tag(objs, ground=1)
def patch(x, y, w, d, color, z=0.0, h=0.008):
    return [box((x, y, z), (w, d, h), color, (color, color, color))]
def pit(x, y, w, d, depth, col=ROCK, floor='#56524a'):
    """A hole dug into the ground: its floor and the three inner walls the camera sees (the front one faces away)."""
    x0, x1, y0, y1, zb = x - w / 2, x + w / 2, y - d / 2, y + d / 2, -depth
    o = [solid('pitfloor', [(x0, y0, zb), (x1, y0, zb), (x1, y1, zb), (x0, y1, zb)], [(0, 1, 2, 3)], (floor, floor, floor)),
         solid('pitback', [(x0, y1, zb), (x1, y1, zb), (x1, y1, 0), (x0, y1, 0)], [(0, 1, 2, 3)], (col[0], col[0], col[0])),
         solid('pitleft', [(x0, y0, zb), (x0, y1, zb), (x0, y1, 0), (x0, y0, 0)], [(3, 2, 1, 0)], (col[0], col[0], col[0])),
         solid('pitright', [(x1, y0, zb), (x1, y1, zb), (x1, y1, 0), (x1, y0, 0)], [(0, 1, 2, 3)], (col[2], col[2], col[2]))]
    o.append(box((x, y0 - 0.012, 0), (w + 0.02, 0.024, 0.006), '#5a4632', ('#5a4632',) * 3))  # the near lip, worn bare
    return tag(o, pit=1)
def hut(x, y, A, B, h, r, roof='thatch', wall=PLASTER, timber=0, face='long', chim=1, hip=None, rz=0.0, open_=False):
    spec = dict(kind='cottage', A=A, B=B, h=h, r=r, roof=roof, timber=timber, hip=(roof == 'thatch') if hip is None else hip,
                face=face, chim=chim, dx=0.0, wall=wall, open=open_)
    return T(house(spec), x, y, rz)
def hall(x, y, A, B, h1, h2, r, roof='slate', wall=PLASTER, chim=1):
    return T(house(dict(kind='hall', A=A, B=B, h=h1 + h2, h1=h1, r=r, roof=roof, timber=1, hip=False, face='long', chim=chim, dx=0.0, wall=wall)), x, y)
def nochim_hut(x, y, A, B, h, r, roof, wall):
    """A plain wall box under a gable roof, no chimney or windows (sheds, barns)."""
    return [box((x, y, 0), (2 * A, 2 * B, h), wall[1], wall)] + T([gable(A + 0.03, B + 0.04, h - 0.01, h + r, ROOFS[roof] if isinstance(roof, str) else roof)], x, y)
def shed(x, y, A, B, h, r, roof='shingle', posts=WOOD, back=True):
    """An open-fronted shed: posts at the front, a back wall, a gable roof."""
    o = []
    for sx in (-A, A):
        o.append(bar((x + sx, y - B, 0), (x + sx, y - B, h), 0.022, posts[1]))
    if back: o.append(box((x, y + B - 0.02, 0), (2 * A, 0.04, h), posts[1], posts))
    o.append(box((x - A + 0.01, y, 0), (0.03, 2 * B, h), posts[0], posts))
    o += T([gable(A + 0.04, B + 0.05, h - 0.01, h + r, ROOFS[roof])], x, y)
    return o
def logs(x, y, n=3, L=0.32, t=0.05, axis='x'):
    """A pile of logs, n on the bottom row, ends showing."""
    o = []; k = 0
    for row in range(n):
        for j in range(n - row):
            off = (j - (n - row - 1) / 2) * t * 1.05
            z = row * t * 0.9
            if axis == 'x': o.append(box((x, y + off, z), (L, t, t), LOG[0], (LOGEND, LOG[1], LOGEND)))
            else: o.append(box((x + off, y, z), (t, L, t), LOG[0], (LOG[0], LOGEND, LOG[2])))
    return o
def planks(x, y, n=4, L=0.28):
    return [box((x, y, k * 0.018), (L, 0.11, 0.016), '#e2b47c', ('#d0a068', '#b88048', '#906030')) for k in range(n)]
def crate(x, y, s=0.07, z=0.0):
    return [box((x, y, z), (s, s, s), '#c89058', ('#b07a48', '#9a6a3c', '#7a5028'))]
def barrel(x, y, r=0.035, h=0.075, col=WOOD, z=0.0):
    return [cone((x, y, z), r * 0.9, h / 2, col[1], segs=8, r_top=r, shade=(col[0], col[2])),
            cone((x, y, z + h / 2), r, h / 2, col[1], segs=8, r_top=r * 0.9, shade=(col[0], col[2]))]
def sack(x, y, s=0.04, col=CLOTH):
    return [cone((x, y, 0), s, s * 1.4, col[1], segs=6, r_top=s * 0.5, shade=(col[0], col[2]))]
def stump(x, y, r=0.03):
    return [cone((x, y, 0), r, 0.03, LOG[1], segs=6, r_top=r * 0.9, shade=(LOG[0], LOG[2]))]
def stake(x, y, h=0.22, t=0.04, col=LOG, lean=0.0):
    tip = h + t * 1.2
    o = [box((x, y, 0), (t, t, h), col[0], col)]
    o.append(pyramid((x, y, 0), t / 2, h, tip, col))
    return o
def pine(x, y, s=1.0):
    return [cone((x, y, 0), 0.02 * s, 0.08 * s, LOG[1], segs=4),
            cone((x, y, 0.05 * s), 0.12 * s, 0.22 * s, LEAF[1], segs=6, shade=(LEAF[0], LEAF[2])),
            cone((x, y, 0.16 * s), 0.085 * s, 0.18 * s, LEAF[1], segs=6, shade=(LEAF[0], LEAF[2]))]
def broadleaf(x, y, s=1.0, fruit=None):
    o = [cone((x, y, 0), 0.022 * s, 0.12 * s, LOG[1], segs=4)]
    o += _blob((x, y, 0.08 * s), 0.11 * s, 0.17 * s, LEAF)
    if fruit:
        rnd = random.Random(int(x * 1000 + y * 100))
        for k in range(5):
            a = rnd.uniform(-2.6, -0.4); rr = 0.1 * s
            o.append(box((x + math.cos(a) * rr, y + math.sin(a) * rr * 0.6, 0.12 * s + rnd.uniform(0, 0.08) * s), (0.018, 0.018, 0.018), fruit, (fruit, fruit, fruit)))
    return o
def _blob(loc, r, h, col, segs=8):
    x, y, z = loc
    return [cone((x, y, z), r * 0.75, h * 0.35, col[1], segs=segs, r_top=r, shade=(col[0], col[2])),
            cone((x, y, z + h * 0.35), r, h * 0.65, col[1], segs=segs, r_top=r * 0.55, shade=(col[0], col[2]))]
def mound(x, y, r, h, col, segs=8, top=0.35):
    return [cone((x, y, 0), r, h, col[1], segs=segs, r_top=r * top, shade=(col[0], col[2]))]
def fire(x, y, s=1.0):
    o = []
    for k in range(6):
        a = k * math.pi / 3
        o.append(box((x + math.cos(a) * 0.04 * s, y + math.sin(a) * 0.04 * s, 0), (0.02 * s, 0.02 * s, 0.015 * s), ROCK[0], ROCK))
    o.append(cone((x, y, 0), 0.03 * s, 0.07 * s, FIRE[1], segs=5, shade=(FIRE[0], FIRE[2])))
    return o
def fence(pts, h=0.07, col=WOOD, closed=True, gaps=()):
    """Posts at each point, two rails between neighbours (skipping the gaps: indices of edges left open)."""
    o = []; n = len(pts)
    for (x, y) in pts: o.append(bar((x, y, 0), (x, y, h + 0.01), 0.016, col[2]))
    for i in range(n if closed else n - 1):
        if i in gaps: continue
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        for z in (h * 0.45, h):
            o.append(bar((x0, y0, z), (x1, y1, z), 0.01, col[0]))
    return o
def ring(r, n, sy=0.9, start=0.0):
    return [(r * math.cos(start + 2 * math.pi * k / n), r * sy * math.sin(start + 2 * math.pi * k / n)) for k in range(n)]
def rect(x0, y0, x1, y1, step=0.12):
    """Points round a rectangle, one every `step`."""
    pts = []
    for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        L = math.hypot(bx - ax, by - ay); k = max(1, round(L / step))
        pts += [(ax + (bx - ax) * j / k, ay + (by - ay) * j / k) for j in range(k)]
    return pts
def wheel(x, y, z, R, w=0.04, plane='xz', col=WOOD, spokes=8, paddles=True):
    """A wheel standing upright: in the x-z plane (facing the camera) or the y-z plane (side on)."""
    o = []
    def P(a, r):
        return (x + math.cos(a) * r, y, z + math.sin(a) * r) if plane == 'xz' else (x, y + math.cos(a) * r, z + math.sin(a) * r)
    segs = 12
    for k in range(segs):
        a0, a1 = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
        o.append(bar(P(a0, R), P(a1, R), 0.016, col[1]))
    for k in range(spokes):
        a = 2 * math.pi * k / spokes + 0.2
        o.append(bar(P(a, 0), P(a, R), 0.01, col[2]))
        if paddles:
            p0, p1 = P(a, R * 0.8), P(a, R * 1.12)
            if plane == 'xz': o.append(box(((p0[0] + p1[0]) / 2, y, (p0[2] + p1[2]) / 2 - w / 2), (0.02, w, w), col[0], col))
            else: o.append(box((x, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2 - w / 2), (w, 0.02, w), col[0], col))
    return o
def chimney(x, y, z0, h, w=0.05, col=STONE):
    return [box((x, y, z0), (w, w, h), col[1], col)]
def stairs_rock(x, y, w, d, steps, hs, col=ROCK):
    """A quarry face: stepped terraces cut back into the rock."""
    o = []
    for k in range(steps):
        o.append(box((x, y + k * d * 0.5 + d * 0.25 * k, 0), (w - k * 0.06, d, hs * (k + 1)), col[0], col))
    return o
def flag(x, y, z, col=RED, h=0.3, w=0.12):
    o = [bar((x, y, z), (x, y, z + h), 0.012, DKWOOD[1])]
    o.append(solid('flag', [(x, y, z + h), (x, y, z + h - 0.09), (x + w, y, z + h - 0.045), (x, y + 0.004, z + h), (x, y + 0.004, z + h - 0.09), (x + w, y + 0.004, z + h - 0.045)], [(0, 1, 2), (5, 4, 3)], (col, col, col)))
    return o
def tent(x, y, r=0.13, h=0.2, col=CLOTH, segs=4, rot=0.785):
    return [cone((x, y, 0), r, h, col[1], segs=segs, rot=rot, shade=(col[0], col[2]))]
def lean_to(x, y, w=0.24, d=0.16, h=0.16, col=LOG, roof=ROOFS['thatch']):
    """Poles leaning on a ridge: a forager's shelter."""
    o = [bar((x - w / 2, y + d / 2, 0), (x - w / 2, y + d / 2, h), 0.016, col[1]), bar((x + w / 2, y + d / 2, 0), (x + w / 2, y + d / 2, h), 0.016, col[1])]
    o.append(solid('lean', [(x - w / 2 - 0.02, y - d / 2, 0.0), (x + w / 2 + 0.02, y - d / 2, 0.0), (x + w / 2 + 0.02, y + d / 2 + 0.02, h + 0.02), (x - w / 2 - 0.02, y + d / 2 + 0.02, h + 0.02)], [(0, 1, 2, 3)], roof))
    return o
def cart(x, y, col=WOOD):
    o = [box((x, y, 0.035), (0.16, 0.09, 0.035), col[0], col)]
    for sx in (-0.045, 0.045): o += wheel(x + sx, y - 0.05, 0.035, 0.032, plane='xz', col=DKWOOD, spokes=4, paddles=False)
    o.append(bar((x - 0.08, y, 0.05), (x - 0.18, y, 0.035), 0.01, col[2]))
    return o
def rails(x0, y0, x1, y1, w=0.05):
    o = []
    for s in (-1, 1): o.append(bar((x0 + s * w / 2, y0, 0.004), (x1 + s * w / 2, y1, 0.004), 0.008, IRON))
    n = int(math.hypot(x1 - x0, y1 - y0) / 0.05)
    for k in range(n + 1):
        t = k / max(1, n); cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        o.append(box((cx, cy, 0), (w + 0.03, 0.012, 0.006), DKWOOD[0], DKWOOD))
    return o
def minecart(x, y, ore):
    return [box((x, y, 0.012), (0.08, 0.06, 0.05), IRON, ('#5c5c66', '#4a4a52', '#36363c')), box((x, y, 0.05), (0.066, 0.046, 0.016), ore[0], ore)]
def ore_col(name):
    return {'copper': ('#58b890', '#3c9070', '#2a6850'), 'iron': ('#b06040', '#8a4630', '#5e3020'), 'silver': ('#e0e4ec', '#b4bcc8', '#848c9a'),
            'stone': ROCK, 'coal': ('#4a4a4a', '#333333', '#222222')}[name]

# ------------------------------------------------------------------ the buildings
def b_house(_):  # the old row of cottages
    o = hut(-0.34, 0.26, 0.2, 0.15, 0.26, 0.14, 'thatch') + hut(0.36, 0.26, 0.2, 0.15, 0.26, 0.14, 'shingle', PLASTER2, 1)
    return o + hut(0.0, -0.22, 0.22, 0.16, 0.27, 0.15, 'tile', WHITE, chim=-1) + G(patch(0, 0.05, 0.5, 0.06, DIRT))
def b_granary(_):  # round granary on staddle stones
    o = []
    for (x, y) in ring(0.18, 6, 1.0): o.append(cone((x, y, 0), 0.03, 0.08, STONE[1], segs=5, r_top=0.012, shade=(STONE[0], STONE[2])))
    o.append(cone((0, 0, 0.08), 0.24, 0.26, PLANK[1], segs=10, r_top=0.24, shade=(PLANK[0], PLANK[2])))
    o.append(cone((0, 0, 0.33), 0.3, 0.26, ROOFS['thatch'][1], segs=10, shade=(ROOFS['thatch'][0], ROOFS['thatch'][2])))
    o.append(box((0, -0.235, 0.12), (0.08, 0.02, 0.13), DOORC, (DOORC,) * 3))
    return o + sack(0.36, -0.2) + sack(0.44, -0.12) + barrel(-0.38, -0.18)
def b_palisade(_):  # a ring of sharpened stakes with a gate and a watchtower
    o = []
    for k, (x, y) in enumerate(ring(0.62, 30, 0.86, 0.1)):
        if -0.13 < x < 0.13: continue  # the gates, front and back
        o += stake(x, y, 0.2 + 0.03 * ((k * 7) % 3) / 2, 0.045)
    for gy in (-0.53, 0.53):
        for sx in (-0.14, 0.14): o.append(bar((sx, gy, 0), (sx, gy, 0.3), 0.04, LOG[1]))
        o.append(bar((-0.17, gy, 0.29), (0.17, gy, 0.29), 0.04, LOG[0]))
    # watchtower at the back
    tx, ty = 0.32, 0.18
    for (dx, dy) in ((-0.08, -0.08), (0.08, -0.08), (-0.08, 0.08), (0.08, 0.08)): o.append(bar((tx + dx, ty + dy, 0), (tx + dx * 0.8, ty + dy * 0.8, 0.5), 0.045, LOG[1]))
    o.append(box((tx, ty, 0.5), (0.2, 0.2, 0.03), PLANK[0], PLANK))
    for sx in (-1, 1): o.append(box((tx + sx * 0.095, ty, 0.53), (0.012, 0.2, 0.06), PLANK[1], PLANK))
    o.append(box((tx, ty - 0.095, 0.53), (0.2, 0.012, 0.06), PLANK[1], PLANK))
    o.append(pyramid((tx, ty, 0), 0.14, 0.64, 0.8, ROOFS['shingle']))
    return o + hut(-0.3, 0.12, 0.17, 0.13, 0.22, 0.12, 'thatch') + logs(-0.32, -0.25, 2, 0.18, 0.045)
def b_chapel(_):  # small stone chapel with a bell-cote
    CST = ('#efe6cc', '#c9bc9c', '#8a7d62')
    o = [box((0, 0.05, 0), (0.62, 0.36, 0.26), CST[1], CST), gable(0.34, 0.22, 0.25, 0.46, ROOFS['slate'])]
    o[-1].location.y += 0.05
    o.append(box((-0.31, 0.05, 0), (0.1, 0.12, 0.62), CST[1], CST)); o.append(box((-0.31, -0.02, 0.48), (0.05, 0.02, 0.07), DARK, (DARK,) * 3))
    o.append(pyramid((-0.31, 0.05, 0), 0.075, 0.62, 0.74, ROOFS['slate'])); o.append(bar((-0.31, 0.05, 0.74), (-0.31, 0.05, 0.84), 0.014, '#f4ecd0'))
    o.append(bar((-0.345, 0.05, 0.8), (-0.275, 0.05, 0.8), 0.014, '#f4ecd0'))
    o.append(box((-0.31, -0.13, 0), (0.08, 0.02, 0.14), DOORC, (DOORC,) * 3))
    for wx in (-0.08, 0.1, 0.25): o.append(box((wx, -0.135, 0.1), (0.035, 0.02, 0.09), '#6f93d8', ('#6f93d8',) * 3))
    for (x, y) in ((0.45, -0.25), (0.55, -0.1), (0.38, -0.4)):  # graveyard
        o.append(box((x, y, 0), (0.04, 0.012, 0.06), STONE[0], STONE))
    return o + broadleaf(0.5, 0.35, 1.1)
def b_library(_):  # a stone hall of learning, tall windows and a scriptorium tower
    o = hall(-0.08, 0.05, 0.4, 0.22, 0.3, 0.16, 0.18, 'slate', WHITE)
    o.append(box((0.45, 0.1, 0), (0.22, 0.22, 0.62), STONE[1], STONE)); o.append(pyramid((0.45, 0.1, 0), 0.14, 0.62, 0.85, ROOFS['slate']))
    for wz in (0.18, 0.42): o.append(box((0.38, -0.012, wz), (0.04, 0.02, 0.08), WINC, (WINC,) * 3))
    return o + patch(-0.08, -0.32, 0.3, 0.14, STONE[0]) + broadleaf(-0.6, -0.2, 0.9)
def b_market(_):  # stalls round a square (on the city's cobbles)
    o = []
    for (x, y, c) in ((-0.3, 0.2, '#d83a34'), (0.3, 0.22, '#3a6ec8'), (-0.32, -0.25, '#e0a020'), (0.32, -0.22, '#4aa050')):
        o += T(stall(dict(color=c)), x, y)
    o += barrel(0.0, 0.05) + barrel(0.06, 0.0) + crate(-0.05, -0.05) + sack(0.0, -0.4)
    return o
def b_garden(_):  # vegetable plots, fenced, with a tool shed
    o = []
    for k, y in enumerate((-0.3, -0.13, 0.04, 0.21)):
        o += G(patch(-0.12, y, 0.66, 0.11, MUD))
        for j in range(6):
            col = LEAF if k % 2 else ('#8ccc58', '#6cac40', '#4c8c2c')
            o += G([cone((-0.39 + j * 0.108, y, 0.008), 0.03, 0.04, col[1], segs=5, shade=(col[0], col[2]))])
    o += fence(rect(-0.5, -0.42, 0.26, 0.32, 0.13), gaps=(0,))
    return o + nochim_hut(0.45, 0.1, 0.11, 0.09, 0.15, 0.09, 'shingle', PLANK) + barrel(0.42, -0.18)
def b_field(_):  # wheat in rows, a scarecrow
    o = []
    for k, y in enumerate((-0.5, -0.3, -0.1, 0.1, 0.3, 0.5)):
        w = 1.5 - abs(y) * 1.3
        o += G([box((0, y, 0), (w, 0.15, 0.05), WHEAT[0] if k % 2 == 0 else '#e8c460', (WHEAT[1], WHEAT[1], WHEAT[2]))])
    o.append(bar((0.2, -0.05, 0.0), (0.2, -0.05, 0.2), 0.014, LOG[1])); o.append(bar((0.14, -0.05, 0.15), (0.26, -0.05, 0.15), 0.012, LOG[1]))
    o.append(box((0.2, -0.05, 0.12), (0.05, 0.03, 0.06), '#5070b0', ('#5070b0',) * 3)); o.append(cone((0.2, -0.05, 0.19), 0.04, 0.04, WHEAT[1], segs=6))
    return o
def b_irrigation(_):  # fields between water channels, a shaduf at the corner
    o = b_field(None)
    for y in (-0.2, 0.2): o.append(box((0, y, 0), (1.4 - abs(y) * 1.3, 0.04, 0.012), WATER, (WATER, '#3a70b8', '#2c5c9c')))
    o.append(box((0, 0, 0), (0.04, 1.0, 0.012), WATER, (WATER, '#3a70b8', '#2c5c9c')))
    o.append(bar((-0.62, 0.0, 0), (-0.62, 0.0, 0.2), 0.02, LOG[1])); o.append(bar((-0.75, 0.0, 0.05), (-0.45, 0.0, 0.3), 0.012, LOG[0]))
    return o
def b_orchard(_):
    o = patch(0, 0, 1.2, 0.8, '#90cc58')
    for (x, y) in ((-0.45, 0.3), (0.0, 0.32), (0.45, 0.3), (-0.45, -0.05), (0.0, -0.05), (0.45, -0.05), (-0.25, -0.38), (0.25, -0.38)):
        o += broadleaf(x, y, 0.95, fruit='#e03c30')
    return o + crate(0.62, -0.32) + crate(0.66, -0.25, z=0.0)
MILL = (-0.12, 0.08, 0.75)  # the tower's x, y and the height of the sails' hub
def b_mill(_):  # windmill tower and bakery (the sails are drawn by mill_sails, turning)
    tx, ty, hz = MILL
    o = [cone((tx, ty, 0), 0.22, hz, STONE[1], segs=8, r_top=0.15, shade=(STONE[0], STONE[2])),
         cone((tx, ty, hz), 0.19, 0.2, ROOFS['shingle'][1], segs=8, shade=(ROOFS['shingle'][0], ROOFS['shingle'][2]))]
    o.append(box((tx, ty - 0.215, 0.0), (0.08, 0.02, 0.15), DOORC, (DOORC,) * 3)); o.append(box((tx + 0.07, ty - 0.18, 0.42), (0.04, 0.02, 0.05), WINC, (WINC,) * 3))
    o.append(box((tx, ty - 0.2, hz - 0.03), (0.05, 0.06, 0.05), DKWOOD[0], DKWOOD))  # the windshaft
    o += hut(0.45, 0.3, 0.2, 0.15, 0.23, 0.13, 'tile', WHITE, 1)
    return o
SAIL_FRAMES = 48  # over a quarter turn (the four sails look the same every 90 degrees)
def mill_sails(turn):
    """The four sails at `turn` (0..1 of a quarter turn), standing in front of the tower."""
    tx, ty, hz = MILL; hy = ty - 0.25; R = 0.6; o = []
    o.append(box((tx, hy, hz - 0.03), (0.05, 0.04, 0.06), DKWOOD[0], DKWOOD))
    for k in range(4):
        a = math.radians(20 + 90 * k) - turn * math.pi / 2  # clockwise, seen from the front
        ex, ez = tx + math.cos(a) * R, hz + math.sin(a) * R
        o.append(bar((tx, hy - 0.01, hz), (ex, hy - 0.01, ez), 0.03, DKWOOD[1]))
        pa = a + math.pi / 2; w = 0.1
        pts = [(tx + math.cos(a) * r0 + math.cos(pa) * w * f, hy - 0.02, hz + math.sin(a) * r0 + math.sin(pa) * w * f) for (r0, f) in ((0.14, 0), (R - 0.01, 0), (R - 0.01, 1), (0.14, 1))]
        o.append(solid('sail', pts, [(3, 2, 1, 0)], ('#f4ecd8', '#f4ecd8', '#f4ecd8')))
        for r0 in (0.26, 0.38, 0.5):
            o.append(bar((tx + math.cos(a) * r0, hy - 0.025, hz + math.sin(a) * r0), (tx + math.cos(a) * r0 + math.cos(pa) * w, hy - 0.025, hz + math.sin(a) * r0 + math.sin(pa) * w), 0.006, DKWOOD[2]))
    return o
def b_shore_fishery(_):  # hut, drying racks, a boat pulled up
    o = hut(-0.3, 0.2, 0.2, 0.15, 0.22, 0.13, 'thatch')
    for x in (0.12, 0.38):
        for sx in (-0.1, 0.1): o.append(bar((x + sx, 0.05, 0), (x + sx, 0.05, 0.18), 0.012, LOG[1]))
        o.append(bar((x - 0.12, 0.05, 0.18), (x + 0.12, 0.05, 0.18), 0.01, LOG[0]))
        for k in range(4): o.append(box((x - 0.075 + k * 0.05, 0.05, 0.1), (0.014, 0.01, 0.07), '#a8b8c8', ('#a8b8c8',) * 3))
    o.append(cone((0.1, -0.4, 0.0), 0.12, 0.06, '#8a5a30', segs=4, r_top=0.17, shade=('#a87040', '#6a4020')))
    o[-1].scale = (1.4, 0.5, 1)
    return o + barrel(-0.4, -0.15) + barrel(-0.33, -0.2)
DECK = 0.14  # how high a pier's deck stands above the water
SHADOW = '#2f67b0'  # the shade a pier throws on the water
def lift(objs, dz):
    for ob in objs: ob.matrix_world = Matrix.Translation((0, 0, dz)) @ ob.matrix_world
    return objs
def place(objs, x, y, rz=0.0):
    """Put objects built about the origin (and not yet moved) at (x, y), turned by rz."""
    for ob in objs: ob.rotation_euler = (0, 0, rz); ob.location = (x, y, 0)
    return objs
def _deck(x0, y0, x1, y1, w=0.18):
    """A plank walkway on posts, standing clear of the water (walked along: ground layer), with its shadow on the water."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sx, sy = abs(x1 - x0) + w, abs(y1 - y0) + w
    o = G([box((cx, cy, DECK), (sx, sy, 0.03), PLANK[0], PLANK)])
    o += G([box((cx, cy - 0.04, 0.003), (sx + 0.05, sy + 0.05, 0.004), SHADOW, (SHADOW,) * 3)])
    n = max(1, round(max(sx, sy) / 0.3))
    for k in range(n + 1):
        t = k / n
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for sg in (-1, 1):
            qx, qy = (px + sg * (w / 2 - 0.02), py) if x0 == x1 else (px, py + sg * (w / 2 - 0.02))
            o += G([bar((qx, qy, 0.0), (qx, qy, DECK + 0.01), 0.026, LOG[1])])
    return o
def _boat(L=0.3, mast=False):
    o = [cone((0, 0, 0.0), 0.1, 0.07, '#8a5a30', segs=4, r_top=0.14, shade=('#a87040', '#6a4020'))]
    o[0].scale = (L / 0.2, 0.45, 1)
    if mast:
        o.append(bar((0, 0, 0.06), (0, 0, 0.45), 0.014, DKWOOD[1]))
        o.append(solid('sail', [(-0.005, -0.01, 0.12), (-0.005, -0.01, 0.42), (0.16, -0.01, 0.14)], [(0, 1, 2)], CLOTH))
    return o
def b_docks(_):  # a pier from the shore (land is the +y edge; rotated for the other five), a boat moored alongside
    o = _deck(0, 0.87, 0, -0.3) + _deck(-0.3, -0.3, 0.3, -0.3)
    o += place(_boat(0.38, True), 0.3, 0.2, math.pi / 2) + place(_boat(0.26), -0.29, 0.5, math.pi / 2)
    o += lift(crate(-0.04, 0.6) + crate(0.04, 0.55) + barrel(0.0, 0.42, z=0.0), DECK + 0.03)
    return o
def b_shipyard(_):  # a hull on a slipway of planks standing out from the shore (land is the +y edge)
    o = _deck(0, 0.87, 0, -0.25, 0.5)
    hull = []
    for k in range(9):
        y = -0.18 + k * 0.065; s = 1 - abs(k - 4) / 6
        for sx in (-1, 1): hull.append(bar((0, y, 0.04), (sx * 0.14 * s, y, 0.22 * s + 0.05), 0.016, PLANK[1]))
    hull.append(bar((0, -0.22, 0.04), (0, 0.38, 0.04), 0.03, LOG[1]))
    hull.append(solid('hull', [(-0.12, -0.18, 0.08), (-0.13, 0.33, 0.08), (-0.15, 0.33, 0.22), (-0.13, -0.15, 0.21)], [(0, 1, 2, 3)], WOOD))
    o += lift(hull, DECK + 0.03)
    o += lift(planks(0.2, 0.45, 4, 0.14), DECK + 0.03)
    return o
def b_smokehouse(_):
    o = nochim_hut(-0.1, 0.12, 0.22, 0.17, 0.3, 0.15, 'shingle', DKWOOD)
    o += chimney(0.05, 0.12, 0.3, 0.2, 0.06) + [box((-0.1, -0.06, 0), (0.08, 0.02, 0.16), DARK, (DARK,) * 3)]
    for sx in (-0.1, 0.1): o.append(bar((0.38 + sx, -0.15, 0), (0.38 + sx, -0.15, 0.16), 0.012, LOG[1]))
    o.append(bar((0.26, -0.15, 0.16), (0.5, -0.15, 0.16), 0.01, LOG[0]))
    for k in range(4): o.append(box((0.31 + k * 0.05, -0.15, 0.09), (0.016, 0.01, 0.065), '#c88850', ('#c88850',) * 3))
    return o + logs(-0.45, -0.2, 2, 0.2, 0.045) + barrel(0.2, -0.38)
def b_salt_pans(_):  # shallow pans, some white with salt, and a heap
    o = []
    for j, y in enumerate((-0.35, -0.08, 0.19)):
        for k, x in enumerate((-0.42, -0.14, 0.14, 0.42)):
            o.append(box((x, y, 0), (0.24, 0.22, 0.02), CLAY[1], CLAY))
            c = '#f4f4f0' if (j + k) % 3 == 0 else ('#c8e0f0' if (j + k) % 3 == 1 else '#7fb6e8')
            o.append(box((x, y, 0.012), (0.2, 0.18, 0.012), c, (c, c, c)))
    o += mound(0.35, 0.45, 0.12, 0.12, ('#ffffff', '#ecece8', '#c8c8c0'), segs=6, top=0.2)
    return o + sack(-0.4, 0.42) + sack(-0.33, 0.45)
def b_quarry(_):  # a pit cut into the ground, blocks stacked beside it, a derrick over it
    o = pit(0.05, 0.22, 0.7, 0.4, 0.22) + tag([box((0.05, 0.36, -0.22), (0.66, 0.1, 0.1), ROCK[0], ROCK)], pit=1)
    o += tag([box((-0.1, 0.1, -0.22), (0.12, 0.08, 0.06), STONE[0], STONE)], pit=1)
    for (x, y) in ((-0.45, -0.25), (-0.33, -0.27), (-0.39, -0.17)): o.append(box((x, y, 0), (0.1, 0.08, 0.07), STONE[0], STONE))
    o.append(box((-0.39, -0.25, 0.07), (0.1, 0.08, 0.07), STONE[0], STONE))
    dx, dy = 0.5, -0.12
    o.append(bar((dx, dy, 0), (dx, dy, 0.5), 0.03, LOG[1])); o.append(bar((dx, dy, 0.48), (0.15, 0.15, 0.52), 0.022, LOG[0]))
    o.append(bar((0.15, 0.15, 0.52), (0.15, 0.15, 0.1), 0.004, '#3a3a3a')); o.append(box((0.15, 0.15, 0.03), (0.08, 0.07, 0.07), STONE[0], STONE))
    for (a, b) in (((dx - 0.1, dy - 0.08), (dx, dy)), ((dx + 0.1, dy - 0.08), (dx, dy))): o.append(bar((a[0], a[1], 0), (b[0], b[1], 0.3), 0.016, LOG[2]))
    return o + cart(0.05, -0.38)
def b_kiln(_):  # bottle kiln and stacks of bricks
    o = [cone((0.1, 0.12, 0), 0.24, 0.3, BRICK[1], segs=10, r_top=0.2, shade=(BRICK[0], BRICK[2])),
         cone((0.1, 0.12, 0.3), 0.2, 0.25, BRICK[1], segs=10, r_top=0.07, shade=(BRICK[0], BRICK[2])),
         cone((0.1, 0.12, 0.55), 0.07, 0.08, BRICK[1], segs=10, r_top=0.08, shade=(BRICK[0], BRICK[2]))]
    o.append(box((0.1, -0.11, 0), (0.08, 0.03, 0.1), '#3a1a10', ('#3a1a10',) * 3)); o.append(cone((0.1, -0.13, 0), 0.025, 0.04, FIRE[1], segs=4))
    for (x, y) in ((-0.42, -0.2), (-0.42, 0.08), (-0.22, -0.32)):
        o.append(box((x, y, 0), (0.14, 0.12, 0.12), BRICK[0], BRICK))
    return o + logs(0.45, -0.25, 2, 0.2, 0.045) + mound(0.5, 0.35, 0.1, 0.06, CLAY)
def shaft(x, y, s=0.2):
    """A shaft: a log collar round a dark hole, a windlass over it with its rope and bucket."""
    o = tag([box((x, y, -0.004), (s - 0.04, s - 0.04, 0.008), DARK, (DARK,) * 3)], pit=1)
    for (cx, cy, w, d) in ((x, y - s / 2, s + 0.04, 0.04), (x, y + s / 2, s + 0.04, 0.04), (x - s / 2, y, 0.04, s), (x + s / 2, y, 0.04, s)):
        o.append(box((cx, cy, 0), (w, d, 0.04), LOG[0], LOG))
    for sx in (-1, 1): o.append(bar((x + sx * s * 0.55, y, 0), (x + sx * s * 0.55, y, 0.2), 0.025, LOG[1]))
    o.append(bar((x - s * 0.62, y, 0.18), (x + s * 0.62, y, 0.18), 0.03, LOG[0]))
    o.append(bar((x + s * 0.62, y, 0.18), (x + s * 0.62, y - 0.06, 0.12), 0.012, DKWOOD[2]))  # the crank
    o.append(bar((x, y, 0.17), (x, y, 0.06), 0.004, '#2a2a2a')); o.append(cone((x, y, 0.03), 0.025, 0.035, WOOD[1], segs=6, r_top=0.03))
    return o
def _mine(ore):
    oc = ore_col(ore)
    o = shaft(-0.05, 0.12)
    o += mound(0.42, 0.18, 0.13, 0.08, oc, segs=6, top=0.2) + mound(-0.45, 0.2, 0.11, 0.06, ROCK, segs=6, top=0.2)
    o += G(rails(-0.05, -0.02, 0.15, -0.5)) + minecart(0.1, -0.38, oc)
    return o + logs(-0.45, -0.22, 2, 0.18, 0.04, 'y') + T(lantern(), 0.1, -0.02)
def portal(ore, w=0.24, h=0.22):
    """A mine's way in on a mountainside: a timber frame round a dark opening, a little spoil tipped below.
    Drawn on the mountain at the height of its slope there, so it makes no hill of its own."""
    oc = ore_col(ore)
    o = [box((0, 0.02, 0), (w, 0.03, h), DARK, (DARK,) * 3)]
    for sx in (-w / 2, w / 2): o.append(bar((sx, -0.005, 0), (sx, -0.005, h + 0.01), 0.04, LOG[1]))
    o.append(bar((-w / 2 - 0.05, -0.005, h + 0.015), (w / 2 + 0.05, -0.005, h + 0.015), 0.045, LOG[0]))
    o.append(cone((0.2, -0.08, 0), 0.1, 0.05, oc[1], segs=6, r_top=0.015, shade=(oc[0], oc[2])))
    return o + T(lantern(), -0.18, -0.04)
def lantern():
    return [bar((0, 0, 0), (0, 0, 0.12), 0.01, DKWOOD[1]), box((0, 0, 0.12), (0.025, 0.025, 0.03), '#ffd060', ('#ffd060',) * 3)]
def b_copper_mine(_): return _mine('copper') + nochim_hut(0.5, -0.15, 0.13, 0.1, 0.15, 0.09, 'shingle', PLANK)
def b_silver_mine(_):
    o = _mine('silver')
    o += [box((0.45 - k * 0.12, -0.12 - k * 0.04, 0.0), (0.14, 0.05, 0.03 + k * 0.03), PLANK[1], PLANK) for k in range(3)]  # sluice
    return o
def b_copper_mine_slope(_): return portal('copper')
def b_silver_mine_slope(_): return portal('silver')
def b_iron_mine_slope(_): return portal('iron', 0.27, 0.24)
def b_quarry_slope(_):  # blocks cut from the mountainside, stacked on a ledge
    o = [box((-0.05, 0, 0), (0.1, 0.08, 0.07), STONE[0], STONE), box((0.07, 0.0, 0), (0.1, 0.08, 0.07), STONE[0], STONE), box((0.01, 0.0, 0.07), (0.1, 0.08, 0.07), STONE[0], STONE)]
    o += [bar((-0.18, 0.02, 0), (-0.18, 0.02, 0.3), 0.025, LOG[1]), bar((-0.18, 0.02, 0.29), (0.05, 0.05, 0.32), 0.02, LOG[0])]
    return o
def b_iron_mine(_):  # a deep mine: headframe and winding wheel over a shaft
    o = G(patch(0, -0.05, 0.9, 0.7, '#8a7a64'))
    sx, sy = -0.05, 0.05
    o.append(box((sx, sy, 0), (0.24, 0.24, 0.04), LOG[0], LOG)); o += tag([box((sx, sy, 0.035), (0.16, 0.16, 0.008), DARK, (DARK,) * 3)], pit=1)
    for (dx, dy) in ((-0.12, -0.12), (0.12, -0.12), (-0.12, 0.12), (0.12, 0.12)):
        o.append(bar((sx + dx, sy + dy, 0.03), (sx + dx * 0.35, sy + dy * 0.35, 0.65), 0.04, LOG[1]))
    o.append(bar((sx - 0.12, sy - 0.12, 0.3), (sx + 0.12, sy - 0.12, 0.3), 0.018, LOG[0]))
    o.append(box((sx, sy, 0.63), (0.1, 0.1, 0.03), LOG[0], LOG))
    o += wheel(sx, sy - 0.02, 0.72, 0.12, plane='xz', col=DKWOOD, spokes=6, paddles=False)
    o.append(bar((sx, sy - 0.02, 0.72), (sx, sy, 0.05), 0.004, '#2a2a2a'))
    o += nochim_hut(0.45, 0.2, 0.18, 0.14, 0.2, 0.12, 'slate', STONE) + chimney(0.55, 0.2, 0.2, 0.18)
    o += mound(-0.45, -0.3, 0.17, 0.12, ore_col('iron'), segs=6, top=0.2) + minecart(-0.1, -0.32, ore_col('iron')) + G(rails(-0.05, -0.08, -0.25, -0.5))
    return o
def _furnace(x, y, r=0.13, h=0.42, col=STONE, glow=True):
    o = [cone((x, y, 0), r, h, col[1], segs=8, r_top=r * 0.7, shade=(col[0], col[2]))]
    if glow: o.append(box((x, y - r * 0.85, 0.02), (0.06, 0.03, 0.07), FIRE[1], (FIRE[0], FIRE[1], FIRE[2])))
    return o
def b_smelter(_):
    o = _furnace(-0.15, 0.1, 0.17, 0.5) + shed(0.25, 0.1, 0.2, 0.15, 0.22, 0.12, 'shingle')
    o += mound(-0.45, -0.25, 0.13, 0.09, ore_col('copper'), segs=6, top=0.2) + mound(0.4, -0.3, 0.1, 0.07, ('#4a4a4a', '#333333', '#222222'), 6, 0.2)
    o += [box((0.05, -0.3, 0), (0.12, 0.05, 0.03), '#d08850', ('#d08850', '#b06838', '#804828'))]  # ingots
    return o + logs(0.0, -0.45, 2, 0.2, 0.04)
def b_roasting_heap(_):  # ore piled on burning wood, smoking
    o = mound(0, 0.05, 0.4, 0.2, ('#7a6a5a', '#5e5040', '#40362a'), segs=9, top=0.4)
    for k in range(5):
        a = -0.6 - k * 0.5
        o.append(box((math.cos(a) * 0.3, 0.05 + math.sin(a) * 0.22, 0.02), (0.05, 0.04, 0.04), FIRE[1], FIRE))
    o += [box((0, 0.05, 0.2), (0.3, 0.2, 0.008), '#c04a20', ('#c04a20',) * 3)]
    return o + logs(-0.5, -0.4, 3, 0.25, 0.045) + mound(0.5, -0.35, 0.12, 0.08, ore_col('copper'), 6, 0.2)
def b_bloomery(_):  # a clay shaft furnace, bellows, a smith's block
    o = _furnace(-0.1, 0.12, 0.13, 0.4, CLAY) + shed(0.3, 0.12, 0.17, 0.13, 0.2, 0.1, 'thatch')
    o.append(box((0.08, 0.02, 0), (0.1, 0.06, 0.04), HIDE[1], HIDE))
    o.append(box((0.0, -0.3, 0), (0.07, 0.07, 0.08), LOG[0], LOG)); o.append(box((0.0, -0.3, 0.08), (0.09, 0.04, 0.03), IRON, (IRON,) * 3))
    return o + mound(-0.45, -0.25, 0.12, 0.08, ore_col('iron'), 6, 0.2) + logs(0.4, -0.35, 2, 0.2, 0.04)
def b_silver_refinery(_):
    o = nochim_hut(0.05, 0.15, 0.3, 0.18, 0.26, 0.14, 'slate', STONE) + chimney(0.25, 0.15, 0.26, 0.24, 0.07)
    o += _furnace(-0.45, -0.1, 0.1, 0.22, BRICK) + [box((-0.15, -0.3, 0), (0.16, 0.06, 0.03), '#e0e4ec', ('#e0e4ec', '#b4bcc8', '#848c9a'))]
    return o + crate(0.4, -0.3) + barrel(0.48, -0.22)
def b_bronze_foundry(_):
    o = nochim_hut(0.15, 0.2, 0.3, 0.18, 0.24, 0.15, 'tile2', BRICK) + chimney(0.3, 0.2, 0.24, 0.3, 0.08, BRICK)
    o += _furnace(-0.35, 0.05, 0.12, 0.3, BRICK)
    o += [box((-0.1, -0.3, 0), (0.3, 0.12, 0.03), '#c8a070', ('#c8a070', '#a88050', '#806038'))]  # moulds in sand
    o += [box((0.25, -0.3, 0), (0.1, 0.05, 0.03), '#d8a040', ('#d8a040', '#b88028', '#8a5c18'))]
    return o + barrel(0.48, -0.2)
def b_forager_camp(_):
    o = lean_to(-0.2, 0.15) + fire(0.15, -0.05)
    for (x, y) in ((0.35, 0.2), (0.42, 0.1), (-0.45, -0.2)): o += [cone((x, y, 0), 0.04, 0.06, '#c8a060', segs=8, r_top=0.05, shade=('#e0c080', '#a88040'))]
    return o + broadleaf(0.5, 0.42, 0.9) + broadleaf(-0.55, 0.35, 0.8, '#7040a0')
def b_lumber_camp(_):
    o = hut(-0.3, 0.25, 0.2, 0.15, 0.22, 0.13, 'shingle', WOOD)
    o += logs(0.25, -0.05, 3, 0.4, 0.055) + logs(-0.15, -0.35, 2, 0.32, 0.05)
    for (x, y) in ((0.5, 0.35), (0.6, 0.1), (-0.6, -0.1), (0.3, 0.45)): o += stump(x, y)
    o.append(box((0.45, -0.4, 0), (0.12, 0.04, 0.05), LOG[0], LOG)); o.append(bar((0.45, -0.4, 0.05), (0.5, -0.43, 0.1), 0.008, IRON))  # chopping block and axe
    return o + pine(0.65, 0.5, 0.9) + pine(-0.6, 0.45, 1.0)
def b_hunting_lodge(_):  # log lodge with antlers over the door, a hide on a frame
    o = [box((0, 0.12, 0), (0.56, 0.34, 0.24), LOG[0], LOG)]
    for z in (0.05, 0.1, 0.15, 0.2): o.append(bar((-0.28, -0.052, z), (0.28, -0.052, z), 0.012, LOG[2]))
    o.append(gable(0.33, 0.23, 0.23, 0.42, ROOFS['shingle'])); o[-1].location.y += 0.12
    o.append(box((0, -0.06, 0), (0.09, 0.02, 0.16), DOORC, (DOORC,) * 3))
    for s in (-1, 1):
        o.append(bar((0, -0.07, 0.19), (s * 0.09, -0.07, 0.3), 0.022, BONE)); o.append(bar((s * 0.05, -0.07, 0.24), (s * 0.03, -0.07, 0.32), 0.02, BONE))
    o += chimney(0.2, 0.15, 0.3, 0.16)
    # hide stretched on a frame
    o.append(bar((0.3, -0.3, 0), (0.3, -0.3, 0.24), 0.014, LOG[1])); o.append(bar((0.5, -0.3, 0), (0.5, -0.3, 0.24), 0.014, LOG[1]))
    o.append(box((0.4, -0.3, 0.05), (0.16, 0.01, 0.16), HIDE[1], (HIDE[0], HIDE[1], HIDE[2])))
    return o + logs(-0.38, -0.32, 2, 0.2, 0.045) + pine(-0.45, 0.5) + pine(0.45, 0.52, 0.8)
def b_charcoal_kiln(_):  # earth-covered clamp smoking, wood stacked to burn
    o = mound(-0.05, 0.08, 0.32, 0.28, ('#5e5040', '#4a3e30', '#302820'), segs=10, top=0.25)
    o += [cone((-0.05, 0.08, 0.28), 0.06, 0.02, '#202020', segs=6)]
    o += logs(0.4, -0.15, 3, 0.25, 0.05, 'y') + [box((-0.4, -0.35, 0), (0.18, 0.12, 0.05), '#2a2a2a', ('#333333', '#262626', '#1c1c1c'))]
    return o + T([bar((0, 0, 0), (0.0, 0.0, 0.25), 0.012, LOG[1]), bar((0, 0, 0.25), (0.08, -0.05, 0.05), 0.01, LOG[1])], -0.5, 0.1)
def b_sawmill(_):  # a mill on the stream: wheel turning the saw in an open shed
    o = shed(0.0, 0.1, 0.3, 0.18, 0.24, 0.14, 'shingle')
    o.append(box((0.0, 0.05, 0.06), (0.5, 0.06, 0.03), LOG[0], LOG))  # saw bench
    o.append(box((0.0, 0.05, 0.09), (0.36, 0.04, 0.04), LOG[0], (LOGEND, LOG[1], LOGEND)))
    o.append(box((0.0, 0.0, 0.06), (0.01, 0.01, 0.16), '#c8c8d0', ('#c8c8d0',) * 3))
    o += [box((0.42, 0.1, 0), (0.06, 0.4, 0.012), WATER, (WATER, '#3a70b8', '#2c5c9c'))]
    o += wheel(0.42, 0.05, 0.15, 0.14, plane='yz', col=WOOD)
    return o + planks(-0.35, -0.38) + logs(0.15, -0.4, 3, 0.32, 0.05)
def b_pen(_):  # sheep fold: hurdles round a shelter
    o = fence(ring(0.62, 14, 0.75), h=0.08, gaps=(10,))
    return o + nochim_hut(0.1, 0.2, 0.2, 0.12, 0.13, 0.1, 'thatch', PLANK) + [box((-0.25, -0.15, 0), (0.18, 0.05, 0.05), PLANK[1], PLANK)] + sack(-0.4, 0.2, 0.035, WHEAT)
def b_dairy(_):
    o = hut(0.0, 0.15, 0.3, 0.18, 0.24, 0.15, 'tile', WHITE, 0)
    for k in range(3): o += [cone((-0.35 + k * 0.08, -0.25, 0), 0.03, 0.09, '#b4b8c0', segs=8, r_top=0.022, shade=('#d4d8e0', '#8c9098'))]
    o += [box((0.32, -0.25, 0), (0.18, 0.1, 0.06), WOOD[0], WOOD)]
    for k in range(3): o.append(cone((0.27 + k * 0.05, -0.25, 0.06), 0.022, 0.02, '#f0d070', segs=8, r_top=0.022))  # cheeses
    return o + fence(rect(-0.45, 0.36, 0.45, 0.56, 0.15), closed=False)
def b_stable(_):  # a long low stable, stall doors open
    o = [box((0, 0.15, 0), (0.8, 0.28, 0.2), PLANK[1], PLANK), gable(0.43, 0.19, 0.19, 0.36, ROOFS['thatch'], 0.15)]
    o[-1].location.y += 0.15
    for k in range(4):
        x = -0.3 + k * 0.2
        o.append(box((x, 0.005, 0), (0.1, 0.02, 0.14), DARK, (DARK,) * 3)); o.append(box((x, -0.003, 0), (0.1, 0.02, 0.07), DOORC, (DOORC,) * 3))
    o += [box((-0.3, -0.3, 0), (0.2, 0.06, 0.06), WOOD[0], WOOD)] + mound(0.4, -0.3, 0.1, 0.08, WHEAT, 6, 0.3)
    return o + fence([(-0.65, -0.45), (-0.3, -0.45)], closed=False)
def b_cart_shed(_):
    o = shed(0.0, 0.15, 0.32, 0.18, 0.22, 0.12, 'shingle')
    o += cart(-0.1, 0.05) + cart(0.45, -0.3) + T(wheel(0, 0, 0.06, 0.06, plane='yz', col=DKWOOD, spokes=6, paddles=False), -0.45, -0.25)
    return o + logs(-0.3, -0.4, 2, 0.2, 0.04)
def b_nitre_beds(_):  # long thatched heaps of dung, earth and ash
    o = []
    for y in (-0.35, -0.05, 0.25):
        o.append(box((0, y, 0), (1.0 - abs(y), 0.16, 0.08), '#8a7050', ('#7a6040', '#6a5038', '#503c28')))
        o.append(gable(0.5 - abs(y) / 2 + 0.03, 0.1, 0.07, 0.16, ROOFS['thatch'], 0.0)); o[-1].location.y += y
    return o + barrel(0.55, -0.45) + [bar((-0.6, -0.45, 0), (-0.55, -0.4, 0.2), 0.01, LOG[1])]
def b_powder_mill(_):  # stone mill on a race, set apart, with a wheel
    o = nochim_hut(-0.05, 0.15, 0.26, 0.17, 0.24, 0.14, 'slate', STONE)
    o += [box((0.32, 0.12, 0), (0.08, 0.5, 0.014), WATER, (WATER, '#3a70b8', '#2c5c9c'))] + wheel(0.27, 0.1, 0.15, 0.15, plane='yz', col=WOOD)
    o += barrel(-0.4, -0.25, col=DKWOOD) + barrel(-0.32, -0.3, col=DKWOOD) + barrel(-0.36, -0.22, col=DKWOOD, z=0.075)
    return o + flag(-0.55, 0.3, 0.0, RED, 0.35)
def b_gun_foundry(_):  # a big brick foundry, tall stack, a cannon barrel cooling
    o = nochim_hut(0.0, 0.18, 0.38, 0.2, 0.3, 0.16, 'slate', BRICK) + chimney(0.25, 0.25, 0.0, 0.8, 0.1, BRICK)
    o.append(box((-0.1, -0.025, 0), (0.12, 0.02, 0.18), '#3a1a10', ('#3a1a10',) * 3))
    o.append(bar((-0.35, -0.35, 0.035), (0.05, -0.35, 0.05), 0.06, '#5a5a60'))
    o += [box((0.0, -0.35, 0), (0.06, 0.06, 0.03), DKWOOD[0], DKWOOD), box((-0.3, -0.35, 0), (0.06, 0.06, 0.03), DKWOOD[0], DKWOOD)]
    for k in range(3): o.append(cone((0.35 + (k % 2) * 0.05, -0.3 - (k // 2) * 0.05, 0), 0.025, 0.04, '#333338', segs=6, r_top=0.02))
    return o
def b_gunsmith(_):
    o = hall(0.0, 0.12, 0.3, 0.2, 0.26, 0.15, 0.16, 'tile', PLASTER)
    o += [bar((0.36, -0.12, 0), (0.36, -0.12, 0.3), 0.012, DKWOOD[1]), bar((0.36, -0.12, 0.28), (0.48, -0.12, 0.28), 0.01, DKWOOD[1])]
    o += [box((0.46, -0.12, 0.2), (0.08, 0.012, 0.07), '#e0c070', ('#e0c070',) * 3)]  # sign
    return o + crate(-0.4, -0.25) + crate(-0.32, -0.28) + [box((-0.1, -0.32, 0), (0.2, 0.06, 0.06), WOOD[0], WOOD)]
def b_siege_workshop(_):  # a great open frame; a ram and a catapult half-built
    o = []
    for (x, y) in ((-0.5, -0.1), (0.5, -0.1), (-0.5, 0.35), (0.5, 0.35)): o.append(bar((x, y, 0), (x, y, 0.4), 0.03, LOG[1]))
    o += [bar((-0.5, -0.1, 0.4), (0.5, -0.1, 0.4), 0.03, LOG[0]), bar((-0.5, 0.35, 0.4), (0.5, 0.35, 0.4), 0.03, LOG[0])]
    o += T([gable(0.55, 0.27, 0.39, 0.55, ROOFS['shingle'], 0.0)], 0, 0.125)
    o += [box((-0.15, 0.15, 0.03), (0.5, 0.18, 0.03), WOOD[0], WOOD), bar((-0.4, 0.15, 0.1), (0.1, 0.15, 0.1), 0.05, LOG[0])]  # ram
    o += [box((0.0, -0.4, 0), (0.3, 0.14, 0.05), WOOD[0], WOOD), bar((-0.08, -0.4, 0.05), (0.0, -0.4, 0.22), 0.02, LOG[1]),
          bar((0.08, -0.4, 0.05), (0.0, -0.4, 0.22), 0.02, LOG[1]), bar((0.0, -0.4, 0.08), (-0.25, -0.4, 0.3), 0.02, LOG[0])]
    return o + logs(0.45, -0.45, 2, 0.25, 0.045) + planks(-0.5, -0.45, 3)
def b_weaver(_):  # a weaver's house, cloth drying on lines
    o = hall(-0.1, 0.18, 0.32, 0.2, 0.26, 0.15, 0.16, 'tile2', PLASTER2)
    for (x0, x1, y) in ((-0.5, 0.0, -0.3), (0.15, 0.6, -0.2)):
        o += [bar((x0, y, 0), (x0, y, 0.22), 0.012, LOG[1]), bar((x1, y, 0), (x1, y, 0.22), 0.012, LOG[1]), bar((x0, y, 0.22), (x1, y, 0.22), 0.004, '#e8e0c8')]
        for k, c in enumerate(('#c84040', '#4070c0', '#e0b030', '#6aa050')[:3]):
            xx = x0 + (k + 0.6) * (x1 - x0) / 3.4
            o.append(box((xx, y, 0.1), (0.1, 0.008, 0.12), c, (c, c, c)))
    return o + sack(0.55, 0.35, 0.05, ('#f4f0e8', '#e4dccc', '#c0b8a4'))
def b_scout_camp(_):  # tents and a lookout tower
    o = tent(-0.35, 0.15, 0.13, 0.2, CLOTH) + tent(-0.1, 0.35, 0.12, 0.18, ('#d8c8a0', '#bca878', '#94805a')) + fire(-0.2, -0.15)
    tx, ty = 0.32, 0.1
    for (dx, dy) in ((-0.07, -0.07), (0.07, -0.07), (-0.07, 0.07), (0.07, 0.07)): o.append(bar((tx + dx * 1.4, ty + dy * 1.4, 0), (tx + dx, ty + dy, 0.62), 0.04, LOG[1]))
    o += [box((tx, ty, 0.6), (0.18, 0.18, 0.025), PLANK[0], PLANK), box((tx, ty - 0.085, 0.625), (0.18, 0.012, 0.06), PLANK[1], PLANK)]
    o += [bar((tx + 0.02, ty - 0.1, 0.0), (tx + 0.02, ty - 0.1, 0.6), 0.008, LOG[0])]
    o += flag(tx + 0.08, ty + 0.08, 0.62, '#3a6ec8', 0.22, 0.1)
    return o + pine(-0.6, -0.1, 0.8) + pine(0.6, 0.45, 0.9)
def b_outfitter(_):  # a leatherworker's and armourer's shop, a mannequin in mail
    o = hut(-0.1, 0.18, 0.3, 0.19, 0.27, 0.15, 'shingle', PLASTER, 1)
    o += [bar((0.4, -0.2, 0), (0.4, -0.2, 0.15), 0.014, LOG[1]), box((0.4, -0.2, 0.1), (0.07, 0.04, 0.09), '#9098a4', ('#b0b8c4', '#9098a4', '#6a707c')),
          cone((0.4, -0.2, 0.19), 0.028, 0.03, '#9098a4', segs=6)]
    o.append(box((-0.35, -0.25, 0.0), (0.02, 0.15, 0.16), LOG[1], LOG)); o.append(box((-0.33, -0.25, 0.03), (0.01, 0.12, 0.11), HIDE[1], HIDE))
    o += [bar((0.15, -0.35, 0), (0.25, -0.3, 0.2), 0.01, LOG[0]), bar((0.18, -0.35, 0), (0.26, -0.32, 0.2), 0.01, LOG[0])]  # spears leaning
    return o + crate(0.55, 0.2)
def b_smithy(_):  # an open forge under a roof, anvil in front
    o = [box((0.0, 0.25, 0), (0.6, 0.05, 0.22), STONE[1], STONE)] + shed(0.0, 0.12, 0.3, 0.17, 0.22, 0.14, 'slate', back=False)
    o += [box((-0.1, 0.17, 0), (0.18, 0.12, 0.1), STONE[1], STONE), box((-0.1, 0.17, 0.1), (0.1, 0.06, 0.008), FIRE[1], FIRE)]
    o += chimney(-0.1, 0.22, 0.1, 0.38, 0.07)
    o += [box((0.15, -0.2, 0), (0.06, 0.06, 0.06), LOG[0], LOG), box((0.15, -0.2, 0.06), (0.1, 0.04, 0.03), IRON, (IRON,) * 3)]
    return o + barrel(0.32, -0.25, col=DKWOOD) + [box((-0.4, -0.3, 0), (0.12, 0.06, 0.02), '#5a5a60', ('#5a5a60',) * 3)]

# ------------------------------------------------------------------ monster camps
def b_lair_orcs(_):  # a war stockade: crude leaning stakes, hide huts, a skull-topped gate, a bonfire
    o = patch(0, 0, 1.0, 0.7, MUD)
    rnd = random.Random(7)
    for k, (x, y) in enumerate(ring(0.7, 30, 0.82)):
        if -0.14 < x < 0.14 and y < 0: continue
        o += T(stake(0, 0, 0.18 + rnd.uniform(0, 0.08), 0.05, ORC), x, y, rnd.uniform(-0.3, 0.3))
    for sx in (-0.15, 0.15):
        o.append(bar((sx, -0.58, 0), (sx, -0.58, 0.38), 0.05, ORC[1]))
        o.append(cone((sx, -0.6, 0.38), 0.03, 0.04, BONE, segs=6, r_top=0.02))
    o.append(bar((-0.19, -0.58, 0.32), (0.19, -0.58, 0.34), 0.04, ORC[0]))
    o += tent(-0.3, 0.2, 0.17, 0.24, HIDE, segs=6, rot=0.3) + tent(0.32, 0.22, 0.15, 0.22, HIDE, segs=5) + tent(-0.05, 0.42, 0.13, 0.2, ORC, 5)
    o += fire(0.05, -0.1, 1.5)
    o += flag(0.5, 0.0, 0.0, '#3a3a3a', 0.5, 0.14) + flag(-0.5, -0.05, 0.0, RED, 0.42, 0.12)
    for (x, y) in ((0.3, -0.3), (-0.3, -0.25)): o += [bar((x, y, 0), (x, y, 0.16), 0.012, ORC[1]), cone((x, y, 0.16), 0.022, 0.03, BONE, segs=6, r_top=0.015)]
    return o
def b_lair_goblins(_):  # a ring of thorns round mud huts, a lookout pole
    o = patch(0, 0, 0.9, 0.6, MUD)
    for k, (x, y) in enumerate(ring(0.62, 22, 0.8)):
        if -0.1 < x < 0.1 and y < 0: continue
        o += stake(x, y, 0.1 + 0.03 * (k % 3), 0.035, DKWOOD)
    for (x, y, s) in ((-0.25, 0.15, 1.0), (0.22, 0.2, 0.9), (0.0, -0.1, 0.75)):
        o += mound(x, y, 0.13 * s, 0.13 * s, CLAY, segs=7, top=0.15) + [box((x, y - 0.11 * s, 0), (0.04, 0.02, 0.05), DARK, (DARK,) * 3)]
    o += [bar((0.45, -0.1, 0), (0.42, -0.1, 0.45), 0.016, DKWOOD[1])] + flag(0.42, -0.1, 0.25, '#7a9a30', 0.2, 0.1) + fire(-0.25, -0.3)
    return o

# ------------------------------------------------------------------ footprints
# Where villagers can walk on the hex: a grid of cells (1/16 of a hex radius) over x -1..1 and y -0.875..0.875,
# a cell blocked where anything standing (or a pit) comes within a cell's width of its middle. Flat things (crops,
# yards, rails) don't block. The door is the free cell nearest the front middle that the hex's edges can reach:
# roads run to it and on, and villagers working there stand at it.
CELL = 1 / 16; GX0, GY0 = -1.0, -0.875; COLS, ROWS = 32, 28
FLAT = 0.035  # things no taller than this are walked over

def is_ground(ob, zmax, zmin):
    return bool(ob.get('ground')) or bool(ob.get('pit')) or (zmax <= FLAT and zmin > -0.005)

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for q in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0: hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]

def dist_to_hull(h, x, y):
    """0 inside the convex polygon h (anticlockwise), else the distance to it."""
    if len(h) == 1: return math.hypot(x - h[0][0], y - h[0][1])
    inside = len(h) >= 3; best = 1e9
    for i in range(len(h)):
        ax, ay = h[i]; bx, by = h[(i + 1) % len(h)]
        if (bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0: inside = False
        dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
        t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L)) if L else 0
        best = min(best, math.hypot(x - ax - dx * t, y - ay - dy * t))
    return 0 if inside else best

def in_hex(x, y, slack=0.0):
    ax, ay = abs(x), abs(y)
    return ay <= 0.866 - slack and ax <= 1 - slack - ay / math.sqrt(3)

def footprint(blockers):
    grid = [[0] * COLS for _ in range(ROWS)]
    hulls = []
    for ob in blockers:
        hulls.append(hull([(round(v.x, 4), round(v.y, 4)) for v in ((ob.matrix_world @ vt.co) for vt in ob.data.vertices)]))
    for r in range(ROWS):
        for c in range(COLS):
            x, y = GX0 + (c + 0.5) * CELL, GY0 + (r + 0.5) * CELL
            # within a cell's width of it: walkers' feet (and roads' verges) keep clear of the walls
            if any(dist_to_hull(h, x, y) <= CELL for h in hulls): grid[r][c] = 1
    return grid

def free_cells(grid):
    """Cells to stand on, as the game counts them (src/render/footprint.ts `open`): not blocked, middle on the hex top."""
    return {(r, c) for r in range(ROWS) for c in range(COLS) if not grid[r][c] and in_hex(GX0 + (c + 0.5) * CELL, GY0 + (r + 0.5) * CELL)}

def reach(free, start):
    seen = {start}; todo = [start]
    while todo:
        r, c = todo.pop()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            n = (r + dr, c + dc)
            # as the game moves: diagonally only past two open cells (never across a blocked cell's corner)
            if dr and dc and ((r + dr, c) not in free or (r, c + dc) not in free): continue
            if n in free and n not in seen: seen.add(n); todo.append(n)
    return seen

def nearest(cells, x, y):
    return min(cells, key=lambda rc: math.hypot(GX0 + (rc[1] + 0.5) * CELL - x, GY0 + (rc[0] + 0.5) * CELL - y))

EDGES = [(0.8 * math.cos(math.radians(30 + 60 * k)), 0.8 * math.sin(math.radians(30 + 60 * k))) for k in range(6)]
def door_of(key, grid, prefer=(0.0, -0.45)):
    free = free_cells(grid)
    if not free: return None, 6
    ends = [nearest(free, x, y) for (x, y) in EDGES]
    # the area most edges reach
    best = max((reach(free, e) for e in ends), key=lambda area: sum(e in area for e in ends))
    cut = sum(e not in best for e in ends)
    d = nearest(best, *prefer)
    return [round(GX0 + (d[1] + 0.5) * CELL, 4), round(GY0 + (d[0] + 0.5) * CELL, 4)], cut

def pack_grid(grid):
    bits = ''.join(str(grid[r][c]) for r in range(ROWS) for c in range(COLS))
    return '%0*x' % (len(bits) // 4, int(bits, 2))

CAT = {f'k_{k[2:]}': fn for k, fn in list(globals().items()) if k.startswith('b_') and callable(fn)}
DOORS = {'k_mill': (0.1, -0.3), 'k_palisade': (0.0, -0.3)}
# docks and shipyards stand in the water with their pier running to the one shore hex that holds them up: a sprite
# for each of the six edges it can be (edge k is at 30 + 60k degrees; the model has the land at +y, edge 1)
for _name in ('docks', 'shipyard'):
    _fn = CAT.pop(f'k_{_name}')
    for _k in range(6):
        def _make(_unused=None, _f=_fn, _k=_k):
            objs = _f(None); bpy.context.view_layer.update()
            T(objs, 0, 0, math.radians(60 * (_k - 1)))
            return objs
        CAT[f'k_{_name}_r{_k}'] = _make
        _a = math.radians(30 + 60 * _k); DOORS[f'k_{_name}_r{_k}'] = (math.cos(_a) * 0.55, math.sin(_a) * 0.55)
if True:
    only = os.environ.get('ONLY'); W = 64; H = 96; ax, ay = W // 2, H - W // 4
    reset_scene(); os.makedirs(OUT, exist_ok=True); done = []
    meta = {'grid': {'cols': COLS, 'rows': ROWS, 'cell': CELL, 'x0': GX0, 'y0': GY0}, 'walk': {}, 'doors': {}, 'ground': [], 'frames': {}}
    CUT = '#ff00ff'  # the ground in front of a pit: hides what the near rim would, then cleared to transparent
    def cutter(pits):
        """Ground all round the pits' openings, so the pit shows only through its mouth."""
        xs = [(ob.matrix_world @ v.co) for ob in pits for v in ob.data.vertices]
        x0, x1, y0, y1 = min(v.x for v in xs), max(v.x for v in xs), min(v.y for v in xs), max(v.y for v in xs)
        E = 1.3; quads = [(-E, -E, E, y0), (-E, y1, E, E), (-E, y0, x0, y1), (x1, y0, E, y1)]
        return [box(((a + c) / 2, (b + d) / 2, -0.002), (c - a, d - b, 0.002), CUT, (CUT, CUT, CUT)) for (a, b, c, d) in quads]
    def clear_cut(path):
        img = bpy.data.images.load(path); px = list(img.pixels)
        for i in range(0, len(px), 4):
            if px[i] > 0.95 and px[i + 1] < 0.05 and px[i + 2] > 0.95: px[i:i + 4] = [0, 0, 0, 0]
        img.pixels = px; img.save(); bpy.data.images.remove(img)
    def shoot(name, objs, show, cut=None, ss=1):
        for ob in objs: ob.hide_render = not show(ob)
        extra = cutter(cut) if cut else []
        setup_camera(W * ss, H * ss, ax * ss, ay * ss); render(os.path.join(OUT, name + '.png')); done.append(name)
        for ob in extra: bpy.data.objects.remove(ob, do_unlink=True)
        if cut: clear_cut(os.path.join(OUT, name + '.png'))
    for key, fn in CAT.items():
        if only and not any(key.startswith(p) for p in only.split(',')): continue
        clear_objects(); objs = fn(None)
        bpy.context.view_layer.update()
        kind = {}
        for ob in objs:
            zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
            kind[ob.name] = is_ground(ob, max(zs), min(zs))
        ground = [ob for ob in objs if kind[ob.name]]
        shoot(key, objs, lambda ob: not kind[ob.name])
        if ground:
            deep = [ob for ob in ground if ob.get('pit') and min((ob.matrix_world @ v.co).z for v in ob.data.vertices) < -0.01]
            shoot(key + '_g', objs, lambda ob: kind[ob.name], deep or None); meta['ground'].append(key)
        if key.endswith('_slope') or key.startswith('k_lair'): continue  # mountainsides and monster camps: no walking plan
        grid = footprint([ob for ob in objs if not kind[ob.name] or ob.get('pit')])
        door, cut = door_of(key, grid, DOORS.get(key, (0.0, -0.45)))
        if cut: print(f'WARNING {key}: {cut} edge(s) cut off from the door')
        meta['walk'][key] = pack_grid(grid); meta['doors'][key] = door
    if not only or 'k_mill' in only:
        for f in range(SAIL_FRAMES):
            clear_objects(); objs = mill_sails(f / SAIL_FRAMES)
            shoot(f'k_mill_s{f}', objs, lambda ob: True, ss=4)  # 4x, shrunk by pack_houses.py: smooth edges as the sails turn
        meta['frames']['k_mill_s'] = SAIL_FRAMES
    json.dump(meta, open(os.path.join(OUT, 'buildings.json'), 'w'))
    print('rendered', len(done))
