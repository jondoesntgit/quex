/** Static game data: goods, buildings, actions, habits.
 *  Mirrors the Bookstacks "Economy, Roles and Resources" build ladders. */
import type { Resource, Role, Terrain } from '../world/types'

export const GOODS = [
  // raw (also world resources)
  'grain', 'fish', 'timber', 'stone', 'clay', 'tin', 'wool', 'berries', 'herbs', 'salt', 'game',
  // ores
  'copper_ore', 'iron_ore',
  // processed
  'bread', 'smoked_fish', 'cheese', 'bricks', 'charcoal', 'planks', 'leather', 'cloth',
  'copper', 'iron', 'bronze', 'steel',
  // loot
  'relic', 'dragon_scale',
] as const
export type Good = (typeof GOODS)[number]
export type Goods = Partial<Record<Good, number>>

export const GOOD_LABEL: Record<Good, string> = {
  grain: 'Grain', fish: 'Fish', timber: 'Timber', stone: 'Stone', clay: 'Clay', tin: 'Tin',
  wool: 'Wool', berries: 'Berries', herbs: 'Herbs', salt: 'Salt', game: 'Game',
  copper_ore: 'Copper ore', iron_ore: 'Iron ore', bread: 'Bread', smoked_fish: 'Smoked fish',
  cheese: 'Cheese', bricks: 'Bricks', charcoal: 'Charcoal', planks: 'Planks', leather: 'Leather',
  cloth: 'Cloth', copper: 'Copper', iron: 'Iron', bronze: 'Bronze', steel: 'Steel',
  relic: 'Relic', dragon_scale: 'Dragon scale',
}

/** Food value per unit. Preserved foods keep through winter; fresh ones spoil. */
export const FOOD: Partial<Record<Good, { value: number; keeps: boolean }>> = {
  grain: { value: 1, keeps: true },
  bread: { value: 1.5, keeps: false },
  fish: { value: 1, keeps: false },
  smoked_fish: { value: 1.2, keeps: true },
  cheese: { value: 1.5, keeps: true },
  berries: { value: 0.8, keeps: false },
  game: { value: 1, keeps: false },
}

/** What a gather action on a hex yields. */
export const GATHER: Partial<Record<Resource, Good>> = {
  grain: 'grain', fish: 'fish', timber: 'timber', stone: 'stone', clay: 'clay', copper: 'copper_ore',
  iron: 'iron_ore', tin: 'tin', wool: 'wool', berries: 'berries', herbs: 'herbs', salt: 'salt', game: 'game',
}

export type TaskSize = 'big' | 'medium' | 'small'
export const SIZE_POINTS: Record<TaskSize, number> = { big: 30, medium: 20, small: 10 }
export const PLAN_SIZES: TaskSize[] = ['big', 'medium', 'medium', 'small', 'small', 'small']

// ------------------------------------------------------------------ buildings

export type BuildingId =
  | 'house' | 'granary' | 'palisade' | 'chapel' | 'library' | 'market'
  | 'garden' | 'field' | 'mill' | 'orchard' | 'irrigation'
  | 'shore_fishery' | 'smokehouse' | 'salt_pans' | 'docks' | 'shipyard'
  | 'quarry' | 'kiln' | 'copper_mine' | 'smelter' | 'iron_mine' | 'bloomery' | 'bronze_foundry'
  | 'forager_camp' | 'lumber_camp' | 'hunting_lodge' | 'charcoal_kiln' | 'sawmill'
  | 'pen' | 'dairy' | 'weaver'
  | 'scout_camp' | 'outfitter'

