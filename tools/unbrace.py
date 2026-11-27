"""Take the diagonal braces off the house walls: in the Blender renders a timber brace on a cottage's plaster
comes out as a dashed diagonal line of single dark pixels, which reads as a scratch, not a beam. A brace pixel
is a dark pixel with light plaster on all four sides (the posts and rails of the frame always touch more
dark wood); each one takes the colour of the plaster round it.
Used by pack_houses.py; run on its own it cleans the packed sheet in place:
    python3 tools/unbrace.py            ->  public/art/houses/houses.png (and the hash in houses.json)"""
import hashlib, json
from PIL import Image

def lum(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]

def unbrace(img, box=None):
    """Clean `img` (RGBA) in place, within box (x0, y0, x1, y1). Returns how many pixels changed.
    A brace pixel: dark, touching at most one other dark pixel edge to edge (not a post, rail or frame corner),
    with plaster on at least two sides, and either a step to another dark pixel on the diagonal across plaster,
    or (where the brace ends) a lone nub on the side of a post, the door frame or the sill."""
    px = img.load()
    x0, y0, x1, y1 = box or (0, 0, img.width, img.height)
    dark = lambda q: q[3] and lum(q) < 110
    plaster = lambda q: q[3] and lum(q) > 180 and q[0] >= q[2]
    hits = []
    for y in range(y0 + 1, y1 - 1):
        for x in range(x0 + 1, x1 - 1):
            p = px[x, y]
            if not dark(p):
                continue
            nb = [px[x + dx, y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            if sum(map(bool, map(dark, nb))) > 1 or sum(map(bool, map(plaster, nb))) < 2:
                continue
            step = any(dark(px[x + dx, y + dy]) and plaster(px[x + dx, y]) and plaster(px[x, y + dy]) for dx in (-1, 1) for dy in (-1, 1))
            # or where the brace meets a post or the door frame: a lone nub on the side of an upright
            nub = sum(map(bool, map(plaster, nb))) >= 3 and (any(
                dark(px[x + dx, y]) and dark(px[x + dx, y - 1]) and dark(px[x + dx, y + 1]) for dx in (-1, 1)) or any(
                dark(px[x, y + dy]) and dark(px[x - 1, y + dy]) and dark(px[x + 1, y + dy]) for dy in (-1, 1)))
            if not step and not nub:
                continue
            fill = [q for q in nb if plaster(q)]
            hits.append((x, y, max(fill, key=lambda q: sum(q[:3]) and fill.count(q))))
    for x, y, c in hits:
        px[x, y] = c
    return len(hits)

if __name__ == '__main__':
    OUT = 'public/art/houses'
    meta = json.load(open(f'{OUT}/houses.json'))
    sheet = Image.open(f'{OUT}/houses.png').convert('RGBA')
    total = 0
    for k, (x, y) in meta['frames'].items():
        n = unbrace(sheet, (x, y, x + meta['w'], y + meta['h']))
        if n: print(k, n)
        total += n
    sheet.save(f'{OUT}/houses.png', optimize=True)
    meta['hash'] = hashlib.sha1(open(f'{OUT}/houses.png', 'rb').read()).hexdigest()[:12]
    json.dump(meta, open(f'{OUT}/houses.json', 'w'))
    print(total, 'brace pixels removed')
