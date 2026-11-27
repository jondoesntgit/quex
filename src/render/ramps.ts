/** Ramps where a road meets a cliff between two hexes of different height.
 *
 *  A ramp is an earth (or, on a paved road, stone) ramp built against the cliff on the lower hex's side, along
 *  the shared edge. The road on the higher hex comes to the edge at the ramp's top end; the road on the lower
 *  hex runs to its foot. Villagers walk up and down it (walk.ts `ramp` segments, along `way`).
 *  - A one-tier drop: a single flight along the edge, at RAMP_ANGLE.
 *  - Two tiers or more: a switchback, like a wheelchair ramp at a public building: the lower flight runs along
 *    an outer lane from the foot to a landing at the far end, turns, and the upper flight comes back along the
 *    inner lane against the cliff to the top, which is at the same end as the foot. Both flights share one
 *    slope (RAMP_ANGLE for two tiers; there is only room for two lanes, so bigger drops are steeper).
 *  - Beside a river that comes over the same edge (a waterfall): a short single flight to one side of it.
 *
 *  Model space is the Blender renderer's (tools/blender/render_ramps.py builds the same ramps from the same
 *  numbers; change both together): hex radius 1, x right, y back (away from the camera), z up. On screen a
 *  model unit is W/2 px across and W/(2*sqrt 3) px up the screen; a unit of height is W/2 * sin(tilt) px; a
 *  tier is W/8 px. Edge k of a hex has its middle at angle 30 + 60k degrees (counterclockwise from the right).
 *  Along an edge s runs along t = (-sin a, cos a) (counterclockwise) and d runs into the hex. A ramp's top is
 *  at its +t end, or its -t end when it's flipped: only where a river runs through either hex and the other
 *  way round would put the foot or the top on the far bank from where the road meets the edge.
 *  Pure geometry (no Pixi), so it is testable. */
import { hexToPixel, neighbours } from '../world/hex'
import type { World } from '../world/types'
import { bankOf, riverOnEdge, roadEdgePoint } from './waterways'

/** across a flight, in model units: about 1.6-1.9 villagers (6 px each) side by side, room for a donkey */
export const RAMP_WIDTH = 0.3
/** the slope it is built to, where there's room */
export const RAMP_ANGLE = 30
/** a single flight: at most this long, along an edge one unit long (room left at the corners) */
export const RAMP_MAX = 0.9
/** a switchback: where its lower flight runs (s from LOW_FROM at the foot to TURN at the landing, on the outer
 *  lane's middle line), and its upper flight (from TURN back to TOP, on the inner lane's) */
export const SWITCH = { LOW_FROM: 0.2, TURN: -0.2, LANDING: -0.3, TOP: 0.45 }
/** beside a river that comes over the same edge: a short single flight to one side of it */
export const RAMP_SHORT = 0.3
export const RAMP_SHORT_AT = 0.32
/** short ramps are drawn for drops this big at most (past it, a switchback) */
export const RAMP_SHORT_MAX_DROP = 3
/** the most tiers a ramp sprite is drawn for */
export const RAMP_MAX_DROP = 4
const TILT = (54.7356 * Math.PI) / 180
const R3 = Math.sqrt(3)
const RAD = Math.PI / 180

export type Pt2 = [number, number]
/** a point on a ramp's walking line: where (map px on the ground plane, untiered) and how high (0 at the
 *  foot, 1 at the top: a share of the drop) */
export interface WayPt { p: Pt2; h: number }
export interface Ramp {
  lower: number; upper: number
  /** the edge of the lower hex it stands on (0..5), and how many tiers it climbs */
  k: number; drop: number
  /** 'a'/'b': a short ramp beside a river, on the +t / -t side; '' otherwise */
  short: '' | 'a' | 'b'
  switchback: boolean
  flip: boolean
  /** its slope (degrees) */
  angle: number
  /** map px (untiered): the sprite's anchor (the middle of the edge, or of a short ramp's stretch of it, at
   *  the lower hex's level), its foot (where the lower road ends) and the point on the edge at its top end
   *  (where the higher road ends) */
  anchor: Pt2; foot: Pt2; edge: Pt2
  /** the walking line, foot to edge */
  way: WayPt[]
}

const toPx = (x: number, y: number, W: number): Pt2 => [(x * W) / 2, (-y * W) / (2 * R3)]

/** One tier of height, in model units. */
export const tierUnits = (W: number, TP: number) => TP / ((W / 2) * Math.sin(TILT))

/** Which edge (0..5, by model angle) of hex i faces neighbour j. */
export function edgeIndex(world: World, i: number, j: number, W: number): number {
  const a = world.cells[i], b = world.cells[j]
  const p = hexToPixel(a.col, a.row, W), q = hexToPixel(b.col, b.row, W)
  const deg = (Math.atan2((-(q.y - p.y) * 2 * R3) / W, ((q.x - p.x) * 2) / W) * 180) / Math.PI
  return (((Math.round((deg - 30) / 60)) % 6) + 6) % 6
}

/** Does a road cross the edge between i and j (both ends drawn by roadLayout)? */
export function roadCrosses(i: number, j: number, roads: Set<number>, hubs: Set<number>) {
  return (roads.has(i) && (roads.has(j) || hubs.has(j))) || (roads.has(j) && hubs.has(i))
}

/** A ramp's walking line in edge space ([s, d, h]: along the edge, into the hex, share of the drop), before
 *  flipping; and its slope in degrees. render_ramps.py builds the solid around the same lines. */
