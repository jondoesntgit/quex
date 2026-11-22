import { beforeEach, describe, expect, it } from 'vitest'
import type { GameEvent } from '../game/types'

// browser bits the store touches
const mem = new Map<string, string>()
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
const online = { on: true }
const publicWorld = { on: false }
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online.on, configurable: true })
const listeners: Record<string, (() => void)[]> = {}
g.window = { addEventListener: (t: string, f: () => void) => { (listeners[t] ??= []).push(f) } }

/** A fake Supabase: the world's state in a table, and the game server, both
 *  failing like fetch does while "offline". */
function fakeServer() {
  const rows: GameEvent[] = []
  const server = { n: 0, refuse: null as string | null }
  const fail = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'range', 'in', 'gte', 'maybeSingle']) c[m] = () => c
    c.then = (res: (v: unknown) => void) => res(result())
    return c
  }
  const sb = {
    rpc: async (name: string) => (name === 'world_is_public' ? { data: publicWorld.on, error: null } : { data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    from: () => chain(() => (online.on ? { data: { state: { players: {}, ids: rows.map((e) => e.id) }, n: server.n }, error: null } : fail())),
  }
  // the game server: quex-act
  g.fetch = async (_url: string, init: { body: string }) => {
    if (!online.on) throw new TypeError('Failed to fetch')
    const body = JSON.parse(init.body)
    if (server.refuse) return { ok: false, status: 422, json: async () => ({ error: server.refuse }) }
    if (!rows.some((x) => x.id === body.event.id)) { rows.push(body.event); server.n++ }
    return { ok: true, status: 200, json: async () => ({ n: server.n, event: { ...body.event, at: 'server time' } }) }
  }
  return { sb, rows, server }
}
const ev = (id: string): GameEvent => ({ t: 'progress', id, at: '2026-11-18T10:00:00Z', playerId: 'p', date: '2026-11-18', slot: 0, status: 'full' })
const ids = (snap: { state: unknown }) => (snap.state as { ids: string[] }).ids

describe('playing offline', async () => {
  const { SupabaseStore } = await import('./supabase')
  beforeEach(() => { mem.clear(); online.on = true })

  it('keeps a copy of the world and plays from it when the server is unreachable', async () => {
    const { sb, rows } = fakeServer()
    rows.push(ev('a'), ev('b'))
    const s1 = new SupabaseStore(sb as never, 'w')
    expect(ids(await s1.snapshot())).toEqual(['a', 'b'])
    expect(s1.offline).toBe(false)
    online.on = false
    const s2 = new SupabaseStore(sb as never, 'w')
    expect(ids(await s2.snapshot())).toEqual(['a', 'b'])
    expect(s2.offline).toBe(true)
  })

  it('queues actions taken offline and sends them when back online', async () => {
    const { sb, rows } = fakeServer()
    const s = new SupabaseStore(sb as never, 'w')
    await s.snapshot()
    online.on = false
    expect(await s.send(ev('x'))).toEqual({ status: 'queued' })
    await s.send(ev('y'))
    expect(rows).toHaveLength(0)
    expect(s.outbox().map((e) => e.id)).toEqual(['x', 'y'])
    expect(s.offline).toBe(true)
    online.on = true
    const r = await s.send(ev('x'))
    expect(r).toMatchObject({ status: 'ok', n: 1, event: { id: 'x', at: 'server time' } })
    expect(s.outbox().map((e) => e.id)).toEqual(['y'])
    await s.send(ev('y'))
    expect(rows.map((e) => e.id)).toEqual(['x', 'y'])
    expect(s.outbox()).toHaveLength(0)
    expect(s.offline).toBe(false)
  })

  it('drops an action the server refuses, with its reason', async () => {
    const { sb, server } = fakeServer()
    const s = new SupabaseStore(sb as never, 'w')
    server.refuse = 'Not enough goods'
    expect(await s.send(ev('z'))).toEqual({ status: 'refused', error: 'Not enough goods' })
    expect(s.outbox()).toHaveLength(0)
  })

  it('with no copy on the device, an unreachable server is still an error', async () => {
    const { sb } = fakeServer()
    online.on = false
    await expect(new SupabaseStore(sb as never, 'w').snapshot()).rejects.toThrow()
  })
})

describe('guests', async () => {
  const { SupabaseStore, PrivateWorldError } = await import('./supabase')
  beforeEach(() => { mem.clear(); online.on = true })
  it('can look at a public world but not a private one', async () => {
    const { sb, rows } = fakeServer()
    rows.push(ev('a'))
    publicWorld.on = false
    await expect(new SupabaseStore(sb as never, 'w', true).snapshot()).rejects.toBeInstanceOf(PrivateWorldError)
    publicWorld.on = true
    expect(ids(await new SupabaseStore(sb as never, 'w', true).snapshot())).toEqual(['a'])
    expect((await new SupabaseStore(sb as never, 'w', true).access()).me).toBeNull()
  })
})
