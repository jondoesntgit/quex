/** Merchants: travelling traders who call at each village every day (not on
 *  the Sabbath) and barter, Dwarf Fortress style. Each kind of merchant
 *  carries its own wares and wants its own goods; you pick what you'd like
 *  from their packs and what you'll hand over from your stores, and they
 *  accept when your side is worth enough to them.
 *
 *  How well connected a village is decides who comes and on what terms: a
 *  coast brings ships, a river brings barges, a road network brings overland
 *  caravans, and a pedlar always walks in. A remote village with none of these
 *  gets only the pedlar, with a thin pack and steep prices.
 *
 *  Everything here is a pure function of the world, the state and the day, so
 *  every client agrees on what's for sale. */
import { spiral } from '../world/hex'
import { treeCount } from '../world/land'
import { clayAt, outpostRadius } from './reducer'
import { rngFor } from '../world/rng'
import type { World } from '../world/types'
import { addDays, isSabbath } from './calendar'
import { GOODS, type Good, type Goods } from './data'
import type { GameState, ISODate, Village } from './types'

/** What a good is worth to a merchant, in grain. Copper and silver are the
 *  currency (no gold in Quex): every merchant takes them at face value and none
 *  sells them; prices are shown in copper, or silver at 10 copper. */
export const VALUE: Record<Good, number> = {
  grain: 1, fish: 1, timber: 1, peat: 1, rice: 1, stone: 1, clay: 1, berries: 1.5, game: 1.5, wool: 1.5, herbs: 2, worts: 1, turnips: 1.3, salt: 0.0267,
  copper_ore: 2, chalcopyrite: 1.5, limonite: 2, iron_ore: 2.5, magnetite: 3, silver_ore: 4, tin: 6,
  bread: 2, smoked_fish: 2.5, cheese: 0.2, cured_meat: 0.22, biscuit: 2, dried_peas: 1.5, honey: 4, bricks: 2, charcoal: 1.5, planks: 2, leather: 3, cloth: 4,
  copper: 5, iron: 7, bronze: 10, steel: 15, silver: 50,
  relic: 25, dragon_scale: 40,
  saltpetre: 4, sulfur: 4, gunpowder: 12, cannonballs: 6, musket: 25, cannon: 120, ram: 30, siege_tower: 60,
}

/** A worth (in grain) as copper. */
export const inCopper = (x: number) => x / VALUE.copper
export const COPPER_PER_SILVER = 10

/** What one unit of each good weighs, in pounds. Bulk goods (timber, stone, clay, bricks, ore) come in
 *  wagon loads of WAGON_LB. Food comes in units worth FOOD[g].value rations, at the weight a ration of it
 *  really has (grain 2 lb, bread 1.5, fresh fish 4, cheese 1.6, berries 5...). Metals are counted in
 *  ingots (copper, iron, bronze, steel 50 lb; tin 25; silver 12). Cheese and cured meat are counted in rations, and salt in pinches (one a ration). */
export const WAGON_LB = 1000
export const WEIGHT: Record<Good, number> = {
  grain: 20, fish: 40, timber: 1000, peat: 800, rice: 20, stone: 1000, clay: 1000, berries: 40, game: 30, wool: 400, herbs: 100, worts: 30, turnips: 50, salt: 0.05,
  copper_ore: 1000, chalcopyrite: 1000, limonite: 1000, iron_ore: 1000, magnetite: 1000, silver_ore: 1000, tin: 25,
  bread: 22, smoked_fish: 18, cheese: 1.6, cured_meat: 1.2, biscuit: 12, dried_peas: 15, honey: 14, bricks: 1000, charcoal: 500, planks: 800, leather: 200, cloth: 200,
  copper: 50, iron: 50, bronze: 50, steel: 50, silver: 12,
  relic: 10, dragon_scale: 50,
  saltpetre: 200, sulfur: 200, gunpowder: 200, cannonballs: 1000, musket: 20, cannon: 1500, ram: 800, siege_tower: 4000,
}

export const weightOf = (g: Goods) => Object.entries(g).reduce((a, [x, n]) => a + (n ?? 0) * WEIGHT[x as Good], 0)

