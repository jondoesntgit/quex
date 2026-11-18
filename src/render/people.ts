/** Tiny villagers (about 3×6 px) pottering about each village's territory: from
 *  the village square to its buildings, roads and fields, a short pause to
 *  "work", then home again. Purely cosmetic and per-device; never in the event log.
 *
 *  Walkers go hex to hex through the village's own land. Each step is: walk to
 *  the shared edge, then climb up the cliff hand over hand or hop down it, then
 *  walk on. They sort into the map's painter's order (see MapView rank), so
 *  trees, houses and cliffs in front of them hide them. */
import { Container, Graphics } from 'pixi.js'
import { hexToPixel, neighbours } from '../world/hex'
import { mulberry32, hashString } from '../world/rng'
import type { World } from '../world/types'
import type { GameState, Village } from '../game/types'
import { territoryCells } from '../game/reducer'

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
const SPEED = 9 // art px per second, walking
const CLIMB_SPEED = 4 // art px per second, up a cliff
const HOP_TIME = 0.42 // seconds in the air
const LAND_TIME = 0.15 // seconds squashed after landing
const HOP_HEIGHT = 4 // art px of lift before the drop

interface Pose {
  x: number
  y: number // feet, on screen
  cell: number // hex whose draw rank the walker sorts with
  front: boolean // in the front half of that hex (draw over its trees/houses)
  kind: 'walk' | 'stand' | 'work' | 'climbA' | 'climbB' | 'hop' | 'land'
  done: boolean // reached the next hex
}

interface Walker {
  g: Graphics
  path: number[] // cell indices, current position between path[seg] and path[seg+1]
  seg: number
  t: number // seconds into the current segment
  wait: number // seconds left working/resting
  jitter: [number, number][] // per-cell foot offset so they don't all walk the centre line
  home: number
  rng: () => number
  frame: number
  shirt: number
  skin: number
}

export class People {
  private walkers: Walker[] = []
  private sig = ''
  private world!: World
  private W: number
  private TP: number
  private targets = new Map<string, { home: number; spots: number[]; land: Set<number> }>()
  private rank: Int32Array = new Int32Array(0)

  /** Graphics owned by the crowd (MapView keeps these when it redraws). */
  nodes() { return this.walkers.map((w) => w.g) }

  /** Put the crowd into the map container and take its painter's ranks. */
  attach(parent: Container, rank: Int32Array) {
    this.rank = rank
    for (const w of this.walkers) if (w.g.parent !== parent) parent.addChild(w.g)
  }

  constructor(W: number, TP: number) {
    this.W = W
    this.TP = TP
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
    const spots = [
      ...v.buildings.map((b) => idx(b.col, b.row)),
      ...v.outposts.map((o) => idx(o.col, o.row)),
      ...v.roads,
    ].filter((i) => land.has(i))
    // a few wander spots so a brand-new village still has life
    const rest = [...land].filter((i) => i !== home)
    const rng = mulberry32(hashString(v.id))
    for (let k = 0; k < 3 && rest.length; k++) spots.push(rest[Math.floor(rng() * rest.length)])
    this.targets.set(v.id, { home, spots, land })
    const n = Math.min(10, Math.max(2, Math.floor(v.population / 2) + Math.floor(v.buildings.length / 2)))
    for (let k = 0; k < n; k++) {
      const r = mulberry32(hashString(`${v.id}-${k}`))
      const w: Walker = {
        g: new Graphics(), path: [home], seg: 0, t: 0, wait: r() * 4, jitter: [], home, rng: r, frame: 0,
        shirt: SHIRT[v.role] ?? 0xd0d0d0, skin: SKIN[Math.floor(r() * SKIN.length)],
      }
      this.walkers.push(w)
      this.plan(w, v.id)
      // start somewhere along the route so they don't all leave home together
      w.seg = Math.floor(r() * Math.max(1, w.path.length - 1))
    }
  }

  /** Breadth-first route through the village's land from where it stands to a new target. */
  private plan(w: Walker, vid: string) {
    const T = this.targets.get(vid)!
    const from = w.path[Math.min(w.seg + 1, w.path.length - 1)]
    const goal = from === T.home && T.spots.length ? T.spots[Math.floor(w.rng() * T.spots.length)] : T.home
    const prev = new Map<number, number>([[from, -1]])
    const q = [from]
    const world = this.world
    while (q.length) {
      const i = q.shift()!
      if (i === goal) break
      const c = world.cells[i]
      for (const [nc, nr] of neighbours(c.col, c.row)) {
        if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
        const j = nr * world.width + nc
        if (!T.land.has(j) || prev.has(j)) continue
        if (Math.abs(world.cells[j].tier - c.tier) > 2) continue // too high to climb
        prev.set(j, i)
        q.push(j)
      }
    }
    const path: number[] = []
    if (prev.has(goal)) for (let i = goal; i !== -1; i = prev.get(i)!) path.unshift(i)
    else path.push(from)
    w.path = path
    w.seg = 0
    w.t = 0
    w.jitter = path.map((_, k) => (k === 0 || k === path.length - 1)
      ? [Math.round((w.rng() - 0.5) * this.W * 0.35), Math.round((w.rng() - 0.5) * this.W * 0.15)]
      : [Math.round((w.rng() - 0.5) * this.W * 0.15), Math.round((w.rng() - 0.5) * this.W * 0.06)])
    ;(w as Walker & { vid?: string }).vid = vid
  }

