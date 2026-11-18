import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import type { World } from '../world/types'
import { addDays, weekSeason } from './calendar'
import { apply, dayScore, newGame, pendingTicks, validate } from './reducer'
import type { GameEvent, GameState } from './types'

const world: World = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const SUN = '2026-11-15' // a Sunday

let n = 0
function ev<T extends GameEvent['t']>(t: T, playerId: string, at: string, rest: Omit<Extract<GameEvent, { t: T }>, 't' | 'id' | 'at' | 'playerId'>): GameEvent {
  return { t, id: `e${++n}`, at, playerId, ...rest } as unknown as GameEvent
}

function setup(): GameState {
  const s = newGame(world, SUN)
  const port = sites.find((x) => x.role === 'port') ?? sites[0]
  const farm = sites.find((x) => x.role === 'farm') ?? sites[1]
  apply(s, world, ev('join', 'ann', `${SUN}T08:00:00Z`, { name: 'Ann', role: port.role, site: port, resetHour: 0, tz: 0 }))
  apply(s, world, ev('join', 'bob', `${SUN}T08:00:00Z`, { name: 'Bob', role: farm.role, site: farm, resetHour: 0, tz: 0 }))
  return s
}

describe('calendar', () => {
  it('maps weekdays to the weekly seasons', () => {
    expect(weekSeason(SUN)).toBe('spring')
    expect(weekSeason(addDays(SUN, 2))).toBe('summer')
    expect(weekSeason(addDays(SUN, 4))).toBe('autumn')
    expect(weekSeason(addDays(SUN, 6))).toBe('winter')
  })
})

describe('1-2-3 tasks and tokens', () => {
  it('scores 30/20/10 with half credit', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 0, status: 'full' }))
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 1, status: 'half' }))
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 3, status: 'full' }))
    expect(dayScore(s.players.ann.days[SUN])).toBe(30 + 10 + 10)
    expect(s.players.ann.tokens.map((t) => [t.size, t.strength])).toEqual([['big', 1], ['medium', 0.5], ['small', 1]])
  })
  it('upgrading half to full tops up the same token; downgrading removes it', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 2, status: 'half' }))
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 2, status: 'full' }))
    expect(s.players.ann.tokens).toHaveLength(1)
    expect(s.players.ann.tokens[0].strength).toBe(1)
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 2, status: 'none' }))
    expect(s.players.ann.tokens).toHaveLength(0)
  })
})

describe('actions', () => {
  it('small tokens cannot build; medium can, and half tokens half-build', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    const v = s.villages[s.players.ann.villageId]
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 3, status: 'full' }))
    const small = s.players.ann.tokens[0]
    const target = { col: v.col + 1, row: v.row }
    expect(validate(s, world, ev('act', 'ann', at, { tokenId: small.id, action: 'build', building: 'house', ...target }))).toMatch(/medium/)
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 1, status: 'half' }))
    const med = s.players.ann.tokens.find((t) => t.size === 'medium')!
    apply(s, world, ev('act', 'ann', at, { tokenId: med.id, action: 'build', building: 'house', ...target }))
    expect(v.buildings[0].progress).toBe(0.5)
    expect(v.goods.timber).toBe(8 - 2)
  })
  it('scouting reveals land and spends the token', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    const p = s.players.ann
    const before = p.revealed.length
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 4, status: 'full' }))
    const v = s.villages[p.villageId]
    apply(s, world, ev('act', 'ann', at, { tokenId: p.tokens[0].id, action: 'scout', col: v.col + 4, row: v.row }))
    expect(p.revealed.length).toBeGreaterThan(before)
    expect(p.tokens).toHaveLength(0)
  })
  it('caravans deliver goods once they arrive', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 1, status: 'full' }))
    const tok = s.players.ann.tokens[0]
    apply(s, world, ev('act', 'ann', at, { tokenId: tok.id, action: 'caravan', col: 0, row: 0, to: 'v_bob', goods: { berries: 3 } }))
    expect(s.caravans).toHaveLength(1)
    const bobBefore = s.villages.v_bob.goods.berries ?? 0
    apply(s, world, ev('habit', 'bob', `${SUN}T23:00:00Z`, { date: SUN, habitId: 'nope', done: true })) // any later event
    expect(s.caravans).toHaveLength(0)
    expect(s.villages.v_bob.goods.berries).toBe(bobBefore + 3)
  })
  it('is deterministic: replaying the same log gives the same state', () => {
    const run = () => {
      n = 0
      const s = setup()
      for (let d = 0; d < 10; d++) {
        const date = addDays(SUN, d)
        apply(s, world, ev('progress', 'ann', `${date}T12:00:00Z`, { date, slot: 0, status: d % 3 ? 'full' : 'half' }))
        apply(s, world, ev('tick', 'ann', `${addDays(date, 1)}T00:05:00Z`, { date }))
      }
      return JSON.stringify(s)
    }
    expect(run()).toBe(run())
  })
})

