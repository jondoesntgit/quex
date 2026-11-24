/** Static game data: goods, buildings, actions, habits.
 *  Mirrors the Bookstacks "Economy, Roles and Resources" build ladders. */
import type { WeekSeason } from './calendar'
import type { Resource, Role, Terrain } from '../world/types'

export const GOODS = [
  // raw (also world resources)
  'grain', 'fish', 'timber', 'stone', 'clay', 'tin', 'wool', 'berries', 'herbs', 'salt', 'game',
  // garden produce, one for each growing season
  'worts', 'turnips',
  // ores (copper_ore is malachite, iron_ore hematite, silver_ore galena: the ids predate the minerals)
  'copper_ore', 'chalcopyrite', 'limonite', 'iron_ore', 'magnetite', 'silver_ore',
  // processed
  'bread', 'smoked_fish', 'cheese', 'cured_meat', 'bricks', 'charcoal', 'planks', 'leather', 'cloth',
  // what immigrants carry on the road (see immigrants.ts)
  'biscuit', 'dried_peas', 'honey',
  'copper', 'iron', 'bronze', 'steel', 'silver',
  // powder and siege
  'saltpetre', 'sulfur', 'gunpowder', 'cannonballs', 'musket', 'cannon', 'ram', 'siege_tower',
  // loot
  'relic', 'dragon_scale',
] as const
export type Good = (typeof GOODS)[number]
export type Goods = Partial<Record<Good, number>>

export const GOOD_LABEL: Record<Good, string> = {
  grain: 'Grain', fish: 'Fish', timber: 'Timber', stone: 'Stone', clay: 'Clay', tin: 'Tin',
  wool: 'Wool', berries: 'Berries', herbs: 'Herbs', salt: 'Salt', game: 'Game', worts: 'Worts', turnips: 'Turnips',
  copper_ore: 'Malachite', chalcopyrite: 'Chalcopyrite', limonite: 'Limonite', iron_ore: 'Hematite', magnetite: 'Magnetite', silver_ore: 'Galena', silver: 'Silver', bread: 'Bread', smoked_fish: 'Smoked fish',
  cured_meat: 'Cured meat', biscuit: 'Biscuit', dried_peas: 'Dried peas', honey: 'Honey',
  cheese: 'Cheese', bricks: 'Bricks', charcoal: 'Charcoal', planks: 'Planks', leather: 'Leather',
  cloth: 'Cloth', copper: 'Copper', iron: 'Iron', bronze: 'Bronze', steel: 'Steel',
  relic: 'Relic', dragon_scale: 'Dragon scale',
  saltpetre: 'Saltpetre', sulfur: 'Sulfur', gunpowder: 'Gunpowder', cannonballs: 'Cannonballs', musket: 'Musket',
  cannon: 'Cannon', ram: 'Battering ram', siege_tower: 'Siege tower',
}

/** Food is counted in rations: one ration feeds one person for a day (EAT = 1). Bulk goods are counted in
 *  wagon loads, so a wagon load of grain is FOOD_SCALE rations, and so on for the rest by `value`. */
export const FOOD_SCALE = 10
/** Rations in a wagon load of each food. Preserved foods keep through winter; fresh ones spoil. */
export const FOOD: Partial<Record<Good, { value: number; keeps: boolean }>> = {
  grain: { value: 1 * FOOD_SCALE, keeps: true },
  bread: { value: 1.5 * FOOD_SCALE, keeps: false },
  fish: { value: 1 * FOOD_SCALE, keeps: false },
  smoked_fish: { value: 1.2 * FOOD_SCALE, keeps: true },
  cheese: { value: 1, keeps: true }, // counted in rations: one unit is one person's cheese for a day
  cured_meat: { value: 1, keeps: true }, // salted game, in rations too
  biscuit: { value: 1.2 * FOOD_SCALE, keeps: true },
  dried_peas: { value: 1 * FOOD_SCALE, keeps: true },
  honey: { value: 2 * FOOD_SCALE, keeps: true },
  berries: { value: 0.8 * FOOD_SCALE, keeps: false },
  worts: { value: 0.6 * FOOD_SCALE, keeps: false },
  turnips: { value: 1.1 * FOOD_SCALE, keeps: true },
  game: { value: 1 * FOOD_SCALE, keeps: false },
}

