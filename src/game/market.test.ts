import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { addDays } from './calendar'
import { GOODS, type Good } from './data'
import { bidFor, merchants, rates, reach, weigh, weightOf, VALUE } from './market'
import { apply, newGame, validate } from './reducer'
import type { GameEvent, GameState, Village } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const MON = '2026-11-16'
const SAT = '2026-11-21'

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  const site = sites[0]
  apply(s, world, { t: 'join', id: 'j1', at: `${MON}T08:00:00Z`, playerId: 'ann', name: 'Ann', role: site.role, site, resetHour: 0, tz: 0 })
  return s
}
const village = (s: GameState) => s.villages[s.players.ann.villageId]
const barter = (at: string, merchant: 'pedlar' | 'ship' | 'barge' | 'caravan', give: object, take: object, id = 'b1') =>
  ({ t: 'barter', id, at, playerId: 'ann', merchant, give, take }) as GameEvent

describe('merchants', () => {
  it('a remote village gets only a pedlar, with steep prices; connections bring more and better', () => {
    const s = setup()
    const v: Village = { ...village(s), col: 0, row: 0, outposts: [], roads: [], buildings: [] }
    const far = { ...v }
    // pretend nothing is near: no coast or river means only the pedlar
    const r0 = reach(world, far)
    if (!r0.coast && !r0.river) expect(merchants(world, s, far, MON).map((m) => m.kind)).toEqual(['pedlar'])
    const hub = { ...v, roads: Array.from({ length: 10 }, (_, i) => i), buildings: [{ id: 'm', type: 'market' as const, col: 0, row: 0, progress: 1 }] }
    const kinds = merchants(world, s, hub, MON).map((m) => m.kind)
    expect(kinds).toContain('caravan')
    expect(merchants(world, s, hub, MON).find((m) => m.kind === 'caravan')!.name).toBe('Wagon caravan')
    expect(reach(world, hub).score).toBeGreaterThan(r0.score)
    expect(rates(1).sell).toBeLessThan(rates(0).sell)
    expect(rates(1).buy).toBeGreaterThan(rates(0).buy)
  })

  it('is the same for everyone, and rests on the Sabbath', () => {
    const s = setup()
    expect(merchants(world, s, village(s), MON)).toEqual(merchants(world, s, village(s), MON))
    expect(merchants(world, s, village(s), SAT)).toEqual([])
  })

  it('never lets you profit by buying from one merchant and selling to another', () => {
    for (const g of GOODS as readonly Good[]) {
      // the best a merchant ever pays (a hub, a wanted good) vs the least one ever asks
      const m = { kind: 'ship' as const, name: '', blurb: '', wares: {}, wants: [g], sell: rates(1).sell, buy: rates(1).buy, cap: 99, load: 0 }
      if (g === 'copper') expect(bidFor(m, g)).toBe(VALUE.copper) // money, at face value
      else expect(bidFor(m, g)).toBeLessThan(VALUE[g] * rates(1).sell)
    }
  })

  it('copper is money: nobody sells it', () => {
    const s = setup()
    const v = { ...village(s), roads: Array.from({ length: 10 }, (_, i) => i) }
    for (const m of merchants(world, s, v, MON)) expect(m.wares.copper).toBeUndefined()
  })

  it('packs fit the merchant with room to spare', () => {
    const s = setup()
    for (const m of merchants(world, s, village(s), MON)) expect(weightOf(m.wares)).toBeLessThanOrEqual(m.cap)
  })
})

describe('barter', () => {
  it('accepts a good enough offer, moves the goods, and empties their pack', () => {
    const s = setup()
    const v = village(s)
    v.goods = { cheese: 600, bread: 40 }
    const m = merchants(world, s, v, MON).find((x) => x.kind === 'pedlar')!
    const [g, n] = Object.entries(m.wares)[0] as [Good, number]
    const at = `${MON}T12:00:00Z`
    expect(validate(s, world, barter(at, 'pedlar', { cheese: 1 }, { [g]: n }))).toMatch(/won't take|can't carry/)
    // enough cheese to pay, but not so much they can't carry it
    let k = 1
    while (!weigh(m, { cheese: k }, { [g]: n }).accept && k < 600) k++
    expect(validate(s, world, barter(at, 'pedlar', { cheese: k }, { [g]: n }))).toBeNull()
    apply(s, world, barter(at, 'pedlar', { cheese: k }, { [g]: n }))
    expect(v.goods[g]).toBe(n)
    expect(v.goods.cheese).toBe(600 - k)
    expect(merchants(world, s, v, MON).find((x) => x.kind === 'pedlar')!.wares[g]).toBeUndefined()
    // they're back with a fresh pack the next day
    expect(merchants(world, s, v, addDays(MON, 1)).find((x) => x.kind === 'pedlar')).toBeTruthy()
  })

  it("refuses what they can't carry", () => {
    const s = setup()
    const v = village(s)
    v.goods = { stone: 100 }
    const m = merchants(world, s, v, MON).find((x) => x.kind === 'pedlar')!
    const [g] = Object.keys(m.wares) as Good[]
    expect(weigh(m, { stone: 30 }, { [g]: 1 }).fits).toBe(false)
    expect(validate(s, world, barter(`${MON}T12:00:00Z`, 'pedlar', { stone: 30 }, { [g]: 1 }))).toMatch(/carry/)
  })

  it('no trading on the Sabbath', () => {
    const s = setup()
    expect(validate(s, world, barter(`${SAT}T12:00:00Z`, 'pedlar', { grain: 1 }, { salt: 1 }))).toMatch(/Sabbath/)
  })
})
