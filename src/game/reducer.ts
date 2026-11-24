/** The whole game is: world seed + ordered list of events -> state.
 *  `apply` is deterministic (all randomness is seeded from event ids), so every
 *  client replaying the same log sees the same world. Invalid events are
 *  ignored with a log line rather than throwing, because logs are shared.
 */
import { distance, line, neighbours, spiral } from '../world/hex'
import { rngFor } from '../world/rng'
import { hasTrees, isOpen, isVillageSite, MOUNTAIN_TERRAIN, treeCount, type Land } from '../world/land'
import type { Feature, Resource, Terrain, World } from '../world/types'
import { addDays, CROP_SEASON, daysBetween, isSabbath, playerDate, weekSeason, weekday } from './calendar'
import {
  ACTIONS, BUILDINGS, FUEL_PEOPLE, ROAD_TEAM, TOOLS, producesIn, toolMult, DEEPEN_COST, EAT, FOOD_SCALE, GOOD_LABEL, foodUnit, gatherAmount, SALT_PER_OLD, HEADS, type BuildingId, FOOD, GATHER, HABIT_PRESETS, MAX_DEPTH, MAX_HABIT_SLOTS, MINE_RATE, ORES, PERFECT_DAYS_PER_SLOT, STATION_RATE, stationOres,
  PLAN_SIZES, SIZE_POINTS, SIZE_RANK, type ActionKind, type BuildingDef, type Good, type Goods, type TaskSize,
} from './data'
import { barterProblem, noteTrade, weightOf } from './market'
import { influx, originFor, travelFood, TRAVEL_DAYS } from './immigrants'
import { CITY_RADIUS, COBBLE_COST, HOMES, claimCity, starterFor, homeFits, homesCap, hexAt, paveable, validKey } from './city'
import { THIRST, THIRSTY, WELL_COST, clayLeft, clayRenews, hasWater, waterAt, winterWater } from './water'
import { CARRY_EACH, people, spare, staffing, needOf } from './workers'
import { CULL_RATE, FEED_PER_HEAD, LEAN_CULL, LEAN_DAYS, age, dailyYield, heads, lamb, mutton, pastureCap, sheepOf, slaughter } from './herds'
import { strongholdAt, wallsAfter } from './strongholds'
export { clayAt, clayLeft, clayRenews, mountainSpring } from './water'
import { GEAR, PER_PALISADE, RATION, WAIT_DAYS, eat, foodValue, garrison, gearWith, nightsOf, troopsAt, type Detachment } from './garrison'
import { type Odds, CLEARED_FIELD_BONUS, DEPLETION_FROM, DUNGEON, HUNT_SHARE, dig, dungeonUnder, gameLeft, hunt, huntRange, leftAt, levels, mineDig, stonyness } from './deposits'
import type { Arrival, Building, DayRecord, GameEvent, GameState, ISODate, LogEntry, Player, Token, Village } from './types'

export function newGame(world: World, seasonStart: ISODate): GameState {
  return {
    headsScaled: true,
    cheeseRations: true,
    startersPlaced: true,
    foodUpdate: true,
    worldSeed: world.seed,
    seasonStart,
    players: {},
    villages: {},
    caravans: [],
    lairs: world.lairs.map((l) => ({ ...l, cleared: false })),
    revealed: [],
    log: [],
    woods: {},
    version: 0,
  }
}

// ------------------------------------------------------------------ selectors

export function ensureDay(p: Player, date: ISODate): DayRecord {
  return (p.days[date] ??= {
    date, slots: PLAN_SIZES.map((size) => ({ size, status: 'none' })), habitsDone: [], frozen: false, ticked: false,
  })
}

/** How far a scouting party sees: three hexes with a whole action, two with half; a Scout camp adds one. */
export function scoutRadius(v: Village, strength: number): number {
  return (strength >= 1 ? 3 : 2) + (done(v).some((b) => b.type === 'scout_camp') ? 1 : 0)
}

/** Would scouting from this hex show any land you haven't seen? (A hex of unknown land always would.) */
export function scoutsNew(world: World, s: GameState, col: number, row: number, radius: number): boolean {
  return spiral({ col, row }, radius).some((o) => o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height && !s.revealed.includes(cellIndex(world, o.col, o.row)))
}

export function dayScore(d: DayRecord | undefined): number {
  if (!d) return 0
  return d.slots.reduce((a, s) => a + SIZE_POINTS[s.size] * (s.status === 'full' ? 1 : s.status === 'half' ? 0.5 : 0), 0)
}

export function cellIndex(world: World, col: number, row: number) {
  return row * world.width + col
}

/** An outpost holds one hex more than the radius it was founded with (a camp 1, a full outpost 2). */
export function outpostRadius(o: object): number {
  return ((o as { radius?: number }).radius ?? 1) + 1
}

export function territory(v: Village): { col: number; row: number; radius: number }[] {
  return [{ col: v.col, row: v.row, radius: VILLAGE_RADIUS }, ...v.outposts.map((o) => ({ col: o.col, row: o.row, radius: outpostRadius(o) }))]
}

export function inTerritory(v: Village, col: number, row: number): boolean {
  return territory(v).some((t) => distance(t, { col, row }) <= t.radius)
}

export function territoryCells(world: World, v: Village): number[] {
  const out = new Set<number>()
  for (const t of territory(v)) {
    for (const o of spiral(t, t.radius)) {
      if (o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height) out.add(cellIndex(world, o.col, o.row))
    }
  }
  return [...out]
}

/** Village territory radius, and the empty hexes required between a new
 *  village's territory and anyone else's. */
/** Rules that changed on 2026-11-18 apply only to events from this moment on,
 *  so replaying older events still gives everyone the villages they had:
 *  - half-done (½) action tokens can no longer be spent (alone: see spentToken);
 *  - unspent tokens last until the end of winter (Saturday night) instead of a day
 *    (and from KEEP_TOKENS_FROM, for good). */
export const WEEKLY_TOKENS_FROM = '2026-11-18T22:00:00.000Z'
/** From this moment unspent actions never expire: they keep until the world's
 *  season ends (before it, winter cleared them each Saturday night). */
export const KEEP_TOKENS_FROM = '2026-11-21T12:00:00.000Z'

/** From this moment Saturday is the Sabbath: there are no tasks to tick (only
 *  habits), and the night counts the day like a frozen one, so resting never
 *  costs the village morale or growth. */
export const SABBATH_FROM = '2026-11-21T12:00:00.000Z'
/** A Sabbath's score for the night's tick: the same floor a freeze gives. */
const REST_SCORE = 60
/** Morale a village needs before newcomers settle. */
export const GROW_MORALE = 45
/** From this moment, yesterday's tasks can still be ticked off (raised, never
 *  lowered) after its night has passed: the late ticks earn their action and
 *  score, and the village gets the extra share of that night's harvest. */
export const LATE_TICKS_FROM = '2026-11-19T02:15:00.000Z'

/** From this moment a road across a river is a bridge: it needs a medium task. */
export const BRIDGES_FROM = '2026-11-19T03:30:00.000Z'

/** Does this hex carry a river (where a road would need a bridge)? */
export function hasRiver(world: World, col: number, row: number) {
  const c = world.cells[cellIndex(world, col, row)]
  return !!c && c.riverTo !== -1 && c.tier > 0
}

/** The task size an action needs here: a road over a river is a bridge (medium). */
export function actionSize(world: World, action: ActionKind, col: number, row: number, at: string): TaskSize {
  if (action === 'road' && at >= BRIDGES_FROM && hasRiver(world, col, row)) return 'medium'
  return ACTIONS[action].size
}

/** Is this a late tick: raising a task on a day whose night has already passed, the day before the event's own day? */
function lateTick(p: Player, ev: { at: string; date: ISODate }) {
  return ev.at >= LATE_TICKS_FROM && !!p.days[ev.date]?.ticked && ev.date === addDays(playerDate(ev.at, p.resetHour, p.tz), -1)
}

export const VILLAGE_RADIUS = 3
export const FOUNDING_GAP = 3 // empty hexes between territories: new villages stand at least 2 * VILLAGE_RADIUS + FOUNDING_GAP + 1 = 10 hexes apart

/** Why a village can't be founded here (null = fine). */
export function foundingProblem(s: GameState, world: World, site: { col: number; row: number }): string | null {
  const cell = world.cells[cellIndex(world, site.col, site.row)]
  if (!cell || site.col < 0 || site.row < 0 || site.col >= world.width || site.row >= world.height) return 'Off the map'
  if (cell.tier === 0) return 'Villages must be on land'
  const land = landAt(world, s, cellIndex(world, site.col, site.row))
  if (MOUNTAIN_TERRAIN.includes(land.terrain)) return 'Too steep: a village needs flat ground'
  else if (hasTrees(land)) return 'Thick woods: settle on open ground nearby (you can fell trees later)'
  else if (land.terrain === 'swamp') return 'Too boggy for a village square'
  else if (!isVillageSite(land)) return 'Too hilly for a village square: try the flat land below'
  if (s.lairs.some((l) => !l.cleared && l.col === site.col && l.row === site.row)) return 'Monsters live here'
  for (const v of Object.values(s.villages)) {
    if (territory(v).some((t) => distance(t, site) <= t.radius + VILLAGE_RADIUS + FOUNDING_GAP))
      return `Too close to ${v.name}`
  }
  return null
}

/** Every hex where founding is blocked by a neighbour (for map tinting). */
export function foundingBlockedCells(world: World, s: GameState): number[] {
  const out = new Set<number>()
  for (const v of Object.values(s.villages)) {
    for (const t of territory(v)) {
      for (const o of spiral(t, t.radius + VILLAGE_RADIUS + FOUNDING_GAP)) {
        if (o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height) out.add(cellIndex(world, o.col, o.row))
      }
    }
  }
  return [...out]
}

export interface LandNow extends Land {
  resource: Resource | null
  /** stumps among the trees (felled ones that haven't regrown yet) */
  stumps?: number
}

const WOOD_RESOURCES: readonly Resource[] = ['timber', 'game', 'berries']

/** A hex after player changes: felled trees leave open grass (and no more
 *  woodland resource); planted saplings grow into forest after 3 days. */
export function landAt(world: World, s: GameState, i: number, today?: ISODate): LandNow {
  const cell = world.cells[i]
  let terrain: Terrain = cell.terrain
  let feature: Feature | null = cell.feature
  let resource = cell.resource
  for (const v of Object.values(s.villages)) {
    if (v.cleared?.includes(i)) {
      feature = null
      if (terrain === 'forest') terrain = 'grass'
      if (resource && WOOD_RESOURCES.includes(resource)) resource = null
    }
    const p = v.planted.find((x) => x.cell === i)
    if (p) {
      const grown = !today || daysBetween(p.date, today) >= 3
      if (grown) terrain = 'forest'
      feature = grown ? 'oak3' : 'oak1'
    }
  }
  const w = s.woods?.[i]
  if (w) {
    const forest = terrain === 'forest'
    const open: Terrain = forest ? 'grass' : terrain
    const wood = resource && WOOD_RESOURCES.includes(resource) ? null : resource
    if (w.n > 0) {
      feature = `${w.kind}${w.max}` as Feature
      // planted trees make a forest once there are two of them
      return { terrain: forest || w.n >= 2 ? 'forest' : terrain, feature, resource, tier: cell.tier, stumps: w.max - w.n }
    }
    return { terrain: open, feature: w.young > 0 ? 'saplings' : null, resource: wood, tier: cell.tier }
  }
  return { terrain, feature, resource, tier: cell.tier }
}

/** Each winter: saplings become trees, and standing trees double up to the hex's number. */
function growWoods(s: GameState, world: World, winterDate: ISODate) {
  for (const [k, w] of Object.entries(s.woods ?? {})) {
    if (w.since > winterDate || (w.grew && w.grew >= winterDate)) continue
    if (w.young > 0) { w.n += w.young; w.young = 0 }
    else w.n = Math.min(w.max, w.n * 2)
    w.grew = winterDate
    const cell = world.cells[Number(k)]
    // back to how the world made it (planted woods on open land stay on the books)
    if (w.n >= w.max && w.max === treeCount(cell) && cell.feature?.startsWith(w.kind)) delete s.woods![Number(k)]
  }
}

/** Land where seedlings take: not deserts, beaches, bare mountain or snow. */
const SPROUTS: Terrain[] = ['grass', 'meadow', 'forest', 'hills', 'savannah', 'swamp', 'tundra']

/** Each winter a few saplings come up on their own on bare land in and around a
 *  village (birds and wind carry the seeds), so no place stays treeless for
 *  long. Not on anything built, a road, a field, or ground being worked. */
function sprout(s: GameState, world: World, v: Village, winterDate: ISODate) {
  if (v.sprouted === winterDate) return
  v.sprouted = winterDate
  const rng = rngFor(world.seed, 'sprout', v.id, winterDate)
  const taken = new Set<number>()
  for (const o of Object.values(s.villages)) {
    taken.add(cellIndex(world, o.col, o.row))
    for (const b of o.buildings) taken.add(cellIndex(world, b.col, b.row))
    for (const x of o.outposts) taken.add(cellIndex(world, x.col, x.row))
    for (const r of o.roads) taken.add(r)
  }
  const spots = territory(v).flatMap((t) => spiral(t, t.radius + 1))
    .filter((o) => o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height)
    .map((o) => cellIndex(world, o.col, o.row))
    .filter((i, k, all) => all.indexOf(i) === k && !taken.has(i) && !s.woods?.[i]
      && SPROUTS.includes(landAt(world, s, i).terrain) && !hasTrees(landAt(world, s, i)))
  const woods = (s.woods ??= {})
  for (let k = 0; k < 2 && spots.length; k++) {
    const i = spots.splice(Math.floor(rng() * spots.length), 1)[0]
    const c = world.cells[i]
    const kind = c.terrain === 'tundra' || c.feature?.startsWith('pine') ? 'pine' : 'oak'
    // they grow into trees next winter, like planted ones
    woods[i] = { n: 0, young: 1 + Math.floor(rng() * 2), max: Math.max(2, treeCount(c)), kind, since: winterDate, grew: winterDate }
  }
}

export function effectiveTerrain(world: World, s: GameState, i: number, today?: ISODate): Terrain {
  return landAt(world, s, i, today).terrain
}

export function buildingAt(s: GameState, col: number, row: number) {
  for (const v of Object.values(s.villages)) {
    const b = v.buildings.find((b) => b.col === col && b.row === row)
    if (b) return { village: v, building: b }
  }
  return null
}

export function villageAt(s: GameState, col: number, row: number) {
  return Object.values(s.villages).find((v) => v.col === col && v.row === row) ?? null
}

