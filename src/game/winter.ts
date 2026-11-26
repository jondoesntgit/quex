/** Winter prep: what a village needs before Saturday's winter, what's still
 *  missing, and what finishing real-life tasks would do about it. Pure, read
 *  only: it mirrors the nightly tick's rules (see tick() in reducer.ts). */
import { BUILDINGS, producesIn, EAT, FOOD, FOOD_SCALE, type BuildingId, type Good, type TaskSize } from './data'
import { CROP_SEASON, weekday, weekSeason } from './calendar'
import { defence, fieldRain, foodStock, storageCap } from './reducer'
import { people } from './workers'
import type { ISODate, Village } from './types'

export interface PrepItem {
  id: 'food' | 'storage' | 'defence' | 'variety'
  ok: boolean
  title: string
  /** where things stand, in numbers */
  status: string
  /** what happens in winter if this isn't done */
  impact: string
  /** suggested things to do, each tied to the size of task that pays for it */
  todo: { size: TaskSize; text: string }[]
}

export interface WinterPrep {
  /** days until Saturday (0 = it's winter today) */
  days: number
  /** food the village eats in winter, and what counts as "stocked" */
  need: number
  target: number
  /** food that keeps (grain, smoked fish, cheese) in store now */
  keeps: number
  /** live forecast (the village's own is only updated on Thursday and Friday nights) */
  forecast: 'stocked' | 'tight' | 'hungry'
  /** keeping food the village's buildings should make tonight: at today's score so far, and with every task done */
  tonight: { now: number; full: number }
  items: PrepItem[]
}

const KEEPS = (Object.entries(FOOD) as [Good, { keeps: boolean }][]).filter(([, f]) => f.keeps).map(([g]) => g)
const r1 = (n: number) => Math.round(n * 10) / 10

/** Buildings that make food that keeps through winter. */
const KEEPERS: BuildingId[] = (Object.keys(BUILDINGS) as BuildingId[]).filter((id) => {
  const d = BUILDINGS[id]
  return [d.produces, ...Object.values(d.seasonal ?? {})].some((p) => !!p && Object.keys(p).some((g) => KEEPS.includes(g as Good)))
})

/** Keeping food made tonight at a given score (0-100), following the tick's production rules. */
function keepsMade(v: Village, date: ISODate, score: number): number {
  const season = weekSeason(date)
  if (season === 'winter') return 0
  const prod = 0.15 + 0.85 * (score / 100)
  const moraleK = 0.75 + v.morale / 200
  let t = 0
  for (const b of v.buildings) {
    if (b.progress < 1) continue
    const def = BUILDINGS[b.type]
    const yields = producesIn(def, season)
    if (!yields) continue
    if (def.harvest && season !== 'autumn') continue
    let k = prod * moraleK
    if (def.harvest) k *= (0.25 + 0.75 * (b.sown ?? 1)) * fieldRain(b)
    else if (def.crop) k *= CROP_SEASON[season]
    for (const [g, n] of Object.entries(yields)) {
      const f = FOOD[g as Good]
      if (f?.keeps) t += (n ?? 0) * k * f.value
    }
  }
  return t
}

