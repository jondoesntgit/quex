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
import { hasWater } from './water'
import { MAX_DEPTH, type Good, type Goods } from './data'
import type { GameState, ISODate } from './types'

export const DEPLETION_FROM = '2026-11-22T06:00:00.000Z'

export type Ore = 'copper' | 'iron' | 'tin' | 'silver' | 'stone'
/** What lies at the surface, to gather by hand: malachite, rusty limonite... */
export const ORE_GOOD: Record<Ore, Good> = { copper: 'copper_ore', iron: 'limonite', tin: 'tin', silver: 'silver_ore', stone: 'stone' }

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
  // animals come back faster where there's water to drink
  const rate = hasWater(world, s, i) ? GAME_REGROW * 1.5 : GAME_REGROW
  return Math.min(max, h.left + Math.max(0, daysBetween(h.date, date)) * rate)
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

/** Rare finds: how many were expected, and how many the roll gave. */
export interface Odds { expected: Goods; rolled: Goods }

// ------------------------------------------------------------------ mine levels

/** A deposit's deep ore lies in MAX_DEPTH levels, one under the other. Level 0 is
 *  the surface (by hand); a mine starts at level 1 and its shaft can be sunk to
 *  reach the levels below. Each level holds a different mix of ores: weathered
 *  ores near the surface, sulfides and richer oxides deeper down. Byproducts
 *  (galena in copper) come on top, per unit of ore. */
const MIX: Partial<Record<Ore, Goods[]>> = {
  copper: [{ copper_ore: 1 }, { copper_ore: 0.6, chalcopyrite: 0.4 }, { copper_ore: 0.25, chalcopyrite: 0.75 }, { chalcopyrite: 1 }],
  iron: [{ limonite: 1 }, { limonite: 0.4, iron_ore: 0.6 }, { iron_ore: 0.7, magnetite: 0.3 }, { iron_ore: 0.4, magnetite: 0.6 }],
  silver: [{ silver_ore: 1 }, { silver_ore: 1 }, { silver_ore: 1 }, { silver_ore: 1 }],
}
const BYPRODUCT: Partial<Record<Ore, Goods[]>> = {
  copper: [{}, { silver_ore: 0.03 }, { silver_ore: 0.05 }, { silver_ore: 0.08 }],
}

/** The ore mix at a level of a hex's deposit. */
export function mixAt(ore: Ore, level: number): Goods {
  return MIX[ore]?.[Math.min(level, MAX_DEPTH)] ?? { [ORE_GOOD[ore]]: 1 }
}

/** How much each level of a hex holds now: [surface, level 1, 2, 3]. */
export function levels(world: World, s: GameState, i: number): number[] | null {
  const r = reserveAt(world, i)
  if (!r) return null
  const taken = s.dug?.[i] ?? 0
  const per = r.deep / MAX_DEPTH
  const out = [Math.max(0, r.surface - taken)]
  for (let k = 0; k < MAX_DEPTH; k++) {
    const top = r.surface + per * k
    out.push(Math.max(0, Math.min(per, top + per - Math.max(top, taken))))
  }
  return out
}

/** Dig up to `want` ore from a mine's hex, from the top down, no deeper than its shaft.
 *  Byproducts are rare finds: they come whole or not at all, by chance (the expected
 *  amount, rolled for the hex and the day); `odds` collects what was expected. */
