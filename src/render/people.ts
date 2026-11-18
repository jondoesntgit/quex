/** Tiny villagers (about 6×9 px) pottering about each village's land: from
 *  the village square to its buildings, roads and fields, a pause to "work"
 *  in front of the building, then home again. Purely cosmetic and per-device;
 *  never in the event log.
 *
 *  Routes take the least effort through the village's land (climbing costs
 *  more than walking), cross between hexes only at the shared edge, go around
 *  buildings, climb cliffs hand over hand and hop down them (see walk.ts).
 *  They sort into the map's painter's order (see MapView rank), so trees,
 *  houses and cliffs in front of them hide them. */
import { Container, Graphics } from 'pixi.js'
import { hexToPixel, neighbours } from '../world/hex'
import { mulberry32, hashString } from '../world/rng'
import type { World } from '../world/types'
import type { GameState, Village } from '../game/types'
import { territoryCells } from '../game/reducer'
import { buildRoute, routeTime, sample, type Pose, type Pt, type RouteHex, type Seg } from './walk'

const SHIRT: Record<string, number> = {
  farm: 0xe8c040, port: 0x4878d8, mining: 0x9a9ab0, forestry: 0x3c8c3c, herding: 0xe0e0d0, explorer: 0xc04878,
}
const SKIN = [0xf0c8a0, 0xd8a070, 0xa06840, 0x704828]
const STAND = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', '.oLLo.', '.oLLo.', '.oooo.']
const WALK = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', 'oLooLo', 'oLooLo', 'oooooo']
const WORK_UP = ['.oooo.T', '.oHHoT', '.oHHSo', 'ooSSoo', '.oSSo.', '.oSSo.', '.oLLo.', '.oLLo.', '.oooo.']
const WORK_DOWN = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', '.oSSSo', '.oSSoT', '.oLLoT', '.oLLo.', '.oooo.']
// climbing, seen from behind: hair (D), one hand reaching up; B mirrors A
const CLIMB_A = ['oo....', 'oHoooo', 'oSoDDo', 'ooSDDo', '.oSSSo', '.oSSSo', '.oLLoo', '.oLoLo', '.oooLo', '....oo']
const CLIMB_B = CLIMB_A.map((r) => r.padEnd(6, '.').split('').reverse().join(''))
// mid-hop: arms out, legs apart; then a squashed landing
const HOP = ['.oooo.', '.oHHo.', 'ooHHoo', 'HoSSoH', 'oSSSSo', '.oSSo.', 'oLooLo', 'Lo..oL', 'o....o']
const LAND = ['.oooo.', '.oHHo.', 'ooHHoo', 'oSSSSo', 'oSSSSo', 'oLLLLo', 'oooooo']
const MAX_STEP = 3 // tiers a villager will climb or drop in one go

interface Walker {
  g: Graphics
  vid: string
  route: Seg[]
  t: number // seconds into the route
  end: number // route length in seconds
  wait: number // seconds left working / resting at the end
  at: { cell: number; p: Pt } // where the current route ends (start of the next)
  working: boolean // pausing at a work spot (tool animation) rather than resting
  rng: () => number
  shirt: number
  skin: number
  idle: number // time accumulator for the work animation
}

interface Plan { home: number; spots: number[]; land: Set<number>; blocked: Set<number> }

export class People {
  private walkers: Walker[] = []
  private sig = ''
  private world!: World
  private W: number
  private TP: number
  private plans = new Map<string, Plan>()
  private rank: Int32Array = new Int32Array(0)

  constructor(W: number, TP: number) {
    this.W = W
    this.TP = TP
  }

  /** Graphics owned by the crowd (MapView keeps these when it redraws). */
  nodes() { return this.walkers.map((w) => w.g) }

  /** Put the crowd into the map container and take its painter's ranks. */
  attach(parent: Container, rank: Int32Array) {
    this.rank = rank
    for (const w of this.walkers) if (w.g.parent !== parent) parent.addChild(w.g)
  }

  /** Rebuild the crowd only when villages, buildings, roads or territory change. */
  sync(world: World, state: GameState, revealed: Set<number>) {
    this.world = world
    const vs = Object.values(state.villages)
    const sig = vs.map((v) => `${v.id}:${Math.floor(v.population)}:${v.buildings.length}:${v.roads.length}:${v.outposts.length}`).join('|')
    if (sig === this.sig) return
    this.sig = sig
    for (const w of this.walkers) w.g.destroy()
    this.walkers = []
    for (const v of vs) this.spawn(world, v, revealed)
  }

  private spawn(world: World, v: Village, revealed: Set<number>) {
    const idx = (c: number, r: number) => r * world.width + c
    const home = idx(v.col, v.row)
    const land = new Set(territoryCells(world, v).filter((i) => world.cells[i].tier > 0 && revealed.has(i)))
    for (const i of v.roads) land.add(i)
    land.add(home)
    const blocked = new Set([home, ...v.buildings.map((b) => idx(b.col, b.row)), ...v.outposts.map((o) => idx(o.col, o.row))])
    const spots = [
      ...v.buildings.map((b) => idx(b.col, b.row)),
      ...v.outposts.map((o) => idx(o.col, o.row)),
      ...v.roads,
    ].filter((i) => land.has(i))
    // a few wander spots so a brand-new village still has life
    const rest = [...land].filter((i) => i !== home)
    const rng = mulberry32(hashString(v.id))
    for (let k = 0; k < 3 && rest.length; k++) spots.push(rest[Math.floor(rng() * rest.length)])
    this.plans.set(v.id, { home, spots, land, blocked })
    const n = Math.min(10, Math.max(2, Math.floor(v.population / 2) + Math.floor(v.buildings.length / 2)))
    for (let k = 0; k < n; k++) {
      const r = mulberry32(hashString(`${v.id}-${k}`))
      const w: Walker = {
        g: new Graphics(), vid: v.id, route: [], t: 0, end: 0, wait: r() * 3, working: false, idle: 0,
        at: { cell: home, p: this.spot(home, blocked.has(home), r) }, rng: r,
        shirt: SHIRT[v.role] ?? 0xd0d0d0, skin: SKIN[Math.floor(r() * SKIN.length)],
      }
      this.walkers.push(w)
      this.plan(w)
      // start somewhere along the route so they don't all leave home together
      w.t = r() * w.end
    }
  }

