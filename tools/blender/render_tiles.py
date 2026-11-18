"""Quex tile renderer — run headless inside Blender.

    Blender --background --factory-startup --python tools/blender/render_tiles.py -- \
        --size 32 --out art/raw/32 [--only terrain|features] [--names grass,water]

Renders flat-top hex terrain columns and terrain features with an orthographic
camera tilted 54.7 deg from top-down, so the hex top face is exactly half as
tall as it is wide (W x W/2) and each elevation tier is W/8 px of cliff.

Geometry is built from primitives in code (no .blend files needed) so the whole
art set is reproducible from this script + palette.json.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
TILT = math.radians(54.7356)  # cos = 1/sqrt(3) -> face height = width / 2
MAX_TIER = 6                  # tallest elevation tier above sea level


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"size": 32, "out": "art/raw/32", "only": None, "names": None}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        out[k] = argv[i + 1]
        i += 2
    out["size"] = int(out["size"])
    if out["names"]:
        out["names"] = out["names"].split(",")
    return out


def hexcol(h):
    """sRGB hex -> linear RGBA (Blender colours are linear; 'Standard' view re-encodes)."""
    h = h.lstrip("#")

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# ---------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_object_outline = False
    sc.display.shading.show_specular_highlight = False
    sc.display.render_aa = "OFF"
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.resolution_percentage = 100
    return sc


def clear_objects():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


_mats = {}


def mat(color):
    """Flat material: in FLAT light mode the rendered pixel == this colour."""
    if color in _mats:
        return _mats[color]
    m = bpy.data.materials.new(color)
    m.diffuse_color = hexcol(color)
    _mats[color] = m
    return m


def setup_camera(W, H, ax, ay):
    """Ortho camera so that world origin lands on pixel (ax, ay)."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = W, H
    upp = 2.0 / W  # world units per pixel (hex radius 1 => width 2 units)
    rot = Matrix.Rotation(TILT, 4, "X")
    d = (rot @ Vector((0, 0, -1, 0))).xyz
    up = (rot @ Vector((0, 1, 0, 0))).xyz
    right = Vector((1, 0, 0))
    P = -right * (ax - W / 2) * upp + up * (ay - H / 2) * upp
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = upp * max(W, H)
    cam_data.clip_start, cam_data.clip_end = 0.01, 100
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = P - d * 30
    cam.rotation_euler = (TILT, 0, 0)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- geometry

