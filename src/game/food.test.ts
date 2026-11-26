import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { neighbours } from '../world/hex'
import { weekSeason } from './calendar'
import { BUILDINGS, FOOD, HEADS, TOOLS, producesIn, toolMult, type BuildingId } from './data'
import { gameLeft } from './deposits'
import { FOOD_FROM, apply, foodStock, newGame, produce, tonight, validate } from './reducer'
import { LEAN_DAYS, age, lamb, mutton, pastureCap, slaughter } from './herds'
import { WORKERS, autoJobs, needOf } from './workers'
import type { Building, GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
let n = 0
const SUN = '2026-11-22' // spring (Sunday, Monday), summer (Tuesday, Wednesday), autumn (Thursday, Friday), winter (Saturday)
const at = (date: string) => `${date}T10:00:00.000Z`

/** A world with one village, founded before the food update (so nothing is added to it). */
function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  s.foodUpdate = true
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  return s
}
const day = (k: number) => new Date(Date.parse(SUN + 'T00:00:00Z') + k * 86_400_000).toISOString().slice(0, 10)
const make = (s: GameState, date: string, prod = 1) => produce(s, world, s.villages.v_ann, s.players.ann, { habitsDone: [] } as never, date, prod, at(date))
const tick = (s: GameState, date: string) => apply(s, world, { t: 'tick', id: `t${++n}`, at: `${date}T23:00:00.000Z`, playerId: 'ann', date })

/** Rations a crew of a full building makes in a day at full strength, for each person in it. */
const perPerson = (id: BuildingId, season: 'spring' | 'summer' | 'autumn') => {
  const g = producesIn(BUILDINGS[id], season) ?? {}
  const rations = Object.entries(g).reduce((a, [x, k]) => a + (k ?? 0) * (FOOD[x as keyof typeof FOOD]?.value ?? 0), 0)
  return rations / (WORKERS[id]! * HEADS)
}

describe('what a worker makes', () => {
  it('gardens about 3 rations a day, whatever the season, and orchards 2', () => {
    for (const s of ['spring', 'summer', 'autumn'] as const) {
      expect(perPerson('garden', s)).toBeCloseTo(3, 0)
      expect(perPerson('orchard', s)).toBeCloseTo(2, 0)
    }
  })
  it('fields 7 at harvest, irrigation 10, fishing 3, hunting 4', () => {
    expect(perPerson('field', 'autumn')).toBeCloseTo(7, 0)
    expect(perPerson('irrigation', 'autumn')).toBeCloseTo(10, 0)
    expect(perPerson('shore_fishery', 'summer')).toBeCloseTo(3, 0)
    expect(perPerson('hunting_lodge', 'summer')).toBeCloseTo(4, 0)
  })
  it('half the village on the harvest for two days feeds all of it for a week', () => {
    // 50% of the people x 2 days x 7 rations each = 7 rations a head
    expect(0.5 * 2 * perPerson('field', 'autumn')).toBeGreaterThanOrEqual(7)
  })
  it('the garden grows a different thing each season', () => {
    const g = BUILDINGS.garden
    expect(producesIn(g, 'spring')).toEqual({ worts: 2.53 })
    expect(producesIn(g, 'summer')).toEqual({ dried_peas: 1.5 })
    expect(producesIn(g, 'autumn')).toEqual({ turnips: 1.38 })
    // vegetables only, and as many rations as before (when it was 8 of grain besides)
    const rations = (x: Partial<Record<string, number>>) => Object.entries(x).reduce((a, [k, n]) => a + (n ?? 0) * (FOOD[k as keyof typeof FOOD]?.value ?? 0), 0)
    expect(rations(producesIn(g, 'spring')!)).toBeCloseTo(8 + 1.2 * 6, 0)
    expect(rations(producesIn(g, 'summer')!)).toBeCloseTo(8 + 0.7 * 10, 0)
    expect(rations(producesIn(g, 'autumn')!)).toBeCloseTo(8 + 0.65 * 11, 0)
    expect(FOOD.worts?.keeps).toBe(false)
    expect(FOOD.dried_peas?.keeps).toBe(true)
    expect(FOOD.turnips?.keeps).toBe(true)
  })
})

