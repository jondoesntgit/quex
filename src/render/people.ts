/** Tiny villagers (about 6×9 px) pottering about each village's land: from
 *  the village square to its buildings, roads and fields, a pause to "work"
 *  in front of the building, then home again. Purely cosmetic and per-device;
 *  never in the event log.
 *
 *  Routes take the least effort through the village's land (climbing costs
 *  more than walking, roads cost less and are followed along the track),
 *  cross between hexes only at the shared edge, go around
 *  buildings, climb cliffs hand over hand and hop down them (see walk.ts).
 *  They sort into the map's painter's order (see MapView rank), so trees,
 *  houses and cliffs in front of them hide them.
 *
 *  A newly built road pops a puff of dust; villagers nearby give a startled
 *  hop, and those whose village it belongs to wander over for a look.
 *
 *  Villagers who cross paths sometimes stop for a natter: they face each
 *  other, gesture, and take turns with a little speech bubble, then carry on. */
import { Container, Graphics } from 'pixi.js'
import { distance, hexToPixel, neighbours } from '../world/hex'
import { mulberry32, hashString } from '../world/rng'
import type { World } from '../world/types'
import type { GameState, Village } from '../game/types'
import { territoryCells } from '../game/reducer'
import { buildRoute, routeTime, sample, type Pose, type Pt, type RouteHex, type Seg } from './walk'
import { bridgeVia } from './waterways'

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
const ROAD_COST = 0.4 // a road hex costs this much to cross, vs 1 for open land
const REACT_RANGE = 4 // hexes: villagers this close notice a new road
const PUFF_TIME = 0.9 // seconds
const CHAT_RANGE: [number, number] = [5, 11] // px apart (same height) to stop and talk
const CHAT_CHANCE = 0.6 // of stopping when two villagers meet
const CHAT_TIME: [number, number] = [2.5, 5] // seconds
const CHAT_COOLDOWN: [number, number] = [18, 40] // seconds before chatting again
// talking: one hand out, then raised; mirrored when the other villager is on the left
const TALK_A = ['.oooo..', '.oHHo..', '.oHHo..', 'ooSSoo.', 'oSSSSoH', 'ooSSoo.', '.oLLo..', '.oLLo..', '.oooo..']
const TALK_B = ['.oooo..', '.oHHo.H', '.oHHooS', 'ooSSSo.', 'oSSSSo.', 'ooSSoo.', '.oLLo..', '.oLLo..', '.oooo..']
// speech bubbles above the speaker: "..." then a little "!" or heart
const BUBBLES = [
  ['.ooooooo.', 'oWWWWWWWo', 'oWkWkWkWo', 'oWWWWWWWo', '.oooooWo.', '......o..'],
  ['.ooooo.', 'oWWWWWo', 'oWWkWWo', 'oWWkWWo', 'oWWWWWo', 'oWWkWWo', 'oWWWWWo', '.oooWo.', '....o..'],
  ['.ooooooo.', 'oWrrWrrWo', 'oWrrrrrWo', 'oWWrrrWWo', 'oWWWrWWWo', '.oooooWo.', '......o..'],
]

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
  react: number | null // a new road (cell) to react to at the next safe moment
  chat: { with: Walker; until: number; first: boolean; topic: number } | null
  chatAgain: number // clock time before which this villager won't stop to talk
  pose: Pose | null // last pose (for meeting checks)
}

interface Puff { g: Graphics; cell: number; x: number; y: number; t: number }

interface Plan { home: number; spots: number[]; land: Set<number>; blocked: Set<number> }

export class People {
  private walkers: Walker[] = []
  private sig = ''
  private world!: World
  private W: number
  private TP: number
  private plans = new Map<string, Plan>()
  private rank: Int32Array = new Int32Array(0)
  private roads = new Set<number>()
  private roadsSeen = false
  private puffs: Puff[] = []
  private clock = 0
  private parent: Container | null = null

  constructor(W: number, TP: number) {
    this.W = W
    this.TP = TP
  }

  /** Graphics owned by the crowd (MapView keeps these when it redraws). */
  nodes() { return [...this.walkers.map((w) => w.g), ...this.puffs.map((p) => p.g)] }

  /** Put the crowd into the map container and take its painter's ranks. */
  attach(parent: Container, rank: Int32Array) {
    this.rank = rank
    this.parent = parent
    for (const w of this.walkers) if (w.g.parent !== parent) parent.addChild(w.g)
    for (const p of this.puffs) if (p.g.parent !== parent) parent.addChild(p.g)
  }