export function rampLine(drop: number, kind: 'single' | 'switchback' | 'short', c: number, tu: number): { line: [number, number, number][]; angle: number } {
  const H = drop * tu, w = RAMP_WIDTH
  if (kind === 'switchback') {
    const { LOW_FROM, TURN, LANDING, TOP } = SWITCH
    const low = LOW_FROM - TURN, high = TOP - TURN
    const h1 = low / (low + high)
    return {
      line: [[LOW_FROM, 1.5 * w, 0], [TURN, 1.5 * w, h1], [LANDING, w, h1], [TURN, 0.5 * w, h1], [TOP, 0.5 * w, 1], [TOP, 0, 1]],
      angle: Math.atan(H / (low + high)) / RAD,
    }
  }
  const len = kind === 'short' ? RAMP_SHORT : Math.min(RAMP_MAX, H / Math.tan(RAMP_ANGLE * RAD))
  return { line: [[c - len / 2, 0.5 * w, 0], [c + len / 2, 0.5 * w, 1], [c + len / 2, 0, 1]], angle: Math.atan(H / len) / RAD }
}

/** The ramp on the edge between hexes i and j if they stand at different heights (both on land), else null. */
export function rampBetween(world: World, i: number, j: number, W: number, TP: number): Ramp | null {
  const ci = world.cells[i], cj = world.cells[j]
  if (ci.tier === cj.tier || ci.tier === 0 || cj.tier === 0) return null
  const [lower, upper] = ci.tier < cj.tier ? [i, j] : [j, i]
  const L = world.cells[lower]
  const drop = world.cells[upper].tier - L.tier
  const k = edgeIndex(world, lower, upper, W)
  const a = (30 + 60 * k) * RAD
  const tx = -Math.sin(a), ty = Math.cos(a), ix = -Math.cos(a), iy = -Math.sin(a)
  const mx = 0.866 * Math.cos(a), my = 0.866 * Math.sin(a)
  const base = hexToPixel(L.col, L.row, W)
  const at = (s: number, d: number): Pt2 => {
    const [x, y] = toPx(mx + tx * s + ix * d, my + ty * s + iy * d, W)
    return [base.x + x, base.y + y]
  }
  // a river over the same edge: the road crosses beside it (roadEdgePoint), and so does a short ramp
  let c = 0
  let short: Ramp['short'] = ''
  if (riverOnEdge(world, lower, upper) && drop <= RAMP_SHORT_MAX_DROP) {
    const e = roadEdgePoint(world, lower, upper, W, 0)
    const ex = ((e[0] - base.x) * 2) / W, ey = (-(e[1] - base.y) * 2 * R3) / W
    const side = (ex - mx) * tx + (ey - my) * ty >= 0 ? 1 : -1
    c = side * RAMP_SHORT_AT
    short = side > 0 ? 'a' : 'b'
  }
  const kind = short ? 'short' : drop >= 2 ? 'switchback' : 'single'
  const { line, angle } = rampLine(drop, kind, c, tierUnits(W, TP))
  const make = (flip: boolean): Ramp => {
    // a short ramp keeps its place beside the river; flipping turns it end for end where it stands
    const f = (s: number) => (flip ? 2 * c - s : s)
    const way = line.map(([s, d, h]) => ({ p: at(f(s), d), h }))
    return { lower, upper, k, drop, short, switchback: kind === 'switchback', flip, angle, anchor: at(c, 0), foot: way[0].p, edge: way[way.length - 1].p, way }
  }
  const r = make(false)
  // a river through either hex: keep the foot (below) and the top end (above) on the road's bank
  if (world.cells[lower].riverTo === -1 && world.cells[upper].riverTo === -1) return r
  const crossing = at(c, 0.12) // where the road would meet the edge, just inside each hex
  const above: Pt2 = [2 * at(c, 0)[0] - crossing[0], 2 * at(c, 0)[1] - crossing[1]]
  const ok = (x: Ramp) => (bankOf(world, lower, W, x.foot) === bankOf(world, lower, W, crossing) ? 1 : 0)
    + (bankOf(world, upper, W, x.edge) === bankOf(world, upper, W, above) ? 1 : 0)
  const fl = make(true)
  return ok(fl) > ok(r) ? fl : r
}

/** The house sheet sprite for a ramp: r_<d|p>_<edge>_<drop>[a|b][f] (dirt or paved; short ones beside a
 *  river; flipped). */
export function rampKey(r: Ramp, paved: boolean): string {
  return `r_${paved ? 'p' : 'd'}_${r.k}_${Math.min(RAMP_MAX_DROP, r.drop)}${r.short}${r.flip ? 'f' : ''}`
}

/** Every ramp a road takes out of hex i, by the neighbour it leads to. */
export function rampsAround(world: World, i: number, W: number, TP: number, roads: Set<number>, hubs: Set<number>): Map<number, Ramp> {
  const out = new Map<number, Ramp>()
  const c = world.cells[i]
  for (const [nc, nr] of neighbours(c.col, c.row)) {
    if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
    const j = nr * world.width + nc
    if (!roadCrosses(i, j, roads, hubs)) continue
    const r = rampBetween(world, i, j, W, TP)
    if (r) out.set(j, r)
  }
  return out
}

/** Which edge (0..5) of the water hex at i the land that holds a pier up is on: the neighbour's, preferring one
 *  `prefer` accepts (your own shore), else any land. Docks and shipyards have a sprite for each. */
export function shoreEdge(world: World, i: number, W: number, prefer: (j: number) => boolean): number {
  const c = world.cells[i]
  const land = neighbours(c.col, c.row)
    .filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < world.width && nr < world.height)
    .map(([nc, nr]) => nr * world.width + nc)
    .filter((j) => world.cells[j].tier > 0)
  const j = land.find(prefer) ?? land[0]
  return j === undefined ? 1 : edgeIndex(world, i, j, W)
}