describe('fields: sow in spring, reap in autumn', () => {
  it('need half a crew in spring, none in summer, all of it in autumn', () => {
    const f = { type: 'field' as const }
    expect([needOf(f, 'spring'), needOf(f, 'summer'), needOf(f, 'autumn')]).toEqual([HEADS, 0, 2 * HEADS])
    expect(needOf(f)).toBe(2 * HEADS)
  })

  it('make nothing but the sowing in spring and summer, and all their grain in autumn', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'f', type: 'field', col: 0, row: 0, progress: 1, sown: 0 })
    expect(make(s, day(0)).grain).toBeUndefined()
    expect(make(s, day(2)).grain).toBeUndefined()
    expect(v.buildings[0].sown).toBe(0.5) // the first day of sowing
    make(s, day(1))
    expect(v.buildings[0].sown).toBe(1)
    const full = make(s, day(4)).grain ?? 0
    expect(full).toBeGreaterThan(5)
    // the crop was never sown: a quarter comes up on its own
    v.buildings[0].sown = 0
    expect(make(s, day(5)).grain ?? 0).toBeCloseTo(full * 0.25, 1)
  })

  it('are sown from scratch each year, and a field never sown still counts for the first one', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'f', type: 'field', col: 0, row: 0, progress: 1 })
    expect(make(s, day(4)).grain ?? 0).toBeGreaterThan(5) // unset: counted as sown
    tick(s, day(6)) // the winter night
    expect(v.buildings[0].sown).toBe(0)
  })

  it('take their crew from the other work in autumn', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.population = 4 * HEADS
    v.buildings.push({ id: 'k', type: 'kiln', col: 0, row: 0, progress: 1 }, { id: 'f', type: 'field', col: 0, row: 1, progress: 1 })
    expect(autoJobs(v, 'spring')).toEqual({ f: HEADS, k: HEADS }) // half a crew sows; the rest keep the kiln
    expect(autoJobs(v, 'summer')).toEqual({ k: HEADS }) // nothing to do in the fields
    expect(autoJobs(v, 'autumn')).toEqual({ f: 2 * HEADS, k: HEADS }) // the harvest comes first (the kiln has all it needs)
  })
})

describe('hunting', () => {
  it('takes a share of the game around the lodge, never all of it', () => {
    const s = setup()
    const v = s.villages.v_ann
    const i = world.cells.findIndex((c) => c.tier > 0 && ['forest'].includes(c.terrain) && c.resource !== 'game')
    const c = world.cells[i]
    v.buildings.push({ id: 'l', type: 'hunting_lodge', col: c.col, row: c.row, progress: 1 })
    const first = make(s, day(2)).game ?? 0
    expect(first).toBeGreaterThan(0)
    let left = gameLeft(world, s, i, day(2))
    for (let d = 0; d < 40; d++) make(s, day(2)) // the same day, over and over: no time to recover
    left = gameLeft(world, s, i, day(2))
    expect(left).toBeGreaterThan(0)
  })
})

describe('tools', () => {
  it('multiply what a building makes, best one counting, and cost goods', () => {
    expect(toolMult(undefined, 'hunting_lodge')).toBe(1)
    expect(toolMult(['bows'], 'hunting_lodge')).toBe(1.5)
    expect(toolMult(['bows', 'muskets'], 'hunting_lodge')).toBe(2)
    expect(toolMult(['fishing_spears', 'boats'], 'shore_fishery')).toBeCloseTo(10 / 3)
    expect(toolMult(['scythes'], 'garden')).toBe(1)
    expect(Object.keys(TOOLS)).toHaveLength(5)
  })

  it('are made once, with the goods, and in order', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { timber: 5, copper: 1, planks: 6, cloth: 2 }
    const equip = (tool: string): GameEvent => ({ t: 'equip', id: `e${++n}`, at: at(SUN), playerId: 'ann', tool })
    expect(validate(s, world, equip('boats'))).toMatch(/Build a Docks first|fishing spears first/)
    expect(validate(s, world, equip('fishing_spears'))).toBeNull()
    apply(s, world, equip('fishing_spears'))
    expect(v.tools).toEqual(['fishing_spears'])
    expect(v.goods.timber).toBe(3)
    expect(validate(s, world, equip('fishing_spears'))).toMatch(/already/)
    expect(validate(s, world, equip('scythes'))).toMatch(/Build a Wheat field first/)
  })

  it('make a fishery bring in more', () => {
    const s = setup()
    const v = s.villages.v_ann
    const i = world.cells.findIndex((c) => c.tier > 0 && c.terrain === 'grass')
    const c = world.cells[i]
    v.buildings.push({ id: 'w', type: 'shore_fishery', col: c.col, row: c.row, progress: 1 })
    const plain = make(s, day(2)).fish ?? 0
    v.tools = ['fishing_spears']
    expect(make(s, day(2)).fish ?? 0).toBeCloseTo(plain * (5 / 3), 1)
  })
})