export interface BuildingDef {
  id: BuildingId
  name: string
  /** village role whose ladder this belongs to ('any' = every village) */
  role: Role | 'any'
  /** token size needed to build it */
  size: 'medium' | 'big'
  cost: Goods
  /** hex must have one of these terrains (if set) */
  terrain?: Terrain[]
  /** hex must hold this resource (if set) */
  resource?: Resource[]
  /** or a neighbouring hex must have one of these terrains */
  nearTerrain?: Terrain[]
  /** may be dug into a mountain (mines, quarries); everything else needs open ground */
  mountain?: boolean
  produces?: Goods
  consumes?: Goods
  /** seasonal crop: affected by weekday seasons + rain habit */
  crop?: boolean
  popCap?: number
  storage?: number
  defence?: number
  morale?: number
  blurb: string
}

const B = (d: BuildingDef) => d
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  // any village
  house: B({ id: 'house', name: 'House', role: 'any', size: 'medium', cost: { timber: 4 }, popCap: 4, blurb: 'Room for four more villagers.' }),
  granary: B({ id: 'granary', name: 'Granary', role: 'any', size: 'medium', cost: { timber: 6, stone: 2 }, storage: 40, blurb: 'Keeps food safe for the Saturday winter.' }),
  palisade: B({ id: 'palisade', name: 'Palisade', role: 'any', size: 'medium', cost: { timber: 8 }, defence: 6, blurb: 'Sharpened logs. Goblins hate it.' }),
  chapel: B({ id: 'chapel', name: 'Chapel', role: 'any', size: 'big', cost: { stone: 8, timber: 4 }, morale: 4, blurb: 'Powered by the devotions habit.' }),
  library: B({ id: 'library', name: 'Library', role: 'any', size: 'big', cost: { timber: 8, stone: 4 }, blurb: 'Powered by the reading habit: +5% output when you read.' }),
  market: B({ id: 'market', name: 'Market', role: 'any', size: 'big', cost: { timber: 6, stone: 6, copper: 2 }, morale: 2, blurb: 'Cheaper caravans and better NPC rates.' }),
  // farming
  garden: B({ id: 'garden', name: 'Garden plots', role: 'farm', size: 'medium', cost: { timber: 1 }, terrain: ['grass', 'meadow', 'savannah'], produces: { grain: 1.5, berries: 0.5 }, crop: true, blurb: 'Wild grain and vegetables.' }),
  field: B({ id: 'field', name: 'Wheat field', role: 'farm', size: 'medium', cost: { timber: 2 }, terrain: ['grass', 'meadow'], produces: { grain: 3 }, crop: true, blurb: 'Planted wheat and barley.' }),
  mill: B({ id: 'mill', name: 'Mill & bakery', role: 'farm', size: 'big', cost: { stone: 6, timber: 6 }, consumes: { grain: 3 }, produces: { bread: 3 }, blurb: 'Grain to flour to bread.' }),
  orchard: B({ id: 'orchard', name: 'Orchard', role: 'farm', size: 'medium', cost: { timber: 3 }, terrain: ['grass', 'meadow', 'hills'], produces: { berries: 2 }, crop: true, blurb: 'Fruit for a varied diet.' }),
  irrigation: B({ id: 'irrigation', name: 'Irrigation', role: 'farm', size: 'big', cost: { stone: 4, copper: 1 }, terrain: ['grass', 'meadow'], produces: { grain: 4 }, crop: true, blurb: 'Ditches from the river: a big yield jump.' }),
  // port
  shore_fishery: B({ id: 'shore_fishery', name: 'Shore fishery', role: 'port', size: 'medium', cost: { timber: 2 }, nearTerrain: ['shallow', 'ocean'], produces: { fish: 2.5 }, blurb: 'Spears, lines and shellfish.' }),
  smokehouse: B({ id: 'smokehouse', name: 'Smokehouse', role: 'port', size: 'medium', cost: { timber: 4, stone: 2 }, consumes: { fish: 2, timber: 0.5 }, produces: { smoked_fish: 2 }, blurb: 'Smoked fish keeps through winter.' }),
  salt_pans: B({ id: 'salt_pans', name: 'Salt pans', role: 'port', size: 'medium', cost: { stone: 3 }, terrain: ['beach', 'desert'], produces: { salt: 1.5 }, blurb: 'Salt preserves food and trades well.' }),
  docks: B({ id: 'docks', name: 'Docks', role: 'port', size: 'big', cost: { planks: 6, stone: 2 }, nearTerrain: ['shallow', 'ocean'], produces: { fish: 4 }, blurb: 'Boats reach deeper water.' }),
  shipyard: B({ id: 'shipyard', name: 'Shipyard', role: 'port', size: 'big', cost: { planks: 10, iron: 3, cloth: 2 }, nearTerrain: ['shallow', 'ocean'], blurb: 'NPC trade at the best rates; ships for explorers.' }),
  // mining
  quarry: B({ id: 'quarry', name: 'Quarry', role: 'mining', size: 'medium', cost: { timber: 2 }, nearTerrain: ['rock', 'hills'], mountain: true, produces: { stone: 2.5 }, blurb: 'Building stone from the hillside.' }),
  kiln: B({ id: 'kiln', name: 'Brick kiln', role: 'mining', size: 'medium', cost: { stone: 3 }, consumes: { clay: 2, timber: 0.5 }, produces: { bricks: 2 }, blurb: 'Fired bricks from river clay.' }),
  copper_mine: B({ id: 'copper_mine', name: 'Copper mine', role: 'mining', size: 'big', cost: { timber: 4, stone: 2 }, resource: ['copper'], mountain: true, produces: { copper_ore: 2 }, blurb: 'Green-streaked ore.' }),
  smelter: B({ id: 'smelter', name: 'Smelter', role: 'mining', size: 'big', cost: { stone: 6, bricks: 4 }, consumes: { copper_ore: 2, charcoal: 1 }, produces: { copper: 2 }, blurb: 'Copper: cookware, pipes, bells, coins.' }),
  iron_mine: B({ id: 'iron_mine', name: 'Deep iron mine', role: 'mining', size: 'big', cost: { timber: 6, planks: 2 }, resource: ['iron'], mountain: true, produces: { iron_ore: 2 }, blurb: 'Needs timber shaft supports.' }),
  bloomery: B({ id: 'bloomery', name: 'Bloomery', role: 'mining', size: 'big', cost: { stone: 6, bricks: 6 }, consumes: { iron_ore: 2, charcoal: 3 }, produces: { iron: 1 }, blurb: 'Hot work. Lots of charcoal.' }),
  bronze_foundry: B({ id: 'bronze_foundry', name: 'Bronze foundry', role: 'mining', size: 'big', cost: { bricks: 6, copper: 2 }, consumes: { copper: 1.8, tin: 0.2, charcoal: 1 }, produces: { bronze: 2 }, blurb: 'Copper plus traded tin, about 9:1.' }),
  // forestry
  forager_camp: B({ id: 'forager_camp', name: 'Foraging camp', role: 'forestry', size: 'medium', cost: { timber: 1 }, terrain: ['forest', 'swamp', 'tundra'], produces: { berries: 1.5, game: 1 }, blurb: 'Berries, deadwood, game.' }),
  lumber_camp: B({ id: 'lumber_camp', name: 'Lumber camp', role: 'forestry', size: 'medium', cost: { stone: 1 }, terrain: ['forest'], produces: { timber: 3 }, blurb: 'Logs for everyone.' }),
  hunting_lodge: B({ id: 'hunting_lodge', name: 'Hunting lodge', role: 'forestry', size: 'medium', cost: { timber: 4 }, terrain: ['forest', 'tundra', 'savannah'], produces: { game: 2, leather: 0.5 }, blurb: 'Furs and leather for explorers.' }),
  charcoal_kiln: B({ id: 'charcoal_kiln', name: 'Charcoal kiln', role: 'forestry', size: 'medium', cost: { stone: 3, clay: 2 }, consumes: { timber: 2 }, produces: { charcoal: 2 }, blurb: 'Charcoal for the miners.' }),
  sawmill: B({ id: 'sawmill', name: 'Sawmill', role: 'forestry', size: 'big', cost: { timber: 6, copper: 2 }, consumes: { timber: 2 }, produces: { planks: 2 }, blurb: 'Any metal blade works; better metal, more planks.' }),
  // herding
  pen: B({ id: 'pen', name: 'Sheep pen', role: 'herding', size: 'medium', cost: { timber: 3 }, terrain: ['hills', 'meadow', 'savannah', 'grass'], produces: { wool: 2, game: 0.5 }, blurb: 'Goats and sheep: milk, meat, wool.' }),
  dairy: B({ id: 'dairy', name: 'Dairy', role: 'herding', size: 'medium', cost: { timber: 4, stone: 2 }, produces: { cheese: 1.5 }, consumes: { salt: 0.2 }, blurb: 'Cheese keeps, so it trades well.' }),
  weaver: B({ id: 'weaver', name: 'Weaver', role: 'herding', size: 'big', cost: { timber: 6, planks: 2 }, consumes: { wool: 2 }, produces: { cloth: 1 }, blurb: 'Cloth for clothes and sails.' }),
  // explorer
  scout_camp: B({ id: 'scout_camp', name: 'Scout camp', role: 'explorer', size: 'medium', cost: { timber: 2 }, blurb: 'Scouting reveals one ring further.' }),
  outfitter: B({ id: 'outfitter', name: 'Outfitter', role: 'explorer', size: 'big', cost: { timber: 4, leather: 2 }, defence: 2, blurb: 'Packs and gear: stronger expeditions.' }),
}

