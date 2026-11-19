/** Rivers, roads and the bridges where they cross: the geometry, in one place.
 *
 *  Screen space throughout (x right, y down; a hex top is W wide and W/2 tall).
 *  "Flat" space doubles y, undoing the foreshortening, so angles and widths
 *  there are true ground angles and widths.
 *
 *  Rivers: in each river hex, one smooth cubic curve runs from every inlet
 *  edge (or from a spring in the middle) to the outlet edge. Each curve
 *  crosses its edges heading straight across them (its tangent there points
 *  along the line between the two hex centres), so it runs on smoothly into
 *  the neighbouring hex. Confluences (Y branches) are several curves sharing
 *  the outlet.
 *
 *  Roads: legs run from the hex's middle to each edge the road crosses, also
 *  heading straight across the edge. Where a river crosses that same edge,
 *  the road's crossing point slides along the edge (the same way for both
 *  hexes), so a road never runs down the river's centre line and always
 *  meets it at an angle inside a hex.
 *
 *  Bridges: wherever a road leg crosses a river curve, a bridge is laid along
 *  the road at that point, long enough to span the water at that angle. */
import type { World } from '../world/types'
import { hexToPixel, neighbours } from '../world/hex'

export type Pt = [number, number]

const hash01 = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** A hex's slightly off-centre middle, so roads and rivers bend a little (stable per hex). */
export function bendPoint(seed: number, cx: number, cy: number, W: number): Pt {
  const h1 = Math.sin(seed * 12.9898) * 43758.5453, h2 = Math.sin(seed * 78.233) * 12543.123
  const a = h1 - Math.floor(h1), b = h2 - Math.floor(h2)
  return [cx + (a - 0.5) * W * 0.16, cy + (b - 0.5) * W * 0.08]
}

/** Does a river cross the edge between hexes i and j? */
export function riverOnEdge(world: World, i: number, j: number) {
  const a = world.cells[i], b = world.cells[j]
  return (a.riverTo === j && a.tier > 0) || (b.riverTo === i && b.tier > 0)
}

/** Where a road crosses the edge between hex i and neighbour j, at hex i's
 *  height. The edge midpoint, unless a river crosses that edge: then the road
 *  slides a fifth of a hex along the edge (always the same way for a given
 *  edge, so both hexes agree). */
export function roadEdgePoint(world: World, i: number, j: number, W: number, TP: number): Pt {
  const a = Math.min(i, j), b = Math.max(i, j)
  const ca = world.cells[a], cb = world.cells[b]
  const pa = hexToPixel(ca.col, ca.row, W), pb = hexToPixel(cb.col, cb.row, W)
  let mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2
  if (riverOnEdge(world, i, j)) {
    // the edge's direction in flat space is perpendicular to the line between the centres
    const fx = pb.x - pa.x, fy = (pb.y - pa.y) * 2
    const len = Math.hypot(fx, fy) || 1
    const ex = -fy / len, ey = fx / len // flat unit vector along the edge
    const s = (hash01(a, b) < 0.5 ? -1 : 1) * W * 0.2
    mx += ex * s
    my += (ey * s) / 2
  }
  return [Math.round(mx), Math.round(my - world.cells[i].tier * TP)]
}

/** Unit vector (screen) from hex i's centre toward the midpoint of its edge with j. */
function edgeNormal(world: World, i: number, j: number, W: number): Pt {
  const ci = world.cells[i], cj = world.cells[j]
  const p = hexToPixel(ci.col, ci.row, W), q = hexToPixel(cj.col, cj.row, W)
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len]
}

function cubic(a: Pt, b: Pt, c: Pt, d: Pt, n = 12): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t
    out.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ])
  }
  return out
}

/** Carry a path `over` px past its end (and its start, unless `keepStart`), so neighbouring hexes overlap with no seam. */
export function extend(pts: Pt[], over: number, keepStart = false): Pt[] {
  const ext = (from: Pt, to: Pt): Pt => {
    const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy) || 1
    return [to[0] + (dx / len) * over, to[1] + (dy / len) * over]
  }
  const out = pts.slice()
  out.push(ext(pts[pts.length - 2], pts[pts.length - 1]))
  if (!keepStart) out.unshift(ext(pts[1], pts[0]))
  return out
}

