import type { Role } from '../world/types'
import type { ActionKind, BuildingId, Goods, HabitEffect, TaskSize } from './data'

export type TaskStatus = 'none' | 'half' | 'full'
export type ISODate = string // YYYY-MM-DD in the player's own day (shifted by resetHour)

export interface Slot {
  size: TaskSize
  status: TaskStatus
}

export interface DayRecord {
  date: ISODate
  slots: Slot[]
  habitsDone: string[]
  frozen: boolean
  ticked: boolean
}

export interface Token {
  id: string
  size: TaskSize
  /** 1 = full, 0.5 = half-credit (weaker / half-built result) */
  strength: number
  date: ISODate
  slot: number
}

export interface Habit {
  id: string
  name: string
  effect: HabitEffect
}

export interface Player {
  id: string
  name: string
  villageId: string
  /** hour (0-23) when this player's day rolls over; changeable ~weekly */
  resetHour: number
  resetChangedAt: string | null
  tz: number // minutes offset from UTC, as reported by the client
  habits: Habit[]
  habitSlots: number
  perfectStreak: number
  freezes: number
  days: Record<ISODate, DayRecord>
  tokens: Token[]
  lastTick: ISODate | null
}

export interface Building {
  id: string
  type: BuildingId
  col: number
  row: number
  /** 0..1 construction progress; half tokens build half */
  progress: number
}

export interface Village {
  id: string
  playerId: string
  name: string
  role: Role
  col: number
  row: number
  population: number
  morale: number
  goods: Goods
  buildings: Building[]
  /** extra territory centres (outposts) */
  outposts: { col: number; row: number }[]
  roads: number[]
  planted: { cell: number; date: ISODate }[]
  /** hexes whose trees were felled */
  cleared: number[]
  winterForecast: 'stocked' | 'tight' | 'hungry'
}

export interface Caravan {
  id: string
  from: string
  to: string
  goods: Goods
  departAt: string
  arriveAt: string
}

export interface LairState {
  col: number
  row: number
  kind: 'goblins' | 'orcs' | 'trolls' | 'dragon'
  strength: number
  cleared: boolean
}

export interface LogEntry {
  at: string
  playerId: string | null
  text: string
  kind: 'info' | 'good' | 'bad' | 'monster'
}

export interface GameState {
  worldSeed: string
  seasonStart: ISODate
  players: Record<string, Player>
  villages: Record<string, Village>
  caravans: Caravan[]
  lairs: LairState[]
  /** hexes any player has seen: fog of war is shared by the whole world */
  revealed: number[]
  log: LogEntry[]
  /** count of applied events (for sync) */
  version: number
}

// ------------------------------------------------------------------ events

interface Base { id: string; at: string; playerId: string }

export type GameEvent =
  | (Base & { t: 'join'; name: string; role: Role; site: { col: number; row: number }; resetHour: number; tz: number })
  | (Base & { t: 'progress'; date: ISODate; slot: number; status: TaskStatus })
  | (Base & { t: 'habit'; date: ISODate; habitId: string; done: boolean })
  | (Base & { t: 'habitAdd'; habit: Habit })
  | (Base & { t: 'habitRemove'; habitId: string })
  | (Base & { t: 'freeze'; date: ISODate })
  | (Base & { t: 'act'; tokenId: string; action: ActionKind; col: number; row: number; building?: BuildingId; to?: string; goods?: Goods })
  | (Base & { t: 'tick'; date: ISODate })
  | (Base & { t: 'resetHour'; hour: number })
