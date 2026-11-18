/** The whole game is: world seed + ordered list of events -> state.
 *  `apply` is deterministic (all randomness is seeded from event ids), so every
 *  client replaying the same log sees the same world. Invalid events are
 *  ignored with a log line rather than throwing, because logs are shared.
 */
import { distance, spiral } from '../world/hex'
import { rngFor } from '../world/rng'
import { hasTrees, isOpen, isVillageSite, MOUNTAIN_TERRAIN, type Land } from '../world/land'
import type { Feature, Resource, Terrain, World } from '../world/types'
import { addDays, CROP_SEASON, daysBetween, playerDate, weekSeason, weekday } from './calendar'
import {
  ACTIONS, BUILDINGS, FOOD, GATHER, HABIT_PRESETS, MAX_HABIT_SLOTS, PERFECT_DAYS_PER_SLOT,
  PLAN_SIZES, SIZE_POINTS, SIZE_RANK, type BuildingDef, type Good, type Goods,
} from './data'
import type { DayRecord, GameEvent, GameState, ISODate, LogEntry, Player, Village } from './types'

export function newGame(world: World, seasonStart: ISODate): GameState {
  return {
    worldSeed: world.seed,
    seasonStart,
    players: {},
    villages: {},
    caravans: [],
    lairs: world.lairs.map((l) => ({ ...l, cleared: false })),
    revealed: [],
    log: [],
    version: 0,
  }
}

// ------------------------------------------------------------------ selectors

export function ensureDay(p: Player, date: ISODate): DayRecord {
  return (p.days[date] ??= {
    date, slots: PLAN_SIZES.map((size) => ({ size, status: 'none' })), habitsDone: [], frozen: false, ticked: false,
  })
}

export function dayScore(d: DayRecord | undefined): number {
  if (!d) return 0
  return d.slots.reduce((a, s) => a + SIZE_POINTS[s.size] * (s.status === 'full' ? 1 : s.status === 'half' ? 0.5 : 0), 0)
}

export function cellIndex(world: World, col: number, row: number) {
  return row * world.width + col
}