export type MerchantKind = 'ship' | 'barge' | 'caravan' | 'pedlar'

interface Kind {
  name: string
  blurb: string
  /** what they may carry (a day's pack is drawn from this) */
  pool: Good[]
  /** what they'd pay extra for */
  wants: Good[]
  /** a bigger or smaller pack than usual */
  size: number
}

export const KINDS: Record<MerchantKind, Kind> = {
  ship: {
    name: 'Sea traders', blurb: 'A trading ship from over the horizon.', size: 1.4,
    pool: ['tin', 'salt', 'cloth', 'iron', 'bronze', 'smoked_fish', 'planks', 'herbs'],
    wants: ['timber', 'planks', 'grain', 'cheese', 'wool', 'leather', 'relic', 'dragon_scale'],
  },
  barge: {
    name: 'River barge', blurb: 'Bargemen poling goods up and down the river.', size: 1.2,
    pool: ['grain', 'clay', 'fish', 'bread', 'planks', 'charcoal', 'bricks', 'berries'],
    wants: ['stone', 'copper_ore', 'iron_ore', 'wool', 'cheese', 'leather', 'salt'],
  },
  caravan: {
    name: 'Overland caravan', blurb: 'Pack mules up the long roads.', size: 1,
    pool: ['tin', 'leather', 'cloth', 'cheese', 'wool', 'copper_ore', 'iron_ore', 'stone', 'bricks'],
    wants: ['grain', 'bread', 'timber', 'planks', 'salt', 'smoked_fish', 'berries'],
  },
  pedlar: {
    name: 'Pedlar', blurb: 'A lone pedlar with a pack on their back.', size: 0.6,
    pool: ['berries', 'herbs', 'salt', 'game', 'wool', 'timber', 'clay', 'leather'],
    wants: ['bread', 'cheese', 'smoked_fish', 'grain', 'cloth'],
  },
}

/** Goods a merchant wants are worth this much more to them; goods they carry
 *  themselves, this much (they have plenty). Kept low enough that buying from
 *  one merchant to sell to another never pays. */
const WANT = 1.2
const GLUT = 0.5

/** How well a village is connected to the wider world (0 = remote, 1 = a hub). */
export interface Reach {
  score: number
  coast: boolean
  river: boolean
  /** road hexes the village has laid */
  roads: number
  market: boolean
  docks: boolean
  shipyard: boolean
}

/** Road hexes it takes to bring the overland caravans. */
export const CARAVAN_ROADS = 4
/** ...and to bring wagons instead of mules. */
export const WAGON_ROADS = 8

export function reach(world: World, v: Village): Reach {
  const cells = new Set<number>()
  const centres = [{ col: v.col, row: v.row, radius: 2 }, ...v.outposts.map((o) => ({ ...o, radius: outpostRadius(o) }))]
  for (const t of centres) {
    for (const o of spiral(t, t.radius)) {
      if (o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height) cells.add(o.row * world.width + o.col)
    }
  }
  let coast = false, river = false
  for (const i of cells) {
    const c = world.cells[i]
    if (c.terrain === 'ocean' || c.terrain === 'shallow' || c.terrain === 'deep') coast = true
    if (c.tier > 0 && c.riverTo !== -1) river = true
  }
  const built = (type: string) => v.buildings.some((b) => b.type === type && b.progress >= 1)
  const market = built('market'), docks = built('docks'), shipyard = built('shipyard')
  const roads = v.roads.length
  let score = 0
  if (coast) score += 0.3 + (docks ? 0.1 : 0) + (shipyard ? 0.2 : 0)
  if (river) score += 0.2
  score += Math.min(roads, 10) * 0.03
  if (market) score += 0.15
  return { score: Math.min(1, Math.round(score * 100) / 100), coast, river, roads, market, docks, shipyard }
}

/** Their asking price, as a multiple of a good's value, and what they pay for yours. */
export function rates(score: number) {
  return { sell: 2.4 - 1.3 * score, buy: 0.4 + 0.5 * score }
}

