"""Build the favicon / app icons from the 64px tile atlas: one grass hex with
a short cliff and the village on top.  python3 tools/make_icons.py"""
import json
from PIL import Image, ImageDraw
A = json.load(open('public/art/64/atlas.json'))
AT = Image.open('public/art/64/atlas.png').convert('RGBA')

def spr(n):
    f = A['frames'][n]
    return AT.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])), f

def tile(depth=12, cy=27):
    im = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    t, f = spr('t_grass_0')
    col = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    col.alpha_composite(t, (32 - f['ax'], cy - f['ay']))
    # keep only a short prism: the top face swept down `depth` px
    mask = Image.new('L', (64, 64), 0)
    d = ImageDraw.Draw(mask)
    for dy in range(depth + 1):
        y = cy + dy
        d.polygon([(0, y), (16, y - 16), (47, y - 16), (63, y), (47, y + 16), (16, y + 16)], fill=255)
    im.paste(col, (0, 0), mask)
    v, g = spr('f_village')
    im.alpha_composite(v, (32 - g['ax'], cy - g['ay']))
    return im

icon = tile()
icon.save('public/favicon-64.png')
icon.resize((32, 32), Image.NEAREST).save('public/favicon-32.png')
# apple / android: opaque, centred with margin, crisp 3x
bg = Image.new('RGBA', (180, 180), (20, 20, 36, 255))
bg.alpha_composite(icon.resize((168, 168), Image.NEAREST) if False else icon.resize((192, 192), Image.NEAREST).crop((6, 0, 186, 180)))
bg.convert('RGB').save('public/apple-touch-icon.png')
big = Image.new('RGBA', (512, 512), (20, 20, 36, 255))
big.alpha_composite(icon.resize((448, 448), Image.NEAREST), (32, 40))
big.convert('RGB').save('public/icon-512.png')
