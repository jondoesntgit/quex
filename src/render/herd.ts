/** Deer on hexes with plenty of wild game: a visual cue for good hunting. A game hex (one with the game
 *  deposit) carries up to 20 animals; while more than DEER_FROM are left, two or three deer browse there,
 *  wandering about the hex and now and then lifting their heads to look round. As hunters thin the game
 *  out the deer go, and they come back as it recovers (see gameLeft in game/deposits.ts).
 *
 *  They keep to their own hex and sort with it like the sheep do: in a wood, behind the trees on the far
 *  half of the hex and in front of them on the near half, so they peek out from among the trunks.
 *  Only deer near the camera move or are drawn. Purely cosmetic and per-device. */
import { Container, Graphics } from 'pixi.js'
import { hexToPixel } from '../world/hex'
import { hashString, mulberry32 } from '../world/rng'
import type { World } from '../world/types'
import type { GameState } from '../game/types'
import { gameLeft, gameMax } from '../game/deposits'
import { buildingAt, villageAt } from '../game/reducer'

// A deer facing right, feet on the bottom row: o outline, B coat, b coat in shade, T white tail,
// L legs, A antlers (stags only), E nose. Ten pixels wide, about a villager and a half.
const STAND = ['.......A.A', '.......oA.', '......oBBE', '......oBo.', 'oooooooBo.', 'TBBBBBBBo.', 'obbbbbbbo.', '.L.L..L.L.', '.L.L..L.L.', '.L.L..L.L.']
const WALK_A = ['.......A.A', '.......oA.', '......oBBE', '......oBo.', 'oooooooBo.', 'TBBBBBBBo.', 'obbbbbbbo.', '.L..L.L..L', 'L...L.L..L', 'L....L...L']
const WALK_B = ['.......A.A', '.......oA.', '......oBBE', '......oBo.', 'oooooooBo.', 'TBBBBBBBo.', 'obbbbbbbo.', '..LL...LL.', '..L.L..L.L', '.L..L.L..L']
// head down, browsing (the muzzle bobs a pixel)
const BROWSE_A = ['..........', '..........', '..........', '..........', 'ooooooo...', 'TBBBBBBo..', 'obbbbbbBo.', '.L.L..LBo.', '.L.L..L.BE', '.L.L..L...']
const BROWSE_B = ['..........', '..........', '..........', '..........', 'ooooooo...', 'TBBBBBBo..', 'obbbbbbBo.', '.L.L..LBo.', '.L.L..L.Bo', '.L.L..L..E']
const COL: Record<string, number> = { o: 0x2a1e18, B: 0xa8683a, b: 0x86502c, T: 0xf2ece0, L: 0x5a3a22, A: 0xd8c8a0, E: 0x1a1210 }

/** Deer show while more than this many animals are left on a hex (a game hex holds 20, plain wild country 10). */
export const DEER_FROM = 12
/** How many deer a hex shows for the game left on it (none at DEER_FROM or under). */
export const deerShown = (left: number) => (left <= DEER_FROM ? 0 : left >= 17 ? 3 : 2)

const SPEED = 4 // px / s, a careful walk

type Mode = 'browse' | 'look' | 'walk'
interface Deer {
  g: Graphics
  rng: () => number
  x: number; y: number
  tx: number; ty: number
  dir: 1 | -1
  stag: boolean
  mode: Mode
  t: number; dur: number
}
interface Spot { cell: number; cx: number; cy: number; deer: Deer[] }

export class Herd {
  private spots = new Map<number, Spot>()
  private world!: World
  private W: number
  private TP: number
  private rank: Int32Array = new Int32Array(0)
  private parent: Container | null = null
  private clock = 0

  constructor(W: number, TP: number) {
    this.W = W
    this.TP = TP
  }

  /** Graphics owned by the herd (MapView keeps these when it redraws). */
  nodes(): Graphics[] {
    const out: Graphics[] = []
    for (const s of this.spots.values()) for (const d of s.deer) out.push(d.g)
    return out
  }

  attach(parent: Container, rank: Int32Array) {
    this.parent = parent
    this.rank = rank
    for (const g of this.nodes()) if (g.parent !== parent) parent.addChild(g)
  }