/** Salt is counted so that one unit salts one ration of food (a pinch, about a twentieth of a pound). Before the
 *  change a unit of salt was this many of them. */
export const SALT_PER_OLD = 112.5
/** What a gather action brings in per point of effort (3 a small task), where a unit isn't the usual size. */
export const GATHER_YIELD: Partial<Record<Good, number>> = { salt: SALT_PER_OLD }
export const gatherAmount = (g: Good, k: number) => Math.round(3 * k * (GATHER_YIELD[g] ?? 1) * 100) / 100

/** How many stored units make what the fighting rules count as one unit of food (cheese is counted in rations). */
export const FOOD_UNIT: Partial<Record<Good, number>> = { cheese: 15 }
export const foodUnit = (g: Good) => FOOD_UNIT[g] ?? 1

/** Goods counted in wagon loads (what one wagon carries), so the numbers mean something. Metals, cloth and
 *  the like are counted in pieces. */
export const BULK: readonly Good[] = ['grain', 'fish', 'timber', 'stone', 'clay', 'tin', 'wool', 'berries', 'worts', 'turnips', 'game', 'copper_ore', 'chalcopyrite', 'limonite', 'iron_ore', 'magnetite', 'silver_ore', 'bricks', 'charcoal', 'planks', 'salt', 'bread', 'cheese', 'smoked_fish', 'biscuit', 'dried_peas']
export const isBulk = (g: Good) => BULK.includes(g)
export const BULK_UNIT = 'wagon loads'

/** How each ore is worked into metal: where, with what, and how much comes out.
 *  A station takes up to STATION_RATE ore a night (at a full day's work), the
 *  easiest ores first, and needs `fuel` charcoal for each ore it takes. */
export interface OreInfo {
  metal: Good
  /** metal per ore */
  yield: number
  /** charcoal per ore */
  fuel: number
  station: BuildingId
  /** another building the village needs before the station can take this ore */
  with?: BuildingId
  /** what else comes out, per ore (roasting chalcopyrite drives off sulfur) */
  byproduct?: Goods
  /** what it is, and what it needs, in a line */
  note: string
}
export const ORES: Partial<Record<Good, OreInfo>> = {
  copper_ore: { metal: 'copper', yield: 1, fuel: 0.5, station: 'smelter', note: 'Green copper carbonate from near the surface. It smelts easily.' },
  chalcopyrite: { metal: 'copper', yield: 0.6, fuel: 1, station: 'smelter', with: 'roasting_heap', byproduct: { sulfur: 0.15 }, note: 'Brassy copper-iron sulfide from deep in a copper mine. Roast the sulfur off first (and keep it: gunpowder needs it), then smelt it. Carries a little silver.' },
  limonite: { metal: 'iron', yield: 0.4, fuel: 1.5, station: 'bloomery', note: 'Rusty yellow-brown iron from the surface and the bogs. Poor, but easy to work.' },
  iron_ore: { metal: 'iron', yield: 0.5, fuel: 1.5, station: 'bloomery', note: "Red iron oxide: the smith's mainstay." },
  magnetite: { metal: 'iron', yield: 0.6, fuel: 2.5, station: 'bloomery', note: 'Black, magnetic and the richest iron ore, from deep in an iron mine. It needs a hotter fire: more charcoal.' },
  silver_ore: { metal: 'silver', yield: 0.125, fuel: 1, station: 'silver_refinery', note: 'Heavy grey lead ore. Refining burns the lead away to leave a bead of silver.' },
}
/** Ore a station can work in a night, at a full day's work. */
export const STATION_RATE = 2
/** The ores a station works, easiest first. */
export const stationOres = (id: BuildingId) => (Object.keys(ORES) as Good[]).filter((g) => ORES[g]!.station === id)

