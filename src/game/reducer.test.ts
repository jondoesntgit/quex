import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import type { World } from '../world/types'
import { addDays, weekSeason } from './calendar'
import { apply, cellIndex, dayScore, inTerritory, landAt, newGame, pendingTicks, validate } from './reducer'
import { spiral } from '../world/hex'
import { hasTrees, isOpen, isVillageSite, cellLand } from '../world/land'
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

/** first hex in ann's territory matching a test */
function findIn(s: GameState, pred: (i: number) => boolean) {
  const v = s.villages.v_ann
  return spiral(v, 2).find((o) => o.col >= 0 && o.row >= 0 && (o.col !== v.col || o.row !== v.row) && inTerritory(v, o.col, o.row) && pred(cellIndex(world, o.col, o.row)))
}

describe('land: clear ground, trees, mountains', () => {
  it('every generated village site is clear, open ground', () => {
    for (const seed of ['test-seed', 'a', 'b', 'quex-season-1']) {
      const w = generateWorld(seed)
      for (const rg of w.regions) for (const site of rg.sites) {
        expect(isVillageSite(cellLand(w.cells[site.row * w.width + site.col]))).toBe(true)
      }
    }
  })
  it('trees must be felled before building; felling gives timber and opens the hex', () => {
    const s = newGame(world, SUN)
    // a forestry site has woods nearby
    const site = sites.find((x) => x.role === 'forestry')!
    apply(s, world, ev('join', 'ann', `${SUN}T08:00:00Z`, { name: 'Ann', role: 'forestry', site, resetHour: 0, tz: 0 }))
    const at = `${SUN}T10:00:00Z`
    const t = findIn(s, (i) => world.cells[i].terrain === 'forest')!
    expect(t).toBeTruthy()
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 1, status: 'full' }))
    const med = s.players.ann.tokens[0]
    expect(validate(s, world, ev('act', 'ann', at, { tokenId: med.id, action: 'build', building: 'house', ...t }))).toMatch(/[Ff]ell/)
    // woodland buildings are fine among the trees
    expect(validate(s, world, ev('act', 'ann', at, { tokenId: med.id, action: 'build', building: 'lumber_camp', ...t }))).toBeNull()
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 3, status: 'full' }))
    const small = s.players.ann.tokens.find((x) => x.size === 'small')!
    const timber = s.villages.v_ann.goods.timber!
    apply(s, world, ev('act', 'ann', at, { tokenId: small.id, action: 'clear', ...t }))
    expect(s.villages.v_ann.goods.timber).toBe(timber + 3)
    const land = landAt(world, s, cellIndex(world, t.col, t.row))
    expect(hasTrees(land)).toBe(false)
    expect(land.terrain).toBe('grass')
    expect(validate(s, world, ev('act', 'ann', at, { tokenId: med.id, action: 'build', building: 'house', ...t }))).toBeNull()
  })
  it('mountains take mines and quarries, not houses', () => {
    const s = newGame(world, SUN)
    const site = sites.find((x) => x.role === 'mining')!
    apply(s, world, ev('join', 'ann', `${SUN}T08:00:00Z`, { name: 'Ann', role: 'mining', site, resetHour: 0, tz: 0 }))
    const at = `${SUN}T10:00:00Z`
    const m = findIn(s, (i) => world.cells[i].terrain === 'rock')
    if (!m) return // this seed's mining site has no mountain in reach
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 1, status: 'full' }))
    const med = s.players.ann.tokens[0]
    expect(validate(s, world, ev('act', 'ann', at, { tokenId: med.id, action: 'build', building: 'house', ...m }))).toMatch(/steep/)
    expect(validate(s, world, ev('act', 'ann', at, { tokenId: med.id, action: 'build', building: 'quarry', ...m }))).toBeNull()
  })
})

