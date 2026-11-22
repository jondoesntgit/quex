import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { addDays } from './calendar'
import { activeParty, recommend, refineTips, refinedGain, shortfalls, weekPoints } from './advisor'
import { apply, newGame } from './reducer'
import type { GameState, Player } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const NOW = new Date('2026-11-23T12:00:00Z')

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  apply(s, world, { t: 'join', id: 'jb', at: '2026-11-16T08:00:00Z', playerId: 'bob', name: 'Bob', site: sites[1], resetHour: 0, tz: 0 })
  return s
}
/** a week of perfect days for a player */
function busy(p: Player, days = 7) {
  for (let k = 1; k <= days; k++) {
    const d = addDays('2026-11-23', -k)
    p.days[d] = { slots: ['big', 'medium', 'medium', 'small', 'small', 'small'].map((size) => ({ size, status: 'full' })), habitsDone: [] } as never
  }
}

describe('the advisor', () => {
  it('says what a village is light on, most pressing first', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { grain: 1 }
    v.winterForecast = 'hungry'
    const f = shortfalls(v).map((x) => x.need)
    expect(f[0]).toBe('food')
    expect(f).toEqual(expect.arrayContaining(['larder', 'winter', 'textiles', 'building']))
    v.goods = { grain: 30, cheese: 5, bread: 5, cloth: 3, timber: 9, stone: 9, iron: 2 }
    v.winterForecast = 'stocked'
    expect(shortfalls(v).map((x) => x.need)).not.toContain('food')
  })

  it("counts a player's points over the last seven days", () => {
    const s = setup()
    busy(s.players.bob, 3)
    expect(weekPoints(s.players.bob, NOW)).toBe(300)
    expect(activeParty(s, s.players.ann, NOW).map((x) => x.p.id)).toEqual(['bob'])
  })

  it('recommends what the land allows, for the busiest friends', () => {
    const s = setup()
    busy(s.players.bob)
    s.villages.v_bob.goods = { grain: 40, cheese: 9, bread: 9, timber: 9, stone: 9, iron: 3 } // short of textiles only
    s.villages.v_bob.winterForecast = 'stocked'
    const recs = recommend(world, s, s.players.ann, NOW, 13)
    const helping = recs.filter((r) => r.helps.some((h) => h.name === 'Bob'))
    for (const r of helping) expect(r.industry.meets).toContain('textiles')
  })

  it('makes the case for refined goods', () => {
    expect(refinedGain('wool', 'cloth')).toBeGreaterThan(2)
    expect(refinedGain('copper_ore', 'copper')).toBeGreaterThan(5)
    expect(refineTips({ grain: 10 })[0]).toMatch(/Bread carries 4× the worth of grain/)
    expect(refineTips({ bread: 10 })).toEqual([])
  })
})