export interface Merchant {
  kind: MerchantKind
  name: string
  blurb: string
  /** what's left in their pack today */
  wares: Goods
  wants: Good[]
  /** asking price (multiple of value) */
  sell: number
  /** what they pay for your goods (multiple of value) */
  buy: number
  /** the most weight they can carry away */
  cap: number
  /** the weight they're carrying now (their pack plus what they've bought today) */
  load: number
}

/** The outfit a merchant comes with: bigger trade routes bring bigger ones,
 *  which carry more. */
function outfit(kind: MerchantKind, r: Reach): { name: string; blurb: string; cap: number; size: number } {
  const k = KINDS[kind]
  switch (kind) {
    case 'ship': return r.docks || r.shipyard
      ? { name: 'Merchant ship', blurb: 'A deep-hulled trading ship, tied up at your docks.', cap: 60000, size: 1.6 }
      : { name: 'Coasting boat', blurb: 'A small boat working along the shore. Docks would bring the big ships.', cap: 12000, size: 1.1 }
    case 'barge': return { name: k.name, blurb: k.blurb, cap: 30000, size: 1.1 }
    case 'caravan': return r.roads >= WAGON_ROADS
      ? { name: 'Wagon caravan', blurb: 'Ox wagons, rolling in on your long roads.', cap: 9000, size: 1.3 }
      : { name: 'Mule train', blurb: `A string of pack mules. ${WAGON_ROADS} road hexes would bring the wagons.`, cap: 3000, size: 0.9 }
    case 'pedlar': return { name: k.name, blurb: k.blurb, cap: 1200, size: 0.6 }
  }
}

/** What the pedlar always brings a village that's short of it: building basics it can't get at home. */
const STAPLES: Goods = { timber: 1, clay: 1 }

/** Staples a village is out of, or has no source of in its own land (no trees, no riverbank, marsh or clay). */
export function lacks(world: World, s: GameState, v: Village): Good[] {
  const near = spiral(v, 2).filter((o) => o.col >= 0 && o.row >= 0 && o.col < world.width && o.row < world.height)
    .map((o) => o.row * world.width + o.col)
  const trees = near.some((i) => { const w = s.woods?.[i]; return w ? w.n + w.young > 0 : treeCount(world.cells[i]) > 0 })
  const clay = near.some((i) => world.cells[i].resource === 'clay' || clayAt(world, i) > 0)
  const out: Good[] = []
  if (!trees || (v.goods.timber ?? 0) < 2) out.push('timber')
  if (!clay || (v.goods.clay ?? 0) < 1) out.push('clay')
  return out
}

/** The merchants calling at a village on a day (the player's own day), with
 *  what they've still got after today's trades. None on the Sabbath. */
export function merchants(world: World, s: GameState, v: Village, date: ISODate): Merchant[] {
  if (isSabbath(date)) return []
  const r = reach(world, v)
  const { sell, buy } = rates(r.score)
  const kinds: MerchantKind[] = []
  if (r.coast) kinds.push('ship')
  if (r.river) kinds.push('barge')
  if (r.roads >= CARAVAN_ROADS) kinds.push('caravan')
  kinds.push('pedlar')
  const took = v.trade?.date === date ? v.trade.took : {}
  const got = v.trade?.date === date ? v.trade.got ?? {} : {}
  return kinds.map((kind) => {
    const k = KINDS[kind]
    const o = outfit(kind, r)
    const rng = rngFor(s.worldSeed, `merchant:${v.id}:${kind}:${date}`)
    const pool = [...k.pool]
    const n = Math.min(pool.length, Math.max(2, Math.round((2 + r.score * 4) * o.size)))
    const full: Goods = {}
    // the pedlar always brings what the village is short of (timber, clay), the rest of the pack around it
    const staples: Goods = kind === 'pedlar' ? Object.fromEntries(lacks(world, s, v).map((g) => [g, STAPLES[g]])) : {}
    for (let j = 0; j < n; j++) {
      const g = pool.splice(Math.floor(rng() * pool.length), 1)[0]
      if (staples[g]) continue
      full[g] = Math.max(1, Math.round((3 + rng() * 5) * (0.5 + r.score) * o.size / Math.sqrt(VALUE[g])))
    }
    // a full pack leaves room to buy: trim it to two thirds of what they can carry
    const room = o.cap * 2 / 3 - weightOf(staples)
    const order = Object.keys(full) as Good[]
    for (let j = 0; order.length && weightOf(full) > room && j < 500; j++) {
      const g = order[j % order.length]
      if ((full[g] ?? 0) > 1) full[g]! -= 1
      else if (order.every((x) => (full[x] ?? 0) <= 1)) { delete full[order.pop()!] }
    }
    Object.assign(full, staples)
    const wares: Goods = {}
    for (const [g, q] of Object.entries(full)) {
      const left = (q ?? 0) - (took[kind]?.[g as Good] ?? 0)
      if (left > 0) wares[g as Good] = left
    }
    return { kind, name: o.name, blurb: o.blurb, wares, wants: k.wants, sell, buy, cap: o.cap, load: weightOf(wares) + weightOf(got[kind] ?? {}) }
  })
}

