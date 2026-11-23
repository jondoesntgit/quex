/** Fresh water and clay: both come from rivers, marshes and springs.
 *
 *  Clay to dig by hand (clay deposits are gathered instead): along riverbanks
 *  and in marshes, at small mountain springs (white kaolin weathered out of the
 *  granite; not on the map, tap the hex to find one), and in pits in the plains
 *  and hill valleys. Riverbanks, marshes and springs fill again every winter
 *  (floods lay new silt, meltwater washes down fresh kaolin); a pit is dug out
 *  for good, but by the next winter rain fills it, and it's a pond.
 *
 *  Livestock need fresh water within a hex: a river, a marsh, a spring, a pond
 *  or a well (the sea is salt). Ponds dry out in the summer days; the rest never
 *  do. Game also comes back faster near water. */
import { spiral } from '../world/hex'
import { rngFor } from '../world/rng'
import type { World } from '../world/types'
import { weekSeason } from './calendar'
import type { Goods } from './data'
import type { GameState, ISODate } from './types'

/** A small mountain spring, with kaolin along it (about one mountain hex in three). */
export function mountainSpring(world: World, i: number): boolean {
  const c = world.cells[i]
  return !!c && c.terrain === 'rock' && rngFor(world.seed, 'spring', i)() < 0.33
}

export function clayAt(world: World, i: number): number {
  const c = world.cells[i]
  if (!c || c.tier === 0 || c.resource === 'clay') return 0
  if (c.terrain === 'swamp') return 12
  if (c.riverTo !== -1) return 9
  if (mountainSpring(world, i)) return 6
  if (['grass', 'meadow', 'savannah'].includes(c.terrain)) return 4
  if (c.terrain === 'hills') return 3
  return 0
}

/** Does this hex's clay come back every winter? (Its water never runs dry.) */
export function clayRenews(world: World, i: number): boolean {
  const c = world.cells[i]
  return !!c && c.tier > 0 && (c.terrain === 'swamp' || c.riverTo !== -1 || mountainSpring(world, i))
}

export function clayLeft(world: World, s: GameState, i: number): number | null {
  const n = clayAt(world, i)
  return n ? Math.max(0, n - (s.clayDug?.[i] ?? 0)) : null
}

/** Winter: riverbanks, marshes and springs fill up with clay again, and any other pit seeps back one load. */
export function winterWater(s: GameState, world: World, winterDate: ISODate) {
  if (!s.clayDug || s.clayRenewed === winterDate) return
  s.clayRenewed = winterDate
  for (const k of Object.keys(s.clayDug)) {
    const i = Number(k)
    if (clayRenews(world, i)) delete s.clayDug[i]
    else if (s.clayDug[i] > 1) s.clayDug[i] -= 1 // a dug pit seeps back slowly: one load a winter
    else delete s.clayDug[i]
  }
}

export type WaterKind = 'river' | 'marsh' | 'spring' | 'pond' | 'well'
export const WATER_NAME: Record<WaterKind, string> = { river: 'the river', marsh: 'the marsh', spring: 'a mountain spring', pond: 'a pond', well: 'a well' }

/** Fresh water on this very hex, if any, and whether it's running today. */
export function waterAt(world: World, s: GameState, i: number, date?: ISODate): { kind: WaterKind; dry: boolean } | null {
  const c = world.cells[i]
  if (!c || c.tier === 0) return null
  if (s.wells?.[i]) return { kind: 'well', dry: false }
  if (c.riverTo !== -1) return { kind: 'river', dry: false }
  if (c.terrain === 'swamp') return { kind: 'marsh', dry: false }
  if (mountainSpring(world, i)) return { kind: 'spring', dry: false }
  // a pond made by a dug-out clay pit: shallow, so it dries in the summer days
  if (s.ponds?.[i]) return { kind: 'pond', dry: !!date && weekSeason(date) === 'summer' }
  return null
}

/** The nearest running water within a hex of i (this hex first). */
export function hasWater(world: World, s: GameState, i: number, date?: ISODate): { kind: WaterKind; dry: boolean } | null {
  const c = world.cells[i]
  if (!c) return null
  let dry: { kind: WaterKind; dry: boolean } | null = null
  for (const o of spiral(c, 1)) {
    if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) continue
    const w = waterAt(world, s, o.row * world.width + o.col, date)
    if (w && !w.dry) return w
    if (w) dry = w
  }
  return dry
}

/** Buildings whose animals need water, and what they give without it. */
export const THIRSTY = new Set(['pen', 'dairy', 'stable'])
export const THIRST = 0.5

/** Stone to dig a well. */
export const WELL_COST: Goods = { stone: 3 }