/** What the village square itself holds (the town houses round the well). */
export const BASE_CAP = 6 * HEADS
export function popCap(v: Village) {
  return BASE_CAP + done(v).reduce((a, b) => a + (BUILDINGS[b.type].popCap ?? 0), 0) + homesCap(v)
}

export function defence(v: Village) {
  return 2 + done(v).reduce((a, b) => a + (BUILDINGS[b.type].defence ?? 0), 0)
}

/** Finished palisades: each holds PER_PALISADE lent troops. */
export const palisades = (v: Village) => done(v).filter((b) => b.type === 'palisade').length

/** Troops walk home and disband: people and gear back to their village, with any food left. */
function sendHome(s: GameState, host: Village, d: Detachment, at: string, why: string) {
  s.garrisons![host.id] = garrison(s, host).filter((x) => x.id !== d.id)
  const from = s.villages[d.from]
  if (from) {
    from.away = Math.max(0, (from.away ?? 0) - d.troops)
    addGoods(from, d.gear)
    addGoods(from, d.food)
  }
  const back = [fmtGoods(d.gear), fmtGoods(d.food)].filter(Boolean).join(', ')
  log(s, at, from?.playerId ?? host.playerId, `${d.troops} troops from ${from ? V(from) : 'afar'} at ${V(host)}'s palisade ${why}.${from && back ? ` They brought home ${back}.` : ''}`, 'info')
}

export function power(v: Village) {
  const g = v.goods
  return people(v) / HEADS + defence(v) * 1.5 + Math.min(g.bronze ?? 0, 5) * 2 + Math.min(g.iron ?? 0, 5) * 2.5 + Math.min(g.steel ?? 0, 5) * 4
}

export function done(v: Village) {
  return v.buildings.filter((b) => b.progress >= 1)
}

export function storageCap(v: Village) {
  return FOOD_SCALE * (30 + done(v).reduce((a, b) => a + (BUILDINGS[b.type].storage ?? 0), 0))
}

export function foodStock(v: Village, keepsOnly = false) {
  let t = 0
  for (const [g, f] of Object.entries(FOOD)) if (f && (!keepsOnly || f.keeps)) t += (v.goods[g as Good] ?? 0) * f.value
  return t
}

/** Villages had a role until ROLELESS_FROM: other roles' buildings cost double,
 *  their own made 25% more. Now any village builds anything at the same price;
 *  specialising is a choice players make together, not a rule. */
export const ROLELESS_FROM = '2026-11-22T14:30:00.000Z'
const onRole = (v: Village, def: BuildingDef, at: string) => at < ROLELESS_FROM && def.role === v.role

/** Can this building stand on this hex at all (the ground, the water, the deposit, the shore)? Says why not.
 *  Leaves out what is already built here, what it needs first and what it costs: the build list uses this
 *  to show only what the hex could take. */
export function buildSiteError(world: World, s: GameState, v: Village, def: BuildingDef, col: number, row: number): string | null {
  const i = cellIndex(world, col, row)
  const cell = world.cells[i]
  const land = landAt(world, s, i)
  const terr = land.terrain
  if (!inTerritory(v, col, row)) return 'Only inside your territory'
  if (def.shallows) {
    // docks and shipyards stand out in the shallows, reached from your own shore
    if (cell.tier > 0) return `${def.name} is built out over the shallows, not on land`
    if (terr !== 'shallow') return `${def.name} needs the shallows: the water is too deep out here`
    const shore = neighbours(col, row).some(([nc, nr]) => nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && world.cells[nr * world.width + nc].tier > 0 && inTerritory(v, nc, nr))
    if (!shore) return `${def.name} has to reach out from your own shore`
  } else if (cell.tier === 0) return 'Not on water'
  if (v.city?.includes(i)) return 'This is cobbled city: homes go here, workshops need open ground'
  if (col === v.col && row === v.row) return 'That is your village square'
  const woodland = def.terrain?.includes('forest')
  if (hasTrees(land) && !woodland) return 'Fell the trees here first'
  if (MOUNTAIN_TERRAIN.includes(terr) && !def.mountain) return 'Too steep: only mines and quarries go on a mountain'
  if (terr === 'swamp' && !def.terrain?.includes('swamp')) return 'Too boggy to build on'
  if (def.terrain && !def.terrain.includes(terr)) return `${def.name} needs ${def.terrain.join('/')}`
  if (def.resource && !(land.resource && def.resource.includes(land.resource))) return `${def.name} needs a ${def.resource.join('/')} deposit`
  if (def.nearTerrain && !spiral({ col, row }, 1).some((o) => {
    if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) return false
    const j = cellIndex(world, o.col, o.row)
    // a river will do as well as the sea, for a fishery
    if (def.river && world.cells[j]?.riverTo !== -1 && world.cells[j]?.tier !== 0) return true
    return def.nearTerrain!.includes(effectiveTerrain(world, s, j))
  })) return `${def.name} must be next to ${def.nearTerrain.join('/')}${def.river ? ' or a river' : ''}`
  return null
}

export function buildCost(v: Village, def: BuildingDef, at: string): Goods {
  const k = at >= ROLELESS_FROM || def.role === 'any' || def.role === v.role ? 1 : 2
  const out: Goods = {}
  for (const [g, n] of Object.entries(def.cost)) out[g as Good] = (n ?? 0) * k
  return out
}

/** What pulling a building down gives back: all the materials that went into it (a half-built one, half). */
export function refundOf(v: Village, b: Building, at: string): Goods {
  const out: Goods = {}
  for (const [g, n] of Object.entries(buildCost(v, BUILDINGS[b.type], at))) out[g as Good] = round2((n ?? 0) * Math.min(1, b.progress))
  return out
}

function hasGoods(v: Village, g: Goods, k = 1) {
  return Object.entries(g).every(([name, n]) => (v.goods[name as Good] ?? 0) + 1e-9 >= (n ?? 0) * k)
}