  /** Rebuild the crowd when villages, population, buildings or outposts change;
   *  new roads only update routes (and get a puff and an audience). */
  sync(world: World, state: GameState, revealed: Set<number>) {
    this.world = world
    const vs = Object.values(state.villages)
    const roads = new Set(vs.flatMap((v) => v.roads))
    const fresh = this.roadsSeen ? [...roads].filter((r) => !this.roads.has(r)) : []
    const roadsChanged = roads.size !== this.roads.size || fresh.length > 0
    this.roads = roads
    this.roadsSeen = true
    const idx = (col: number, row: number) => row * world.width + col
    this.hubs = new Set(vs.flatMap((v) => [idx(v.col, v.row), ...v.outposts.map((o) => idx(o.col, o.row)), ...v.buildings.map((b) => idx(b.col, b.row))]))
    this.vias.clear()
    const sig = vs.map((v) => `${v.id}:${Math.floor(v.population)}:${v.buildings.length}:${v.outposts.length}`).join('|')
    if (sig !== this.sig) {
      this.sig = sig
      for (const w of this.walkers) w.g.destroy()
      this.walkers = []
      for (const v of vs) this.spawn(world, v, revealed)
    } else if (roadsChanged) {
      for (const v of vs) this.plans.set(v.id, this.planFor(world, v, revealed))
    }
    for (const r of fresh) this.newRoad(r)
  }

  /** Where a village's people may go: its land and roads, and what's worth visiting. */
  private planFor(world: World, v: Village, revealed: Set<number>): Plan {
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
    return { home, spots, land, blocked }
  }

  private spawn(world: World, v: Village, revealed: Set<number>) {
    const plan = this.planFor(world, v, revealed)
    this.plans.set(v.id, plan)
    const { home, blocked } = plan
    const n = Math.min(10, Math.max(2, Math.floor(v.population / 2) + Math.floor(v.buildings.length / 2)))
    for (let k = 0; k < n; k++) {
      const r = mulberry32(hashString(`${v.id}-${k}`))
      const w: Walker = {
        g: new Graphics(), vid: v.id, route: [], t: 0, end: 0, wait: r() * 3, working: false, idle: 0, react: null, chat: null, chatAgain: r() * 10, pose: null,
        at: { cell: home, p: this.spot(home, blocked.has(home), r) }, rng: r,
        shirt: SHIRT[v.role] ?? 0xd0d0d0, skin: SKIN[Math.floor(r() * SKIN.length)],
      }
      this.walkers.push(w)
      this.plan(w)
      // start somewhere along the route so they don't all leave home together
      w.t = r() * w.end
    }
  }

  private hubs = new Set<number>()
  private vias = new Map<number, [number, number][] | null>()
  /** The bridge's ends on a river hex with a road (cached until the roads change). */
  private via(i: number) {
    if (!this.vias.has(i)) this.vias.set(i, bridgeVia(this.world, i, this.W, this.roads, this.hubs))
    return this.vias.get(i)!
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
        const d = dist.get(i)! + (this.roads.has(j) ? ROAD_COST : 1) + dz * 1.5
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
    const hexes = path.map((i) => ({ ...this.hex(i), blocked: P.blocked.has(i), road: this.roads.has(i), via: this.via(i) }))
    w.route = buildRoute(hexes, w.at.p, end, this.W, this.TP)
    w.t = 0
    w.end = routeTime(w.route)
    w.at = { cell: dest, p: end }
    w.working = dest !== P.home && P.blocked.has(dest)
  }

  // ------------------------------------------------------------ new roads

  private newRoad(cell: number) {
    const h = this.hex(cell)
    const g = new Graphics()
    this.parent?.addChild(g)
    this.puffs.push({ g, cell, x: h.cx, y: h.cy - h.tier * this.TP, t: 0 })
    const c = this.world.cells[cell]
    for (const w of this.walkers) {
      const at = this.world.cells[w.at.cell]
      if (distance(at, c) <= REACT_RANGE + 1) w.react = cell
    }
  }

