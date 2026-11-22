import { describe, expect, it } from 'vitest'
import { poisson, spots } from './rocks'

describe('rocks on the ground', () => {
  it('come in Poisson numbers: the right average, and plenty of variety', () => {
    const counts = Array.from({ length: 4000 }, (_, i) => poisson(i, 2))
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    expect(mean).toBeGreaterThan(1.9)
    expect(mean).toBeLessThan(2.1)
    // P(0) = e^-2 ≈ 13.5%: some hexes have none
    const zeros = counts.filter((n) => n === 0).length / counts.length
    expect(zeros).toBeGreaterThan(0.11)
    expect(zeros).toBeLessThan(0.16)
    expect(poisson(7, 2)).toBe(poisson(7, 2))
  })

  it('stay where they are as others are taken', () => {
    const s = { busy: false, roads: [], wooded: false }
    const five = spots(42, 5, 64, s, 4)
    expect(spots(42, 3, 64, s, 4)).toEqual(five.slice(0, 3))
  })

  it('keep off roads, and to the front of whatever stands on the hex', () => {
    const road: [number, number] = [24, 0] // a road from the middle to the right-hand edge
    for (let seed = 0; seed < 50; seed++) {
      for (const [x, y] of spots(seed, 6, 64, { busy: false, roads: [road], wooded: false }, 4)) {
        expect(x > 0 && Math.abs(y * 2) < 64 * 0.07).toBe(false)
      }
      for (const [, y] of spots(seed, 6, 64, { busy: true, roads: [], wooded: false }, 4)) expect(y).toBeGreaterThanOrEqual(64 * 0.06)
    }
  })
})
