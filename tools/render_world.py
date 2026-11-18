"""Render a world.json dump with the tile atlas (debug/preview)."""
import json, sys
from PIL import Image, ImageDraw
wj, atlas_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
region_only = len(sys.argv) > 4 and sys.argv[4] == 'start'
scale = int(sys.argv[5]) if len(sys.argv) > 5 else 1
w = json.load(open(wj)); A = json.load(open(atlas_dir + '/atlas.json')); AT = Image.open(atlas_dir + '/atlas.png')
W = A['size']; face = A['face']; tier = A['tier']
spr = {}
def get(n):
    if n not in spr:
        f = A['frames'][n]; spr[n] = (AT.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])), f)
    return spr[n]
c0, r0, c1, r1 = 0, 0, w['width'], w['height']
if region_only:
    rg = w['regions'][w['startRegion']]; c0, r0, c1, r1 = rg['col0'], rg['row0'], rg['col1'], rg['row1']
cols, rows = c1 - c0, r1 - r0
img = Image.new('RGBA', (int(cols * W * .75 + W * .25), int(rows * face + face + W * 1.5)), (20, 20, 36, 255))
top = W
def centre(c, r, t):
    lc, lr = c - c0, r - r0
    return int(lc * W * .75 + W / 2), int(top + lr * face + (face // 2 if c % 2 else 0) + face / 2 - t * tier)
sites = {(s['col'], s['row']): s['role'] for s in w['regions'][w['startRegion']]['sites']}
lairs = {(l['col'], l['row']) for l in w['lairs']}
SITE = {'port': 'f_dock', 'mining': 'f_mine', 'farm': 'f_farm', 'forestry': 'f_hut', 'herding': 'f_hut', 'explorer': 'f_village'}
d = ImageDraw.Draw(img)
for r in range(r0, r1):
    for parity in (0, 1):
        for c in range(c0 + ((c0 + parity) % 2), c1, 2) if False else [c for c in range(c0, c1) if c % 2 == parity]:
            terr, t, feat, rv, res = w['cells'][r * w['width'] + c]
            x, y = centre(c, r, t)
            im, f = get(f't_{terr}_{(c * 7 + r * 13) % 3}')
            img.alpha_composite(im, (x - f['ax'], y - f['ay']))
            if rv != -1 and t > 0:
                rc, rr = rv % w['width'], rv // w['width']
                tt = w['cells'][rv][1]
                x2, y2 = centre(rc, rr, max(tt, 0))
                mx, my = (x + x2) // 2, (y + y2) // 2
                ImageDraw.Draw(img).line([(x, y), (mx, max(my, y - 0))], fill=(80, 168, 240, 255), width=max(1, W // 12))
            key = (c, r)
            name = SITE.get(sites.get(key)) if key in sites else ('f_lair' if key in lairs else (f'f_{feat}' if feat else None))
            if name:
                im, f = get(name)
                img.alpha_composite(im, (x - f['ax'], y - f['ay']))
if scale > 1: img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
img.save(out); print(out, img.size)
