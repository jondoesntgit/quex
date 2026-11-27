import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { hexToPixel, neighbours } from '../world/hex'
import { RAMP_ANGLE, RAMP_WIDTH, rampBetween, rampKey, rampsAround } from './ramps'
import { buildRoute, insideHex, routeTime, sample, type RampWay, type RouteHex } from './walk'

const W = 64, TP = 8
const world = generateWorld('quex-sandbox')
/** every edge between two land hexes of different heights */
const cliffs: [number, number][] = []
world.cells.forEach((c, i) => {
  if (!c.tier) return
  for (const [nc, nr] of neighbours(c.col, c.row)) {
    if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
    const j = nr * world.width + nc
    if (j > i && world.cells[j].tier && world.cells[j].tier !== c.tier) cliffs.push([i, j])
  }
})
const centre = (i: number) => { const c = world.cells[i]; return hexToPixel(c.col, c.row, W) }

describe('ramps where a road meets a cliff', () => {
  it('stand on the lower hex against the shared edge, the same seen from either side', () => {
    expect(cliffs.length).toBeGreaterThan(1000)
    for (const [i, j] of cliffs) {
      const r = rampBetween(world, i, j, W, TP)!
      expect(rampBetween(world, j, i, W, TP)).toEqual(r)
      expect(world.cells[r.lower].tier).toBeLessThan(world.cells[r.upper].tier)
      const lo = centre(r.lower), up = centre(r.upper)
      // the top end is on the edge: as far from both centres
      const d = (p: { x: number; y: number }) => Math.hypot(r.edge[0] - p.x, (r.edge[1] - p.y) * Math.sqrt(3))
      expect(Math.abs(d(lo) - d(up))).toBeLessThan(0.5)
      // foot and top stand on the lower hex's top
      for (const q of r.way) expect(insideHex({ x: q.p[0], y: q.p[1] }, lo.x, lo.y, W)).toBe(true)
    }
  })
  it(`climb at ${RAMP_ANGLE} degrees where the edge allows, steeper for big drops, and are wide enough for two`, () => {
    for (const [i, j] of cliffs) {
      const r = rampBetween(world, i, j, W, TP)!
      if (!r.short && r.drop <= 2) expect(r.angle).toBeCloseTo(RAMP_ANGLE, -0.5)
      expect(r.angle).toBeGreaterThanOrEqual(RAMP_ANGLE - 1)
      expect(r.switchback).toBe(!r.short && r.drop >= 2)
    }
    // 6 px a villager: 1.5-2 of them
    expect(RAMP_WIDTH * (W / 2)).toBeGreaterThanOrEqual(9)
    expect(RAMP_WIDTH * (W / 2)).toBeLessThanOrEqual(12)
  })
  it('have a sprite for every edge, drop and surface', () => {
    for (const [i, j] of cliffs.slice(0, 500)) {
      expect(rampKey(rampBetween(world, i, j, W, TP)!, false)).toMatch(/^r_d_[0-5]_[1-4][ab]?f?$/)
    }
  })
  it('are walked up and down, with no climbing or hopping, and no jump in height', () => {
    let n = 0
    for (const [i, j] of cliffs.slice(0, 200)) {
      const roads = new Set([i, j])
      const hex = (k: number): RouteHex => {
        const c = world.cells[k], p = centre(k)
        const ways = new Map<number, RampWay>()
        for (const [o, r] of rampsAround(world, k, W, TP, roads, new Set())) {
          const lp = centre(r.lower)
          ways.set(o, { way: r.way.map((w) => ({ p: { x: w.p[0], y: w.p[1] }, t: world.cells[r.lower].tier + w.h * r.drop })), lower: r.lower, lowerCy: lp.y })
        }
        return { cell: k, cx: p.x, cy: p.y, tier: c.tier, blocked: false, road: true, ramps: ways }
      }
      for (const [a, b] of [[i, j], [j, i]]) {
        const hs = [hex(a), hex(b)]
        const route = buildRoute(hs, { x: hs[0].cx, y: hs[0].cy }, { x: hs[1].cx, y: hs[1].cy }, W, TP)
        expect(route.some((g) => g.kind === 'climb' || g.kind === 'hop')).toBe(false)
        expect(route.some((g) => g.kind === 'ramp')).toBe(true)
        let last = sample(route, 0, TP)
        for (let t = 0.05; t <= routeTime(route); t += 0.05) {
          const q = sample(route, t, TP)
          expect(Math.hypot(q.x - last.x, q.y - last.y)).toBeLessThan(2) // a step at a time, never a jump
          last = q
        }
        n++
      }
    }
    expect(n).toBe(400)
  })
})
