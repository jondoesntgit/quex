"""Pack the Blender house renders (tools/blender/render_houses.py) into one sheet for the village
demo: the game's 1px darkened outline on each, plus every model's ground footprint.
Hex buildings (`k_…`) bring their walking grids and doors (`buildings`), and their ground layers (`k_…_g`).
Also writes each sprite's coarse silhouette (`masks`: 16 x 24 blocks of 4 px, a bit set where any pixel is
opaque, as hex), which the city rules use to keep a new home from hiding one behind it (src/game/city.ts).
Run: python3 tools/pack_houses.py <render dir>   ->  public/art/houses/houses.png, houses.json
(the render dir comes from: REPO=$PWD OUT=<dir> Blender --background --factory-startup --python tools/blender/render_houses.py)
 then the hex buildings and the road ramps into the same dir: ... --python tools/blender/render_buildings.py, then
 render_ramps.py; run from the repo root with PYTHONPATH=tools"""
import hashlib, json, os, sys
from PIL import Image
from unbrace import unbrace
SRC = sys.argv[1]
def outline(img, dark=0.45):
    out = img.copy(); src, dst = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            if src[x, y][3]: continue
            nb = [src[x + dx, y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < img.width and 0 <= y + dy < img.height and src[x + dx, y + dy][3]]
            if nb: dst[x, y] = tuple(int(v * dark) for v in nb[0][:3]) + (255,)
    return out
def despeckle(img, biggest=2):
    """Drop stray specks left by the render: any island of `biggest` opaque pixels or fewer (8-connected)."""
    px = img.load(); w, h = img.size; seen = set()
    for y in range(h):
        for x in range(w):
            if (x, y) in seen or not px[x, y][3]: continue
            comp = [(x, y)]; seen.add((x, y)); i = 0
            while i < len(comp):
                cx, cy = comp[i]; i += 1
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3]: seen.add((nx, ny)); comp.append((nx, ny))
            if len(comp) <= biggest:
                for (cx, cy) in comp: px[cx, cy] = (0, 0, 0, 0)
    return img
keys = sorted(k[:-4] for k in os.listdir(SRC) if k.endswith('.png'))
COLS = 32; W, H = 64, 96  # 32 across keeps the sheet within 2048 x 2048 (every GPU's texture limit)
sheet = Image.new('RGBA', (COLS * W, ((len(keys) + COLS - 1) // COLS) * H))
frames = {}
masks = {}
for n, k in enumerate(keys):
    x, y = (n % COLS) * W, (n // COLS) * H
    raw = Image.open(os.path.join(SRC, k + '.png')).convert('RGBA')
    sails = k.startswith('k_mill_s') and not k.endswith('_g')
    if raw.size != (W, H):  # rendered at several times the size: shrink with the edges blended (antialiased)
        raw = raw.convert('RGBa').resize((W, H), Image.BOX).convert('RGBA')
    elif k.startswith('k_'): despeckle(raw)  # stray pixels from the render
    # a building's ground layer (crops, yards, pits) lies flat on the land: no outline
    sprite = raw if k.endswith('_g') or k.startswith('r_') or sails else outline(raw, 0.25 if k.startswith(('k_docks', 'k_shipyard')) else 0.45)  # piers stand out against the water  # ramps join the road: no outline either
    unbrace(sprite)  # no dashed diagonal braces on the walls
    sheet.alpha_composite(sprite, (x, y))
    frames[k] = [x, y]
    a = raw.split()[3]
    bits = ''.join('1' if any(a.getpixel((bx * 4 + i, by * 4 + j)) > 0 for i in range(4) for j in range(4)) else '0' for by in range(24) for bx in range(16))
    masks[k] = '%096x' % int(bits, 2)
fp = json.load(open(os.path.join(SRC, 'footprints.json')))
OUT = 'public/art/houses'
os.makedirs(OUT, exist_ok=True)
sheet.save(f'{OUT}/houses.png', optimize=True)
h = hashlib.sha1(open(f'{OUT}/houses.png', 'rb').read()).hexdigest()[:12]
out = {'w': W, 'h': H, 'ax': 32, 'ay': 80, 'hash': h, 'frames': frames, 'masks': masks, 'footprints': {k: [round(v * 32, 2) for v in fp[k]] for k in fp}}
# the hex buildings' walking plans (render_buildings.py): grid, cells by key, doors, ground layers, animations
bp = os.path.join(SRC, 'buildings.json')
if os.path.exists(bp):
    b = json.load(open(bp))
    out['buildings'] = {'grid': b['grid'], 'walk': b['walk'], 'doors': b['doors'], 'ground': b['ground'], 'anim': b['frames']}
json.dump(out, open(f'{OUT}/houses.json', 'w'))
print(len(keys), 'sprites', sheet.size)
