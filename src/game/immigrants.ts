/** Newcomers and what they carry.
 *
 *  Immigrants come from somewhere, and what they pack for the road says where: biscuit and dried peas
 *  from farmland, smoked fish and salt from the coast, hard cheese from the pastures, honey from the
 *  meadows. Each group brings three days of food, so a crowd arriving never empties the stores at once.
 *
 *  They come twice: all at once in the one-time update that counts people one by one (CITY_FROM), and
 *  after each winter, as many as the village has room and morale for. Each arrival is kept as a note
 *  (Village.arrivals) that the player is shown and can read again.
 *
 *  Chosen from the full list of travel foods (all medieval, all keeping a month on the road):
 *  biscuit, seed grain, dried peas, hard cheese, smoked fish, honey and salt. Left out for now:
 *  salt pork and beef, stockfish and herring, dried fruit, nuts, pickles, onions, ale and wine (ale
 *  would spoil on the way), chickens and goats (live animals that would turn into production). */
import { hashString } from '../world/rng'
import { EAT, FOOD, type Good, type Goods } from './data'

/** Days of food each newcomer arrives with. */
export const TRAVEL_DAYS = 3

export interface Origin {
  id: string
  /** "a farming valley" */
  name: string
  /** the share of their food (by worth) in each kind */
  foods: [Good, number][]
  /** what else they pack, per person (not food: salt to keep it) */
  extra?: Goods
  /** a line about the journey */
  blurb: string
}

export const ORIGINS: Origin[] = [
  { id: 'farmland', name: 'a farming valley', foods: [['biscuit', 0.4], ['dried_peas', 0.3], ['grain', 0.3]], blurb: 'Twice-baked biscuit, dried peas, and a sack of seed grain to sow.' },
  { id: 'coast', name: 'the fishing coast', foods: [['smoked_fish', 0.5], ['biscuit', 0.3], ['dried_peas', 0.2]], extra: { salt: 4.5 }, blurb: 'Smoked fish and biscuit, with salt to keep it.' },
  { id: 'pasture', name: 'the high pastures', foods: [['cheese', 0.5], ['biscuit', 0.3], ['grain', 0.2]], extra: { salt: 2.25 }, blurb: 'Wheels of hard cheese, biscuit and a little seed grain.' },
  { id: 'meadow', name: "the beekeepers' meadows", foods: [['honey', 0.25], ['dried_peas', 0.35], ['cheese', 0.4]], blurb: 'Honey, dried peas and hard cheese.' },
]

/** Which place a group comes from: the same for the same village on the same day. */
export function originFor(seed: string): Origin {
  return ORIGINS[hashString(seed) % ORIGINS.length]
}

const round2 = (x: number) => Math.round(x * 100) / 100

/** What `people` newcomers carry: TRAVEL_DAYS days of food between them, in their home foods. */
export function travelFood(people: number, origin: Origin): Goods {
  const budget = people * EAT * TRAVEL_DAYS
  const out: Goods = {}
  for (const [g, share] of origin.foods) out[g] = round2((budget * share) / FOOD[g]!.value)
  for (const [g, each] of Object.entries(origin.extra ?? {})) out[g as Good] = round2((each ?? 0) * people)
  return out
}

/** How many come after a winter: a fifth of the village again, as many as it has room for, and none
 *  if morale is too low for newcomers to want to stay or there is no room. */
export function influx(population: number, room: number, morale: number, minMorale: number): number {
  if (morale < minMorale || room < 1) return 0
  return Math.min(Math.floor(room), Math.max(1, Math.round(population * 0.2)))
}