export function winterPrep(v: Village, today: ISODate, score: number): WinterPrep {
  const days = (6 - weekday(today) + 7) % 7
  const need = people(v) * EAT
  const target = need * 1.5
  const keeps = foodStock(v, true)
  const tonight = { now: keepsMade(v, today, score), full: keepsMade(v, today, 100) }
  const has = (id: BuildingId) => v.buildings.some((b) => b.type === id)
  const items: PrepItem[] = []

  // 1. food that keeps
  const foodTodo: PrepItem['todo'] = []
  if (tonight.full > 0.05 && days > 0) {
    foodTodo.push({ size: 'big', text: `Finish today's tasks: your buildings make about ${r1(tonight.full)} food that keeps tonight with a full day (${r1(tonight.now)} at your score so far).` })
  }
  const next = KEEPERS.find((id) => !has(id))
  if (next) {
    const def = BUILDINGS[next]
    foodTodo.push({ size: def.size, text: `Build a ${def.name}: ${def.blurb}` })
  }
  foodTodo.push({ size: 'small', text: 'Gather grain where it grows on your land: +3 grain for each small task.' })
  foodTodo.push({ size: 'medium', text: "A neighbour's caravan (one of their medium tasks) can bring grain, smoked fish or cheese: ask them." })
  items.push({
    id: 'food',
    ok: keeps >= target,
    title: 'Stock food that keeps',
    status: `${r1(keeps)} of ${r1(target)} in store (grain, smoked fish, cheese). Your ${people(v)} villagers at home eat ${r1(need)} on Saturday.`,
    impact: keeps >= need
      ? 'Enough to get through, but with little to spare. Fresh food (fish, bread, berries, game) loses 30% every night, so it can\'t be counted on.'
      : 'If the stores run out on Saturday, morale drops by 12 and a family may leave.',
    todo: keeps >= target ? [] : foodTodo,
  })

  // 2. room to store it
  const cap = storageCap(v)
  const stock = foodStock(v)
  const room = stock + tonight.full * Math.max(1, Math.min(days, 2)) <= cap
  items.push({
    id: 'storage',
    ok: room,
    title: 'Room to store it',
    status: `${Math.round(stock)} of ${cap} storage used.`,
    impact: 'Food beyond what you can store rots overnight.',
    todo: room ? [] : [{ size: BUILDINGS.granary.size, text: `Build a Granary: +${BUILDINGS.granary.storage! * FOOD_SCALE} storage (${costText(BUILDINGS.granary.cost)}).` }],
  })

  // 3. defence: hungry villages draw raids in winter
  const def = defence(v)
  const hungry = keeps < need
  items.push({
    id: 'defence',
    ok: !hungry || has('palisade'),
    title: 'Guard the stores',
    status: `Defence ${def}.${hungry ? ' Your stores look thin, and monsters can tell.' : ''}`,
    impact: 'Monster lairs raid hungry villages 50% more often in winter, and each raid takes a fifth of one of your goods.',
    todo: !hungry || has('palisade') ? [] : [{ size: BUILDINGS.palisade.size, text: `Build a Palisade: +${BUILDINGS.palisade.defence} defence (${costText(BUILDINGS.palisade.cost)}).` }],
  })

  // 4. variety keeps spirits up (the tick: morale target + (kinds eaten - 2) * 3, so 2 is even, 3+ lifts)
  const kinds = (Object.keys(FOOD) as Good[]).filter((g) => (v.goods[g] ?? 0) >= 0.5)
  const missing = (['fish', 'game', 'berries'] as Good[]).filter((g) => !kinds.includes(g))
  const fresh = kinds.filter((g) => !FOOD[g]?.keeps)
  const list = kinds.map(goodName).join(' and ')
  items.push({
    id: 'variety',
    ok: kinds.length >= 3,
    title: 'A varied larder',
    status: kinds.length
      ? `${kinds.length} kind${kinds.length === 1 ? '' : 's'} of food in store: ${list}.${kinds.length === 2 ? ' That\'s enough to keep spirits even; a third kind lifts them.' : ''}`
      : 'No food in store.',
    impact: `Villagers eat a little of each food they have. Three or more kinds lifts morale (+3 for each kind past two), one kind lowers it, and morale drives how much your buildings make.${fresh.length ? ` Fresh food (${fresh.map(goodName).join(', ')}) loses 30% a night, so gather it close to Saturday.` : ''}`,
    todo: kinds.length >= 3 ? [] : [{ size: 'small', text: `Gather ${missing.length ? missing.map(goodName).join(', ').replace(/, ([^,]*)$/, ' or $1') : 'another food'} on your land (small tasks) for a ${kinds.length === 2 ? 'third' : 'new'} kind of food.` }],
  })

  const forecast = keeps >= target ? 'stocked' : keeps >= need ? 'tight' : 'hungry'
  return { days, need, target, keeps, forecast, tonight, items }
}

function goodName(g: Good) { return g.replace('_', ' ') }

function costText(c: Partial<Record<Good, number>>) {
  return Object.entries(c).map(([g, n]) => `${n} ${g.replace('_', ' ')}`).join(', ')
}
