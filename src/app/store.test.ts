import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game, newMeta, type EventStore } from './store'
import type { GameEvent } from '../game/types'

function fakeStore(fail = { on: false }) {
  const saved: string[] = []
  const store: EventStore = {
    load: async () => [], append: async () => {}, subscribe: () => () => {},
    loadLabels: async () => [{ player_id: 'p1', date: '2026-11-18', slot: 2, text: 'from the cloud' }],
    saveLabel: async (_p, _d, _s, text) => { if (fail.on) throw new Error('offline'); saved.push(text) },
  }
  return { store, saved }
}

afterEach(() => vi.useRealTimers())

describe('task labels', () => {
  it('debounce to one save, showing saving then saved', async () => {
    vi.useFakeTimers()
    const { store, saved } = fakeStore()
    const g = new Game(newMeta('test-seed'), store)
    g.setLabel('p1', '2026-11-18', 0, 'Wr')
    g.setLabel('p1', '2026-11-18', 0, 'Write report')
    expect(g.labelStatus('p1', '2026-11-18', 0)).toBe('saving')
    await vi.advanceTimersByTimeAsync(800)
    expect(saved).toEqual(['Write report'])
    expect(g.labelStatus('p1', '2026-11-18', 0)).toBe('saved')
    expect(g.label('p1', '2026-11-18', 0)).toBe('Write report')
  })
  it('show an error when saving fails, and retry on blur', async () => {
    vi.useFakeTimers()
    const fail = { on: true }
    const { store, saved } = fakeStore(fail)
    const g = new Game(newMeta('test-seed'), store)
    g.setLabel('p1', '2026-11-18', 1, 'Call mum')
    await vi.advanceTimersByTimeAsync(800)
    expect(g.labelStatus('p1', '2026-11-18', 1)).toBe('error')
    fail.on = false
    g.setLabel('p1', '2026-11-18', 1, 'Call mum', true)
    await vi.advanceTimersByTimeAsync(10)
    expect(saved).toEqual(['Call mum'])
    expect(g.labelStatus('p1', '2026-11-18', 1)).toBe('saved')
  })
  it('load from the account on a new device', async () => {
    const { store } = fakeStore()
    const meta = newMeta('test-seed')
    meta.localPlayers = ['p1']
    const g = new Game(meta, store)
    await g.syncLabels()
    expect(g.label('p1', '2026-11-18', 2)).toBe('from the cloud')
    expect(g.labelStatus('p1', '2026-11-18', 2)).toBe('saved')
  })
  it('count as saved immediately when playing offline', () => {
    const store: EventStore = { load: async () => [], append: async () => {}, subscribe: () => () => {} }
    const g = new Game(newMeta('test-seed'), store)
    g.setLabel('p1', '2026-11-18', 0, 'Walk')
    expect(g.labelStatus('p1', '2026-11-18', 0)).toBe('saved')
  })
})

describe('parents and guardians', () => {
  const store: EventStore = { load: async () => [], append: async () => {}, subscribe: () => () => {} }
  function family() {
    const meta = newMeta('test-seed')
    const g = new Game(meta, store)
    // two players in the world: the parent's and the child's
    g.state.players.dad = { id: 'dad', name: 'Dad' } as never
    g.state.players.kid = { id: 'kid', name: 'Matthew' } as never
    g.setAccess({
      me: 'u-dad',
      guardians: [{ player: 'kid', user: 'u-dad' }, { player: 'kid', user: 'u-gran' }],
      owners: [{ player: 'dad', user: 'u-dad' }, { player: 'kid', user: 'u-kid' }],
      admins: ['u-dad'], public: false, closed: false,
    })
    return g
  }
  it('a parent can set and check off their child\'s tasks', () => {
    const g = family()
    g.meta.localPlayers = ['dad']
    expect(g.wards()).toEqual(['kid'])
    expect(g.canEditTasks('kid')).toBe(true)
    expect(g.canEditTasks('dad')).toBe(true)
    expect(g.guardianNames('kid')).toEqual(['Dad', 'a parent'])
  })
  it('a supervised child cannot edit their own tasks; an unsupervised player can', () => {
    const g = family()
    g.access!.me = 'u-kid'
    g.meta.localPlayers = ['kid']
    expect(g.isSupervised('kid')).toBe(true)
    expect(g.canEditTasks('kid')).toBe(false)
    expect(g.wards()).toEqual([])
    g.setAccess({ me: 'u-kid', guardians: [], owners: [], admins: [], public: false, closed: false })
    expect(g.canEditTasks('kid')).toBe(true)
  })
  it('offline (no accounts) everything local is editable', () => {
    const g = new Game(newMeta('test-seed'), store)
    g.meta.localPlayers = ['p1']
    expect(g.canEditTasks('p1')).toBe(true)
  })
})