  /** Startled hop on the spot, then (if it's our village's road) go and look. */
  private reactTo(w: Walker, road: number, pose: Pose) {
    const P = this.plans.get(w.vid)
    if (!P) return
    const here = this.world.cells[pose.cell]
    if (!here || distance(here, this.world.cells[road]) > REACT_RANGE) return
    const h = this.hex(pose.cell)
    const ground = { x: pose.x, y: pose.y + h.tier * this.TP }
    const segs: Seg[] = [{ kind: 'bounce', at: ground, tier: h.tier, cell: pose.cell, cy: h.cy, dur: 0.38, height: 5 }]
    w.at = { cell: pose.cell, p: ground }
    if (P.land.has(road) && P.land.has(pose.cell)) {
      const path = this.cells(pose.cell, road, P.land)
      if (path[path.length - 1] === road) {
        const r = this.hex(road)
        // stand beside the new track and admire it
        const end = { x: r.cx + (w.rng() - 0.5) * this.W * 0.3, y: r.cy + this.W * (0.08 + w.rng() * 0.06) }
        const hexes = path.map((i) => ({ ...this.hex(i), blocked: P.blocked.has(i) && i !== road, road: this.roads.has(i), via: this.via(i) }))
        segs.push({ kind: 'pause', at: ground, tier: h.tier, cell: pose.cell, cy: h.cy, dur: 0.25 + w.rng() * 0.3, pose: 'stand' })
        segs.push(...buildRoute(hexes, ground, end, this.W, this.TP))
        w.at = { cell: road, p: end }
      }
    }
    w.route = segs
    w.t = 0
    w.end = routeTime(segs)
    w.working = false
  }

  private drawPuff(p: Puff) {
    const g = p.g
    g.clear()
    const u = p.t / PUFF_TIME
    const r = this.rank[p.cell] ?? -1
    g.zIndex = r * 4 + 3.8
    // four chunky dust blobs bursting out and up, then thinning away
    const blobs = [[-1, -0.2], [1, -0.3], [-0.4, -1], [0.5, -0.9]]
    const spread = this.W * 0.16 * Math.sqrt(u)
    const size = Math.max(1, Math.round(2 + u * 3))
    const alpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4
    for (const [bx, by] of blobs) {
      const x = Math.round(p.x + bx * spread - size / 2)
      const y = Math.round(p.y + by * spread * 0.8 - u * 4 - size / 2)
      g.rect(x, y, size, size).fill({ color: u < 0.3 ? 0xf8f0e0 : 0xc8b8a0, alpha })
      g.rect(x + 1, y + size - 1, Math.max(1, size - 2), 1).fill({ color: 0x8a7860, alpha: alpha * 0.8 })
    }
  }

