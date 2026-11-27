"""Pack the Blender house renders (tools/blender/render_houses.py) into one sheet for the village
demo: the game's 1px darkened outline on each, plus every model's ground footprint.
Also writes each sprite's coarse silhouette (`masks`: 16 x 24 blocks of 4 px, a bit set where any pixel is
opaque, as hex), which the city rules use to keep a new home from hiding one behind it (src/game/city.ts).
Run: python3 tools/pack_houses.py <render dir>   ->  public/art/houses/houses.png, houses.json
(the render dir comes from: REPO=$PWD OUT=<dir> Blender --background --factory-startup --python tools/blender/render_houses.py)"""
import hashlib, json, os, sys
from PIL import Image
from unbrace import unbrace
SRC = sys.argv[1]
def outline(img):
    out = img.copy(); src, dst = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            if src[x, y][3]: continue
            nb = [src[x + dx, y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < img.width and 0 <= y + dy < img.height and src[x + dx, y + dy][3]]
            if nb: dst[x, y] = tuple(int(v * 0.45) for v in nb[0][:3]) + (255,)
    return out
keys = sorted(k[:-4] for k in os.listdir(SRC) if k.endswith('.png'))
COLS = 16; W, H = 64, 96
sheet = Image.new('RGBA', (COLS * W, ((len(keys) + COLS - 1) // COLS) * H))
frames = {}
masks = {}
for n, k in enumerate(keys):
    x, y = (n % COLS) * W, (n // COLS) * H
    sprite = outline(Image.open(os.path.join(SRC, k + '.png')).convert('RGBA'))
    unbrace(sprite)  # no dashed diagonal braces on the walls
    sheet.alpha_composite(sprite, (x, y))
    frames[k] = [x, y]
    a = Image.open(os.path.join(SRC, k + '.png')).convert('RGBA').split()[3]
    bits = ''.join('1' if any(a.getpixel((bx * 4 + i, by * 4 + j)) > 0 for i in range(4) for j in range(4)) else '0' for by in range(24) for bx in range(16))
    masks[k] = '%096x' % int(bits, 2)
fp = json.load(open(os.path.join(SRC, 'footprints.json')))
OUT = 'public/art/houses'
os.makedirs(OUT, exist_ok=True)
sheet.save(f'{OUT}/houses.png', optimize=True)
h = hashlib.sha1(open(f'{OUT}/houses.png', 'rb').read()).hexdigest()[:12]
json.dump({'w': W, 'h': H, 'ax': 32, 'ay': 80, 'hash': h, 'frames': frames, 'masks': masks, 'footprints': {k: [round(v * 32, 2) for v in fp[k]] for k in fp}}, open(f'{OUT}/houses.json', 'w'))
print(len(keys), 'sprites', sheet.size)