export interface RiverLayout {
  /** water width (px) */
  width: number
  /** where the river leaves the hex (edge midpoint toward its downstream hex) */
  lip: Pt
  /** one curve per inlet (or one from the spring), each ending at the lip */
  flows: Pt[][]
  spring: boolean
}

export function riverLayout(world: World, i: number, cx: number, cy: number, W: number, TP: number): RiverLayout {
  const cell = world.cells[i]
  const width = Math.max(3, Math.round(W / 18) + Math.min(3, Math.floor(cell.riverFlow / 6)))
  const p = hexToPixel(cell.col, cell.row, W)
  const mid = (j: number): Pt => {
    const c = world.cells[j], q = hexToPixel(c.col, c.row, W)
    return [Math.round((p.x + q.x) / 2), Math.round((p.y + q.y) / 2 - cell.tier * TP)]
  }
  const lip = mid(cell.riverTo)
  const ups: Pt[] = []
  for (const [nc, nr] of neighbours(cell.col, cell.row)) {
    if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
    const j = nr * world.width + nc
    // (a neighbour that is also our downstream would make a loop back out through the same edge: not an inlet)
    if (world.cells[j].riverTo === i && j !== cell.riverTo) ups.push(mid(j))
  }
  // control points pull toward the centre (so each end heads straight across its edge),
  // with a small sideways push so every hex gets its own gentle bend
  const c: Pt = [cx, cy]
  const b = bendPoint(i + 0.5, cx, cy, W)
  const push: Pt = [(b[0] - cx) * 0.9, (b[1] - cy) * 0.9]
  const toward = (e: Pt): Pt => [e[0] + (c[0] - e[0]) * 0.55 + push[0], e[1] + (c[1] - e[1]) * 0.55 + push[1]]
  const spring = !ups.length
  const start: Pt = [cx + push[0], cy + push[1]]
  const flows = spring ? [cubic(start, start, toward(lip), lip)] : ups.map((u) => cubic(u, toward(u), toward(lip), lip))
  return { width, lip, flows, spring }
}

export interface RoadLayout {
  width: number
  /** where the legs meet (the main junction; on a river hex, a hub on one bank) */
  mid: Pt
  /** every stretch of road to draw (from hubs out to edges, and between hubs and bridges), not extended */
  legs: Pt[][]
  /** bridges: bank-to-bank spans, square across the current */
  bridges: { a: Pt; b: Pt }[]
  /** a dead end's rounded tip (behind the middle), if any */
  tip: Pt | null
  /** cliffs the road steps down, on the south-facing edges */
  steps: { x: number; y0: number; y1: number }[]
}

/** Which side of a curve a point lies on (+1 / -1), by the nearest segment. */
function sideOf(flow: Pt[], p: Pt): number {
  let best = Infinity, sign = 1
  for (let k = 0; k + 1 < flow.length; k++) {
    const [ax, ay] = flow[k], [bx, by] = flow[k + 1]
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)))
    const qx = ax + dx * t, qy = ay + dy * t
    const d = (p[0] - qx) ** 2 + (p[1] - qy) ** 2
    if (d < best) { best = d; sign = dx * (p[1] - ay) - dy * (p[0] - ax) >= 0 ? 1 : -1 }
  }
  return sign
}

/** A quadratic leg from `from` to an edge point `e`, arriving heading along `n` (straight across the edge). */
function legTo(from: Pt, e: Pt, n: Pt): Pt[] {
  const reach = Math.hypot(e[0] - from[0], e[1] - from[1]) * 0.5
  const q: Pt = [e[0] - n[0] * reach, e[1] - n[1] * reach]
  const out: Pt[] = []
  for (let s = 0; s <= 8; s++) {
    const t = s / 8, u = 1 - t
    out.push([u * u * from[0] + 2 * u * t * q[0] + t * t * e[0], u * u * from[1] + 2 * u * t * q[1] + t * t * e[1]])
  }
  return out
}

/** A leg from `from` to edge point `e` that stays out of the water if it can:
 *  the usual curve, then a straight line, then a dog-leg through a point just
 *  inside the edge. */
