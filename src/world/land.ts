/** What can stand where. Shared by the world generator (village sites) and the
 *  game rules (buildings, outposts, felling trees). */
import type { Cell, Feature, Terrain } from './types'

export const TREE_FEATURES: ReadonlySet<Feature> = new Set(['pine1', 'pine2', 'pine3', 'pine5', 'oak1', 'oak2', 'oak3', 'oak5'])
/** How many trees a tree feature stands for (a forest with no drawn trees counts as three). */
export function treeCount(l: Pick<Land, 'terrain' | 'feature'>): number {
  if (l.feature && TREE_FEATURES.has(l.feature)) return Number(l.feature.slice(-1))
  return l.terrain === 'forest' ? 3 : 0
}
/** too steep for anything but mines and quarries */
export const MOUNTAIN_TERRAIN: readonly Terrain[] = ['rock', 'snow']
/** open ground once any trees are gone */
export const OPEN_TERRAIN: readonly Terrain[] = ['grass', 'meadow', 'savannah', 'beach', 'desert', 'tundra', 'hills']

export interface Land {
  terrain: Terrain
  feature: Feature | null
  tier: number
}

export const hasTrees = (l: Pick<Land, 'terrain' | 'feature'>) =>
  l.terrain === 'forest' || (l.feature !== null && TREE_FEATURES.has(l.feature))

/** Open, tree-free land: outposts and ordinary buildings. */
export const isOpen = (l: Land) => l.tier > 0 && OPEN_TERRAIN.includes(l.terrain) && !hasTrees(l)

/** A village square: open, tree-free, and not up on the hills. */
export const isVillageSite = (l: Land) => isOpen(l) && l.terrain !== 'hills'

export const cellLand = (c: Cell): Land => ({ terrain: c.terrain, feature: c.feature, tier: c.tier })

/** Deposits worth showing on the map: ores, building stone (off the mountains,
 *  where all rock is stone), clay and salt. */
const DEPOSITS = new Set(['iron', 'copper', 'tin', 'silver', 'stone', 'clay', 'salt'])
export function isDeposit(resource: string | null | undefined, feature: string | null | undefined) {
  if (!resource || !DEPOSITS.has(resource)) return false
  return resource !== 'stone' || (feature !== 'mountain' && feature !== 'mountain_snow')
}
