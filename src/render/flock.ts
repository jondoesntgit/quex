/** Sheep at every sheep pen: a few small sheep milling about and grazing on the pen's hex and the
 *  pasture around it, and a shepherd with a crook (only when someone in the village is set to work
 *  the pen; he is one of the village's own villagers, taken from the crowd, see People).
 *
 *  Sheep can't climb, but they are not clever: they hop down off a hex that's a tier or two lower,
 *  and now and then one tries to jump up onto a hex a tier higher. Two times in three it makes it;
 *  otherwise it bounces off the cliff, lands on its side, lies there a moment (2 s, a little dazed)
 *  and gets up again. Nothing comes of it. Purely cosmetic and per-device, like the villagers. */
import { Container, Graphics } from 'pixi.js'
import { hexToPixel, neighbours, pixelToHex } from '../world/hex'
import { hashString, mulberry32 } from '../world/rng'
import type { World } from '../world/types'
import type { Building, GameState, Village } from '../game/types'
import { buildingAt, landAt, villageAt } from '../game/reducer'
import { MOUNTAIN_TERRAIN } from '../world/land'
import { jobs } from '../game/workers'
import { weekSeason } from '../game/calendar'
import { START_FLOCK } from '../game/herds'

// Sheep, facing right, feet on the bottom row: o outline, W wool, w wool in shade, F face and legs.
// Seven pixels wide with the head, about as wide as a villager (six).
const STAND = ['.oooo..', 'oWWWWoF', 'oWWWWFF', 'owWWwo.', '.oooo..', '.F..F..']
const WALK = ['.oooo..', 'oWWWWoF', 'oWWWWFF', 'owWWwo.', '.oooo..', 'F..F...']
// head down in the grass, nibbling (the head bobs a pixel)
const GRAZE_A = ['.oooo..', 'oWWWWo.', 'oWWWWo.', 'owWWwFF', '.ooooFF', '.F..F..']
const GRAZE_B = ['.oooo..', 'oWWWWo.', 'oWWWWo.', 'owWWwo.', '.ooooFF', '.F.F.FF']
// in the air: legs tucked fore and aft
const HOP = ['.oooo..', 'oWWWWoF', 'oWWWWFF', 'owWWwo.', 'FooooF.']
// flat on its side after bouncing off a cliff, legs sticking out stiff
const LIE = ['.F.F...', '.F.F...', '.oooo..', 'oWWWWo.', 'owwwwFF', '.ooooFF']
const SHEEP_COL: Record<string, number> = { o: 0x3a3440, W: 0xf4f0e4, w: 0xd2cbbb, F: 0x3a3438, y: 0xffe060 }

// The shepherd: a villager in a brown hat with a crook (T) taller than he is; feet on the bottom row.
const SHEP_STAND = ['......TT.', '.oooo.T.T', 'oDDDDoT..', '.oHHo.T..', '.oHHo.T..', 'ooSSooT..', 'oSSSSHT..', 'ooSSo.T..', '.oLLo.T..', '.oLLo.T..', '.oooo.T..']
const SHEP_WALK = ['......TT.', '.oooo.T.T', 'oDDDDoT..', '.oHHo.T..', '.oHHo.T..', 'ooSSooT..', 'oSSSSHT..', 'ooSSo.T..', 'oLooLoT..', 'oLooLoT..', 'oooooo...']

const SPEED = 5 // px / s, an amble
const SHEP_SPEED = 6
const HOP_TIME = 0.4
const LIE_TIME = 2 // seconds on its side after a failed jump
const JUMP_ODDS = 2 / 3 // a jump up a tier works this often
/** of new wanders: have a go at the hex a tier up (development: ?sheeptest makes them keen, to watch) */
const TRY_UP = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('sheeptest') ? 0.6 : 0.15
const MAX_DROP = 2 // tiers a sheep will hop down

type Mode = 'graze' | 'walk' | 'hop' | 'bonk' | 'fall' | 'lie' | 'rise'

interface Sheep {
  g: Graphics
  rng: () => number
  /** ground point (unlifted map px) and the hex it's on */
  x: number; y: number; cell: number
  /** lift above the ground plane, px (the hex's tier, plus any jump) */
  z: number
  dir: 1 | -1
  mode: Mode
  t: number; dur: number
  tx: number; ty: number
  /** this wander is a go at the hex a tier up */
  tryUp: boolean
  /** a hop or bounce: from, to, and its peak */
  arc: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; peak: number; to: number } | null
}

