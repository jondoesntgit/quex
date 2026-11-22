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
  /** running totals for habits with a daily goal (e.g. water: { water: 5 }) */
  amounts?: Record<string, number>
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
  /** a daily amount to reach (water: 8 cups); reaching it ticks the habit */
  goal?: { target: number; unit: string }
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
  /** today's barters with the merchants: what was bought from each (see game/market) */
  trade?: { date: ISODate; took: Partial<Record<'ship' | 'barge' | 'caravan' | 'pedlar', Goods>>; got?: Partial<Record<'ship' | 'barge' | 'caravan' | 'pedlar', Goods>> }
}

export interface Caravan {
  id: string
  from: string
  to: string
  goods: Goods
  departAt: string
  arriveAt: string
  /** on arrival: the two villages' names, kept in case one is later abandoned */
  fromName?: string
  toName?: string
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
  /** the latest caravans to arrive (newest last), for the world's caravan page */
  arrived?: Caravan[]
  lairs: LairState[]
  /** hexes any player has seen: fog of war is shared by the whole world */
  revealed: number[]
  log: LogEntry[]
  /** count of applied events (for sync) */
  version: number
  /** the merchants' purse has been handed out (see PURSE_FROM) */
  purses?: boolean
  /** ore and stone taken from each hex (see game/deposits) */
  dug?: Record<number, number>
  /** game left on each hunted hex, as of a day (it comes back slowly) */
  hunted?: Record<number, { left: number; date: ISODate }>
  /** hexes whose trees have been felled or planted, tree by tree (see TREES_FROM) */
  woods?: Record<number, Stand>
}

/** The trees on one hex. Felling turns one tree into a stump; each winter the
 *  standing trees double, up to the hex's original number, and saplings grow
 *  into trees. A hex whose last tree is felled is open land for good. */
export interface Stand {
  /** standing trees */
  n: number
  /** saplings (planted), which become trees at winter */
  young: number
  /** the most trees this hex holds */
  max: number
  kind: 'oak' | 'pine'
  /** the day of the last felling or planting, and the last winter that grew it */
  since: ISODate
  grew?: ISODate
}

// ------------------------------------------------------------------ events

interface Base { id: string; at: string; playerId: string }

export type GameEvent =
  | (Base & { t: 'join'; name: string; role: Role; site: { col: number; row: number }; resetHour: number; tz: number })
  | (Base & { t: 'progress'; date: ISODate; slot: number; status: TaskStatus })
  | (Base & { t: 'habit'; date: ISODate; habitId: string; done: boolean })
  | (Base & { t: 'habitAdd'; habit: Habit })
  | (Base & { t: 'habitRemove'; habitId: string })
  /** set a habit's daily target and unit */
  | (Base & { t: 'habitGoal'; habitId: string; target: number; unit: string })
  /** log progress toward a habit's daily goal (negative to correct a mistake) */
  | (Base & { t: 'drink'; date: ISODate; habitId: string; amount: number })
  | (Base & { t: 'freeze'; date: ISODate })
  | (Base & { t: 'act'; tokenId: string; /** a second half-done token, merged with the first into a whole action */ tokenId2?: string; action: ActionKind; col: number; row: number; building?: BuildingId; to?: string; goods?: Goods })
  | (Base & { t: 'tick'; date: ISODate })
  | (Base & { t: 'resetHour'; hour: number })
  /** change the player's display name (themselves, or a guardian for them) */
  | (Base & { t: 'rename'; name: string })
  /** barter with a merchant calling at the village today (game/market) */
  | (Base & { t: 'barter'; merchant: 'ship' | 'barge' | 'caravan' | 'pedlar'; give: Goods; take: Goods })
  /** give up this village entirely; the player can found a new one */
  | (Base & { t: 'abandon' })
