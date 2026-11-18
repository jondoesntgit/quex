import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { apply, cellIndex, newGame } from '../game/reducer'
import { PERIOD, traderPose, tripAt, tripLength } from './traders'

const W = 64, TP = 8
const world = generateWorld('test-seed')
function withVillage() {
  const s = newGame(world, '2026-11-15')
  const site = world.regions[world.startRegion].sites[0]
  apply(s, world, { t: 'join', id: 'j', at: '2026-11-15T08:00:00Z', playerId: 'a', name: 'A', role: site.role, site, resetHour: 0, tz: 0 })
  return s
}
const T0 = Date.parse('2026-11-18T12:00:00Z')

describe('merchant caravans', () => {
  it('nothing comes through an empty world', () => {
    expect(tripAt(world, newGame(world, '2026-11-15'), T0, W)).toBeNull()
  })
  it('the same caravan for everyone at the same time', () => {
    const s = withVillage()
    for (let k = 0; k < 10; k++) {
      const now = T0 + k * PERIOD
      expect(JSON.stringify(tripAt(world, s, now, W))).toBe(JSON.stringify(tripAt(world, s, now + 1234, W)))
    }
  })
  it('come through most windows, stop at the village, stay on land and finish in time', () => {
    const s = withVillage()
    const v = s.villages.v_a
    const home = cellIndex(world, v.col, v.row)
    let trips = 0
    for (let k = 0; k < 40; k++) {
      const trip = tripAt(world, s, T0 + k * PERIOD, W)
      if (!trip) continue
      trips++
      expect(trip.points.every((p) => world.cells[p.cell].tier > 0)).toBe(true)
      expect(trip.points[trip.stopAt].cell).toBe(home)
      expect(trip.start - trip.window * PERIOD + tripLength(trip)).toBeLessThan(PERIOD)
      // stopped (trading) for a while at the village
      const before = trip.points.slice(0, trip.stopAt + 1)
      let t = 0
      for (let i = 0; i + 1 < before.length; i++) t += Math.hypot(before[i + 1].x - before[i].x, before[i + 1].y - before[i].y) / 7
      const a = traderPose(trip, (t + 1) * 1000, TP), b = traderPose(trip, (t + 8) * 1000, TP)
      expect(a.moving).toBe(false)
      expect(b.x).toBe(a.x)
      expect(traderPose(trip, tripLength(trip) + 1000, TP).done).toBe(true)
    }
    expect(trips).toBeGreaterThan(20)
  })
})
