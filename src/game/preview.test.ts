import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { apply, newGame, territoryCells, validate } from './reducer'
import { outcome, taskText } from './preview'
import { FOOD, GOOD_LABEL, type ActionKind } from './data'
import type { GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const DAY = '2026-11-23'
const AT = `${DAY}T10:00:00.000Z`
let n = 0

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  return s
}
const act = (s: GameState, action: ActionKind, col: number, row: number, extra: Partial<GameEvent> = {}, size: 'small' | 'medium' | 'big' = 'small'): GameEvent => {
  const id = `t${++n}`
  s.players.ann.tokens.push({ id, size, strength: 1, date: DAY, slot: 0 })
  return { t: 'act', id: `e${n}`, at: AT, playerId: 'ann', tokenId: id, action, col, row, ...extra } as GameEvent
}
const gain = (before: GameState, after: GameState, good: string) => (after.villages.v_ann.goods[good as 'grain'] ?? 0) - (before.villages.v_ann.goods[good as 'grain'] ?? 0)

/** Every hex in the village's territory where this action is allowed. */
function spots(s: GameState, action: ActionKind, extra: Partial<GameEvent> = {}) {
  const v = s.villages.v_ann
  return territoryCells(world, v).map((i) => ({ col: i % world.width, row: Math.floor(i / world.width) }))
    .filter((c) => !validate(s, world, act(s, action, c.col, c.row, extra)))
}

describe('what the confirmation window promises', () => {
  for (const [action, good] of [['gather', null], ['pick', 'stone'], ['clear', 'timber'], ['dig_clay', 'clay']] as const) {
    it(`${action}: the goods shown are the goods that arrive`, () => {
      const s = setup()
      const found = spots(s, action)
      expect(found.length, `a hex to ${action} on, within the village`).toBeGreaterThan(0)
      for (const c of found.slice(0, 6)) {
        const probe = structuredClone(s)
        const ev = act(probe, action, c.col, c.row) as Extract<GameEvent, { t: 'act' }>
        const tok = probe.players.ann.tokens.find((t) => t.id === ev.tokenId)!
        const o = outcome(world, probe, probe.players.ann, action, c.col, c.row, {}, { size: tok.size, strength: tok.strength }, AT)
        const m = /^\+([\d.]+) (?:rations of )?(.+)$/.exec(o.gets[0])
        expect(m, o.gets[0]).toBeTruthy()
        const before = structuredClone(probe)
        apply(probe, world, ev)
        // the good the window names (by its label), and only that one
        const g = good ?? Object.keys(GOOD_LABEL).find((x) => GOOD_LABEL[x as keyof typeof GOOD_LABEL].toLowerCase() === m![2])!
        expect(g, `a good called ${m![2]}`).toBeTruthy()
        const rations = /rations of/.test(o.gets[0]) ? FOOD[g as keyof typeof FOOD]!.value : 1 // food is shown in rations
        expect(gain(before, probe, g) * rations).toBeCloseTo(Number(m![1]), 0)
        expect(o.spends[0]).toBe('1 small action')
      }
    })
  }

  it('a well and a paved road list what they cost', () => {
    const s = setup()
    const v = s.villages.v_ann
    s.villages.v_ann.goods.stone = 10
    const road = { col: v.col + 1, row: v.row }
    const tok = { size: 'small' as const, strength: 1 }
    const well = outcome(world, s, s.players.ann, 'well', road.col, road.row, {}, { size: 'medium', strength: 1 }, AT)
    expect(well.spends).toEqual(['1 medium action', '3 stone'])
    const pave = outcome(world, s, s.players.ann, 'pave', road.col, road.row, {}, tok, AT)
    expect(pave.spends).toEqual(['1 small action', '2 stone'])
    expect(pave.gets.join(' ')).toMatch(/9x/)
  })

  it('a building lists its price as spent and itself as the thing gained', () => {
    const s = setup()
    const v = s.villages.v_ann
    const o = outcome(world, s, s.players.ann, 'build', v.col + 1, v.row, { building: 'granary' }, { size: 'medium', strength: 1 }, AT)
    expect(o.spends).toEqual(['1 medium action', '6 timber, 2 stone'])
    expect(o.gets).toEqual(['A Granary'])
    const half = outcome(world, s, s.players.ann, 'build', v.col + 1, v.row, { building: 'granary' }, { size: 'medium', strength: 0.5 }, AT)
    expect(half.spends[1]).toMatch(/^3 timber, 1 stone/)
    expect(half.gets[0]).toMatch(/half-built/)
  })

  it('says a pit seeps back slowly, and a riverbank only waits for winter', () => {
    const s = setup()
    const v = s.villages.v_ann
    const clay = spots(s, 'dig_clay')
    expect(clay.length).toBeGreaterThan(0)
    const notes = clay.map((c) => {
      const probe = structuredClone(s)
      const left = (outcome(world, probe, probe.players.ann, 'dig_clay', c.col, c.row, {}, { size: 'small', strength: 1 }, AT))
      return left.notes.join(' ')
    })
    expect(notes.every((t) => /left in this ground|until winter|seeps back/.test(t))).toBe(true)
    expect(v).toBeTruthy()
  })

  it('words the task', () => {
    expect(taskText({ size: 'big', strength: 1 })).toBe('1 big action')
    expect(taskText({ size: 'small', strength: 1, merged: true })).toBe('1 small action (two half-done tasks)')
  })
})
