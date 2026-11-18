/** Villager routes as timed segments: walk across a hex top, climb a cliff,
 *  hop down one, land, pause. Pure geometry (no Pixi), so it is testable.
 *
 *  Ground points are on the untiered top-face plane (hexToPixel space); a
 *  point at tier t is drawn t * TP px higher. Hexes are flat-top, projected to
 *  W wide x W/2 tall. Rules that keep walkers on solid ground:
 *  - they only cross between hexes at the true shared-edge midpoint (the
 *    midpoint of the two hex centres), so a climb or hop always starts and
 *    ends on the edge, never in mid-air;
 *  - inside a hex they walk straight lines, and both ends are inside the
 *    (convex) hex, so the whole line is too;
 *  - hexes with a building are crossed around the building, via waypoints
 *    near the rim. */

export interface Pt { x: number; y: number }
export interface RouteHex { cell: number; cx: number; cy: number; tier: number; blocked: boolean }

export type Seg =
  | { kind: 'walk'; a: Pt; b: Pt; tier: number; cell: number; cy: number; dur: number }
  | { kind: 'climb'; at: Pt; t0: number; t1: number; cell: number; cy: number; dur: number }
  | { kind: 'hop'; a: Pt; b: Pt; t0: number; t1: number; cellA: number; cellB: number; cyB: number; dur: number }
  | { kind: 'pause'; at: Pt; tier: number; cell: number; cy: number; dur: number; pose: 'land' | 'work' | 'stand' }

export interface Pose {
  x: number
  y: number // feet, on screen (tier applied)
  cell: number // hex whose painter's rank the walker sorts with
  front: boolean // in the front half of that hex (drawn over its trees/houses)
  kind: 'walk' | 'stand' | 'work' | 'climb' | 'hop' | 'land'
  dist: number // ground distance walked so far on this route (drives the step cycle)
}

export const SPEED = 9 // px / s walking
export const CLIMB_SPEED = 4 // px / s up a cliff
export const HOP_TIME = 0.42 // s in the air
export const LAND_TIME = 0.15 // s squashed on landing
export const HOP_HEIGHT = 4 // px of lift before the drop
const HOP_REACH = 0.22 // how far into the lower hex a hop lands (fraction of edge→centre)
const OBSTACLE = 0.27 // building footprint radius, as a fraction of W (in unsquashed space)
const RIM = 0.74 // waypoints sit this far from the centre toward each corner

export function corners(cx: number, cy: number, W: number): Pt[] {
  const hw = W / 2, qw = W / 4, hh = W / 4
  return [
    { x: cx + hw, y: cy }, { x: cx + qw, y: cy + hh }, { x: cx - qw, y: cy + hh },
    { x: cx - hw, y: cy }, { x: cx - qw, y: cy - hh }, { x: cx + qw, y: cy - hh },
  ]
}

/** Is p on or inside the hex top face (with a little slack for rounding)? */
export function insideHex(p: Pt, cx: number, cy: number, W: number, slack = 0.5): boolean {
  const cs = corners(cx, cy, W)
  for (let i = 0; i < 6; i++) {
    const a = cs[i], b = cs[(i + 1) % 6]
    // corners run clockwise on screen (y down): inside is to the right of each edge
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (cross / len < -slack) return false
  }
  return true
}

/** Shortest distance (unsquashed) from the hex centre to segment p-q. */
function clearance(cx: number, cy: number, p: Pt, q: Pt): number {
  const px = p.x - cx, py = (p.y - cy) * 2, qx = q.x - cx, qy = (q.y - cy) * 2
  const dx = qx - px, dy = qy - py
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, -(px * dx + py * dy) / L)) : 0
  return Math.hypot(px + dx * t, py + dy * t)
}

/** Straight across a hex, or around its building via one or two rim waypoints. */
export function crossHex(h: RouteHex, p: Pt, q: Pt, W: number): Pt[] {
  const r = OBSTACLE * W
  const clear = (a: Pt, b: Pt) => clearance(h.cx, h.cy, a, b) >= r
  if (!h.blocked || clear(p, q)) return [p, q]
  const rim = corners(h.cx, h.cy, W).map((c) => ({ x: h.cx + (c.x - h.cx) * RIM, y: h.cy + (c.y - h.cy) * RIM }))
  const len = (pts: Pt[]) => pts.reduce((s, v, i) => (i ? s + Math.hypot(v.x - pts[i - 1].x, v.y - pts[i - 1].y) : 0), 0)
  let best: Pt[] | null = null
  for (const v of rim) {
    if (clear(p, v) && clear(v, q) && (!best || len([p, v, q]) < len(best))) best = [p, v, q]
  }
  if (best) return best
  for (let i = 0; i < 6; i++) {
    for (const j of [(i + 1) % 6, (i + 5) % 6]) {
      const path = [p, rim[i], rim[j], q]
      if (clear(p, rim[i]) && clear(rim[i], rim[j]) && clear(rim[j], q) && (!best || len(path) < len(best))) best = path
    }
  }
  return best ?? [p, q]
}

