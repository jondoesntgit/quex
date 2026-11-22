/** Strongholds: walled keeps held by warlords and bandit chiefs out in the
 *  wastelands (desert, tundra, bare rock and snow in the far regions). Their walls
 *  triple their strength; only siege engines and gunpowder break them:
 *
 *    - a battering ram knocks the walls down by half a time (to x1.5 at most),
 *    - a siege tower by three-quarters, each,
 *    - a cannon (with its shot and powder) by a whole time, each;
 *  and every musket (with a charge of powder) adds to the assault.
 *
 *  A fallen stronghold's hoard goes to whoever took it. Placement is a pure
 *  function of the world seed; what's happened to each is in GameState.sieges. */
import { rngFor } from '../world/rng'
import type { World } from '../world/types'
import type { Goods } from './data'

export interface Stronghold { i: number; col: number; row: number; name: string; strength: number; loot: Goods }

const WASTE = new Set(['desert', 'tundra', 'rock', 'snow'])
const NAMES = ['Blackspur Keep', 'the Red Tower', 'Ashgate', 'Gallows Hold', 'Saltreach', 'the Iron Crown', 'Duskwall', 'Bonefort', 'Grimward', 'the Wolf\'s Seat']

/** Walls multiply a stronghold's strength this much, before anything breaks them. */
export const WALLS = 3

const cache = new WeakMap<World, Stronghold[]>()
/** One stronghold in each far region (danger 2 and up) that has wasteland to put it on. */
export function strongholdsOf(world: World): Stronghold[] {
  const hit = cache.get(world)
  if (hit) return hit
  const out: Stronghold[] = []
  for (const rg of world.regions) {
    if (rg.danger < 2) continue
    const rng = rngFor(world.seed, 'stronghold', rg.id)
    const spots: number[] = []
    for (let r = rg.row0; r < rg.row1; r++) for (let c = rg.col0; c < rg.col1; c++) {
      const i = r * world.width + c
      const cell = world.cells[i]
      if (cell && cell.tier > 0 && WASTE.has(cell.terrain) && cell.riverTo === -1 && !cell.resource) spots.push(i)
    }
    if (!spots.length) continue
    const i = spots[Math.floor(rng() * spots.length)]
    const strength = Math.round(30 + rg.danger * 15 + rng() * 20)
    out.push({
      i, col: world.cells[i].col, row: world.cells[i].row, name: NAMES[Math.floor(rng() * NAMES.length)], strength,
      loot: { silver: Math.round(strength / 10), relic: 2, steel: 3, gunpowder: 4, musket: 2 },
    })
  }
  cache.set(world, out)
  return out
}

export const strongholdAt = (world: World, i: number) => strongholdsOf(world).find((x) => x.i === i) ?? null

/** How far a siege's engines and guns bring the walls down (WALLS at worst, 1 at best). */
export function wallsAfter(g: { ram?: number; siege_tower?: number; cannon?: number }, cannonReady: number) {
  let walls = WALLS
  walls -= Math.min(Math.floor(g.ram ?? 0), 3) * 0.5
  walls -= Math.floor(g.siege_tower ?? 0) * 0.75
  walls -= cannonReady
  return Math.max(1, Math.round(walls * 100) / 100)
}