def link(bm, name, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in mats:
        ob.data.materials.append(m)
    bpy.context.collection.objects.link(ob)
    return ob


def hex_column(top, sides, depth, radius=1.0, z_top=0.0):
    """Flat-top hex prism. sides = (front-left, front, front-right) colours."""
    bm = bmesh.new()
    ring_t, ring_b = [], []
    for i in range(6):
        a = math.radians(60 * i)
        x, y = radius * math.cos(a), radius * math.sin(a)
        ring_t.append(bm.verts.new((x, y, z_top)))
        ring_b.append(bm.verts.new((x, y, z_top - depth)))
    ftop = bm.faces.new(ring_t)
    ftop.material_index = 0
    for i in range(6):
        j = (i + 1) % 6
        f = bm.faces.new((ring_t[j], ring_t[i], ring_b[i], ring_b[j]))
        mid = math.degrees(math.radians(60 * i + 30)) % 360
        # edge normals: 30,90,150 face away from camera; 210,270,330 visible
        f.material_index = {210: 1, 270: 2, 330: 3}.get(round(mid), 2)
    fb = bm.faces.new(list(reversed(ring_b)))
    fb.material_index = 2
    return link(bm, "hex", [mat(top), mat(sides[0]), mat(sides[1]), mat(sides[2])])


def cone(loc, r, h, color, segs=6, r_top=0.0, rot=0.0, shade=None):
    """Faceted cone. shade=(light,dark) colours faces by facing for 3-tone look."""
    bm = bmesh.new()
    x0, y0, z0 = loc
    base = []
    for i in range(segs):
        a = rot + 2 * math.pi * i / segs
        base.append(bm.verts.new((x0 + r * math.cos(a), y0 + r * math.sin(a), z0)))
    mats = [mat(color)] + ([mat(shade[0]), mat(shade[1])] if shade else [])
    if r_top <= 0:
        tip = bm.verts.new((x0, y0, z0 + h))
        faces = [bm.faces.new((base[i], base[(i + 1) % segs], tip)) for i in range(segs)]
    else:
        top = []
        for i in range(segs):
            a = rot + 2 * math.pi * i / segs
            top.append(bm.verts.new((x0 + r_top * math.cos(a), y0 + r_top * math.sin(a), z0 + h)))
        faces = [bm.faces.new((base[i], base[(i + 1) % segs], top[(i + 1) % segs], top[i])) for i in range(segs)]
        bm.faces.new(top)
    if shade:
        bm.normal_update()
        for f in faces:
            n = f.normal
            # light from upper-left-front
            lit = n.x * -0.6 + n.y * -0.5 + n.z * 0.6
            f.material_index = 1 if lit > 0.35 else (0 if lit > -0.1 else 2)
    return link(bm, "cone", mats)


def box(loc, size, top, sides, rot=0.0):
    """Axis box with distinct top / front / side colours."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc) + Vector((0, 0, size[2] / 2)), verts=bm.verts)
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        if n.z > 0.5:
            f.material_index = 0
        elif n.x < -0.3:
            f.material_index = 1
        elif n.x > 0.3:
            f.material_index = 3
        else:
            f.material_index = 2
    return link(bm, "box", [mat(top), mat(sides[0]), mat(sides[1]), mat(sides[2])])


def roof(loc, size, color, dark, rot=0.0):
    """Gable roof (triangular prism) along X."""
    sx, sy, sz = size
    bm = bmesh.new()
    x, y, z = loc
    v = [bm.verts.new(p) for p in [
        (-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, 0, sz), (-sx / 2, 0, sz),
        (-sx / 2, sy / 2, 0), (sx / 2, sy / 2, 0)]]
    front = bm.faces.new((v[0], v[1], v[2], v[3]))
    back = bm.faces.new((v[3], v[2], v[5], v[4]))
    bm.faces.new((v[0], v[3], v[4]))
    bm.faces.new((v[1], v[5], v[2]))
    for f in bm.faces:
        f.material_index = 1
    front.material_index = 0
    back.material_index = 0
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return link(bm, "roof", [mat(color), mat(dark)])


# ---------------------------------------------------------------- content

PAL = json.load(open(os.path.join(HERE, "palette.json")))


def terrain(name):
    t = PAL["terrain"][name]
    return lambda W: hex_column(t["top"], t["sides"], (MAX_TIER + 1) * 0.30619)


def feat_trees(kind, n):
    p = PAL["features"]
    spots = {1: [(0, 0)], 2: [(-0.35, 0.1), (0.3, -0.15)],
             3: [(-0.45, 0.15), (0.4, 0.2), (0.0, -0.3)],
             5: [(-0.5, 0.2), (0.05, 0.35), (0.5, 0.15), (-0.25, -0.3), (0.3, -0.35)]}[n]

    def build(W):
        for (x, y) in spots:
            box((x, y, 0), (0.08, 0.08, 0.15), p["trunk"], (p["trunk"], p["trunk_dark"], p["trunk_dark"]))
            if kind == "pine":
                cone((x, y, 0.12), 0.26, 0.75, p["pine"], segs=6, shade=(p["pine_light"], p["pine_dark"]))
            else:
                cone((x, y, 0.12), 0.3, 0.25, p["leaf"], segs=6, r_top=0.32, shade=(p["leaf_light"], p["leaf_dark"]))
                cone((x, y, 0.37), 0.32, 0.25, p["leaf"], segs=6, shade=(p["leaf_light"], p["leaf_dark"]))
    return build


def feat_mountain(snow):
    p = PAL["features"]

    def build(W):
        for (x, y, r, h) in [(0.05, 0.15, 0.7, 1.4), (-0.5, -0.15, 0.45, 0.8), (0.55, -0.2, 0.42, 0.75)]:
            cone((x, y, 0), r, h, p["rock"], segs=5, rot=0.3, shade=(p["rock_light"], p["rock_dark"]))
            if snow:
                k = 0.38
                cone((x, y, h * (1 - k) + 0.01), r * k + 0.02, h * k, p["snow"], segs=5, rot=0.3,
                     shade=(p["snow"], p["snow_dark"]))
    return build


def feat_hills():
    p = PAL["features"]

    def build(W):
        for (x, y, r, h) in [(-0.35, 0.15, 0.45, 0.35), (0.35, -0.1, 0.5, 0.4)]:
            cone((x, y, 0), r, h, p["hill"], segs=8, r_top=r * 0.45, shade=(p["hill_light"], p["hill_dark"]))
    return build


def feat_hut(n):
    p = PAL["features"]
    spots = [(0, 0)] if n == 1 else [(-0.4, 0.15), (0.35, 0.2), (0.0, -0.3)]

    def build(W):
        for (x, y) in spots:
            box((x, y, 0), (0.4, 0.3, 0.25), p["wall"], (p["wall_light"], p["wall"], p["wall_dark"]))
            roof((x, y, 0.25), (0.48, 0.38, 0.22), p["roof"], p["roof_dark"])
    return build


def feat_lair():
    p = PAL["features"]

    def build(W):
        for (x, y) in [(-0.3, 0.1), (0.3, 0.05)]:
            cone((x, y, 0), 0.3, 0.5, p["tent"], segs=4, rot=0.785, shade=(p["tent_light"], p["tent_dark"]))
        box((0.0, -0.3, 0), (0.05, 0.05, 0.7), p["trunk"], (p["trunk"], p["trunk_dark"], p["trunk_dark"]))
        box((0.12, -0.3, 0.55), (0.22, 0.02, 0.14), p["flag"], (p["flag"], p["flag"], p["flag"]))
    return build


def feat_mine():
    p = PAL["features"]

    def build(W):
        cone((0, 0.1, 0), 0.6, 0.55, p["rock"], segs=5, rot=0.3, shade=(p["rock_light"], p["rock_dark"]))
        box((0, -0.38, 0), (0.3, 0.06, 0.28), p["mine_hole"], (p["mine_hole"], p["mine_hole"], p["mine_hole"]))
        box((0, -0.42, 0.26), (0.38, 0.06, 0.05), p["trunk"], (p["trunk"], p["trunk_dark"], p["trunk_dark"]))
    return build


def feat_farm():
    p = PAL["features"]

    def build(W):
        for i, y in enumerate([-0.45, -0.15, 0.15, 0.45]):
            w = 1.4 - abs(y) * 1.2
            box((0, y, 0), (w, 0.18, 0.05), p["crop"] if i % 2 == 0 else p["crop_alt"],
                (p["crop_dark"], p["crop_dark"], p["crop_dark"]))
    return build


def feat_dock():
    p = PAL["features"]

    def build(W):
        box((0.0, 0.0, -0.02), (0.18, 1.1, 0.06), p["plank"], (p["plank"], p["plank_dark"], p["plank_dark"]))
        box((0.0, -0.4, -0.02), (0.7, 0.18, 0.06), p["plank"], (p["plank"], p["plank_dark"], p["plank_dark"]))
        cone((0.35, -0.05, 0.0), 0.2, 0.1, p["boat"], segs=4, r_top=0.26, shade=(p["boat"], p["boat_dark"]))
    return build


def feat_reeds():
    p = PAL["features"]

    def build(W):
        for (x, y) in [(-0.5, 0.1), (-0.3, -0.25), (0.1, 0.25), (0.35, -0.2), (0.55, 0.15), (0.0, -0.05)]:
            box((x, y, 0), (0.05, 0.05, 0.3), p["reed"], (p["reed"], p["reed_dark"], p["reed_dark"]))
    return build


def feat_cactus():
    p = PAL["features"]

    def build(W):
        for (x, y) in [(-0.35, 0.1), (0.4, -0.15)]:
            box((x, y, 0), (0.1, 0.1, 0.45), p["cactus"], (p["cactus"], p["cactus_dark"], p["cactus_dark"]))
            box((x + 0.1, y, 0.2), (0.1, 0.08, 0.15), p["cactus"], (p["cactus"], p["cactus_dark"], p["cactus_dark"]))
    return build


# ---------------------------------------------------------------- creatures
# Built big and blocky on purpose: silhouettes must read at 24 px. Each one
# is ~0.8-1.2 hex tall, with one bright accent colour (club, cap, axe, wings).

def blob(loc, r, h, color, shade, segs=8):
    """Rounded lump: a short widening frustum under a narrowing one."""
    x, y, z = loc
    cone((x, y, z), r * 0.75, h * 0.35, color, segs=segs, r_top=r, shade=shade)
    cone((x, y, z + h * 0.35), r, h * 0.65, color, segs=segs, r_top=r * 0.55, shade=shade)


def creature_troll():
    p = PAL["creatures"]

    def build(W):
        sk = (p["troll_light"], p["troll_dark"])
        # legs
        for dx in (-0.16, 0.16):
            box((dx, 0, 0), (0.16, 0.18, 0.28), p["troll_dark"], (p["troll"], p["troll_dark"], p["troll_dark"]))
        # big belly + shoulders
        blob((0, 0, 0.24), 0.42, 0.62, p["troll"], sk)
        # head sunk into shoulders
        blob((0, -0.05, 0.78), 0.2, 0.3, p["troll"], sk)
        # glowing eyes (big enough to survive 24 px)
        for dx in (-0.08, 0.08):
            box((dx, -0.2, 0.92), (0.07, 0.03, 0.06), p["eye"], (p["eye"], p["eye"], p["eye"]))
        # tusks
        for dx in (-0.08, 0.08):
            box((dx, -0.22, 0.82), (0.05, 0.04, 0.09), p["tusk"], (p["tusk"], p["tusk"], p["tusk"]))
        # arms
        box((-0.5, 0, 0.3), (0.14, 0.16, 0.42), p["troll"], (p["troll_light"], p["troll"], p["troll_dark"]))
        box((0.5, 0, 0.3), (0.14, 0.16, 0.42), p["troll"], (p["troll_light"], p["troll"], p["troll_dark"]))
        # club over the right shoulder
        box((0.58, -0.05, 0.25), (0.12, 0.12, 0.75), p["club"], (p["club_light"], p["club"], p["club_dark"]), rot=0.0)
        blob((0.58, -0.05, 0.9), 0.14, 0.22, p["club"], (p["club_light"], p["club_dark"]))
    return build


def creature_goblins():
    p = PAL["creatures"]

    def one(x, y, s):
        sk = (p["goblin_light"], p["goblin_dark"])
        box((x, y, 0), (0.2 * s, 0.16 * s, 0.22 * s), p["goblin_cloth"], (p["goblin_cloth"], p["goblin_cloth_dark"], p["goblin_cloth_dark"]))
        blob((x, y, 0.2 * s), 0.16 * s, 0.24 * s, p["goblin"], sk)
        # ears
        for dx in (-1, 1):
            box((x + dx * 0.17 * s, y, 0.3 * s), (0.14 * s, 0.03 * s, 0.06 * s), p["goblin"], (p["goblin_light"], p["goblin"], p["goblin_dark"]))
        # pointy red hood
        cone((x, y, 0.4 * s), 0.12 * s, 0.22 * s, p["hood"], segs=5, shade=(p["hood_light"], p["hood_dark"]))

    def build(W):
        # two goblins, each ~0.55 tall: shorter than an oak (0.62)
        one(-0.3, 0.1, 0.89)
        one(0.3, -0.15, 0.89)
    return build


def creature_orcs():
    p = PAL["creatures"]

    def build(W):
        sk = (p["orc_light"], p["orc_dark"])
        for dx in (-0.12, 0.12):
            box((dx, 0, 0), (0.14, 0.16, 0.25), p["orc_cloth"], (p["orc_cloth"], p["orc_cloth_dark"], p["orc_cloth_dark"]))
        box((0, 0, 0.22), (0.46, 0.3, 0.38), p["orc_cloth"], (p["orc_cloth"], p["orc_cloth"], p["orc_cloth_dark"]))
        blob((0, 0, 0.58), 0.18, 0.28, p["orc"], sk)
        # iron helmet
        cone((0, 0, 0.78), 0.2, 0.14, p["helmet"], segs=6, shade=(p["helmet_light"], p["helmet_dark"]))
        for dx in (-0.32, 0.32):
            box((dx, 0, 0.25), (0.12, 0.14, 0.34), p["orc"], (p["orc_light"], p["orc"], p["orc_dark"]))
        # big axe
        box((0.42, -0.05, 0.1), (0.06, 0.06, 0.8), p["club"], (p["club_light"], p["club"], p["club_dark"]))
        box((0.52, -0.05, 0.75), (0.24, 0.05, 0.22), p["helmet"], (p["helmet_light"], p["helmet"], p["helmet_dark"]))
    return build


def creature_dragon():
    p = PAL["creatures"]

    def build(W):
        sk = (p["dragon_light"], p["dragon_dark"])
        # coiled body
        blob((0.05, 0.15, 0), 0.45, 0.45, p["dragon"], sk)
        # neck + head
        cone((-0.2, -0.05, 0.3), 0.16, 0.45, p["dragon"], segs=6, r_top=0.12, shade=sk)
        box((-0.28, -0.12, 0.72), (0.34, 0.2, 0.18), p["dragon"], (p["dragon_light"], p["dragon"], p["dragon_dark"]))
        # horns
        for dx in (-0.1, 0.06):
            cone((-0.2 + dx, -0.05, 0.88), 0.04, 0.16, p["tusk"], segs=4, shade=(p["tusk"], p["tusk"]))
        # wings: flat, tilted wedges in the accent colour
        for sx in (-1, 1):
            bm = bmesh.new()
            pts = [(0.15 * sx, 0.2, 0.4), (0.75 * sx, 0.35, 1.05), (0.8 * sx, 0.3, 0.45), (0.55 * sx, 0.25, 0.3)]
            vs = [bm.verts.new(v) for v in pts]
            bm.faces.new(vs if sx > 0 else list(reversed(vs)))
            link(bm, "wing", [mat(p["wing"])])
        # tail
        cone((0.45, -0.2, 0.0), 0.12, 0.1, p["dragon"], segs=5, r_top=0.05, shade=sk)
    return build


def unit_scout():
    p = PAL["creatures"]

    def build(W):
        for dx in (-0.07, 0.07):
            box((dx, 0, 0), (0.09, 0.1, 0.2), p["boots"], (p["boots"], p["boots"], p["boots"]))
        box((0, 0, 0.18), (0.28, 0.18, 0.3), p["tunic"], (p["tunic_light"], p["tunic"], p["tunic_dark"]))
        blob((0, 0, 0.46), 0.12, 0.2, p["skin"], (p["skin_light"], p["skin_dark"]))
        cone((0, 0, 0.6), 0.16, 0.1, p["hat"], segs=6, r_top=0.08, shade=(p["hat"], p["hat_dark"]))
        # banner pole
        box((0.24, 0.02, 0.0), (0.04, 0.04, 0.85), p["club"], (p["club_light"], p["club"], p["club_dark"]))
        box((0.34, 0.02, 0.62), (0.2, 0.02, 0.18), p["banner"], (p["banner"], p["banner"], p["banner"]))
    return build


def unit_caravan():
    p = PAL["creatures"]
    f = PAL["features"]

    def build(W):
        # ox
        box((-0.35, 0, 0.12), (0.36, 0.22, 0.22), p["ox"], (p["ox_light"], p["ox"], p["ox_dark"]))
        box((-0.58, 0, 0.2), (0.14, 0.16, 0.14), p["ox"], (p["ox_light"], p["ox"], p["ox_dark"]))
        for dx in (-0.48, -0.22):
            box((dx, 0, 0), (0.06, 0.12, 0.12), p["ox_dark"], (p["ox_dark"],) * 3)
        # cart with load
        box((0.2, 0, 0.12), (0.5, 0.36, 0.14), f["plank"], (f["plank"], f["plank_dark"], f["plank_dark"]))
        box((0.2, 0, 0.26), (0.4, 0.3, 0.2), p["cargo"], (p["cargo_light"], p["cargo"], p["cargo_dark"]))
        for dx in (0.0, 0.4):
            cone((dx, -0.2, 0.0), 0.12, 0.02, p["boots"], segs=8, r_top=0.12)
    return build


def unit_trader(flip=False):
    """Travelling merchant: a robed trader leading a donkey that pulls a covered
    wagon. Built facing -x (screen left); flip=True builds the mirror image so
    the right-facing sprite is lit from the same side, not just flipped."""
    p = PAL["creatures"]
    f = PAL["features"]
    sx = -1 if flip else 1

    def build(W):
        X = lambda x: x * sx
        # merchant, out in front, with a wide-brimmed hat and a walking staff
        for dy in (-0.05, 0.05):
            box((X(-0.92), dy, 0), (0.07, 0.07, 0.12), p["boots"], (p["boots"],) * 3)
        cone((X(-0.92), 0, 0.08), 0.15, 0.3, p["robe"], segs=6, r_top=0.09, shade=(p["robe_light"], p["robe_dark"]))
        blob((X(-0.92), 0, 0.38), 0.09, 0.16, p["skin"], (p["skin_light"], p["skin_dark"]))
        cone((X(-0.92), 0, 0.5), 0.2, 0.02, p["robe_dark"], segs=8, r_top=0.2, shade=(p["robe_dark"], p["robe_dark"]))
        cone((X(-0.92), 0, 0.52), 0.1, 0.12, p["robe"], segs=6, r_top=0.05, shade=(p["robe_light"], p["robe_dark"]))
        box((X(-1.06), -0.06, 0), (0.035, 0.035, 0.62), p["club"], (p["club_light"], p["club"], p["club_dark"]))
        # donkey
        for dx in (-0.6, -0.36):
            for dy in (-0.06, 0.06):
                box((X(dx), dy, 0), (0.05, 0.05, 0.13), p["donkey_dark"], (p["donkey_dark"],) * 3)
        box((X(-0.48), 0, 0.12), (0.34, 0.17, 0.15), p["donkey"], (p["donkey_light"], p["donkey"], p["donkey_dark"]))
        box((X(-0.7), 0, 0.2), (0.13, 0.11, 0.12), p["donkey"], (p["donkey_light"], p["donkey"], p["donkey_dark"]))
        for dy in (-0.035, 0.035):
            box((X(-0.66), dy, 0.32), (0.03, 0.03, 0.09), p["donkey_dark"], (p["donkey_dark"],) * 3)
        box((X(-0.3), 0, 0.14), (0.24, 0.025, 0.025), f["plank_dark"], (f["plank_dark"],) * 3)  # shafts
        # covered wagon
        box((X(0.18), 0, 0.12), (0.56, 0.36, 0.08), f["plank"], (f["plank"], f["plank_dark"], f["plank_dark"]))
        box((X(0.18), 0, 0.2), (0.5, 0.32, 0.16), p["canvas"], (p["canvas_light"], p["canvas"], p["canvas_dark"]))
        roof((X(0.18), 0, 0.36), (0.52, 0.34, 0.14), p["canvas_light"], p["canvas_dark"])
        box((X(0.18), 0, 0.27), (0.5, 0.33, 0.035), p["stripe"], (p["stripe"],) * 3)
        for dx in (-0.04, 0.4):
            cone((X(dx), -0.2, 0.0), 0.12, 0.02, p["wheel"], segs=8, r_top=0.12)
    return build


# Real-world scale rules (hex = 2 units wide; pine 0.87 tall, oak 0.62):
#   goblin < oak, human ~0.6, orc ~ tree, troll slightly > pine, dragon fits one hex.
CREATURE_SCALE = {"troll": 0.95, "orcs": 0.9, "goblins": 1.0, "dragon": 1.1, "scout": 0.8, "caravan": 0.9,
                  "trader": 0.85, "trader_r": 0.85}

FEATURES = {
    "troll": creature_troll(), "goblins": creature_goblins(), "orcs": creature_orcs(), "dragon": creature_dragon(),
    "scout": unit_scout(), "caravan": unit_caravan(), "trader": unit_trader(), "trader_r": unit_trader(flip=True),
    "pine1": feat_trees("pine", 1), "pine3": feat_trees("pine", 3), "pine5": feat_trees("pine", 5),
    "oak1": feat_trees("oak", 1), "oak3": feat_trees("oak", 3), "oak5": feat_trees("oak", 5),
    "mountain": feat_mountain(False), "mountain_snow": feat_mountain(True),
    "hills": feat_hills(), "hut": feat_hut(1), "village": feat_hut(3),
    "lair": feat_lair(), "mine": feat_mine(), "farm": feat_farm(), "dock": feat_dock(),
    "reeds": feat_reeds(), "cactus": feat_cactus(),
}


def main():
    a = args()
    W = a["size"]
    face = W // 2
    tier = W // 8
    out = os.path.abspath(a["out"])
    reset_scene()
    jobs = []
    if a["only"] in (None, "terrain"):
        for name in PAL["terrain"]:
            jobs.append(("terrain", name, terrain(name)))
    if a["only"] in (None, "features"):
        for name, fn in FEATURES.items():
            jobs.append(("features", name, fn))
    meta = {"size": W, "face": face, "tier": tier, "maxTier": MAX_TIER, "sprites": {}}
    # rendering a subset (--names / --only) adds to the existing set instead of replacing it
    old = os.path.join(out, "meta.json")
    if (a["names"] or a["only"]) and os.path.exists(old):
        with open(old) as fh:
            meta["sprites"] = json.load(fh).get("sprites", {})
    for kind, name, build in jobs:
        if a["names"] and name not in a["names"]:
            continue
        clear_objects()
        build(W)
        k = CREATURE_SCALE.get(name)
        if kind == "features" and k:
            for ob in bpy.data.objects:
                ob.scale = (k, k, k)
        if kind == "features":
            bpy.context.view_layer.update()
            zs = [(ob.matrix_world @ v.co) for ob in bpy.data.objects if ob.type == "MESH" for v in ob.data.vertices]
            if zs:
                print(f"BOUNDS {name}: height={max(v.z for v in zs):.2f} width={max(v.x for v in zs) - min(v.x for v in zs):.2f}")
        if kind == "terrain":
            H = face + (MAX_TIER + 1) * tier
            ax, ay = W // 2, face // 2
        else:
            H = W * 2 if name in CREATURE_SCALE else W * 3 // 2
            ax, ay = W // 2, H - face // 2
        setup_camera(W, H, ax, ay)
        render(os.path.join(out, kind, name + ".png"))
        meta["sprites"][f"{kind}/{name}"] = {"w": W, "h": H, "ax": ax, "ay": ay}
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)


main()
