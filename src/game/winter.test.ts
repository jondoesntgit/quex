import { describe, expect, it } from 'vitest'
import { winterPrep } from './winter'
import { HEADS } from './data'
import type { Village } from './types'

const village = (over: Partial<Village> = {}): Village => ({
  id: 'v', playerId: 'p', name: 'Testford', role: 'farm', col: 0, row: 0, population: 6 * HEADS, morale: 60,
  goods: {}, buildings: [], outposts: [], roads: [], planted: [], cleared: [], winterForecast: 'tight', ...over,
})
const item = (w: ReturnType<typeof winterPrep>, id: string) => w.items.find((x) => x.id === id)!

describe('winter prep', () => {
  it('counts the days to Saturday', () => {
    expect(winterPrep(village(), '2026-11-18', 0).days).toBe(3) // Wednesday
    expect(winterPrep(village(), '2026-11-20', 0).days).toBe(1) // Friday
    expect(winterPrep(village(), '2026-11-21', 0).days).toBe(0) // Saturday
  })

  it('asks for 1.5x the winter meal in food that keeps, and fresh food does not count', () => {
    const w = winterPrep(village({ goods: { fish: 20, grain: 2 } }), '2026-11-19', 0)
    expect(w.need).toBe(3) // 6 villagers x 0.5
    expect(w.target).toBe(4.5)
    expect(w.keeps).toBe(2)
    expect(item(w, 'food').ok).toBe(false)
    expect(item(w, 'food').impact).toMatch(/morale drops by 12/)
    const stocked = winterPrep(village({ goods: { grain: 3, cheese: 1 } }), '2026-11-19', 0)
    expect(item(stocked, 'food').ok).toBe(true) // 3 + 1.5
    expect(item(stocked, 'food').todo).toEqual([])
    expect(stocked.forecast).toBe('stocked')
    expect(w.forecast).toBe('hungry')
  })

  it("shows what a full day's harvest adds, higher in autumn and nothing in winter", () => {
    const farm = village({ buildings: [{ id: 'b', type: 'field', col: 0, row: 0, progress: 1 }] })
    const thu = winterPrep(farm, '2026-11-19', 30) // autumn
    const tue = winterPrep(farm, '2026-11-17', 30) // summer
    expect(thu.tonight.full).toBeGreaterThan(thu.tonight.now)
    expect(thu.tonight.full).toBeGreaterThan(tue.tonight.full)
    expect(winterPrep(farm, '2026-11-21', 100).tonight.full).toBe(0)
    expect(item(thu, 'food').todo[0].text).toMatch(/Finish today's tasks/)
  })

  it('suggests a granary when the harvest would not fit, and a palisade when the stores are thin', () => {
    const full = winterPrep(village({ goods: { grain: 29 }, buildings: [{ id: 'b', type: 'field', col: 0, row: 0, progress: 1 }] }), '2026-11-19', 0)
    expect(item(full, 'storage').ok).toBe(false)
    expect(item(full, 'storage').todo[0].text).toMatch(/Granary/)
    const thin = winterPrep(village(), '2026-11-19', 0)
    expect(item(thin, 'defence').ok).toBe(false)
    expect(item(thin, 'defence').todo[0].text).toMatch(/Palisade/)
  })

  it('names the foods in store and suggests only ones not already there', () => {
    const w = winterPrep(village({ goods: { grain: 5, berries: 2 } }), '2026-11-19', 0)
    const v = item(w, 'variety')
    expect(v.ok).toBe(false)
    expect(v.status).toMatch(/2 kinds of food in store: grain and berries\. That's enough to keep spirits even/)
    expect(v.todo[0].text).toBe('Gather fish or game on your land (small tasks) for a third kind of food.')
    expect(item(winterPrep(village({ goods: { grain: 5, berries: 2, fish: 1 } }), '2026-11-19', 0), 'variety').ok).toBe(true)
  })
})
