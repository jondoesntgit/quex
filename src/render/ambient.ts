/** Ambient life on the map: surf on the shores, glints on open water, trees
 *  swaying and fields shimmering as gusts of wind roll across the land.
 *  Everything is drawn with plain sprites and Graphics, so it looks the same
 *  on every renderer, and it's skipped when zoomed far out, off screen, or
 *  when the player has asked for reduced motion. Purely cosmetic. */
import { Container, Graphics, type Sprite } from 'pixi.js'

const FOAM = 0xf4fbff
const GLINT = 0xffffff
const SHIMMER = 0xfff2b8

/** 0..1: how hard the wind blows at x (world px) at time t (s). Gusts travel east. */
export function gust(x: number, y: number, t: number): number {
  const a = Math.sin(t * 0.55 - x * 0.012 - y * 0.004)
  const b = Math.sin(t * 0.23 - x * 0.005 + 1.7)
  const g = 0.5 + 0.35 * a + 0.15 * b // 0..1
  return g * g
}

/** Cheap stable hash -> 0..1 */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Surf { waves: Container[]; rim: Graphics; phase: number; period: number }
interface Glint { g: Graphics; phase: number; period: number }
interface Tree { s: Sprite; x: number; y: number; amp: number; phase: number }
interface Field { g: Graphics; x: number; y: number }

export class Ambient {
  private surf: Surf[] = []
  private glints: Glint[] = []
  private trees: Tree[] = []
  private fields: Field[] = []
  private reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  private on = true

  private W: number

