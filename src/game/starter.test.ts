import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { STARTER_FROM, apply, newGame, popCap, BASE_CAP } from './reducer'
import { starterFor, townOf, walkable, roomFor, visible, hexAt } from './city'
import type { GameState, Village } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const AFTER = new Date(Date.parse(STARTER_FROM) + 3600_000).toISOString()

function villageAt(site: number, at: string): { s: GameState; v: Village } {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'j', at, playerId: 'ann', name: 'Ann', site: sites[site], resetHour: 0, tz: 0 })
  return { s, v: s.villages.v_ann }
}

describe("a village's square, laid out across its city", () => {
  it('new villages start with a well and a few homes spread over the cobbles', () => {
    let laid = 0, total = 0
    const t0 = Date.now()
    for (let i = 0; i < sites.length; i++) {
      const { v } = villageAt(i, AFTER)
      total++
      if (!v.starter) continue
      laid++
      const starts = (v.homes ?? []).filter((h) => h.start)
      expect(starts.length).toBeGreaterThanOrEqual(2)
      expect(popCap(v)).toBe(BASE_CAP) // they house no one beyond the square's 30
      // every one fits where it stands, and the town is still one walkable place
      const rest = (h: (typeof starts)[number]) => ({ ...v, homes: starts.filter((x) => x !== h) })
      for (const h of starts) {
        expect(roomFor(world, rest(h), h), 'room').toBe(true)
        expect(visible(world, rest(h), h), 'seen').toBe(true)
      }
      expect(walkable(world, v)).toBe(true)
      expect(townOf(world, v).stops.length).toBeGreaterThanOrEqual(3)
      // spread over more than one hex
      expect(new Set(starts.map((h) => hexAt(world, v, [h.x, h.y]))).size).toBeGreaterThan(1)
    }
    console.log(`starter squares: ${laid} of ${total}, ${Math.round((Date.now() - t0) / total)} ms each`)
    expect(laid / total).toBeGreaterThan(0.7)
  }, 120_000)

  it('villages already standing with three cobbled hexes are rearranged once, without touching food or people', () => {
    const { s, v } = villageAt(0, '2026-11-16T08:00:00Z') // before the change: the fixed picture
    expect(v.starter).toBeUndefined()
    delete s.startersPlaced
    v.goods = { grain: 12, cheese: 40, timber: 8 }
    const food = { ...v.goods }, pop = v.population
    expect(starterFor(world, v)).not.toBeNull()
    apply(s, world, { t: 'tick', id: 't1', at: AFTER, playerId: 'ann', date: '2026-11-23' })
    expect(s.startersPlaced).toBe(true)
    expect(v.starter).toBeTruthy()
    const homes = (v.homes ?? []).length
    expect(homes).toBeGreaterThanOrEqual(2)
    expect(v.population).toBeGreaterThan(pop * 0.5) // nobody sent away
    for (const g of ['grain', 'cheese'] as const) expect(v.goods[g]).toBeLessThanOrEqual(food[g]!) // only a night's eating
    expect(v.goods.cheese).toBeGreaterThan(30)
    // and it doesn't happen again
    apply(s, world, { t: 'tick', id: 't2', at: new Date(Date.parse(AFTER) + 60_000).toISOString(), playerId: 'ann', date: '2026-11-23' })
    expect(v.homes!.length).toBe(homes)
  })

  it('a village with a one-hex city keeps its picture', () => {
    const { s, v } = villageAt(0, '2026-11-16T08:00:00Z')
    delete s.startersPlaced
    v.city = [v.city![0]]
    apply(s, world, { t: 'tick', id: 't1', at: AFTER, playerId: 'ann', date: '2026-11-23' })
    expect(v.starter).toBeUndefined()
    expect(v.homes ?? []).toEqual([])
  })
})