function addGoods(v: Village, g: Goods, k = 1) {
  for (const [name, n] of Object.entries(g)) {
    const key = name as Good
    v.goods[key] = round2((v.goods[key] ?? 0) + (n ?? 0) * k)
    if ((v.goods[key] ?? 0) <= 1e-6) delete v.goods[key]
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100
/** The weekday season on a player's calendar at a moment. */
const seasonAt = (p: Player, at: string) => weekSeason(playerDate(at, p.resetHour, p.tz))

// ------------------------------------------------------------------ validation

/** Returns null if the event is legal, otherwise a human-readable reason. */
export function validate(s: GameState, world: World, ev: GameEvent): string | null {
  const p = s.players[ev.playerId]
  if (ev.t === 'join') {
    if (p) return 'Already joined'
    return foundingProblem(s, world, ev.site)
  }
  if (!p) return 'Unknown player'
  const v = s.villages[p.villageId]
  switch (ev.t) {
    case 'progress': {
      const d = p.days[ev.date]
      if (ev.slot < 0 || ev.slot >= PLAN_SIZES.length) return 'No such slot'
      if (isSabbath(ev.date) && ev.at >= SABBATH_FROM) return 'Saturday is a day of rest: no tasks, just your habits'
      if (d?.ticked) {
        if (!lateTick(p, ev)) return 'That day is already over'
        const val = (st: string) => (st === 'full' ? 1 : st === 'half' ? 0.5 : 0)
        if (val(ev.status) <= val(d.slots[ev.slot]?.status ?? 'none')) return "Yesterday's tasks can only be ticked off, not undone"
      }
      return null
    }
    case 'habit':
      if (!p.habits.some((h) => h.id === ev.habitId)) return 'Unknown habit'
      if (p.days[ev.date]?.ticked) return 'That day is already over'
      return null
    case 'habitAdd':
      if (p.habits.length >= p.habitSlots) return `All ${p.habitSlots} habit slot(s) in use — keep a perfect week to unlock another`
      if (p.habits.some((h) => h.id === ev.habit.id)) return 'Already tracking that habit'
      return null
    case 'habitRemove':
      return null
    case 'habitGoal': {
      if (!p.habits.some((h) => h.id === ev.habitId)) return 'Unknown habit'
      if (!(ev.target > 0) || ev.target > 100_000) return 'Pick a target above zero'
      const unit = ev.unit.trim()
      if (!unit || unit.length > 12) return 'Pick a short unit, like cups or ml'
      return null
    }
    case 'drink': {
      const h = p.habits.find((x) => x.id === ev.habitId)
      if (!h) return 'Unknown habit'
      if (!h.goal) return 'Set a daily target first'
      if (!Number.isFinite(ev.amount) || ev.amount === 0 || Math.abs(ev.amount) > 100_000) return 'Enter an amount'
      if (p.days[ev.date]?.ticked) return 'That day is already over'
      return null
    }
    case 'freeze':
      if (isSabbath(ev.date) && ev.at >= SABBATH_FROM) return 'Saturday is already a day of rest'
      if (p.freezes <= 0) return 'No freezes left this week'
      if (p.days[ev.date]?.frozen) return 'Already frozen'
      if (p.days[ev.date]?.ticked) return 'That day is already over'
      return null
    case 'abandon':
      return null
    case 'jobs': {
      if (ev.auto) return null
      const j = ev.jobs ?? {}
      const ids = new Set(v.buildings.map((b) => b.id))
      for (const [id, n] of Object.entries(j)) {
        if (!ids.has(id)) return 'No such building'
        if (!Number.isInteger(n) || n < 0) return 'Whole people only'
        const b = v.buildings.find((x) => x.id === id)
        if (b && n > needOf(b)) return `${BUILDINGS[b.type].name} takes at most ${needOf(b)}`
      }
      if (Object.values(j).reduce((a, n) => a + n, 0) > people(v)) return `Only ${people(v)} people at home`
      return null
    }
    case 'equip': {
      const t = TOOLS[ev.tool]
      if (!t) return 'No such tool'
      if (v.tools?.includes(t.id)) return `You already have ${t.name.toLowerCase()}`
      if (t.needs && !done(v).some((b) => b.type === t.needs)) return `Build a ${BUILDINGS[t.needs].name} first`
      if (t.after && !v.tools?.includes(t.after)) return `Make ${TOOLS[t.after].name.toLowerCase()} first`
      if (!hasGoods(v, t.cost, 1)) return `Needs ${fmtGoods(t.cost, 1)}`
      return null
    }
    case 'order': {
      const b = v.buildings.find((x) => x.id === ev.building)
      if (!b) return 'No such building'
      if (!BUILDINGS[b.type].recipes?.some((r) => r.id === ev.recipe)) return "It can't make that"
      return null
    }
    case 'split': {
      const t = p.tokens.find((x) => x.id === ev.tokenId)
      if (!t) return 'That action has been used'
      if (t.strength < 1) return "A half-done action can't be split"
      if (t.size === 'small') return 'A small action is as small as they come'
      return null
    }
    case 'garrison': {
      const d = garrison(s, v).find((x) => x.id === ev.detachment)
      if (!d) return 'No such troops at your palisade'
      if (ev.accept && d.status === 'stationed') return 'They are already on your walls'
      if (ev.accept && troopsAt(s, v) + d.troops > palisades(v) * PER_PALISADE) return 'No room on the walls for them'
      return null
    }
    case 'rename': {
      const n = ev.name.trim()
      if (!n) return 'Pick a name'
      if (n.length > 20) return 'Names are at most 20 letters'
      return n === p.name ? 'That is already the name' : null
    }
    case 'roadplan': {
      if (ev.plan === undefined && ev.crew === undefined) return 'Nothing to change'
      if (ev.plan) {
        if (ev.plan.length > 80) return 'Plan at most 80 hexes at a time'
        const seen = new Set<number>()
        for (const h of ev.plan) {
          if (!Number.isInteger(h.col) || !Number.isInteger(h.row) || h.col < 0 || h.row < 0 || h.col >= world.width || h.row >= world.height) return 'That is not a hex'
          const j = cellIndex(world, h.col, h.row)
          if (seen.has(j)) return 'A hex is on the plan twice'
          seen.add(j)
          if (world.cells[j].tier === 0) return 'Roads need land'
          if (!territory(v).some((t) => distance(t, h) <= t.radius + 1)) return 'Roads must start from your territory'
          if (v.roads.includes(j)) return 'Already a road'
        }
      }
      if (ev.crew !== undefined && (!Number.isInteger(ev.crew) || ev.crew < 0 || ev.crew > people(v))) return `The team can be at most ${people(v)} people`
      return null
    }
    case 'colors': {
      for (const c of [ev.border, ev.meeple]) if (c != null && !/^#[0-9a-f]{6}$/i.test(c)) return 'Colours look like #aabbcc'
      return ev.border === undefined && ev.meeple === undefined ? 'Pick a colour' : null
    }
    case 'resetHour':
      if (p.resetChangedAt && daysBetween(p.resetChangedAt.slice(0, 10), ev.at.slice(0, 10)) < 7)
        return 'Bedtime can only change once a week'
      return null
    case 'tick':
      if (p.days[ev.date]?.ticked) return 'Already ticked'
      if (p.lastTick && ev.date <= p.lastTick) return 'Already ticked'
      return null
    case 'act':
      return validateAct(s, world, p, v, ev)
    case 'barter':
      return barterProblem(world, s, v, playerDate(ev.at, p.resetHour, p.tz), ev)
  }
}

/** The action an act spends: one token, or two half-done tokens of the same
 *  size merged into a whole action of that size. A string is why it can't. */
/** The token id of an action that costs no task (a caravan on paved road the whole way). */
export const FREE = 'free'

export function spentToken(p: Player, ev: { tokenId: string; tokenId2?: string }): Token | string {
  if (ev.tokenId === FREE && !ev.tokenId2) return { id: FREE, size: 'small', strength: 1, date: '', slot: -1 }
  const tok = p.tokens.find((t) => t.id === ev.tokenId)
  if (!tok) return 'That action token has been used'
  if (!ev.tokenId2) return tok
  const tok2 = p.tokens.find((t) => t.id === ev.tokenId2)
  if (!tok2 || tok2.id === tok.id) return 'That action token has been used'
  if (tok.strength >= 1 || tok2.strength >= 1) return 'Only half-done actions merge'
  if (tok.size !== tok2.size) return 'Only half-done actions of the same size merge'
  return { ...tok, strength: Math.min(1, tok.strength + tok2.strength) }
}

function validateAct(s: GameState, world: World, p: Player, v: Village, ev: Extract<GameEvent, { t: 'act' }>): string | null {
  const tok = spentToken(p, ev)
  if (typeof tok === 'string') return tok
  if (tok.strength < 1 && ev.at >= WEEKLY_TOKENS_FROM) return 'Finish the task to use this action'
  const dest = ev.action === 'caravan' && ev.to ? s.villages[ev.to] : null
  const tier = dest && dest.id !== v.id ? caravanTier(world, s, v, dest) : null
  if (tok.id === FREE) {
    if (tier !== 'free') return 'Only a caravan on paved road the whole way goes without a task'
    if (!done(v).some((b) => b.type === 'cart_shed') || !done(v).some((b) => b.type === 'stable')) return 'A caravan without a task needs ox carts (a Mule stable and a Cart shed)'
    if (v.oxenBack && ev.at < v.oxenBack) return 'Your oxen are still on the road home'
  }
  const need = tier ? (tier === 'medium' ? 'medium' : 'small') : actionSize(world, ev.action, ev.col, ev.row, ev.at)
  if (ev.action === 'build') {
    const def = ev.building && BUILDINGS[ev.building]
    if (!def) return 'Unknown building'
    if (SIZE_RANK[tok.size] < SIZE_RANK[def.size]) return `${def.name} needs a ${def.size} task`
  } else if (ev.action === 'home' || ev.action === 'upgrade') {
    const def = ev.action === 'upgrade' ? HOMES.townhouse : ev.home && HOMES[ev.home.kind]
    if (!def) return 'Pick a home to build'
    if (SIZE_RANK[tok.size] < SIZE_RANK[def.size]) return `A ${def.name} needs a ${def.size} task`
  } else if (SIZE_RANK[tok.size] < SIZE_RANK[need]) return ev.action === 'road' && need === 'medium' ? 'A bridge needs a medium task' : `${ACTIONS[ev.action].name} needs a ${need} task`
  if (ev.col < 0 || ev.row < 0 || ev.col >= world.width || ev.row >= world.height) return 'Off the map'
  const i = cellIndex(world, ev.col, ev.row)
  const cell = world.cells[i]
  const revealed = s.revealed.includes(i)
  const land = landAt(world, s, i)
  const terr = land.terrain
  switch (ev.action) {
    case 'scout': {
      // on land you've seen already, scouting is only for what lies beyond it
      if (revealed) return scoutsNew(world, s, ev.col, ev.row, scoutRadius(v, tok.strength)) ? null : 'Nothing new to uncover here: the land around it is explored'
      const near = spiral(ev, 1).some((o) => s.revealed.includes(cellIndex(world, o.col, o.row)))
      return near ? null : 'Scout from the edge of what you know'
    }
    case 'gather': {
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (!land.resource || !GATHER[land.resource]) return 'Nothing to gather here'
      if (ev.at >= DEPLETION_FROM) {
        const left = leftAt(world, s, i)
        if (left && left.good === GATHER[land.resource] && left.surface < 1)
          return left.deep >= 1 ? 'Worked out at the surface: a mine could reach the rest' : 'Worked out: nothing left here'
        if (land.resource === 'game' && gameLeft(world, s, i, playerDate(ev.at, p.resetHour, p.tz)) < 1)
          return 'Hunted out: the animals come back slowly'
      }
      return null
    }
    case 'pick': {
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      const left = leftAt(world, s, i)
      if (!left || left.ore !== 'stone') return 'No loose stone here'
      if (left.surface < 1) return left.deep >= 1 ? 'Picked clean: a quarry could cut the rock below' : 'Picked clean'
      return null
    }
    case 'rice':
      if (terr !== 'swamp') return 'Wild rice grows in the marshes'
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (buildingAt(s, ev.col, ev.row) || villageAt(s, ev.col, ev.row)) return 'Something is built here'
      return null
    case 'peat':
      if (terr !== 'swamp') return 'Peat is cut from swamp and bog'
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (buildingAt(s, ev.col, ev.row) || villageAt(s, ev.col, ev.row)) return 'Something is built here'
      return null
    case 'chop':
    case 'clear':
      if (!hasTrees(land)) return 'No trees to fell here'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 1)) return 'Only in or next to your territory'
      if (buildingAt(s, ev.col, ev.row) || villageAt(s, ev.col, ev.row)) return 'Something is built here'
      return null
    case 'plant':
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (!['grass', 'meadow', 'savannah', 'hills'].includes(terr)) return 'Trees need open grassland'
      if (hasTrees(land)) return 'There are trees here already'
      if (buildingAt(s, ev.col, ev.row) || villageAt(s, ev.col, ev.row) || v.planted.some((x) => x.cell === i)) return 'Something is already here'
      if (s.woods?.[i]?.young) return 'Saplings are already growing here'
      return null
    case 'road':
      if (cell.tier === 0) return 'Roads need land'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 1)) return 'Roads must start from your territory'
      if (v.roads.includes(i)) return 'Already a road'
      return null
    case 'cobble': return cobbleError(world, s, v, i)
    case 'home': {
      const h = ev.home, def = h && HOMES[h.kind]
      if (!h || !def) return 'Pick a home to build'
      if (!validKey(h.kind, h.key) || !Number.isFinite(h.x) || !Number.isFinite(h.y) || (h.side !== 'front' && h.side !== 'back')) return 'That is not a home'
      if (!v.city?.length) return 'Lay cobblestone first'
      if (hexAt(world, v, [h.x, h.y]) !== i) return 'That home is not on this hex'
      if (!hasGoods(v, def.cost)) return `Needs ${fmtGoods(def.cost)}`
      return homeFits(world, v, h) ? null : 'No room for that there: it would cover a door or block the way'
    }
    case 'upgrade': {
      const h = ev.home, k = ev.replace, def = HOMES.townhouse
      if (!h || h.kind !== 'townhouse' || !validKey('townhouse', h.key) || !Number.isFinite(h.x) || !Number.isFinite(h.y) || (h.side !== 'front' && h.side !== 'back')) return 'That is not a town house'
      const old = k === undefined ? undefined : v.homes?.[k]
      if (!old || old.kind !== 'cottage') return 'Pick a cottage to rebuild'
      // the hex is where the cottage stands (the town house reaches back from its front, and may lean into the next hex)
      if (hexAt(world, v, [old.x, old.y]) !== i) return 'That cottage is not on this hex'
      if (!hasGoods(v, def.cost)) return `Needs ${fmtGoods(def.cost)}`
      const without = { ...v, homes: v.homes!.filter((_, n) => n !== k) }
      return homeFits(world, without, h) ? null : 'No room for a town house there: it would cover a door, hide a home or block the way'
    }
    case 'pave':
      if (!v.roads.includes(i)) return 'Only one of your roads'
      if (v.paved?.includes(i)) return 'Already paved'
      if (!hasGoods(v, PAVE_COST)) return `Paving takes ${fmtGoods(PAVE_COST)}`
      return null
    case 'well':
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (cell.tier === 0) return 'Not in the water'
      if (waterAt(world, s, i)) return 'There is water here already'
      if (!hasGoods(v, WELL_COST)) return `A well takes ${fmtGoods(WELL_COST)}`
      return null
    case 'dig_clay': {
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      const left = clayLeft(world, s, i)
      if (left === null) return 'No clay here: try a riverbank, a marsh, open plains or the hills'
      if (left < 1) return 'Dug out: no more clay here'
      return null
    }
    case 'build': {
      const def = BUILDINGS[ev.building!]
      const existing = buildingAt(s, ev.col, ev.row)
      // building over one of your own pulls it down: no action needed, and its materials come back
      const replaced = existing && existing.village.id === v.id && !(existing.building.type === def.id && existing.building.progress < 1) ? existing.building : null
      if (existing && existing.building.type === def.id && existing.building.progress < 1 && existing.village.id === v.id) return null // finishing
      const site = buildSiteError(world, s, v, def, ev.col, ev.row)
      if (site) return site
      if (existing) {
        if (!replaced) return 'Something is already built here'
        if (existing.building.type === def.id) return `You already have a ${def.name} here`
      }
      if (def.needs && !done(v).some((b) => b.type === def.needs)) return `Build a ${BUILDINGS[def.needs].name} first`
      const cost = buildCost(v, def, ev.at)
      // the old building's materials come back first, so they can pay for the new one
      const purse: Village = replaced ? { ...v, goods: { ...v.goods } } : v
      if (replaced) addGoods(purse, refundOf(v, replaced, ev.at))
      if (!hasGoods(purse, cost, tok.strength)) return `Needs ${fmtGoods(cost, tok.strength)}`
      return null
    }
    case 'caravan': {
      const to = ev.to && s.villages[ev.to]
      if (!to || to.id === v.id) return 'Pick a neighbour village'
      const total = Object.values(ev.goods ?? {}).reduce((a, n) => a + (n ?? 0), 0)
      if (total <= 0) return 'Load some goods'
      const crew = ev.crew ?? 0
      if (!Number.isInteger(crew) || crew < 1) return 'Someone has to go with it: pick its people'
      if (crew > spare(v, seasonAt(p, ev.at))) return `Only ${spare(v, seasonAt(p, ev.at))} people are free (the rest are working)`
      const food = ev.food ?? {}
      if (Object.keys(food).some((g) => !FOOD[g as Good])) return 'Provisions are food'
      const need = provisionsFor(crew, caravanMinutes(p, v, to, ev.at, world, s))
      if (foodValue(food) + 1e-9 < need) return `Pack food for the road: ${need} worth for ${crew} ${crew === 1 ? 'person' : 'people'}, there and back`
      const cap = caravanCarry(world, s, v, to, crew).cap * (tok.strength >= 1 ? 1 : 0.4)
      if (weightOf(ev.goods ?? {}) + weightOf(food) > cap + 1e-9) return `Too heavy: this caravan carries at most ${Math.floor(cap)} lb (${Math.round(cap / 100) / 10} wagon loads), provisions included`
      const all = { ...ev.goods }
      for (const [g, n] of Object.entries(food)) all[g as Good] = (all[g as Good] ?? 0) + (n ?? 0)
      if (!hasGoods(v, all)) return 'Not enough goods'
      return null
    }
    case 'troops': {
      const to = ev.to && s.villages[ev.to]
      if (!to || to.id === v.id) return 'Pick a neighbour village'
      if (!palisades(to)) return 'They need a palisade to hold troops'
      const n = ev.troops ?? 0
      if (!Number.isInteger(n) || n < 1) return 'Send at least one person'
      if (n > people(v) - 2 * HEADS) return `Keep at least ${2 * HEADS} people at home`
      const goods = ev.goods ?? {}
      if (Object.keys(goods).some((g) => !GEAR.includes(g as Good) && !FOOD[g as Good])) return 'Troops carry only weapons, armour and food'
      if (!hasGoods(v, goods)) return 'Not enough goods'
      const food = Object.fromEntries(Object.entries(goods).filter(([g]) => FOOD[g as Good]))
      if (foodValue(food) < n * RATION) return `Send food for at least a night (${n * RATION} worth)`
      if (garrison(s, to).reduce((a, d) => a + d.troops, 0) + n > palisades(to) * PER_PALISADE) return 'Their palisade is full'
      return null
    }
    case 'outpost': {
      if (cell.tier === 0) return 'Outposts need land'
      if (!revealed) return 'Scout there first'
      if (inTerritory(v, ev.col, ev.row)) return 'Already your territory'
      if (hasTrees(land)) return 'Fell the trees there first'
      if (!isOpen(land)) return 'Outposts need open ground'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 4)) return 'Too far from your territory'
      if (Object.values(s.villages).some((o) => o.id !== v.id && inTerritory(o, ev.col, ev.row))) return "That is a neighbour's land"
      if (!hasGoods(v, { timber: 6, stone: 2 }, tok.strength)) return `Needs ${fmtGoods({ timber: 6, stone: 2 }, tok.strength)}`
      return null
    }
    case 'work': {
      const here = buildingAt(s, ev.col, ev.row)
      if (!here || here.village.id !== v.id) return 'Only your own buildings'
      if (here.building.progress < 1) return 'Finish building it first'
      const def = BUILDINGS[here.building.type]
      if (!workable(here.building)) return def.crop ? 'Crops grow in their own time' : 'Nothing to work here'
      if (staffing(v, here.building, seasonAt(p, ev.at)) <= 0) return 'Nobody works there: give it workers (Village tab)'
      // a dry run: does it have what it needs?
      const test = structuredClone(s)
      const tv = test.villages[v.id]
      const got = shift(test, world, tv, tv.buildings.find((b) => b.id === here.building.id)!, 1, playerDate(ev.at, p.resetHour, p.tz), ev.at, { roll: ev.id })
      if (!Object.values(got).some((n) => (n ?? 0) > 0.005)) {
        if (def.mine) return 'Nothing left to dig at this level: sink the shaft deeper'
        if (def.smelts) return `It needs ore and charcoal (${stationOres(here.building.type).map((g) => GOOD_LABEL[g].toLowerCase()).join(', ')})`
        if (def.consumes) return `It needs ${fmtGoods(def.consumes)}`
        return 'Nothing to work with right now'
      }
      return null
    }
    case 'deepen': {
      const here = buildingAt(s, ev.col, ev.row)
      if (!here || here.village.id !== v.id || !BUILDINGS[here.building.type].mine) return 'Only one of your mines'
      if (here.building.progress < 1) return 'Finish building the mine first'
      const depth = here.building.depth ?? 1
      if (depth >= MAX_DEPTH) return `The shaft is as deep as it can go (level ${MAX_DEPTH})`
      if (!hasGoods(v, DEEPEN_COST[depth + 1])) return `Shoring it up takes ${fmtGoods(DEEPEN_COST[depth + 1])}`
      return null
    }
    case 'siege': {
      const fort = strongholdAt(world, i)
      if (!fort) return 'No stronghold here'
      if (!revealed) return 'Scout it first'
      if (s.sieges?.[i]?.fallen) return 'It has already fallen'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 12)) return 'Too far to march a siege'
      return null
    }
    case 'expedition': {
      const dungeon = s.dungeons?.[i]
      if (dungeon) {
        if (dungeon.villageId !== v.id) return "That dungeon is under someone else's mine"
        if (dungeon.raids <= 0) return 'Picked clean: nothing left down there'
        return null
      }
      const lair = s.lairs.find((l) => l.col === ev.col && l.row === ev.row && !l.cleared)
      if (!lair) return 'No monsters here'
      if (!revealed) return 'Scout it first'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 8)) return 'Too far to march'
      return null
    }
  }
}

export function fmtGoods(g: Goods, k = 1) {
  return Object.entries(g).map(([n, q]) => {
    const f = FOOD[n as Good]
    return f ? `${Math.round((q ?? 0) * k * f.value)} rations of ${n.replace('_', ' ')}` : `${round2((q ?? 0) * k)} ${n.replace('_', ' ')}`
  }).join(', ')
}

// ------------------------------------------------------------------ apply

/** From this moment trees are felled one at a time (each leaves a stump), the
 *  standing trees double each winter up to the hex's original number, and
 *  planting puts in two saplings that grow at winter. Before it, felling
 *  cleared the whole hex and saplings grew into forest in three days. */
