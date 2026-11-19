import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { hexToPixel, neighbours } from '../world/hex'
import { crossings, riverLayout, roadEdgePoint, roadLayout, type Pt } from './waterways'

const W = 64, TP = 8

/** Every combination of road-carrying neighbours for a hex (up to 63), plus "this hex is a place". */
function* configs(world: ReturnType<typeof generateWorld>, i: number) {
  const c = world.cells[i]
  const ns = neighbours(c.col, c.row)
    .filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && world.cells[nr * world.width + nc].tier > 0)
    .map(([nc, nr]) => nr * world.width + nc)
  for (let mask = 1; mask < 1 << ns.length; mask++) {
    const roads = new Set([i, ...ns.filter((_, k) => mask & (1 << k))])
    yield { roads, hubs: new Set<number>() }
    if (mask % 7 === 0) yield { roads, hubs: new Set([i]) }
  }
}

const crossesWater = (a: Pt, b: Pt, flows: Pt[][]) => crossings([[a, b]], flows).length > 0

describe('rivers, roads and bridges', () => {
  for (const seed of ['quex-sandbox', 'quex-season-1']) {
    const world = generateWorld(seed)
    const rivers = world.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.riverTo !== -1 && c.tier > 0)

    it(`${seed}: every planned bridge spans the water, and no other road leg wades through it`, () => {
      let bridged = 0, planned = 0
      for (const { c, i } of rivers) {
        const p = hexToPixel(c.col, c.row, W)
        const cx = p.x, cy = p.y - c.tier * TP
        const R = riverLayout(world, i, cx, cy, W, TP)
        const plannedHex = !R.spring && R.flows.length <= 2
        for (const { roads, hubs } of configs(world, i)) {
          const L = roadLayout(world, i, cx, cy, W, TP, roads, hubs)
          for (const br of L.bridges) {
            expect(crossesWater(br.a, br.b, R.flows)).toBe(true)
            bridged++
          }
          if (plannedHex) {
            planned++
            for (const leg of L.legs) expect(crossings([leg], R.flows)).toEqual([])
          }
        }
      }
      expect(bridged).toBeGreaterThan(100)
      expect(planned).toBeGreaterThan(1000)
    })

    it(`${seed}: a road and a river never share an edge crossing, and both hexes agree where the road crosses`, () => {
      for (const { c, i } of rivers) {
        const j = c.riverTo
        if (world.cells[j].tier === 0) continue
        const a = roadEdgePoint(world, i, j, W, 0), b = roadEdgePoint(world, j, i, W, 0)
        expect(a).toEqual(b) // same point from either side (at ground level)
        const ci = hexToPixel(c.col, c.row, W), cj = hexToPixel(world.cells[j].col, world.cells[j].row, W)
        const mid: Pt = [(ci.x + cj.x) / 2, (ci.y + cj.y) / 2]
        expect(Math.hypot(a[0] - mid[0], a[1] - mid[1])).toBeGreaterThan(W * 0.08) // slid off the river's crossing
      }
    })
  }
})
