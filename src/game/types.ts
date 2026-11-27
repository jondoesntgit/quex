import type { Role } from '../world/types'
import type { DungeonKind } from './deposits'
import type { Detachment } from './garrison'
import type { ActionKind, BuildingId, Good, Goods, HabitEffect, TaskSize } from './data'

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
  /** perfect task days in a row (all of the day's tasks done): each one adds STREAK_STEP to the night's work, up to STREAK_MAX.
   *  Saturdays and frozen days leave it as it is. Unset is 0. */
  taskStreak?: number
  freezes: number
  days: Record<ISODate, DayRecord>
  tokens: Token[]
  lastTick: ISODate | null
  /** the player's first day (missing for players who joined before it was kept) */
  joined?: ISODate
  /** their own colours (#rrggbb) for the border round their land and their villagers' shirts; unset = the default */
  colors?: { border?: string; meeple?: string }
}

export interface Building {
  id: string
  type: BuildingId
  col: number
  row: number
  /** 0..1 construction progress; half tokens build half */
  progress: number
  /** mines: how many levels deep the shaft goes (1 if not set) */
  depth?: number
  /** workshops with several recipes: what it's been ordered to make */
  order?: string
  /** fields: how much of this year's crop was sown (0..1; unset counts as sown, see shift) */
  sown?: number
  /** fields: how much of this year's sowing went in under the rain habit (0..sown; it comes up RAIN_BONUS more); reset with `sown` each winter */
  sownWet?: number
  /** pens: the flock, head by age (index 0 = this year's lambs); unset is the starting flock (see herds.ts) */
  herd?: number[]
}

export interface Village {
  id: string
  playerId: string
  name: string
  /** villages founded before ROLELESS_FROM had a role; it no longer does anything */
  role?: Role
  col: number
  row: number
  population: number
  morale: number
  goods: Goods
  buildings: Building[]
  /** extra territory centres (outposts) */
  outposts: { col: number; row: number }[]
  roads: number[]
  /** people away on neighbours' walls: still the village's, but not at home to work or eat */
  away?: number
  /** false: the player assigns workers by hand (jobs); otherwise the village manages them */
  autoJobs?: boolean
  /** workers by building id, when assigned by hand */
  jobs?: Record<string, number>
  /** when its ox carts are back from a caravan sent without a task */
  oxenBack?: string
  /** the last winter saplings came up on their own around it */
  sprouted?: ISODate
  /** road hexes laid with stone (see caravanCarry) */
  paved?: number[]
  /** the road planner: dirt-road hexes in the order the team digs them (first is next) */
  roadPlan?: number[]
  /** people on the road team, and how much of the hex they are on is done (0..1), as of `roadAt` */
  roadCrew?: number
  roadDone?: number
  roadAt?: string
  /** the city: hexes laid with cobblestone, the village's own first (see city.ts) */
  city?: number[]
  /** homes built in the city, where each stands (ground px from the village hex's centre) */
  homes?: Home[]
  /** the square is laid out in the city (a well here, ground px from the village hex's centre, and `start` homes)
   *  instead of the fixed picture of three town houses on the village hex */
  starter?: { x: number; y: number; /** the open square round the well, ground px (nothing is built nearer) */ square?: number }
  /** the newest groups of immigrants (see immigrants.ts), shown to the player as a note */
  arrivals?: Arrival[]
  /** notices the player has had on any device (see the 'seen' event): arrival ids and `night:<date>` */
  seen?: string[]
  /** the winter whose newcomers have already come */
  welcomed?: ISODate
  /** when the village was founded (unset for villages founded before it was kept: see foundedAt) */
  foundedAt?: string
  /** new villages this one has sent a welcoming caravan to (one each) */
  greeted?: string[]
  /** the last winter night the village went hungry (no newcomers the Sunday after) */
  hungryWinter?: ISODate
  /** last night's work, step by step, shown to the player in the morning (see tick) */
  lastNight?: NightReport
  /** tools the village has made: better kit for fishing, hunting and the harvest (see TOOLS) */
  tools?: string[]

  planted: { cell: number; date: ISODate }[]
  /** hexes whose trees were felled */
  cleared: number[]
  winterForecast: 'stocked' | 'tight' | 'hungry'
  /** today's barters with the merchants: what was bought from each (see game/market) */
  trade?: { date: ISODate; took: Partial<Record<'ship' | 'barge' | 'caravan' | 'pedlar', Goods>>; got?: Partial<Record<'ship' | 'barge' | 'caravan' | 'pedlar', Goods>> }
}

/** One line of a night's breakdown: a building's shift (or the village eating, or food spoiling), what it
 *  changed, and the steps that got there. */
export interface Factor { label: string; value: string }
export interface Source { label: string; delta: Goods; factors: Factor[]; makes?: Good[]; type?: BuildingId }
/** What a night did, kept for the morning report. */
export interface NightReport { date: ISODate; at: string; score: number; prod: number; sources: Source[] }

/** A group of newcomers, kept as a note: who came, from where, and what they brought. */
export interface Arrival {
  id: string
  at: string
  /** 'update': the one-time update counting people one by one; 'winter': the spring influx */
  kind: 'update' | 'winter' | 'food'
  people: number
  /** where they came from ("a farming valley") */
  from: string
  /** what they carried: three days of food */
  goods: Goods
}

/** A home in the city: a cottage or a town house, with the sprite it's drawn with and where it stands. */
export interface Home {
  kind: 'cottage' | 'townhouse' | 'barn'
  /** sprite on the house sheet, e.g. 'c_M_thatch_x_1', 't_tile_y_0' or 'b_thatch' */
  key: string
  /** ground position of its centre, in px from the village hex's centre (screen y is y * 0.5774) */
  x: number
  y: number
  /** which wall the door is on: the front faces the viewer */
  side: 'front' | 'back'
  /** one of the square's starting buildings: part of the picture, housing no one beyond the square's own 30 */
  start?: boolean
}