describe('a world the server holds', async () => {
  const { act } = await import('../server/act')
  const { newGame } = await import('../game/reducer')
  type Sent = Awaited<ReturnType<NonNullable<EventStore['send']>>>

  /** A fake game server running the real rules, with realtime under the test's control. */
  function served() {
    const meta = newMeta('test-seed')
    const g0 = new Game(meta, { load: async () => [], append: async () => {}, subscribe: () => () => {} })
    const srv = { state: newGame(g0.world, meta.seasonStart), n: 0, hold: false, offline: false }
    const outbox: GameEvent[] = []
    let push: (ev: GameEvent, n?: number) => void = () => {}
    const held: (() => void)[] = []
    const store: EventStore = {
      load: async () => [], append: async () => {},
      subscribe: (cb) => { push = cb; return () => {} },
      snapshot: async () => ({ state: structuredClone(srv.state), n: srv.n }),
      outbox: () => outbox,
      send: async (ev): Promise<Sent> => {
        if (srv.offline) { outbox.push(ev); return { status: 'queued' } }
        const r = act(srv.state, g0.world, ev, new Date('2026-11-16T12:00:00Z'))
        if (!r.ok) return { status: 'refused', error: r.error }
        srv.state = r.state
        srv.n++
        const out: Sent = { status: 'ok', n: srv.n, event: r.event }
        if (srv.hold) await new Promise<void>((res) => held.push(res))
        return out
      },
    }
    const g = new Game(meta, store)
    /** someone else acts on the server */
    const other = (ev: GameEvent) => {
      const r = act(srv.state, g.world, ev, new Date('2026-11-16T12:00:00Z'))
      if (!r.ok) throw new Error(r.error)
      srv.state = r.state
      srv.n++
      return { ev: r.event, n: srv.n }
    }
    return { g, srv, other, push: (ev: GameEvent, n?: number) => push(ev, n), release: () => held.splice(0).forEach((f) => f()), outbox }
  }
  const site = () => { const w = new Game(newMeta('test-seed'), { load: async () => [], append: async () => {}, subscribe: () => () => {} }).world; return w.regions[w.startRegion].sites }
  const join = (pid: string, i: number): GameEvent => ({ t: 'join', id: `j-${pid}`, at: '2026-11-16T11:00:00Z', playerId: pid, name: pid, site: site()[i], resetHour: 0, tz: 0 })

  it('shows an action at once, and takes the server\'s version when it comes back', async () => {
    const { g, srv, release } = served()
    await g.init()
    srv.hold = true
    const sending = g.dispatch(join('ann', 0))
    expect(g.state.players.ann).toBeTruthy() // shown while on its way
    release()
    await sending
    expect(g.state.players.ann).toBeTruthy()
    expect(g.state).toEqual(srv.state)
  })

  it('applies other players\' actions as they arrive, and reloads if one was missed', async () => {
    const { g, srv, other, push } = served()
    await g.init()
    const a = other(join('ann', 0))
    push(a.ev, a.n)
    expect(g.state.players.ann).toBeTruthy()
    other(join('bob', 1)) // realtime never delivers this one
    const c = other(join('cat', 2))
    push(c.ev, c.n)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(g.state.players).sort()).toEqual(['ann', 'bob', 'cat'])
    expect(g.state).toEqual(srv.state)
  })

  it('takes back an action the server refuses, and says why', async () => {
    const { g } = served()
    await g.init()
    await g.dispatch(join('ann', 0))
    await g.dispatch({ ...join('ann', 1), id: 'again' })
    expect(g.flash).toMatch(/Already joined/)
    expect(g.state.villages.v_ann.col).toBe(site()[0].col)
  })

  it('keeps actions taken offline on show until they are sent', async () => {
    const { g, srv } = served()
    await g.init()
    srv.offline = true
    await g.dispatch(join('ann', 0))
    expect(g.state.players.ann).toBeTruthy()
    expect(srv.state.players.ann).toBeUndefined()
    srv.offline = false
    // (the real store's outbox empties as each one is sent)
    await g.sendOutbox()
    expect(srv.state.players.ann).toBeTruthy()
    expect(g.state.players.ann).toBeTruthy()
  })
})