function dryLeg(from: Pt, e: Pt, n: Pt, flows: Pt[][], W: number): Pt[] {
  const wet = (leg: Pt[]) => crossings([leg], flows).length > 0
  const curve = legTo(from, e, n)
  if (!wet(curve)) return curve
  const straight: Pt[] = [from, e]
  if (!wet(straight)) return straight
  for (const k of [0.12, 0.2, 0.3]) {
    const inner: Pt = [e[0] - n[0] * W * k, e[1] - n[1] * W * k]
    const dog: Pt[] = [from, inner, e]
    if (!wet(dog)) return dog
  }
  return curve
}

/** The road in hex i, given which hexes have roads and which are places roads lead to.
 *
 *  On a river hex the river splits the hex into areas (two for one stream, three
 *  for a Y: the fork and the two outer sides). The road's ends are sorted by
 *  area; each area with ends gets a hub on its bank, and neighbouring areas are
 *  joined by one straight bridge square across the stream between them, at
 *  mid-stream. So however many roads meet here, the river is crossed once per
 *  stream, never by a tangle of legs. Springs and rare three-way joins fall back
 *  to bridging wherever a leg happens to cross. */
export function roadLayout(world: World, i: number, cx: number, cy: number, W: number, TP: number, roads: Set<number>, hubs: Set<number>): RoadLayout {
  const cell = world.cells[i]
  const width = Math.max(3, Math.round(W / 14))
  const ends: { e: Pt; n: Pt }[] = []
  const steps: RoadLayout['steps'] = []
  neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
    if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) return
    const j = nr * world.width + nc
    // roads link to roads and to the places they serve; places only link to roads
    if (!roads.has(j) && !(roads.has(i) && hubs.has(j))) return
    const n = world.cells[j]
    if (n.tier === 0) return
    const e = roadEdgePoint(world, i, j, W, TP)
    ends.push({ e, n: edgeNormal(world, i, j, W) })
    // south-facing edges (SE, S, SW) show this hex's cliff when the neighbour is lower
    if (k >= 1 && k <= 3 && n.tier < cell.tier) steps.push({ x: e[0], y0: e[1], y1: e[1] + (cell.tier - n.tier) * TP })
  })
  const centre: Pt = [cx, cy]
  const place = hubs.has(i)
  const plain = (mid: Pt): RoadLayout => {
    const legs = ends.map(({ e, n }) => legTo(mid, e, n))
    let tip: Pt | null = null
    if (legs.length === 1 && !place) {
      const [x, y] = legs[0][legs[0].length - 1]
      const len = Math.hypot(x - mid[0], y - mid[1]) || 1
      tip = [mid[0] - ((x - mid[0]) / len) * width * 0.3, mid[1] - ((y - mid[1]) / len) * width * 0.3]
    }
    return { width, mid, legs, bridges: [], tip, steps }
  }
  const river = cell.riverTo !== -1 && cell.tier > 0
  if (!river) return plain(place ? centre : bendPoint(i, cx, cy, W))

  const R = riverLayout(world, i, cx, cy, W, TP)
  if (R.spring || R.flows.length > 2) {
    // fallback: bridge wherever a leg crosses the water
    const L = plain(place ? centre : bendPoint(i, cx, cy, W))
    L.bridges = crossings(L.legs, R.flows).map((x) => span(x, R.width))
    return L
  }

  // the areas the river makes, keyed by which side of each stream they lie on
  const key = (p: Pt) => R.flows.map((f) => sideOf(f, p)).join(',')
  // each stream's crossing site (mid-stream) and its across-direction (screen, flat-true unit in ground)
  const bank = R.width / 2 + 5 // hub distance from mid-stream (flat px)
  const off = (p: Pt, d: Pt, s: number): Pt => [p[0] + d[0] * s, p[1] + (d[1] * s) / 2]
  // Where to bridge each stream: mid-stream if it works, else the nearest spot
  // along it where both bridge ends land clear on the two banks of that stream
  // alone (in a narrow fork the middle can be too tight).
  const sites = R.flows.map((f, si) => {
    const at = (k: number) => {
      const prev = f[k - 1], next = f[k + 1]
      const fx = next[0] - prev[0], fy = (next[1] - prev[1]) * 2
      const len = Math.hypot(fx, fy) || 1
      return { at: f[k], across: [-fy / len, fx / len] as Pt, flow: f }
    }
    const mid = Math.floor(f.length / 2)
    for (let d = 0; d < f.length; d++) {
      for (const k of d ? [mid - d, mid + d] : [mid]) {
        if (k < 2 || k > f.length - 3) continue
        const c = at(k)
        const a = off(c.at, c.across, bank), b = off(c.at, c.across, -bank)
        const ka = key(a).split(','), kb = key(b).split(',')
        const differs = ka.map((x, j) => x !== kb[j])
        if (!differs[si] || differs.some((x, j) => x && j !== si)) continue
        // the span crosses this stream only
        if (R.flows.some((g, j) => j !== si && crossings([[a, b]], [g]).length)) continue
        return c
      }
    }
    return at(mid)
  })

  // group the ends (and the place in the middle, if any) by area
  const areas = new Map<string, { pts: Pt[]; ends: { e: Pt; n: Pt }[] }>()
  const area = (k: string) => { let a = areas.get(k); if (!a) { a = { pts: [], ends: [] }; areas.set(k, a) } return a }
  for (const end of ends) area(key(end.e)).ends.push(end)
  if (place) area(key(centre)).pts.push(centre)
  if (areas.size <= 1) {
    // everything on one bank: meet on that bank, clear of the water
    const only = [...areas.values()][0]
    const pts = only ? [...only.ends.map((x) => x.e), ...only.pts] : []
    let mid: Pt = place ? centre : bendPoint(i, cx, cy, W)
    if (!place && pts.length) {
      // a meeting point on that bank, from which every leg stays dry: try points
      // from the ends' average toward the centre, keeping the first that works
      const avg: Pt = [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length]
      const side = key(pts[0])
      for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1]) {
        const m: Pt = [avg[0] + (cx - avg[0]) * f, avg[1] + (cy - avg[1]) * f]
        if (key(m) !== side) continue
        if (ends.every(({ e, n }) => crossings([legTo(m, e, n)], R.flows).length === 0)) { mid = m; break }
      }
    }
    const L = plain(mid)
    L.bridges = crossings(L.legs, R.flows).map((x) => span(x, R.width))
    return L
  }

  const legs: Pt[][] = []
  const bridges: RoadLayout['bridges'] = []
  // a hub on each bank of each stream's crossing site
  const hubAt = (s: number, side: number): Pt => off(sites[s].at, sites[s].across, side * bank)
  const sideAt = (s: number, p: Pt) => sideOf(sites[s].flow, p)
  // which side of stream s a hub on side +1 is (in sideOf terms)
  const plusSide = sites.map((_, s) => sideAt(s, hubAt(s, 1)))
  let main: Pt = centre
  if (R.flows.length === 1) {
    // two banks, one bridge
    const hubs2: Record<string, Pt> = {}
    for (const sd of [1, -1]) hubs2[String(plusSide[0] * sd)] = hubAt(0, sd)
    for (const [k, a] of areas) {
      const h = place && a.pts.length ? centre : hubs2[k]
      if (place && a.pts.length) legs.push(dryLeg(centre, hubs2[k], [0, 0], R.flows, W))
      for (const { e, n } of a.ends) legs.push(dryLeg(h, e, n, R.flows, W))
    }
    bridges.push({ a: hubAt(0, 1), b: hubAt(0, -1) })
    main = place ? centre : hubAt(0, 1)
  } else {
    // a Y: the fork between the streams, and the two outer sides; cross each stream once
    const forkKey = key([(R.flows[0][2][0] + R.flows[1][2][0]) / 2, (R.flows[0][2][1] + R.flows[1][2][1]) / 2])
    const forkSide = forkKey.split(',').map(Number)
    const outerHub = (s: number) => hubAt(s, forkSide[s] === plusSide[s] ? -1 : 1)
    const forkHubAt = (s: number) => hubAt(s, forkSide[s] === plusSide[s] ? 1 : -1)
    // the fork's meeting point: between the two streams, where both fork-side hubs can reach it dry
    const dry = (a: Pt, b: Pt) => crossings([[a, b]], R.flows).length === 0
    let forkHub: Pt = [(forkHubAt(0)[0] + forkHubAt(1)[0]) / 2, (forkHubAt(0)[1] + forkHubAt(1)[1]) / 2]
    if (key(forkHub) !== forkKey || !dry(forkHubAt(0), forkHub) || !dry(forkHubAt(1), forkHub)) {
      for (const t of [0.35, 0.25, 0.45, 0.2, 0.55, 0.15]) {
        const a = R.flows[0][Math.round(t * (R.flows[0].length - 1))], b = R.flows[1][Math.round(t * (R.flows[1].length - 1))]
        const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        if (key(m) === forkKey && dry(forkHubAt(0), m) && dry(forkHubAt(1), m)) { forkHub = m; break }
      }
    }
    const need = new Set<number>() // streams to bridge
    for (const [k, a] of areas) {
      const signs = k.split(',').map(Number)
      let h: Pt
      if (k === forkKey) h = forkHub
      else {
        const s = signs[0] !== forkSide[0] ? 0 : 1 // the stream this outer side lies beyond
        h = outerHub(s)
        need.add(s)
      }
      if (place && a.pts.length) { legs.push(dryLeg(centre, h, [0, 0], R.flows, W)); h = centre }
      for (const { e, n } of a.ends) legs.push(dryLeg(h, e, n, R.flows, W))
    }
    for (const s of need) {
      bridges.push({ a: outerHub(s), b: forkHubAt(s) })
      legs.push(dryLeg(forkHubAt(s), forkHub, [0, 0], R.flows, W))
    }
    main = place ? centre : forkHub
  }
  // safety net: any leg that still crosses the water gets a bridge where it does
  for (const leg of legs) for (const x of crossings([leg], R.flows)) bridges.push(span(x, R.width))
  return { width, mid: main, legs, bridges, tip: null, steps }
}

