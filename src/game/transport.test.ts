import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { line, spiral } from '../world/hex'
import { apply, caravanCarry, cellIndex, clayAt, clayLeft, clayRenews, mountainSpring, newGame, produce, route, validate } from './reducer'
import { hasWater, waterAt } from './water'
import { lacks, merchants } from './market'
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
function act(s: GameState, action: string, col: number, row: number, extra: object = {}, size: 'small' | 'medium' = 'small') {
  const id = `t${++n}`
  s.players.ann.tokens.push({ id, size, strength: 1, date: DAY, slot: 0 })
  const ev = { t: 'act', id: `a${n}`, at: AT, playerId: 'ann', tokenId: id, action, col, row, ...extra } as GameEvent
  const err = validate(s, world, ev)
  if (!err) apply(s, world, ev)
  return err
}

describe('caravans carry by weight', () => {
  it('porters, then mules, then carts (on roads), and paving carries more', () => {
    const s = setup()
    const ann = s.villages.v_ann, bob = s.villages.v_bob
    expect(caravanCarry(world, s, ann, bob, 5)).toMatchObject({ animals: 'foot', cap: 30 }) // five people, six each
    ann.buildings.push({ id: 'st', type: 'stable', col: ann.col, row: ann.row, progress: 1 })
    s.wells = { [cellIndex(world, ann.col, ann.row)]: true }
    expect(caravanCarry(world, s, ann, bob, 0)).toMatchObject({ animals: 'mules', cap: 60 })
    ann.buildings.push({ id: 'cs', type: 'cart_shed', col: 0, row: 1, progress: 1 })
    const offRoad = caravanCarry(world, s, ann, bob, 0)
    expect(offRoad.animals).toBe('carts')
    expect(offRoad.cap).toBeLessThan(100)
    // a road the whole way, then paved
    const way = line(ann, bob).map((o) => cellIndex(world, o.col, o.row))
    ann.roads = way
    expect(route(world, s, ann, bob).road).toBe(1)
    expect(caravanCarry(world, s, ann, bob, 0).cap).toBe(100)
    ann.paved = way
    expect(caravanCarry(world, s, ann, bob, 0).cap).toBe(150)
  })

  it('refuses a load that is too heavy', () => {
    const s = setup()
    const ann = s.villages.v_ann
    ann.goods = { stone: 20, cheese: 30 }
    // five people carry 30, provisions included: a long cross-country trip takes 9 cheese (weight 9), leaving 21 for stone
    expect(act(s, 'caravan', 0, 0, { to: 'v_bob', goods: { stone: 8 }, crew: 5, food: { cheese: 9 } }, 'medium')).toMatch(/Too heavy: .* 30 weight/)
    expect(act(s, 'caravan', 0, 0, { to: 'v_bob', goods: { stone: 7 }, crew: 5, food: { cheese: 9 } }, 'medium')).toBeNull()
  })

  it('a cart shed needs a stable first', () => {
    const s = setup()
    const ann = s.villages.v_ann
    ann.goods = { planks: 10, timber: 10 }
    const c = spiral(ann, 2).map((o) => world.cells[cellIndex(world, o.col, o.row)])
      .find((x) => x.tier > 0 && !x.feature && ['grass', 'meadow', 'savannah'].includes(x.terrain) && (x.col !== ann.col || x.row !== ann.row))
    if (!c) return
    expect(act(s, 'build', c.col, c.row, { building: 'cart_shed' }, 'medium')).toMatch(/Mule stable first/)
  })
})

describe('paving', () => {
  it('lays stone on your own road', () => {
    const s = setup()
    const ann = s.villages.v_ann
    const i = cellIndex(world, ann.col, ann.row + 1)
    ann.goods = { stone: 3 }
    expect(act(s, 'pave', ann.col, ann.row + 1)).toMatch(/your roads/)
    ann.roads.push(i)
    expect(act(s, 'pave', ann.col, ann.row + 1)).toBeNull()
    expect(ann.paved).toEqual([i])
    expect(ann.goods.stone).toBe(1)
    expect(act(s, 'pave', ann.col, ann.row + 1)).toMatch(/Already paved/)
  })
})

describe('clay', () => {
  it('lies along rivers and in marshes, a little in the hills, and at some mountain springs', () => {
    const river = world.cells.findIndex((c) => c.tier > 0 && c.riverTo !== -1 && c.resource !== 'clay' && c.terrain !== 'swamp')
    expect(clayAt(world, river)).toBe(9)
    const peaks = world.cells.map((_, i) => i).filter((i) => world.cells[i].terrain === 'rock')
    const springs = peaks.filter((i) => mountainSpring(world, i))
    expect(springs.length).toBeGreaterThan(0)
    expect(springs.length).toBeLessThan(peaks.length)
    expect(clayAt(world, springs[0])).toBe(6)
    const dry = world.cells.findIndex((c) => c.terrain === 'desert' && c.riverTo === -1 && c.resource !== 'clay')
    if (dry >= 0) expect(clayAt(world, dry)).toBe(0)
  })

  it('is dug by hand until the bank is dug out', () => {
    const s = setup()
    const ann = s.villages.v_ann
    const i = world.cells.findIndex((c, k) => clayAt(world, k) > 0 && Math.abs(c.col - ann.col) + Math.abs(c.row - ann.row) <= 2)
    if (i < 0) return
    const c = world.cells[i]
    let dug = 0
    while (act(s, 'dig_clay', c.col, c.row) === null && dug < 10) dug++
    expect(clayLeft(world, s, i)).toBe(0)
    expect(ann.goods.clay).toBe(clayAt(world, i))
  })
})