export function territory(v: Village): { col: number; row: number; radius: number }[] {
  return [{ col: v.col, row: v.row, radius: VILLAGE_RADIUS }, ...v.outposts.map((o) => ({ col: o.col, row: o.row, radius: (o as { radius?: number }).radius ?? 1 }))]
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
export const VILLAGE_RADIUS = 2
export const FOUNDING_GAP = 2

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

export interface LandNow extends Land { resource: Resource | null }

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
  return { terrain, feature, resource, tier: cell.tier }
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

export function popCap(v: Village) {
  return 6 + done(v).reduce((a, b) => a + (BUILDINGS[b.type].popCap ?? 0), 0)
}

export function defence(v: Village) {
  return 2 + done(v).reduce((a, b) => a + (BUILDINGS[b.type].defence ?? 0), 0)
}

export function power(v: Village) {
  const g = v.goods
  return v.population + defence(v) * 1.5 + Math.min(g.bronze ?? 0, 5) * 2 + Math.min(g.iron ?? 0, 5) * 2.5 + Math.min(g.steel ?? 0, 5) * 4
}

function done(v: Village) {
  return v.buildings.filter((b) => b.progress >= 1)
}

export function storageCap(v: Village) {
  return 30 + done(v).reduce((a, b) => a + (BUILDINGS[b.type].storage ?? 0), 0)
}

export function foodStock(v: Village, keepsOnly = false) {
  let t = 0
  for (const [g, f] of Object.entries(FOOD)) if (f && (!keepsOnly || f.keeps)) t += (v.goods[g as Good] ?? 0) * f.value
  return t
}

/** Cost after specialisation: other roles' buildings cost double. */
export function buildCost(v: Village, def: BuildingDef): Goods {
  const k = def.role === 'any' || def.role === v.role ? 1 : 2
  const out: Goods = {}
  for (const [g, n] of Object.entries(def.cost)) out[g as Good] = (n ?? 0) * k
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
      if (d?.ticked) return 'That day is already over'
      if (ev.slot < 0 || ev.slot >= PLAN_SIZES.length) return 'No such slot'
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
      if (p.freezes <= 0) return 'No freezes left this week'
      if (p.days[ev.date]?.frozen) return 'Already frozen'
      if (p.days[ev.date]?.ticked) return 'That day is already over'
      return null
    case 'abandon':
      return null
    case 'rename': {
      const n = ev.name.trim()
      if (!n) return 'Pick a name'
      if (n.length > 20) return 'Names are at most 20 letters'
      return n === p.name ? 'That is already the name' : null
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
  }
}

function validateAct(s: GameState, world: World, p: Player, v: Village, ev: Extract<GameEvent, { t: 'act' }>): string | null {
  const tok = p.tokens.find((t) => t.id === ev.tokenId)
  if (!tok) return 'That action token has been used'
  const need = ACTIONS[ev.action].size
  if (ev.action === 'build') {
    const def = ev.building && BUILDINGS[ev.building]
    if (!def) return 'Unknown building'
    if (SIZE_RANK[tok.size] < SIZE_RANK[def.size]) return `${def.name} needs a ${def.size} task`
  } else if (SIZE_RANK[tok.size] < SIZE_RANK[need]) return `${ACTIONS[ev.action].name} needs a ${need} task`
  if (ev.col < 0 || ev.row < 0 || ev.col >= world.width || ev.row >= world.height) return 'Off the map'
  const i = cellIndex(world, ev.col, ev.row)
  const cell = world.cells[i]
  const revealed = s.revealed.includes(i)
  const land = landAt(world, s, i)
  const terr = land.terrain
  switch (ev.action) {
    case 'scout': {
      if (revealed) return null
      const near = spiral(ev, 1).some((o) => s.revealed.includes(cellIndex(world, o.col, o.row)))
      return near ? null : 'Scout from the edge of what you know'
    }
    case 'gather': {
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (!land.resource || !GATHER[land.resource]) return 'Nothing to gather here'
      return null
    }
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
      return null
    case 'road':
      if (cell.tier === 0) return 'Roads need land'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 1)) return 'Roads must start from your territory'
      if (v.roads.includes(i)) return 'Already a road'
      return null
    case 'build': {
      const def = BUILDINGS[ev.building!]
      if (!inTerritory(v, ev.col, ev.row)) return 'Only inside your territory'
      if (cell.tier === 0) return 'Not on water'
      if (ev.col === v.col && ev.row === v.row) return 'That is your village square'
      const existing = buildingAt(s, ev.col, ev.row)
      if (existing) {
        if (existing.building.type === def.id && existing.building.progress < 1) return null // finishing
        return 'Something is already built here'
      }
      const woodland = def.terrain?.includes('forest')
      if (hasTrees(land) && !woodland) return 'Fell the trees here first'
      if (MOUNTAIN_TERRAIN.includes(terr) && !def.mountain) return 'Too steep: only mines and quarries go on a mountain'
      if (terr === 'swamp' && !def.terrain?.includes('swamp')) return 'Too boggy to build on'
      if (def.terrain && !def.terrain.includes(terr)) return `${def.name} needs ${def.terrain.join('/')}`
      if (def.resource && !(land.resource && def.resource.includes(land.resource))) return `${def.name} needs a ${def.resource.join('/')} deposit`
      if (def.nearTerrain && !spiral(ev, 1).some((o) => {
        if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) return false
        return def.nearTerrain!.includes(effectiveTerrain(world, s, cellIndex(world, o.col, o.row)))
      })) return `${def.name} must be next to ${def.nearTerrain.join('/')}`
      const cost = buildCost(v, def)
      if (!hasGoods(v, cost, tok.strength)) return `Needs ${fmtGoods(cost, tok.strength)}`
      return null
    }
    case 'caravan': {
      const to = ev.to && s.villages[ev.to]
      if (!to || to.id === v.id) return 'Pick a neighbour village'
      const total = Object.values(ev.goods ?? {}).reduce((a, n) => a + (n ?? 0), 0)
      if (total <= 0) return 'Load some goods'
      const cap = tok.strength >= 1 ? 15 : 6
      if (total > cap) return `This caravan carries at most ${cap}`
      if (!hasGoods(v, ev.goods!)) return 'Not enough goods'
      return null
    }
    case 'outpost': {
      if (cell.tier === 0) return 'Outposts need land'
      if (!revealed) return 'Scout there first'
      if (inTerritory(v, ev.col, ev.row)) return 'Already your territory'
      if (hasTrees(land)) return 'Fell the trees there first'
      if (!isOpen(land)) return 'Outposts need open ground'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 4)) return 'Too far from your territory'
      if (Object.values(s.villages).some((o) => o.id !== v.id && inTerritory(o, ev.col, ev.row))) return 'That is a neighbour’s land'
      if (!hasGoods(v, { timber: 6, stone: 2 }, tok.strength)) return `Needs ${fmtGoods({ timber: 6, stone: 2 }, tok.strength)}`
      return null
    }
    case 'expedition': {
      const lair = s.lairs.find((l) => l.col === ev.col && l.row === ev.row && !l.cleared)
      if (!lair) return 'No monsters here'
      if (!revealed) return 'Scout it first'
      if (!territory(v).some((t) => distance(t, ev) <= t.radius + 8)) return 'Too far to march'
      return null
    }
  }
}