/** A bank-to-bank span for a crossing found by intersection (the fallback). */
function span(x: Crossing, riverWidth: number): { a: Pt; b: Pt } {
  const sin = Math.abs(x.road[0] * x.river[1] - x.road[1] * x.river[0])
  const half = (riverWidth / 2 + 5) / Math.max(0.45, sin)
  return {
    a: [x.at[0] - x.road[0] * half, x.at[1] - (x.road[1] * half) / 2],
    b: [x.at[0] + x.road[0] * half, x.at[1] + (x.road[1] * half) / 2],
  }
}

export interface Crossing {
  at: Pt
  /** the road's direction there (flat space, unit) */
  road: Pt
  /** the river's direction there (flat space, unit) */
  river: Pt
}

function segX(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number } | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null
}
const flatUnit = (a: Pt, b: Pt): Pt => {
  const x = b[0] - a[0], y = (b[1] - a[1]) * 2, len = Math.hypot(x, y) || 1
  return [x / len, y / len]
}

/** Every point where a road leg crosses a river curve (merged when within a few px). */
export function crossings(legs: Pt[][], flows: Pt[][]): Crossing[] {
  const out: Crossing[] = []
  for (const leg of legs) for (const flow of flows) {
    for (let a = 0; a + 1 < leg.length; a++) for (let b = 0; b + 1 < flow.length; b++) {
      const hit = segX(leg[a], leg[a + 1], flow[b], flow[b + 1])
      if (!hit) continue
      const at: Pt = [leg[a][0] + (leg[a + 1][0] - leg[a][0]) * hit.t, leg[a][1] + (leg[a + 1][1] - leg[a][1]) * hit.t]
      if (out.some((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < 4)) continue
      out.push({ at, road: flatUnit(leg[a], leg[a + 1]), river: flatUnit(flow[b], flow[b + 1]) })
    }
  }
  return out
}

/** For villagers and caravans: the two ends of the bridge a road takes across
 *  the river in hex i (ground coordinates, no height), or null if there's none. */
export function bridgeVia(world: World, i: number, W: number, roads: Set<number>, hubs: Set<number>): Pt[] | null {
  const c = world.cells[i]
  if (c.riverTo === -1 || c.tier === 0 || !roads.has(i)) return null
  const p = hexToPixel(c.col, c.row, W)
  const L = roadLayout(world, i, p.x, p.y, W, 0, roads, hubs)
  if (!L.bridges.length) return null
  const b = L.bridges[0]
  return [b.a, b.b]
}
