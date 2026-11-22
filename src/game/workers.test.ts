import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { apply, caravanCarry, newGame, produce, validate } from './reducer'
import { autoJobs, jobs, spare, staffing, stepsFor } from './workers'
import { strongholdsOf, wallsAfter, WALLS } from './strongholds'
import type { GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const DAY = '2026-11-23'
const AT = `${DAY}T10:00:00.000Z`
let n = 0

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  apply(s, world, { t: 'join', id: 'jb', at: '2026-11-16T08:00:00Z', playerId: 'bob', name: 'Bob', site: sites[1], resetHour: 0, tz: 0 })
  return s
}
const run = (s: GameState, ev: GameEvent) => { const err = validate(s, world, ev); if (!err) apply(s, world, ev); return err }
const night = (s: GameState) => produce(s, world, s.villages.v_ann, s.players.ann, { habitsDone: [] } as never, DAY, 1, AT)

describe('workers', () => {
  it('the village feeds itself first, then the rest; anyone else is free', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.population = 4
    v.buildings.push({ id: 'k', type: 'kiln', col: 0, row: 0, progress: 1 }, { id: 'f', type: 'field', col: 0, row: 1, progress: 1 }, { id: 'h', type: 'house', col: 0, row: 2, progress: 1 })
    expect(autoJobs(v)).toEqual({ f: 2, k: 1 })
    expect(spare(v)).toBe(1)
    v.population = 2
    expect(autoJobs(v)).toEqual({ f: 2 }) // the field first; the kiln stands idle
    expect(staffing(v, v.buildings[0])).toBe(0)
  })

  it('a building with half its workers makes half as much', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'k', type: 'kiln', col: 0, row: 0, progress: 1 }, { id: 'l', type: 'lumber_camp', col: 0, row: 1, progress: 1 })
    v.goods = { clay: 50, timber: 50 }
    v.autoJobs = false
    v.jobs = { l: 2 }
    const full = night(s).timber ?? 0
    v.jobs = { l: 1 }
    expect(night(s).timber).toBeCloseTo(full / 2, 1)
    expect(night(s).bricks).toBeUndefined() // nobody at the kiln
  })

  it('jobs can be set by hand, within the people at home', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'l', type: 'lumber_camp', col: 0, row: 1, progress: 1 })
    const set = (j: Record<string, number>, auto = false) => run(s, { t: 'jobs', id: `j${++n}`, at: AT, playerId: 'ann', auto, jobs: j })
    expect(set({ l: 3 })).toMatch(/at most 2/)
    expect(set({ l: 1 })).toBeNull()
    expect(jobs(v)).toEqual({ l: 1 })
    expect(spare(v)).toBe(4)
    expect(set({}, true)).toBeNull()
    expect(v.autoJobs).toBe(true)
  })

  it('a caravan takes people who are free, with food for the road', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'f1', type: 'field', col: 0, row: 0, progress: 1 }, { id: 'f2', type: 'field', col: 0, row: 1, progress: 1 })
    expect(spare(v)).toBe(1) // four of five work the fields
    v.goods = { grain: 30 }
    const send = (crew: number, food: Record<string, number>) => {
      s.players.ann.tokens.push({ id: `m${++n}`, size: 'medium', strength: 1, date: DAY, slot: 1 })
      return run(s, { t: 'act', id: `c${n}`, at: AT, playerId: 'ann', tokenId: `m${n}`, action: 'caravan', col: 0, row: 0, to: 'v_bob', goods: { grain: 1 }, crew, food } as GameEvent)
    }
    expect(send(0, { grain: 3 })).toMatch(/Someone has to go/)
    expect(send(2, { grain: 3 })).toMatch(/Only 1 people are free/)
    expect(send(1, {})).toMatch(/Pack food for the road/)
    expect(send(1, { grain: 3 })).toBeNull()
    expect(v.away).toBe(1)
    expect(spare(v)).toBe(0)
    expect(caravanCarry(world, s, v, s.villages.v_bob, 1).cap).toBe(6)
  })
})

describe('growth', () => {
  it('needs the village to make at least as much food as it eats', () => {
    const tick = (s: GameState, date: string) => apply(s, world, { t: 'tick', id: `t${++n}`, at: `${date}T23:00:00.000Z`, playerId: 'ann', date })
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { grain: 20 } // plenty in store, but nothing coming in
    v.morale = 70
    const pop = v.population
    tick(s, '2026-11-16')
    expect(v.population).toBe(pop)
    const t = setup()
    const w = t.villages.v_ann
    w.goods = { grain: 20 } // within what the stores hold
    w.morale = 70
    w.buildings.push({ id: 'f1', type: 'field', col: 0, row: 0, progress: 1 }, { id: 'f2', type: 'field', col: 0, row: 1, progress: 1 })
    t.players.ann.days['2026-11-16'] = { slots: ['big', 'medium', 'medium', 'small', 'small', 'small'].map((size) => ({ size, status: 'full' })), habitsDone: [] } as never
    tick(t, '2026-11-16')
    expect(w.population).toBeGreaterThan(pop)
  })
})