interface Shepherd { g: Graphics; x: number; y: number; tx: number; ty: number; wait: number; dir: 1 | -1; shirt: number; skin: number; step: number }

interface Pen {
  key: string
  vid: string
  cell: number
  /** where the flock may roam: the pen's hex and open land around it */
  area: Set<number>
  sheep: Sheep[]
  shepherd: Shepherd | null
}

/** How many sheep a pen shows for its flock: one for every two head, three to ten. */
export const sheepShown = (heads: number) => Math.min(10, Math.max(3, Math.ceil(heads / 2)))

/** A village's finished pens that someone is set to work (each has a shepherd out with the flock). */
export function shepherdPens(v: Village, date = new Date().toISOString().slice(0, 10)): Building[] {
  const pens = v.buildings.filter((b) => b.type === 'pen' && b.progress >= 1)
  if (!pens.length) return []
  const j = jobs(v, weekSeason(date))
  return pens.filter((b) => (j[b.id] ?? 0) > 0)
}

const SKIN = [0xf0c8a0, 0xd8a070, 0xa06840, 0x704828]

export class Flock {
  private pens = new Map<string, Pen>()
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

  /** Graphics owned by the flock (MapView keeps these when it redraws). */
  nodes(): Graphics[] {
    const out: Graphics[] = []
    for (const p of this.pens.values()) {
      for (const s of p.sheep) out.push(s.g)
      if (p.shepherd) out.push(p.shepherd.g)
    }
    return out
  }

  attach(parent: Container, rank: Int32Array) {
    this.parent = parent
    this.rank = rank
    for (const g of this.nodes()) if (g.parent !== parent) parent.addChild(g)
  }

  /** Pens come and go with the state; a pen's sheep carry on where they were when it redraws. */
  sync(world: World, state: GameState, revealed: Set<number>, shirtOf: (vid: string) => number) {
    if (this.world !== world) { this.clear(); this.world = world }
    const want = new Map<string, { v: Village; b: Building; cell: number; heads: number; shepherd: boolean }>()
    for (const v of Object.values(state.villages)) {
      const tended = new Set(shepherdPens(v).map((b) => b.id))
      for (const b of v.buildings) {
        if (b.type !== 'pen' || b.progress < 1) continue
        const cell = b.row * world.width + b.col
        if (!revealed.has(cell)) continue
        const heads = (b.herd ?? START_FLOCK).reduce((a, n) => a + n, 0)
        want.set(`${v.id}:${b.id}`, { v, b, cell, heads, shepherd: tended.has(b.id) })
      }
    }
    for (const [key, p] of this.pens) if (!want.has(key)) { this.drop(p); this.pens.delete(key) }
    for (const [key, w] of want) {
      let p = this.pens.get(key)
      if (!p) {
        p = { key, vid: w.v.id, cell: w.cell, area: new Set(), sheep: [], shepherd: null }
        this.pens.set(key, p)
      }
      p.area = this.pasture(world, state, w.cell)
      // the flock grows and shrinks a sheep at a time; strays outside the pasture now are put back
      const n = sheepShown(w.heads)
      while (p.sheep.length > n) p.sheep.pop()!.g.destroy()
      for (const s of p.sheep) if (!p.area.has(s.cell)) this.place(s, p, s.rng)
      while (p.sheep.length < n) p.sheep.push(this.spawn(p, p.sheep.length))
      if (w.shepherd && !p.shepherd) {
        const r = mulberry32(hashString(`shep-${key}`))
        const c = hexToPixel(world.cells[w.cell].col, world.cells[w.cell].row, this.W)
        const g = new Graphics()
        this.parent?.addChild(g)
        p.shepherd = { g, x: c.x - 8, y: c.y + 4, tx: c.x - 8, ty: c.y + 4, wait: 1, dir: 1, shirt: shirtOf(w.v.id), skin: SKIN[Math.floor(r() * SKIN.length)], step: 0 }
      } else if (!w.shepherd && p.shepherd) {
        p.shepherd.g.destroy()
        p.shepherd = null
      }
      if (p.shepherd) p.shepherd.shirt = shirtOf(w.v.id)
    }
  }