describe('sheep', () => {
  const pen = (s: GameState): Building => {
    const i = world.cells.findIndex((c, k) => c.tier > 0 && c.terrain === 'grass' && neighbours(c.col, c.row).filter(([a, b]) => world.cells[b * world.width + a]?.terrain === 'grass').length >= 4 && k > 0)
    const c = world.cells[i]
    const b: Building = { id: 'p', type: 'pen', col: c.col, row: c.row, progress: 1 }
    s.villages.v_ann.buildings.push(b)
    return b
  }

  it("tonight's breakdown adds up to the forecast, and says what scales the pen", () => {
    const s = setup()
    const b = pen(s)
    const v = s.villages.v_ann
    v.goods = { ...v.goods, salt: 0.01, grain: 20 }
    v.autoJobs = false
    v.jobs = { [b.id]: 1 }
    const t = tonight(s, world, s.players.ann, new Date('2026-11-24T12:00:00Z'))
    for (const r of t.rows) {
      const sum = t.sources.reduce((a, x) => a + (x.delta[r.good] ?? 0), 0)
      expect(sum).toBeCloseTo(r.net[0], 1)
    }
    const src = t.sources.find((x) => x.label === 'Sheep pen')!
    const labels = src.factors.map((f) => f.label).join(' | ')
    expect(labels).toMatch(/Workers: 1 of 2/)
    expect(labels).toMatch(/6 sheep/)
    expect(labels).toMatch(/score \d+\/100/)
    expect(labels).toMatch(/Salt for cheese/)
    expect(src.makes).toContain('cheese')
    expect(t.sources.some((x) => x.label === 'Eaten')).toBe(true)
  })

  it('start with six, are slaughtered oldest first, and get a year older each winter', () => {
    const s = setup()
    const b = pen(s)
    // a shepherd to every four sheep: two for six, five for twenty
    expect(needOf(b)).toBe(2)
    expect(needOf({ ...b, herd: [0, 10, 10, 0, 0] })).toBe(HEADS)
    expect(slaughter(b, 2)).toBe(2)
    expect(b.herd).toEqual([0, 3, 1, 0, 0])
    age(b)
    expect(b.herd).toEqual([0, 0, 3, 1, 0])
    age(b); age(b); age(b)
    expect(b.herd).toEqual([0, 0, 0, 0, 4])
  })

  it('lamb by half, but only as far as the pasture goes', () => {
    const s = setup()
    const b = pen(s)
    expect(lamb(b, 100)).toBe(3)
    expect(lamb(b, 2)).toBe(2)
    expect(b.herd!.reduce((a, x) => a + x, 0)).toBe(11)
    expect(lamb(b, 0)).toBe(0)
  })

  it('feed on the pasture within a hex of the pen or a well', () => {
    const s = setup()
    const v = s.villages.v_ann
    expect(pastureCap(world, s, v, () => true)).toBe(0) // no pen
    const b = pen(s)
    const cap = pastureCap(world, s, v, () => true)
    expect(cap).toBeGreaterThan(20)
    // a well beside it opens more ground
    const w = neighbours(b.col, b.row).map(([c, r]) => r * world.width + c).find((i) => world.cells[i]?.terrain === 'grass')!
    const far = neighbours(world.cells[w].col, world.cells[w].row).map(([c, r]) => r * world.width + c).map((i) => world.cells[i]).find((c) => c && c.col !== b.col)
    s.wells = far ? { [far.row * world.width + far.col]: true } : {}
    expect(pastureCap(world, s, v, () => true)).toBeGreaterThanOrEqual(cap)
  })

  it('cure the autumn cull with the salt there is, and the rest is fresh', () => {
    expect(mutton(2, 100)).toEqual({ goods: { cured_meat: 24 }, salted: 24 })
    const m = mutton(2, 10)
    expect(m.goods.cured_meat).toBe(10)
    expect(m.goods.game).toBeCloseTo(1.4)
  })

  it('lamb on the first night of spring, and are slaughtered when the stores run low', () => {
    const s = setup()
    const v = s.villages.v_ann
    const b = pen(s)
    v.goods = { grain: 30 }
    tick(s, SUN)
    expect(b.herd!.reduce((a, x) => a + x, 0)).toBeGreaterThan(6)
    // nothing in store: slaughter, oldest first
    const before = b.herd!.reduce((a, x) => a + x, 0)
    v.goods = {}
    tick(s, day(1))
    expect(foodStock(v)).toBeGreaterThanOrEqual(0)
    expect(b.herd!.reduce((a, x) => a + x, 0)).toBeLessThan(before)
    expect(LEAN_DAYS).toBe(3)
  })

  it('eat grain through the winter, and are slaughtered if there is none', () => {
    const s = setup()
    const v = s.villages.v_ann
    const b = pen(s)
    v.goods = { grain: 5 }
    tick(s, day(6))
    expect(v.goods.grain).toBeLessThan(5)
    expect(b.herd!.reduce((a, x) => a + x, 0)).toBe(6)
    const t = setup()
    const c = pen(t)
    t.villages.v_ann.goods = {}
    tick(t, day(6))
    expect(c.herd!.reduce((a, x) => a + x, 0)).toBeLessThan(6)
  })

  it('make cheese with a pinch of salt a ration, and wool', () => {
    const s = setup()
    const v = s.villages.v_ann
    pen(s)
    v.goods = { salt: 100 }
    const made = make(s, day(2))
    expect(made.cheese ?? 0).toBeGreaterThan(0)
    expect(made.wool ?? 0).toBeGreaterThan(0)
    expect(v.goods.salt).toBeCloseTo(100 - (made.cheese ?? 0), 1)
    v.goods = {}
    const dry = make(s, day(2))
    expect(dry.cheese).toBeUndefined()
    expect(dry.milk ?? 0).toBeGreaterThan(0) // no salt: fresh milk instead, which spoils
  })
})