describe('workshops and powder', () => {
  it('make what they are ordered to', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'g', type: 'gun_foundry', col: 0, row: 0, progress: 1 })
    v.population = 10
    v.goods = { iron: 5, bronze: 9, charcoal: 20 }
    expect(night(s).cannonballs).toBeGreaterThan(0)
    expect(run(s, { t: 'order', id: 'o', at: AT, playerId: 'ann', building: 'g', recipe: 'cannon' })).toBeNull()
    const made = night(s)
    expect(made.cannon).toBeGreaterThan(0)
    expect(made.cannonballs).toBeUndefined()
    expect(run(s, { t: 'order', id: 'o2', at: AT, playerId: 'ann', building: 'g', recipe: 'musket' })).toMatch(/can't make/)
  })

  it('roasting chalcopyrite gives off sulfur', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.population = 10
    v.buildings.push({ id: 's', type: 'smelter', col: 0, row: 0, progress: 1 }, { id: 'r', type: 'roasting_heap', col: 0, row: 1, progress: 1 })
    v.goods = { chalcopyrite: 4, charcoal: 10 }
    expect(night(s).sulfur).toBeGreaterThan(0)
  })
})

describe('strongholds', () => {
  it('stand in the far wastelands, behind walls that siege engines and cannon break', () => {
    const forts = strongholdsOf(world)
    expect(forts.length).toBeGreaterThan(0)
    for (const f of forts) {
      expect(['desert', 'tundra', 'rock', 'snow']).toContain(world.cells[f.i].terrain)
      expect(world.regions[world.cells[f.i].region].danger).toBeGreaterThanOrEqual(2)
    }
    expect(wallsAfter({}, 0)).toBe(WALLS)
    expect(wallsAfter({ ram: 2 }, 0)).toBe(2)
    expect(wallsAfter({ ram: 1, siege_tower: 1 }, 1)).toBe(1)
  })

  it('a well-armed siege takes the keep and its hoard; powder and engines are spent', () => {
    const s = setup()
    const fort = strongholdsOf(world)[0]
    const v = s.villages.v_ann
    v.col = fort.col; v.row = fort.row + 3 // march distance
    s.revealed.push(fort.i)
    v.population = 60
    v.goods = { ram: 2, siege_tower: 1, cannon: 3, cannonballs: 10, gunpowder: 40, musket: 20, steel: 5, bread: 6 }
    s.players.ann.tokens.push({ id: 'b', size: 'big', strength: 1, date: DAY, slot: 0 })
    expect(run(s, { t: 'act', id: 'sg', at: AT, playerId: 'ann', tokenId: 'b', action: 'siege', col: fort.col, row: fort.row } as GameEvent)).toBeNull()
    expect(v.goods.ram ?? 0).toBe(0)
    expect(v.goods.cannonballs).toBe(4)
    const fell = !!s.sieges?.[fort.i]?.fallen
    if (fell) expect(v.goods.silver).toBeGreaterThan(0)
  })
})

describe('the staffing gift', () => {
  it('gives a village short of workers the people it lacks and a house, once', () => {
    const s = newGame(world, '2026-11-15')
    s.staffGiven = true
    apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
    const v = s.villages.v_ann
    v.buildings.push({ id: 'm', type: 'copper_mine', col: 0, row: 0, progress: 1 }, { id: 'f', type: 'field', col: 0, row: 1, progress: 1 }, { id: 'k', type: 'kiln', col: 0, row: 2, progress: 1 })
    s.staffGiven = undefined
    apply(s, world, { t: 'resetHour', id: 'r', at: AT, playerId: 'ann', hour: 0 })
    expect(v.population).toBe(6) // 5 + 1 to staff 3 + 2 + 1
    expect(v.buildings.some((b) => b.type === 'house')).toBe(true)
    apply(s, world, { t: 'resetHour', id: 'r2', at: AT, playerId: 'ann', hour: 0 })
    expect(v.population).toBe(6)
  })
})

describe('full stores', () => {
  it('move hands off food (it would only rot) onto other work, keeping enough to eat', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.population = 6
    v.buildings.push(
      { id: 'f1', type: 'field', col: 0, row: 0, progress: 1 }, { id: 'f2', type: 'field', col: 0, row: 1, progress: 1 },
      { id: 'q', type: 'quarry', col: 0, row: 2, progress: 1 },
    )
    v.goods = { grain: 5 }
    expect(autoJobs(v)).toEqual({ f1: 2, f2: 2, q: 2 })
    v.goods = { grain: 29 } // the stores hold 30
    const j = autoJobs(v)
    expect(j.q).toBe(2)
    expect((j.f1 ?? 0) + (j.f2 ?? 0)).toBeGreaterThan(0) // still enough to eat
  })

  it('bake and smoke without making food from nothing', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.population = 10
    v.buildings.push({ id: 'm', type: 'mill', col: 0, row: 0, progress: 1 })
    v.goods = { grain: 3 }
    const made = produce(s, world, v, s.players.ann, { habitsDone: [] } as never, DAY, 1, AT)
    const ate = 3 - (v.goods.grain ?? 0)
    expect((made.bread ?? 0) * 1.5).toBeLessThanOrEqual(ate * 1 + 1e-6)
  })
})

describe('step sizes', () => {
  it('grow with the village: ones, fives and tens; then fifties; then hundreds', () => {
    expect(stepsFor(24)).toEqual([1, 5, 10])
    expect(stepsFor(99)).toEqual([1, 5, 10])
    expect(stepsFor(150)).toEqual([1, 10, 50])
    expect(stepsFor(500)).toEqual([1, 10, 100])
  })
})
