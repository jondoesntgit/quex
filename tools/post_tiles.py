"""Post-process raw Blender renders into chunky pixel tiles + a packed atlas.

    python3 tools/post_tiles.py art/raw/32 public/art/32

- snaps every pixel to the palette (kills any rounding drift)
- terrain: 1px rim on the top face (dark back edge, light front lip),
  per-biome pixel texture, VARIANTS seeded variants per terrain
- features: 1px darkened outline around the silhouette
- packs everything into atlas.png + atlas.json  {name: {x,y,w,h,ax,ay}}
"""
import json, os, random, sys
from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
PAL = json.load(open(os.path.join(HERE, "blender", "palette.json")))
VARIANTS = 3


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


ALL = set()
for t in PAL["terrain"].values():
    ALL.add(rgb(t["top"]))
    ALL.update(rgb(s) for s in t["sides"])
ALL.update(rgb(v) for v in PAL["features"].values())
ALL.update(rgb(v) for v in PAL["creatures"].values())
ALL = list(ALL)


def snap(img):
    px = img.load()
    cache = {}
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
                continue
            k = (r, g, b)
            if k not in cache:
                cache[k] = min(ALL, key=lambda c: sum((c[i] - k[i]) ** 2 for i in range(3)))
            px[x, y] = cache[k] + (255,)
    return img


# texture recipes: (alt colour factor, density, pattern)
TEXTURE = {
    "grass": (0.86, 0.07, "dots"), "meadow": (1.12, 0.08, "dots"), "forest": (0.82, 0.10, "dots"),
    "swamp": (0.78, 0.12, "dash"), "hills": (0.88, 0.07, "dots"), "desert": (0.90, 0.06, "dash"),
    "savannah": (0.88, 0.07, "dots"), "beach": (0.93, 0.05, "dots"), "rock": (0.85, 0.08, "dots"),
    "tundra": (0.92, 0.06, "dots"), "snow": (0.94, 0.04, "dots"),
    "shallow": (1.18, 0.05, "wave"), "ocean": (1.15, 0.04, "wave"), "deep": (1.15, 0.03, "wave"),
}


def terrain_variant(base, name, seed):
    img = base.copy()
    px = img.load()
    top = rgb(PAL["terrain"][name]["top"])
    W = img.width
    face = W // 2
    is_top = lambda x, y: 0 <= x < W and 0 <= y < img.height and px[x, y][:3] == top
    cells = [(x, y) for y in range(face + 2) for x in range(W) if is_top(x, y)]
    rnd = random.Random(f"{name}-{seed}-{W}")
    k, dens, pat = TEXTURE[name]
    alt = shade(top, k) + (255,)
    interior = [(x, y) for (x, y) in cells
                if all(is_top(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0)))]
    n = max(1, int(len(interior) * dens))
    for (x, y) in rnd.sample(interior, min(n, len(interior))):
        px[x, y] = alt
        if pat == "dash" and is_top(x + 1, y):
            px[x + 1, y] = alt
        if pat == "wave" and is_top(x + 1, y) and is_top(x - 1, y):
            px[x + 1, y] = alt
            px[x - 1, y] = alt
    # rim: compute the edge mask first (in-place edits would cascade), then paint.
    # Light lip along the whole rim reads as a bevel; a darker 1px line on the
    # two back (upper) diagonal edges separates neighbouring hexes.
    texture = {(x, y) for (x, y) in cells if px[x, y][:3] == alt[:3]}
    def face_px(x, y):
        return (x, y) in cellset
    cellset = set(cells)
    edges = [(x, y) for (x, y) in cells
             if any(not face_px(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for (x, y) in edges:
        upper = not face_px(x, y - 1)
        px[x, y] = shade(top, 0.80 if upper else 1.12) + (255,)
    del texture
    return img


def outline(img):
    out = img.copy()
    src, dst = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            if src[x, y][3]:
                continue
            nb = [src[x + dx, y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                  if 0 <= x + dx < img.width and 0 <= y + dy < img.height and src[x + dx, y + dy][3]]
            if nb:
                dst[x, y] = shade(nb[0][:3], 0.45) + (255,)
    return out


meta = json.load(open(os.path.join(SRC, "meta.json")))
sprites = []  # (name, img, ax, ay)
for key, m in meta["sprites"].items():
    kind, name = key.split("/")
    img = snap(Image.open(os.path.join(SRC, key + ".png")).convert("RGBA"))
    if kind == "terrain":
        for v in range(VARIANTS):
            sprites.append((f"t_{name}_{v}", terrain_variant(img, name, v), m["ax"], m["ay"]))
    else:
        sprites.append((f"f_{name}", outline(img), m["ax"], m["ay"]))

# PixelLab overrides: hand-picked sprites drawn at true scale for 64 px tiles.
# Feet sit a little in front of the hex centre; goblins come as a pair.
OVR = os.path.join(HERE, "..", "art", "pixellab")
if meta["size"] == 64 and os.path.isdir(OVR):
    def trim(im):
        bb = im.getbbox()
        return im.crop(bb) if bb else im
    def load(n):
        return trim(Image.open(os.path.join(OVR, n + ".png")).convert("RGBA"))
    face = meta["face"]
    over = {}
    for n in ("troll", "orcs", "dragon", "scout"):
        if os.path.exists(os.path.join(OVR, n + ".png")):
            over["f_" + n] = load(n)
    if os.path.exists(os.path.join(OVR, "goblin_a.png")):
        a, b = load("goblin_a"), load("goblin_b")
        pair = Image.new("RGBA", (a.width + b.width + 4, max(a.height, b.height) + 3), (0, 0, 0, 0))
        pair.alpha_composite(a, (0, 0))
        pair.alpha_composite(b, (a.width + 4, 3))
        over["f_goblins"] = trim(pair)
    sprites = [s for s in sprites if s[0] not in over]
    for name, im in over.items():
        sprites.append((name, im, im.width // 2, im.height - face // 6))

# shelf-pack
os.makedirs(DST, exist_ok=True)
sprites.sort(key=lambda s: -s[1].height)
AW = 512 if meta["size"] <= 32 else 1024
x = y = row_h = 0
frames = {}
placed = []
for name, img, ax, ay in sprites:
    if x + img.width > AW:
        x, y, row_h = 0, y + row_h + 1, 0
    placed.append((img, x, y))
    frames[name] = {"x": x, "y": y, "w": img.width, "h": img.height, "ax": ax, "ay": ay}
    x += img.width + 1
    row_h = max(row_h, img.height)
AH = 1
while AH < y + row_h:
    AH *= 2
atlas = Image.new("RGBA", (AW, AH), (0, 0, 0, 0))
for img, x, y in placed:
    atlas.alpha_composite(img, (x, y))
atlas.save(os.path.join(DST, "atlas.png"))
# the image's fingerprint: the game requests atlas.png?v=<hash>, so a cached old
# image can never be paired with a new frame list
import hashlib
png_hash = hashlib.sha1(open(os.path.join(DST, "atlas.png"), "rb").read()).hexdigest()[:12]
json.dump({"size": meta["size"], "face": meta["face"], "tier": meta["tier"], "maxTier": meta["maxTier"],
           "variants": VARIANTS, "hash": png_hash, "frames": frames}, open(os.path.join(DST, "atlas.json"), "w"))
print(DST, len(frames), "frames", atlas.size)
