/** Merchant caravans that pass through now and then: a donkey cart and its
 *  merchant come in out of the fog, stop at a village to trade, and leave the
 *  other way. Purely scenery (never in the event log), but chosen from the
 *  world seed and the clock, so everyone in the world sees the same caravan.
 *
 *  Routes: cheapest land path (roads preferred, gentle slopes only), through
 *  hex centres on roads and around buildings elsewhere (crossHex), with a
 *  short ramp where the ground steps up or down.
 *
 *  None travel on the Sabbath: no caravan sets off on a Saturday (this
 *  device's own day). */
import { Container, Sprite } from 'pixi.js'
import { distance, hexToPixel, neighbours, spiral } from '../world/hex'
import { rngFor } from '../world/rng'
import type { World } from '../world/types'
import type { GameState } from '../game/types'
import { cellIndex } from '../game/reducer'
import { byDoor, crossHex, type Pt } from './walk'
import type { Site } from './footprint'
import { bridgeVia } from './waterways'
import type { Atlas } from './atlas'

export const PERIOD = 6 * 60_000 // ms: at most one caravan per window
const CHANCE = 0.75 // of a caravan in any window
const SPEED = 7 // px / s
const TRADE_TIME = 10 // s stopped at the village
const REACH: [number, number] = [8, 12] // hexes from the village where they appear / leave
const MAX_STEP = 2 // carts manage gentle steps only

export interface TraderPoint { x: number; y: number; tier: number; cell: number; cy: number }
export interface TraderTrip {
  window: number
  village: string
  points: TraderPoint[] // ground polyline with tier at each point
  stopAt: number // index of the point where it stops to trade
  start: number // ms when it sets off
}

