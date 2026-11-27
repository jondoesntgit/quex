"""Render the road ramps that carry a road up a cliff between two hexes (src/render/ramps.ts has the same
geometry: change both together). One 64x96 sprite per ramp, anchored (32, 80) at the middle of its stretch of
edge, on the lower hex's ground; packed into the house sheet by tools/pack_houses.py as
r_<d|p>_<edge 0-5>_<drop 1-4>[a|b][f]: dirt or paved; short ones beside a waterfall on the +t / -t side; flipped
(top at the -t end).

  - one tier: a single flight along the edge at 30 degrees, against the cliff;
  - two tiers or more: a switchback (like a wheelchair ramp): the lower flight along an outer lane, a landing,
    and the upper flight back along the inner lane to the top, at the same end as the foot;
  - beside a waterfall (a river over the same edge): a short single flight to one side.

Run: REPO=$PWD OUT=<dir> Blender --background --factory-startup --python tools/blender/render_ramps.py"""
import bpy, bmesh, math, os, json
from mathutils import Vector, Matrix
REPO = os.environ['REPO']; OUT = os.environ['OUT']
_src = open(REPO + '/tools/blender/render_tiles.py').read()
_src = _src[:_src.index('\ndef main():')]
exec(compile(_src, REPO + '/tools/blender/render_tiles.py', 'exec'), globals())

# --- the numbers in src/render/ramps.ts
WIDTH = 0.3
ANGLE = 30
MAX_LEN = 0.9
SWITCH = dict(LOW_FROM=0.2, TURN=-0.2, LANDING=-0.3, TOP=0.45)
SHORT, SHORT_AT, SHORT_MAX_DROP = 0.3, 0.32, 3
MAX_DROP = 4
TIER = 0.25 / math.sin(TILT)  # a tier is W/8 px; a unit of height is W/2 * sin(tilt) px
T30 = math.tan(math.radians(30))
# --- colours: the road's own (MapView road()), and the banks that hold the ramp up
TOPS = {'d': ('#c09858', '#7a5830'), 'p': ('#b8b2a2', '#6c665a')}
# earth banks in the cliffs' own colours (palette.json grass sides), so a ramp reads as built from the bank
WALLS = {'d': ('#a87838', '#886028', '#684818'), 'p': ('#bdb7a8', '#97917f', '#6a6558')}
RAIL = {'d': '#5a3a1e', 'p': '#4e4a44'}  # the handrail along a flight's open side, like a wheelchair ramp's
RAIL_H = 0.11
L = Vector((-0.55, -0.35, 0.76)).normalized()
RIM = 0.035  # the darker verge along a flight's open side

def limit(d):
    """How far along the edge (each way from its middle) the lower hex reaches at depth d, less a margin."""
    return 0.5 - d * T30 - 0.02

def lane(bm, mats, frame, d0, d1, s_a, s_b, z, breaks, surf, rim=True, rails=None):
    """One lane of ramp: a deck at height z(s) between depths d0 and d1, from s_a to s_b along the edge,
    clipped to the hex, with walls down to the ground on its open side and ends."""
    to = frame
    ss = sorted({s_a, s_b, *[b for b in breaks if s_a < b < s_b]})
    def line(d):
        lim = limit(d)
        return [max(-lim, min(lim, s)) for s in ss]
    top, edge = TOPS[surf]
    def face(pts, col):
        if len({(round(p[0], 5), round(p[1], 5), round(p[2], 5)) for p in pts}) < 3: return
        f = bm.faces.new([bm.verts.new(to(*p)) for p in pts])
        f.material_index = mats[col]
    def wall(pts, facing):
        n = Vector(to(*facing)) - Vector(to(0, 0, 0))
        n.normalize()
        dot = n.dot(L)
        lit = WALLS[surf][0 if dot > 0.25 else (1 if dot > -0.1 else 2)]
        face(pts, lit)
    bands = [(d0, d1 - RIM, top), (d1 - RIM, d1, edge)] if rim else [(d0, d1, top)]
    for (da, db, col) in bands:
        la, lb = line(da), line(db)
        for k in range(len(ss) - 1):
            face([(la[k], da, z(la[k])), (la[k + 1], da, z(la[k + 1])), (lb[k + 1], db, z(lb[k + 1])), (lb[k], db, z(lb[k]))], col)
    # the open side (facing into the hex) and the two ends
    lo = line(d1)
    for k in range(len(ss) - 1):
        wall([(lo[k], d1, 0), (lo[k + 1], d1, 0), (lo[k + 1], d1, z(lo[k + 1])), (lo[k], d1, z(lo[k]))], (0, 1, 0))
    li = line(d0)
    for (s0, s1, sign) in ((li[0], lo[0], -1), (li[-1], lo[-1], 1)):
        if z(s0) > 1e-4 or z(s1) > 1e-4:
            wall([(s0, d0, 0), (s1, d1, 0), (s1, d1, z(s1)), (s0, d0, z(s0))], (sign, 0, 0))
    # a handrail on posts along the open side, wherever the deck stands clear of the ground
    if rails is not None:
        dr = d1 - RIM / 2
        lr = limit(dr)
        a_, b_ = max(-lr, ss[0]), min(lr, ss[-1])
        n = max(1, round((b_ - a_) / 0.13))
        tops = []
        for j in range(n + 1):
            sp = a_ + (b_ - a_) * j / n
            if z(sp) < 0.04: tops.append(None); continue
            p0, p1 = Vector(to(sp, dr, z(sp))), Vector(to(sp, dr, z(sp) + RAIL_H))
            rails.append((p0, p1)); tops.append(p1)
        for j in range(len(tops) - 1):
            if tops[j] is not None and tops[j + 1] is not None: rails.append((tops[j], tops[j + 1]))

