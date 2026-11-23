/** Cobblestone, drawn in code: small setts in staggered rows over mortar, filling a hex just short
 *  of its edges. Where the neighbouring hex is cobbled too (on the same level), the stones run right
 *  across the edge to meet it. The rows are fixed to the picture's pixel grid (not to the hex), so
 *  they line up from one hex to the next. */
import type { Graphics } from 'pixi.js'

const MORTAR = 0xaaa494
const TONES = [0xbdb7a7, 0xb5af9f, 0xc3bdad, 0xb9b3a3]
const GLINT = 0xcfc9b9

const shade = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)

/** Mortar and setts over a polygon (a sett is laid only where it lies wholly inside), on the picture's pixel grid. */
function paint(g: Graphics, pts: [number, number][], k = 1) {
  g.poly(pts.flat(), true).fill({ color: shade(MORTAR, k) })
  const inside = (x: number, y: number) => {
    let c = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const byTone: [number, number, number, number][][] = TONES.map(() => [])
  const glints: [number, number, number, number][] = []
  // the grid is absolute (rows at multiples of 3, setts at multiples of 4), so it meets the next hex's
  for (let r = Math.floor(Math.min(...ys) / 3); r <= Math.ceil(Math.max(...ys) / 3); r++) {
    const y = r * 3, shift = (((r % 2) + 2) % 2) * 2
    for (let x = Math.floor(Math.min(...xs) / 4) * 4 - 4 + shift; x < Math.max(...xs) + 4; x += 4) {
      const w = 3 + ((((x * 7 + y * 3) % 3) + 3) % 3 === 0 ? 1 : 0)
      if (!inside(x, y) || !inside(x + w, y) || !inside(x, y + 2) || !inside(x + w, y + 2)) continue
      const tone = (((x * 5 + y * 3) % TONES.length) + TONES.length) % TONES.length
      byTone[tone].push([x, y, w, 2])
      glints.push([x, y, 1, 1])
    }
  }
  byTone.forEach((rects, t) => {
    if (!rects.length) return
    for (const [x, y, w, h] of rects) g.rect(x, y, w, h)
    g.fill({ color: shade(TONES[t], k) })
  })
  if (glints.length) {
    for (const [x, y, w, h] of glints) g.rect(x, y, w, h)
    g.fill({ color: shade(GLINT, k) })
  }
}

/** `joined[k]`: the neighbour across edge k (hex.ts order: NE, SE, S, SW, NW, N) is cobbled too, on any level.
 *  `drops[k]`: that neighbour is lower, by this many px: on the three edges that face us the cliff between
 *  is paved over as a ramp (a little darker, as a slope is), so the cobbles run down to the hex below. */
export function drawCobbles(g: Graphics, cx: number, cy: number, W: number, joined: boolean[] = [], drops: number[] = []) {
  const hw = W / 2, qw = W / 4, hh = W / 4
  // corners in order E, SE, SW, W, NW, NE; corner k lies between the neighbours k and k+1
  // (neighbour order NE, SE, S, SW, NW, N), so it goes out to the true edge when both are cobbled
  const unit: [number, number][] = [[hw, 0], [qw, hh], [-qw, hh], [-hw, 0], [-qw, -hh], [qw, -hh]]
  const pts: [number, number][] = []
  for (let k = 0; k < 6; k++) {
    const at = (full: boolean): [number, number] => { const f = full ? 1.04 : 0.88; return [Math.round(cx + unit[k][0] * f), Math.round(cy + unit[k][1] * f)] }
    const a = at(!!joined[k]), b = at(!!joined[(k + 1) % 6])
    pts.push(a)
    if (a[0] !== b[0] || a[1] !== b[1]) pts.push(b)
  }
  paint(g, pts)
  // ramps down the cliff on the edges facing us (SE, S, SW: between corners k-1 and k)
  for (const k of [1, 2, 3]) {
    const d = drops[k] ?? 0
    if (!joined[k] || d <= 0) continue
    const A = unit[k - 1], B = unit[k]
    const top = (u: [number, number]): [number, number] => [Math.round(cx + u[0] * 0.98), Math.round(cy + u[1])]
    const a = top(A), b = top(B)
    paint(g, [a, b, [b[0], b[1] + d], [a[0], a[1] + d]], 0.8)
  }
}
