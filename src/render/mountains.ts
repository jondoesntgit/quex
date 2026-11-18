/** Mountain ranges, drawn in the game from one continuous height map instead
 *  of a sprite per hex, so a range reads as one landform:
 *  - height grows with how much mountain surrounds a point, so the tallest
 *    peaks rise in the middle of a range (often between hexes), and the range
 *    fades into the lowlands at its edge;
 *  - large-wavelength ridged noise carves ridgelines and valleys that wander
 *    across hexes, so nothing repeats hex to hex;
 *  - snow lies above one level snow line (a little lower where it's cold).
 *  Each hex draws its own slice, rasterised pixel by pixel (voxel-space style,
 *  front to back with an occlusion buffer), so it sorts with its hex like any
 *  other feature and stays crisp pixel art with no seams. Slices are packed
 *  into a few shared canvases and cached for the life of the world. */
import { CanvasSource, Rectangle, Texture } from 'pixi.js'
import { hexToPixel, neighbours } from '../world/hex'
import type { World } from '../world/types'

const K = Math.sqrt(3) // ground y -> true distance (the hex top is drawn half as tall as wide)

// palette (matches the Blender rock and snow)
const ROCK = [[0xe0, 0x90, 0x68], [0xc0, 0x68, 0x48], [0x88, 0x40, 0x30]] // light, mid, dark
const SNOW = [[0xff, 0xff, 0xff], [0xe4, 0xec, 0xf8], [0xb8, 0xc8, 0xe8]]

const isMountain = (f: string | null) => f === 'mountain' || f === 'mountain_snow'

/** deterministic value noise in [0, 1] */
function hash2(x: number, y: number, s: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return h - Math.floor(h)
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
/** ridged noise: sharp crests along the zero lines of smooth noise */
function ridged(x: number, y: number, s: number) {
  let sum = 0, amp = 1, f = 1, norm = 0
  for (let o = 0; o < 3; o++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, s + o * 17) * 2 - 1)
    sum += n * n * amp
    norm += amp
    amp *= 0.5
    f *= 2.1
  }
  return sum / norm
}

interface Slice { texture: Texture; ox: number; oy: number }