describe('actions', () => {
  it('small tokens cannot build; medium can, and half tokens half-build', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    const v = s.villages[s.players.ann.villageId]
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 3, status: 'full' }))
    const small = s.players.ann.tokens[0]
    const target = spiral(v, 2).find((o) => (o.col !== v.col || o.row !== v.row) && isOpen(landAt(world, s, cellIndex(world, o.col, o.row))))!
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
    const before = s.revealed.length
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 4, status: 'full' }))
    const v = s.villages[p.villageId]
    apply(s, world, ev('act', 'ann', at, { tokenId: p.tokens[0].id, action: 'scout', col: v.col + 4, row: v.row }))
    expect(s.revealed.length).toBeGreaterThan(before)
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

describe('founding and shared fog', () => {
  it('refuses villages that would crowd a neighbour, allows them further out', async () => {
    const { distance } = await import('../world/hex')
    const { foundingProblem, VILLAGE_RADIUS, FOUNDING_GAP } = await import('./reducer')
    const s = setup()
    const ann = s.villages.v_ann
    const limit = VILLAGE_RADIUS * 2 + FOUNDING_GAP
    const land = world.cells.filter((c) => c.tier > 0)
    const near = land.find((c) => distance(c, ann) === limit)!
    expect(foundingProblem(s, world, near)).toMatch(/Too close/)
    const far = land.find((c) => isVillageSite(cellLand(c)) && Object.values(s.villages).every((v) => distance(c, v) > limit + 3) &&
      !s.lairs.some((l) => l.col === c.col && l.row === c.row))!
    expect(foundingProblem(s, world, far)).toBeNull()
    expect(validate(s, world, ev('join', 'cat', `${SUN}T09:00:00Z`, { name: 'Cat', role: 'farm', site: near, resetHour: 0, tz: 0 }))).toMatch(/Too close/)
  })
  it('refuses mountains, woods and swamp, so settling never erases them', async () => {
    const { foundingProblem } = await import('./reducer')
    const s = setup()
    const { distance } = await import('../world/hex')
    const clear = (c: { col: number; row: number }) => Object.values(s.villages).every((v) => distance(c, v) > 10)
    const mountain = world.cells.find((c) => (c.terrain === 'rock' || c.terrain === 'snow') && clear(c))!
    const woods = world.cells.find((c) => c.tier > 0 && hasTrees(cellLand(c)) && clear(c))!
    expect(foundingProblem(s, world, mountain)).toMatch(/steep/i)
    expect(foundingProblem(s, world, woods)).toMatch(/woods/i)
  })
  it('refuses water', async () => {
    const { foundingProblem } = await import('./reducer')
    const s = setup()
    const sea = world.cells.find((c) => c.tier === 0)!
    expect(foundingProblem(s, world, sea)).toMatch(/land/)
  })
  it('one player scouting reveals the map for everyone', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    const v = s.villages.v_ann
    const before = s.revealed.length
    apply(s, world, ev('progress', 'ann', at, { date: SUN, slot: 4, status: 'full' }))
    apply(s, world, ev('act', 'ann', at, { tokenId: s.players.ann.tokens[0].id, action: 'scout', col: v.col + 4, row: v.row }))
    expect(s.revealed.length).toBeGreaterThan(before)
    // Bob can now scout outward from the edge of what Ann found
    const frontier = world.cells.find((c) => !s.revealed.includes(cellIndex(world, c.col, c.row)) &&
      spiral(c, 1).some((o) => s.revealed.includes(cellIndex(world, o.col, o.row))) && c.col > v.col + 4)!
    apply(s, world, ev('progress', 'bob', at, { date: SUN, slot: 4, status: 'full' }))
    expect(validate(s, world, { t: 'act', id: 'x', at, playerId: 'bob', tokenId: s.players.bob.tokens[0].id, action: 'scout', col: frontier.col, row: frontier.row })).toBeNull()
  })
})

