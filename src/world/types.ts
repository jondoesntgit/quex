export const TERRAINS = [
  'deep', 'ocean', 'shallow', 'beach', 'grass', 'meadow', 'forest', 'swamp',
  'hills', 'desert', 'savannah', 'rock', 'tundra', 'snow',
] as const
export type Terrain = (typeof TERRAINS)[number]

export const FEATURES = [
  'pine1', 'pine3', 'pine5', 'oak1', 'oak3', 'oak5',
  // grown from planting (two saplings)
  'pine2', 'oak2', 'saplings',
  'mountain', 'mountain_snow',
  'hills', 'reeds', 'cactus',
  // built / placed things (drawn by the game layer, not the generator)
  'hut', 'village', 'lair', 'mine', 'farm', 'dock',
] as const
export type Feature = (typeof FEATURES)[number]

/** Natural deposits a hex can hold. Tin is deliberately rare and never in
 *  starter regions: it arrives through ports and caravans. No gold. */
export const RESOURCES = [
  'grain', 'fish', 'timber', 'stone', 'clay', 'copper', 'iron', 'tin',
  'wool', 'berries', 'herbs', 'salt', 'game',
  // galena: lead ore rich in silver, in a few far mountains
  'silver',
] as const
export type Resource = (typeof RESOURCES)[number]

export const ROLES = ['farm', 'port', 'mining', 'forestry', 'herding', 'explorer'] as const
export type Role = (typeof ROLES)[number]

export interface Cell {
  col: number
  row: number
  /** continuous height, 0..1 (sea level = World.seaLevel) */
  elev: number
  /** discrete visual tier: 0 = water, 1..6 land */
  tier: number
  moist: number
  temp: number
  terrain: Terrain
  feature: Feature | null
  resource: Resource | null
  /** index of the downstream cell if a river flows out of this hex, else -1 */
  riverTo: number
  /** number of upstream river cells (rough river width) */
  riverFlow: number
  region: number
}

export interface VillageSite {
  role: Role
  col: number
  row: number
  score: number
}

export interface Lair {
  col: number
  row: number
  kind: 'goblins' | 'orcs' | 'trolls' | 'dragon'
  /** base strength before adapting to nearby players */
  strength: number
}

export interface Region {
  id: number
  rx: number
  ry: number
  name: string
  /** inclusive-exclusive cell bounds */
  col0: number
  row0: number
  col1: number
  row1: number
  land: number
  /** 0 = starter-friendly, rises toward the frontier */
  danger: number
  sites: VillageSite[]
}

export interface World {
  seed: string
  width: number
  height: number
  regionSize: number
  seaLevel: number
  cells: Cell[]
  regions: Region[]
  startRegion: number
  lairs: Lair[]
}