export const TREES_FROM = '2026-11-19T13:00:00.000Z'

export function apply(s: GameState, world: World, ev: GameEvent): GameState {
  const err = validate(s, world, ev)
  s.version++
  deliverCaravans(s, ev.at)
  digRoads(s, world, ev.at)
  crewsHome(s, ev.at)
  givePurses(s, ev.at)
  convertToCities(s, world, ev.at)
  convertCheese(s, ev.at)
  placeStarters(s, world, ev.at)
  foodUpdate(s, world, ev.at)
  giveWells(s, world, ev.at)
  giveStaff(s, world, ev.at)
  if (err) {
    log(s, ev.at, ev.playerId, `(ignored: ${err})`, 'info')
    return s
  }
  const p = s.players[ev.playerId]
  switch (ev.t) {
    case 'join': return join(s, world, ev)
    case 'progress': return progress(s, world, p, ev)
    case 'habit': {
      const d = ensureDay(p, ev.date)
      d.habitsDone = d.habitsDone.filter((h) => h !== ev.habitId)
      if (ev.done) d.habitsDone.push(ev.habitId)
      return s
    }
    case 'habitAdd':
      p.habits.push(ev.habit)
      return s
    case 'habitRemove':
      p.habits = p.habits.filter((h) => h.id !== ev.habitId)
      return s
    case 'habitGoal': {
      const h = p.habits.find((x) => x.id === ev.habitId)!
      h.goal = { target: round2(ev.target), unit: ev.unit.trim() }
      // a new target re-judges today
      const d = p.days[playerDate(new Date(ev.at), p.resetHour, p.tz)]
      if (d && !d.ticked) syncGoal(d, h)
      return s
    }
    case 'drink': {
      const h = p.habits.find((x) => x.id === ev.habitId)!
      const d = ensureDay(p, ev.date)
      const amounts = (d.amounts ??= {})
      amounts[h.id] = Math.max(0, round2((amounts[h.id] ?? 0) + ev.amount))
      syncGoal(d, h)
      return s
    }
    case 'freeze': {
      ensureDay(p, ev.date).frozen = true
      p.freezes--
      log(s, ev.at, p.id, `${P(p)} used a freeze for ${ev.date}.`, 'info')
      return s
    }
    case 'colors': {
      const c = { ...p.colors }
      if (ev.border !== undefined) { if (ev.border) c.border = ev.border.toLowerCase(); else delete c.border }
      if (ev.meeple !== undefined) { if (ev.meeple) c.meeple = ev.meeple.toLowerCase(); else delete c.meeple }
      p.colors = c
      return s
    }
    case 'roadplan': {
      const v = s.villages[p.villageId]
      // the team has been digging up to this moment (apply did that first); now it takes the new orders
      if (ev.plan) { v.roadPlan = ev.plan.map((h) => cellIndex(world, h.col, h.row)); v.roadDone = 0 }
      if (ev.crew !== undefined) v.roadCrew = ev.crew
      v.roadAt = ev.at
      return s
    }
    case 'resetHour':
      p.resetHour = ev.hour
      p.resetChangedAt = ev.at
      return s
    case 'act': return act(s, world, p, ev)
    case 'tick': return tick(s, world, p, ev)
    case 'abandon': return abandon(s, p, ev.at)
    case 'jobs': {
      const v = s.villages[p.villageId]
      v.autoJobs = ev.auto
      if (!ev.auto) v.jobs = Object.fromEntries(Object.entries(ev.jobs ?? {}).filter(([, n]) => n > 0))
      return s
    }
    case 'order': {
      const b = s.villages[p.villageId].buildings.find((x) => x.id === ev.building)!
      b.order = ev.recipe
      return s
    }
    case 'equip': {
      const v = s.villages[p.villageId]
      const t = TOOLS[ev.tool]
      addGoods(v, t.cost, -1)
      v.tools = [...(v.tools ?? []), t.id]
      log(s, ev.at, p.id, `${V(v)} made ${t.name.toLowerCase()}: ${t.blurb}`, 'good')
      return s
    }
    case 'split': {
      const k = p.tokens.findIndex((x) => x.id === ev.tokenId)
      const t = p.tokens[k]
      const into: TaskSize[] = t.size === 'big' ? ['medium', 'small'] : ['small', 'small']
      p.tokens.splice(k, 1, ...into.map((size, j) => ({ ...t, id: `${t.id}.${j}`, size })))
      return s
    }
    case 'garrison': {
      const v = s.villages[p.villageId]
      const d = garrison(s, v).find((x) => x.id === ev.detachment)!
      const from = s.villages[d.from]
      if (ev.accept) {
        d.status = 'stationed'
        d.since = ev.at
        log(s, ev.at, p.id, `${V(v)} took ${d.troops} troops from ${from ? V(from) : 'afar'} onto its walls (food for ${nightsOf(d)} nights).`, 'good')
      } else {
        sendHome(s, v, d, ev.at, d.status === 'waiting' ? 'were turned back at the gate' : 'were thanked and sent home')
      }
      return s
    }
    case 'barter': {
      const v = s.villages[p.villageId]
      addGoods(v, ev.give, -1)
      addGoods(v, ev.take)
      noteTrade(v, playerDate(ev.at, p.resetHour, p.tz), ev.merchant, ev.take, ev.give)
      const gave = Object.keys(ev.give).length ? fmtGoods(ev.give) : 'nothing'
      log(s, ev.at, p.id, `${V(v)} traded ${gave} for ${fmtGoods(ev.take)} with a ${KIND_NAME[ev.merchant]}.`, 'good')
      return s
    }
    case 'rename': {
      const v = s.villages[p.villageId]
      const name = ev.name.trim()
      // a village still called after its founder follows the new name
      const town = townName(v)
      if (v.name === `${p.name}'s ${town}`) v.name = `${name}'s ${town}`
      log(s, ev.at, p.id, `${p.name} is now known as {p:${p.id}|${name}}.`, 'good')
      p.name = name
      return s
    }
  }
}

const KIND_NAME = { ship: 'trading ship', barge: 'river barge', caravan: 'overland caravan', pedlar: 'pedlar' } as const

/** The village and all progress go; the map it revealed stays known to everyone. */
function abandon(s: GameState, p: Player, at: string) {
  const v = s.villages[p.villageId]
  s.caravans = s.caravans.filter((c) => c.from !== v.id && c.to !== v.id)
  // troops on its walls go home; its own troops abroad have no home to go to
  for (const d of [...garrison(s, v)]) sendHome(s, v, d, at, 'went home: the village they guarded is gone')
  if (s.garrisons) {
    delete s.garrisons[v.id]
    for (const host of Object.keys(s.garrisons)) s.garrisons[host] = s.garrisons[host].filter((d) => d.from !== v.id)
  }
  delete s.villages[v.id]
  delete s.players[p.id]
  log(s, at, null, `${P(p)} abandoned ${V(v)}. The land is free again.`, 'info')
  return s
}

/** A habit with a goal is done exactly when the day's total reaches it. */
function syncGoal(d: DayRecord, h: { id: string; goal?: { target: number } }) {
  if (!h.goal) return
  const done = (d.amounts?.[h.id] ?? 0) + 1e-9 >= h.goal.target
  d.habitsDone = d.habitsDone.filter((x) => x !== h.id)
  if (done) d.habitsDone.push(h.id)
}

/** Log lines name players and villages by reference, so a rename shows
 *  everywhere, even in old lines: {p:id|name-then} / {v:id|name-then}. */
const P = (p: { id: string; name: string }) => `{p:${p.id}|${p.name}}`
const V = (v: { id: string; name: string }) => `{v:${v.id}|${v.name}}`

/** A log line with today's names filled in (the name at the time if it's gone). */
export function logText(s: GameState, text: string): string {
  return text.replace(/\{([pv]):([^|}]+)\|([^}]*)\}/g, (_, kind: string, id: string, then: string) =>
    (kind === 'p' ? s.players[id]?.name : s.villages[id]?.name) ?? then)
}

function log(s: GameState, at: string, playerId: string | null, text: string, kind: LogEntry['kind']) {
  s.log.push({ at, playerId, text, kind })
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300)
}

/** Why a hex can't be laid with cobblestone (null if it can). */
export function cobbleError(world: World, s: GameState, v: Village, i: number): string | null {
  const c = world.cells[i]
  if (!v.city?.length) return 'Your village has no city yet'
  if (v.city.includes(i)) return 'Cobbled already'
  if (!paveable(c)) return c.tier === 0 ? 'Not on water' : c.riverTo !== -1 ? 'Not over a river' : 'Cobblestone cannot be laid on this ground'
  if (distance(c, v) > CITY_RADIUS) return 'Too far from the village square'
  if (!neighbours(c.col, c.row).some(([nc, nr]) => nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && v.city!.includes(nr * world.width + nc))) return 'Cobbles must join the city'
  if (buildingAt(s, c.col, c.row) || villageAt(s, c.col, c.row)) return 'Something is built here already'
  if (!hasGoods(v, COBBLE_COST)) return `Needs ${fmtGoods(COBBLE_COST)}`
  return null
}

/** A hex taken into a city is cleared of trees for good (the open land stays open). Returns how many stood. */
function clearForCity(world: World, s: GameState, i: number, at: string): number {
  const land = landAt(world, s, i)
  if (!hasTrees(land)) return 0
  const standing = treeCount(land)
  const old = s.woods?.[i]
  ;(s.woods ??= {})[i] = { n: 0, young: 0, max: old?.max ?? Math.max(1, standing), kind: old?.kind ?? (land.feature?.startsWith('pine') ? 'pine' : 'oak'), since: at.slice(0, 10) }
  return standing
}

/** Immigrants arrive, with their travel food: the people and the food go in, and the arrival is kept as
 *  a note for the player (and a line in the log). */
function welcome(s: GameState, v: Village, at: string, kind: 'update' | 'winter', people: number) {
  if (people < 1) return
  const origin = originFor(`${v.id}|${at.slice(0, 10)}|${kind}`)
  const goods = travelFood(people, origin)
  if (kind === 'winter') v.population = round2(v.population + people)
  addGoods(v, goods)
  const a: Arrival = { id: `${kind}-${at.slice(0, 10)}`, at, kind, people, from: origin.name, goods }
  v.arrivals = [...(v.arrivals ?? []), a].slice(-6)
  log(s, at, v.playerId, `${people} newcomers from ${origin.name} settled in ${V(v)}, with ${TRAVEL_DAYS} days of food: ${fmtGoods(goods)}.`, 'good')
}

/** Hexes a village's city can't take: any village's square, and anything built. */
function takenHexes(world: World, s: GameState, except: Village): Set<number> {
  const taken = new Set<number>()
  for (const o of Object.values(s.villages)) {
    taken.add(cellIndex(world, o.col, o.row))
    for (const b of o.buildings) taken.add(cellIndex(world, b.col, b.row))
    for (const x of o.outposts) taken.add(cellIndex(world, x.col, x.row))
    if (o !== except) for (const i of o.city ?? []) taken.add(i)
  }
  return taken
}

/** From this moment people are counted one by one: until then a village counted households of five. Every
 *  village (and every caravan crew, band of troops and worker assignment) is converted once, and each gets
 *  a city: its square and two cobbled hexes beside it, where the player lays more and builds homes. */
export const CITY_FROM = '2026-11-22T20:30:00.000Z'
function convertToCities(s: GameState, world: World, at: string) {
  if (s.headsScaled || at < CITY_FROM) return
  // A surprise in an old world's data must never stop the game (every event passes through here): the
  // conversion is done in place, but on any failure the world is put back as it was and tried again later.
  const snap = structuredClone({ villages: s.villages, caravans: s.caravans, homeward: s.homeward, garrisons: s.garrisons, woods: s.woods, log: s.log })
  try {
    for (const v of Object.values(s.villages)) {
      const before = v.population
      v.population = Math.round(v.population * HEADS)
      welcome(s, v, at, 'update', v.population - Math.round(before))
      if (v.away) v.away *= HEADS
      if (v.jobs) for (const k of Object.keys(v.jobs)) v.jobs[k] *= HEADS
      v.city = claimCity(world, v, takenHexes(world, s, v))
      for (const i of v.city) clearForCity(world, s, i, at)
    }
    for (const c of s.caravans ?? []) if (c.crew) c.crew *= HEADS
    for (const h of s.homeward ?? []) h.crew *= HEADS
    for (const ds of Object.values(s.garrisons ?? {})) for (const d of ds) d.troops *= HEADS
    if (Object.keys(s.villages).length) log(s, at, null, `A one-time update: villagers are counted one by one now, so every village is ${HEADS} times bigger on paper (the same food, work and fighting strength). Each has a cobbled city: lay more cobblestone and build cottages and town houses there for room to grow.`, 'good')
    s.headsScaled = true
  } catch (e) {
    console.error('the one-time update could not run yet:', e)
    for (const [id, saved] of Object.entries(snap.villages)) {
      const v = s.villages[id] as unknown as Record<string, unknown>
      for (const k of Object.keys(v)) delete v[k]
      Object.assign(v, saved)
    }
    s.caravans = snap.caravans; s.homeward = snap.homeward; s.garrisons = snap.garrisons; s.woods = snap.woods; s.log = snap.log
    delete s.headsScaled
  }
}

/** From this moment cheese is counted in rations (one person's cheese for a day), 15 to the old unit, and salt
 *  in pinches, one to a ration (SALT_PER_OLD to the old unit). Every store, caravan and band of troops is
 *  converted once. */
export const CHEESE_FROM = '2026-11-23T02:00:00.000Z'
const CHEESE_RATIONS = 15
function convertCheese(s: GameState, at: string) {
  if (s.cheeseRations || at < CHEESE_FROM) return
  const x = (g: Goods | undefined) => {
    if (g?.cheese) g.cheese = round2(g.cheese * CHEESE_RATIONS)
    if (g?.salt) g.salt = round2(g.salt * SALT_PER_OLD)
  }
  for (const v of Object.values(s.villages)) {
    x(v.goods)
    for (const a of v.arrivals ?? []) x(a.goods)
    for (const t of Object.values(v.trade?.took ?? {})) x(t)
    for (const t of Object.values(v.trade?.got ?? {})) x(t)
  }
  for (const c of s.caravans ?? []) x(c.goods)
  for (const ds of Object.values(s.garrisons ?? {})) for (const d of ds) x(d.food)
  s.cheeseRations = true
}

/** From this moment a village's square is laid out in its city: a well and a few homes spread over the
 *  cobbles, instead of three town houses on one hex. New villages start that way; every village already
 *  standing with a city of three hexes or more is rearranged once. Nothing else about it changes: not its
 *  food, goods or people, and the places its people live in stay the same. */
