import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { apply, newGame, validate } from './reducer'
import { garrison, nightsOf, troopsAt } from './garrison'
import type { GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const DAY = '2026-11-23'
const AT = `${DAY}T10:00:00.000Z`
let n = 0

/** Ann hosts (with a palisade); Bob lends troops. */
function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  apply(s, world, { t: 'join', id: 'jb', at: '2026-11-16T08:00:00Z', playerId: 'bob', name: 'Bob', site: sites[1], resetHour: 0, tz: 0 })
  const ann = s.villages.v_ann
  ann.buildings.push({ id: 'pal', type: 'palisade', col: ann.col + 1, row: ann.row, progress: 1 })
  const bob = s.villages.v_bob
  bob.population = 10
  bob.goods = { iron: 3, steel: 1, cheese: 4, grain: 6, timber: 5 }
  return s
}
function send(s: GameState, troops: number, goods: Record<string, number>, to = 'v_ann') {
  const id = `t${++n}`
  s.players.bob.tokens.push({ id, size: 'medium', strength: 1, date: DAY, slot: 1 })
  const ev = { t: 'act', id: `d${n}`, at: AT, playerId: 'bob', tokenId: id, action: 'troops', col: 0, row: 0, to, troops, goods } as GameEvent
  const err = validate(s, world, ev)
  if (!err) apply(s, world, ev)
  return err
}
const decide = (s: GameState, detachment: string, accept: boolean) => {
  const ev: GameEvent = { t: 'garrison', id: `g${++n}`, at: AT, playerId: 'ann', detachment, accept }
  const err = validate(s, world, ev)
  if (!err) apply(s, world, ev)
  return err
}
const tick = (s: GameState, pid: string, date: string) => apply(s, world, { t: 'tick', id: `k${++n}`, at: `${date}T23:00:00.000Z`, playerId: pid, date })

describe('troops at a palisade', () => {
  it('need a palisade, food for a night, and two people left at home', () => {
    const s = setup()
    expect(send(s, 2, { cheese: 1 }, 'v_bob')).toMatch(/neighbour/)
    s.villages.v_ann.buildings = []
    expect(send(s, 2, { cheese: 1 })).toMatch(/palisade/)
    const t = setup()
    expect(send(t, 9, { cheese: 4 })).toMatch(/two people/)
    expect(send(t, 3, { grain: 1 })).toMatch(/at least a night/)
    expect(send(t, 2, { timber: 1, cheese: 1 })).toMatch(/weapons, armour and food/)
  })

  it('wait at the gate, then the host takes them in: they guard and march, eating their own food', () => {
    const s = setup()
    expect(send(s, 3, { iron: 2, steel: 1, cheese: 2, grain: 1.5 })).toBeNull()
    const bob = s.villages.v_bob
    expect(bob.population).toBe(10) // still Bob's people
    expect(bob.away).toBe(3)
    expect(bob.goods).toMatchObject({ iron: 1, cheese: 2, grain: 4.5 })
    const [d] = garrison(s, s.villages.v_ann)
    expect(d).toMatchObject({ status: 'waiting', troops: 3, gear: { iron: 2, steel: 1 } })
    expect(nightsOf(d)).toBe(3) // 4.5 food value, 1.5 a night
    expect(troopsAt(s, s.villages.v_ann)).toBe(0) // not until they're let in
    expect(decide(s, d.id, true)).toBeNull()
    expect(troopsAt(s, s.villages.v_ann)).toBe(3)
    const annFood = s.villages.v_ann.goods.grain
    tick(s, 'ann', '2026-11-23')
    expect(s.villages.v_ann.goods.grain).toBeLessThanOrEqual(annFood!) // ann's own stores don't feed them
    expect(nightsOf(garrison(s, s.villages.v_ann)[0])).toBe(2)
    tick(s, 'ann', '2026-11-24')
    tick(s, 'ann', '2026-11-25')
    // provisions gone: they walk home with their gear
    expect(garrison(s, s.villages.v_ann)).toHaveLength(0)
    expect(bob.away).toBe(0)
    expect(bob.goods).toMatchObject({ iron: 3, steel: 1 })
  })

  it('are turned back with everything they brought', () => {
    const s = setup()
    send(s, 2, { iron: 1, cheese: 1 })
    const [d] = garrison(s, s.villages.v_ann)
    expect(decide(s, d.id, false)).toBeNull()
    expect(s.villages.v_bob.goods).toMatchObject({ iron: 3, cheese: 4 })
    expect(s.villages.v_bob.population).toBe(10)
  })

  it('give up after waiting three days at the gate', () => {
    const s = setup()
    send(s, 2, { cheese: 2 })
    tick(s, 'ann', '2026-11-23')
    tick(s, 'ann', '2026-11-24')
    expect(garrison(s, s.villages.v_ann)).toHaveLength(1)
    tick(s, 'ann', '2026-11-25')
    tick(s, 'ann', '2026-11-26')
    expect(garrison(s, s.villages.v_ann)).toHaveLength(0)
    expect(s.villages.v_bob.population).toBe(10)
  })

  it('go home if the host abandons the village', () => {
    const s = setup()
    send(s, 2, { steel: 1, cheese: 1 })
    decide(s, garrison(s, s.villages.v_ann)[0].id, true)
    apply(s, world, { t: 'abandon', id: 'ab', at: AT, playerId: 'ann' })
    expect(s.villages.v_bob.population).toBe(10)
    expect(s.villages.v_bob.goods.steel).toBe(1)
  })
})
