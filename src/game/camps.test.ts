import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { RAIDS_FROM, apply, newGame, validate } from './reducer'
import { MAX_INTEL, campsOf, defend, fight, fittingText, forecast, quartermaster, retell } from './camps'
import { battle, type Kit } from './battle'
import { idle, needOf } from './workers'
import { rngFor } from '../world/rng'
import type { GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const at = '2026-12-01T15:00:00.000Z'
const setup = () => {
  const s = newGame(world, '2026-11-15')
  const site = world.regions[world.startRegion].sites[0]
  apply(s, world, { t: 'join', id: 'j', at, playerId: 'ann', name: 'Ann', site, resetHour: 0, tz: 0 })
  const v = s.villages.v_ann
  // a camp of orcs four hexes off, and a palisade
  s.lairs.push({ col: v.col + 4, row: v.row, kind: 'orcs', strength: 12, cleared: false })
  s.revealed.push((v.row) * world.width + v.col + 4)
  v.buildings.push({ id: 'pal', type: 'palisade', col: v.col + 1, row: v.row, progress: 1 })
  v.population = 60
  return { s, v, camp: campsOf(s).find((c) => c.lair.col === v.col + 4 && c.lair.row === v.row)! }
}

describe('raiding camps', () => {
  it('the quartermaster fits out the line first: swords, spears, then bows; armour and shields to the front', () => {
    const f = quartermaster([
      { village: 'a', troops: 6, gear: { sword: 1, spear: 2, bow: 2, mail: 1, jerkin: 2, shield: 10, helmet: 1, ladder: 3 } },
      { village: 'b', troops: 2, gear: { spear: 1 } },
    ])
    const w = f.soldiers.map((x) => x.kit.weapon)
    expect(w.filter((x) => x === 'sword')).toHaveLength(1)
    expect(w.filter((x) => x === 'spear')).toHaveLength(3)
    expect(w.filter((x) => x === 'bow')).toHaveLength(2)
    expect(f.count.pitchfork).toBe(2)
    // b's soldiers get b's spear first
    expect(f.soldiers.filter((x) => x.group === 1).some((x) => x.items.some((it) => it.good === 'spear' && it.from === 1))).toBe(true)
    // the mail goes to the sword, shields to everyone but the archers
    expect(f.soldiers.find((x) => x.kit.weapon === 'sword')!.kit.body).toBe('mail')
    expect(f.soldiers.filter((x) => x.kit.shield)).toHaveLength(6)
    expect(f.ladders).toBe(3)
    expect(fittingText(f)).toBe('8 soldiers: 1 sword, 3 spears, 2 bows, 2 pitchforks; 1 in mail, 2 in leather; 6 shields, 1 helmet; 3 ladders')
  })

  it('numbers tell in the open, kit helps, and a stockade wants ladders', () => {
    const k = (weapon: Kit['weapon'], body: Kit['body'] = 'none', shield = false): Kit => ({ weapon, body, helmet: false, shield })
    const wins = (attackers: Kit[], walls: boolean, ladders = 0, n = 40) => {
      let w = 0
      for (let i = 0; i < n; i++) if (battle({ attackers, orcs: 19, walls, ladders, strategy: 'assault' }, rngFor('t', attackers.length, walls ? 1 : 0, ladders, i)).win) w++
      return w / n
    }
    expect(wins(Array(57).fill(k('none')), false)).toBeGreaterThan(0.9) // three to one with pitchforks
    expect(wins(Array(19).fill(k('none')), false)).toBeLessThan(0.1) // even numbers with pitchforks
    expect(wins(Array(38).fill(k('spear', 'jerkin', true)), false)).toBeGreaterThan(wins(Array(38).fill(k('none')), false))
    expect(wins(Array(57).fill(k('spear', 'jerkin', true)), true, 0)).toBeLessThan(wins(Array(57).fill(k('spear', 'jerkin', true)), true, 6) + 0.05)
  })

  it('scouting narrows the forecast', () => {
    const { s, camp } = setup()
    const groups = [{ village: 'v_ann', troops: 45, gear: { spear: 45, jerkin: 45, shield: 45, ladder: 6 } }]
    const widths: number[] = []
    for (let n = 0; n <= MAX_INTEL; n++) {
      camp.state.intel = n
      const fc = forecast(s, camp, groups, 'assault', at)
      widths.push(fc.high - fc.low)
      expect(fc.fitting.troops).toBe(45)
    }
    expect(widths.at(-1)!).toBeLessThanOrEqual(widths[0])
  })

  it('the hoard is shared by soldiers sent, not by kit', () => {
    const { s, camp } = setup()
    camp.lair.strength = 6
    const groups = [{ village: 'a', troops: 45, gear: { sword: 45, mail: 45, shield: 45, helmet: 45, ladder: 10 } }, { village: 'b', troops: 15, gear: {} }]
    const r = fight(s, camp, groups, 'assault', at)
    expect(r.win).toBe(true)
    const iron = (vid: string) => r.shares[vid].iron ?? 0
    expect(iron('a') / iron('b')).toBeCloseTo(3, 1)
    expect(Object.values(r.tally).reduce((a, t) => a + t.lost + t.wounded + t.captured + t.ran + t.unhurt, 0)).toBe(60)
  })

  it('a raid from the palisade, after scouting it', () => {
    const { s, v, camp } = setup()
    v.goods = { ...v.goods, spear: 40, jerkin: 40, shield: 40, ladder: 8 }
    const tok = (id: string, size: 'small' | 'medium') => { s.players.ann.tokens.push({ id, size, strength: 1, date: '2026-12-01', slot: 0 }); return id }
    const ev = (action: string, extra: object, size: 'small' | 'medium') => ({ t: 'act', id: `e-${action}`, at, playerId: 'ann', tokenId: tok(`t-${action}`, size), action, col: camp.lair.col, row: camp.lair.row, ...extra }) as GameEvent
    const recon = ev('recon', {}, 'small')
    expect(validate(s, world, recon)).toBeNull()
    apply(s, world, recon)
    expect(s.camps?.[camp.idx]?.intel).toBe(1)
    const pop = v.population
    const raid = ev('raid', { troops: 40 }, 'medium')
    expect(validate(s, world, raid)).toBeNull()
    apply(s, world, raid)
    expect(s.log.at(-1)!.text).toMatch(/raided the .* camp/)
    expect(v.population).toBeLessThanOrEqual(pop)
    expect(at >= RAIDS_FROM).toBe(true)
  })

  it('a lost raid leaves prisoners and kit with the camp; a won raid brings them home', () => {
    const { s, v, camp } = setup()
    v.population = 80
    v.goods = { ...v.goods, spear: 12, jerkin: 12 }
    camp.lair.strength = 16
    let n = 0
    const raid = (troops: number) => {
      s.players.ann.tokens.push({ id: `t${++n}`, size: 'medium', strength: 1, date: '2026-12-01', slot: 0 })
      const ev = { t: 'act', id: `r${n}`, at: `2026-12-0${n}T15:00:00.000Z`, playerId: 'ann', tokenId: `t${n}`, action: 'raid', col: camp.lair.col, row: camp.lair.row, troops, strategy: 'assault' } as GameEvent
      expect(validate(s, world, ev)).toBeNull()
      apply(s, world, ev)
      return s.camps![camp.idx]
    }
    // 12 with spears against a stockade of 20 orcs: beaten back
    const pop = v.population
    const st = raid(12)
    expect(s.log.at(-1)!.text).toMatch(/beaten back/)
    expect(s.log.at(-1)!.text).toMatch(/^.*Of ours: /)
    const held = st.prisoners?.[v.id] ?? 0
    const lost = pop - v.population
    const hurt = (v.wounded ?? []).reduce((a, w) => a + w.n, 0)
    expect(held + lost + hurt).toBeGreaterThan(0)
    expect(v.away ?? 0).toBe(held)
    if (held) expect((st.plunder?.spear ?? 0) + (st.plunder?.jerkin ?? 0)).toBeGreaterThan(0)
    expect((v.goods.spear ?? 0) + (st.plunder?.spear ?? 0)).toBe(12)
    // then a big, well-kitted party takes the camp: the prisoners come home
    camp.lair.strength = 6
    v.goods = { ...v.goods, sword: 50, mail: 50, shield: 50, helmet: 50, ladder: 10 }
    raid(50)
    expect(s.log.some((e) => /raided the .* camp and won/.test(e.text))).toBe(true)
    expect(st.prisoners ?? {}).toEqual({})
    expect(v.away ?? 0).toBe(0)
  })

  it('a night raid on a village without a palisade: every able adult turns out, and loses more often', () => {
    const { s, v, camp } = setup()
    v.goods = { ...v.goods, grain: 40, copper: 10, spear: 10 }
    const groups = [{ village: v.id, troops: 10, gear: v.goods }]
    let open = 0, walled = 0
    for (let k = 0; k < 12; k++) {
      const at_ = `2026-12-01T0${k % 10}:${10 + k}:00.000Z`
      const o = defend(s, camp, v, groups, false, at_)
      const w = defend(s, camp, v, groups, true, at_)
      if (o.win) open++
      if (w.win) walled++
      if (!o.win) {
        expect(o.plunder.grain ?? 0).toBeLessThanOrEqual(10) // never more than a quarter of anything
        expect(o.plunder.spear).toBeUndefined() // no palisade, no armoury to take
      }
    }
    expect(walled).toBeGreaterThan(open)
  })

  it('the battle report tells each thing once, with totals', () => {
    expect(retell(['We marched on their stockade at dawn.', 'One of us got over their logs on a ladder. 3 of them lost their nerve and ran.', 'One of us got over their logs on a ladder.', '2 of them lost their nerve and ran.']))
      .toEqual(['We marched on their stockade at dawn.', '2 of us got over their logs on ladders.', '5 of them lost their nerve and ran.'])
  })

  it('a camp left alone grows a little stronger each day, once a day however many villages tick', () => {
    const { s, camp } = setup()
    const before = camp.lair.strength
    apply(s, world, { t: 'tick', id: 'n1', at: '2026-12-02T01:00:00.000Z', playerId: 'ann', date: '2026-12-01' })
    apply(s, world, { t: 'tick', id: 'n1b', at: '2026-12-02T01:30:00.000Z', playerId: 'ann', date: '2026-12-01' })
    expect(camp.lair.strength).toBeGreaterThan(before)
    expect(s.camps?.[camp.idx]?.grewOn).toBe('2026-12-01')
  })

  it('a new workshop makes nothing and needs nobody until it is told what to make', () => {
    const { v } = setup()
    v.buildings.push({ id: 'smith', type: 'smithy', col: v.col, row: v.row + 1, progress: 1, order: '' })
    expect(idle(v.buildings.at(-1)!)).toBe(true)
    expect(needOf(v.buildings.at(-1)!)).toBe(0)
    v.buildings.at(-1)!.order = 'spears'
    expect(idle(v.buildings.at(-1)!)).toBe(false)
    expect(needOf(v.buildings.at(-1)!)).toBe(5)
  })

  it('no raid without a palisade, and an old-style expedition is turned away', () => {
    const { s, v, camp } = setup()
    v.buildings = v.buildings.filter((b) => b.type !== 'palisade')
    s.players.ann.tokens.push({ id: 'tm', size: 'medium', strength: 1, date: '2026-12-01', slot: 0 }, { id: 'tb', size: 'big', strength: 1, date: '2026-12-01', slot: 1 })
    expect(validate(s, world, { t: 'act', id: 'r', at, playerId: 'ann', tokenId: 'tm', action: 'raid', col: camp.lair.col, row: camp.lair.row, troops: 10 } as GameEvent)).toMatch(/palisade/)
    expect(validate(s, world, { t: 'act', id: 'x', at, playerId: 'ann', tokenId: 'tb', action: 'expedition', col: camp.lair.col, row: camp.lair.row } as GameEvent)).toMatch(/palisade/)
  })
})

describe('soldiers lent to a palisade', () => {
  it('walk home while their food still covers the road, with their gear', () => {
    const s: GameState = newGame(world, '2026-11-15')
    const sites = world.regions[world.startRegion].sites
    apply(s, world, { t: 'join', id: 'j1', at, playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
    apply(s, world, { t: 'join', id: 'j2', at, playerId: 'bob', name: 'Bob', site: sites[1], resetHour: 0, tz: 0 })
    const host = s.villages.v_ann, from = s.villages.v_bob
    from.away = 10
    ;(s.garrisons ??= {})[host.id] = [{ id: 'd', from: from.id, troops: 10, gear: { spear: 5 }, food: { grain: 1.5 }, status: 'stationed', since: at }]
    const spears = from.goods.spear ?? 0
    apply(s, world, { t: 'tick', id: 'k', at: '2026-12-02T01:00:00.000Z', playerId: 'ann', date: '2026-12-01' })
    expect(s.garrisons![host.id]).toHaveLength(0)
    expect(s.homeward?.some((h) => h.village === from.id && h.crew === 10)).toBe(true)
    expect(from.away).toBe(10) // still on the road
    apply(s, world, { t: 'tick', id: 'k2', at: '2026-12-09T01:00:00.000Z', playerId: 'bob', date: '2026-12-08' })
    expect(from.away).toBe(0)
    expect(from.goods.spear).toBeCloseTo(spears + 5, 5)
  })
})