export const STARTER_FROM = '2026-11-23T04:00:00.000Z'
function placeStarters(s: GameState, world: World, at: string) {
  if (s.startersPlaced || at < STARTER_FROM) return
  try {
    for (const v of Object.values(s.villages)) {
      if (v.starter || (v.city?.length ?? 0) < 3) continue
      const st = starterFor(world, v)
      if (!st) continue
      v.starter = st.starter
      v.homes = [...(v.homes ?? []), ...st.homes]
      log(s, at, v.playerId, `${v.name}'s square has been laid out across its cobbles: a well, and ${st.homes.length} homes with room between them. Nothing else changed.`, 'good')
    }
    s.startersPlaced = true
  } catch (e) {
    console.error('laying out the squares could not run yet:', e)
  }
}

function join(s: GameState, world: World, ev: Extract<GameEvent, { t: 'join' }>) {
  const vid = 'v_' + ev.playerId
  const p: Player = {
    id: ev.playerId, name: ev.name, villageId: vid, resetHour: ev.resetHour, resetChangedAt: null, tz: ev.tz,
    habits: [], habitSlots: 1, perfectStreak: 0, freezes: 1, days: {}, tokens: [], lastTick: null,
    joined: playerDate(ev.at, ev.resetHour, ev.tz),
  }
  const v: Village = {
    id: vid, playerId: p.id, name: `${ev.name}'s ${ev.role ? ROLE_TOWN[ev.role] : 'Village'}`, ...(ev.role ? { role: ev.role } : {}),
    col: ev.site.col, row: ev.site.row, population: 5 * HEADS, morale: 60,
    goods: { grain: ev.at >= FOOD_FROM ? 18 : 12, timber: 8, stone: 3, berries: 4, ...(ev.at >= PURSE_FROM ? PURSE : {}) }, buildings: [], outposts: [], roads: [], planted: [], cleared: [],
    winterForecast: 'tight',
  }
  s.players[p.id] = p
  s.villages[vid] = v
  v.city = claimCity(world, v, takenHexes(world, s, v))
  for (const i of v.city) clearForCity(world, s, i, ev.at)
  if (ev.at >= STARTER_FROM) {
    const st = starterFor(world, v)
    if (st) { v.starter = st.starter; v.homes = st.homes }
  }
  const field = ev.at >= FOOD_FROM ? starterField(world, s, v) : null
  if (field) v.buildings.push(field)
  reveal(world, s, ev.site, 4)
  log(s, ev.at, p.id, `{p:${ev.playerId}|${ev.name}} founded a ${ev.role ? `${ev.role} ` : ''}village.`, 'good')
  return s
}

const townName = (v: Village) => (v.role ? ROLE_TOWN[v.role] : 'Village')
const ROLE_TOWN: Record<string, string> = {
  farm: 'Farmstead', port: 'Trading Post', mining: 'Mine', forestry: 'Woodhall', herding: 'Steading', explorer: 'Camp',
}

/** Map knowledge is shared by every human player in the world. */
function reveal(world: World, s: GameState, at: { col: number; row: number }, radius: number) {
  const set = new Set(s.revealed)
  for (const o of spiral(at, radius)) {
    if (o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height) set.add(cellIndex(world, o.col, o.row))
  }
  s.revealed = [...set]
}

function progress(s: GameState, world: World, p: Player, ev: Extract<GameEvent, { t: 'progress' }>) {
  const late = lateTick(p, ev)
  const before = late ? dayScore(p.days[ev.date]) : 0
  const res = progressInner(s, p, ev)
  if (late) {
    // the night already passed: harvest the extra the better score would have made
    const v = s.villages[p.villageId]
    const d = p.days[ev.date]
    const gain = dayScore(d) - before
    if (v && gain > 0 && weekSeason(ev.date) !== 'winter') {
      const made = produce(s, world, v, p, d, ev.date, 0.85 * (gain / 100), ev.at)
      log(s, ev.at, p.id, `${P(p)} finished a task from ${ev.date}${Object.keys(made).length ? `: the village made ${fmtGoods(made)} more` : ''}.`, 'good')
    }
  }
  return res
}

function progressInner(s: GameState, p: Player, ev: Extract<GameEvent, { t: 'progress' }>) {
  const d = ensureDay(p, ev.date)
  const slot = d.slots[ev.slot]
  const val = (st: string) => (st === 'full' ? 1 : st === 'half' ? 0.5 : 0)
  const delta = val(ev.status) - val(slot.status)
  slot.status = ev.status
  const mine = p.tokens.filter((t) => t.date === ev.date && t.slot === ev.slot)
  if (delta > 0) {
    const half = mine.find((t) => t.strength < 1)
    if (half) half.strength = Math.min(1, half.strength + delta)
    else p.tokens.push({ id: `${p.id}:${ev.date}:${ev.slot}:${ev.id}`, size: slot.size, strength: delta, date: ev.date, slot: ev.slot })
  } else if (delta < 0) {
    let remove = -delta
    for (const t of mine) {
      if (remove <= 0) break
      const take = Math.min(t.strength, remove)
      t.strength -= take
      remove -= take
    }
    p.tokens = p.tokens.filter((t) => t.strength > 1e-9)
  }
  return s
}

function consumeToken(p: Player, id: string) {
  p.tokens = p.tokens.filter((t) => t.id !== id)
}

function act(s: GameState, world: World, p: Player, ev: Extract<GameEvent, { t: 'act' }>) {
  const v = s.villages[p.villageId]
  const tok = spentToken(p, ev) as Token
  const k = tok.strength
  const i = cellIndex(world, ev.col, ev.row)
  const rng = rngFor(s.worldSeed, ev.id)
  const land0 = landAt(world, s, i)
  consumeToken(p, ev.tokenId)
  if (ev.tokenId2) consumeToken(p, ev.tokenId2)
  switch (ev.action) {
    case 'scout': {
      const radius = scoutRadius(v, k)
      reveal(world, s, ev, radius)
      const found = spiral(ev, radius).map((o) => s.lairs.find((l) => !l.cleared && l.col === o.col && l.row === o.row)).find(Boolean)
      log(s, ev.at, p.id, found ? `Scouts spotted ${found.kind} nearby!` : 'Scouts mapped new land.', found ? 'monster' : 'info')
      break
    }
    case 'gather': {
      const g = GATHER[land0.resource!]!
      let n = gatherAmount(g, k)
      if (ev.at >= DEPLETION_FROM) {
        const left = leftAt(world, s, i)
        if (left && left.good === g) { n = round2(Math.min(n, left.surface)); dig(s, i, n) }
        if (g === 'game') n = hunt(world, s, i, playerDate(ev.at, p.resetHour, p.tz), n)
      }
      addGoods(v, { [g]: n })
      log(s, ev.at, p.id, `Gathered ${n} ${g.replace('_', ' ')}.`, 'good')
      break
    }
    case 'pick': {
      const n = round2(Math.min(3 * k, leftAt(world, s, i)!.surface))
      dig(s, i, n)
      addGoods(v, { stone: n })
      const rest = leftAt(world, s, i)!.surface
      const field = buildingAt(s, ev.col, ev.row)?.building
      log(s, ev.at, p.id, `Cleared ${n} stone.${rest < 1 ? ' The ground is picked clean' + (field && BUILDINGS[field.type].crop ? ': the crops will grow better.' : '.') : ''}`, 'good')
      break
    }
    case 'rice': {
      const n = round2(3 * k)
      addGoods(v, { rice: n })
      log(s, ev.at, p.id, `Gathered ${n} wild rice. The marsh reseeds itself.`, 'good')
      break
    }
    case 'peat': {
      const n = round2(3 * k)
      addGoods(v, { peat: n })
      log(s, ev.at, p.id, `Cut peat: +${n}. The bog fills in behind you.`, 'good')
      break
    }
    case 'chop': {
      // cutting wood from a forest takes branches and the odd tree, and the forest stays as it was
      const n = round2((land0.terrain === 'forest' ? 3 : 1) * k)
      addGoods(v, { timber: n })
      log(s, ev.at, p.id, `Cut wood: +${n} timber. The forest is as thick as before.`, 'good')
      break
    }
    case 'clear': {
      const wood = land0.terrain === 'forest' ? 3 : 1
      if (ev.at >= TREES_FROM) {
        // every tree comes down, and the land is open for good (until someone plants it again)
        const standing = Math.max(1, treeCount(land0) - (land0.stumps ?? 0))
        const n = round2(wood * standing * k)
        const woods = (s.woods ??= {})
        const old = woods[i]
        woods[i] = { n: 0, young: 0, max: old?.max ?? Math.max(1, treeCount(land0)), kind: old?.kind ?? (land0.feature?.startsWith('pine') ? 'pine' : 'oak'), since: ev.at.slice(0, 10) }
        addGoods(v, { timber: n })
        log(s, ev.at, p.id, `Cleared the trees: +${n} timber. The land is open for good.`, 'good')
        break
      }
      const n = round2(wood * k)
      v.planted = v.planted.filter((x) => x.cell !== i)
      if (!v.cleared.includes(i)) v.cleared.push(i)
      addGoods(v, { timber: n })
      log(s, ev.at, p.id, `Trees felled: +${n} timber. The land is open.`, 'good')
      break
    }
    case 'plant':
      if (ev.at >= TREES_FROM) {
        const woods = (s.woods ??= {})
        const was = treeCount(world.cells[i])
        woods[i] = { n: 0, young: 2, max: Math.max(2, was), kind: world.cells[i].feature?.startsWith('pine') ? 'pine' : 'oak', since: ev.at.slice(0, 10) }
        log(s, ev.at, p.id, 'Two saplings planted. They take root in winter, and the trees spread from there.', 'good')
        break
      }
      v.cleared = v.cleared.filter((x) => x !== i)
      v.planted.push({ cell: i, date: ev.at.slice(0, 10) })
      log(s, ev.at, p.id, 'Saplings planted. A forest in three days.', 'good')
      break
    case 'cobble': {
      addGoods(v, COBBLE_COST, -1)
      ;(v.city ??= []).push(i)
      const felled = clearForCity(world, s, i, ev.at)
      const timber = round2(felled * (world.cells[i].terrain === 'forest' ? 3 : 1) * 0.5)
      if (timber > 0) addGoods(v, { timber })
      log(s, ev.at, p.id, felled ? `Cobblestone was laid: another hex of the city. ${felled} tree${felled === 1 ? '' : 's'} came down for it (+${timber} timber).` : 'Cobblestone was laid: another hex of the city.', 'good')
      break
    }
    case 'home': {
      const h = ev.home!, def = HOMES[h.kind]
      addGoods(v, def.cost, -1)
      ;(v.homes ??= []).push({ kind: h.kind, key: h.key, x: h.x, y: h.y, side: h.side })
      log(s, ev.at, p.id, `A ${def.name.toLowerCase()} went up in the city: room for ${def.cap} more villagers.`, 'good')
      break
    }
    case 'upgrade': {
      const h = ev.home!
      addGoods(v, HOMES.townhouse.cost, -1)
      v.homes![ev.replace!] = { kind: 'townhouse', key: h.key, x: h.x, y: h.y, side: h.side }
      log(s, ev.at, p.id, `A cottage was pulled down and a town house raised in its place: room for ${HOMES.townhouse.cap - HOMES.cottage.cap} more villagers.`, 'good')
      break
    }
    case 'pave':
      addGoods(v, PAVE_COST, -1)
      ;(v.paved ??= []).push(i)
      log(s, ev.at, p.id, 'A stretch of road was paved with stone.', 'good')
      break
    case 'well':
      addGoods(v, WELL_COST, -1)
      ;(s.wells ??= {})[i] = true
      log(s, ev.at, p.id, 'A well was dug: fresh water for the herds nearby.', 'good')
      break
    case 'dig_clay': {
      const n = round2(Math.min(3 * k, clayLeft(world, s, i)!))
      const dug = (s.clayDug ??= {})
      dug[i] = round2((dug[i] ?? 0) + n)
      addGoods(v, { clay: n })
      log(s, ev.at, p.id, `Dug ${n} clay.${(clayLeft(world, s, i) ?? 0) < 1 ? (clayRenews(world, i) ? ' Dug out until winter brings more.' : ' That pit is dug out for good.') : ''}`, 'good')
      break
    }
    case 'road':
      v.roads.push(i)
      log(s, ev.at, p.id, world.cells[i].riverTo !== -1 ? 'A bridge was built over the river.' : 'A dirt road was laid.', 'good')
      break
    case 'build': {
      const def = BUILDINGS[ev.building!]
      let existing = buildingAt(s, ev.col, ev.row)
      if (existing && !(existing.building.type === def.id && existing.building.progress < 1)) {
        // pulled down to make room: the materials come back
        const old = existing.building
        addGoods(v, refundOf(v, old, ev.at))
        v.buildings = v.buildings.filter((b) => b !== old)
        log(s, ev.at, p.id, `${BUILDINGS[old.type].name} pulled down: ${fmtGoods(refundOf(v, old, ev.at)) || 'nothing'} back in the stores.`, 'info')
        existing = null
      }
      addGoods(v, buildCost(v, def, ev.at), -k)
      if (existing) existing.building.progress = Math.min(1, existing.building.progress + k)
      else v.buildings.push({ id: ev.id, type: def.id, col: ev.col, row: ev.row, progress: Math.min(1, k) })
      const b = buildingAt(s, ev.col, ev.row)!.building
      log(s, ev.at, p.id, b.progress >= 1 ? `${def.name} completed!` : `${def.name} half-built.`, 'good')
      break
    }
    case 'caravan': {
      const to = s.villages[ev.to!]
      addGoods(v, ev.goods!, -1)
      // provisions are eaten on the road
      addGoods(v, ev.food ?? {}, -1)
      const mins = caravanMinutes(p, v, to, ev.at, world, s)
      const homeAt = new Date(Date.parse(ev.at) + mins * 2 * 60_000).toISOString()
      // ox carts sent without a task have to walk home before they go again
      if (ev.tokenId === FREE) v.oxenBack = homeAt
      // its people are away until they're home again
      v.away = (v.away ?? 0) + ev.crew!
      s.caravans.push({
        id: ev.id, from: v.id, to: to.id, goods: ev.goods!, departAt: ev.at,
        arriveAt: new Date(Date.parse(ev.at) + mins * 60_000).toISOString(), crew: ev.crew, homeAt,
      })
      log(s, ev.at, p.id, `A caravan of ${ev.crew} set off for ${V(to)}.`, 'info')
      break
    }
    case 'troops': {
      const to = s.villages[ev.to!]
      const goods = ev.goods ?? {}
      addGoods(v, goods, -1)
      // they're still the village's people, just away (see workers.people)
      v.away = (v.away ?? 0) + ev.troops!
      const pick = (f: (g: Good) => boolean) => Object.fromEntries(Object.entries(goods).filter(([g, n]) => f(g as Good) && n)) as Goods
      const d: Detachment = { id: ev.id, from: v.id, troops: ev.troops!, gear: pick((g) => GEAR.includes(g)), food: pick((g) => !!FOOD[g]), status: 'waiting', since: ev.at }
      ;((s.garrisons ??= {})[to.id] ??= []).push(d)
      log(s, ev.at, p.id, `${d.troops} troops from ${V(v)} marched to ${V(to)}'s palisade${Object.keys(d.gear).length ? ` with ${fmtGoods(d.gear)}` : ''} and food for ${nightsOf(d)} nights. They wait at the gate.`, 'info')
      break
    }
    case 'outpost':
      addGoods(v, { timber: 6, stone: 2 }, -k)
      v.outposts.push({ col: ev.col, row: ev.row, radius: k >= 1 ? 1 : 0 } as Village['outposts'][number])
      reveal(world, s, ev, 2)
      log(s, ev.at, p.id, k >= 1 ? 'An outpost was founded.' : 'A small camp was pitched.', 'good')
      break
    case 'work': {
      const b = buildingAt(s, ev.col, ev.row)!.building
      const got = shift(s, world, v, b, k * (0.75 + v.morale / 200), playerDate(ev.at, p.resetHour, p.tz), ev.at, { roll: ev.id })
      log(s, ev.at, p.id, `An extra shift at the ${BUILDINGS[b.type].name.toLowerCase()}: ${fmtGoods(got) || 'nothing'}.`, 'good')
      break
    }
    case 'deepen': {
      const b = buildingAt(s, ev.col, ev.row)!.building
      const depth = (b.depth ?? 1) + 1
      addGoods(v, DEEPEN_COST[depth], -1)
      b.depth = depth
      const lv = levels(world, s, i)
      log(s, ev.at, p.id, `${V(v)} sank its ${BUILDINGS[b.type].name.toLowerCase()} to level ${depth}${lv && lv[depth] > 0.5 ? '' : ': no ore down there'}.`, 'good')
      // deep under a mountain, the miners may break into something
      const d = dungeonUnder(world, i)
      if (d && depth >= d.level && !s.dungeons?.[i]) {
        ;(s.dungeons ??= {})[i] = { kind: d.kind, villageId: v.id, raids: d.raids, strength: d.strength, found: ev.at }
        log(s, ev.at, p.id, `The miners broke through into ${DUNGEON[d.kind].name}! An expedition could raid it.`, 'monster')
      }
      break
    }
    case 'siege': {
      const fort = strongholdAt(world, i)!
      const state = ((s.sieges ??= {})[i] ??= { strength: fort.strength })
      const g = gearWith(s, v)
      // the guns: each cannon needs 2 shot and 2 powder, each musket a charge of powder
      let powder = v.goods.gunpowder ?? 0
      const cannon = Math.min(Math.floor(g.cannon ?? 0), Math.floor((v.goods.cannonballs ?? 0) / 2), Math.floor(powder / 2))
      powder -= cannon * 2
      const muskets = Math.min(Math.floor(g.musket ?? 0), Math.floor(powder))
      const walls = wallsAfter(v.goods, cannon)
      const food = Math.min(6, (v.goods.bread ?? 0) / foodUnit('bread') + (v.goods.cheese ?? 0) / foodUnit('cheese') + (v.goods.smoked_fish ?? 0))
      const pw = (4 + (people(v) + troopsAt(s, v)) * 0.5 / HEADS + Math.min(g.bronze ?? 0, 5) * 2 + Math.min(g.iron ?? 0, 5) * 2.5 +
        Math.min(g.steel ?? 0, 5) * 4 + Math.min(g.leather ?? 0, 5) * 0.5 + food * 0.5 + muskets * 4 + cannon * 6) * (k >= 1 ? 1 : 0.6)
      const defend = state.strength * walls
      const win = rng() < pw / (pw + defend)
      // what the assault uses up, win or lose: powder, shot, and the engines thrown at the walls
      const spent: Goods = {}
      if (cannon) { spent.cannonballs = cannon * 2; spent.gunpowder = cannon * 2 }
      if (muskets) spent.gunpowder = (spent.gunpowder ?? 0) + muskets
      if (v.goods.ram) spent.ram = Math.min(Math.floor(v.goods.ram), 3)
      if (v.goods.siege_tower) spent.siege_tower = Math.floor(v.goods.siege_tower)
      for (const f of ['bread', 'cheese', 'smoked_fish'] as const) if ((v.goods[f] ?? 0) >= foodUnit(f)) spent[f] = (spent[f] ?? 0) + foodUnit(f)
      addGoods(v, spent, -1)
      const kit = [cannon && `${cannon} cannon`, muskets && `${muskets} muskets`, spent.ram && `${spent.ram} rams`, spent.siege_tower && `${spent.siege_tower} siege towers`].filter(Boolean).join(', ')
      if (win) {
        state.fallen = ev.at
        state.by = v.id
        addGoods(v, fort.loot)
        v.morale = Math.min(100, v.morale + 10)
        log(s, ev.at, p.id, `${V(v)} stormed ${fort.name}${kit ? ` with ${kit}` : ''}: the walls (x${walls}) gave way and the keep fell! Its hoard: ${fmtGoods(fort.loot)}.`, 'good')
      } else {
        v.morale = Math.max(0, v.morale - 10)
        state.strength = round2(state.strength * 0.9) // the defenders are worn down a little all the same
        log(s, ev.at, p.id, `The siege of ${fort.name} failed: its walls held (x${walls}). ${kit ? `Spent: ${kit}. ` : ''}Bring rams, siege towers or cannon to break them.`, 'monster')
      }
      break
    }
    case 'expedition': {
      const g = gearWith(s, v)
      const dungeon = s.dungeons?.[i]
      const lair = dungeon ? null : s.lairs.find((l) => l.col === ev.col && l.row === ev.row && !l.cleared)!
      const food = Math.min(6, (g.bread ?? 0) / foodUnit('bread') + (g.cheese ?? 0) / foodUnit('cheese') + (g.smoked_fish ?? 0))
      const outfitter = done(v).some((b) => b.type === 'outfitter') ? 5 : 0
      let pw = 4 + (people(v) + troopsAt(s, v)) * 0.5 / HEADS + Math.min(g.bronze ?? 0, 5) * 2 + Math.min(g.iron ?? 0, 5) * 2.5 +
        Math.min(g.steel ?? 0, 5) * 4 + Math.min(g.leather ?? 0, 5) * 0.5 + outfitter + food * 0.5
      pw *= k >= 1 ? 1 : 0.6
      const win = rng() < pw / (pw + (dungeon ?? lair!).strength)
      for (const f of ['bread', 'cheese', 'smoked_fish'] as const) {
        const take = Math.min(v.goods[f] ?? 0, foodUnit(f))
        if (take) addGoods(v, { [f]: -take })
      }
      if (dungeon) {
        const D = DUNGEON[dungeon.kind]
        if (win) {
          addGoods(v, D.loot)
          dungeon.raids -= 1
          log(s, ev.at, p.id, `${D.win} Loot: ${fmtGoods(D.loot)}.${dungeon.raids <= 0 ? ' ' + D.empty : ''}`, 'good')
        } else {
          v.morale = Math.max(0, v.morale - 4)
          dungeon.strength += 1
          log(s, ev.at, p.id, D.lose, 'monster')
        }
        break
      }
      if (win) {
        const lair_ = lair!
        lair_.cleared = true
        const loot = LOOT[lair_.kind]
        addGoods(v, loot)
        log(s, ev.at, p.id, `${CHEEK.win[lair_.kind]} Loot: ${fmtGoods(loot)}.`, 'good')
      } else {
        v.morale = Math.max(0, v.morale - 6)
        lair!.strength += 1
        log(s, ev.at, p.id, CHEEK.lose[lair!.kind], 'monster')
      }
      break
    }
  }
  return s
}

