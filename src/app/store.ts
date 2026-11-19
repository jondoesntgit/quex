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
import type { Access } from './supabase'

export interface EventStore {
  load(): Promise<GameEvent[]>
  append(ev: GameEvent): Promise<void>
  subscribe(cb: (ev: GameEvent) => void): () => void
  /** private task names synced to the owner's account (online only) */
  loadLabels?(playerIds: string[]): Promise<{ player_id: string; date: string; slot: number; text: string }[]>
  saveLabel?(playerId: string, date: string, slot: number, text: string): Promise<void>
}

export type LabelStatus = 'saving' | 'saved' | 'error'

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

  /** Rebuild state from the log in time order (stable for equal timestamps). */
  replay() {
    this.events.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
    this.state = newGame(this.world, this.meta.seasonStart)
    for (const ev of this.events) apply(this.state, this.world, ev)
  }

  async init() {
    this.events = await this.store.load()
    this.replay()
    this.unsub = this.store.subscribe((ev) => {
      if (this.events.some((e) => e.id === ev.id)) return
      const last = this.events[this.events.length - 1]
      this.events.push(ev)
      if (last && ev.at < last.at) this.replay() // arrived out of order: rebuild in time order
      else apply(this.state, this.world, ev)
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
  /** redraw listeners (e.g. when the connection status changes) */
  poke() { this.emit() }

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

  saveMeta() { if (!this.guest) saveMeta(this.meta); this.emit() }

  label(pid: string, date: string, slot: number) {
    return this.meta.labels[pid]?.[date]?.[slot] ?? ''
  }

  private labelState = new Map<string, LabelStatus>()
  private labelTimers = new Map<string, ReturnType<typeof setTimeout>>()
  labelStatus(pid: string, date: string, slot: number): LabelStatus | undefined {
    const st = this.labelState.get(`${pid}|${date}|${slot}`)
    // offline, anything already stored on this device is saved
    return st ?? (!this.store.saveLabel && this.label(pid, date, slot) ? 'saved' : undefined)
  }

  /** Saved on this device at once; synced to the account after a short pause
   *  in typing (or straight away with `now`, e.g. on blur). */
  setLabel(pid: string, date: string, slot: number, text: string, now = false) {
    const byDate = (this.meta.labels[pid] ??= {})
    const arr = (byDate[date] ??= ['', '', '', '', '', ''])
    const changed = arr[slot] !== text
    arr[slot] = text
    const key = `${pid}|${date}|${slot}`
    if (!this.store.saveLabel) {
      this.labelState.set(key, 'saved')
      this.saveMeta()
      return
    }
    const pending = this.labelTimers.has(key)
    const retry = now && (pending || this.labelState.get(key) === 'error')
    if (!changed && !retry) return
    this.labelState.set(key, 'saving')
    this.saveMeta()
    clearTimeout(this.labelTimers.get(key))
    this.labelTimers.set(key, setTimeout(async () => {
      this.labelTimers.delete(key)
      try {
        await this.store.saveLabel!(pid, date, slot, arr[slot])
        if (!this.labelTimers.has(key)) this.labelState.set(key, 'saved')
      } catch (e) {
        console.warn('label not saved', e)
        this.labelState.set(key, 'error')
      }
      this.emit()
    }, now ? 0 : 700))
  }

  // ---------------------------------------------------------- guardians

  /** Online only: who is signed in, and who guards / plays which player. */
  access: Access | null = null
  /** a message to show once the game opens */
  flash: string | null = null
  setAccess(a: Access | null) { this.access = a; this.emit() }

  /** Looking around without an account: read-only. */
  get guest() { return !!(this.store as { guest?: boolean }).guest }
  /** Can this account change the world's settings? */
  isAdmin() { return !!this.access?.me && this.access.admins.includes(this.access.me) }
  /** A user's name in this world (the name of a village they play). */
  userName(user: string): string {
    const a = this.access
    const pid = a?.owners.find((o) => o.user === user && this.state.players[o.player])?.player
    return pid ? this.state.players[pid].name : user === a?.me ? 'you' : 'someone'
  }

  /** Player ids this account looks after as a parent/guardian. */
  wards(): string[] {
    const a = this.access
    if (!a?.me) return []
    return a.guardians.filter((g) => g.user === a.me && this.state.players[g.player]).map((g) => g.player)
  }
  isSupervised(pid: string) { return !!this.access?.guardians.some((g) => g.player === pid) }
  isGuardianOf(pid: string) { return !!this.access?.me && this.access.guardians.some((g) => g.player === pid && g.user === this.access!.me) }
  /** Tasks and habits: guardians set them for supervised players; otherwise the player does. */
  canEditTasks(pid: string) {
    if (this.isGuardianOf(pid)) return true
    return this.meta.localPlayers.includes(pid) && !this.isSupervised(pid)
  }
  /** Names of a player's guardians, by the villages those accounts play. */
  guardianNames(pid: string): string[] {
    const a = this.access
    if (!a) return []
    const users = a.guardians.filter((g) => g.player === pid).map((g) => g.user)
    return users.map((u) => {
      const names = a.owners.filter((o) => o.user === u).map((o) => this.state.players[o.player]?.name).filter(Boolean)
      return names[0] ?? (u === a.me ? 'you' : 'a parent')
    })
  }

  /** A task name changed elsewhere (a parent, or the child's other device). */
  remoteLabel(r: { player_id: string; date: string; slot: number; text: string }) {
    const key = `${r.player_id}|${r.date}|${r.slot}`
    if (this.labelTimers.has(key)) return // we're mid-edit here: ours wins
    const arr = ((this.meta.labels[r.player_id] ??= {})[r.date] ??= ['', '', '', '', '', ''])
    arr[r.slot] = r.text
    this.labelState.set(key, 'saved')
    this.saveMeta()
  }

  /** Pull task names (online) for this account's players and wards into the local copy. */
  async syncLabels() {
    const ids = [...new Set([...this.meta.localPlayers, ...this.wards()])]
    if (!this.store.loadLabels || !ids.length) return
    const rows = await this.store.loadLabels(ids)
    for (const r of rows) {
      const arr = ((this.meta.labels[r.player_id] ??= {})[r.date] ??= ['', '', '', '', '', ''])
      arr[r.slot] = r.text
      this.labelState.set(`${r.player_id}|${r.date}|${r.slot}`, 'saved')
    }
    this.saveMeta()
  }
}
/** Forget which world and villages this device plays (another account is signing in). */
export function clearMeta() {
  try { localStorage.removeItem(META_KEY) } catch { /* ignore */ }
}