  constructor(W: number) {
    this.W = W
    if (typeof matchMedia !== 'undefined') {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => { this.reduced = e.matches })
    }
  }

  /** The scene is being rebuilt: forget the old pieces (their owner destroys them). */
  reset() { this.surf = []; this.glints = []; this.trees = []; this.fields = [] }

  /** Surf for a water hex: `edges` are its shore edges as corner pairs around (cx, cy). Returns nodes to add. */
  shore(cx: number, cy: number, edges: [number, number, number, number][], seed: number): Container[] {
    const mk = () => { const c = new Container(); c.x = cx; c.y = cy; c.cullable = true; return c }
    const waves = [mk(), mk()]
    const wg = new Graphics()
    const rim = new Graphics()
    for (const [x0, y0, x1, y1] of edges) {
      // broken, pixel-ish strokes: three pieces with small gaps
      const pieces = 3
      for (let k = 0; k < pieces; k++) {
        const h = hash(seed + k, x0 + y1)
        const u0 = (k + 0.08 + h * 0.12) / pieces, u1 = (k + 0.92 - h * 0.12) / pieces
        const ax = x0 + (x1 - x0) * u0 - cx, ay = y0 + (y1 - y0) * u0 - cy
        const bx = x0 + (x1 - x0) * u1 - cx, by = y0 + (y1 - y0) * u1 - cy
        wg.moveTo(ax, ay).lineTo(bx, by)
        // the rim sits right at the waterline, a touch inside the hex
        rim.moveTo(cx + ax * 0.94, cy + ay * 0.94).lineTo(cx + bx * 0.94, cy + by * 0.94)
      }
    }
    wg.stroke({ width: 2, color: FOAM, alpha: 1, cap: 'round' })
    rim.stroke({ width: 2, color: FOAM, alpha: 1 })
    waves[0].addChild(wg)
    waves[1].addChild(wg.clone())
    rim.cullable = true
    const s: Surf = { waves, rim, phase: hash(seed, 3.1) * 0.35 + (cx * 0.004 + cy * 0.002), period: 4.2 + hash(seed, 7) * 1.4 }
    this.surf.push(s)
    return [rim, ...waves]
  }

  /** A few twinkles on an open-water hex. */
  glint(cx: number, cy: number, seed: number): Graphics | null {
    if (hash(seed, 1.3) > 0.35) return null
    const g = new Graphics()
    const n = 1 + Math.floor(hash(seed, 2.9) * 2)
    for (let k = 0; k < n; k++) {
      const x = Math.round(cx + (hash(seed, k + 4) - 0.5) * this.W * 0.6)
      const y = Math.round(cy + (hash(seed, k + 9) - 0.5) * this.W * 0.25)
      g.rect(x, y, 2, 1).rect(x + 3, y, 1, 1)
    }
    g.fill({ color: GLINT })
    g.alpha = 0
    g.cullable = true
    this.glints.push({ g, phase: hash(seed, 5.5) * 10, period: 2.5 + hash(seed, 6.6) * 4 })
    return g
  }

  /** A tree sprite (anchored at its foot) that sways in the wind. */
  tree(s: Sprite, x: number, y: number, seed: number) {
    this.trees.push({ s, x, y, amp: 0.05 + hash(seed, 8.8) * 0.03, phase: hash(seed, 4.4) * 6.28 })
  }

  /** Light catching a field or meadow as a gust passes. Returns the node to add. */
  field(cx: number, cy: number, seed: number, rows = 3): Graphics {
    const g = new Graphics()
    for (let k = 0; k < rows; k++) {
      const x = Math.round(cx + (hash(seed, k + 21) - 0.5) * this.W * 0.5)
      const y = Math.round(cy + (k - (rows - 1) / 2) * this.W * 0.07 + (hash(seed, k + 31) - 0.5) * 2)
      const len = 3 + Math.floor(hash(seed, k + 41) * 4)
      g.rect(x - (len >> 1), y, len, 1)
    }
    g.fill({ color: SHIMMER })
    g.alpha = 0
    g.cullable = true
    this.fields.push({ g, x: cx, y: cy })
    return g
  }

  /** Per frame. `scale` is the scene scale (below 1 when zoomed out). */
  update(t: number, scale: number) {
    const on = !this.reduced && scale >= 0.5
    if (!on) {
      if (this.on) {
        // settle everything to rest once
        for (const s of this.surf) { for (const w of s.waves) w.visible = false; s.rim.alpha = 0.7 }
        for (const g of this.glints) g.g.visible = false
        for (const tr of this.trees) tr.s.skew.x = 0
        for (const f of this.fields) f.g.visible = false
        this.on = false
      }
      return
    }
    if (!this.on) {
      for (const s of this.surf) for (const w of s.waves) w.visible = true
      for (const g of this.glints) g.g.visible = true
      for (const f of this.fields) f.g.visible = true
      this.on = true
    }

    for (const s of this.surf) {
      if (s.rim.culled) continue
      // two waves, half a cycle apart, roll in from well out, brighten,
      // break on the shore and fade back into the sea
      let brk = 0
      s.waves.forEach((w, k) => {
        const u = ((t / s.period + s.phase + k * 0.5) % 1 + 1) % 1
        w.scale.set(0.5 + 0.47 * Math.sin(u * Math.PI / 2))
        w.alpha = u < 0.8 ? 0.2 + 0.8 * (u / 0.8) : 1 - (u - 0.8) / 0.2
        brk = Math.max(brk, 1 - Math.abs(u - 0.88) * 6)
      })
      // the foam line at the waterline swells white as each wave breaks
      s.rim.alpha = 0.55 + 0.45 * Math.max(0, brk)
    }
    for (const g of this.glints) {
      if (g.g.culled) continue
      const u = ((t + g.phase) % g.period) / g.period
      g.g.alpha = u < 0.12 ? Math.sin((u / 0.12) * Math.PI) * 0.9 : 0
    }
    for (const tr of this.trees) {
      if (tr.s.culled) continue
      const w = gust(tr.x, tr.y, t)
      // lean with the gust, plus a little flutter
      tr.s.skew.x = -tr.amp * (0.25 + 0.75 * w) * (0.75 + 0.25 * Math.sin(t * 2.6 + tr.phase)) + tr.amp * 0.2 * Math.sin(t * 1.3 + tr.phase)
    }
    for (const f of this.fields) {
      if (f.g.culled) continue
      const w = gust(f.x, f.y, t)
      f.g.alpha = Math.max(0, (w - 0.45) / 0.55) * 0.85
    }
  }
}