export function fmtGoods(g: Goods, k = 1) {
  return Object.entries(g).map(([n, q]) => `${round2((q ?? 0) * k)} ${n.replace('_', ' ')}`).join(', ')
}

// ------------------------------------------------------------------ apply

export function apply(s: GameState, world: World, ev: GameEvent): GameState {
  const err = validate(s, world, ev)
  s.version++
  deliverCaravans(s, ev.at)
  if (err) {
    log(s, ev.at, ev.playerId, `(ignored: ${err})`, 'info')
    return s
  }
  const p = s.players[ev.playerId]
  switch (ev.t) {
    case 'join': return join(s, world, ev)
    case 'progress': return progress(s, p, ev)
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
      log(s, ev.at, p.id, `${p.name} used a freeze for ${ev.date}.`, 'info')
      return s
    }
    case 'resetHour':
      p.resetHour = ev.hour
      p.resetChangedAt = ev.at
      return s
    case 'act': return act(s, world, p, ev)
    case 'tick': return tick(s, world, p, ev)
    case 'abandon': return abandon(s, p, ev.at)
    case 'rename': {
      const v = s.villages[p.villageId]
      const name = ev.name.trim()
      // a village still called after its founder follows the new name
      if (v.name === `${p.name}’s ${ROLE_TOWN[v.role]}`) v.name = `${name}’s ${ROLE_TOWN[v.role]}`
      log(s, ev.at, p.id, `${p.name} is now known as ${name}.`, 'info')
      p.name = name
      return s
    }
  }
}

/** The village and all progress go; the map it revealed stays known to everyone. */
function abandon(s: GameState, p: Player, at: string) {
  const v = s.villages[p.villageId]
  s.caravans = s.caravans.filter((c) => c.from !== v.id && c.to !== v.id)
  delete s.villages[v.id]
  delete s.players[p.id]
  log(s, at, null, `${p.name} abandoned ${v.name}. The land is free again.`, 'info')
  return s
}

/** A habit with a goal is done exactly when the day's total reaches it. */
function syncGoal(d: DayRecord, h: { id: string; goal?: { target: number } }) {
  if (!h.goal) return
  const done = (d.amounts?.[h.id] ?? 0) + 1e-9 >= h.goal.target
  d.habitsDone = d.habitsDone.filter((x) => x !== h.id)
  if (done) d.habitsDone.push(h.id)
}