describe('clay comes back', () => {
  it('to riverbanks, marshes and springs every winter, but not to pits in the plains', () => {
    const s = setup()
    const river = world.cells.findIndex((c) => c.tier > 0 && c.riverTo !== -1 && c.resource !== 'clay' && c.terrain !== 'swamp')
    const plain = world.cells.findIndex((c) => c.tier > 0 && c.riverTo === -1 && c.terrain === 'grass' && c.resource !== 'clay')
    expect(clayRenews(world, river)).toBe(true)
    expect(clayRenews(world, plain)).toBe(false)
    expect(clayAt(world, plain)).toBe(4)
    s.clayDug = { [river]: 9, [plain]: 4 }
    for (const d of ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'])
      apply(s, world, { t: 'tick', id: `c${++n}`, at: `${d}T23:00:00.000Z`, playerId: 'ann', date: d })
    expect(clayLeft(world, s, river)).toBe(9)
    expect(clayLeft(world, s, plain)).toBe(0)
  })
})

describe('the pedlar', () => {
  it('always brings timber and clay to a village that is out of them', () => {
    const s = setup()
    const ann = s.villages.v_ann
    ann.goods = { timber: 0, clay: 0, grain: 5 }
    expect(lacks(world, s, ann)).toEqual(['timber', 'clay'])
    const p = merchants(world, s, ann, '2026-11-23').find((m) => m.kind === 'pedlar')!
    expect(p.wares.timber).toBeGreaterThan(0)
    expect(p.wares.clay).toBeGreaterThan(0)
    ann.goods = { timber: 10, clay: 5 }
    expect(lacks(world, s, ann).length).toBeLessThan(2)
  })
})

describe('wild saplings', () => {
  it('come up each winter on bare land around a village, once', () => {
    const s = setup()
    const before = Object.keys(s.woods ?? {}).length
    const tick = (date: string) => apply(s, world, { t: 'tick', id: `k${++n}`, at: `${date}T23:00:00.000Z`, playerId: 'ann', date })
    for (const d of ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) tick(d)
    const after = Object.entries(s.woods ?? {})
    expect(after.length).toBeGreaterThan(before)
    expect(after.some(([, w]) => w.young > 0 && w.n === 0)).toBe(true)
    for (const [i] of after) expect(world.cells[Number(i)].terrain).not.toBe('desert')
  })
})

describe('water for the herds', () => {
  it('comes from rivers, marshes, springs, wells and ponds; ponds dry in summer', () => {
    const s = setup()
    const river = world.cells.findIndex((c) => c.tier > 0 && c.riverTo !== -1)
    expect(waterAt(world, s, river)?.kind).toBe('river')
    const plain = world.cells.findIndex((c) => c.tier > 0 && c.riverTo === -1 && c.terrain === 'grass' && c.resource !== 'clay')
    expect(waterAt(world, s, plain)).toBeNull()
    // dig the clay pit out; by winter it's a pond
    s.clayDug = { [plain]: 4 }
    for (const d of ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'])
      apply(s, world, { t: 'tick', id: `w${++n}`, at: `${d}T23:00:00.000Z`, playerId: 'ann', date: d })
    expect(waterAt(world, s, plain, '2026-11-23')).toEqual({ kind: 'pond', dry: false })
    expect(waterAt(world, s, plain, '2026-11-24')).toEqual({ kind: 'pond', dry: true }) // a summer day
  })

  it('a dry pen gives half; a well fixes it', () => {
    const s = setup()
    const ann = s.villages.v_ann
    const i = world.cells.findIndex((c, k) => c.tier > 0 && !hasWater(world, s, k) && c.terrain === 'grass')
    const c = world.cells[i]
    ann.buildings.push({ id: 'pen', type: 'pen', col: c.col, row: c.row, progress: 1 })
    const night = () => produce(s, world, ann, s.players.ann, { habitsDone: [] } as never, '2026-11-23', 1, AT).wool ?? 0
    const dry = night()
    s.wells = { [i]: true }
    expect(night()).toBeCloseTo(dry * 2)
  })

  it('every pen, dairy and stable without water gets a free well, once', () => {
    const s = newGame(world, '2026-11-15')
    s.wellsGiven = false
    apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
    const i = world.cells.findIndex((c, k) => c.tier > 0 && !hasWater(world, s, k) && c.terrain === 'grass')
    const c = world.cells[i]
    s.villages.v_ann.buildings.push({ id: 'pen', type: 'pen', col: c.col, row: c.row, progress: 1 })
    s.wellsGiven = undefined
    apply(s, world, { t: 'resetHour', id: 'r', at: AT, playerId: 'ann', hour: 0 })
    expect(s.wells?.[i]).toBe(true)
    expect(s.wellsGiven).toBe(true)
  })
})