describe('nightly tick', () => {
  it('a 100-point day out-produces a 0-point day', () => {
    const play = (full: boolean) => {
      const s = setup()
      const v = s.villages.v_bob
      v.buildings.push({ id: 'b', type: 'garden', col: v.col, row: v.row + 1, progress: 1 })
      const date = addDays(SUN, 3) // Wednesday, summer
      for (let i = 0; i < 6; i++) if (full) apply(s, world, ev('progress', 'bob', `${date}T12:00:00Z`, { date, slot: i, status: 'full' }))
      v.goods = {}
      apply(s, world, ev('tick', 'bob', `${addDays(date, 1)}T00:05:00Z`, { date }))
      return s.villages.v_bob
    }
    const good = play(true), bad = play(false)
    expect(good.goods.grain ?? 0).toBeGreaterThan((bad.goods.grain ?? 0) * 3)
  })
  it('Saturday is winter: no production, and empty stores hurt', () => {
    const s = setup()
    const v = s.villages.v_bob
    v.buildings.push({ id: 'b', type: 'field', col: v.col, row: v.row + 1, progress: 1 })
    v.goods = {}
    const sat = addDays(SUN, 6)
    const m = v.morale
    apply(s, world, ev('tick', 'bob', `${addDays(sat, 1)}T00:05:00Z`, { date: sat }))
    expect(v.goods.grain ?? 0).toBe(0)
    expect(v.morale).toBeLessThan(m)
  })
  it('seven perfect habit days unlock a new slot; a miss never removes one', () => {
    const s = setup()
    const p = s.players.ann
    apply(s, world, ev('habitAdd', 'ann', `${SUN}T07:00:00Z`, { habit: { id: 'water', name: 'Water', effect: 'rain' } }))
    expect(validate(s, world, ev('habitAdd', 'ann', `${SUN}T07:00:00Z`, { habit: { id: 'walk', name: 'Walk', effect: 'movement' } }))).toMatch(/slot/)
    for (let d = 0; d < 7; d++) {
      const date = addDays(SUN, d)
      apply(s, world, ev('habit', 'ann', `${date}T12:00:00Z`, { date, habitId: 'water', done: true }))
      apply(s, world, ev('tick', 'ann', `${addDays(date, 1)}T00:05:00Z`, { date }))
    }
    expect(p.habitSlots).toBe(2)
    const miss = addDays(SUN, 8) // a Monday
    apply(s, world, ev('tick', 'ann', `${addDays(miss, 1)}T00:05:00Z`, { date: addDays(SUN, 7) }))
    apply(s, world, ev('tick', 'ann', `${addDays(miss, 1)}T00:05:00Z`, { date: miss }))
    expect(p.habitSlots).toBe(2)
    expect(p.perfectStreak).toBe(0)
  })
  it('unspent tokens expire one day later', () => {
    const s = setup()
    apply(s, world, ev('progress', 'ann', `${SUN}T12:00:00Z`, { date: SUN, slot: 5, status: 'full' }))
    apply(s, world, ev('tick', 'ann', `${addDays(SUN, 1)}T00:05:00Z`, { date: SUN }))
    expect(s.players.ann.tokens).toHaveLength(1)
    apply(s, world, ev('tick', 'ann', `${addDays(SUN, 2)}T00:05:00Z`, { date: addDays(SUN, 1) }))
    expect(s.players.ann.tokens).toHaveLength(0)
  })
  it('pendingTicks lists missed days but never today', () => {
    const s = setup()
    expect(pendingTicks(s.players.ann, addDays(SUN, 3), SUN)).toEqual([SUN, addDays(SUN, 1), addDays(SUN, 2)])
  })
})
