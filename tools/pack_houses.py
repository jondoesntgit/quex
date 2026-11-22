"""Pack the Blender house renders (tools/blender/render_houses.py) into one sheet for the village
demo: the game's 1px darkened outline on each, plus every model's ground footprint.
Run: python3 tools/pack_houses.py <render dir>   ->  public/art/houses/houses.png, houses.json
(the render dir comes from: REPO=$PWD OUT=<dir> Blender --background --factory-startup --python tools/blender/render_houses.py)"""
import hashlib, json, os, sys
from PIL import Image
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
for n, k in enumerate(keys):
    x, y = (n % COLS) * W, (n // COLS) * H
    sheet.alpha_composite(outline(Image.open(os.path.join(SRC, k + '.png')).convert('RGBA')), (x, y))
    frames[k] = [x, y]
fp = json.load(open(os.path.join(SRC, 'footprints.json')))
OUT = 'public/art/houses'
os.makedirs(OUT, exist_ok=True)
sheet.save(f'{OUT}/houses.png', optimize=True)
h = hashlib.sha1(open(f'{OUT}/houses.png', 'rb').read()).hexdigest()[:12]
json.dump({'w': W, 'h': H, 'ax': 32, 'ay': 80, 'hash': h, 'frames': frames, 'footprints': {k: [round(v * 32, 2) for v in fp[k]] for k in fp}}, open(f'{OUT}/houses.json', 'w'))
print(len(keys), 'sprites', sheet.size)