export function mineDig(world: World, s: GameState, i: number, depth: number, want: number, date = '', odds?: Odds): Goods {
  const r = reserveAt(world, i)
  const got: Goods = {}
  if (!r) return got
  const add = (g: Goods, n: number) => { for (const [x, q] of Object.entries(g)) got[x as Good] = Math.round(((got[x as Good] ?? 0) + (q ?? 0) * n) * 100) / 100 }
  const finds: Goods = {}
  for (let guard = 0; want > 0.005 && guard < 8; guard++) {
    const lv = levels(world, s, i)!
    const at = lv.findIndex((n) => n > 0.005)
    if (at < 0 || at > depth) break
    const n = Math.min(want, lv[at])
    add(mixAt(r.ore, at), n)
    for (const [x, q] of Object.entries(BYPRODUCT[r.ore]?.[at] ?? {})) finds[x as Good] = (finds[x as Good] ?? 0) + (q ?? 0) * n
    dig(s, i, n)
    want -= n
  }
  // each rare find: the whole part for sure, and the rest by chance
  const rng = rngFor(world.seed, 'find', i, date)
  for (const [x, e] of Object.entries(finds)) {
    if (!e) continue
    const whole = Math.floor(e) + (rng() < e - Math.floor(e) ? 1 : 0)
    if (odds) {
      odds.expected[x as Good] = Math.round(((odds.expected[x as Good] ?? 0) + e) * 1000) / 1000
      odds.rolled[x as Good] = (odds.rolled[x as Good] ?? 0) + whole
    }
    if (whole) got[x as Good] = (got[x as Good] ?? 0) + whole
  }
  for (const k of Object.keys(got)) if (!got[k as Good]) delete got[k as Good]
  return got
}

// ------------------------------------------------------------------ dungeons

/** Under the mountains, a shaft sunk deep enough can break into a dungeon:
 *  caves and old halls with something living in them, and things worth taking.
 *  Each holds only so much: raid it enough times and there's nothing left. */
export type DungeonKind = 'troglodytes' | 'cave_spiders' | 'deep_goblins' | 'dwarf_hall' | 'crystal_grotto'
export const DUNGEON: Record<DungeonKind, { name: string; loot: Goods; win: string; lose: string; empty: string }> = {
  troglodytes: { name: 'a troglodyte warren', loot: { leather: 2, iron: 1, game: 2 },
    win: 'The troglodytes blinked at the torches and gave up their hides and a few iron trinkets.',
    lose: 'The troglodytes knew the tunnels better. The miners came back scratched and sulky.',
    empty: "The troglodytes have nothing left worth taking, and they're starting to look sorry for themselves." },
  cave_spiders: { name: 'a nest of cave spiders', loot: { cloth: 3, relic: 0.5 },
    win: 'Torches and long sticks: the spiders retreated, leaving silk and an old cocooned treasure.',
    lose: 'Too many legs. Far too many legs. Everyone ran.',
    empty: 'The spiders have moved deeper. Only dusty webs are left.' },
  deep_goblins: { name: 'a deep-goblin den', loot: { copper: 3, silver: 0.5, tin: 1 },
    win: 'The deep goblins traded their hoard for being left alone. Mostly.',
    lose: 'The deep goblins rang a gong, and a great many more of them came.',
    empty: 'The deep goblins have spent their hoard. They offer you a shiny rock. You decline.' },
  dwarf_hall: { name: 'a forgotten dwarf hall', loot: { bronze: 2, steel: 1, relic: 1 },
    win: 'Old forge-halls, still guarded by clockwork that has run down. Its tools came up the shaft.',
    lose: "The hall's old guardians still had some tick in them.",
    empty: 'The dwarf hall is bare now, down to the last hinge.' },
  crystal_grotto: { name: 'a crystal grotto', loot: { silver: 1, tin: 2, relic: 0.5 },
    win: 'The basilisk was asleep. The miners came back with silver and tin, and without looking it in the eye.',
    lose: 'The basilisk woke up. Nobody was turned to stone, but it was close.',
    empty: 'The grotto is picked bare. Only the basilisk is left, and it has nothing worth taking.' },
}
const KINDS = Object.keys(DUNGEON) as DungeonKind[]

/** The dungeon under a hex, if there is one, and the level a shaft reaches it at. */
export function dungeonUnder(world: World, i: number): { kind: DungeonKind; level: number; raids: number; strength: number } | null {
  const c = world.cells[i]
  if (!c || (c.feature !== 'mountain' && c.feature !== 'mountain_snow')) return null
  const rng = rngFor(world.seed, 'dungeon', i)
  if (rng() >= 0.65) return null
  const kind = KINDS[Math.floor(rng() * KINDS.length)]
  const level = rng() < 0.6 ? 2 : 3
  return { kind, level, raids: 3 + Math.floor(rng() * 3), strength: 6 + level * 3 + Math.floor(rng() * 4) }
}
