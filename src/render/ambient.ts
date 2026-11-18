/** Ambient life on the map: surf on the shores, ripples and glints on open water,
 *  flowing streams and waterfalls, and fields shimmering as gusts of wind roll across the land.
 *  Everything is drawn with plain sprites and Graphics, so it looks the same
 *  on every renderer, and it's skipped when zoomed far out, off screen, or
 *  when the player has asked for reduced motion. Purely cosmetic. */
import { Container, Graphics, Sprite, Texture } from 'pixi.js'

const FOAM = 0xf4fbff
const GLINT = 0xffffff
const RIPPLE_SHALLOW = 0xc8ecff
const RIPPLE_DEEP = 0x8cc4f4
const STREAM_FLECK = 0xc8ecff
const FALL_STREAK = 0xe4f6ff
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

interface Surf {
  waves: Graphics[]; drawn: number[]; rim: Graphics; phase: number; period: number
  cx: number; cy: number; segs: [number, number, number, number][] // relative to the hex centre
}

/** A crisp one-pixel line (Bresenham), as filled pixels: no blurry strokes. */
function pixelLine(g: Graphics, x0: number, y0: number, x1: number, y1: number) {
  let x = Math.round(x0), y = Math.round(y0)
  const X = Math.round(x1), Y = Math.round(y1)
  const dx = Math.abs(X - x), dy = -Math.abs(Y - y), sx = x < X ? 1 : -1, sy = y < Y ? 1 : -1
  let err = dx + dy
  for (let n = 0; n < 512; n++) {
    g.rect(x, y, 1, 1)
    if (x === X && y === Y) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}
/** bottom layer: a one-pixel-high dash drifting right across a water hex, a pixel at a time */
interface Ripple { s: Sprite; cx: number; y: number; half: number; x0: number; speed: number; phase: number; len: number }
/** top layer: a small bright spot that grows and shrinks by a pixel */
interface Spark { s: Sprite; x: number; y: number; phase: number; period: number }
/** a fleck of current flowing down a stream, along a polyline */
interface Fleck { s: Sprite; pts: [number, number][]; cum: number[]; len: number; off: number; speed: number; side: number }
/** a streak of water dropping down a waterfall */
interface Drop { s: Sprite; x: number; top: number; h: number; off: number; speed: number }
/** foam rising off the surf like smoke */
interface Puff { s: Sprite; x: number; y: number; dx: number; phase: number; period: number }
interface Field { g: Graphics; x: number; y: number }

export class Ambient {
  private surf: Surf[] = []
  private ripples: Ripple[] = []
  private sparks: Spark[] = []
  private puffs: Puff[] = []
  private flecks: Fleck[] = []
  private drops: Drop[] = []
  private splash: Puff[] = []
  private puffSurf = new Map<Surf, Puff[]>()
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
  reset() { this.surf = []; this.fields = []; this.ripples = []; this.sparks = []; this.puffs = []; this.puffSurf.clear(); this.flecks = []; this.drops = []; this.splash = [] }

  /** Current on a stream: light flecks drifting downstream along `pts` (upstream first). */
  stream(pts: [number, number][], width: number, seed: number): Sprite[] {
    const cum = [0]
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
    const len = cum[cum.length - 1]
    if (len < 4) return []
    const n = Math.max(1, Math.round(len / 9))
    const out: Sprite[] = []
    const speed = 5 + hash(seed, 150) * 2
    for (let k = 0; k < n; k++) {
      const s = this.dot(STREAM_FLECK, 0.9)
      s.width = 2
      this.flecks.push({ s, pts, cum, len, off: (k + hash(seed, k + 160) * 0.5) * (len / n), speed, side: width > 3 ? (k % 2 ? 1 : -1) : 0 })
      out.push(s)
    }
    return out
  }

  /** A waterfall down a cliff face: x at the lip, from y `top` down `h` pixels. Returns [column nodes, splash nodes]. */
  fall(x: number, top: number, h: number, width: number, seed: number): [Container[], Sprite[]] {
    const w = Math.max(2, width)
    const x0 = Math.round(x - w / 2), y0 = Math.round(top)
    const col = new Graphics()
    col.rect(x0 - 1, y0, w + 2, h).fill({ color: 0x2868b8 })
    col.rect(x0, y0, w, h).fill({ color: 0x50a8f0 })
    col.cullable = true
    const nodes: Container[] = [col]
    // streaks falling down the column, a pixel at a time
    for (let k = 0; k < Math.max(2, Math.round(w * h / 24)); k++) {
      const s = this.dot(FALL_STREAK, 0.9)
      s.height = 2
      this.drops.push({ s, x: x0 + Math.floor(hash(seed, k + 170) * w), top: y0, h, off: hash(seed, k + 180) * h, speed: 14 + hash(seed, k + 190) * 8 })
      nodes.push(s)
    }
    // foam where it lands
    const splash: Sprite[] = []
    for (let k = 0; k < 3; k++) {
      const s = this.dot(FOAM, 0)
      this.splash.push({ s, x: x0 + Math.floor(hash(seed, k + 200) * w), y: y0 + h, dx: k === 0 ? -1 : k === 1 ? 1 : 0, phase: hash(seed, k + 210), period: 0.9 + hash(seed, k + 220) * 0.6 })
      splash.push(s)
    }
    return [nodes, splash]
  }

  private dot(color: number, alpha = 1): Sprite {
    const s = new Sprite(Texture.WHITE)
    s.tint = color
    s.width = 1; s.height = 1
    s.alpha = alpha
    s.cullable = true
    return s
  }

  /** The water's own movement on a water hex (top face centred on cx, cy):
   *  ripples drifting right, and small highlights near the corners. */
  water(cx: number, cy: number, seed: number, deep: boolean, shore: boolean): Sprite[] {
    const out: Sprite[] = []
    const hh = this.W / 4, hw = this.W / 2
    const n = Math.max(2, Math.round(this.W / 16))
    for (let k = 0; k < n; k++) {
      // one row per ripple, spread over the hex, at least a pixel from the rim
      const dy = Math.round(((k + 0.5) / n - 0.5) * (hh * 2 - 4) + (hash(seed, k + 50) - 0.5) * 2)
      const half = Math.floor(hw - Math.abs(dy) - 3)
      if (half < 4) continue
      const s = this.dot(deep ? RIPPLE_DEEP : RIPPLE_SHALLOW, deep ? 0.55 : 0.75)
      this.ripples.push({ s, cx, y: cy + dy, half, x0: hash(seed, k + 60) * half * 2, speed: 2 + hash(seed, k + 70) * 1.5, phase: hash(seed, k + 80) * 6.28, len: 2 + Math.floor(hash(seed, k + 90) * 2) })
      out.push(s)
    }
    // highlights: in the hex's corners, more of them near the shore
    const corners: [number, number][] = [[hw - 5, 0], [-(hw - 5), 0], [hw / 2 - 2, hh - 3], [-(hw / 2 - 2), hh - 3], [hw / 2 - 2, -(hh - 3)], [-(hw / 2 - 2), -(hh - 3)]]
    const m = shore ? 2 : hash(seed, 99) < 0.5 ? 1 : 0
    for (let k = 0; k < m; k++) {
      const [ox, oy] = corners[Math.floor(hash(seed, k + 100) * 6)]
      const s = this.dot(GLINT, 0)
      this.sparks.push({ s, x: Math.round(cx + ox), y: Math.round(cy + oy), phase: hash(seed, k + 110) * 8, period: 3 + hash(seed, k + 120) * 3 })
      out.push(s)
    }
    return out
  }

  /** Surf for a water hex: `edges` are its shore edges as corner pairs around (cx, cy). Returns nodes to add. */
  shore(cx: number, cy: number, edges: [number, number, number, number][], seed: number): Container[] {
    const segs: [number, number, number, number][] = []
    for (const [x0, y0, x1, y1] of edges) {
      // broken strokes: three pieces with small gaps, each one pixel chunk
      const pieces = 3
      for (let k = 0; k < pieces; k++) {
        const h = hash(seed + k, x0 + y1)
        const u0 = (k + 0.1 + h * 0.12) / pieces, u1 = (k + 0.9 - h * 0.12) / pieces
        segs.push([x0 + (x1 - x0) * u0 - cx, y0 + (y1 - y0) * u0 - cy, x0 + (x1 - x0) * u1 - cx, y0 + (y1 - y0) * u1 - cy])
      }
    }
    // the rim sits right at the waterline, two pixels thick
    const rim = new Graphics()
    const f0 = 1 - 1 / (this.W / 4)
    for (const [ax, ay, bx, by] of segs) {
      pixelLine(rim, cx + ax * f0, cy + ay * f0, cx + bx * f0, cy + by * f0)
      // thicken toward the water: down/up for flat edges, sideways for slanted ones (no checkerboard)
      const flat = Math.abs(ay - by) < 1
      const ox = flat ? 0 : -Math.sign(ax + bx), oy = flat ? -Math.sign(ay + by) : 0
      pixelLine(rim, cx + ax * f0 + ox, cy + ay * f0 + oy, cx + bx * f0 + ox, cy + by * f0 + oy)
    }
    rim.fill({ color: FOAM })
    rim.cullable = true
    const waves = [new Graphics(), new Graphics()]
    for (const w of waves) w.cullable = true
    // foam puffs at the waterline, rising off each breaking wave
    const puffs: Sprite[] = []
    edges.forEach(([x0, y0, x1, y1], e) => {
      for (let k = 0; k < 2; k++) {
        const u = 0.25 + 0.5 * hash(seed + e, k + 130)
        const px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u
        const sp = this.dot(FOAM, 0)
        // drift a little away from the land, back over the water
        const away = Math.sign(cx - px) || 1
        this.puffs.push({ s: sp, x: Math.round(cx + (px - cx) * 0.9), y: Math.round(cy + (py - cy) * 0.9), dx: away, phase: hash(seed + e, k + 140), period: 0 })
        puffs.push(sp)
      }
    })
    const s: Surf = { waves, drawn: [-1, -1], rim, cx, cy, segs, phase: hash(seed, 3.1) * 0.35 + (cx * 0.004 + cy * 0.002), period: 4.2 + hash(seed, 7) * 1.4 }
    this.surf.push(s)
    for (const p of this.puffs.slice(-puffs.length)) p.period = s.period
    // puffs follow their own surf's timing
    this.puffSurf.set(s, this.puffs.slice(-puffs.length))
    return [rim, ...waves, ...puffs]
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
        for (const r of this.ripples) r.s.visible = false
        for (const sp of this.sparks) sp.s.visible = false
        for (const p of this.puffs) p.s.visible = false
        for (const f of this.flecks) f.s.visible = false
        for (const d of this.drops) d.s.visible = false
        for (const p of this.splash) p.s.visible = false
        for (const f of this.fields) f.g.visible = false
        this.on = false
      }
      return
    }
    if (!this.on) {
      for (const s of this.surf) for (const w of s.waves) w.visible = true
      for (const r of this.ripples) r.s.visible = true
      for (const sp of this.sparks) sp.s.visible = true
      for (const p of this.puffs) p.s.visible = true
      for (const f of this.flecks) f.s.visible = true
      for (const d of this.drops) d.s.visible = true
      for (const p of this.splash) p.s.visible = true
      for (const f of this.fields) f.g.visible = true
      this.on = true
    }

    for (const s of this.surf) {
      if (s.rim.culled) continue
      // two waves, half a cycle apart, roll in from well out, brighten,
      // break on the shore and fade back into the sea
      let brk = 0
      const reach = Math.floor(this.W / 8) // pixels out to sea where a wave starts
      let breakU = -1
      s.waves.forEach((w, k) => {
        const u = ((t / s.period + s.phase + k * 0.5) % 1 + 1) % 1
        // whole pixels only: the wave steps in one pixel at a time (redrawn only when it moves)
        const d = 3 + Math.round(reach * (1 - Math.sin(u * Math.PI / 2)))
        if (s.drawn[k] !== d) {
          s.drawn[k] = d
          const f = 1 - d / (this.W / 4)
          w.clear()
          for (const [ax, ay, bx, by] of s.segs) pixelLine(w, s.cx + ax * f, s.cy + ay * f, s.cx + bx * f, s.cy + by * f)
          w.fill({ color: FOAM })
        }
        w.alpha = u < 0.8 ? 0.2 + 0.8 * (u / 0.8) : 1 - (u - 0.8) / 0.2
        brk = Math.max(brk, 1 - Math.abs(u - 0.88) * 6)
        if (u >= 0.8) breakU = (u - 0.8) / 0.2
      })
      // the foam line at the waterline swells white as each wave breaks
      s.rim.alpha = 0.55 + 0.45 * Math.max(0, brk)
      // foam puffs rise and drift off the break, like smoke, then fade
      for (const p of this.puffSurf.get(s) ?? []) {
        const v = breakU < 0 ? -1 : (breakU + p.phase * 0.3) % 1
        if (v < 0) { p.s.alpha = 0; continue }
        const step = Math.floor(v * 4) // 0..3 pixels of travel
        p.s.x = p.x + p.dx * Math.min(2, step)
        p.s.y = p.y - step
        p.s.width = step < 2 ? 2 : 1
        p.s.alpha = 0.9 * (1 - v)
      }
    }
    for (const r of this.ripples) {
      if (r.s.culled) continue
      // drift right a whole pixel at a time, wrapping inside the hex
      const span = r.half * 2
      const pos = Math.floor(r.x0 + t * r.speed) % span
      // length breathes by one pixel (2-3 or 3-4), never splitting the ripple
      const len = r.len + (Math.sin(t * 0.9 + r.phase) > 0 ? 1 : 0)
      r.s.x = Math.round(r.cx - r.half + pos)
      r.s.y = r.y
      r.s.width = Math.min(len, span - pos)
      // fade in from the left rim and out at the right
      const edge = Math.min(pos, span - pos) / 4
      r.s.alpha = (r.s.tint === RIPPLE_DEEP ? 0.55 : 0.75) * Math.min(1, edge)
    }
    for (const sp of this.sparks) {
      if (sp.s.culled) continue
      // a bright spot that grows 1 -> 2 -> 1 pixels and goes out, now and then
      const u = ((t + sp.phase) % sp.period) / sp.period
      if (u > 0.3) { sp.s.alpha = 0; continue }
      const size = u > 0.1 && u < 0.2 ? 2 : 1
      sp.s.x = sp.x - (size - 1); sp.s.y = sp.y
      sp.s.width = size * 2 - (size === 1 ? 0 : 1); sp.s.height = size === 2 ? 2 : 1
      sp.s.alpha = 0.95
    }
    for (const f of this.flecks) {
      if (f.s.culled) continue
      // follow the stream downstream, landing on whole pixels
      const a = (f.off + t * f.speed) % f.len
      let k = 1
      while (k < f.cum.length - 1 && f.cum[k] < a) k++
      const [x0, y0] = f.pts[k - 1], [x1, y1] = f.pts[k]
      const seg = f.cum[k] - f.cum[k - 1] || 1
      const u = (a - f.cum[k - 1]) / seg
      f.s.x = Math.round(x0 + (x1 - x0) * u - 1)
      f.s.y = Math.round(y0 + (y1 - y0) * u) + f.side
      // fade in and out at the ends so the current runs on into the next hex
      f.s.alpha = 0.9 * Math.min(1, a / 3, (f.len - a) / 3)
    }
    for (const d of this.drops) {
      if (d.s.culled) continue
      const y = Math.floor((d.off + t * d.speed) % d.h)
      d.s.x = d.x
      d.s.y = d.top + y
      d.s.height = Math.min(2, d.h - y)
    }
    for (const p of this.splash) {
      if (p.s.culled) continue
      // a little spray at the foot of the fall, puffing up and out
      const v = ((t / p.period + p.phase) % 1 + 1) % 1
      const step = Math.floor(v * 3)
      p.s.x = p.x + p.dx * step
      p.s.y = p.y - 1 - step
      p.s.alpha = 0.9 * (1 - v)
    }
    for (const f of this.fields) {
      if (f.g.culled) continue
      const w = gust(f.x, f.y, t)
      f.g.alpha = Math.max(0, (w - 0.45) / 0.55) * 0.85
    }
  }
}
