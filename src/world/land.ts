/** What can stand where. Shared by the world generator (village sites) and the
 *  game rules (buildings, outposts, felling trees). */
import type { Cell, Feature, Terrain } from './types'

export const TREE_FEATURES: ReadonlySet<Feature> = new Set(['pine1', 'pine3', 'pine5', 'oak1', 'oak3', 'oak5'])
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
