/** The village advisor: what a village is short of, and what it could make for
 *  the friends who've been busiest this week.
 *
 *  1. Shortfalls: food in store, a varied larder, food that keeps for winter,
 *     textiles, room to grow, building materials, fuel and metal.
 *  2. The active party: the other players with the most points over the last
 *     seven days, and what each of them is short of.
 *  3. Industries: production chains this village's own land allows (pasture
 *     for a weaver, forest for a sawmill, a copper deposit for a smelter...),
 *     ranked by how much they'd help the active party, and the village itself.
 *  4. Refined goods: a caravan carries by weight, so cloth, bread, planks and
 *     ingots carry far more worth than wool, grain, logs and ore.
 *
 *  Everything is worked out from the state; nothing is stored. */
import { addDays, playerDate } from './calendar'
import { BUILDINGS, EAT, FOOD, GOOD_LABEL, type BuildingId, type Good, type Goods } from './data'
import { VALUE, WEIGHT } from './market'
import { dayScore, foodStock, landAt, popCap, territoryCells } from './reducer'
import type { GameState, Player, Village } from './types'
import type { World } from '../world/types'
import { neighbours } from '../world/hex'
import { hasTrees } from '../world/land'
import { clayAt } from './water'
import { people } from './workers'

export type Need = 'food' | 'larder' | 'winter' | 'textiles' | 'shelter' | 'building' | 'fuel' | 'metal'
export const NEED_NAME: Record<Need, string> = {
  food: 'food', larder: 'a varied larder', winter: 'food that keeps', textiles: 'textiles',
  shelter: 'housing', building: 'building materials', fuel: 'fuel', metal: 'metal',
}

export interface Shortfall { need: Need; why: string; weight: number }

const done = (v: Village) => v.buildings.filter((b) => b.progress >= 1)
const has = (v: Village, id: BuildingId) => done(v).some((b) => b.type === id)
const n = (v: Village, ...gs: Good[]) => gs.reduce((a, g) => a + (v.goods[g] ?? 0), 0)

/** What a village is light on, most pressing first. */
export function shortfalls(v: Village): Shortfall[] {
  const out: Shortfall[] = []
  const pop = Math.max(1, people(v))
  const days = foodStock(v) / (pop * EAT)
  if (days < 3) out.push({ need: 'food', why: `about ${Math.max(0, Math.floor(days))} day${Math.floor(days) === 1 ? '' : 's'} of food in store`, weight: 5 })
  const kinds = (Object.keys(FOOD) as Good[]).filter((g) => (v.goods[g] ?? 0) >= 1).length
  if (kinds < 3) out.push({ need: 'larder', why: `only ${kinds} kind${kinds === 1 ? '' : 's'} of food: a varied larder keeps morale up`, weight: 2 })
  if (v.winterForecast !== 'stocked') out.push({ need: 'winter', why: `Saturday's winter looks ${v.winterForecast}: grain, smoked fish and cheese keep`, weight: v.winterForecast === 'hungry' ? 4 : 2 })
  if (n(v, 'cloth', 'leather', 'wool') < 2) out.push({ need: 'textiles', why: 'no cloth, leather or wool: clothes, sails and gear', weight: 1.5 })
  if (v.population >= popCap(v) - 0.5) out.push({ need: 'shelter', why: 'every home is full: lay cobblestone and build a cottage or town house to grow', weight: 2 })
  if ((v.goods.timber ?? 0) < 4 || (v.goods.stone ?? 0) < 3) out.push({ need: 'building', why: `${Math.floor(v.goods.timber ?? 0)} timber and ${Math.floor(v.goods.stone ?? 0)} stone in store`, weight: 1.5 })
  if ((has(v, 'smelter') || has(v, 'bloomery') || has(v, 'silver_refinery')) && (v.goods.charcoal ?? 0) < 2) out.push({ need: 'fuel', why: 'the furnaces are short of charcoal', weight: 2 })
  if (n(v, 'copper', 'iron', 'bronze', 'steel') < 1) out.push({ need: 'metal', why: 'no metal for tools, weapons or trade', weight: 1 })
  return out.sort((a, b) => b.weight - a.weight)
}