// ------------------------------------------------------------------ actions

export type ActionKind = 'scout' | 'gather' | 'clear' | 'plant' | 'road' | 'build' | 'caravan' | 'outpost' | 'expedition'

export const ACTIONS: Record<ActionKind, { size: TaskSize; name: string; blurb: string }> = {
  scout: { size: 'small', name: 'Scout', blurb: 'Reveal the land around a hex.' },
  gather: { size: 'small', name: 'Gather', blurb: "Collect a hex's resource by hand." },
  clear: { size: 'small', name: 'Fell a tree', blurb: 'One tree for timber; the rest spread back in winter. Fell the last to open the land.' },
  plant: { size: 'small', name: 'Plant trees', blurb: 'Two saplings that take root in winter, then spread.' },
  road: { size: 'small', name: 'Dirt road', blurb: 'Faster caravans through this hex.' },
  build: { size: 'medium', name: 'Build', blurb: 'Raise a building in your territory.' },
  caravan: { size: 'medium', name: 'Caravan', blurb: 'Send goods to a neighbour.' },
  outpost: { size: 'big', name: 'Found outpost', blurb: 'Extend your territory.' },
  expedition: { size: 'big', name: 'Expedition', blurb: 'Take on a monster lair for loot.' },
}

export const SIZE_RANK: Record<TaskSize, number> = { small: 1, medium: 2, big: 3 }

// ------------------------------------------------------------------ habits

export type HabitEffect = 'rain' | 'movement' | 'library' | 'morale' | 'trade' | 'health'
export const HABIT_PRESETS: { id: string; name: string; effect: HabitEffect; blurb: string }[] = [
  { id: 'water', name: 'Drink water', effect: 'rain', blurb: 'Rain: +20% crops' },
  { id: 'walk', name: 'Walk / exercise', effect: 'movement', blurb: 'Units and caravans move faster' },
  { id: 'read', name: 'Read', effect: 'library', blurb: 'Library: +5% output' },
  { id: 'devotions', name: 'Devotions', effect: 'morale', blurb: 'Chapel: +morale' },
  { id: 'friends', name: 'Contact a friend', effect: 'trade', blurb: 'Trade routes: cheaper caravans' },
  { id: 'sleep', name: 'Bed on time', effect: 'health', blurb: 'Villagers recover from raids' },
]
export const MAX_HABIT_SLOTS = 13
export const PERFECT_DAYS_PER_SLOT = 7