const LOOT: Record<string, Goods> = {
  goblins: { copper: 2, berries: 3 },
  orcs: { iron: 2, leather: 2 },
  trolls: { tin: 2, relic: 1 },
  dragon: { dragon_scale: 2, relic: 2, tin: 3 },
}

const CHEEK = {
  win: {
    goblins: 'The goblins fled, dropping their stolen spoons.',
    orcs: 'The orcs surrendered and asked for the bread recipe.',
    trolls: 'The troll lost a riddle contest and moved out.',
    dragon: 'The dragon sulked off to find a less organised kingdom.',
  },
  lose: {
    goblins: 'The goblins pelted your party with turnips. Retreat!',
    orcs: 'The orcs were having a party. Your party was not invited.',
    trolls: 'The troll sat on the bridge and would not budge.',
    dragon: 'The dragon yawned. Your eyebrows may grow back.',
  },
  raid: {
    goblins: 'Goblins snuck in overnight and pinched',
    orcs: 'Orc raiders stomped through and carried off',
    trolls: 'A troll wandered by and ate',
    dragon: 'A dragon swooped low and scorched',
  },
} as const

/** How long a caravan from `from` to `to` sent at `at` takes on the road:
 *  20 minutes a hex, less on a day its sender ticked a walking habit. */
/** Minutes to cross a hex: overland, on a dirt road (three times as fast), paved (three times faster again). */
export const HEX_MINUTES = { wild: 240, road: 80, paved: 80 / 3 } as const

export function caravanMinutes(p: Player, from: Village, to: Village, at: string, world?: World, s?: GameState): number {
  const walked = p.days[at.slice(0, 10)]?.habitsDone.some((h) => p.habits.find((x) => x.id === h)?.effect === 'movement')
  const k = walked ? 0.6 : 1
  if (!world || !s) return distance(from, to) * HEX_MINUTES.wild * k
  const { roads, paved } = roadSets(world, s)
  // each hex between the villages at the speed its road allows; the last step into town goes like the one before it
  const way = wayBetween(world, s, from, to)
  const pace = way.slice(1, -1).map((i) => (paved.has(i) ? HEX_MINUTES.paved : roads.has(i) ? HEX_MINUTES.road : HEX_MINUTES.wild))
  const steps = [...pace, pace.length ? pace[pace.length - 1] : HEX_MINUTES.wild]
  return Math.round(steps.reduce((a, m) => a + m, 0) * k)
}

/** The shortest way along road hexes from one village to another (through any village on the way), or null. */
export function roadPath(world: World, s: GameState, from: Village, to: Village, pavedOnly = false): number[] | null {
  const { roads, paved, towns } = roadSets(world, s)
  const ok = (i: number) => towns.has(i) || (pavedOnly ? paved.has(i) : roads.has(i))
  const start = cellIndex(world, from.col, from.row), goal = cellIndex(world, to.col, to.row)
  const prev = new Map<number, number>([[start, -1]])
  const queue = [start]
  while (queue.length) {
    const i = queue.shift()!
    if (i === goal) break
    const c = world.cells[i]
    for (const [nc, nr] of neighbours(c.col, c.row)) {
      if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
      const j = nr * world.width + nc
      if (prev.has(j) || !ok(j)) continue
      prev.set(j, i)
      queue.push(j)
    }
  }
  if (!prev.has(goal)) return null
  const out: number[] = []
  for (let i = goal; i !== -1; i = prev.get(i)!) out.push(i)
  return out.reverse()
}

/** The way a caravan goes: along the roads if they connect, otherwise straight across country. */
function wayBetween(world: World, s: GameState, from: Village, to: Village): number[] {
  return roadPath(world, s, from, to) ?? line(from, to).map((o) => cellIndex(world, o.col, o.row))
}

/** What sending a caravan costs: a medium task cross-country, a small one when a road connects
 *  the villages, and nothing at all on paved road the whole way (ox carts, which must come home first). */
export function caravanTier(world: World, s: GameState, from: Village, to: Village): 'medium' | 'small' | 'free' {
  if (roadPath(world, s, from, to, true)) return 'free'
  if (roadPath(world, s, from, to)) return 'small'
  return 'medium'
}

function roadSets(world: World, s: GameState) {
  const roads = new Set<number>(), paved = new Set<number>(), towns = new Set<number>()
  for (const v of Object.values(s.villages)) {
    for (const r of v.roads) roads.add(r)
    for (const r of v.paved ?? []) paved.add(r)
    // a village is its own crossroads
    towns.add(cellIndex(world, v.col, v.row))
  }
  for (const t of towns) roads.add(t)
  return { roads, paved, towns }
}

/** Food (value) a caravan's people need for the road, there and back: what each eats a day, a day at least. */
export function provisionsFor(crew: number, minutesOneWay: number): number {
  return crew * EAT * Math.max(1, Math.ceil((minutesOneWay * 2) / 1440))
}

/** Stone to pave a hex of road. */
export const PAVE_COST: Goods = { stone: 2 }

/** How much of the way between two villages runs on roads, and on paved ones (0..1). */
export function route(world: World, s: GameState, from: Village, to: Village) {
  const { roads, paved, towns } = roadSets(world, s)
  const pavedWay = roadPath(world, s, from, to, true)
  if (pavedWay) return { road: 1, paved: 1 }
  const roadWay = roadPath(world, s, from, to)
  if (roadWay) {
    const between = roadWay.filter((i) => !towns.has(i))
    return { road: 1, paved: between.length ? between.filter((i) => paved.has(i)).length / between.length : 0 }
  }
  const way = line(from, to).map((o) => cellIndex(world, o.col, o.row))
  return { road: way.filter((i) => roads.has(i)).length / way.length, paved: way.filter((i) => paved.has(i)).length / way.length }
}

/** What a caravan carries, by weight: what its people carry on their backs (CARRY_EACH each), plus
 *  pack mules or ox carts (which need roads to roll on); paved roads let it carry up to half again. */
export const CARRY = { mules: 2000, carts: 4000 } as const
export function caravanCarry(world: World, s: GameState, from: Village, to: Village, crew = 1) {
  // animals need a stable hand to keep them
  const has = (t: string) => done(from).some((b) => b.type === t && staffing(from, b, 'summer') > 0)
  const animals: keyof typeof CARRY | 'foot' = has('cart_shed') && has('stable') ? 'carts' : has('stable') ? 'mules' : 'foot'
  const r = route(world, s, from, to)
  // off the road, carts bog down to what the mules could carry
  let base = crew * CARRY_EACH + (animals === 'foot' ? 0 : animals === 'carts' ? CARRY.mules + (CARRY.carts - CARRY.mules) * r.road : CARRY[animals])
  // thirsty animals carry less
  const stable = done(from).find((b) => b.type === 'stable')
  const thirsty = animals !== 'foot' && !!stable && !hasWater(world, s, cellIndex(world, stable.col, stable.row))
  if (thirsty) base -= (base - crew * CARRY_EACH) * 0.25
  return { cap: Math.floor(base * (1 + 0.5 * r.paved)), animals, thirsty, ...r }
}

