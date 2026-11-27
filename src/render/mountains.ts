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

// palettes: light, mid, dark, darkest (gullies and strata go one step darker)
const GRAY = [[0xc4, 0xc6, 0xcc], [0x96, 0x98, 0xa6], [0x66, 0x68, 0x7a], [0x4a, 0x4c, 0x5e]] // granite and limestone
const RED = [[0xe0, 0x90, 0x68], [0xc0, 0x68, 0x48], [0x88, 0x40, 0x30], [0x62, 0x2c, 0x22]] // sandstone, near deserts
const SNOW = [[0xff, 0xff, 0xff], [0xe4, 0xec, 0xf8], [0xb8, 0xc8, 0xe8], [0x9c, 0xb0, 0xd8]]
const PINE = [[0x6c, 0xa8, 0x44], [0x4c, 0x88, 0x34], [0x36, 0x62, 0x28], [0x28, 0x4a, 0x20]] // forest on the lower slopes
const WARM_TERRAIN = new Set(['desert', 'savannah'])
// ore showing through the rock: copper's green-blue, iron's rust, tin's dark slate with pale glints
const STAIN: Record<string, number[][]> = {
  copper: [[0x70, 0xcc, 0x94], [0x3a, 0x9a, 0x68], [0x2a, 0x76, 0x50], [0x1e, 0x56, 0x3c]], // malachite
  iron: [[0xd0, 0x84, 0x58], [0xa8, 0x5c, 0x38], [0x78, 0x3e, 0x26], [0x56, 0x2c, 0x1c]],
  tin: [[0xb0, 0xb8, 0xe8], [0x68, 0x6c, 0x98], [0x4a, 0x4c, 0x70], [0x34, 0x36, 0x52]],
  silver: [[0xe8, 0xec, 0xf4], [0xa4, 0xaa, 0xb8], [0x70, 0x76, 0x84], [0x48, 0x4c, 0x58]], // galena: lead-grey with a metal shine
}
const ORES = ['copper', 'iron', 'tin', 'silver'] as const
const AZURITE = [[0x6c, 0x8c, 0xdc], [0x3c, 0x5c, 0xac], [0x2c, 0x44, 0x86], [0x1e, 0x30, 0x60]]
const GOSSAN = [[0xd4, 0x8c, 0x4c], [0xb4, 0x64, 0x2e], [0x7c, 0x3e, 0x1c], [0x5a, 0x2c, 0x14]] // the rusty cap over copper ore

const isMountain = (f: string | null) => f === 'mountain' || f === 'mountain_snow'

