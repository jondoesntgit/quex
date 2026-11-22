import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { addDays } from './calendar'
import { ORES } from './data'
import { type Odds, DEPLETION_FROM, GAME_REGROW, dungeonUnder, gameLeft, gameMax, hunt, leftAt, levels, mineDig, mixAt, reserveAt, stonyness } from './deposits'
import { COPPER_PER_SILVER, VALUE } from './market'
import { apply, cellIndex, inTerritory, newGame, produce, validate } from './reducer'
import type { GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const AFTER = new Date(Date.parse(DEPLETION_FROM) + 3_600_000).toISOString()
const DAY = AFTER.slice(0, 10)

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  const site = sites[0]
  apply(s, world, { t: 'join', id: 'j1', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', role: site.role, site, resetHour: 0, tz: 0 })
  return s
}
let n = 0
/** a whole small action for ann, then spend it */
function act(s: GameState, action: 'gather' | 'pick' | 'deepen' | 'expedition', col: number, row: number, at = AFTER, size: 'small' | 'medium' | 'big' = 'small'): string | null {
  const id = `t${++n}`
  s.players.ann.tokens.push({ id, size, strength: 1, date: DAY, slot: 0 })
  const ev = { t: 'act', id: `a${n}`, at, playerId: 'ann', tokenId: id, action, col, row } as GameEvent
  const err = validate(s, world, ev)
  apply(s, world, ev)
  return err
}
function own(s: GameState, test: (i: number) => boolean) {
  const v = s.villages[s.players.ann.villageId]
  const i = world.cells.findIndex((c, i) => c.tier > 0 && inTerritory(v, c.col, c.row) && !(c.col === v.col && c.row === v.row) && test(i))
  return i < 0 ? null : world.cells[i]
}

describe('deposits', () => {
  it('every hex of land has some stone; water has none', () => {
    const land = world.cells.findIndex((c) => c.tier > 0)
    const sea = world.cells.findIndex((c) => c.tier === 0)
    expect(reserveAt(world, land)?.ore).toBe('stone')
    expect(reserveAt(world, sea)).toBeNull()
  })

  it('clearing stone picks a hex clean quickly, then only a quarry reaches the rest', () => {
    const s = setup()
    const c = own(s, (i) => reserveAt(world, i)?.ore === 'stone' && world.cells[i].resource !== 'stone')!
    const i = cellIndex(world, c.col, c.row)
    expect(stonyness(world, s, i)).toBe(1)
    let tries = 0
    while (leftAt(world, s, i)!.surface >= 1 && tries++ < 20) expect(act(s, 'pick', c.col, c.row)).toBeNull()
    expect(tries).toBeLessThanOrEqual(4)
    expect(stonyness(world, s, i)).toBe(0)
    expect(act(s, 'pick', c.col, c.row)).toMatch(/picked clean/i)
    expect(leftAt(world, s, i)!.deep).toBeGreaterThan(0)
  })

  it('hand-gathering ore stops at the surface; a mine digs the rest', () => {
    const s = setup()
    const v = s.villages[s.players.ann.villageId]
    const c = own(s, (i) => ['copper', 'iron', 'tin'].includes(world.cells[i].resource ?? ''))
    if (!c) return // no ore near this start
    const i = cellIndex(world, c.col, c.row)
    const before = leftAt(world, s, i)!
    for (let k = 0; k < 15 && leftAt(world, s, i)!.surface >= 1; k++) act(s, 'gather', c.col, c.row)
    expect(leftAt(world, s, i)!.surface).toBeLessThan(1)
    expect(leftAt(world, s, i)!.deep).toBe(before.deep)
    expect(act(s, 'gather', c.col, c.row)).toMatch(/worked out/i)
    expect(v).toBeTruthy()
  })

  it('nothing is counted before the cutoff, so old logs replay as before', () => {
    const s = setup()
    const c = own(s, (i) => world.cells[i].resource === 'grain' || world.cells[i].resource === 'stone')
    if (!c) return
    act(s, 'gather', c.col, c.row, '2026-11-20T10:00:00.000Z')
    expect(s.dug?.[cellIndex(world, c.col, c.row)] ?? 0).toBe(0)
  })

  it('game is hunted out, then comes back slowly', () => {
    const s = setup()
    const i = world.cells.findIndex((_, j) => gameMax(world, j) > 0)
    const max = gameMax(world, i)
    expect(hunt(world, s, i, DAY, 100)).toBe(max)
    expect(gameLeft(world, s, i, DAY)).toBe(0)
    expect(gameLeft(world, s, i, addDays(DAY, 3))).toBe(3 * GAME_REGROW)
    expect(gameLeft(world, s, i, addDays(DAY, 100))).toBe(max)
  })

  it('silver lies only in mountains, beyond the starting region', () => {
    const silver = world.cells.filter((c) => c.resource === 'silver')
    expect(silver.length).toBeGreaterThan(0)
    for (const c of silver) {
      expect(['mountain', 'mountain_snow']).toContain(c.feature)
      expect(c.region).not.toBe(world.startRegion)
    }
  })

  it('silver is slow to make, and silver costs ten copper', () => {
    expect(ORES.silver_ore!.yield).toBeLessThan(0.2)
    expect(VALUE.silver).toBe(VALUE.copper * COPPER_PER_SILVER)
  })
})

describe('mines, level by level', () => {
  const copperHex = world.cells.findIndex((c) => c.resource === 'copper')
  const ironHex = world.cells.findIndex((c) => c.resource === 'iron')
  function withMine(type: 'copper_mine' | 'iron_mine', i: number, depth = 1) {
    const s = setup()
    const v = s.villages[s.players.ann.villageId]
    v.buildings.push({ id: 'm', type, col: world.cells[i].col, row: world.cells[i].row, progress: 1, depth })
    return { s, v }
  }

  it('dig the surface first, then level 1, and stop where the shaft ends', () => {
    const { s } = withMine('copper_mine', copperHex)
    const r = reserveAt(world, copperHex)!
    const first = mineDig(world, s, copperHex, 1, r.surface)
    expect(Object.keys(first)).toEqual(['copper_ore']) // malachite at the surface
    const odds = { expected: {}, rolled: {} } as Odds
    const second = mineDig(world, s, copperHex, 1, 5, '2026-11-23', odds)
    expect(second.chalcopyrite).toBeGreaterThan(0) // level 1: some chalcopyrite
    expect(odds.expected.silver_ore).toBeGreaterThan(0) // with a chance of galena
    expect(Number.isInteger(second.silver_ore ?? 0)).toBe(true) // found whole, or not at all
    mineDig(world, s, copperHex, 1, 1000)
    expect(levels(world, s, copperHex)![1]).toBe(0)
    expect(mineDig(world, s, copperHex, 1, 5)).toEqual({}) // level 2 needs a deeper shaft
    const deeper = mineDig(world, s, copperHex, 2, 5)
    expect(deeper.chalcopyrite! / (deeper.copper_ore ?? 0.001)).toBeGreaterThan(2) // mostly chalcopyrite down there
  })

  it('an iron mine goes from limonite to hematite to magnetite', () => {
    expect(mixAt('iron', 0)).toEqual({ limonite: 1 })
    expect(mixAt('iron', 1).iron_ore).toBeGreaterThan(mixAt('iron', 1).limonite!)
    expect(mixAt('iron', 3).magnetite).toBeGreaterThan(mixAt('iron', 3).iron_ore!)
    expect(ironHex).toBeGreaterThanOrEqual(0)
  })

  it('a shaft is sunk with a big task and shoring timber, to level 3 at most', () => {
    const { s, v } = withMine('copper_mine', copperHex)
    const c = world.cells[copperHex]
    v.goods = { timber: 20, planks: 10 }
    expect(act(s, 'deepen', c.col, c.row, AFTER, 'big')).toBeNull()
    expect(v.buildings[0].depth).toBe(2)
    expect(v.goods).toMatchObject({ timber: 16, planks: 8 })
    expect(act(s, 'deepen', c.col, c.row, AFTER, 'medium')).toMatch(/big task/)
    expect(act(s, 'deepen', c.col, c.row, AFTER, 'big')).toBeNull()
    expect(act(s, 'deepen', c.col, c.row, AFTER, 'big')).toMatch(/as deep as it can go/)
  })
})

describe('smelting', () => {
  function station(type: 'smelter' | 'bloomery', goods: Record<string, number>, extra: ('roasting_heap')[] = []) {
    const s = setup()
    const p = s.players.ann
    const v = s.villages[p.villageId]
    v.goods = goods
    v.buildings.push({ id: 'st', type, col: 0, row: 0, progress: 1 }, ...extra.map((t, k) => ({ id: `x${k}`, type: t, col: 0, row: 1, progress: 1 })))
    v.morale = 50 // a plain night: k = prod
    const made = produce(s, world, v, p, { habitsDone: [] } as never, '2026-11-17', 1, AFTER)
    return { v, made }
  }

  it('works the easiest ore first, as far as the charcoal goes', () => {
    const { v, made } = station('smelter', { copper_ore: 1, chalcopyrite: 5, charcoal: 10 })
    // no roasting heap: only the malachite
    expect(made.copper).toBe(1)
    expect(v.goods.chalcopyrite).toBe(5)
    expect(v.goods.charcoal).toBe(9.5)
  })

  it('takes chalcopyrite once there is a roasting heap, for less copper and more charcoal', () => {
    const { v, made } = station('smelter', { chalcopyrite: 5, charcoal: 10 }, ['roasting_heap'])
    expect(v.goods.chalcopyrite).toBe(3)
    expect(made.copper).toBe(1.2)
    expect(v.goods.charcoal).toBe(8)
  })

  it('a bloomery works every iron ore, magnetite the hungriest', () => {
    const { made, v } = station('bloomery', { magnetite: 2, charcoal: 4 })
    expect(v.goods.magnetite).toBeCloseTo(0.4)
    expect(made.iron).toBeCloseTo(0.96)
    expect(v.goods.charcoal ?? 0).toBeCloseTo(0)
  })
})

describe('dungeons', () => {
  const hex = world.cells.findIndex((_, i) => dungeonUnder(world, i)?.level === 2)
  it('wait under some mountains, two levels down, and run out of loot', () => {
    expect(hex).toBeGreaterThanOrEqual(0)
    const d = dungeonUnder(world, hex)!
    const s = setup()
    const v = s.villages[s.players.ann.villageId]
    const c = world.cells[hex]
    v.buildings.push({ id: 'm', type: 'iron_mine', col: c.col, row: c.row, progress: 1 })
    v.goods = { timber: 20, planks: 10 }
    expect(act(s, 'expedition', c.col, c.row, AFTER, 'big')).toMatch(/No monsters/)
    act(s, 'deepen', c.col, c.row, AFTER, 'big')
    expect(s.dungeons?.[hex]).toMatchObject({ kind: d.kind, raids: d.raids, villageId: v.id })
    // a strong party: steel, iron, food and an outfitter
    v.population = 40
    s.dungeons![hex].strength = 0.01
    for (let k = 0; k < d.raids; k++) {
      v.goods = { ...v.goods, steel: 5, bread: 6 }
      expect(act(s, 'expedition', c.col, c.row, AFTER, 'big')).toBeNull()
    }
    expect(s.dungeons![hex].raids).toBe(0)
    expect(act(s, 'expedition', c.col, c.row, AFTER, 'big')).toMatch(/Picked clean/)
  })

  it("never under open ground, and not every mountain has one", () => {
    const flat = world.cells.findIndex((c) => c.tier > 0 && !c.feature)
    expect(dungeonUnder(world, flat)).toBeNull()
    const peaks = world.cells.map((_, i) => i).filter((i) => world.cells[i].feature === 'mountain')
    const some = peaks.filter((i) => dungeonUnder(world, i)).length
    expect(some).toBeGreaterThan(0)
    expect(some).toBeLessThan(peaks.length)
  })
})

describe('purse', () => {
  it('every village gets copper and silver once, at the cutoff, and new ones start with it', () => {
    const s = setup()
    const v = s.villages[s.players.ann.villageId]
    expect(v.goods.silver).toBeUndefined()
    apply(s, world, { t: 'resetHour', id: 'r1', at: AFTER, playerId: 'ann', hour: 0 })
    expect(v.goods.copper).toBe(10)
    expect(v.goods.silver).toBe(1)
    apply(s, world, { t: 'resetHour', id: 'r2', at: AFTER, playerId: 'ann', hour: 0 })
    expect(v.goods.copper).toBe(10)
    const site = sites.find((x) => x.col !== sites[0].col || x.row !== sites[0].row)!
    apply(s, world, { t: 'join', id: 'j2', at: AFTER, playerId: 'bob', name: 'Bob', role: site.role, site, resetHour: 0, tz: 0 })
    const b = s.villages[s.players.bob?.villageId]
    if (b) expect(b.goods.silver).toBe(1)
  })
})

describe('rare finds', () => {
  it('come whole, about as often as expected', () => {
    const hex = world.cells.findIndex((c) => c.resource === 'copper')
    let found = 0, expected = 0
    for (let d = 0; d < 400; d++) {
      const s = setup()
      s.dug = { [hex]: reserveAt(world, hex)!.surface } // working level 1
      const odds = { expected: {}, rolled: {} } as Odds
      const got = mineDig(world, s, hex, 1, 2, `day-${d}`, odds)
      found += got.silver_ore ?? 0
      expected += odds.expected.silver_ore ?? 0
      expect(odds.rolled.silver_ore ?? 0).toBe(got.silver_ore ?? 0)
    }
    expect(found).toBeGreaterThan(expected * 0.6)
    expect(found).toBeLessThan(expected * 1.4)
  })
})
