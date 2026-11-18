"""Monsters/units on terrain at every tile size, each upscaled to the same display width."""
import json, sys
from PIL import Image, ImageDraw
OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/preview_monsters.png'
SIZES = [24, 32, 48, 64]; DISPLAY = 80
# 7 x 3 strip: (terrain, tier, sprite)
G = {}
for c in range(7):
    for r in range(3):
        G[(c, r)] = ('grass', 1, None)
G.update({
    (0, 1): ('rock', 3, 'f_troll'), (1, 1): ('hills', 2, None), (2, 1): ('forest', 2, 'f_goblins'),
    (3, 1): ('grass', 1, 'f_orcs'), (4, 1): ('rock', 4, 'f_dragon'), (5, 1): ('meadow', 1, 'f_scout'),
    (6, 1): ('grass', 1, 'f_caravan'), (1, 0): ('forest', 2, 'f_pine3'), (3, 0): ('shallow', 0, None),
    (4, 0): ('rock', 3, None), (2, 2): ('beach', 1, None), (5, 2): ('grass', 1, 'f_village'),
    (6, 0): ('shallow', 0, None), (0, 2): ('swamp', 1, 'f_reeds'),
})
panels = []
for W in SIZES:
    A = json.load(open(f'public/art/{W}/atlas.json')); AT = Image.open(f'public/art/{W}/atlas.png')
    face, tier = A['face'], A['tier']
    def spr(n):
        f = A['frames'][n]; return AT.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])), f
    pw, ph = int(7 * W * .75 + W * .25), int(3 * face + face + 6 * tier + W * 1.5)
    img = Image.new('RGBA', (pw, ph), (24, 24, 40, 255))
    for r in range(3):
        for par in (0, 1):
            for c in [c for c in range(7) if c % 2 == par]:
                t, z, f = G[(c, r)]
                x = int(c * W * .75 + W / 2); y = int(W * 1.2 + r * face + (face // 2 if c % 2 else 0) - z * tier)
                im, fr = spr(f't_{t}_{(c + r) % 3}'); img.alpha_composite(im, (x - fr['ax'], y - fr['ay']))
                if f:
                    im, fr = spr(f); img.alpha_composite(im, (x - fr['ax'], y - fr['ay']))
    k = DISPLAY / W
    big = img.resize((int(pw * k), int(ph * k)), Image.NEAREST)
    ImageDraw.Draw(big).text((6, 4), f'{W}px  (x{k:g})', fill='white')
    panels.append((big, img))
Wd = max(b.width for b, _ in panels) + 20 + max(n.width for _, n in panels) * 2
out = Image.new('RGBA', (Wd, sum(b.height for b, _ in panels)), (0, 0, 0, 255))
y = 0
for big, nat in panels:
    out.alpha_composite(big, (0, y))
    n2 = nat.resize((nat.width * 2, nat.height * 2), Image.NEAREST)
    out.alpha_composite(n2, (big.width + 20, y))
    ImageDraw.Draw(out).text((big.width + 24, y + 4), 'x2 (phone-ish)', fill='white')
    y += big.height
out.save(OUT); print(OUT, out.size)