function strongest(ore: number[], all: number) {
  let k = -1, best = 0
  ore.forEach((v, j) => { if (v > best) { best = v; k = j } })
  return { ore: k, oreW: best / all }
}

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

  private warm = new Map<number, boolean>()
  /** Is this mountain hex's whole connected range sandstone? (a third or more of the land around it is desert or savannah) */
  private warmRange(i: number): boolean {
    const known = this.warm.get(i)
    if (known !== undefined) return known
    const { world } = this
    const range = [i], seen = new Set([i]), rim = new Set<number>()
    for (let k = 0; k < range.length; k++) {
      const c = world.cells[range[k]]
      for (const [nc, nr] of neighbours(c.col, c.row)) {
        if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
        const j = nr * world.width + nc
        if (isMountain(world.cells[j].feature)) { if (!seen.has(j)) { seen.add(j); range.push(j) } }
        else if (world.cells[j].tier > 0) rim.add(j)
      }
    }
    const warmRim = [...rim].filter((j) => WARM_TERRAIN.has(world.cells[j].terrain)).length
    const warm = rim.size > 0 && warmRim / rim.size >= 1 / 3
    for (const j of range) this.warm.set(j, warm)
    return warm
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

  private ledges = new Map<number, { dx: number; dy: number; h: number } | null>()
  /** Where on this mountain hex's slope a mine's way in goes, and how high the ground is there (px above the
   *  hex's base level): a spot toward the front that the hex's own ground doesn't hide, where the slope rises
   *  behind it (so the portal leads into the hillside). Null if it isn't a mountain hex. */
  ledge(i: number): { dx: number; dy: number; h: number } | null {
    if (this.ledges.has(i)) return this.ledges.get(i)!
    const { world, W, TP } = this
    const c = world.cells[i]
    let out: { dx: number; dy: number; h: number } | null = null
    if (isMountain(c.feature)) {
      const field = this.makeField(i)
      const p = hexToPixel(c.col, c.row, W)
      const base = c.tier * TP
      const at = (dx: number, dy: number) => Math.max(0, field(p.x + dx, p.y + dy).alt - base)
      let best = -Infinity
      for (const dx of [0, -0.08, 0.08, -0.16, 0.16].map((k) => Math.round(k * W))) {
        for (const dy of [0.16, 0.12, 0.08, 0.04].map((k) => Math.round(k * W))) {
          const h = at(dx, dy)
          // hidden if the ground in front, within the hex, stands higher on screen
          let hidden = false
          for (let f = dy + 1; f <= W / 4 - 1 && !hidden; f++) if (f - at(dx, f) < dy - h - 1) hidden = true
          if (hidden) continue
          const rise = at(dx, dy - W * 0.06) - h // the slope going back
          const score = rise + dy * 0.3 - Math.abs(dx) * 0.2
          if (score > best) { best = score; out = { dx, dy, h: Math.round(h) } }
        }
      }
      out ??= { dx: 0, dy: Math.round(W * 0.16), h: Math.round(at(0, Math.round(W * 0.16))) }
    }
    this.ledges.set(i, out)
    return out
  }

  // ------------------------------------------------------------ the height map

  /** Mountain hexes near (gx, gy) with their centres in true-distance space. */
  private near(i: number) {
    const { world } = this
    const c = world.cells[i]
    const out: { x: number; y: number; tier: number; cold: number; warm: number; m: boolean; ore: number }[] = []
    const seen = new Set<number>([i])
    let ring = [i]
    for (let r = 0; r < 3; r++) {
      const next: number[] = []
      for (const j of ring) {
        const cj = world.cells[j]
        const p = hexToPixel(cj.col, cj.row, this.W)
        out.push({ x: p.x, y: p.y * K, tier: cj.tier, cold: cj.feature === 'mountain_snow' || cj.terrain === 'snow' || cj.terrain === 'tundra' ? 1 : 0, warm: WARM_TERRAIN.has(cj.terrain) ? 1 : 0, m: isMountain(cj.feature), ore: ORES.indexOf(cj.resource as typeof ORES[number]) })
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
    const sm = 0.32 * W, km = 1 / (2 * sm * sm)
    const scale = 1 / (1.4 * W) // ridges a hex or two long
    return (gx: number, gy: number) => {
      const x = gx, y = gy * K
      let m = 0, wt = 0, tsum = 0, cold = 0
      let mm = 0, all = 0 // soft mountain mask: share of nearby land that is mountain
      let warm = 0, chill = 0 // the land around: deserts warm the rock's colour, snowfields keep trees off
      const ore = [0, 0, 0] // how strongly each ore shows here (fades smoothly away from its deposit hexes)
      let dM = Infinity, dN = Infinity
      for (const p of pts) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2
        const wm = Math.exp(-d2 * km)
        all += wm
        warm += wm * p.warm; chill += wm * p.cold
        if (p.ore >= 0) ore[p.ore] += wm
        if (p.m) dM = Math.min(dM, d2)
        else dN = Math.min(dN, d2)
        if (p.m) {
          const w = Math.exp(-d2 * k2)
          m += w; wt += w; tsum += w * p.tier; cold += w * p.cold
          mm += wm
        }
      }
      if (wt <= 0) return { alt: 0, snow: Infinity, ground: 0, warm: 0, cold: 0, ore: -1, oreW: 0 }
      // rounded outline and gentle foothills from the blurred mask (no per-hex bumps)
      // the mask is 1/2 on the border with lowland hexes: height falls to nothing there
      const fade = Math.max(0, Math.min(1, (mm / all - 0.5) / 0.42))
      // and rise over at least half a hex of foothills from the lowland border (no sheer walls)
      const fromBorder = dN === Infinity ? 1 : Math.min(1, (Math.sqrt(dN) - Math.sqrt(dM)) / 2 / (0.5 * W))
      const edge = Math.pow(fade * fade * (3 - 2 * fade), 0.9) * Math.pow(Math.max(0, fromBorder), 1.3)
      // surrounded points stand taller: m is ~1 for a lone hex, 2-3 deep in a range
      const mass = 1 - Math.exp(-0.9 * m)
      // ridgelines, softened with rolling noise so crests are rugged but not needle-sharp
      const r = 0.6 * ridged(x * scale, y * scale, S) + 0.4 * vnoise(x * scale * 1.3, y * scale * 1.3, S + 5)
      const fine = vnoise(x / (0.45 * W), y / (0.45 * W), S + 9) - 0.5
      const raw = W * (0.06 + 1.6 * Math.pow(mass, 2.2)) * (0.12 + 1.25 * Math.pow(r, 1.4))
      // ease the tops over (tall tips become broad, rugged crowns, not needles)
      const crown = 1.6 * W
      const eased = crown * Math.tanh(raw / crown)
      const tier = tsum / wt
      const snowLine = TP * 6 + W * (0.9 - 0.38 * (cold / wt))
      // jaggedness: mid-sized knobs over the whole surface, strongest up high
      const h = eased * Math.pow(edge, 0.8) + fine * W * (0.05 + 0.1 * Math.min(1, eased / W)) * edge
      return { alt: tier * TP + Math.max(0, h), snow: snowLine, ground: tier * TP, warm: Math.min(1, (warm / all) * 2.5), cold: Math.min(1, chill / all + cold / wt), ...strongest(ore, all) }
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
    const GR = new Float32Array(rows * w), WM = new Float32Array(rows * w), CD = new Float32Array(rows * w)
    const OK = new Int8Array(rows * w).fill(-1), OW = new Float32Array(rows * w)
    for (let r = 0; r < rows; r++) {
      const dy = -hh + r * STEP
      for (let col = 0; col < w; col++) {
        const dx = col + 0.5 - hw
        // the hex plus a few pixels around it, so smoothing and shading at the rim see true heights
        if (!inHex(dx, dy) && !inHex(dx - 3, dy) && !inHex(dx + 3, dy) && !inHex(dx, dy - 1.5) && !inHex(dx, dy + 1.5)) continue
        const f = field(p.x + dx, p.y + dy)
        Z[r * w + col] = f.alt - base
        ALT[r * w + col] = f.alt
        SN[r * w + col] = f.snow
        GR[r * w + col] = f.ground
        WM[r * w + col] = f.warm
        CD[r * w + col] = f.cold
        OK[r * w + col] = f.ore
        OW[r * w + col] = f.oreW
      }
    }
    // round off the sharpest tips: two light smoothing passes over the grid
    for (let pass = 0; pass < 2; pass++) {
      const src = Z.slice()
      for (let r = 1; r < rows - 1; r++) for (let col = 1; col < w - 1; col++) {
        const k = r * w + col
        if (!src[k]) continue
        const n = (src[k - 1] + src[k + 1] + src[k - w] + src[k + w]) / 4
        Z[k] = src[k] * 0.5 + n * 0.5
      }
    }
    // one rock colour per range: sandstone beside deserts, granite elsewhere
    const warmHex = this.warmRange(i)
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
        // never paint below this point's own ground line (no square blocks hanging off the hex)
        const floor = Math.min(ybuf, Math.ceil(top + dy) + 1)
        if (sy >= floor) continue
        // light from the upper left, like the Blender art: shade by slope
        const dzx = (zg(r, col + 1) - zg(r, col - 1)) / 2
        const dzy = (zg(r + 1, col) - zg(r - 1, col)) / (2 * STEP * K)
        const nx = -dzx, ny = -dzy, nz = 1.2
        const lit = (-0.6 * nx + 0.5 * ny + 0.6 * nz) / Math.hypot(nx, ny, nz)
        const tone = lit > 0.7 ? 0 : lit > 0.42 ? 1 : 2
        const k = r * w + col
        const gx = p.x + dx, gy = p.y + dy
        const steep = Math.min(1, Math.hypot(dzx, dzy) / 1.6)
        // rock colour: gray, warming to sandstone near deserts (blended)
        const ROCK = warmHex ? RED : GRAY
        for (let y = Math.max(0, sy); y < floor; y++) {
          // each painted row is a little lower down the slope than the one above it
          const alt = ALT[k] - (y - sy)
          const rel = alt - GR[k]
          let t = tone
          let pal: number[][] | null = null
          // erosion gullies: long streaks running down the steeper slopes
          const gully = vnoise(gx / (0.08 * W), alt / (0.8 * W), this.seed + 21) > 0.74 && steep > 0.35
          // strata: faint level bands of rock
          const band = steep > 0.55 && Math.sin((alt / (0.16 * W)) * Math.PI * 2 + vnoise(gx / (0.9 * W), gy / (0.9 * W), this.seed + 31) * 5) > 0.96
          if (gully || (band && hash2(Math.floor(gx / 3), Math.floor(alt), 13) < 0.55)) t = Math.min(3, t + 1) // bands break up into short dashes
          // scree: speckled loose stone low down
          if (rel < 0.32 * W && hash2(gx, y, 7) < 0.07) t = Math.max(0, Math.min(3, t + (hash2(gx, y, 8) < 0.5 ? -1 : 1)))
          const snowLine = SN[k] + (hash2(gx, y, 3) - 0.5) * 2
          if (alt > snowLine || (gully && alt > snowLine - 0.2 * W)) pal = SNOW // snow, and snow lingering in gullies
          else if (!warmHex && CD[k] < 0.5) {
            // treeline: solid forest low down, thinning out (dithered) over a narrow band at its top
            const line = (0.13 + 0.12 * vnoise(gx / (0.5 * W), gy / (0.5 * W), this.seed + 41)) * W
            if (rel < line - 2 || (rel < line + 2 && hash2(gx, y, 11) < (line + 2 - rel) / 4)) { pal = PINE; t = Math.min(3, tone + 1) }
          }
          // ore: streaks of colour down the rock near a deposit, densest at its heart
          if (!pal && OK[k] >= 0 && OW[k] > 0.15) {
            const kind = ORES[OK[k]]
            const streak = vnoise(gx / (0.11 * W), alt / (0.45 * W), this.seed + 51 + OK[k])
            if (OW[k] > 0.2 && streak > 0.86 - 0.16 * Math.min(1, OW[k]) && hash2(Math.floor(gx / 2), Math.floor(alt / 3), 19) < 0.8) {
              pal = STAIN[kind]
              // copper: green malachite, with the odd patch of blue azurite
              if (kind === 'copper' && vnoise(gx / (0.06 * W), alt / (0.1 * W), this.seed + 61) > 0.72) pal = AZURITE
              // tin glints: the odd pale speck
              if (kind === 'tin' && hash2(gx, y, 17) < 0.12) t = 0
            } else if (kind === 'copper' && vnoise(gx / (0.2 * W), alt / (0.25 * W), this.seed + 71) > 0.7 - 0.25 * Math.min(1, OW[k])) {
              // a rusty gossan stain spreading round the copper, weathering out of the rock
              pal = GOSSAN
            }
          }
          const rgb = (pal ?? ROCK)[Math.min(t, 3)]
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