  private hex(i: number): RouteHex {
    const c = this.world.cells[i]
    const p = hexToPixel(c.col, c.row, this.W)
    return { cell: i, cx: p.x, cy: p.y, tier: c.tier, blocked: false }
  }

  /** A standing spot in a hex: in front of its building if it has one, else near the middle. */
  private spot(i: number, blocked: boolean, rng: () => number): Pt {
    const h = this.hex(i), W = this.W
    if (blocked) return { x: h.cx + (rng() - 0.5) * W * 0.36, y: h.cy + W * (0.15 + rng() * 0.05) }
    const a = rng() * Math.PI * 2, r = rng() * W * 0.16
    return { x: h.cx + Math.cos(a) * r, y: h.cy + Math.sin(a) * r * 0.5 }
  }

  /** Least-effort route through the village's land (climbing costs extra). */
  private cells(from: number, to: number, land: Set<number>): number[] {
    const world = this.world
    const dist = new Map<number, number>([[from, 0]])
    const prev = new Map<number, number>()
    const open = [from]
    while (open.length) {
      open.sort((a, b) => dist.get(a)! - dist.get(b)!)
      const i = open.shift()!
      if (i === to) break
      const c = world.cells[i]
      for (const [nc, nr] of neighbours(c.col, c.row)) {
        if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
        const j = nr * world.width + nc
        if (!land.has(j)) continue
        const dz = Math.abs(world.cells[j].tier - c.tier)
        if (dz > MAX_STEP) continue
        const d = dist.get(i)! + 1 + dz * 1.5
        if (d < (dist.get(j) ?? Infinity)) {
          if (!dist.has(j)) open.push(j)
          dist.set(j, d)
          prev.set(j, i)
        }
      }
    }
    if (!dist.has(to)) return [from]
    const path = [to]
    while (path[0] !== from) path.unshift(prev.get(path[0])!)
    return path
  }

  private plan(w: Walker) {
    const P = this.plans.get(w.vid)!
    const from = w.at.cell
    const goal = from === P.home && P.spots.length ? P.spots[Math.floor(w.rng() * P.spots.length)] : P.home
    const path = this.cells(from, goal, P.land)
    const dest = path[path.length - 1]
    const end = this.spot(dest, P.blocked.has(dest), w.rng)
    const hexes = path.map((i) => ({ ...this.hex(i), blocked: P.blocked.has(i) }))
    w.route = buildRoute(hexes, w.at.p, end, this.W, this.TP)
    w.t = 0
    w.end = routeTime(w.route)
    w.at = { cell: dest, p: end }
    w.working = dest !== P.home && P.blocked.has(dest)
  }

  update(dt: number) {
    if (!this.world) return
    for (const w of this.walkers) {
      let pose: Pose
      if (w.t < w.end) {
        w.t = Math.min(w.end, w.t + dt)
        pose = sample(w.route, w.t, this.TP)
        if (w.t >= w.end) w.wait = w.working ? 2 + w.rng() * 4 : 1 + w.rng() * 3
      } else if (w.wait > 0) {
        w.wait -= dt
        w.idle += dt
        const h = this.hex(w.at.cell)
        pose = { x: w.at.p.x, y: w.at.p.y - h.tier * this.TP, cell: w.at.cell, front: w.at.p.y > h.cy, kind: w.working ? 'work' : 'stand', dist: 0 }
      } else {
        this.plan(w)
        pose = sample(w.route, 0, this.TP)
      }
      const r = this.rank[pose.cell] ?? -1
      const zi = r * 4 + (pose.front ? 3.5 : 2)
      if (w.g.zIndex !== zi) w.g.zIndex = zi
      // feet step every 3 px walked; hands alternate every 2 px climbed; tools swing twice a second
      const step = pose.kind === 'walk' ? Math.floor(pose.dist / 3) & 1
        : pose.kind === 'climb' ? Math.floor(pose.dist / 2) & 1
        : Math.floor(w.idle * 2) & 1
      this.draw(w, Math.round(pose.x), Math.round(pose.y), pose.kind, step)
    }
  }

  /** 6×9 px villager, feet at (x, y). Rows top to bottom; o outline, H skin,
   *  S shirt, L legs, T tool. */
  private draw(w: Walker, x: number, y: number, kind: Pose['kind'], step: number) {
    const fig = kind === 'work' ? (step ? WORK_UP : WORK_DOWN)
      : kind === 'walk' ? (step ? WALK : STAND)
      : kind === 'climb' ? (step ? CLIMB_B : CLIMB_A)
      : kind === 'hop' ? HOP : kind === 'land' ? LAND : STAND
    const col: Record<string, number> = { o: 0x1c1828, H: w.skin, S: w.shirt, L: 0x5a4630, T: 0xa08050, D: 0x4a3020 }
    const g = w.g
    g.clear()
    const top = y - fig.length + 1
    fig.forEach((rowStr, r) => {
      for (let c = 0; c < rowStr.length; c++) {
        const ch = rowStr[c]
        if (ch !== '.') g.rect(x - 3 + c, top + r, 1, 1).fill(col[ch])
      }
    })
  }
}