export interface Caravan {
  id: string
  from: string
  to: string
  goods: Goods
  departAt: string
  arriveAt: string
  /** people who went with it, and when they're home again (there and back) */
  crew?: number
  homeAt?: string
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
  /** people are counted one by one (a world made before CITY_FROM counted households of five, and is converted once) */
  headsScaled?: boolean
  /** cheese is counted in rations (see convertCheese) */
  cheeseRations?: boolean
  /** every village that could has had its square laid out in its city (see placeStarters) */
  startersPlaced?: boolean
  /** every village that could has had its well moved to the corner of its first three cobbled hexes (see moveWells) */
  wellsMoved?: boolean
  /** hexes raised or lowered so a city's square stands on one level: hex -> level (see levelWorld) */
  levelled?: Record<number, number>
  /** the food update's gift of grain has been handed out (see FOOD_UPDATE_FROM) */
  foodUpdate?: boolean
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
  /** clay dug by hand from river and marsh hexes (see clayAt) */
  clayDug?: Record<number, number>
  /** wells dug, by hex (see water.ts) */
  wells?: Record<number, true>
  /** dug-out clay pits that rain has filled: ponds, by hex, with the winter they filled */
  ponds?: Record<number, ISODate>
  /** villages short of workers for their buildings have been given the people (and a house) */
  staffGiven?: boolean
  /** the free wells for herds that had no water have been handed out */
  wellsGiven?: boolean
  /** the last winter riverbanks, marshes and springs filled with clay again */
  clayRenewed?: ISODate
  /** troops lent to each village's palisade, by host village (see garrison.ts) */
  garrisons?: Record<string, Detachment[]>
  /** strongholds besieged, by hex: what's left of them (see strongholds.ts) */
  sieges?: Record<number, { strength: number; fallen?: string; by?: string }>
  /** caravan crews walking home after delivering: back to work when they arrive */
  homeward?: { village: string; crew: number; at: string }[]
  /** dungeons broken into by a mine's shaft, by hex (see deposits.ts) */
  dungeons?: Record<number, { kind: DungeonKind; villageId: string; raids: number; strength: number; found: string }>
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
  | (Base & { t: 'join'; name: string; role?: Role; site: { col: number; row: number }; resetHour: number; tz: number })
  | (Base & { t: 'progress'; date: ISODate; slot: number; status: TaskStatus })
  | (Base & { t: 'habit'; date: ISODate; habitId: string; done: boolean })
  | (Base & { t: 'habitAdd'; habit: Habit })
  | (Base & { t: 'habitRemove'; habitId: string })
  /** set a habit's daily target and unit */
  | (Base & { t: 'habitGoal'; habitId: string; target: number; unit: string })
  /** log progress toward a habit's daily goal (negative to correct a mistake) */
  | (Base & { t: 'drink'; date: ISODate; habitId: string; amount: number })
  | (Base & { t: 'freeze'; date: ISODate })
  | (Base & { t: 'act'; tokenId: string; /** a second half-done token, merged with the first into a whole action */ tokenId2?: string; action: ActionKind; col: number; row: number; building?: BuildingId; to?: string; goods?: Goods; /** troops sent to a neighbour's palisade */ troops?: number; /** a caravan's people, and the food they take for the road */ crew?: number; food?: Goods; /** a welcoming caravan to a new village: no action needed (see welcomeOpen) */ welcome?: boolean; /** a home built in the city (for an upgrade, the town house that replaces the cottage at `replace`) */ home?: Home; replace?: number })
  | (Base & { t: 'tick'; date: ISODate })
  | (Base & { t: 'resetHour'; hour: number })
  /** change the player's display name (themselves, or a guardian for them) */
  | (Base & { t: 'rename'; name: string })
  /** the road planner: the hexes to dig, in order of priority, and/or how many people are on the team */
  /** the server's hourly nudge: road teams dig up to this moment (digRoads runs on every event; this one only carries the time) */
  | (Base & { t: 'roads' })
  | (Base & { t: 'roadplan'; plan?: { col: number; row: number }[]; crew?: number })
  /** pick the colours of the player's borders and villagers (null puts the default back; a missing key is left alone) */
  | (Base & { t: 'colors'; border?: string | null; meeple?: string | null })
  /** the player has had these notices (arrival ids, `night:<date>` for a morning report), on any device */
  | (Base & { t: 'seen'; ids: string[] })
  /** barter with a merchant calling at the village today (game/market) */
  | (Base & { t: 'barter'; merchant: 'ship' | 'barge' | 'caravan' | 'pedlar'; give: Goods; take: Goods })
  /** give up this village entirely; the player can found a new one */
  | (Base & { t: 'abandon' })
  /** who works where: the village decides (auto), or the player assigns by building id */
  | (Base & { t: 'jobs'; auto: boolean; jobs?: Record<string, number> })
  /** tell a workshop with several recipes which to make */
  | (Base & { t: 'order'; building: string; recipe: string })
  /** make a tool (see TOOLS): the goods are spent, the village is better at its work from then on */
  | (Base & { t: 'equip'; tool: string })
  /** split a whole action into smaller ones: big → medium + small, medium → two small (never the other way) */
  | (Base & { t: 'split'; tokenId: string })
  /** a palisade's host takes in troops waiting at the gate, or sends them home */
  | (Base & { t: 'garrison'; detachment: string; accept: boolean })