/** Points a player scored over the seven days up to (and including) yesterday. */
export function weekPoints(p: Player, now: Date): number {
  const today = playerDate(now, p.resetHour, p.tz)
  let t = 0
  for (let k = 1; k <= 7; k++) t += dayScore(p.days[addDays(today, -k)])
  return t
}

/** The other players busiest this week, with what they're short of. */
export function activeParty(s: GameState, me: Player, now: Date, max = 4) {
  return Object.values(s.players)
    .filter((p) => p.id !== me.id && s.villages[p.villageId])
    .map((p) => ({ p, v: s.villages[p.villageId], points: weekPoints(p, now) }))
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, max)
    .map((x) => ({ ...x, short: shortfalls(x.v) }))
}

/** What the land within a village's borders offers. */
function landOf(world: World, s: GameState, v: Village) {
  const cells = territoryCells(world, v).filter((i) => world.cells[i].tier > 0)
  const terr = new Set<string>(), res = new Set<string>()
  let coast = false, trees = false, clay = false, quarry = false
  for (const i of cells) {
    const c = world.cells[i]
    const land = landAt(world, s, i)
    terr.add(land.terrain)
    if (land.resource) res.add(land.resource)
    if (hasTrees(land)) trees = true
    if (clayAt(world, i) > 0 || c.resource === 'clay') clay = true
    for (const [nc, nr] of neighbours(c.col, c.row)) {
      const o = world.cells[nr * world.width + nc]
      if (!o) continue
      if (o.terrain === 'shallow' || o.terrain === 'ocean') coast = true
      if (o.terrain === 'rock' || o.terrain === 'hills') quarry = true
    }
  }
  return { terr, res, coast, trees, clay, quarry }
}

export interface Industry {
  id: string
  name: string
  /** what to build, in order */
  chain: BuildingId[]
  makes: Good[]
  meets: Need[]
  /** the raw goods it starts from (shown as "from your ...") */
  from: string
  possible: (l: ReturnType<typeof landOf>) => boolean
}

const PASTURE = ['hills', 'meadow', 'savannah', 'grass']
export const INDUSTRIES: Industry[] = [
  { id: 'bakery', name: 'Bakery', chain: ['field', 'mill'], makes: ['bread', 'grain'], meets: ['food', 'larder', 'winter'], from: 'your fields', possible: (l) => l.terr.has('grass') || l.terr.has('meadow') },
  { id: 'fishery', name: 'Smoked fish', chain: ['shore_fishery', 'smokehouse'], makes: ['smoked_fish'], meets: ['food', 'larder', 'winter'], from: 'the shore', possible: (l) => l.coast },
  { id: 'dairy', name: 'Cheese', chain: ['pen', 'dairy'], makes: ['cheese'], meets: ['food', 'larder', 'winter'], from: 'your pasture (and a little salt)', possible: (l) => PASTURE.some((t) => l.terr.has(t)) },
  { id: 'weaving', name: 'Weaving', chain: ['pen', 'weaver'], makes: ['cloth'], meets: ['textiles'], from: 'your pasture', possible: (l) => PASTURE.some((t) => l.terr.has(t)) },
  { id: 'hunting', name: 'Hides and game', chain: ['hunting_lodge'], makes: ['leather', 'game'], meets: ['textiles', 'larder'], from: 'your wild country', possible: (l) => ['forest', 'tundra', 'savannah'].some((t) => l.terr.has(t)) },
  { id: 'orchard', name: 'Orchard', chain: ['orchard'], makes: ['berries'], meets: ['larder'], from: 'open ground', possible: (l) => ['grass', 'meadow', 'hills'].some((t) => l.terr.has(t)) },
  { id: 'timber', name: 'Planks', chain: ['lumber_camp', 'sawmill'], makes: ['planks', 'timber'], meets: ['building'], from: 'your forest', possible: (l) => l.terr.has('forest') },
  { id: 'quarry', name: 'Quarry', chain: ['quarry'], makes: ['stone'], meets: ['building'], from: 'your hills', possible: (l) => l.quarry },
  { id: 'bricks', name: 'Bricks', chain: ['kiln'], makes: ['bricks'], meets: ['building'], from: 'your clay', possible: (l) => l.clay },
  { id: 'charcoal', name: 'Charcoal', chain: ['charcoal_kiln'], makes: ['charcoal'], meets: ['fuel'], from: 'your trees', possible: (l) => l.trees },
  { id: 'copper', name: 'Copper', chain: ['copper_mine', 'smelter'], makes: ['copper'], meets: ['metal'], from: 'your copper deposit', possible: (l) => l.res.has('copper') },
  { id: 'iron', name: 'Iron', chain: ['iron_mine', 'bloomery'], makes: ['iron'], meets: ['metal'], from: 'your iron deposit', possible: (l) => l.res.has('iron') },
  { id: 'salt', name: 'Salt', chain: ['salt_pans'], makes: ['salt'], meets: ['winter'], from: 'the beach', possible: (l) => l.terr.has('beach') || l.terr.has('desert') },
]