  /** Ground point (untiered) and tier of a path stop. */
  private stop(i: number, j: [number, number]) {
    const c = this.world.cells[i]
    const p = hexToPixel(c.col, c.row, this.W)
    return { x: p.x + j[0], y: p.y + j[1], tier: c.tier, cx: p.x, cy: p.y }
  }

  /** Where a walker is `t` seconds into the step from path[k] to path[k+1]. */
  private pose(w: Walker, k: number, t: number): Pose {
    const a = this.stop(w.path[k], w.jitter[k])
    const b = this.stop(w.path[k + 1], w.jitter[k + 1])
    const TP = this.TP
    const ex = (a.x + b.x) / 2, ey = (a.y + b.y) / 2 // the shared edge, at ground level
    const dA = Math.hypot(ex - a.x, ey - a.y) / SPEED
    const dz = (b.tier - a.tier) * TP
    const dB = dz > 0 ? dz / CLIMB_SPEED : dz < 0 ? HOP_TIME + LAND_TIME : 0
    const dC = Math.hypot(b.x - ex, b.y - ey) / SPEED
    const lower = a.tier <= b.tier ? a : b
    const lowerCell = a.tier <= b.tier ? w.path[k] : w.path[k + 1]
    if (t < dA) {
      const u = t / dA
      const x = a.x + (ex - a.x) * u, y = a.y + (ey - a.y) * u
      return { x, y: y - a.tier * TP, cell: w.path[k], front: y > a.cy, kind: 'walk', done: false }
    }
    t -= dA
    if (t < dB) {
      if (dz > 0) { // hand over hand up the cliff face
        const up = t * CLIMB_SPEED
        return { x: ex, y: ey - a.tier * TP - up, cell: lowerCell, front: ey > lower.cy, kind: Math.floor(up / 2) & 1 ? 'climbB' : 'climbA', done: false }
      }
      if (t < HOP_TIME) { // hop off the edge, a little up then down
        const u = t / HOP_TIME
        const x = ex + (b.x - ex) * 0.25 * u, y = ey + (b.y - ey) * 0.25 * u
        const lift = 4 * u * (1 - u) * HOP_HEIGHT
        return { x, y: y - a.tier * TP + (-dz) * u * u - lift, cell: u < 0.5 ? w.path[k] : lowerCell, front: y > lower.cy, kind: 'hop', done: false }
      }
      const x = ex + (b.x - ex) * 0.25, y = ey + (b.y - ey) * 0.25
      return { x, y: y - b.tier * TP, cell: w.path[k + 1], front: y > b.cy, kind: 'land', done: false }
    }
    t -= dB
    const sx = dz < 0 ? ex + (b.x - ex) * 0.25 : ex, sy = dz < 0 ? ey + (b.y - ey) * 0.25 : ey
    const len = Math.hypot(b.x - sx, b.y - sy)
    const u = Math.min(1, len ? (t * SPEED) / len : 1)
    const x = sx + (b.x - sx) * u, y = sy + (b.y - sy) * u
    return { x, y: y - b.tier * TP, cell: w.path[k + 1], front: y > b.cy, kind: 'walk', done: u >= 1 || dC === 0 }
  }

  update(dt: number) {
    if (!this.world) return
    for (const w of this.walkers) {
      const vid = (w as Walker & { vid?: string }).vid!
      let pose: Pose
      if (w.wait > 0 || w.seg >= w.path.length - 1) {
        if (w.wait > 0) w.wait -= dt
        else { w.wait = 1.5 + w.rng() * 4; this.plan(w, vid) }
        const k = Math.min(w.seg, w.path.length - 1)
        const a = this.stop(w.path[k], w.jitter[k])
        pose = { x: a.x, y: a.y - a.tier * this.TP, cell: w.path[k], front: a.y > a.cy, kind: w.wait > 0 ? 'work' : 'stand', done: false }
      } else {
        w.t += dt
        pose = this.pose(w, w.seg, w.t)
        if (pose.done) { w.seg++; w.t = 0 }
      }
      w.frame += dt * (pose.kind === 'walk' ? 6 : 1.5)
      const r = this.rank[pose.cell] ?? -1
      const zi = r * 4 + (pose.front ? 3.5 : 2)
      if (w.g.zIndex !== zi) w.g.zIndex = zi
      this.draw(w, Math.round(pose.x), Math.round(pose.y), pose.kind, Math.floor(w.frame) & 1)
    }
  }

  /** 6×9 px villager, feet at (x, y). Rows top to bottom; o outline, H skin,
   *  S shirt, L legs, T tool. */
  private draw(w: Walker, x: number, y: number, kind: Pose['kind'], step: number) {
    const fig = kind === 'work' ? (step ? WORK_UP : WORK_DOWN)
      : kind === 'walk' ? (step ? WALK : STAND)
      : kind === 'climbA' ? CLIMB_A : kind === 'climbB' ? CLIMB_B
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
