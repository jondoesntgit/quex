/** Sheep: wool, cheese and mutton, from a flock that grows with the pasture.
 *
 *  A pen keeps a flock, counted by age (index 0 is this year's lambs). A shepherd tends SHEEP_PER_SHEPHERD
 *  sheep (a crew of one slot, HEADS people, tends PEN_PER_SLOT) and, net of winter feed, brings in about 5 rations a worker a day:
 *    - milk all year, the same every season: cheese as far as the salt goes (a pinch to each ration), the rest
 *      fresh milk, which spoils overnight like other fresh food,
 *    - wool all year,
 *    - mutton at the autumn cull (the oldest tenth of the flock, and any sheep above what the pasture feeds),
 *      salted into cured meat as far as the salt goes, the rest fresh,
 *    - and on a winter day the flock eats grain (FEED rations a head).
 *  The flock grows by half each spring (BIRTH_RATE), but only up to the pasture: the hexes within a hex of a
 *  well or a pen that nothing is built on, counted by terrain. A village hungrier than it can bear (less than
 *  three days' food) slaughters sheep, oldest first, and so does one that has no grain to feed them. */
import { spiral } from '../world/hex'
import type { World } from '../world/types'
import { HEADS, type Goods } from './data'
import type { Building, GameState, Village } from './types'

/** Sheep a crew of one slot can tend. */
export const PEN_PER_SLOT = 20
/** The flock a new pen starts with: six adults. */
export const START_FLOCK = [0, 3, 3, 0, 0]
export const AGES = 5
/** Growth each spring, as a share of the flock. */
export const BIRTH_RATE = 0.5
/** The oldest share of the flock culled each autumn. */
export const CULL_RATE = 0.1
/** Rations of food a head makes: cheese (a day, at full strength), mutton (once, at the cull). */
export const CHEESE_PER_HEAD = 0.3
export const MEAT_PER_HEAD = 12
/** Wool a head gives a day (wagon loads). */
export const WOOL_PER_HEAD = 0.1
/** Rations of grain a head eats on a winter day. */
export const FEED_PER_HEAD = 0.4
/** Milk by season: the same all year. */
export const MILK: Record<'spring' | 'summer' | 'autumn' | 'winter', number> = { spring: 1, summer: 1, autumn: 1, winter: 1 }
/** Less than this many days of food in store, and the village slaughters. */
export const LEAN_DAYS = 3
/** The most of the flock slaughtered in one night of need. */
export const LEAN_CULL = 0.25

/** Sheep a hex of each terrain feeds. */
export const PASTURE: Record<string, number> = { meadow: 12, grass: 10, savannah: 8, hills: 6 }

export const flock = (b: Building): number[] => (b.herd ? [...b.herd] : [...START_FLOCK])
export const heads = (b: Building) => flock(b).reduce((a, n) => a + n, 0)
export const sheepOf = (v: Village) => v.buildings.filter((b) => b.progress >= 1 && b.type === 'pen').reduce((a, b) => a + heads(b), 0)

/** Sheep one shepherd tends. */
export const SHEEP_PER_SHEPHERD = PEN_PER_SLOT / HEADS
/** Crew a pen needs: a shepherd for every SHEEP_PER_SHEPHERD sheep (at least one), so a small flock needs few. */
export const penCrew = (b: Building) => Math.max(1, Math.ceil(heads(b) / SHEEP_PER_SHEPHERD - 1e-9))

/** Sheep the pasture around a village's wells and pens feeds, all its pens together. */
export function pastureCap(world: World, s: GameState, v: Village, inside: (col: number, row: number) => boolean): number {
  const taken = new Set<number>()
  const idx = (col: number, row: number) => row * world.width + col
  for (const o of Object.values(s.villages)) {
    taken.add(idx(o.col, o.row))
    for (const i of o.city ?? []) taken.add(i)
    for (const b of o.buildings) taken.add(idx(b.col, b.row))
  }
  const centres: { col: number; row: number }[] = v.buildings.filter((b) => b.progress >= 1 && b.type === 'pen')
  if (!centres.length) return 0
  for (const i of Object.keys(s.wells ?? {})) {
    const c = world.cells[Number(i)]
    if (c && inside(c.col, c.row)) centres.push(c)
  }
  const seen = new Set<number>()
  let cap = 0
  for (const c of centres) {
    for (const o of spiral(c, 1)) {
      if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) continue
      const i = idx(o.col, o.row)
      if (seen.has(i) || taken.has(i)) continue
      seen.add(i)
      const cell = world.cells[i]
      if (cell && cell.tier !== 0) cap += PASTURE[cell.terrain] ?? 0
    }
  }
  return cap
}

/** One crew's day of cheese and wool, per head (before the day's strength and staffing). */
export function dailyYield(n: number, season: keyof typeof MILK): { cheese: number; wool: number } {
  return { cheese: n * CHEESE_PER_HEAD * MILK[season], wool: n * WOOL_PER_HEAD }
}

/** Take up to `n` sheep from a flock, oldest first; returns how many went. */
export function slaughter(b: Building, n: number): number {
  const f = flock(b)
  let left = Math.floor(n)
  let took = 0
  for (let a = AGES - 1; a >= 0 && left > 0; a--) {
    const k = Math.min(f[a], left)
    f[a] -= k
    left -= k
    took += k
  }
  b.herd = f
  return took
}

/** Spring: lambs, up to the room in the pasture (`room` is the sheep it still feeds). */
export function lamb(b: Building, room: number): number {
  const f = flock(b)
  const n = Math.max(0, Math.min(Math.floor(heads(b) * BIRTH_RATE), Math.floor(room)))
  f[0] += n
  b.herd = f
  return n
}

/** Winter: everyone is a year older (the oldest stay in the last group). */
export function age(b: Building) {
  const f = flock(b)
  const next = new Array(AGES).fill(0)
  for (let a = 0; a < AGES; a++) next[Math.min(AGES - 1, a + 1)] += f[a]
  b.herd = next
}

/** Mutton from `n` sheep: salted into cured meat as far as the salt goes (a pinch a ration), the rest fresh. */
export function mutton(n: number, salt: number): { goods: Goods; salted: number } {
  const rations = n * MEAT_PER_HEAD
  const cured = Math.min(rations, Math.max(0, salt))
  const goods: Goods = {}
  if (cured > 0) goods.cured_meat = cured
  if (rations - cured > 0) goods.game = (rations - cured) / 10
  return { goods, salted: cured }
}