/** The caravan (if any) for the time window containing `now`. Deterministic. */
/** `siteAt`: a building hex's walking grid (from its model), so carts go round what stands there. */
export function tripAt(world: World, s: GameState, now: number, W: number, siteAt: (i: number) => Site | null = () => null): TraderTrip | null {
  const window = Math.floor(now / PERIOD)
  if (new Date(window * PERIOD).getDay() === 6) return null // the Sabbath: merchants rest too
  const villages = Object.values(s.villages).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!villages.length) return null
  const rng = rngFor(world.seed, `trader:${window}`)
  if (rng() > CHANCE) return null
  const v = villages[Math.floor(rng() * villages.length)]
  const home = cellIndex(world, v.col, v.row)
  const roads = new Set(villages.flatMap((x) => x.roads))
  const blocked = new Set(villages.flatMap((x) => [
    cellIndex(world, x.col, x.row), ...x.buildings.map((b) => cellIndex(world, b.col, b.row)), ...x.outposts.map((o) => cellIndex(world, o.col, o.row)),
  ]))

  // somewhere on land 8-12 hexes out, then roughly the opposite side
  const ring = (min: number, max: number) => spiral(v, max)
    .filter((o) => o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height && distance(o, v) >= min)
    .map((o) => cellIndex(world, o.col, o.row)).filter((i) => world.cells[i].tier > 0 && !blocked.has(i))
  const candidates = ring(REACH[0], REACH[1])
  if (candidates.length < 2) return null
  const from = candidates[Math.floor(rng() * candidates.length)]
  const fp = hexToPixel(world.cells[from].col, world.cells[from].row, W), hp = hexToPixel(v.col, v.row, W)
  const away = candidates.filter((i) => {
    const p = hexToPixel(world.cells[i].col, world.cells[i].row, W)
    return (p.x - hp.x) * (fp.x - hp.x) + (p.y - hp.y) * (fp.y - hp.y) * 4 < 0 // other side of the village
  })
  const to = (away.length ? away : candidates)[Math.floor(rng() * (away.length || candidates.length))]

  const inbound = landPath(world, from, home, roads)
  const outbound = landPath(world, home, to, roads)
  if (!inbound || !outbound) return null

  const centre = (i: number) => { const c = world.cells[i]; return hexToPixel(c.col, c.row, W) }
  const front = (i: number): Pt => { const p = centre(i); return { x: p.x, y: p.y + W * 0.2 } } // in front of the houses
  const leg = (path: number[], start: Pt, end: Pt): TraderPoint[] => {
    const out: TraderPoint[] = []
    const push = (p: Pt, i: number) => out.push({ x: p.x, y: p.y, tier: world.cells[i].tier, cell: i, cy: centre(i).y })
    let cur = start
    for (let k = 0; k < path.length; k++) {
      const i = path[k], c = centre(i)
      const h = { cell: i, cx: c.x, cy: c.y, tier: world.cells[i].tier, blocked: blocked.has(i), site: siteAt(i) }
      const next = path[k + 1]
      if (next === undefined) {
        for (const p of crossHex(h, cur, end, W).slice(k === 0 ? 0 : 1)) push(p, i)
        break
      }
      const n = centre(next)
      // ramp across the edge: leave this hex's level at 40%, reach the next one's at 60%
      const a = { x: c.x + (n.x - c.x) * 0.4, y: c.y + (n.y - c.y) * 0.4 }
      const b = { x: c.x + (n.x - c.x) * 0.6, y: c.y + (n.y - c.y) * 0.6 }
      // on a road: along the track (over the bridge, on a river hex), else across the hex
      const br = roads.has(i) && !h.blocked ? bridgeVia(world, i, W, roads, blocked) : null
      const brPts = br ? (() => {
        const [u, v] = br.map(([x, y]) => ({ x, y }))
        const d = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y)
        return d(cur, u) + d(v, a) <= d(cur, v) + d(u, a) ? [cur, u, v, a] : [cur, v, u, a]
      })() : null
      const via = brPts ?? (roads.has(i) && h.site ? byDoor(h, h.site, cur, a, W) : roads.has(i) && !h.blocked ? [cur, c, a] : crossHex(h, cur, a, W))
      for (const p of via.slice(k === 0 ? 0 : 1)) push(p, i)
      out.push({ x: b.x, y: b.y, tier: world.cells[next].tier, cell: next, cy: n.y })
      cur = b
    }
    return out
  }
  const stop = front(home)
  const a = leg(inbound, centre(from), stop)
  const b = leg(outbound, stop, centre(to))
  const points = [...a, ...b.slice(1)]
  return { window, village: v.id, points, stopAt: a.length - 1, start: window * PERIOD + Math.floor(rng() * 30_000) }
}

/** Cheapest path over land: roads are quick, climbing costs more, cliffs are impassable. */
function landPath(world: World, from: number, to: number, roads: Set<number>): number[] | null {
  const dist = new Map<number, number>([[from, 0]])
  const prev = new Map<number, number>()
  const open = [from]
  while (open.length) {
    open.sort((x, y) => dist.get(x)! - dist.get(y)!)
    const i = open.shift()!
    if (i === to) break
    if (dist.get(i)! > 60) continue
    const c = world.cells[i]
    for (const [nc, nr] of neighbours(c.col, c.row)) {
      if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
      const j = nr * world.width + nc
      const cj = world.cells[j]
      if (cj.tier === 0 || Math.abs(cj.tier - c.tier) > MAX_STEP) continue
      const d = dist.get(i)! + (roads.has(j) ? 0.3 : 1) + Math.abs(cj.tier - c.tier)
      if (d < (dist.get(j) ?? Infinity)) {
        if (!dist.has(j)) open.push(j)
        dist.set(j, d)
        prev.set(j, i)
      }
    }
  }
  if (!dist.has(to)) return null
  const path = [to]
  while (path[0] !== from) path.unshift(prev.get(path[0])!)
  return path
}

export interface TraderPose { x: number; y: number; cell: number; front: boolean; dir: number; moving: boolean; dist: number; done: boolean }

