import { describe, expect, it } from 'vitest'
import { apply, newGame } from '../game/reducer'
import type { GameEvent } from '../game/types'
import { act, dueTicks, seed, worldFor } from './act'

const world = worldFor('test-seed')
const sites = world.regions[world.startRegion].sites
const join = (pid: string, i: number, at = '2026-11-16T09:00:00Z'): GameEvent =>
  ({ t: 'join', id: `j-${pid}`, at, playerId: pid, name: pid, site: sites[i], resetHour: 0, tz: 0 })
let k = 0
const id = () => `t${++k}`

describe('the game server', () => {
  it('stamps its own time on an action, and leaves the old state alone', () => {
    const s = newGame(world, '2026-11-15')
    const r = act(s, world, join('ann', 0, '2030-01-01T00:00:00Z'), new Date('2026-11-16T10:00:00Z'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.event.at).toBe('2026-11-16T10:00:00.000Z')
    expect(r.state.players.ann.joined).toBe('2026-11-16')
    expect(s.players.ann).toBeUndefined()
  })

  it('refuses what the rules refuse', () => {
    const s = newGame(world, '2026-11-15')
    const r = act(s, world, { t: 'tick', id: 'x', at: '', playerId: 'nobody', date: '2026-11-15' }, new Date())
    expect(r).toEqual({ ok: false, error: 'Unknown player' })
  })

  it("won't work out a day before it's over", () => {
    const now = new Date('2026-11-16T10:00:00Z')
    const r = act(newGame(world, '2026-11-15'), world, join('ann', 0), now)
    if (!r.ok) throw new Error(r.error)
    expect(act(r.state, world, { t: 'tick', id: 'x', at: '', playerId: 'ann', date: '2026-11-16' }, now)).toEqual({ ok: false, error: "That day isn't over yet" })
  })

  it('does the nightly work for every finished day, once', () => {
    let s = newGame(world, '2026-11-15')
    const r = act(s, world, join('ann', 0), new Date('2026-11-16T10:00:00Z'))
    if (!r.ok) throw new Error(r.error)
    s = r.state
    const now = new Date('2026-11-19T01:00:00Z')
    const due = dueTicks(s, now, id)
    expect(due.map((e) => (e as { date: string }).date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18'])
    for (const ev of due) {
      const t = act(s, world, ev, now)
      if (!t.ok) throw new Error(t.error)
      s = t.state
    }
    expect(dueTicks(s, now, id)).toEqual([])
  })

  it('leaves players from before join dates were kept, and never ticked, to their own app', () => {
    const r = act(newGame(world, '2026-11-15'), world, join('ann', 0), new Date('2026-11-16T10:00:00Z'))
    if (!r.ok) throw new Error(r.error)
    delete r.state.players.ann.joined
    expect(dueTicks(r.state, new Date('2026-11-19T01:00:00Z'), id)).toEqual([])
  })

  it('makes a first snapshot exactly as the clients used to: the history in time order', () => {
    const evs = [join('bob', 1, '2026-11-16T09:30:00Z'), join('ann', 0, '2026-11-16T09:00:00Z')]
    const replayed = newGame(world, '2026-11-15')
    for (const ev of [evs[1], evs[0]]) apply(replayed, world, ev)
    expect(seed(world, '2026-11-15', evs)).toEqual(replayed)
  })
})
