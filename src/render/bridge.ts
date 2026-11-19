/** A wood and stone bridge, drawn for any angle.
 *
 *  Given a bank-to-bank span (screen points), it's laid out in "flat" ground
 *  space (y doubled, so lengths and angles are true) along the span, then
 *  projected to the screen (y halved) and lifted by its height. Painted back
 *  to front: a shadow on the water, stone footings on both banks, the far
 *  rail, the plank deck (with a gentle hump), the deck's near edge, the near
 *  rail, and a post at each corner, so it reads correctly whichever way the
 *  road crosses the river. */
import type { Graphics } from 'pixi.js'
import type { Pt } from './waterways'

const WOOD = [0xc89458, 0xa8743f, 0x7a4f2c] // light, mid, dark
const RAIL = 0x5a3820
const STONE = [0xd4d0c4, 0xaaa69c, 0x7c786f]
const SHADOW = 0x0c2a44

export function drawBridge(g: Graphics, a: Pt, b: Pt, roadWidth: number) {
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
  const fx = b[0] - a[0], fy = (b[1] - a[1]) * 2
  const len = Math.hypot(fx, fy) || 1
  const ux = fx / len, uy = fy / len // along the deck (flat)
  const nx = -uy, ny = ux // across it
  const half = len / 2 + 2 // reach a little onto each bank
  const dw = roadWidth + 1 // deck width (flat px)
  const hump = Math.min(2.5, 0.8 + half / 8)
  const P = (t: number, s: number, h: number): Pt => [cx + ux * t + nx * s, cy + (uy * t + ny * s) / 2 - h]
  const lift = (t: number) => 1.5 + hump * (1 - (t / half) ** 2)
  const poly = (pts: Pt[], color: number, alpha = 1) => g.poly(pts.flat()).fill({ color, alpha })

  // shadow on the water, a little below
  const sh = half - 5 // only over the water, not the banks
  poly([P(-sh, -dw / 2, -1.5), P(sh, -dw / 2, -1.5), P(sh, dw / 2, -1.5), P(-sh, dw / 2, -1.5)], SHADOW, 0.25)

  // stone footings: a low block under each end, its top showing, sides shaded
  for (const end of [-1, 1]) {
    const t0 = end * (half - 3), t1 = end * (half + 1)
    const w = dw / 2 + 1
    const top = [P(t0, -w, 1.5), P(t1, -w, 1.5), P(t1, w, 1.5), P(t0, w, 1.5)]
    const base = [P(t0, -w, -1), P(t1, -w, -1), P(t1, w, -1), P(t0, w, -1)]
    for (let k = 0; k < 4; k++) poly([top[k], top[(k + 1) % 4], base[(k + 1) % 4], base[k]], k % 2 ? STONE[2] : STONE[1])
    poly(top, STONE[0])
  }

  // the side of the deck nearer the viewer is the one whose across-vector points down the screen
  const near = ny >= 0 ? 1 : -1
  const N = Math.max(3, Math.round(half / 1.8))
  const ts = Array.from({ length: N + 1 }, (_, k) => -half + (2 * half * k) / N)
  const rail = (side: number) => {
    const s = side * (dw / 2)
    g.moveTo(...P(ts[0], s, lift(ts[0]) + 2))
    for (const t of ts) g.lineTo(...P(t, s, lift(t) + 2))
    g.stroke({ width: 1, color: RAIL })
  }
  const posts = (side: number) => {
    for (const t of [ts[0], ts[N]]) {
      const [x, y] = P(t, side * (dw / 2), lift(t))
      g.rect(Math.round(x), Math.round(y) - 3, 1, 3).fill(RAIL)
    }
  }

  posts(-near)
  rail(-near) // far side first: the deck hides its feet
  for (let k = 0; k < N; k++) {
    const t0 = ts[k], t1 = ts[k + 1]
    poly([P(t0, -dw / 2, lift(t0)), P(t1, -dw / 2, lift(t1)), P(t1, dw / 2, lift(t1)), P(t0, dw / 2, lift(t0))], k % 2 ? WOOD[0] : WOOD[1])
  }
  // the deck's thickness on the near side
  for (let k = 0; k < N; k++) {
    const t0 = ts[k], t1 = ts[k + 1], s = near * (dw / 2)
    poly([P(t0, s, lift(t0)), P(t1, s, lift(t1)), P(t1, s, lift(t1) - 1.5), P(t0, s, lift(t0) - 1.5)], WOOD[2])
  }
  rail(near)
  posts(near)
}