  /** Two villagers on the ground, close together at the same height, may stop to talk. */
  private meetings() {
    const free = this.walkers.filter((w) => !w.chat && w.pose && w.chatAgain <= this.clock &&
      (w.pose.kind === 'walk' || w.pose.kind === 'stand') && w.react === null)
    for (let i = 0; i < free.length; i++) {
      const a = free[i]
      if (a.chat) continue
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j]
        if (b.chat) continue
        const pa = a.pose!, pb = b.pose!
        if (pa.kind === 'stand' && pb.kind === 'stand') continue // someone has to be passing by
        if (this.world.cells[pa.cell].tier !== this.world.cells[pb.cell].tier) continue
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
        if (d < CHAT_RANGE[0] || d > CHAT_RANGE[1]) continue
        // either way they're not stopping again for a while after this meeting
        const later = this.clock + CHAT_COOLDOWN[0] + a.rng() * (CHAT_COOLDOWN[1] - CHAT_COOLDOWN[0])
        a.chatAgain = b.chatAgain = later
        if (a.rng() > CHAT_CHANCE) continue
        const until = this.clock + CHAT_TIME[0] + a.rng() * (CHAT_TIME[1] - CHAT_TIME[0])
        const topic = Math.floor(a.rng() * BUBBLES.length)
        a.chat = { with: b, until, first: true, topic }
        b.chat = { with: a, until, first: false, topic: (topic + 1) % BUBBLES.length }
        a.chatAgain = b.chatAgain = until + (later - this.clock)
        break
      }
    }
  }

  update(dt: number) {
    if (!this.world) return
    this.clock += dt
    for (const p of this.puffs) { p.t += dt; this.drawPuff(p) }
    for (const p of this.puffs.filter((x) => x.t >= PUFF_TIME)) p.g.destroy()
    this.puffs = this.puffs.filter((x) => x.t < PUFF_TIME)
    for (const w of this.walkers) {
      let pose: Pose
      // react only with both feet on the ground (not mid-climb or mid-hop)
      if (w.react !== null) {
        const now = w.t < w.end ? sample(w.route, w.t, this.TP) : null
        if (!now || now.kind === 'walk' || now.kind === 'stand' || now.kind === 'work') {
          const h = this.hex(w.at.cell)
          const p = now ?? { x: w.at.p.x, y: w.at.p.y - h.tier * this.TP, cell: w.at.cell, front: true, kind: 'stand' as const, dist: 0 }
          const road = w.react
          w.react = null
          // a new road beats a chat: both break off
          if (w.chat) { if (w.chat.with.chat?.with === w) w.chat.with.chat = null; w.chat = null }
          this.reactTo(w, road, p)
          w.wait = 0
        }
      }
      if (w.chat && this.clock < w.chat.until && w.react === null) {
        // stopped mid-route for a chat: hold the spot, the route waits
        const at = w.pose ?? sample(w.route, w.t, this.TP)
        pose = { ...at, kind: 'stand' }
        w.idle += dt
        w.pose = pose
        this.place(w, pose)
        this.draw(w, Math.round(pose.x), Math.round(pose.y), 'stand', 0, this.talking(w))
        continue
      }
      if (w.chat) w.chat = null
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
      w.pose = pose
      this.place(w, pose)
      // feet step every 3 px walked; hands alternate every 2 px climbed; tools swing twice a second
      const step = pose.kind === 'walk' ? Math.floor(pose.dist / 3) & 1
        : pose.kind === 'climb' ? Math.floor(pose.dist / 2) & 1
        : Math.floor(w.idle * 2) & 1
      this.draw(w, Math.round(pose.x), Math.round(pose.y), pose.kind, step)
    }
    this.meetings()
  }

  private place(w: Walker, pose: Pose) {
    const r = this.rank[pose.cell] ?? -1
    const zi = r * 4 + (pose.front ? 3.5 : 2)
    if (w.g.zIndex !== zi) w.g.zIndex = zi
  }

  /** Who's speaking right now: partners take turns every ~0.9 s. */
  private talking(w: Walker): { mirror: boolean; speaking: boolean; topic: number; gesture: number } {
    const c = w.chat!
    const turn = Math.floor((c.until - this.clock) / 0.9) & 1
    const speaking = c.first ? turn === 0 : turn === 1
    const other = c.with.pose
    const mirror = !!other && !!w.pose && other.x < w.pose.x
    return { mirror, speaking, topic: c.topic, gesture: speaking ? Math.floor(this.clock * 3) & 1 : 0 }
  }

  /** 6×9 px villager, feet at (x, y). Rows top to bottom; o outline, H skin,
   *  S shirt, L legs, T tool. */
  private draw(w: Walker, x: number, y: number, kind: Pose['kind'], step: number,
    talk?: { mirror: boolean; speaking: boolean; topic: number; gesture: number }) {
    let fig = talk ? (talk.gesture ? TALK_B : TALK_A)
      : kind === 'work' ? (step ? WORK_UP : WORK_DOWN)
      : kind === 'walk' ? (step ? WALK : STAND)
      : kind === 'climb' ? (step ? CLIMB_B : CLIMB_A)
      : kind === 'hop' ? HOP : kind === 'land' ? LAND : STAND
    // mirrored talk poses are 7 wide with the body on the right: shift left one
    let dx = -3
    if (talk?.mirror) { fig = fig.map((r) => r.padEnd(7, '.').split('').reverse().join('')); dx = -4 }
    const col: Record<string, number> = { o: 0x1c1828, H: w.skin, S: w.shirt, L: 0x5a4630, T: 0xa08050, D: 0x4a3020, W: 0xffffff, k: 0x1c1828, r: 0xe04858 }
    const g = w.g
    g.clear()
    const top = y - fig.length + 1
    const paint = (rows: string[], ox: number, oy: number) => rows.forEach((rowStr, r) => {
      for (let c = 0; c < rowStr.length; c++) {
        const ch = rowStr[c]
        if (ch !== '.') g.rect(ox + c, oy + r, 1, 1).fill(col[ch])
      }
    })
    paint(fig, x + dx, top)
    if (talk?.speaking) {
      const b = BUBBLES[talk.topic % BUBBLES.length]
      // above the head, leaning toward the listener
      paint(b, x + (talk.mirror ? -b[0].length + 1 : 0), top - b.length - 1)
    }
  }
}
