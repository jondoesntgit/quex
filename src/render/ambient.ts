/** Ambient life on the map: surf on the shores, ripples and glints on open water,
 *  flowing streams and waterfalls, and fields shimmering as gusts of wind roll across the land.
 *  Everything is drawn with plain sprites and Graphics, so it looks the same
 *  on every renderer, and it's skipped when zoomed far out, off screen, or
 *  when the player has asked for reduced motion. Purely cosmetic. */
import { Container, Graphics, Sprite, Texture } from 'pixi.js'

/** animated spots built at once (each is a hex's worth of ripples, surf, current or shimmer) */
const MAX_LIVE = 300
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

interface Surf { waves: Container[]; rim: Graphics; phase: number; period: number }

/** Crescent-shaped foam crests along an edge (relative to the hex centre):
 *  broken into a few arcs of uneven length that bulge out toward the water,
 *  with a little wobble, so the surf never reads as a ruled line. */
function crests(g: Graphics, x0: number, y0: number, x1: number, y1: number, seed: number, bulge: number) {
  const ex = x1 - x0, ey = y1 - y0
  const len = Math.hypot(ex, ey) || 1
  // unit normal pointing into the hex (toward the centre, which is the origin)
  let nx = -ey / len, ny = ex / len
  if (nx * -(x0 + x1) + ny * -(y0 + y1) < 0) { nx = -nx; ny = -ny }
  const arcs = 2 + Math.floor(hash(seed, 1) * 2)
  for (let k = 0; k < arcs; k++) {
    const a0 = (k + 0.08 + hash(seed, k + 2) * 0.2) / arcs
    const a1 = (k + 0.92 - hash(seed, k + 5) * 0.2) / arcs
    const amp = bulge * (0.6 + hash(seed, k + 8) * 0.8)
    const N = 8
    for (let j = 0; j <= N; j++) {
      const u = j / N, t = a0 + (a1 - a0) * u
      const off = amp * Math.sin(Math.PI * u) + 0.3 * Math.sin(u * 7 + seed)
      const x = x0 + ex * t + nx * off, y = y0 + ey * t + ny * off
      if (j === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
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

  private W: number

  constructor(W: number) {
    this.W = W
    if (typeof matchMedia !== 'undefined') {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => { this.reduced = e.matches })
    }
  }

  /** The scene is being rebuilt: forget the old pieces (their owner destroys them). */
  reset() { this.specs = []; this.live = []; this.win = null; this.forget() }

  private forget() { this.surf = []; this.fields = []; this.ripples = []; this.sparks = []; this.puffs = []; this.puffSurf.clear(); this.flecks = []; this.drops = []; this.splash = [] }

  // Only the hexes around the camera get real objects: the scene records a
  // cheap spec per animated spot, and `view` builds the ones inside a window
  // around what's on screen, rebuilding as the camera leaves it. The world
  // has thousands of water hexes; drawing (and culling) them all every frame
  // halved the frame rate on phones.
  private specs: { x: number; y: number; build: () => [Container, number][] }[] = []
  private live: Container[] = []
  private win: [number, number, number, number] | null = null

  /** Record an animated spot at (x, y); `build` makes its nodes with their zIndex when it comes into view. */
  add(x: number, y: number, build: () => [Container, number][]) { this.specs.push({ x, y, build }) }

  /** Keep the animated objects for the area on screen (x0..x1, y0..y1 in world px) in `parent`; true if it built new ones. */
  view(parent: Container, x0: number, y0: number, x1: number, y1: number, scale: number): boolean {
    if (this.reduced || scale < 0.5) {
      if (this.live.length) this.clearLive(parent)
      this.win = null
      return false
    }
    const w = this.win
    if (w && x0 >= w[0] && y0 >= w[1] && x1 <= w[2] && y1 <= w[3]) return false
    this.clearLive(parent)
    const mx = (x1 - x0) * 0.25 + this.W, my = (y1 - y0) * 0.25 + this.W
    const nw: [number, number, number, number] = [x0 - mx, y0 - my, x1 + mx, y1 + my]
    this.win = nw
    // at most MAX_LIVE spots, nearest the middle of the screen first
    const mxc = (x0 + x1) / 2, myc = (y0 + y1) / 2
    const near = this.specs.filter((sp) => sp.x >= nw[0] && sp.x <= nw[2] && sp.y >= nw[1] && sp.y <= nw[3])
    if (near.length > MAX_LIVE) near.sort((a, b) => Math.hypot(a.x - mxc, (a.y - myc) * 2) - Math.hypot(b.x - mxc, (b.y - myc) * 2))
    for (const sp of near.slice(0, MAX_LIVE)) {
      for (const [n, z] of sp.build()) { n.zIndex = z; parent.addChild(n); this.live.push(n) }
    }
    return true
  }

  private clearLive(parent: Container) {
    for (const n of this.live) { parent.removeChild(n); n.destroy({ children: true }) }
    this.live = []
    this.forget()
  }

  /** Current on a stream: light flecks drifting downstream along `pts` (upstream first). */
  stream(pts: [number, number][], width: number, seed: number): Sprite[] {
    const cum = [0]
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
    const len = cum[cum.length - 1]
    if (len < 4) return []
    const n = Math.max(1, Math.round(len / 14))
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

  /** A waterfall's motion down a cliff face: x at the lip, from y `top` down `h` pixels. Returns [streaks, splash]. */
  fall(x: number, top: number, h: number, width: number, seed: number): [Container[], Sprite[]] {
    const w = Math.max(2, width)
    const x0 = Math.round(x - w / 2), y0 = Math.round(top)
    // (the water column itself is static, drawn with the river)
    const nodes: Container[] = []
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
    const n = 2
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
    const rel = edges.map(([x0, y0, x1, y1]) => [x0 - cx, y0 - cy, x1 - cx, y1 - cy] as [number, number, number, number])
    // foam at the waterline: soft, slightly wavy, a touch inside the hex
    const rim = new Graphics()
    rel.forEach(([x0, y0, x1, y1], e) => crests(rim, x0 * 0.95, y0 * 0.95, x1 * 0.95, y1 * 0.95, seed * 3 + e, 0.8))
    rim.stroke({ width: 1.5, color: FOAM, cap: 'round', join: 'round' })
    rim.x = cx; rim.y = cy
    rim.cullable = true
    // two incoming crests, each its own shape, that glide in and break
    const waves = [0, 1].map((k) => {
      const c = new Container()
      c.x = cx; c.y = cy
      c.cullable = true
      const g = new Graphics()
      rel.forEach(([x0, y0, x1, y1], e) => crests(g, x0, y0, x1, y1, seed * 5 + e * 7 + k * 13, 2.2))
      g.stroke({ width: 1.5, color: FOAM, cap: 'round', join: 'round' })
      c.addChild(g)
      return c
    })
    // foam puffs at the waterline, rising off each breaking wave
    const puffs: Sprite[] = []
    edges.forEach(([x0, y0, x1, y1], e) => {
      for (let k = 0; k < 1; k++) {
        const u = 0.25 + 0.5 * hash(seed + e, k + 130)
        const px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u
        const sp = this.dot(FOAM, 0)
        // drift a little away from the land, back over the water
        const away = Math.sign(cx - px) || 1
        this.puffs.push({ s: sp, x: Math.round(cx + (px - cx) * 0.9), y: Math.round(cy + (py - cy) * 0.9), dx: away, phase: hash(seed + e, k + 140), period: 0 })
        puffs.push(sp)
      }
    })
    const s: Surf = { waves, rim, phase: hash(seed, 3.1) * 0.35 + (cx * 0.004 + cy * 0.002), period: 4.2 + hash(seed, 7) * 1.4 }
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
    if (!this.live.length || scale < 0.5) return

    for (const s of this.surf) {
      if (s.rim.culled) continue
      // two waves, half a cycle apart, roll in from well out, brighten,
      // break on the shore and fade back into the sea
      let brk = 0
      let breakU = -1
      s.waves.forEach((w, k) => {
        const u = ((t / s.period + s.phase + k * 0.5) % 1 + 1) % 1
        // swash and backwash: the crest glides up to the shore, then slides back out to sea
        const p = 0.5 - 0.5 * Math.cos(u * Math.PI * 2) // 0 out at sea, 1 at the shore (u = 0.5)
        w.scale.set(0.62 + 0.36 * p)
        // bright on the way in, a fainter film of foam on the way back
        w.alpha = u < 0.5 ? 0.15 + 0.85 * p : 0.1 + 0.55 * p
        brk = Math.max(brk, 1 - Math.abs(u - 0.5) * 6)
        if (u >= 0.45 && u < 0.75) breakU = (u - 0.45) / 0.3
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