/** Ore a mine brings up in a night, at a full day's work. */
export const MINE_RATE: Partial<Record<BuildingId, number>> = { quarry: 2.5, copper_mine: 2, iron_mine: 2, silver_mine: 1.5 }
/** How deep a mine's shaft can go, in levels. */
export const MAX_DEPTH = 3
/** Shoring timber for sinking a shaft to level 2, 3. */
export const DEEPEN_COST: Record<number, Goods> = { 2: { timber: 4, planks: 2 }, 3: { timber: 6, planks: 4 } }

/** What a gather action on a hex yields. */
export const GATHER: Partial<Record<Resource, Good>> = {
  grain: 'grain', fish: 'fish', timber: 'timber', stone: 'stone', clay: 'clay', copper: 'copper_ore',
  iron: 'limonite', silver: 'silver_ore', tin: 'tin', wool: 'wool', berries: 'berries', herbs: 'herbs', salt: 'salt', game: 'game',
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
  | 'silver_mine' | 'silver_refinery' | 'roasting_heap' | 'stable' | 'cart_shed'
  | 'nitre_beds' | 'powder_mill' | 'gun_foundry' | 'gunsmith' | 'siege_workshop'
  | 'forager_camp' | 'lumber_camp' | 'hunting_lodge' | 'charcoal_kiln' | 'sawmill'
  | 'pen' | 'dairy' | 'weaver'
  | 'scout_camp' | 'outfitter'

/** People are counted one by one. Until the conversion at CITY_FROM a "person" was a household of this
 *  many: every per-person number is derived from it, so the economy stays in balance. */
export const HEADS = 5
/** Food (rations) one person eats a day. */
export const EAT = 1

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
  /** another building the village must have first */
  needs?: BuildingId
  /** things it can make, one at a time: the player puts in an order (the first, if none) */
  recipes?: Recipe[]
  /** works ores into metal (see ORES) */
  smelts?: boolean
  /** digs ore out of its hex, level by level (see MINE_RATE, deposits.ts) */
  mine?: boolean
  /** seasonal crop: affected by weekday seasons + rain habit */
  crop?: boolean
  /** what a crop building makes instead of (or besides) `produces` in a given weekday season */
  seasonal?: Partial<Record<WeekSeason, Goods>>
  /** share of its crew a building needs in each weekday season (1 if not listed): fields are sown in spring,
   *  idle in summer and reaped in autumn */
  labor?: Partial<Record<WeekSeason, number>>
  /** a grain crop: sown in spring, all of its food comes at the autumn harvest (see shift) */
  harvest?: boolean
  /** keeps a flock (see herds.ts) */
  herd?: boolean
  /** may be built beside a river as well as the sea */
  river?: boolean
  /** built out over the shallows, from your own shore (not on land) */
  shallows?: boolean
  popCap?: number
  /** no longer built (replaced); existing ones carry on */
  legacy?: boolean
  /** wagon loads of food it holds (FOOD_SCALE rations each) */
  storage?: number
  defence?: number
  morale?: number
  blurb: string
}

/** One thing a workshop can make: what goes in and what comes out in a night's shift. */
export interface Recipe { id: string; name: string; consumes: Goods; produces: Goods }

const B = (d: BuildingDef) => d

