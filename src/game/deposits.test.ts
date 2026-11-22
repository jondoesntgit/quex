import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { addDays } from './calendar'
import { BUILDINGS } from './data'
import { DEPLETION_FROM, GAME_REGROW, gameLeft, gameMax, hunt, leftAt, reserveAt, stonyness } from './deposits'
import { COPPER_PER_SILVER, VALUE } from './market'
import { apply, cellIndex, inTerritory, newGame, validate } from './reducer'
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
function act(s: GameState, action: 'gather' | 'pick', col: number, row: number, at = AFTER): string | null {
  const id = `t${++n}`
  s.players.ann.tokens.push({ id, size: 'small', strength: 1, date: DAY, slot: 0 })
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

  it('silver is slow to make and copper mines bring up a trickle', () => {
    expect(BUILDINGS.copper_mine.produces?.silver_ore).toBeGreaterThan(0)
    expect(BUILDINGS.iron_mine.produces?.silver_ore).toBeUndefined()
    expect(BUILDINGS.silver_refinery.produces?.silver).toBeLessThan(1)
    expect(VALUE.silver).toBe(VALUE.copper * COPPER_PER_SILVER)
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