export interface Advice {
  industry: Industry
  /** the buildings still to build */
  todo: BuildingId[]
  /** friends it would help, and with what */
  helps: { name: string; points: number; needs: Need[] }[]
  /** it meets one of the village's own needs */
  self: Need[]
  score: number
}

/** Industries this village could start (or finish), best for the party first. */
export function recommend(world: World, s: GameState, me: Player, now: Date, max = 3): Advice[] {
  const v = s.villages[me.villageId]
  const land = landOf(world, s, v)
  const party = activeParty(s, me, now)
  const mine = shortfalls(v)
  const out: Advice[] = []
  for (const ind of INDUSTRIES) {
    if (!ind.possible(land)) continue
    const todo = ind.chain.filter((id) => !has(v, id))
    if (!todo.length) continue
    const helps = party.map((x) => ({ name: x.p.name, points: x.points, needs: x.short.filter((f) => ind.meets.includes(f.need)).map((f) => f.need) }))
      .filter((h) => h.needs.length)
    const self = mine.filter((f) => ind.meets.includes(f.need))
    // the busiest friends count most; a village's own pressing needs count too; nearer the finish, a little more
    const score = helps.reduce((a, h) => a + h.points / 100 * h.needs.length, 0)
      + self.reduce((a, f) => a + f.weight, 0) + (ind.chain.length - todo.length) * 0.5
    if (score > 0) out.push({ industry: ind, todo, helps, self: self.map((f) => f.need), score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}

/** Raw goods and what they're refined into. */
export const REFINED: [raw: Good, refined: Good, by: BuildingId][] = [
  ['wool', 'cloth', 'weaver'], ['grain', 'bread', 'mill'], ['fish', 'smoked_fish', 'smokehouse'],
  ['timber', 'planks', 'sawmill'], ['clay', 'bricks', 'kiln'], ['copper_ore', 'copper', 'smelter'],
  ['iron_ore', 'iron', 'bloomery'], ['limonite', 'iron', 'bloomery'], ['game', 'leather', 'hunting_lodge'],
]

/** How many times more worth a caravan carries as the refined good than the raw one. */
export const refinedGain = (raw: Good, refined: Good) => (VALUE[refined] / WEIGHT[refined]) / (VALUE[raw] / WEIGHT[raw])

/** For a caravan's load: raw goods better sent refined, with how much more worth that carries. */
export function refineTips(load: Goods): string[] {
  return REFINED.filter(([raw]) => (load[raw] ?? 0) > 0)
    .map(([raw, refined, by]) => ({ raw, refined, by, k: refinedGain(raw, refined) }))
    .filter((t) => t.k >= 1.3)
    .map((t) => `${GOOD_LABEL[t.refined]} carries ${Math.round(t.k * 10) / 10}× the worth of ${GOOD_LABEL[t.raw].toLowerCase()} for the same weight (a ${BUILDINGS[t.by].name} makes it).`)
}
