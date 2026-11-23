import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { addDays, weekSeason, weekday } from './calendar'
import { EAT, FOOD, GOOD_LABEL, HEADS, type Good } from './data'
import { CARRY_EACH } from './workers'
import { ORIGINS, TRAVEL_DAYS, influx, originFor, travelFood } from './immigrants'
import { weightOf } from './market'
import { GROW_MORALE, apply, newGame, popCap } from './reducer'
import type { GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
let n = 0

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  return s
}
const worth = (g: Partial<Record<Good, number>>) => Object.entries(g).reduce((a, [k, q]) => a + (FOOD[k as Good]?.value ?? 0) * (q ?? 0), 0)
const tick = (s: GameState, date: string) => apply(s, world, { t: 'tick', id: `k${++n}`, at: `${date}T23:00:00.000Z`, playerId: 'ann', date })
/** A Sunday: the first night after winter (winter is Saturday). */
const sunday = (() => { let d = '2026-11-23'; while (weekday(d) !== 0) d = addDays(d, 1); return d })()

describe('travel food', () => {
  it('is three days of food for everyone, in the foods of where they came from', () => {
    for (const o of ORIGINS) {
      const g = travelFood(20, o)
      const food = Object.fromEntries(Object.entries(g).filter(([k]) => FOOD[k as Good]))
      expect(Math.abs(worth(food) - 20 * EAT * TRAVEL_DAYS)).toBeLessThan(0.5) // goods are kept to 2 places, a load is 10 rations
      for (const k of Object.keys(g)) expect(GOOD_LABEL[k as Good], k).toBeTruthy()
      expect(o.foods.reduce((a, [, share]) => a + share, 0)).toBeCloseTo(1, 5)
    }
  })

  it('is light enough to arrive with: a crowd never carries more than they can', () => {
    for (const o of ORIGINS) expect(weightOf(travelFood(40, o))).toBeLessThan(40 * CARRY_EACH) // each person carries 40 lb, plus pack animals
  })

  it('names where they came from, the same for the same village that day, and varies between villages', () => {
    expect(originFor('v_ann|2026-11-24|winter')).toBe(originFor('v_ann|2026-11-24|winter'))
    expect(new Set(Array.from({ length: 60 }, (_, i) => originFor(`v${i}|d|winter`).id)).size).toBe(ORIGINS.length)
  })
})

describe('how many come', () => {
  it('a fifth of the village again, within the room, and only while morale holds', () => {
    expect(influx(100, 50, 70, 45)).toBe(20)
    expect(influx(100, 8, 70, 45)).toBe(8)
    expect(influx(100, 0.5, 70, 45)).toBe(0)
    expect(influx(100, 50, 30, 45)).toBe(0)
    expect(influx(5, 10, 70, 45)).toBe(1)
  })
})

describe('after the winter', () => {
  it('newcomers settle, with food for three days, and the village is told', () => {
    expect(weekSeason(addDays(sunday, -1))).toBe('winter')
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { grain: 60 }
    v.morale = 80
    const pop = v.population, room = popCap(v) - pop
    expect(room).toBeGreaterThan(1)
    tick(s, sunday)
    expect(v.arrivals).toHaveLength(1)
    const a = v.arrivals![0]
    expect(a).toMatchObject({ kind: 'winter' })
    expect(a.people).toBe(influx(pop, room, 70, GROW_MORALE))
    expect(a.people).toBeGreaterThanOrEqual(1)
    expect(v.population).toBeGreaterThanOrEqual(pop + a.people - 0.01)
    expect(v.population).toBeLessThanOrEqual(popCap(v) + 0.01)
    const food = Object.fromEntries(Object.entries(a.goods).filter(([k]) => FOOD[k as Good]))
    expect(Math.abs(worth(food) - a.people * EAT * TRAVEL_DAYS)).toBeLessThan(0.5) // goods are kept to 2 places, a load is 10 rations
    expect(s.log.some((l) => /newcomers from/.test(l.text))).toBe(true)
    // the food really went into the stores
    expect(Object.keys(a.goods).some((g) => g !== 'grain' && (v.goods[g as Good] ?? 0) > 0)).toBe(true)
    // only once for that winter
    tick(s, sunday)
    expect(v.arrivals).toHaveLength(1)
  })

  it('none come when the homes are full, or the village is miserable, or it is not the morning after winter', () => {
    const full = setup()
    full.villages.v_ann.goods = { grain: 60 }
    full.villages.v_ann.population = popCap(full.villages.v_ann)
    full.villages.v_ann.morale = 80
    tick(full, sunday)
    expect(full.villages.v_ann.arrivals ?? []).toHaveLength(0)
    const sad = setup()
    sad.villages.v_ann.goods = { grain: 60 }
    sad.villages.v_ann.morale = 10
    tick(sad, sunday)
    expect(sad.villages.v_ann.arrivals ?? []).toHaveLength(0)
    const mid = setup()
    mid.villages.v_ann.goods = { grain: 60 }
    mid.villages.v_ann.morale = 80
    tick(mid, addDays(sunday, 2))
    expect(mid.villages.v_ann.arrivals ?? []).toHaveLength(0)
  })

  it('keeps only the latest few notes', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { grain: 99 }
    for (let k = 0; k < 9; k++) {
      v.population = 10; v.morale = 90
      tick(s, addDays(sunday, 7 * k))
    }
    expect(v.arrivals!.length).toBeLessThanOrEqual(6)
  })
})

describe('the one-time update', () => {
  it('welcomes the people it adds as a first group of newcomers, with their food', () => {
    const s = setup()
    s.headsScaled = false
    const v = s.villages.v_ann
    v.population = 6; delete v.city
    apply(s, world, { t: 'resetHour', id: 'r', at: `${sunday}T10:00:00.000Z`, playerId: 'ann', hour: 0 })
    expect(v.population).toBe(6 * HEADS)
    const a = v.arrivals!.find((x) => x.kind === 'update')!
    expect(a.people).toBe(6 * HEADS - 6)
    const food = Object.fromEntries(Object.entries(a.goods).filter(([k]) => FOOD[k as Good]))
    expect(Math.abs(worth(food) - a.people * EAT * TRAVEL_DAYS)).toBeLessThan(0.5) // goods are kept to 2 places, a load is 10 rations
  })
})