describe('abandoning a village', () => {
  it('removes the player and village, frees the land, keeps the map', async () => {
    const { foundingProblem } = await import('./reducer')
    const s = setup()
    const ann = s.villages.v_ann
    const seen = s.revealed.length
    apply(s, world, ev('progress', 'bob', `${SUN}T10:00:00Z`, { date: SUN, slot: 1, status: 'full' }))
    apply(s, world, ev('abandon', 'ann', `${SUN}T11:00:00Z`, {}))
    expect(s.players.ann).toBeUndefined()
    expect(s.villages.v_ann).toBeUndefined()
    expect(s.revealed.length).toBe(seen)
    expect(foundingProblem(s, world, ann)).toBeNull()
    // events from the abandoned player are ignored afterwards
    apply(s, world, ev('progress', 'ann', `${SUN}T12:00:00Z`, { date: SUN, slot: 0, status: 'full' }))
    expect(s.players.ann).toBeUndefined()
    expect(s.players.bob).toBeDefined()
  })
  it('drops caravans to or from the abandoned village', () => {
    const s = setup()
    const at = `${SUN}T10:00:00Z`
    apply(s, world, ev('progress', 'bob', at, { date: SUN, slot: 1, status: 'full' }))
    const tok = s.players.bob.tokens[0]
    const bob = s.villages.v_bob
    apply(s, world, ev('act', 'bob', at, { tokenId: tok.id, action: 'caravan', col: bob.col, row: bob.row, to: 'v_ann', goods: { grain: 2 } }))
    expect(s.caravans).toHaveLength(1)
    apply(s, world, ev('abandon', 'ann', `${SUN}T10:01:00Z`, {}))
    expect(s.caravans).toHaveLength(0)
  })
})

describe('role fit stars', () => {
  it('rate what is within reach, not the centre hex', async () => {
    const { roleScores } = await import('./sites')
    const s = newGame(world, SUN)
    // a coastal open site: trade scores from the coast around it even though the centre is dry land
    const coastal = world.cells.find((c) => isVillageSite(cellLand(c)) &&
      spiral(c, 1).some((o) => world.cells[cellIndex(world, o.col, o.row)]?.tier === 0))!
    expect(roleScores(world, s, coastal).port.score).toBeGreaterThan(0)
    // an inland site far from the sea has no trade score
    const inland = world.cells.find((c) => isVillageSite(cellLand(c)) &&
      spiral(c, 4).every((o) => (world.cells[cellIndex(world, o.col, o.row)]?.tier ?? 0) > 0))!
    expect(roleScores(world, s, inland).port.score).toBe(0)
  })
  it('give most sites a few good options', async () => {
    const { roleFits } = await import('./sites')
    const { foundingProblem } = await import('./reducer')
    const s = newGame(world, SUN)
    const sites = world.cells.filter((c) => !foundingProblem(s, world, c)).filter((_, k) => k % 7 === 0)
    const starred = sites.map((c) => Object.values(roleFits(world, s, c)).filter((f) => f.fit !== 'ok').length)
    const avg = starred.reduce((a, b) => a + b, 0) / starred.length
    expect(avg).toBeGreaterThan(1.8)
    expect(avg).toBeLessThan(4)
  })
})


describe('renaming', () => {
  it('renames the player and a village still named after them', () => {
    const s = setup()
    const before = s.villages.v_ann.name
    expect(before).toMatch(/^Ann’s /)
    apply(s, world, ev('rename', 'ann', `${SUN}T09:00:00Z`, { name: '  Jonathan ' }))
    expect(s.players.ann.name).toBe('Jonathan')
    expect(s.villages.v_ann.name).toBe(before.replace('Ann', 'Jonathan'))
  })
  it('refuses empty or overlong names', () => {
    const s = setup()
    expect(validate(s, world, ev('rename', 'ann', `${SUN}T09:00:00Z`, { name: '  ' }))).toBeTruthy()
    expect(validate(s, world, ev('rename', 'ann', `${SUN}T09:00:00Z`, { name: 'x'.repeat(21) }))).toBeTruthy()
  })
})