  private clear() {
    for (const p of this.pens.values()) this.drop(p)
    this.pens.clear()
  }

  private drop(p: Pen) {
    for (const s of p.sheep) s.g.destroy()
    p.shepherd?.g.destroy()
  }

  /** The pen's hex and the open land around it: no water, bare mountain, buildings or villages. */
  private pasture(world: World, state: GameState, pen: number): Set<number> {
    const out = new Set([pen])
    const c = world.cells[pen]
    for (const [nc, nr] of neighbours(c.col, c.row)) {
      if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
      const j = nr * world.width + nc
      const cell = world.cells[j]
      if (cell.tier === 0) continue
      if (MOUNTAIN_TERRAIN.includes(landAt(world, state, j).terrain)) continue
      if (buildingAt(state, nc, nr) || villageAt(state, nc, nr)) continue
      if (Object.values(state.villages).some((v) => v.city?.includes(j))) continue
      out.add(j)
    }
    return out
  }

  private spawn(p: Pen, k: number): Sheep {
    const rng = mulberry32(hashString(`sheep-${p.key}-${k}`))
    const s: Sheep = { g: new Graphics(), rng, x: 0, y: 0, cell: p.cell, z: 0, dir: rng() < 0.5 ? 1 : -1, mode: 'graze', t: 0, dur: rng() * 4, tx: 0, ty: 0, tryUp: false, arc: null }
    this.place(s, p, rng)
    this.parent?.addChild(s.g)
    return s
  }

  /** Set a sheep down somewhere on the pen's own level (the pen's hex or a neighbour as high). */
  private place(s: Sheep, p: Pen, rng: () => number) {
    const tier = this.world.cells[p.cell].tier
    const level = [...p.area].filter((i) => this.world.cells[i].tier === tier)
    const cell = rng() < 0.6 ? p.cell : level[Math.floor(rng() * level.length)]
    const pt = this.pointIn(cell, rng)
    s.x = s.tx = pt.x
    s.y = s.ty = pt.y
    s.cell = cell
    s.z = this.world.cells[cell].tier * this.TP
    s.mode = 'graze'
    s.t = 0
    s.arc = null
  }

