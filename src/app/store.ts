/** App store: holds the event log, replays it into GameState, persists it.
 *
 *  Storage backends implement EventStore. LocalStore (localStorage) is the
 *  default so the game runs with no account; SupabaseStore syncs the same
 *  events for a shared world when VITE_SUPABASE_URL is set.
 *
 *  Task *labels* are private and never leave the device: they live in
 *  `labels`, not in events.
 */
import { generateWorld } from '../world/generate'
import type { World } from '../world/types'
import { addDays, playerDate } from '../game/calendar'
import { apply, newGame, pendingTicks } from '../game/reducer'
import type { GameEvent, GameState, ISODate } from '../game/types'

export interface EventStore {
  load(): Promise<GameEvent[]>
  append(ev: GameEvent): Promise<void>
  subscribe(cb: (ev: GameEvent) => void): () => void
}

export interface Meta {
  worldSeed: string
  seasonStart: ISODate
  /** players controlled on this device (hot-seat for testing co-op locally) */
  localPlayers: string[]
  activePlayer: string | null
  /** private task labels: labels[playerId][date][slot] */
  labels: Record<string, Record<string, string[]>>
  /** dev: shift "now" by whole days to test ticks and seasons */
  dayOffset: number
  joinedOn: Record<string, ISODate>
}

const META_KEY = 'quex:meta:v1'
const EVENTS_KEY = 'quex:events:v1'

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* private mode etc. */ }
}

export class LocalStore implements EventStore {
  private subs = new Set<(ev: GameEvent) => void>()
  async load() {
    try { return JSON.parse(safeGet(EVENTS_KEY) ?? '[]') as GameEvent[] } catch { return [] }
  }
  async append(ev: GameEvent) {
    const all = await this.load()
    all.push(ev)
    safeSet(EVENTS_KEY, JSON.stringify(all))
  }
  subscribe(cb: (ev: GameEvent) => void) {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }
}

export function loadMeta(): Meta | null {
  try { return JSON.parse(safeGet(META_KEY) ?? 'null') } catch { return null }
}
export function saveMeta(m: Meta) {
  safeSet(META_KEY, JSON.stringify(m))
}
export function resetLocal() {
  try { localStorage.removeItem(META_KEY); localStorage.removeItem(EVENTS_KEY) } catch { /* ignore */ }
}

export function newMeta(seed: string): Meta {
  const today = new Date().toISOString().slice(0, 10)
  // seasons start on a Sunday
  const d = new Date(today + 'T00:00:00Z')
  const sunday = addDays(today, -d.getUTCDay())
  return { worldSeed: seed, seasonStart: sunday, localPlayers: [], activePlayer: null, labels: {}, dayOffset: 0, joinedOn: {} }
}

let idCounter = 0
export function eventId() {
  return `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export class Game {
  world: World
  state: GameState
  events: GameEvent[] = []
  private listeners = new Set<() => void>()
  private unsub: () => void = () => {}
  meta: Meta
  store: EventStore

  constructor(meta: Meta, store: EventStore) {
    this.meta = meta
    this.store = store
    this.world = generateWorld(meta.worldSeed)
    this.state = newGame(this.world, meta.seasonStart)
  }

  async init() {
    this.events = await this.store.load()
    this.events.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
    this.state = newGame(this.world, this.meta.seasonStart)
    for (const ev of this.events) apply(this.state, this.world, ev)
    this.unsub = this.store.subscribe((ev) => {
      if (this.events.some((e) => e.id === ev.id)) return
      this.events.push(ev)
      apply(this.state, this.world, ev)
      this.emit()
    })
    await this.catchUp()
    this.emit()
  }

  dispose() { this.unsub() }

  on(cb: () => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit() { for (const l of this.listeners) l() }

  now(): Date {
    return new Date(Date.now() + this.meta.dayOffset * 86_400_000)
  }

  today(playerId = this.meta.activePlayer): ISODate {
    const p = playerId ? this.state.players[playerId] : null
    return playerDate(this.now(), p?.resetHour ?? 0, p?.tz ?? -new Date().getTimezoneOffset())
  }

  async dispatch(ev: GameEvent) {
    this.events.push(ev)
    apply(this.state, this.world, ev)
    await this.store.append(ev)
    this.emit()
  }

  /** Emit tick events for every local player's finished days. */
  async catchUp() {
    for (const pid of this.meta.localPlayers) {
      const p = this.state.players[pid]
      if (!p) continue
      const today = this.today(pid)
      const joined = this.meta.joinedOn[pid] ?? today
      for (const date of pendingTicks(p, today, joined)) {
        await this.dispatch({ t: 'tick', id: eventId(), at: this.now().toISOString(), playerId: pid, date })
      }
    }
  }

  saveMeta() { saveMeta(this.meta); this.emit() }

  label(pid: string, date: string, slot: number) {
    return this.meta.labels[pid]?.[date]?.[slot] ?? ''
  }
  setLabel(pid: string, date: string, slot: number, text: string) {
    const byDate = (this.meta.labels[pid] ??= {})
    const arr = (byDate[date] ??= ['', '', '', '', '', ''])
    arr[slot] = text
    this.saveMeta()
  }
}