/** What a building makes in a weekday season: its steady produce plus any seasonal vegetable. */
export function producesIn(def: BuildingDef, season: WeekSeason): Goods | undefined {
  const extra = def.seasonal?.[season]
  return extra ? { ...def.produces, ...extra } : def.produces
}
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  // any village
  house: B({ id: 'house', name: 'House', role: 'any', size: 'medium', cost: { timber: 4 }, popCap: 4 * HEADS, legacy: true, blurb: `A row of cottages: room for ${4 * HEADS} more villagers. (New homes go up in the city, on cobblestone.)` }),
  granary: B({ id: 'granary', name: 'Granary', role: 'any', size: 'medium', cost: { timber: 6, stone: 2 }, storage: 40, blurb: 'Keeps food safe for the Saturday winter.' }),
  palisade: B({ id: 'palisade', name: 'Palisade', role: 'any', size: 'medium', cost: { timber: 8 }, defence: 6, blurb: 'Sharpened logs. Goblins hate it.' }),
  chapel: B({ id: 'chapel', name: 'Chapel', role: 'any', size: 'big', cost: { stone: 8, timber: 4 }, morale: 4, blurb: 'Powered by the devotions habit.' }),
  library: B({ id: 'library', name: 'Library', role: 'any', size: 'big', cost: { timber: 8, stone: 4 }, blurb: 'Powered by the reading habit: +5% output when you read.' }),
  market: B({ id: 'market', name: 'Market', role: 'any', size: 'big', cost: { timber: 6, stone: 6, copper: 2 }, morale: 2, blurb: 'Cheaper caravans and better NPC rates.' }),
  // farming
  garden: B({ id: 'garden', name: 'Garden plots', role: 'farm', size: 'medium', cost: { timber: 1 }, terrain: ['grass', 'meadow', 'savannah'], produces: { grain: 0.8 }, seasonal: { spring: { worts: 1.2 }, summer: { dried_peas: 0.7 }, autumn: { turnips: 0.65 } }, crop: true, blurb: 'Tended all season, about 3 rations a worker. Grain, plus worts (kale and leeks) in spring, dried peas in summer, turnips in autumn. Peas and turnips keep through winter.' }),
  field: B({ id: 'field', name: 'Wheat field', role: 'farm', size: 'medium', cost: { timber: 2 }, terrain: ['grass', 'meadow'], produces: { grain: 7 }, harvest: true, labor: { spring: 0.5, summer: 0, autumn: 1 }, crop: true, blurb: 'Wheat and barley: sow it in spring (half a crew), leave it in summer, reap it in autumn (a full crew). Reaped well, 7 rations a worker, and half the village on the harvest feeds all of it. Unsown, it still gives a quarter in volunteer grain.' }),
  mill: B({ id: 'mill', name: 'Mill & bakery', role: 'farm', size: 'big', cost: { stone: 6, timber: 6 }, consumes: { grain: 3 }, produces: { bread: 2 }, blurb: 'Grain to flour to bread: 3 grain bake 2 loaves. No more food than the grain, but bread lifts morale and weighs half as much to carry.' }),
  orchard: B({ id: 'orchard', name: 'Orchard', role: 'farm', size: 'medium', cost: { timber: 3 }, terrain: ['grass', 'meadow', 'hills'], produces: { berries: 1.25 }, labor: { spring: 0.5 }, crop: true, blurb: 'Fruit for a varied diet.' }),
  irrigation: B({ id: 'irrigation', name: 'Irrigation', role: 'farm', size: 'big', cost: { stone: 4, copper: 1 }, terrain: ['grass', 'meadow'], produces: { grain: 5 }, harvest: true, labor: { spring: 0.5, summer: 0, autumn: 1 }, crop: true, blurb: 'Ditches from the river: a big yield jump, 10 rations a worker. Sown and reaped like a field.' }),
  // port
  shore_fishery: B({ id: 'shore_fishery', name: 'Shore fishery', role: 'port', size: 'medium', cost: { timber: 2 }, nearTerrain: ['shallow', 'ocean'], river: true, produces: { fish: 3 }, blurb: 'Lines and shellfish, about 3 rations a worker; on the shore or a river. Fishing spears make it 5, boats 10.' }),
  smokehouse: B({ id: 'smokehouse', name: 'Smokehouse', role: 'port', size: 'medium', cost: { timber: 4, stone: 2 }, consumes: { fish: 2, timber: 0.5 }, produces: { smoked_fish: 1.6 }, blurb: 'Smoking dries fish out (2 fish make 1.6), but smoked fish keeps through winter. Put in an order to cure game with salt instead: cured meat keeps too, a pinch of salt to each ration.',
    recipes: [
      { id: 'smoke', name: 'Smoked fish', consumes: { fish: 2, timber: 0.5 }, produces: { smoked_fish: 1.6 } },
      { id: 'cure', name: 'Cured meat', consumes: { game: 2, salt: 18, timber: 0.5 }, produces: { cured_meat: 18 } },
    ] }),
  salt_pans: B({ id: 'salt_pans', name: 'Salt pans', role: 'port', size: 'medium', cost: { stone: 3 }, terrain: ['beach', 'desert'], produces: { salt: 1.5 * SALT_PER_OLD }, blurb: 'Salt preserves food (one pinch to a ration) and trades well.' }),
  docks: B({ id: 'docks', name: 'Docks', role: 'port', size: 'big', cost: { planks: 6, stone: 2 }, shallows: true, produces: { fish: 4.5 }, blurb: 'A pier of planks out into the shallows, a big crew on the water. Spears and boats raise its catch like the shore fishery\'s.' }),
  shipyard: B({ id: 'shipyard', name: 'Shipyard', role: 'port', size: 'big', cost: { planks: 10, iron: 3, cloth: 2 }, shallows: true, blurb: 'Built out over the shallows. NPC trade at the best rates; ships for explorers.' }),
  // mining
  quarry: B({ id: 'quarry', name: 'Quarry', role: 'mining', size: 'medium', cost: { timber: 2 }, nearTerrain: ['rock', 'hills'], mountain: true, mine: true, blurb: 'Building stone from the hillside. Cut it deeper, level by level, to reach more rock.' }),
  kiln: B({ id: 'kiln', name: 'Brick kiln', role: 'mining', size: 'medium', cost: { stone: 3 }, consumes: { clay: 2, timber: 0.5 }, produces: { bricks: 2 }, blurb: 'Fired bricks from river clay.' }),
  copper_mine: B({ id: 'copper_mine', name: 'Copper mine', role: 'mining', size: 'big', cost: { timber: 4, stone: 2 }, resource: ['copper'], mountain: true, mine: true, blurb: 'Digs out malachite, then deeper chalcopyrite (with a little galena). Sink the shaft deeper to reach more.' }),
  smelter: B({ id: 'smelter', name: 'Smelter', role: 'mining', size: 'big', cost: { stone: 6, bricks: 4 }, smelts: true, blurb: 'Smelts malachite into copper, and chalcopyrite too with a roasting heap. Burns charcoal.' }),
  roasting_heap: B({ id: 'roasting_heap', name: 'Roasting heap', role: 'mining', size: 'medium', cost: { stone: 3, timber: 1 }, blurb: "Burns the sulfur out of chalcopyrite so the smelter can take it. Stinks." }),
  iron_mine: B({ id: 'iron_mine', name: 'Deep iron mine', role: 'mining', size: 'big', cost: { timber: 6, planks: 2 }, resource: ['iron'], mountain: true, mine: true, blurb: 'Digs out limonite, then hematite, then black magnetite deeper down. Sink the shaft deeper to reach more.' }),
  bloomery: B({ id: 'bloomery', name: 'Bloomery', role: 'mining', size: 'big', cost: { stone: 6, bricks: 6 }, smelts: true, blurb: 'Works limonite, hematite and magnetite into iron. Hot work: lots of charcoal.' }),
  silver_mine: B({ id: 'silver_mine', name: 'Silver mine', role: 'mining', size: 'big', cost: { timber: 6, planks: 2 }, resource: ['silver'], mountain: true, mine: true, blurb: 'Galena: heavy grey lead ore, rich in silver. Sink the shaft deeper to reach more.' }),
  silver_refinery: B({ id: 'silver_refinery', name: 'Silver refinery', role: 'mining', size: 'big', cost: { bricks: 6, stone: 4 }, smelts: true, blurb: 'Burns the lead off galena to leave silver. Slow, and hungry for charcoal.' }),
  bronze_foundry: B({ id: 'bronze_foundry', name: 'Bronze foundry', role: 'mining', size: 'big', cost: { bricks: 6, copper: 2 }, consumes: { copper: 1.8, tin: 0.2, charcoal: 1 }, produces: { bronze: 2 }, blurb: 'Copper plus traded tin, about 9:1.' }),
  // forestry
  forager_camp: B({ id: 'forager_camp', name: 'Foraging camp', role: 'forestry', size: 'medium', cost: { timber: 1 }, terrain: ['forest', 'swamp', 'tundra'], produces: { berries: 1.5, game: 1 }, blurb: 'Berries, deadwood, game.' }),
  lumber_camp: B({ id: 'lumber_camp', name: 'Lumber camp', role: 'forestry', size: 'medium', cost: { stone: 1 }, terrain: ['forest'], produces: { timber: 3 }, blurb: 'Logs for everyone.' }),
  hunting_lodge: B({ id: 'hunting_lodge', name: 'Hunting lodge', role: 'forestry', size: 'medium', cost: { timber: 4 }, terrain: ['forest', 'tundra', 'savannah'], produces: { game: 4, leather: 1 }, blurb: 'A small crew in a rich forest brings in about 4 rations a worker, taken from the game within two hexes (never the last of it). Bows make it 6, muskets 8.' }),
  charcoal_kiln: B({ id: 'charcoal_kiln', name: 'Charcoal kiln', role: 'forestry', size: 'medium', cost: { stone: 3, clay: 2 }, consumes: { timber: 2 }, produces: { charcoal: 2 }, blurb: 'Charcoal for the miners.' }),
  sawmill: B({ id: 'sawmill', name: 'Sawmill', role: 'forestry', size: 'big', cost: { timber: 6, copper: 2 }, consumes: { timber: 2 }, produces: { planks: 2 }, blurb: 'Any metal blade works; better metal, more planks. Beside a river, a water wheel drives the saw: three times the planks.' }),
  // herding
  pen: B({ id: 'pen', name: 'Sheep pen', role: 'herding', size: 'medium', cost: { timber: 3 }, terrain: ['hills', 'meadow', 'savannah', 'grass'], produces: { wool: 2 }, herd: true, blurb: 'A flock of sheep: wool and cheese all year, mutton at the autumn cull. 5 rations a worker, net of winter feed. The flock grows by half a year but only as far as the pasture within a hex of a well or pen allows.' }),
  dairy: B({ id: 'dairy', name: 'Dairy', role: 'herding', size: 'medium', cost: { timber: 4, stone: 2 }, produces: { cheese: 22.5 }, consumes: { salt: 22.5 }, legacy: true, blurb: 'Cheese keeps, so it trades well. Each ration takes a pinch of salt. (The sheep pen makes cheese now.)' }),
  stable: B({ id: 'stable', name: 'Mule stable', role: 'herding', size: 'medium', cost: { timber: 4, stone: 2 }, blurb: 'Pack mules: caravans carry twice the weight.' }),
  cart_shed: B({ id: 'cart_shed', name: 'Cart shed', role: 'herding', size: 'medium', cost: { planks: 4, timber: 2 }, needs: 'stable', blurb: 'Ox carts: caravans carry far more, where there are roads to roll on.' }),
  // powder and siege: the end of the ladder
  nitre_beds: B({ id: 'nitre_beds', name: 'Nitre beds', role: 'herding', size: 'medium', cost: { timber: 3, clay: 2 }, needs: 'pen', consumes: { grain: 0.5 }, produces: { saltpetre: 0.5 }, blurb: 'Heaps of dung and straw, turned and watered for weeks: saltpetre crystallises out. Needs a Sheep pen for the dung.' }),
  powder_mill: B({ id: 'powder_mill', name: 'Powder mill', role: 'mining', size: 'big', cost: { stone: 6, planks: 4, bricks: 2 }, consumes: { saltpetre: 1.5, sulfur: 0.25, charcoal: 0.25 }, produces: { gunpowder: 2 }, blurb: 'Saltpetre, sulfur and charcoal, ground wet so nothing sparks. Gunpowder for muskets and cannon.' }),
  gun_foundry: B({ id: 'gun_foundry', name: 'Gun foundry', role: 'mining', size: 'big', cost: { bricks: 8, stone: 4 }, needs: 'bloomery', blurb: 'Casts iron cannonballs, or great bronze cannon. Put in an order for which.',
    recipes: [
      { id: 'cannonballs', name: 'Cannonballs', consumes: { iron: 1, charcoal: 1 }, produces: { cannonballs: 3 } },
      { id: 'cannon', name: 'Bronze cannon', consumes: { bronze: 3, charcoal: 2 }, produces: { cannon: 0.25 } },
    ] }),
  gunsmith: B({ id: 'gunsmith', name: 'Gunsmith', role: 'mining', size: 'big', cost: { bricks: 4, planks: 4, iron: 2 }, needs: 'bloomery', consumes: { iron: 0.5, planks: 0.5, charcoal: 0.5 }, produces: { musket: 1 }, blurb: 'Bores iron barrels and fits them to wooden stocks: muskets.' }),
  siege_workshop: B({ id: 'siege_workshop', name: 'Siege workshop', role: 'forestry', size: 'big', cost: { planks: 6, timber: 4, iron: 1 }, blurb: 'Builds battering rams and siege towers for breaking a stronghold\'s walls. Put in an order for which.',
    recipes: [
      { id: 'ram', name: 'Battering ram', consumes: { timber: 3, iron: 0.5, leather: 1 }, produces: { ram: 0.5 } },
      { id: 'siege_tower', name: 'Siege tower', consumes: { planks: 4, iron: 0.5, leather: 1 }, produces: { siege_tower: 0.25 } },
    ] }),
  weaver: B({ id: 'weaver', name: 'Weaver', role: 'herding', size: 'big', cost: { timber: 6, planks: 2 }, consumes: { wool: 2 }, produces: { cloth: 1 }, blurb: 'Cloth for clothes and sails.' }),
  // explorer
  scout_camp: B({ id: 'scout_camp', name: 'Scout camp', role: 'explorer', size: 'medium', cost: { timber: 2 }, blurb: 'Scouting reveals one ring further.' }),
  outfitter: B({ id: 'outfitter', name: 'Outfitter', role: 'explorer', size: 'big', cost: { timber: 4, leather: 2 }, defence: 2, blurb: 'Packs and gear: stronger expeditions.' }),
}

