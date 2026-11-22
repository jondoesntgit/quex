/** What the land holds, and how much is left.
 *
 *  Stone lies everywhere: every hex of land has a little loose stone, quickly
 *  picked clean by hand ('pick'), and bedrock below that only a quarry
 *  reaches. Picking a field's stone off also makes it grow more (stonyness).
 *
 *  Ore and stone run out. Each deposit has a little near the surface, which
 *  can be gathered by hand, and a lot more underground, which only a mine (or
 *  a quarry, for stone) can reach. Copper at the surface is malachite and
 *  carries no silver; the deeper ore a copper mine brings up carries a trickle
 *  of silver ore. Silver deposits (galena, a lead ore rich in silver) are rare
 *  and only in the mountains beyond the starting region.
 *
 *  Game doesn't run out for good: a hex holds so many animals, hunting takes
 *  them, and they come back slowly (GAME_REGROW a day). Fish, clay, salt and
 *  crops never run out. Trees are counted elsewhere (GameState.woods).
 *
 *  All amounts are a pure function of the world seed, so every client agrees.
 *  Nothing was counted before DEPLETION_FROM, so older events replay as they
 *  always did. */
import { rngFor } from '../world/rng'
import { MOUNTAIN_TERRAIN } from '../world/land'
import type { World } from '../world/types'
import { daysBetween } from './calendar'
import type { Good } from './data'
import type { GameState, ISODate } from './types'

export const DEPLETION_FROM = '2026-11-22T06:00:00.000Z'

export type Ore = 'copper' | 'iron' | 'tin' | 'silver' | 'stone'
export const ORE_GOOD: Record<Ore, Good> = { copper: 'copper_ore', iron: 'iron_ore', tin: 'tin', silver: 'silver_ore', stone: 'stone' }

/** A hex's deposit as it was at the start of the season. */
export interface Reserve { ore: Ore; good: Good; surface: number; deep: number }

const RANGES: Record<Ore, { surface: [number, number]; deep: [number, number] }> = {
  copper: { surface: [12, 18], deep: [60, 100] },
  iron: { surface: [10, 14], deep: [80, 120] },
  tin: { surface: [15, 25], deep: [0, 0] },
  silver: { surface: [4, 6], deep: [120, 180] },
  stone: { surface: [40, 60], deep: [150, 250] },
}

export function reserveAt(world: World, i: number): Reserve | null {
  const c = world.cells[i]
  if (!c || c.tier === 0) return null
  const rng = rngFor(world.seed, 'reserve', i)
  const pick = ([a, b]: [number, number]) => Math.round(a + rng() * (b - a))
  const r = c.resource
  if (r === 'copper' || r === 'iron' || r === 'tin' || r === 'silver' || r === 'stone') {
    const x = RANGES[r]
    return { ore: r, good: ORE_GOOD[r], surface: pick(x.surface), deep: pick(x.deep) }
  }
  // no deposit, but stone all the same: a few loose stones to pick, and rock
  // to quarry below (mountains hold far more than hills, hills than the plain)
  if (MOUNTAIN_TERRAIN.includes(c.terrain)) return { ore: 'stone', good: 'stone', surface: pick([10, 16]), deep: pick([200, 300]) }
  if (c.terrain === 'hills') return { ore: 'stone', good: 'stone', surface: pick([6, 10]), deep: pick([80, 120]) }
  if (c.terrain === 'beach' || c.terrain === 'swamp') return { ore: 'stone', good: 'stone', surface: pick([1, 3]), deep: pick([20, 40]) }
  return { ore: 'stone', good: 'stone', surface: pick([3, 6]), deep: pick([40, 60]) }
}

/** How much of a hex's loose stone is still lying there (1 = untouched, 0 = picked clean). */
export function stonyness(world: World, s: GameState, i: number): number {
  const r = leftAt(world, s, i)
  if (!r || r.ore !== 'stone' || r.start <= 0) return 0
  return r.surface / r.start
}

/** Crops grow this much more on ground picked clean of stone. */
export const CLEARED_FIELD_BONUS = 0.2

/** What's left: by hand (surface) and in all (with a mine or quarry). */
export function leftAt(world: World, s: GameState, i: number) {
  const r = reserveAt(world, i)
  if (!r) return null
  const taken = s.dug?.[i] ?? 0
  const total = Math.max(0, r.surface + r.deep - taken)
  const surface = Math.max(0, r.surface - taken)
  return { ...r, start: r.surface, taken, total, surface, deep: total - surface }
}

export function dig(s: GameState, i: number, n: number) {
  if (n <= 0) return
  const dug = (s.dug ??= {})
  dug[i] = Math.round(((dug[i] ?? 0) + n) * 100) / 100
}

// ------------------------------------------------------------------ game

/** Animals a hex can carry: more where the game deposit is, some in any wild country. */
export function gameMax(world: World, i: number): number {
  const c = world.cells[i]
  if (!c || c.tier === 0) return 0
  if (c.resource === 'game') return 20
  return ['forest', 'tundra', 'savannah', 'swamp'].includes(c.terrain) ? 10 : 0
}

/** Animals coming back to a hunted hex, a day. */
export const GAME_REGROW = 1

export function gameLeft(world: World, s: GameState, i: number, date: ISODate): number {
  const max = gameMax(world, i)
  const h = s.hunted?.[i]
  if (!h) return max
  return Math.min(max, h.left + Math.max(0, daysBetween(h.date, date)) * GAME_REGROW)
}

/** Take up to `want` animals from a hex; returns how many there were. */
export function hunt(world: World, s: GameState, i: number, date: ISODate, want: number): number {
  const left = gameLeft(world, s, i, date)
  const got = Math.round(Math.min(want, left) * 100) / 100
  ;(s.hunted ??= {})[i] = { left: Math.round((left - got) * 100) / 100, date }
  return got
}

/** "about 15", "3" */
export function about(n: number): string {
  if (n < 10) return `${Math.floor(n)}`
  return `about ${Math.round(n / 5) * 5}`
}