def ramp(k, drop, surf, kind, c, flip):
    """Build the ramp's mesh about the origin (its anchor: the middle of its stretch of edge, at the ground)."""
    a = math.radians(30 + 60 * k)
    t = Vector((-math.sin(a), math.cos(a), 0)); i = Vector((-math.cos(a), -math.sin(a), 0))
    def frame(s, d, z): return t * (s - c) + i * d + Vector((0, 0, z))
    H = drop * TIER
    cols = sorted({*TOPS[surf], *WALLS[surf]})
    bm = bmesh.new(); mats = {col: n for n, col in enumerate(cols)}
    rails = []
    def put(d0, d1, s_a, s_b, z, breaks):
        # flipped: turned end for end about c, then clipped to the hex where it now stands
        if flip: lane(bm, mats, frame, d0, d1, 2 * c - s_b, 2 * c - s_a, lambda s: z(2 * c - s), [2 * c - x for x in breaks], surf, rails=rails)
        else: lane(bm, mats, frame, d0, d1, s_a, s_b, z, breaks, surf, rails=rails)
    if kind == 'switchback':
        S = SWITCH; low = S['LOW_FROM'] - S['TURN']; high = S['TOP'] - S['TURN']; h1 = low / (low + high)
        def zin(s): return H * (h1 if s <= S['TURN'] else h1 + (1 - h1) * (s - S['TURN']) / high)
        def zout(s): return H * (h1 if s <= S['TURN'] else max(0.0, h1 * (S['LOW_FROM'] - s) / low))
        put(0.0, WIDTH, -0.48, S['TOP'], zin, [S['TURN']])
        put(WIDTH, 2 * WIDTH, -0.48, S['LOW_FROM'], zout, [S['TURN']])
    else:
        length = SHORT if kind == 'short' else min(MAX_LEN, H / T30)
        s0 = c - length / 2
        def z(s): return H * max(0.0, min(1.0, (s - s0) / length))
        put(0.0, WIDTH, s0, s0 + length, z, [])
    for (p0, p1) in rails: rail_bar(p0, p1, 0.016, RAIL[surf])
    return link(bm, 'ramp', [mat(col) for col in cols])

def rail_bar(p0, p1, th, color):
    d = p1 - p0; ln = d.length
    if ln < 1e-6: return
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(ln, th, th), verts=bm.verts)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ q, verts=bm.verts)
    link(bm, 'rail', [mat(color)])

if True:
    W, Hh = 64, 96; ax, ay = W // 2, Hh - W // 4
    reset_scene(); os.makedirs(OUT, exist_ok=True); done = []
    for surf in ('d', 'p'):
        for k in range(6):
            for drop in range(1, MAX_DROP + 1):
                kinds = [('switchback' if drop >= 2 else 'single', 0.0, '')]
                if drop <= SHORT_MAX_DROP: kinds += [('short', SHORT_AT, 'a'), ('short', -SHORT_AT, 'b')]
                for (kind, c, tag) in kinds:
                    for flip in (False, True):
                        clear_objects(); ramp(k, drop, surf, kind, c, flip)
                        name = f'r_{surf}_{k}_{drop}{tag}{"f" if flip else ""}'
                        setup_camera(W, Hh, ax, ay); render(os.path.join(OUT, name + '.png')); done.append(name)
    json.dump(done, open(os.path.join(OUT, 'ramps.json'), 'w'))
    print('rendered', len(done))