/** What one of your goods is worth to this merchant, each. */
export function bidFor(m: Merchant, g: Good): number {
  if (g === 'copper' || g === 'silver') return VALUE[g] // money: taken at face value by everyone
  const carry = KINDS[m.kind].pool.includes(g)
  return VALUE[g] * m.buy * (m.wants.includes(g) ? WANT : 1) * (carry ? GLUT : 1)
}

/** What one of their goods costs you, each. */
export function askFor(m: Merchant, g: Good): number {
  return VALUE[g] * m.sell
}

const total = (g: Goods, each: (x: Good) => number) =>
  Object.entries(g).reduce((a, [x, n]) => a + (n ?? 0) * each(x as Good), 0)

/** A proposed deal from the merchant's side: what they'd get, what they'd give up. */
export function weigh(m: Merchant, give: Goods, take: Goods) {
  const offered = total(give, (g) => bidFor(m, g))
  const asked = total(take, (g) => askFor(m, g))
  const load = m.load - weightOf(take) + weightOf(give)
  const fits = load <= m.cap + 1e-9
  return { offered, asked, load, fits, accept: asked > 0 && offered + 1e-9 >= asked && fits }
}

/** Why this barter can't happen (null = the merchant agrees). */
export function barterProblem(world: World, s: GameState, v: Village, date: ISODate,
  ev: { merchant: MerchantKind; give: Goods; take: Goods }): string | null {
  if (isSabbath(date)) return 'Merchants rest on the Sabbath'
  const m = merchants(world, s, v, date).find((x) => x.kind === ev.merchant)
  if (!m) return "That merchant doesn't call here"
  const whole = (g: Goods) => Object.entries(g).every(([x, n]) => (GOODS as readonly string[]).includes(x) && Number.isInteger(n) && (n ?? 0) > 0)
  if (!whole(ev.give) || !whole(ev.take)) return 'Trade whole goods'
  if (!Object.keys(ev.take).length) return 'Pick something to buy'
  for (const [x, n] of Object.entries(ev.take)) if ((m.wares[x as Good] ?? 0) < (n ?? 0)) return `${m.name} hasn't that much ${x.replace('_', ' ')}`
  for (const [x, n] of Object.entries(ev.give)) if ((v.goods[x as Good] ?? 0) + 1e-9 < (n ?? 0)) return `Not enough ${x.replace('_', ' ')}`
  const w = weigh(m, ev.give, ev.take)
  if (!w.fits) return `${m.name} can't carry that much`
  if (!w.accept) return `${m.name} won't take that offer`
  return null
}

/** Record a barter in the village's day of trading. */
export function noteTrade(v: Village, date: ISODate, kind: MerchantKind, take: Goods, give: Goods) {
  if (v.trade?.date !== date) v.trade = { date, took: {}, got: {} }
  const add = (into: Goods, g: Goods) => { for (const [x, n] of Object.entries(g)) into[x as Good] = (into[x as Good] ?? 0) + (n ?? 0) }
  add(v.trade.took[kind] ??= {}, take)
  add((v.trade.got ??= {})[kind] ??= {}, give)
}

/** The next day the merchants call (skipping the Sabbath). */
export function nextMarketDay(date: ISODate): ISODate {
  const d = addDays(date, 1)
  return isSabbath(d) ? addDays(d, 1) : d
}