  /** Deer for every revealed game hex with plenty left; a hex's deer stay where they were across redraws. */
  sync(world: World, state: GameState, revealed: Set<number>, date: string) {
    if (this.world !== world) { this.clear(); this.world = world }
    const want = new Map<number, number>()
    for (const i of revealed) {
      if (gameMax(world, i) <= DEER_FROM) continue
      const c = world.cells[i]
      if (buildingAt(state, c.col, c.row) || villageAt(state, c.col, c.row)) continue
      const n = deerShown(gameLeft(world, state, i, date))
      if (n) want.set(i, n)
    }
    for (const [i, s] of this.spots) if (!want.has(i)) { for (const d of s.deer) d.g.destroy(); this.spots.delete(i) }
    for (const [i, n] of want) {
      let s = this.spots.get(i)
      if (!s) {
        const c = world.cells[i], p = hexToPixel(c.col, c.row, this.W)
        s = { cell: i, cx: p.x, cy: p.y, deer: [] }
        this.spots.set(i, s)
      }
      while (s.deer.length > n) s.deer.pop()!.g.destroy()
      while (s.deer.length < n) s.deer.push(this.spawn(s, s.deer.length))
    }
  }

  private clear() {
    for (const s of this.spots.values()) for (const d of s.deer) d.g.destroy()
    this.spots.clear()
  }

  private spawn(s: Spot, k: number): Deer {
    const rng = mulberry32(hashString(`deer-${s.cell}-${k}`))
    const pt = this.pointIn(s, rng)
    const d: Deer = { g: new Graphics(), rng, x: pt.x, y: pt.y, tx: pt.x, ty: pt.y, dir: rng() < 0.5 ? 1 : -1, stag: k === 0 && rng() < 0.6, mode: 'browse', t: 0, dur: rng() * 5 }
    this.parent?.addChild(d.g)
    return d
  }

  /** A spot on the hex's top, clear of its edges. */
  private pointIn(s: Spot, rng: () => number) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng())
    return { x: s.cx + Math.cos(a) * r * this.W * 0.27, y: s.cy + Math.sin(a) * r * this.W * 0.12 }
  }

  /** Step and draw the deer inside `view` (map px: x0, y0, x1, y1); the rest are hidden and wait. */
  update(dt: number, view: [number, number, number, number] | null) {
    if (!this.world) return
    this.clock += dt
    for (const s of this.spots.values()) {
      const near = !view || (s.cx > view[0] - this.W && s.cx < view[2] + this.W && s.cy > view[1] - this.W && s.cy < view[3] + 2 * this.W)
      for (const d of s.deer) {
        d.g.visible = near
        if (!near) continue
        this.step(d, s, dt)
        this.draw(d, s)
      }
    }
  }

  private step(d: Deer, s: Spot, dt: number) {
    d.t += dt
    if (d.mode === 'walk') {
      const dx = d.tx - d.x, dy = (d.ty - d.y) * 2
      const dist = Math.hypot(dx, dy)
      if (dist < 0.5) { d.mode = 'browse'; d.t = 0; d.dur = 3 + d.rng() * 8; return }
      if (Math.abs(dx) > 0.3) d.dir = dx > 0 ? 1 : -1
      const k = Math.min(1, (SPEED * dt) / dist)
      d.x += dx * k
      d.y += (dy / 2) * k
      return
    }
    if (d.t < d.dur) return
    // done browsing: look round a moment, or step off somewhere else on the hex
    d.t = 0
    const r = d.rng()
    if (d.mode === 'browse' && r < 0.35) { d.mode = 'look'; d.dur = 1.5 + d.rng() * 2.5; if (d.rng() < 0.5) d.dir = d.dir === 1 ? -1 : 1 }
    else {
      const pt = this.pointIn(s, d.rng)
      d.tx = pt.x
      d.ty = pt.y
      d.mode = 'walk'
    }
  }

  private draw(d: Deer, s: Spot) {
    const fig = d.mode === 'walk' ? (Math.floor((d.x + d.y * 2) / 2) & 1 ? WALK_A : WALK_B)
      : d.mode === 'browse' ? (Math.floor(this.clock * 1.5 + d.x) & 1 ? BROWSE_A : BROWSE_B)
      : STAND
    const lift = this.world.cells[s.cell].tier * this.TP
    // behind the hex's trees on its far half, in front of them on the near half
    d.g.zIndex = (this.rank[s.cell] ?? -1) * 4 + (d.y > s.cy ? 3.5 : 2)
    paint(d.g, fig, Math.round(d.x), Math.round(d.y - lift), d.dir, d.stag ? COL : { ...COL, A: -1 }, 5)
  }
}

/** Paint a pixel figure with its feet at (x, y), `ax` columns from its left edge over x; mirrored when facing
 *  left. A colour of -1 leaves that pixel out (a doe has no antlers). */
function paint(g: Graphics, fig: string[], x: number, y: number, dir: 1 | -1, col: Record<string, number>, ax: number) {
  g.clear()
  const top = y - fig.length + 1
  for (let r = 0; r < fig.length; r++) {
    const row = fig[r]
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.' || col[ch] < 0) continue
      const px = dir === 1 ? x - ax + c : x + ax - c
      g.rect(px, top + r, 1, 1).fill(col[ch])
    }
  }
}