/** Where the caravan is `ms` after setting off. */
export function traderPose(trip: TraderTrip, ms: number, TP: number): TraderPose {
  let t = Math.max(0, ms / 1000)
  let dist = 0
  const pts = trip.points
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1]
    if (k === trip.stopAt) {
      if (t < TRADE_TIME) return { x: a.x, y: a.y - a.tier * TP, cell: a.cell, front: a.y > a.cy, dir: Math.sign(b.x - a.x) || 1, moving: false, dist, done: false }
      t -= TRADE_TIME
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const dur = len / SPEED
    if (t > dur) { t -= dur; dist += len; continue }
    const u = dur ? t / dur : 1
    const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u
    const tier = a.tier + (b.tier - a.tier) * u
    const cell = u < 0.5 ? a.cell : b.cell
    const cy = u < 0.5 ? a.cy : b.cy
    return { x, y: y - tier * TP, cell, front: y > cy, dir: Math.sign(b.x - a.x) || 1, moving: true, dist: dist + len * u, done: false }
  }
  const z = pts[pts.length - 1]
  return { x: z.x, y: z.y - z.tier * TP, cell: z.cell, front: true, dir: 1, moving: false, dist, done: true }
}

export const tripLength = (trip: TraderTrip) => {
  let s = TRADE_TIME
  for (let k = 0; k + 1 < trip.points.length; k++) s += Math.hypot(trip.points[k + 1].x - trip.points[k].x, trip.points[k + 1].y - trip.points[k].y) / SPEED
  return s * 1000
}

/** Draws the current caravan (if any) into the map container: the Blender-
 *  rendered merchant, donkey and covered wagon (f_trader / f_trader_r, one per
 *  direction so both are lit from the same side). */
export class Traders {
  private left: Sprite | null = null
  private right: Sprite | null = null
  private trip: TraderTrip | null = null
  private world: World | null = null
  private state: GameState | null = null
  private revealed = new Set<number>()
  private rank: Int32Array = new Int32Array(0)
  private sig = ''
  private W: number
  private TP: number

  constructor(atlas: Atlas) {
    this.W = atlas.meta.size
    this.TP = atlas.meta.tier
    const make = (name: string) => {
      const f = atlas.tex(name) ?? atlas.tex('f_caravan')
      if (!f) return null
      const sp = new Sprite(f.texture)
      sp.anchor.set(f.frame.ax / f.frame.w, f.frame.ay / f.frame.h)
      sp.visible = false
      return sp
    }
    this.left = make('f_trader')
    this.right = make('f_trader_r')
  }

  nodes() { return [this.left, this.right].filter((x): x is Sprite => !!x) }

  attach(parent: Container, rank: Int32Array) {
    this.rank = rank
    for (const n of this.nodes()) if (n.parent !== parent) parent.addChild(n)
  }

  /** building hexes' walking grids (set by the map) */
  siteAt: (i: number) => Site | null = () => null

  sync(world: World, state: GameState, revealed: Set<number>) {
    this.world = world
    this.state = state
    this.revealed = revealed
  }

  update(now: number) {
    const { world, state } = this
    if (!world || !state || !this.left || !this.right) return
    const window = Math.floor(now / PERIOD)
    const sig = `${window}:${Object.keys(state.villages).length}`
    if (sig !== this.sig) {
      this.sig = sig
      this.trip = tripAt(world, state, now, this.W, this.siteAt)
    }
    const trip = this.trip
    const pose = trip && now >= trip.start ? traderPose(trip, now - trip.start, this.TP) : null
    const show = !!pose && !pose.done && this.revealed.has(pose.cell)
    const sp = pose && pose.dir > 0 ? this.right : this.left
    this.left.visible = show && sp === this.left
    this.right.visible = show && sp === this.right
    if (!show || !pose) return
    // a little bounce in the step while on the move
    const bob = pose.moving && Math.floor(pose.dist / 4) & 1 ? 1 : 0
    sp.x = Math.round(pose.x)
    sp.y = Math.round(pose.y) - bob
    sp.zIndex = (this.rank[pose.cell] ?? -1) * 4 + (pose.front ? 3.5 : 2)
  }
}