function log(s: GameState, at: string, playerId: string | null, text: string, kind: LogEntry['kind']) {
  s.log.push({ at, playerId, text, kind })
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300)
}

function join(s: GameState, world: World, ev: Extract<GameEvent, { t: 'join' }>) {
  const vid = 'v_' + ev.playerId
  const p: Player = {
    id: ev.playerId, name: ev.name, villageId: vid, resetHour: ev.resetHour, resetChangedAt: null, tz: ev.tz,
    habits: [], habitSlots: 1, perfectStreak: 0, freezes: 1, days: {}, tokens: [], lastTick: null,
  }
  const v: Village = {
    id: vid, playerId: p.id, name: `${ev.name}’s ${ROLE_TOWN[ev.role]}`, role: ev.role,
    col: ev.site.col, row: ev.site.row, population: 5, morale: 60,
    goods: { grain: 12, timber: 8, stone: 3, berries: 4 }, buildings: [], outposts: [], roads: [], planted: [], cleared: [],
    winterForecast: 'tight',
  }
  s.players[p.id] = p
  s.villages[vid] = v
  reveal(world, s, ev.site, 4)
  log(s, ev.at, p.id, `${ev.name} founded a ${ev.role} village.`, 'good')
  return s
}

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

function progress(s: GameState, p: Player, ev: Extract<GameEvent, { t: 'progress' }>) {
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
  const tok = p.tokens.find((t) => t.id === ev.tokenId)!
  const k = tok.strength
  const i = cellIndex(world, ev.col, ev.row)
  const rng = rngFor(s.worldSeed, ev.id)
  const land0 = landAt(world, s, i)
  consumeToken(p, tok.id)
  switch (ev.action) {
    case 'scout': {
      const camp = done(v).some((b) => b.type === 'scout_camp') ? 1 : 0
      const radius = (k >= 1 ? 2 : 1) + camp
      reveal(world, s, ev, radius)
      const found = spiral(ev, radius).map((o) => s.lairs.find((l) => !l.cleared && l.col === o.col && l.row === o.row)).find(Boolean)
      log(s, ev.at, p.id, found ? `Scouts spotted ${found.kind} nearby!` : 'Scouts mapped new land.', found ? 'monster' : 'info')
      break
    }
    case 'gather': {
      const g = GATHER[land0.resource!]!
      const n = round2(3 * k)
      addGoods(v, { [g]: n })
      log(s, ev.at, p.id, `Gathered ${n} ${g.replace('_', ' ')}.`, 'good')
      break
    }
    case 'clear': {
      const wood = land0.terrain === 'forest' ? 3 : 1
      const n = round2(wood * k)
      v.planted = v.planted.filter((x) => x.cell !== i)
      if (!v.cleared.includes(i)) v.cleared.push(i)
      addGoods(v, { timber: n })
      log(s, ev.at, p.id, `Trees felled: +${n} timber. The land is open.`, 'good')
      break
    }
    case 'plant':
      v.cleared = v.cleared.filter((x) => x !== i)
      v.planted.push({ cell: i, date: ev.at.slice(0, 10) })
      log(s, ev.at, p.id, 'Saplings planted. A forest in three days.', 'good')
      break
    case 'road':
      v.roads.push(i)
      log(s, ev.at, p.id, 'A dirt road was laid.', 'good')
      break
    case 'build': {
      const def = BUILDINGS[ev.building!]
      const existing = buildingAt(s, ev.col, ev.row)
      addGoods(v, buildCost(v, def), -k)
      if (existing) existing.building.progress = Math.min(1, existing.building.progress + k)
      else v.buildings.push({ id: ev.id, type: def.id, col: ev.col, row: ev.row, progress: Math.min(1, k) })
      const b = buildingAt(s, ev.col, ev.row)!.building
      log(s, ev.at, p.id, b.progress >= 1 ? `${def.name} completed!` : `${def.name} half-built.`, 'good')
      break
    }
    case 'caravan': {
      const to = s.villages[ev.to!]
      addGoods(v, ev.goods!, -1)
      const dist = distance(v, to)
      const walked = p.days[ev.at.slice(0, 10)]?.habitsDone.some((h) => p.habits.find((x) => x.id === h)?.effect === 'movement')
      const mins = dist * 20 * (walked ? 0.6 : 1)
      s.caravans.push({
        id: ev.id, from: v.id, to: to.id, goods: ev.goods!, departAt: ev.at,
        arriveAt: new Date(Date.parse(ev.at) + mins * 60_000).toISOString(),
      })
      log(s, ev.at, p.id, `A caravan set off for ${to.name}.`, 'info')
      break
    }
    case 'outpost':
      addGoods(v, { timber: 6, stone: 2 }, -k)
      v.outposts.push({ col: ev.col, row: ev.row, radius: k >= 1 ? 1 : 0 } as Village['outposts'][number])
      reveal(world, s, ev, 2)
      log(s, ev.at, p.id, k >= 1 ? 'An outpost was founded.' : 'A small camp was pitched.', 'good')
      break
    case 'expedition': {
      const lair = s.lairs.find((l) => l.col === ev.col && l.row === ev.row && !l.cleared)!
      const g = v.goods
      const food = Math.min(6, (g.bread ?? 0) + (g.cheese ?? 0) + (g.smoked_fish ?? 0))
      const outfitter = done(v).some((b) => b.type === 'outfitter') ? 5 : 0
      let pw = 4 + v.population * 0.5 + Math.min(g.bronze ?? 0, 5) * 2 + Math.min(g.iron ?? 0, 5) * 2.5 +
        Math.min(g.steel ?? 0, 5) * 4 + Math.min(g.leather ?? 0, 5) * 0.5 + outfitter + food * 0.5
      pw *= k >= 1 ? 1 : 0.6
      const win = rng() < pw / (pw + lair.strength)
      for (const f of ['bread', 'cheese', 'smoked_fish'] as const) {
        const take = Math.min(g[f] ?? 0, 1)
        if (take) addGoods(v, { [f]: -take })
      }
      if (win) {
        lair.cleared = true
        const loot = LOOT[lair.kind]
        addGoods(v, loot)
        log(s, ev.at, p.id, `${CHEEK.win[lair.kind]} Loot: ${fmtGoods(loot)}.`, 'good')
      } else {
        v.morale = Math.max(0, v.morale - 6)
        lair.strength += 1
        log(s, ev.at, p.id, CHEEK.lose[lair.kind], 'monster')
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

function deliverCaravans(s: GameState, at: string) {
  const now = Date.parse(at)
  const arrived = s.caravans.filter((c) => Date.parse(c.arriveAt) <= now)
  if (!arrived.length) return
  s.caravans = s.caravans.filter((c) => Date.parse(c.arriveAt) > now)
  for (const c of arrived) {
    const to = s.villages[c.to]
    if (!to) continue
    addGoods(to, c.goods)
    const gift = Object.keys(c.goods).some((g) => ['berries', 'cheese', 'relic', 'cloth', 'bread', 'tin'].includes(g))
    if (gift) to.morale = Math.min(100, to.morale + 2)
    log(s, c.arriveAt, to.playerId, `A caravan from ${s.villages[c.from]?.name ?? 'afar'} arrived: ${fmtGoods(c.goods)}.`, 'good')
  }
}

// ------------------------------------------------------------------ nightly tick

function tick(s: GameState, _world: World, p: Player, ev: Extract<GameEvent, { t: 'tick' }>) {
  const v = s.villages[p.villageId]
  const d = ensureDay(p, ev.date)
  const season = weekSeason(ev.date)
  const winter = season === 'winter'
  const rng = rngFor(s.worldSeed, 'tick', p.id, ev.date)
  const habitOn = (effect: string) => d.habitsDone.some((h) => p.habits.find((x) => x.id === h)?.effect === effect)
  const score = d.frozen ? Math.max(dayScore(d), 60) : dayScore(d)
  const notes: string[] = []

  // 1. production
  const prod = winter ? 0 : 0.15 + 0.85 * (score / 100)
  const moraleK = 0.75 + v.morale / 200
  const libraryK = habitOn('library') && done(v).some((b) => b.type === 'library') ? 1.05 : 1
  const made: Goods = {}
  for (const b of done(v)) {
    const def = BUILDINGS[b.type]
    if (!def.produces) continue
    let k = prod * moraleK * libraryK * (def.role === v.role ? 1.25 : 1)
    if (def.crop) k *= CROP_SEASON[season] * (habitOn('rain') ? 1.2 : 1)
    if (k <= 0) continue
    if (def.consumes) {
      // limited by inputs on hand
      let avail = 1
      for (const [g, n] of Object.entries(def.consumes)) avail = Math.min(avail, (v.goods[g as Good] ?? 0) / ((n ?? 0) * k))
      k *= Math.max(0, Math.min(1, avail))
      if (k <= 0) continue
      addGoods(v, def.consumes, -k)
    }
    addGoods(v, def.produces, k)
    for (const [g, n] of Object.entries(def.produces)) made[g as Good] = round2((made[g as Good] ?? 0) + (n ?? 0) * k)
  }
  if (Object.keys(made).length) notes.push(`made ${fmtGoods(made)}`)

  // 2. eating (fresh food first, it spoils anyway)
  const pop = Math.floor(v.population)
  let need = pop * 0.5
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
    if (need > pop * 0.25 && v.population > 3) {
      v.population -= 1
      notes.push('a family left to find food')
    }
  }
  v.morale = Math.round(Math.max(0, Math.min(100, v.morale + (moraleTarget - v.morale) * 0.25)))

  // 3. spoilage + storage cap
  for (const [g, f] of Object.entries(FOOD) as [Good, { keeps: boolean }][]) {
    if (!f.keeps && v.goods[g]) addGoods(v, { [g]: -(v.goods[g]! * 0.3) })
  }
  const cap = storageCap(v)
  const stock = foodStock(v)
  if (stock > cap) {
    const k = cap / stock
    for (const g of Object.keys(FOOD) as Good[]) if (v.goods[g]) v.goods[g] = round2(v.goods[g]! * k)
    notes.push('food rotted for want of a granary')
  }

  // 4. growth
  if (!short && !winter && v.morale >= 45 && v.population < popCap(v)) {
    v.population = round2(Math.min(popCap(v), v.population + 0.15 + 0.35 * (score / 100)))
  }

  // 5. monsters adapt to nearby players and sometimes raid
  const villages = Object.values(s.villages)
  for (const lair of s.lairs) {
    if (lair.cleared || distance(lair, v) > 7) continue
    const near = villages.filter((o) => distance(o, lair) <= 8)
    const target = 0.8 * (near.reduce((a, o) => a + power(o), 0) / Math.max(1, near.length))
    lair.strength = round2(Math.max(lair.strength, lair.strength + (target - lair.strength) * 0.1))
    const bold = winter && v.winterForecast === 'hungry' ? 1.5 : 1
    const chance = 0.12 * bold * (lair.strength / (lair.strength + defence(v) * 2))
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
      log(s, ev.at, p.id, `A perfect week! ${p.name} unlocked habit slot ${p.habitSlots}.`, 'good')
    }
  }

  // 7. weekly bookkeeping
  if (weekday(ev.date) === 6) p.freezes = Math.max(p.freezes, 1) // fresh freeze for the new week
  if (weekday(ev.date) === 4 || weekday(ev.date) === 5) {
    const keeps = foodStock(v, true)
    const needWinter = Math.floor(v.population) * 0.5
    v.winterForecast = keeps >= needWinter * 1.5 ? 'stocked' : keeps >= needWinter ? 'tight' : 'hungry'
  }

  // 8. tokens are for spending: unspent ones expire a day later
  p.tokens = p.tokens.filter((t) => t.date >= ev.date)
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