describe('the food update', () => {
  it('hands every village standing up to 100 loads of grain, as far as its stores hold, and says so', () => {
    const s = setup()
    s.foodUpdate = false
    const v = s.villages.v_ann
    v.goods = { grain: 2 }
    apply(s, world, { t: 'tick', id: 'tu', at: `${FOOD_FROM.slice(0, 10)}T12:00:00.000Z`, playerId: 'ann', date: '2026-11-23' })
    expect(s.foodUpdate).toBe(true)
    // the stores hold 30 loads: room for 28 more
    expect(v.goods.grain ?? 0).toBeGreaterThan(20)
    expect(foodStock(v)).toBeLessThanOrEqual(300 + 1)
    expect(v.arrivals?.some((a) => a.kind === 'food')).toBe(true)
    expect(v.buildings.some((b) => b.type === 'field')).toBe(true)
    expect(s.log.some((l) => /food rules have changed/.test(l.text))).toBe(true)
  })

  it('is given once, and new villages start with a field and a week of grain', () => {
    const s = newGame(world, '2026-11-15')
    apply(s, world, { t: 'join', id: 'jz', at: `${FOOD_FROM.slice(0, 10)}T12:00:00Z`, playerId: 'zed', name: 'Zed', site: sites[0], resetHour: 0, tz: 0 })
    const v = s.villages.v_zed
    expect(v.buildings.filter((b) => b.type === 'field')).toHaveLength(1)
    expect(v.goods.grain).toBe(18)
    expect(v.arrivals).toBeUndefined()
    expect(weekSeason(SUN)).toBe('spring')
  })
})