export class Mountains {
  private cache = new Map<number, Slice | null>()
  private sheets: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; source: CanvasSource; x: number; y: number; row: number; dirty: boolean }[] = []
  private seed: number
  private W: number
  private TP: number
  private world: World

  constructor(world: World, W: number, TP: number) {
    this.world = world
    this.W = W
    this.TP = TP
    let h = 0
    for (const ch of world.seed) h = (h * 31 + ch.charCodeAt(0)) | 0
    this.seed = (h % 1000) + 0.5
  }

  /** Upload slices drawn since the last frame. */
  flush() { for (const s of this.sheets) if (s.dirty) { s.source.update(); s.dirty = false } }

  /** This mountain hex's slice: draw it with its top-left at (cx + ox, cyLifted + oy). */
  slice(i: number): Slice | null {
    if (this.cache.has(i)) return this.cache.get(i)!
    const s = this.draw(i)
    this.cache.set(i, s)
    return s
  }

  // ------------------------------------------------------------ the height map

  /** Mountain hexes near (gx, gy) with their centres in true-distance space. */
  private near(i: number) {
    const { world } = this
    const c = world.cells[i]
    const out: { x: number; y: number; tier: number; cold: number; m: boolean }[] = []
    const seen = new Set<number>([i])
    let ring = [i]
    for (let r = 0; r < 3; r++) {
      const next: number[] = []
      for (const j of ring) {
        const cj = world.cells[j]
        const p = hexToPixel(cj.col, cj.row, this.W)
        out.push({ x: p.x, y: p.y * K, tier: cj.tier, cold: cj.feature === 'mountain_snow' ? 1 : 0, m: isMountain(cj.feature) })
        if (r < 2) for (const [nc, nr] of neighbours(cj.col, cj.row)) {
          if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
          const k = nr * world.width + nc
          if (!seen.has(k)) { seen.add(k); next.push(k) }
        }
      }
      ring = next
    }
    void c
    return out
  }

  /** Absolute height (px above sea) and snow line at ground point (gx, gy). */
  private makeField(i: number) {
    const W = this.W, TP = this.TP, S = this.seed
    const pts = this.near(i)
    const sig = 0.62 * W, k2 = 1 / (2 * sig * sig)
    const scale = 1 / (2.0 * W) // ridges a couple of hexes long
    return (gx: number, gy: number) => {
      const x = gx, y = gy * K
      let m = 0, wt = 0, tsum = 0, cold = 0
      let dM = Infinity, dN = Infinity
      for (const p of pts) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2
        if (p.m) {
          const w = Math.exp(-d2 * k2)
          m += w; wt += w; tsum += w * p.tier; cold += w * p.cold
          dM = Math.min(dM, d2)
        } else dN = Math.min(dN, d2)
      }
      if (wt <= 0) return { alt: 0, snow: Infinity, ground: 0 }
      // distance inside the range's outline (Voronoi edge between mountain and lowland hexes)
      const inside = dN === Infinity ? W : (Math.sqrt(dN) - Math.sqrt(dM)) / 2
      const fade = Math.max(0, Math.min(1, inside / (0.55 * W)))
      const edge = Math.pow(fade * fade * (3 - 2 * fade), 1.4) // foothills slope up gently
      // surrounded points stand taller: m is ~1 for a lone hex, 2-3 deep in a range
      const mass = 1 - Math.exp(-0.9 * m)
      const r = ridged(x * scale, y * scale, S)
      const fine = vnoise(x / (0.7 * W), y / (0.7 * W), S + 9) - 0.5
      const h = W * (0.12 + 1.55 * mass * mass) * (0.22 + 1.05 * Math.pow(r, 1.7)) + fine * 0.08 * W
      const tier = tsum / wt
      const snowLine = TP * 6 + W * (0.85 - 0.28 * (cold / wt))
      return { alt: tier * TP + Math.max(0, h) * edge, snow: snowLine, ground: tier * TP }
    }
  }

  // ------------------------------------------------------------ rasterising

  private draw(i: number): Slice | null {
    const { world, W, TP } = this
    const c = world.cells[i]
    if (!isMountain(c.feature)) return null
    const field = this.makeField(i)
    const p = hexToPixel(c.col, c.row, W)
    const base = c.tier * TP
    const top = Math.ceil(W * 2.0) // room above the hex for the tallest peaks
    const h = top + Math.ceil(W / 4) + 2
    const w = W
    const img = new Uint8ClampedArray(w * h * 4)
    const hw = W / 2, hh = W / 4
    const inHex = (dx: number, dy: number) => Math.abs(dy) <= hh && Math.abs(dx) <= hw - Math.abs(dy) * (hw - hw / 2) / hh
    // sample the height map once on a grid over the hex (half-pixel rows), then shade from neighbouring samples
    const STEP = 0.5
    const rows = Math.round((2 * hh) / STEP) + 1
    const Z = new Float32Array(rows * w), SN = new Float32Array(rows * w), ALT = new Float32Array(rows * w)
    for (let r = 0; r < rows; r++) {
      const dy = -hh + r * STEP
      for (let col = 0; col < w; col++) {
        const dx = col + 0.5 - hw
        if (!inHex(dx, dy) && !inHex(dx, dy - STEP) && !inHex(dx, dy + STEP) && !inHex(dx - 1, dy) && !inHex(dx + 1, dy)) continue
        const f = field(p.x + dx, p.y + dy)
        Z[r * w + col] = f.alt - base
        ALT[r * w + col] = f.alt
        SN[r * w + col] = f.snow
      }
    }
    const zg = (r: number, col: number) => Z[Math.max(0, Math.min(rows - 1, r)) * w + Math.max(0, Math.min(w - 1, col))]
    for (let col = 0; col < w; col++) {
      const dx = col + 0.5 - hw
      let ybuf = h // occlusion: lowest row not yet painted, from the bottom up
      // march the ground from the front of the hex to the back
      for (let r = rows - 1; r >= 0; r--) {
        const dy = -hh + r * STEP
        if (!inHex(dx, dy)) continue
        const z = Z[r * w + col]
        if (z <= 0.3) continue
        const sy = Math.floor(top + dy - z)
        if (sy >= ybuf) continue
        // light from the upper left, like the Blender art: shade by slope
        const dzx = (zg(r, col + 1) - zg(r, col - 1)) / 2
        const dzy = (zg(r + 1, col) - zg(r - 1, col)) / (2 * STEP * K)
        const nx = -dzx, ny = -dzy, nz = 1.2
        const lit = (-0.6 * nx + 0.5 * ny + 0.6 * nz) / Math.hypot(nx, ny, nz)
        const tone = lit > 0.7 ? 0 : lit > 0.42 ? 1 : 2
        const snowy = ALT[r * w + col] + (hash2(p.x + dx, p.y + dy, 3) - 0.5) * 2 > SN[r * w + col]
        const rgb = (snowy ? SNOW : ROCK)[tone]
        for (let y = Math.max(0, sy); y < ybuf; y++) {
          const o = (y * w + col) * 4
          img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; img[o + 3] = 255
        }
        ybuf = Math.max(0, sy)
      }
    }
    const spot = this.place(w, h)
    spot.sheet.ctx.putImageData(new ImageData(img, w, h), spot.x, spot.y)
    spot.sheet.dirty = true
    const texture = new Texture({ source: spot.sheet.source, frame: new Rectangle(spot.x, spot.y, w, h) })
    return { texture, ox: -hw, oy: -top }
  }

  /** Shelf-pack a w x h slot into a shared canvas. */
  private place(w: number, h: number) {
    const SIZE = 2048
    let sheet = this.sheets[this.sheets.length - 1]
    if (sheet && sheet.x + w > SIZE) { sheet.x = 0; sheet.y += sheet.row + 1; sheet.row = 0 }
    if (!sheet || sheet.y + h > SIZE) {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE; canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      const source = new CanvasSource({ resource: canvas, scaleMode: 'nearest' })
      sheet = { canvas, ctx, source, x: 0, y: 0, row: 0, dirty: false }
      this.sheets.push(sheet)
    }
    const at = { sheet, x: sheet.x, y: sheet.y }
    sheet.x += w + 1
    sheet.row = Math.max(sheet.row, h)
    return at
  }
}
