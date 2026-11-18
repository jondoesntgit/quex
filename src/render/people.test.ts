import { describe, expect, it } from 'vitest'
import { buildRoute, corners, insideHex, routeTime, sample, type RouteHex } from './walk'
import { hexToPixel } from '../world/hex'

const W = 64, TP = 8
// a column of hexes (col 0, rows 0..3) with chosen tiers and buildings
function hexes(tiers: number[], blocked: number[] = []): RouteHex[] {
  return tiers.map((tier, row) => {
    const p = hexToPixel(0, row, W)
    return { cell: row, cx: p.x, cy: p.y, tier, blocked: blocked.includes(row) }
  })
}
const centre = (h: RouteHex) => ({ x: h.cx, y: h.cy })

function poses(hs: RouteHex[], start = centre(hs[0]), end = centre(hs[hs.length - 1])) {
  const route = buildRoute(hs, start, end, W, TP)
  const out = []
  for (let t = 0; t <= routeTime(route) + 1e-9; t += 0.02) out.push(sample(route, t, TP))
  return { route, out }
}

/** The ground point under a pose (tier removed), using the hex it sorts with. */
function onSolidGround(hs: RouteHex[], q: ReturnType<typeof sample>) {
  const h = hs.find((x) => x.cell === q.cell)!
  return insideHex({ x: q.x, y: q.y + h.tier * TP }, h.cx, h.cy, W, 1)
}

describe('villager routes', () => {
  it('walk only on the hex tops they belong to (never in mid-air)', () => {
    const hs = hexes([1, 1, 3, 1]) // up a 2-tier cliff, then down again
    const { out } = poses(hs)
    for (const q of out.filter((q) => q.kind === 'walk')) expect(onSolidGround(hs, q)).toBe(true)
  })
  it('start a hop exactly at the cliff edge, not past it', () => {
    const hs = hexes([3, 1])
    const { route } = poses(hs)
    const hop = route.find((g) => g.kind === 'hop')!
    expect(hop.kind).toBe('hop')
    if (hop.kind !== 'hop') return
    const edge = { x: (hs[0].cx + hs[1].cx) / 2, y: (hs[0].cy + hs[1].cy) / 2 }
    expect(hop.a).toEqual(edge)
    // the take-off point is on the boundary of the high hex and the landing inside the low one
    expect(insideHex(hop.a, hs[0].cx, hs[0].cy, W)).toBe(true)
    expect(insideHex(hop.b, hs[1].cx, hs[1].cy, W)).toBe(true)
    // the walk before the hop ends at that same edge point
    const before = route[route.indexOf(hop) - 1]
    expect(before.kind === 'walk' && before.b).toEqual(edge)
  })
  it('hop: lift, fall the full height, then land', () => {
    const hs = hexes([3, 1])
    const { out } = poses(hs)
    const hop = out.filter((q) => q.kind === 'hop')
    expect(Math.min(...hop.map((q) => q.y))).toBeLessThan(hop[0].y)
    expect(hop.at(-1)!.y - hop[0].y).toBeGreaterThan(2 * TP * 0.8)
    expect(out.some((q) => q.kind === 'land')).toBe(true)
  })
  it('climb straight up the cliff face at the edge, hand over hand', () => {
    const [high, low] = hexes([3, 1]) // row 0 (back) is 2 tiers above row 1 (front)
    const { out } = poses([low, high]) // from the front, up the visible cliff face
    const climb = out.filter((q) => q.kind === 'climb')
    expect(climb.length).toBeGreaterThan(5)
    expect(new Set(climb.map((q) => Math.round(q.x))).size).toBe(1)
    for (let k = 1; k < climb.length; k++) expect(climb[k].y).toBeLessThanOrEqual(climb[k - 1].y)
    expect(climb[climb.length - 1].y - climb[0].y).toBeLessThan(-2 * TP * 0.8)
    // a climber on the visible face sorts with the lower hex in front of it
    expect(climb.every((q) => q.cell === low.cell)).toBe(true)
  })
  it('walk around a building instead of through it', () => {
    // straight down a column through a built-up middle hex
    const hs = hexes([1, 1, 1], [1])
    const { out } = poses(hs)
    const mid = hs[1]
    const through = out.filter((q) => q.cell === 1).map((q) => Math.hypot(q.x - mid.cx, (q.y + TP - mid.cy) * 2))
    expect(Math.min(...through)).toBeGreaterThan(W * 0.25)
    for (const q of out.filter((q) => q.kind === 'walk')) expect(onSolidGround(hs, q)).toBe(true)
  })
  it('flat routes are all walking and end where they were sent', () => {
    const hs = hexes([2, 2, 2])
    const end = { x: hs[2].cx + 5, y: hs[2].cy + 3 }
    const { out } = poses(hs, centre(hs[0]), end)
    expect(out.every((q) => q.kind === 'walk')).toBe(true)
    expect(Math.round(out.at(-1)!.x)).toBe(Math.round(end.x))
  })
  it('hex corners helper is consistent with insideHex', () => {
    const c = corners(100, 100, W)
    for (const p of c) expect(insideHex(p, 100, 100, W)).toBe(true)
    expect(insideHex({ x: 100 + W, y: 100 }, 100, 100, W)).toBe(false)
  })
})
