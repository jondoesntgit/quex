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

/** A fake Supabase: a table of events that fails like fetch does while "offline". */
function fakeServer() {
  const rows: GameEvent[] = []
  const fail = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'range', 'in', 'gte']) c[m] = () => c
    c.then = (res: (v: unknown) => void) => res(result())
    return c
  }
  const sb = {
    rpc: async (name: string) => (name === 'world_is_public' ? { data: publicWorld.on, error: null } : { data: null, error: null }),
    from: () => ({
      ...chain(() => (online.on ? { data: rows.map((body) => ({ body })), error: null } : fail())),
      insert: (r: { body: GameEvent }) => chain(() => {
        if (!online.on) return fail()
        if (rows.some((x) => x.id === r.body.id)) return { error: { message: 'duplicate key value' } }
        rows.push(r.body)
        return { error: null }
      }),
    }),
  }
  return { sb, rows }
}
const ev = (id: string): GameEvent => ({ t: 'progress', id, at: '2026-11-18T10:00:00Z', playerId: 'p', date: '2026-11-18', slot: 0, status: 'full' })

describe('playing offline', async () => {
  const { SupabaseStore } = await import('./supabase')
  beforeEach(() => { mem.clear(); online.on = true })

  it('keeps a copy of the world and plays from it when the server is unreachable', async () => {
    const { sb, rows } = fakeServer()
    rows.push(ev('a'), ev('b'))
    const s1 = new SupabaseStore(sb as never, 'w')
    expect((await s1.load()).map((e) => e.id)).toEqual(['a', 'b'])
    expect(s1.offline).toBe(false)
    online.on = false
    const s2 = new SupabaseStore(sb as never, 'w')
    expect((await s2.load()).map((e) => e.id)).toEqual(['a', 'b'])
    expect(s2.offline).toBe(true)
  })

  it('queues actions taken offline and sends them when back online', async () => {
    const { sb, rows } = fakeServer()
    const s = new SupabaseStore(sb as never, 'w')
    await s.load()
    online.on = false
    await s.append(ev('x'))
    await s.append(ev('y'))
    expect(rows).toHaveLength(0)
    expect(s.pending().map((e) => e.id)).toEqual(['x', 'y'])
    // reopening offline still shows them
    expect((await new SupabaseStore(sb as never, 'w').load()).map((e) => e.id)).toEqual(['x', 'y'])
    online.on = true
    await s.flush()
    expect(rows.map((e) => e.id)).toEqual(['x', 'y'])
    expect(s.pending()).toHaveLength(0)
    expect(s.offline).toBe(false)
    // sending twice is harmless
    await s.append(ev('y'))
    expect(rows).toHaveLength(2)
  })

  it('with no copy on the device, an unreachable server is still an error', async () => {
    const { sb } = fakeServer()
    online.on = false
    await expect(new SupabaseStore(sb as never, 'w').load()).rejects.toThrow()
  })
})

describe('guests', async () => {
  const { SupabaseStore, PrivateWorldError } = await import('./supabase')
  beforeEach(() => { mem.clear(); online.on = true })
  it('can look at a public world but not a private one', async () => {
    const { sb, rows } = fakeServer()
    rows.push(ev('a'))
    publicWorld.on = false
    await expect(new SupabaseStore(sb as never, 'w', true).load()).rejects.toBeInstanceOf(PrivateWorldError)
    publicWorld.on = true
    expect((await new SupabaseStore(sb as never, 'w', true).load()).map((e) => e.id)).toEqual(['a'])
    expect((await new SupabaseStore(sb as never, 'w', true).access()).me).toBeNull()
  })
})
