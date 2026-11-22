/** What lies on the ground: ore outcrops and loose stone, drawn in code so they
 *  scale with the hex (the old sprites were a few pixels wide, and vanished at
 *  the small art sizes phones use).
 *
 *  Each hex scatters its rocks at spots of its own (a pure function of the hex,
 *  so they never jump around), keeping clear of anything that would hide them:
 *  roads and rivers, which run from the middle to the hex's edges, and anything
 *  standing on the hex (a village, building, lair or trees): then they keep to
 *  its front edge and are drawn in front of it.
 */
import { Graphics } from 'pixi.js'
import { mulberry32 } from '../world/rng'

export type RockKind = 'copper' | 'iron' | 'tin' | 'salt' | 'stone' | 'silver' | 'pebble'

/** body, shade, light, and the ore showing in it (malachite green, rust, cassiterite...) */
const LOOK: Record<RockKind, { body: number; shade: number; light: number; ore?: number; oreLight?: number; flat?: boolean }> = {
  copper: { body: 0x6e6a58, shade: 0x46443a, light: 0x8e8a76, ore: 0x22a86c, oreLight: 0x8ef0c0 },
  iron: { body: 0x8a4a2a, shade: 0x55301c, light: 0xb86a3c, ore: 0x6e2a18, oreLight: 0xd48850 },
  tin: { body: 0x4a4256, shade: 0x2a2434, light: 0x6c6280, ore: 0x1e1828, oreLight: 0x9a8cc0 },
  silver: { body: 0x707884, shade: 0x464c56, light: 0x9aa2ae, ore: 0x5a6068, oreLight: 0xe8eef8 },
  stone: { body: 0xc4c0b2, shade: 0x8c887a, light: 0xe2dfd2 },
  salt: { body: 0xf2efe4, shade: 0xc8c2b0, light: 0xffffff, flat: true },
  pebble: { body: 0x9c988c, shade: 0x66625a, light: 0xc0bcb0 },
}

export interface Scatter {
  /** something stands in the middle of the hex */
  busy: boolean
  /** directions (from the middle, in pixels) of the roads leaving this hex */
  roads: [number, number][]
  /** trees here: keep to the front */
  wooded: boolean
}

/** How many rocks lie on a hex: a Poisson count with the given mean.
 *  (Scattering rocks at random over the whole world and counting them per hex
 *  gives exactly this, hex by hex and independently, so there's nothing to
 *  store: it's a pure function of the hex.) */
export function poisson(seed: number, mean: number, cap = 8): number {
  const rng = mulberry32((seed * 2246822519 + 13) >>> 0)
  const limit = Math.exp(-mean)
  let n = 0, p = rng()
  while (p > limit && n < cap) { n++; p *= rng() }
  return n
}

/** Spots for n rocks in a hex of width W centred on (0,0), clear of what would hide them.
 *  A rock often lies near the one before it, so they gather in small piles. The
 *  first k spots never change with n, so as rocks are taken the rest stay put. */
export function spots(seed: number, n: number, W: number, s: Scatter, gap = W * 0.12): [number, number][] {
  const rng = mulberry32((seed * 2654435761) >>> 0)
  const out: [number, number][] = []
  const hw = W * 0.34, hh = W * 0.15
  for (let tries = 0; out.length < n && tries < 80; tries++) {
    const near = out.length > 0 && rng() < 0.45 ? out[out.length - 1] : null
    const x = near ? near[0] + (rng() * 2 - 1) * gap * 1.6 : (rng() * 2 - 1) * hw
    const y = near ? near[1] + (rng() * 2 - 1) * gap * 0.8 : (rng() * 2 - 1) * hh
    // inside the hex's top face (an ellipse is close enough, and keeps off the rim)
    if ((x / hw) ** 2 + (y / hh) ** 2 > 1) continue
    // a building or trees fill the hex: rocks keep to its front edge, drawn in front of them
    if ((s.busy || s.wooded) && y < W * 0.06) continue
    if (s.roads.some(([rx, ry]) => nearSegment(x, y, rx, ry) < W * 0.07)) continue
    if (out.some(([ox, oy]) => Math.hypot(ox - x, (oy - y) * 2) < gap)) continue
    out.push([x, y])
  }
  return out
}

/** Distance from (x, y) to the segment from the middle (0,0) to (rx, ry). */
function nearSegment(x: number, y: number, rx: number, ry: number) {
  const len2 = rx * rx + ry * ry
  const t = len2 ? Math.max(0, Math.min(1, (x * rx + y * ry) / len2)) : 0
  return Math.hypot(x - rx * t, (y - ry * t) * 2)
}

/** Draw rocks of a kind at the given spots (relative to cx, cy); `size` is a fraction of W. */
export function drawRocks(g: Graphics, cx: number, cy: number, W: number, kind: RockKind, at: [number, number][], size: number, seed: number) {
  const L = LOOK[kind]
  const rng = mulberry32((seed * 40503 + 7) >>> 0)
  for (const [dx, dy] of at) {
    const r = Math.max(1.5, W * size * (0.8 + rng() * 0.45))
    const x = Math.round(cx + dx), y = Math.round(cy + dy)
    const h = L.flat ? r * 0.35 : r * 0.75
    // shadow on the ground
    g.ellipse(x + r * 0.15, y + r * 0.12, r * 1.1, r * 0.42).fill({ color: 0x000000, alpha: 0.2 })
    // an irregular lump: wider than tall, flat underneath
    const lump = [
      [-r, 0], [-r * 0.85, -h * 0.6], [-r * 0.35, -h], [r * 0.3, -h * 0.9], [r * 0.9, -h * 0.5], [r, 0], [r * 0.4, r * 0.2], [-r * 0.5, r * 0.2],
    ].map(([px, py]) => [Math.round(x + px), Math.round(y + py)]).flat()
    g.poly(lump, true).fill({ color: L.body })
    // shaded right side, lit top
    g.poly([x + r * 0.2, y - h * 0.85, x + r * 0.9, y - h * 0.5, x + r, y, x + r * 0.4, y + r * 0.2, x + r * 0.1, y].map(Math.round), true).fill({ color: L.shade })
    g.poly([x - r * 0.75, y - h * 0.55, x - r * 0.3, y - h * 0.95, x + r * 0.15, y - h * 0.85, x - r * 0.2, y - h * 0.45].map(Math.round), true).fill({ color: L.light })
    // the ore: patches and a glint
    if (L.ore) {
      const ps = Math.max(1, Math.round(r * 0.4))
      g.rect(Math.round(x - r * 0.45), Math.round(y - h * 0.35), ps * 1.4, ps).fill({ color: L.ore })
      g.rect(Math.round(x + r * 0.25), Math.round(y - h * 0.25), ps, ps).fill({ color: L.ore })
      g.rect(Math.round(x - r * 0.05), Math.round(y - h * 0.7), Math.max(1, ps * 0.6), Math.max(1, ps * 0.6)).fill({ color: L.oreLight! })
    }
  }
}
