import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game, newMeta, type EventStore } from './store'

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