/** From this moment every village has a purse to barter with: the ones
 *  already standing get it with the first event after it, and new ones start
 *  with it. Copper and silver are the coin every merchant takes. */
export const PURSE_FROM = DEPLETION_FROM
const PURSE: Goods = { copper: 10, silver: 1 }

function givePurses(s: GameState, at: string) {
  if (s.purses || at < PURSE_FROM) return
  s.purses = true
  for (const v of Object.values(s.villages)) addGoods(v, PURSE)
  if (Object.keys(s.villages).length) log(s, PURSE_FROM, null, `The merchants have come: every village gets a purse of ${fmtGoods(PURSE)} to trade with.`, 'good')
}

/** When herds started needing water, every pen, dairy and stable without any got a well of its own. */
function giveWells(s: GameState, world: World, at: string) {
  if (s.wellsGiven) return
  s.wellsGiven = true
  let n = 0
  for (const v of Object.values(s.villages)) for (const b of v.buildings) {
    if (!THIRSTY.has(b.type)) continue
    const i = cellIndex(world, b.col, b.row)
    if (hasWater(world, s, i)) continue
    ;(s.wells ??= {})[i] = true
    n++
  }
  if (n) log(s, at, null, `Herds need fresh water now. ${n === 1 ? 'A pen with none nearby was' : `${n} pens, dairies and stables with none nearby were`} given a well of ${n === 1 ? 'its' : 'their'} own.`, 'good')
}

/** When buildings started needing workers, every village short of hands for the buildings it
 *  already had was given the people it lacked, and a House (room for 4) to put them up. */
function giveStaff(s: GameState, world: World, at: string) {
  if (s.staffGiven) return
  s.staffGiven = true
  for (const v of Object.values(s.villages)) {
    const need = done(v).reduce((a, b) => a + needOf(b), 0)
    const short = need - people(v)
    if (short <= 0) continue
    v.population = round2(v.population + short)
    // a house on open, flat ground in its land, if there's any
    const taken = new Set<number>([cellIndex(world, v.col, v.row)])
    for (const o of Object.values(s.villages)) for (const b of o.buildings) taken.add(cellIndex(world, b.col, b.row))
    const spot = territoryCells(world, v).find((i) => {
      const land = landAt(world, s, i)
      return world.cells[i].tier > 0 && !taken.has(i) && !hasTrees(land) && !MOUNTAIN_TERRAIN.includes(land.terrain) && land.terrain !== 'swamp'
    })
    if (spot !== undefined) v.buildings.push({ id: `gift-house-${v.id}`, type: 'house', col: world.cells[spot].col, row: world.cells[spot].row, progress: 1 })
    log(s, at, v.playerId, `Buildings need workers now. ${short} newcomer${short === 1 ? '' : 's'} settled in ${V(v)} to staff its buildings${spot !== undefined ? ', and a House was raised for them' : ''}.`, 'good')
  }
}

/** Caravan crews back home: back to work. */
function crewsHome(s: GameState, at: string) {
  if (!s.homeward?.length) return
  const now = Date.parse(at)
  for (const h of s.homeward.filter((x) => Date.parse(x.at) <= now)) {
    const v = s.villages[h.village]
    if (v) v.away = Math.max(0, (v.away ?? 0) - h.crew)
  }
  s.homeward = s.homeward.filter((x) => Date.parse(x.at) > now)
}

/** How many arrived caravans the world remembers for its caravan page. */
const ARRIVED_KEPT = 40

/** Each village's road team digs the planned hexes in order: ROAD_TEAM people lay a hex a day, pro rata
 *  by the hour (so 5 people take two days, 20 lay two a day). Dirt roads cost nothing but the people's time. */
export function digRoads(s: GameState, world: World, at: string) {
  const now = Date.parse(at)
  for (const v of Object.values(s.villages)) {
    const plan = v.roadPlan
    if (!plan?.length || !(v.roadCrew && v.roadCrew > 0)) continue
    const was = v.roadAt ? Date.parse(v.roadAt) : now
    if (now <= was) continue
    v.roadAt = at
    let work = (v.roadDone ?? 0) + (v.roadCrew / ROAD_TEAM) * ((now - was) / 86_400_000)
    while (work >= 1 && plan.length) {
      work -= 1
      const i = plan.shift()!
      if (world.cells[i].tier === 0 || v.roads.includes(i)) { work += 1; continue }
      v.roads.push(i)
      log(s, at, v.playerId, world.cells[i].riverTo !== -1 ? 'The road team built a bridge over the river.' : 'The road team finished a stretch of dirt road.', 'good')
    }
    v.roadDone = plan.length ? Math.round(work * 1000) / 1000 : 0
  }
}

function deliverCaravans(s: GameState, at: string) {
  const now = Date.parse(at)
  const arrived = s.caravans.filter((c) => Date.parse(c.arriveAt) <= now)
  if (!arrived.length) return
  s.caravans = s.caravans.filter((c) => Date.parse(c.arriveAt) > now)
  for (const c of arrived) {
    // its people walk home
    if (c.crew && c.homeAt) (s.homeward ??= []).push({ village: c.from, crew: c.crew, at: c.homeAt })
    const to = s.villages[c.to]
    if (!to) continue
    s.arrived = [...(s.arrived ?? []), { ...c, fromName: s.villages[c.from]?.name, toName: to.name }].slice(-ARRIVED_KEPT)
    addGoods(to, c.goods)
    const gift = Object.keys(c.goods).some((g) => ['berries', 'cheese', 'relic', 'cloth', 'bread', 'tin'].includes(g))
    if (gift) to.morale = Math.min(100, to.morale + 2)
    log(s, c.arriveAt, to.playerId, `A caravan from ${s.villages[c.from] ? V(s.villages[c.from]) : 'afar'} arrived: ${fmtGoods(c.goods)}.`, 'good')
  }
}

// ------------------------------------------------------------------ nightly tick

/** A night's work by the village's buildings at production level `prod` (0..1 of a perfect day). */
/** Buildings whose game comes from the wild animals on their hex. */
const HUNTS = new Set(['hunting_lodge', 'forager_camp'])

/** The villagers eat half a unit of food each, fresh food first and a little of
 *  everything (variety lifts morale). Returns the food still needed (if they ran short). */
function eatFood(v: Village): { need: number; eaten: Set<Good> } {
  // those away on a neighbour's walls eat their own provisions
  let need = people(v) * EAT
  const eaten = new Set<Good>()
  const order = (Object.entries(FOOD) as [Good, { value: number; keeps: boolean }][]).sort((a, b) => Number(a[1].keeps) - Number(b[1].keeps))
  // spread across foods for variety: one pass taking a little of each, then fill
  for (const pass of [0.34, 1]) {
    for (const [g, f] of order) {
      if (need <= 1e-9) break
      const have = v.goods[g] ?? 0
      if (have <= 0) continue
      const want = Math.min(have, (need * pass) / f.value)
      if (want <= 0) continue
      addGoods(v, { [g]: -want })
      need -= want * f.value
      eaten.add(g)
    }
  }
  return { need, eaten }
}

/** Fresh food loses 30% overnight, and food past what the stores hold rots. True if any rotted. */
function spoil(v: Village): boolean {
  for (const [g, f] of Object.entries(FOOD) as [Good, { keeps: boolean }][]) {
    if (!f.keeps && v.goods[g]) addGoods(v, { [g]: -(v.goods[g]! * 0.3) })
  }
  const cap = storageCap(v)
  const stock = foodStock(v)
  if (stock <= cap) return false
  const k = cap / stock
  for (const g of Object.keys(FOOD) as Good[]) if (v.goods[g]) v.goods[g] = round2(v.goods[g]! * k)
  return true
}

/** Tonight, if the day ended now: what each good gains or loses (made, used, eaten, spoiled).
 *  Rare finds are shown as a range (0-1), never the roll itself. */
export function tonight(s: GameState, world: World, p: Player, now: Date) {
  const date = playerDate(now, p.resetHour, p.tz)
  const at = now.toISOString()
  const test = structuredClone(s)
  const tp = test.players[p.id]
  const tv = test.villages[p.villageId]
  const d = ensureDay(tp, date)
  const rest = isSabbath(date) && at >= SABBATH_FROM
  const score = rest ? REST_SCORE : d.frozen ? Math.max(dayScore(d), 60) : dayScore(d)
  const prod = weekSeason(date) === 'winter' ? 0 : 0.15 + 0.85 * (score / 100)
  const before: Goods = { ...tv.goods }
  const foodBefore = foodStock(tv)
  const odds: Odds = { expected: {}, rolled: {} }
  const made = produce(test, world, tv, tp, d, date, prod, at, odds)
  const { need } = eatFood(tv)
  spoil(tv)
  const rows: { good: Good; have: number; made: number; net: [number, number] }[] = []
  for (const g of new Set([...Object.keys(before), ...Object.keys(tv.goods)]) as Set<Good>) {
    const net = round2((tv.goods[g] ?? 0) - (before[g] ?? 0))
    const e = odds.expected[g]
    // a rare find: the roll is hidden, so show what it could come to
    const lo = e ? round2(net - (odds.rolled[g] ?? 0) + Math.floor(e)) : net
    const hi = e ? round2(net - (odds.rolled[g] ?? 0) + Math.ceil(e)) : net
    if (!(before[g] ?? 0) && !hi) continue
    rows.push({ good: g, have: round2(before[g] ?? 0), made: round2(made[g] ?? 0), net: [lo, hi] })
  }
  return { score, rows, hungry: need > 1e-6, food: round2(foodStock(tv) - foodBefore) }
}

/** What a building can be worked by hand for (a Work action): anything that makes goods, but not crops. */
export const workable = (b: { type: BuildingId }) => {
  const def = BUILDINGS[b.type]
  return !def.crop && !!(def.produces || def.mine || def.smelts || def.recipes)
}

/** A sawmill beside a river makes this many times the planks. */
export const RIVER_SAW = 3

/** Is there a river on this hex or one next to it? */
export function riverBeside(world: World, col: number, row: number): boolean {
  return spiral({ col, row }, 1).some((o) => {
    if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) return false
    const c = world.cells[cellIndex(world, o.col, o.row)]
    return c.riverTo !== -1 && c.tier !== 0
  })
}

/** One building's shift at strength k (1 = a full night at a full day's work, before morale).
 *  Rare finds (a mine's byproducts) come whole or not at all: `odds` collects what was expected. */
export function shift(s: GameState, world: World, v: Village, b: Building, k: number, date: ISODate, at: string, opts: { rain?: boolean; odds?: Odds; roll?: string } = {}): Goods {
  const def0 = BUILDINGS[b.type]
  // a workshop makes whatever it's been ordered to (the first thing, if nothing)
  const recipe = def0.recipes ? def0.recipes.find((r) => r.id === b.order) ?? def0.recipes[0] : null
  const def = recipe ? { ...def0, consumes: recipe.consumes, produces: recipe.produces } : def0
  // it makes as much as it has hands for
  const season = weekSeason(date)
  const st = staffing(v, b, season)
  if (def.harvest) {
    // a field is sown in spring (the share of the crew it has makes the share of the crop that goes in), is
    // left in summer, and is all reaped in autumn: the rest of the year it makes nothing
    if (season === 'spring') b.sown = Math.min(1, (b.sown ?? 1) + 0.5 * st)
    if (season !== 'autumn') return {}
  }
  k *= st * toolMult(v.tools, b.type)
  if (k <= 0) return {}
  const made: Goods = {}
  const note = (g: Goods, m = 1) => { for (const [x, n] of Object.entries(g)) if (n) made[x as Good] = round2((made[x as Good] ?? 0) + n * m) }
  const i = cellIndex(world, b.col, b.row)
  // herds with no fresh water within a hex give half
  if (THIRSTY.has(b.type)) {
    const w = hasWater(world, s, i, date)
    if (!w || w.dry) k *= THIRST
  }
  if (def.mine) {
    // the shaft brings up whatever lies at the level it's working
    const got = mineDig(world, s, i, b.depth ?? 1, (MINE_RATE[b.type] ?? 0) * k, opts.roll ?? date, opts.odds)
    addGoods(v, got)
    note(got)
    return made
  }
  if (def.smelts) {
    // the easiest ores first, as far as the shift, the charcoal and the ore on hand go
    let room = STATION_RATE * k
    for (const ore of stationOres(b.type)) {
      const o = ORES[ore]!
      if (room <= 0.005) break
      if (o.with && !done(v).some((x) => x.type === o.with)) continue
      const n = round2(Math.min(room, v.goods[ore] ?? 0, (v.goods.charcoal ?? 0) / o.fuel))
      if (n <= 0.005) continue
      addGoods(v, { [ore]: -n, charcoal: -n * o.fuel })
      const metal: Goods = { [o.metal]: round2(n * o.yield) }
      for (const [x, q] of Object.entries(o.byproduct ?? {})) metal[x as Good] = round2((metal[x as Good] ?? 0) + (q ?? 0) * n)
      addGoods(v, metal)
      note(metal)
      room -= n
    }
    return made
  }
  if (def.herd) {
    // a flock: cheese (a pinch of salt a ration) and wool, from every sheep, all year
    const y = dailyYield(heads(b), season)
    const cheese = Math.min(y.cheese * k, v.goods.salt ?? 0)
    const out: Goods = { wool: round2(y.wool * k) }
    if (cheese > 0.005) { out.cheese = round2(cheese); addGoods(v, { salt: -round2(cheese) }) }
    addGoods(v, out)
    note(out)
    return made
  }
  const yields = producesIn(def, season)
  if (!yields) return made
  if (def.harvest) k *= (0.25 + 0.75 * (b.sown ?? 1)) * (opts.rain ? 1.2 : 1) // unsown ground still gives volunteer grain
  if (def.crop && !def.harvest) k *= CROP_SEASON[weekSeason(date)] * (opts.rain ? 1.2 : 1)
  // ground picked clean of stone grows more
  if (def.crop && at >= DEPLETION_FROM) k *= 1 + CLEARED_FIELD_BONUS * (1 - stonyness(world, s, i))
  if (k <= 0) return made
  if (def.consumes) {
    // limited by inputs on hand
    let avail = 1
    for (const [g, n] of Object.entries(def.consumes)) avail = Math.min(avail, (v.goods[g as Good] ?? 0) / ((n ?? 0) * k))
    k *= Math.max(0, Math.min(1, avail))
    if (k <= 0) return made
    addGoods(v, def.consumes, -k)
  }
  let out: Goods = yields
  if (HUNTS.has(b.type) && yields.game) {
    // the game within two hexes limits what the crew brings back (and the hides with it), but is never all taken
    const want = yields.game * k
    const got = huntRange(world, s, b, date, want, HUNT_SHARE * toolMult(v.tools, b.type) * st)
    const r = want > 0 ? got / want : 0
    out = { ...yields, game: yields.game * r, ...(yields.leather ? { leather: yields.leather * r } : {}) }
  }
  // a mill by running water has a wheel to turn its saw: three times the planks from the same timber
  if (b.type === 'sawmill' && out.planks && riverBeside(world, b.col, b.row)) out = { ...out, planks: out.planks * RIVER_SAW }
  addGoods(v, out, k)
  note(out, k)
  return made
}

