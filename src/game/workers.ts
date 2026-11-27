/** Workers: the village's people at home do its work.
 *
 *  Every building that makes something needs hands (WORKERS). A building with
 *  half its workers makes half as much. A village either manages its own workers
 *  (the default: food first, then the rest) or the player assigns them by hand.
 *  People not working are spare: they can go with a caravan (each carries
 *  CARRY_EACH) or as troops to a neighbour's palisade.
 *
 *  More people come once a year, the Sunday after the Saturday winter, when there's room
 *  in the homes, morale is reasonable, and nobody went hungry on the winter night (see tick). */
import { BUILDINGS, EAT, FOOD, FOOD_SCALE, HEADS, producesIn, type BuildingId, type Good, type Goods } from './data'
import type { WeekSeason } from './calendar'
import { penCrew } from './herds'
import type { Building, Village } from './types'

/** Hands each building needs to run at full strength (none: houses, walls, halls...). */
export const WORKERS: Partial<Record<BuildingId, number>> = {
  garden: 1, field: 2, orchard: 1, irrigation: 1, mill: 2,
  shore_fishery: 2, smokehouse: 1, salt_pans: 1, docks: 3, shipyard: 3,
  quarry: 2, kiln: 1, copper_mine: 3, iron_mine: 3, silver_mine: 3, smelter: 2, bloomery: 2, silver_refinery: 2, bronze_foundry: 2, roasting_heap: 1,
  forager_camp: 1, lumber_camp: 2, hunting_lodge: 2, charcoal_kiln: 1, sawmill: 2,
  pen: 1, dairy: 1, weaver: 1, stable: 1, cart_shed: 1,
  nitre_beds: 1, powder_mill: 2, gun_foundry: 3, gunsmith: 2, siege_workshop: 2,
  smithy: 1, outfitter: 1,
}
/** Weight each person carries on a caravan. */
export const CARRY_EACH = 40

/** People a building needs to run at full strength: all year if no season is given, otherwise in that
 *  season (a field takes half a crew to sow in spring, none in summer, a full crew to reap in autumn). */
/** A workshop nobody has told what to make yet (from RAIDS_FROM): it makes nothing and needs no hands. */
export const idle = (b: { type: BuildingId; order?: string }) => b.order === '' && !!BUILDINGS[b.type].recipes
export function needOf(b: { type: BuildingId; herd?: number[]; order?: string }, season?: WeekSeason): number {
  if (idle(b)) return 0
  const base = b.type === 'pen' ? penCrew(b as Building) : (WORKERS[b.type] ?? 0) * HEADS
  if (!season) return base
  return Math.ceil(base * (BUILDINGS[b.type].labor?.[season] ?? 1) - 1e-9) || 0
}
/** People at home to work: the village's people, less those away on a neighbour's walls
 *  (who still count as the village's, and still have a house to come back to). */
export const people = (v: Village) => Math.max(0, Math.floor(v.population) - (v.away ?? 0))
/** People wounded in a fight, at home getting better. */
export const hurt = (v: Village) => (v.wounded ?? []).reduce((a, w) => a + w.n, 0)
/** People free for the buildings' work: those at home, less the road team and the wounded. */
export const hands = (v: Village) => Math.max(0, people(v) - (v.roadCrew ?? 0) - hurt(v))

const foodOf = (g: Goods | undefined, k = 1) => Object.entries(g ?? {}).reduce((a, [x, n]) => a + (n ?? 0) * k * (FOOD[x as Good]?.value ?? 0), 0)
/** Food a building adds a night with all its hands (made, less any food it uses up), roughly. */
const netFood = (b: Building, season: WeekSeason) => {
  const def = BUILDINGS[b.type]
  if (def.harvest && season !== 'autumn') return 0
  if (def.herd) return season === 'winter' ? 0 : 1
  return foodOf(producesIn(def, season)) - foodOf(def.consumes)
}
/** What makes food, first in line for hands. */
const feeds = (b: Building, season: WeekSeason) => netFood(b, season) > 0.01

/** Food in store, and what the stores hold (more rots). */
const stock = (v: Village) => foodOf(v.goods)
const room = (v: Village) => FOOD_SCALE * (30 + v.buildings.filter((b) => b.progress >= 1).reduce((a, b) => a + (BUILDINGS[b.type].storage ?? 0), 0))

/** The stores are as good as full: more food would only rot. */
export function storesFull(v: Village): boolean {
  return stock(v) >= room(v) - people(v) * EAT
}

/** The village's own choice: food first, then everything else in the order it was built.
 *  With the stores full, it keeps only enough hands on food to feed itself (and a little
 *  over), and puts the rest to other work, until the stores run down again. */
export function autoJobs(v: Village, season: WeekSeason): Record<string, number> {
  const out: Record<string, number> = {}
  let left = hands(v)
  const working = v.buildings.filter((b) => b.progress >= 1 && needOf(b, season) > 0)
  const food = working.filter((b) => feeds(b, season)), rest = working.filter((b) => !feeds(b, season))
  const give = (b: Building, cap = needOf(b, season)) => {
    const n = Math.min(left, cap - (out[b.id] ?? 0))
    if (n > 0) out[b.id] = (out[b.id] ?? 0) + n
    left -= Math.max(0, n)
  }
  if (storesFull(v)) {
    // enough to feed everyone (a fifth over, for bad days), then the rest of the work, then any spare hands back on food
    let want = people(v) * EAT * 1.2
    for (const b of food) {
      if (want <= 0) break
      const each = Math.max(0.01, netFood(b, season)) / needOf(b, season)
      const n = Math.min(needOf(b, season), Math.ceil(want / each))
      give(b, n)
      want -= n * each
    }
    for (const b of rest) give(b)
    for (const b of food) give(b)
    return out
  }
  for (const b of [...food, ...rest]) give(b)
  return out
}

/** Who does what now: by the village's own choice, or as the player set it (trimmed to the people at home). */
export function jobs(v: Village, season: WeekSeason): Record<string, number> {
  if (v.autoJobs !== false || !v.jobs) return autoJobs(v, season)
  const out: Record<string, number> = {}
  let left = hands(v)
  const ids = new Set(v.buildings.filter((b) => b.progress >= 1).map((b) => b.id))
  for (const [id, n] of Object.entries(v.jobs)) {
    if (!ids.has(id)) continue
    const cap = Math.min(n, needOf(v.buildings.find((b) => b.id === id)!, season))
    const k = Math.max(0, Math.min(left, Math.floor(cap)))
    if (k > 0) out[id] = k
    left -= k
  }
  return out
}

/** How well staffed a building is (0..1); buildings that need no hands always run. */
export function staffing(v: Village, b: Building, season: WeekSeason): number {
  const need = needOf(b, season)
  if (!need) return needOf(b) ? 0 : 1
  return Math.min(1, (jobs(v, season)[b.id] ?? 0) / need)
}

/** People at home not working in a building: free to go with a caravan, or as troops. */
export function spare(v: Village, season: WeekSeason): number {
  return hands(v) - Object.values(jobs(v, season)).reduce((a, n) => a + n, 0)
}

/** Step sizes for moving people about: small villages count in ones, fives and tens; towns add fifties;
 *  a metropolis moves them by the hundred. */
export function stepsFor(population: number): number[] {
  if (population >= 500) return [1, 10, 100]
  if (population >= 100) return [1, 10, 50]
  return [1, 5, 10]
}