  /** A spot on a hex's top, clear of its edges. */
  private pointIn(cell: number, rng: () => number) {
    const c = this.world.cells[cell]
    const h = hexToPixel(c.col, c.row, this.W)
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng())
    return { x: h.x + Math.cos(a) * r * this.W * 0.28, y: h.y + Math.sin(a) * r * this.W * 0.13 }
  }

  private cellAt(x: number, y: number): number {
    const h = pixelToHex(x, y, this.W)
    if (h.col < 0 || h.row < 0 || h.col >= this.world.width || h.row >= this.world.height) return -1
    return h.row * this.world.width + h.col
  }

  /** Where to wander next: mostly about the same hex, sometimes the next one along (on the level or
   *  down), and now and then, foolishly, the one a tier up. */
  private wander(s: Sheep, p: Pen) {
    const world = this.world
    const here = world.cells[s.cell]
    const near = neighbours(here.col, here.row)
      .map(([c, r]) => r * world.width + c)
      .filter((j) => p.area.has(j))
    const up = near.filter((j) => world.cells[j].tier - here.tier === 1)
    const ok = near.filter((j) => { const d = here.tier - world.cells[j].tier; return d >= 0 && d <= MAX_DROP })
    // a sheep that has strayed drifts back toward the pen
    const home = ok.filter((j) => j === p.cell || world.cells[j].tier === world.cells[p.cell].tier)
    let to = s.cell
    s.tryUp = false
    const roll = s.rng()
    if (up.length && roll < TRY_UP) { to = up[Math.floor(s.rng() * up.length)]; s.tryUp = true }
    else if (s.cell !== p.cell && home.length && roll < 0.6) to = home[Math.floor(s.rng() * home.length)]
    else if (ok.length && roll < 0.45) to = ok[Math.floor(s.rng() * ok.length)]
    const pt = this.pointIn(to, s.rng)
    s.tx = pt.x
    s.ty = pt.y
    s.mode = 'walk'
    s.t = 0
  }

  private startArc(s: Sheep, x1: number, y1: number, z1: number, peak: number, dur: number, mode: Mode, to: number) {
    s.arc = { x0: s.x, y0: s.y, z0: s.z, x1, y1, z1, peak, to }
    s.mode = mode
    s.t = 0
    s.dur = dur
  }

  update(dt: number) {
    if (!this.world) return
    this.clock += dt
    for (const p of this.pens.values()) {
      for (const s of p.sheep) { this.step(s, p, dt); this.drawSheep(s) }
      if (p.shepherd) this.stepShepherd(p, dt)
    }
  }

  private step(s: Sheep, p: Pen, dt: number) {
    const world = this.world
    s.t += dt
    switch (s.mode) {
      case 'graze':
      case 'rise':
        if (s.t >= s.dur) this.wander(s, p)
        return
      case 'lie':
        if (s.t >= LIE_TIME) { s.mode = 'rise'; s.t = 0; s.dur = 0.6 }
        return
      case 'walk': {
        const dx = s.tx - s.x, dy = (s.ty - s.y) * 2 // the ground is squashed: walk at an even pace
        const d = Math.hypot(dx, dy)
        if (d < 0.5) { s.mode = 'graze'; s.t = 0; s.dur = 2 + s.rng() * 7; return }
        if (Math.abs(dx) > 0.3) s.dir = dx > 0 ? 1 : -1
        const k = Math.min(1, (SPEED * dt) / d)
        const nx = s.x + dx * k, ny = s.y + (dy / 2) * k
        const j = this.cellAt(nx, ny)
        if (j === s.cell) { s.x = nx; s.y = ny; return }
        const from = world.cells[s.cell].tier, dz = j < 0 ? 99 : world.cells[j].tier - from
        const ux = dx / d, uy = dy / 2 / d
        if (j >= 0 && p.area.has(j) && dz === 0) { s.x = nx; s.y = ny; s.cell = j; return }
        if (j >= 0 && p.area.has(j) && dz < 0 && -dz <= MAX_DROP) {
          // off the edge and down
          this.startArc(s, nx + ux * 4, ny + uy * 4, world.cells[j].tier * this.TP, 3, HOP_TIME + 0.08 * -dz, 'hop', j)
          return
        }
        if (j >= 0 && p.area.has(j) && dz === 1 && s.tryUp) {
          s.tryUp = false
          if (s.rng() < JUMP_ODDS) this.startArc(s, nx + ux * 4, ny + uy * 4, world.cells[j].tier * this.TP, 4, HOP_TIME + 0.1, 'hop', j)
          // not quite: up the cliff face, bonk, and back down
          else this.startArc(s, s.x + ux, s.y + uy, s.z + this.TP * 0.75, 0, 0.22, 'bonk', s.cell)
          return
        }
        // somewhere a sheep won't go: think again
        s.mode = 'graze'
        s.t = 0
        s.dur = 0.5 + s.rng() * 2
        return
      }
      case 'hop':
      case 'bonk':
      case 'fall': {
        const a = s.arc!
        const k = Math.min(1, s.t / s.dur)
        s.x = a.x0 + (a.x1 - a.x0) * k
        s.y = a.y0 + (a.y1 - a.y0) * k
        s.z = a.z0 + (a.z1 - a.z0) * (s.mode === 'fall' ? k * k : k) + a.peak * 4 * k * (1 - k)
        if (s.mode === 'hop' && k >= 0.5) s.cell = a.to
        if (k < 1) return
        s.arc = null
        if (s.mode === 'bonk') {
          // bounced off the wall: back and down, onto its side
          const back = -s.dir * 4
          this.startArc(s, s.x + back, s.y + 1, world.cells[s.cell].tier * this.TP, 1, 0.3, 'fall', s.cell)
        } else if (s.mode === 'fall') {
          s.mode = 'lie'
          s.t = 0
        } else {
          s.mode = 'graze'
          s.t = 0
          s.dur = 0.3 + s.rng() * 3
          // carry on to where it was going, or pick a spot on the new hex
          if (this.cellAt(s.tx, s.ty) !== s.cell) { const pt = this.pointIn(s.cell, s.rng); s.tx = pt.x; s.ty = pt.y }
        }
        return
      }
    }
  }

  /** The shepherd keeps to the pen's hex, ambling to the side of it nearest his flock, then leaning on his crook. */
  private stepShepherd(p: Pen, dt: number) {
    const h = p.shepherd!
    const c = this.world.cells[p.cell]
    const centre = hexToPixel(c.col, c.row, this.W)
    if (h.wait > 0) {
      h.wait -= dt
      if (h.wait <= 0) {
        const mx = p.sheep.reduce((a, s) => a + s.x, 0) / Math.max(1, p.sheep.length)
        const my = p.sheep.reduce((a, s) => a + s.y, 0) / Math.max(1, p.sheep.length)
        // toward the flock, but not past the edge of the pen's hex, and out in front of the pen
        // (behind it he'd be hidden): to one side of it, or before its door
        let vx = (mx - centre.x) * 0.5 + (Math.random() - 0.5) * 10, vy = (my - centre.y) * 0.5 + (Math.random() - 0.5) * 5
        const lim = Math.hypot(vx / (this.W * 0.3), vy / (this.W * 0.14))
        if (lim > 1) { vx /= lim; vy /= lim }
        if (Math.abs(vx) < this.W * 0.2) vy = Math.max(vy, this.W * 0.06)
        else vy = Math.max(vy, 0)
        h.tx = centre.x + vx
        h.ty = centre.y + vy
      }
    } else {
      const dx = h.tx - h.x, dy = (h.ty - h.y) * 2
      const d = Math.hypot(dx, dy)
      if (d < 0.5) h.wait = 4 + Math.random() * 8
      else {
        if (Math.abs(dx) > 0.3) h.dir = dx > 0 ? 1 : -1
        const k = Math.min(1, (SHEP_SPEED * dt) / d)
        h.x += dx * k
        h.y += (dy / 2) * k
        h.step += SHEP_SPEED * dt * k
      }
    }
    const walking = h.wait <= 0
    const fig = walking && Math.floor(h.step / 3) & 1 ? SHEP_WALK : SHEP_STAND
    const y = Math.round(h.y - c.tier * this.TP)
    h.g.zIndex = (this.rank[p.cell] ?? -1) * 4 + (h.y > centre.y ? 3.5 : 2)
    paint(h.g, fig, Math.round(h.x), y, h.dir, { o: 0x1c1828, H: h.skin, S: h.shirt, L: 0x5a4630, T: 0x8a6a40, D: 0x6a4a28 }, 3)
  }

  private drawSheep(s: Sheep) {
    const fig = s.mode === 'lie' ? LIE
      : s.mode === 'hop' || s.mode === 'bonk' || s.mode === 'fall' ? HOP
      : s.mode === 'walk' ? (Math.floor((s.x + s.y * 2) / 2) & 1 ? WALK : STAND)
      : s.mode === 'graze' ? (Math.floor(this.clock * 2.5 + s.x) & 1 ? GRAZE_A : GRAZE_B)
      : STAND
    const c = this.world.cells[s.cell]
    const centre = hexToPixel(c.col, c.row, this.W)
    // mid-hop between two hexes, sort with the nearer one so it stays in view
    const r = s.arc ? Math.max(this.rank[s.cell] ?? -1, this.rank[s.arc.to] ?? -1) : this.rank[s.cell] ?? -1
    s.g.zIndex = r * 4 + (s.y > centre.y || s.arc ? 3.5 : 2)
    paint(s.g, fig, Math.round(s.x), Math.round(s.y - s.z), s.dir, SHEEP_COL, 3)
    // dazed on its side: a little star circling over it
    if (s.mode === 'lie') {
      const a = this.clock * 6
      s.g.rect(Math.round(s.x + Math.cos(a) * 3), Math.round(s.y - s.z - 8 + Math.sin(a)), 1, 1).fill(SHEEP_COL.y)
    }
  }
}

/** Paint a pixel figure with its feet at (x, y), `ax` columns from its left edge over x; mirrored when facing left. */
function paint(g: Graphics, fig: string[], x: number, y: number, dir: 1 | -1, col: Record<string, number>, ax: number) {
  g.clear()
  const top = y - fig.length + 1
  for (let r = 0; r < fig.length; r++) {
    const row = fig[r]
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.') continue
      const px = dir === 1 ? x - ax + c : x + ax - c
      g.rect(px, top + r, 1, 1).fill(col[ch])
    }
  }
}