// ------------------------------------------------------------------ tools

/** Kit that makes a village's food work go further. A tool multiplies what the buildings it names make for each
 *  worker (the best tool for a building counts, they don't stack), and is made once with goods from the stores. */
export interface ToolDef {
  id: string
  name: string
  blurb: string
  cost: Goods
  /** a building the village must have */
  needs?: BuildingId
  /** a tool it builds on */
  after?: string
  /** by how much it multiplies what each building makes */
  boosts: Partial<Record<BuildingId, number>>
}
export const TOOLS: Record<string, ToolDef> = {
  scythes: { id: 'scythes', name: 'Scythes', blurb: 'Long blades for the harvest: a third more grain from every field.', cost: { iron: 1, timber: 2 }, needs: 'field', boosts: { field: 1.3, irrigation: 1.3 } },
  fishing_spears: { id: 'fishing_spears', name: 'Fishing spears', blurb: 'Barbed spears: a fishery brings in about 5 rations a worker, up from 3.', cost: { timber: 2, copper: 1 }, boosts: { shore_fishery: 5 / 3, docks: 5 / 3 } },
  boats: { id: 'boats', name: 'Boats', blurb: 'Sailing boats and nets: about 10 rations a worker, enough to feed other villages.', cost: { planks: 6, cloth: 2 }, needs: 'docks', after: 'fishing_spears', boosts: { shore_fishery: 10 / 3, docks: 10 / 3 } },
  bows: { id: 'bows', name: 'Bows and spears', blurb: 'Hunters bring in about 6 rations a worker, up from 4, so fewer are needed (the game runs down faster).', cost: { leather: 2, timber: 2 }, needs: 'hunting_lodge', boosts: { hunting_lodge: 1.5 } },
  muskets: { id: 'muskets', name: 'Hunting muskets', blurb: 'About 8 rations a worker, and a much bigger bite out of the forest.', cost: { musket: 2, gunpowder: 1 }, needs: 'hunting_lodge', after: 'bows', boosts: { hunting_lodge: 2 } },
}
/** What a village's tools do for a building: the best of them (1 with none). */
export function toolMult(tools: readonly string[] | undefined, type: BuildingId): number {
  let m = 1
  for (const t of tools ?? []) m = Math.max(m, TOOLS[t]?.boosts[type] ?? 1)
  return m
}

