/** Garrisons: neighbours lending troops to a village with a palisade.
 *
 *  A village sends some of its people to a neighbour's palisade (a medium
 *  task), with weapons and armour (GEAR) and food to live on. They wait at the
 *  gate until the host accepts them or turns them back. Once accepted they're
 *  the host's to command: they stand on the walls (defence) and march with the
 *  host's expeditions, and their gear counts as the host's while they're there.
 *  They eat only the food they brought. When it runs out, or the host sends
 *  them home, they walk home and disband, and their gear goes back with them.
 */
import { FOOD, type Good, type Goods } from './data'
import type { GameState, Village } from './types'

/** Weapons and armour a detachment can bring. */
export const GEAR: Good[] = ['bronze', 'iron', 'steel', 'leather']
/** Food (in food value) each soldier eats a night. */
export const RATION = 0.5
/** Troops a palisade can hold (waiting at the gate included). */
export const PER_PALISADE = 10
/** Days a detachment waits at the gate before giving up and going home. */
export const WAIT_DAYS = 3

export interface Detachment {
  id: string
  /** the village that sent them */
  from: string
  troops: number
  gear: Goods
  /** provisions: what they live on */
  food: Goods
  status: 'waiting' | 'stationed'
  /** when they arrived (or were accepted) */
  since: string
}

export const garrison = (s: GameState, v: Village): Detachment[] => s.garrisons?.[v.id] ?? []
export const stationed = (s: GameState, v: Village) => garrison(s, v).filter((d) => d.status === 'stationed')
export const troopsAt = (s: GameState, v: Village) => stationed(s, v).reduce((a, d) => a + d.troops, 0)
/** Troops a village has away at other palisades. */
export const away = (s: GameState, v: Village) =>
  Object.entries(s.garrisons ?? {}).flatMap(([host, ds]) => ds.filter((d) => d.from === v.id).map((d) => ({ host, d })))

/** The host's gear plus what its stationed troops brought. */
export function gearWith(s: GameState, v: Village): Goods {
  const out: Goods = { ...v.goods }
  for (const d of stationed(s, v)) for (const [g, n] of Object.entries(d.gear)) out[g as Good] = (out[g as Good] ?? 0) + (n ?? 0)
  return out
}

export const foodValue = (g: Goods) => Object.entries(g).reduce((a, [x, n]) => a + (n ?? 0) * (FOOD[x as Good]?.value ?? 0), 0)
/** Nights a detachment's provisions last. */
export const nightsOf = (d: { troops: number; food: Goods }) => (d.troops > 0 ? Math.floor(foodValue(d.food) / (d.troops * RATION) + 1e-9) : 0)

/** Eat a night's rations from the provisions; false if there wasn't enough. */
export function eat(d: Detachment): boolean {
  let need = d.troops * RATION
  // fresh food first: it would spoil anyway
  const order = (Object.keys(d.food) as Good[]).sort((a, b) => Number(FOOD[a]?.keeps ?? 0) - Number(FOOD[b]?.keeps ?? 0))
  for (const g of order) {
    const value = FOOD[g]?.value ?? 0
    if (need <= 1e-9 || !value) continue
    const take = Math.min(d.food[g] ?? 0, need / value)
    d.food[g] = Math.round(((d.food[g] ?? 0) - take) * 100) / 100
    if (!d.food[g]) delete d.food[g]
    need -= take * value
  }
  return need <= 1e-6
}
