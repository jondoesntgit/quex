"""Compose a small test island at several tile sizes for visual comparison."""
import json, random, sys
from PIL import Image, ImageDraw

ROOT = sys.argv[1] if len(sys.argv) > 1 else "public/art"
OUT = sys.argv[2] if len(sys.argv) > 2 else "art/preview_sizes.png"
SIZES = [24, 32, 48, 64]
DISPLAY = 96  # on-screen hex width for every size (nearest-neighbour upscale)

# 12 x 9 hand-made island: (terrain, tier, feature)
rnd = random.Random(3)
COLS, ROWS = 12, 9
grid = {}
for c in range(COLS):
    for r in range(ROWS):
        dx, dy = (c - 5.5) / 5.5, (r - 4) / 4
        d = (dx * dx + dy * dy) ** 0.5 + rnd.uniform(-0.12, 0.12)
        if d > 1.05: t, z, f = "deep", 0, None
        elif d > 0.9: t, z, f = "ocean", 0, None
        elif d > 0.78: t, z, f = "shallow", 0, None
        elif d > 0.68: t, z, f = "beach", 1, None
        elif d > 0.5: t, z, f = "grass", 1 + (c > 6), rnd.choice([None, None, "oak3", "farm"])
        elif d > 0.32: t, z, f = "forest", 2 + (c > 6), rnd.choice(["pine3", "pine5", "oak5"])
        elif d > 0.18: t, z, f = "hills", 3 + (c > 6), "hills"
        else: t, z, f = "rock", 5, "mountain_snow"
        grid[(c, r)] = (t, z, f)
grid[(3, 6)] = ("grass", 1, "village")
grid[(8, 2)] = ("rock", 4, "mine")
grid[(2, 4)] = ("swamp", 1, "reeds")
grid[(9, 6)] = ("desert", 2, "cactus")
grid[(5, 7)] = ("shallow", 0, "dock")
grid[(7, 5)] = ("forest", 3, "lair")

panels = []
for W in SIZES:
    meta = json.load(open(f"{ROOT}/{W}/atlas.json")); atlas = Image.open(f"{ROOT}/{W}/atlas.png")
    def spr(n):
        fr = meta["frames"][n]; return atlas.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"])), fr
    face, tier = meta["face"], meta["tier"]
    pw = int(COLS * W * 0.75 + W * 0.25) + 2
    ph = int(ROWS * face + face / 2 + 6 * tier + W * 1.5)
    img = Image.new("RGBA", (pw, ph), (24, 24, 40, 255))
    top = W * 1.5 - face
    cells = sorted(grid, key=lambda k: (k[1] * 2 + (k[0] % 2), k[0]))
    for (c, r) in cells:
        t, z, f = grid[(c, r)]
        cx = int(c * W * 0.75 + W / 2)
        cy = int(top + r * face + (face // 2 if c % 2 else 0) + face / 2 - z * tier)
        im, s = spr(f"t_{t}_{(c * 7 + r * 3) % 3}")
        img.alpha_composite(im, (cx - s["ax"], cy - s["ay"]))
        if f:
            im, s = spr(f"f_{f}")
            img.alpha_composite(im, (cx - s["ax"], cy - s["ay"]))
    k = DISPLAY / W
    img = img.resize((int(pw * k), int(ph * k)), Image.NEAREST)
    d = ImageDraw.Draw(img)
    d.text((8, 6), f"{W}px tiles  (shown x{k:g})", fill=(255, 255, 255, 255))
    panels.append(img)

out = Image.new("RGBA", (max(p.width for p in panels) * 2 + 10, sum(p.height for p in panels[::2]) + 10), (0, 0, 0, 255))
for i, p in enumerate(panels):
    out.alpha_composite(p, ((i % 2) * (p.width + 10) if i % 2 else 0, sum(q.height for q in panels[:i - i % 2:2]) + (i // 2) * 10))
out.save(OUT)
print(OUT, out.size)