// ------------------------------------------------------------------ actions

export type ActionKind = 'scout' | 'gather' | 'pick' | 'chop' | 'clear' | 'plant' | 'road' | 'build' | 'work' | 'siege' | 'deepen' | 'pave' | 'dig_clay' | 'well' | 'caravan' | 'troops' | 'outpost' | 'expedition' | 'cobble' | 'home' | 'upgrade'

export const ACTIONS: Record<ActionKind, { size: TaskSize; name: string; blurb: string }> = {
  scout: { size: 'small', name: 'Scout', blurb: 'Reveal the land around a hex.' },
  gather: { size: 'small', name: 'Gather', blurb: "Collect a hex's resource by hand." },
  pick: { size: 'small', name: 'Clear stone', blurb: 'Pick the loose stone off this land for building. Cleared fields grow more.' },
  chop: { size: 'small', name: 'Gather wood', blurb: 'Cut timber from the forest. The trees stay: it is as thick as before, so wood never runs out.' },
  clear: { size: 'small', name: 'Clear the forest', blurb: 'Fell every tree here for timber. The land is open for good: no trees grow back unless you plant them.' },
  plant: { size: 'small', name: 'Plant trees', blurb: 'Two saplings that take root in winter, then spread.' },
  road: { size: 'small', name: 'Dirt road', blurb: 'Faster caravans through this hex.' },
  pave: { size: 'small', name: 'Pave the road', blurb: 'Lay stone on your road (2 stone): caravans along it carry more, and go faster.' },
  well: { size: 'medium', name: 'Dig a well', blurb: 'Fresh water that never runs dry (3 stone): herds within a hex of it need water.' },
  dig_clay: { size: 'small', name: 'Dig clay', blurb: 'Dig clay from a riverbank, marsh, hill valley or mountain spring, for bricks and kilns.' },
  build: { size: 'medium', name: 'Build', blurb: 'Raise a building in your territory.' },
  cobble: { size: 'medium', name: 'Lay cobblestone', blurb: 'Pave this hex as part of your city: homes can stand on it, and it joins the cobbles next to it.' },
  upgrade: { size: 'big', name: 'Rebuild as a town house', blurb: 'Pull down a cottage and raise a two-storey town house in its place: room for 24 instead of 12.' },
  home: { size: 'medium', name: 'Build a home', blurb: 'A cottage or town house in your city.' },
  work: { size: 'small', name: 'Work it', blurb: "Put in an extra shift: it makes a night's worth now, if it has what it needs." },
  deepen: { size: 'big', name: 'Sink the shaft', blurb: 'Dig your mine a level deeper, shored up with timber, to reach more ore.' },
  caravan: { size: 'medium', name: 'Caravan', blurb: 'Send goods to a neighbour.' },
  troops: { size: 'medium', name: 'Send troops', blurb: "Lend people, weapons and armour to a neighbour's palisade, with food to live on." },
  outpost: { size: 'big', name: 'Found outpost', blurb: 'Extend your territory.' },
  expedition: { size: 'big', name: 'Expedition', blurb: 'Take on a monster lair for loot.' },
  siege: { size: 'big', name: 'Lay siege', blurb: 'Storm a stronghold. Its walls triple its strength: bring rams, siege towers or cannon to break them, and muskets for the assault.' },
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