/** Timed segments from `start` (in hexes[0]) to `end` (in the last hex). */
export function buildRoute(hexes: RouteHex[], start: Pt, end: Pt, W: number, TP: number): Seg[] {
  const segs: Seg[] = []
  const walk = (h: RouteHex, a: Pt, b: Pt) => {
    const pts = crossHex(h, a, b, W)
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      if (d > 0.01) segs.push({ kind: 'walk', a: pts[i - 1], b: pts[i], tier: h.tier, cell: h.cell, cy: h.cy, dur: d / SPEED })
    }
  }
  let cur = start
  for (let i = 0; i + 1 < hexes.length; i++) {
    const h = hexes[i], n = hexes[i + 1]
    const edge = { x: (h.cx + n.cx) / 2, y: (h.cy + n.cy) / 2 }
    walk(h, cur, edge)
    const lower = h.tier <= n.tier ? h : n
    if (n.tier > h.tier) {
      segs.push({ kind: 'climb', at: edge, t0: h.tier, t1: n.tier, cell: lower.cell, cy: lower.cy, dur: ((n.tier - h.tier) * TP) / CLIMB_SPEED })
      cur = edge
    } else if (n.tier < h.tier) {
      const land = { x: edge.x + (n.cx - edge.x) * HOP_REACH, y: edge.y + (n.cy - edge.y) * HOP_REACH }
      segs.push({ kind: 'hop', a: edge, b: land, t0: h.tier, t1: n.tier, cellA: h.cell, cellB: n.cell, cyB: n.cy, dur: HOP_TIME })
      segs.push({ kind: 'pause', at: land, tier: n.tier, cell: n.cell, cy: n.cy, dur: LAND_TIME, pose: 'land' })
      cur = land
    } else {
      cur = edge
    }
  }
  walk(hexes[hexes.length - 1], cur, end)
  return segs
}

export const routeTime = (segs: Seg[]) => segs.reduce((s, g) => s + g.dur, 0)

/** Where the walker is `t` seconds into the route (clamped to the end). */
export function sample(segs: Seg[], t: number, TP: number): Pose {
  let dist = 0
  for (let k = 0; k < segs.length; k++) {
    const g = segs[k]
    const last = k === segs.length - 1
    if (t > g.dur && !last) {
      if (g.kind === 'walk') dist += g.dur * SPEED
      t -= g.dur
      continue
    }
    const u = g.dur ? Math.max(0, Math.min(1, t / g.dur)) : 1
    switch (g.kind) {
      case 'walk': {
        const x = g.a.x + (g.b.x - g.a.x) * u, y = g.a.y + (g.b.y - g.a.y) * u
        return { x, y: y - g.tier * TP, cell: g.cell, front: y > g.cy, kind: 'walk', dist: dist + g.dur * SPEED * u }
      }
      case 'climb':
        return { x: g.at.x, y: g.at.y - (g.t0 + (g.t1 - g.t0) * u) * TP, cell: g.cell, front: g.at.y > g.cy, kind: 'climb', dist: (g.t1 - g.t0) * TP * u }
      case 'hop': {
        const x = g.a.x + (g.b.x - g.a.x) * u, y = g.a.y + (g.b.y - g.a.y) * u
        const lift = 4 * u * (1 - u) * HOP_HEIGHT
        const z = g.t0 + (g.t1 - g.t0) * u * u // falls faster as it goes
        return { x, y: y - z * TP - lift, cell: u < 0.5 ? g.cellA : g.cellB, front: y > g.cyB, kind: 'hop', dist }
      }
      case 'pause':
        return { x: g.at.x, y: g.at.y - g.tier * TP, cell: g.cell, front: g.at.y > g.cy, kind: g.pose, dist }
    }
  }
  return { x: 0, y: 0, cell: -1, front: true, kind: 'stand', dist }
}