export function produce(s: GameState, world: World, v: Village, p: Player, d: DayRecord, date: ISODate, prod: number, at: string, odds?: Odds): Goods {
  const habitOn = (effect: string) => d.habitsDone.some((h) => p.habits.find((x) => x.id === h)?.effect === effect)
  const moraleK = 0.75 + v.morale / 200
  const libraryK = habitOn('library') && done(v).some((b) => b.type === 'library') ? 1.05 : 1
  const made: Goods = {}
  for (const b of done(v)) {
    const def = BUILDINGS[b.type]
    if (!def.produces && !def.mine && !def.smelts && !def.recipes) continue
    const k = prod * moraleK * libraryK * (onRole(v, def, at) ? 1.25 : 1)
    for (const [g, n] of Object.entries(shift(s, world, v, b, k, date, at, { rain: habitOn('rain'), odds }))) made[g as Good] = round2((made[g as Good] ?? 0) + (n ?? 0))
  }
  return made
}

/** A field for a village's first harvest, on the nearest open grass or meadow in its land (already sown). */
function starterField(world: World, s: GameState, v: Village): Building | null {
  const taken = new Set<number>([cellIndex(world, v.col, v.row)])
  for (const o of Object.values(s.villages)) for (const b of o.buildings) taken.add(cellIndex(world, b.col, b.row))
  const spot = territoryCells(world, v)
    .filter((i) => {
      const land = landAt(world, s, i)
      return world.cells[i].tier > 0 && !taken.has(i) && !v.city?.includes(i) && !hasTrees(land) && !!BUILDINGS.field.terrain?.includes(land.terrain)
    })
    .sort((a, b) => distance(world.cells[a], v) - distance(world.cells[b], v) || a - b)[0]
  if (spot === undefined) return null
  return { id: `starter-field-${v.id}`, type: 'field', col: world.cells[spot].col, row: world.cells[spot].row, progress: 1 }
}

/** The food update: fields are sown and reaped, gardens, fisheries and hunting crews make about what a worker needs,
 *  and every village already standing is handed up to FOOD_UPDATE_GRAIN loads of grain (as far as its stores hold,
 *  so none of it rots) and, if it has no field, one ready to reap. Said once, in a note. */
export const FOOD_UPDATE_GRAIN = 100
/** Villages founded from this moment start with a field and a week's grain. */
export const FOOD_FROM = '2026-11-24T00:00:00.000Z'
function foodUpdate(s: GameState, world: World, at: string) {
  if (s.foodUpdate || at < FOOD_FROM) return
  s.foodUpdate = true
  try {
    for (const v of Object.values(s.villages)) {
      const room = Math.max(0, (storageCap(v) - foodStock(v)) / FOOD.grain!.value)
      const grain = Math.floor(Math.min(FOOD_UPDATE_GRAIN, room) * 10) / 10
      if (grain > 0) addGoods(v, { grain })
      let field: Building | null = null
      if (!v.buildings.some((b) => BUILDINGS[b.type].harvest)) {
        field = starterField(world, s, v)
        if (field) v.buildings.push(field)
      }
      const a: Arrival = { id: `food-${at.slice(0, 10)}`, at, kind: 'food', people: 0, from: '', goods: grain > 0 ? { grain } : {} }
      v.arrivals = [...(v.arrivals ?? []), a].slice(-6)
      log(s, at, v.playerId, `The food rules have changed: fields are sown in spring and reaped in autumn, gardens, fisheries, hunters and flocks make about what a worker needs, and no more than about 40% of a village's people should have to work on food. ${V(v)} was given ${grain} loads of grain${field ? ' and a field' : ''} to ease the change.`, 'good')
    }
  } catch (e) {
    console.error('the food update could not run yet:', e)
  }
}

/** The flock's year, one night at a time: lambs on the first night of spring, the autumn cull on the last night of
 *  autumn, winter feed on the winter night, and a slaughter (oldest first) whenever the stores run low. */
function herdsNight(s: GameState, world: World, v: Village, date: ISODate, notes: string[]) {
  const pens = done(v).filter((b) => b.type === 'pen')
  // fields start the new year unsown
  if (weekSeason(date) === 'winter') for (const b of v.buildings) if (BUILDINGS[b.type].harvest) b.sown = 0
  if (!pens.length) return
  const season = weekSeason(date)
  const day = weekday(date)
  const cap = pastureCap(world, s, v, (c, r) => inTerritory(v, c, r))
  const kill = (b: Building, n: number, why: string) => {
    n = Math.min(Math.floor(n), Math.max(0, heads(b) - 2))
    const took = n > 0 ? slaughter(b, n) : 0
    if (!took) return 0
    const m = mutton(took, v.goods.salt ?? 0)
    if (m.salted > 0) addGoods(v, { salt: -m.salted })
    addGoods(v, m.goods)
    notes.push(`${took} sheep ${why}: ${fmtGoods(m.goods)}`)
    return took
  }
  if (day === 0 && season === 'spring') {
    let room = cap - sheepOf(v)
    let born = 0
    for (const b of pens) { const n = lamb(b, room); room -= n; born += n }
    if (born) notes.push(`${born} lambs born`)
  }
  if (day === 5 && season === 'autumn') {
    // the oldest tenth, and whatever the pasture can't carry through the winter
    let extra = Math.max(0, sheepOf(v) - cap)
    for (const b of pens) {
      const h = heads(b)
      const over = Math.min(h, Math.round(extra * h / Math.max(1, sheepOf(v))))
      extra -= over
      kill(b, Math.round(h * CULL_RATE) + over, 'culled for the winter')
    }
  } else if (season !== 'winter' && foodStock(v) < LEAN_DAYS * people(v) * EAT) {
    // the stores are low: slaughter, oldest first
    for (const b of pens) kill(b, Math.ceil(heads(b) * LEAN_CULL), 'slaughtered, the stores were low')
  }
  if (season === 'winter') {
    // the flock eats grain; sheep there is no grain for are slaughtered
    for (const b of pens) {
      const need = heads(b) * FEED_PER_HEAD
      const have = (v.goods.grain ?? 0) * FOOD.grain!.value
      const fed = Math.min(need, have)
      if (fed > 0) addGoods(v, { grain: -fed / FOOD.grain!.value })
      if (need - fed > 1e-6) kill(b, Math.ceil((need - fed) / FEED_PER_HEAD), 'slaughtered, there was no grain to feed them')
      age(b)
    }
  }
}

function tick(s: GameState, world: World, p: Player, ev: Extract<GameEvent, { t: 'tick' }>) {
  const v = s.villages[p.villageId]
  const d = ensureDay(p, ev.date)
  const season = weekSeason(ev.date)
  const winter = season === 'winter'
  const rng = rngFor(s.worldSeed, 'tick', p.id, ev.date)
  const habitOn = (effect: string) => d.habitsDone.some((h) => p.habits.find((x) => x.id === h)?.effect === effect)
  const rest = isSabbath(ev.date) && ev.at >= SABBATH_FROM
  const score = rest ? REST_SCORE : d.frozen ? Math.max(dayScore(d), 60) : dayScore(d)
  const notes: string[] = []

  // 1. production
  const foodBefore = foodStock(v)
  const prod = winter ? 0 : 0.15 + 0.85 * (score / 100)
  const made = produce(s, world, v, p, d, ev.date, prod, ev.at)
  if (Object.keys(made).length) notes.push(`made ${fmtGoods(made)}`)
  herdsNight(s, world, v, ev.date, notes)

  // 2. eating (fresh food first, it spoils anyway)
  const pop = people(v)
  const { need, eaten } = eatFood(v)
  const short = need > 1e-6
  const variety = eaten.size
  let moraleTarget = 50 + (score - 50) / 5 + Math.max(-4, (variety - 2) * 3)
  moraleTarget += done(v).reduce((a, b) => a + (BUILDINGS[b.type].morale ?? 0), 0)
  if (habitOn('morale')) moraleTarget += 6
  if (habitOn('health')) moraleTarget += 2
  if (short) {
    const harsh = winter ? 12 : 6
    v.morale -= harsh
    notes.push(winter ? 'a hard winter — the stores ran out' : 'not enough food')
    if (need > pop * EAT * 0.5 && v.population > 3 * HEADS) {
      v.population -= HEADS
      notes.push('a family left to find food')
    }
  }
  v.morale = Math.round(Math.max(0, Math.min(100, v.morale + (moraleTarget - v.morale) * 0.25)))

  // 2b. the winter night: wood or peat on the fire, a unit for every FUEL_PEOPLE people (peat first)
  if (winter) {
    const want = round2(pop / FUEL_PEOPLE)
    let burn = want
    const burned: Goods = {}
    for (const g of ['peat', 'timber'] as const) {
      const n = round2(Math.min(burn, v.goods[g] ?? 0))
      if (n > 0) { addGoods(v, { [g]: -n }); burned[g] = n; burn = round2(burn - n) }
    }
    if (burn > 0.005) {
      v.morale -= 6
      notes.push('no wood or peat to burn: a cold night')
    } else if (want > 0) notes.push(`burned ${fmtGoods(burned)} to keep warm`)
  }

  // 3. spoilage + storage cap
  if (spoil(v)) notes.push('food rotted for want of a granary')

  // 4. growth: room in the houses, reasonable morale, and the village making at least as much food as it eats
  const fed = foodStock(v) >= foodBefore - 1e-6
  if (!short && fed && !winter && v.morale >= GROW_MORALE && v.population < popCap(v)) {
    v.population = round2(Math.min(popCap(v), v.population + (0.15 + 0.35 * (score / 100)) * HEADS))
  }

  // 4a. after winter, newcomers arrive: as many as the village has room and morale for, with food for three days
  if (!winter && weekSeason(addDays(ev.date, -1)) === 'winter' && v.welcomed !== ev.date) {
    v.welcomed = ev.date
    const n = influx(v.population, popCap(v) - v.population, v.morale, GROW_MORALE)
    if (n > 0) {
      welcome(s, v, ev.at, 'winter', n)
      notes.push(`${n} newcomers settled`)
    }
  }

  // 4b. troops at the palisade eat their own provisions; those left waiting too long give up
  for (const d of [...garrison(s, v)]) {
    if (d.status === 'waiting') {
      if (daysBetween(d.since.slice(0, 10), ev.date) >= WAIT_DAYS) sendHome(s, v, d, ev.at, 'gave up waiting at the gate')
    } else if (!eat(d) || nightsOf(d) < 1) sendHome(s, v, d, ev.at, 'ate the last of their provisions')
  }

  // 5. monsters adapt to nearby players and sometimes raid
  const villages = Object.values(s.villages)
  for (const lair of s.lairs) {
    if (lair.cleared || distance(lair, v) > 7) continue
    const near = villages.filter((o) => distance(o, lair) <= 8)
    const target = 0.8 * (near.reduce((a, o) => a + power(o), 0) / Math.max(1, near.length))
    lair.strength = round2(Math.max(lair.strength, lair.strength + (target - lair.strength) * 0.1))
    const bold = winter && v.winterForecast === 'hungry' ? 1.5 : 1
    const chance = 0.12 * bold * (lair.strength / (lair.strength + (defence(v) + troopsAt(s, v)) * 2))
    if (rng() < chance) {
      const goods = Object.entries(v.goods).filter(([, n]) => (n ?? 0) >= 2)
      if (goods.length) {
        const [g, n] = goods[Math.floor(rng() * goods.length)]
        const lost = round2((n ?? 0) * 0.2)
        addGoods(v, { [g]: -lost })
        log(s, ev.at, p.id, `${CHEEK.raid[lair.kind]} ${lost} ${g.replace('_', ' ')}.`, 'monster')
      }
    }
  }

  // 6. habits -> slots (missing never removes a slot; Saturday misses are neutral; freezes pause)
  if (!d.frozen && p.habits.length) {
    const all = p.habits.every((h) => d.habitsDone.includes(h.id))
    if (all) p.perfectStreak++
    else if (!winter) p.perfectStreak = 0
    if (p.perfectStreak >= PERFECT_DAYS_PER_SLOT && p.habitSlots < MAX_HABIT_SLOTS) {
      p.habitSlots++
      p.perfectStreak = 0
      log(s, ev.at, p.id, `A perfect week! ${P(p)} unlocked habit slot ${p.habitSlots}.`, 'good')
    }
  }

  // 7. weekly bookkeeping
  if (weekday(ev.date) === 6) p.freezes = Math.max(p.freezes, 1) // fresh freeze for the new week
  if (weekday(ev.date) === 4 || weekday(ev.date) === 5) {
    const keeps = foodStock(v, true)
    const needWinter = people(v) * EAT
    v.winterForecast = keeps >= needWinter * 1.5 ? 'stocked' : keeps >= needWinter ? 'tight' : 'hungry'
  }

  // trees spread back each winter (felled ones were stumps until now)
  if (winter && ev.at >= TREES_FROM) { growWoods(s, world, ev.date); sprout(s, world, v, ev.date); winterWater(s, world, ev.date) }

  // 8. unspent tokens keep (before KEEP_TOKENS_FROM they expired at the end of
  // winter, and before the weekly rule a day after they were earned)
  if (ev.at < WEEKLY_TOKENS_FROM) p.tokens = p.tokens.filter((t) => t.date >= ev.date)
  else if (winter && ev.at < KEEP_TOKENS_FROM) p.tokens = []
  d.ticked = true
  p.lastTick = ev.date

  const head = winter ? `❄️ Winter rest (${ev.date})` : `Night falls on ${ev.date}: score ${score}`
  log(s, ev.at, p.id, `${head}${notes.length ? ' — ' + notes.join('; ') : ''}.`, short ? 'bad' : 'info')
  return s
}

/** Dates that need a tick event, oldest first (never today). */
export function pendingTicks(p: Player, today: ISODate, joined: ISODate): ISODate[] {
  const out: ISODate[] = []
  let d = p.lastTick ? addDays(p.lastTick, 1) : joined
  let guard = 0
  while (d < today && guard++ < 60) {
    out.push(d)
    d = addDays(d, 1)
  }
  return out
}

export function habitPreset(id: string) {
  return HABIT_PRESETS.find((h) => h.id === id)
}
