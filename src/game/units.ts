/** How amounts are shown to players. Weights are in pounds; a wagon load is WAGON_LB. Food is counted in
 *  rations (one person's food for a day) however the stores hold it; everything else bulk is in wagon loads. */
import { FOOD, isBulk, type Good } from './data'
import { WAGON_LB } from './market'
import { shown } from './amount'

const n1 = (x: number) => Math.round(x * 10) / 10
/** "1,200 lb (1.2 wagon loads)". */
export function fmtLb(lb: number): string {
  const l = Math.round(lb)
  return `${l.toLocaleString('en-US')} lb${l >= WAGON_LB / 2 ? ` (${n1(l / WAGON_LB)} wagon load${n1(l / WAGON_LB) === 1 ? '' : 's'})` : ''}`
}
/** How many units a stepper moves at a time: goods counted in rations go by tens (salt, by hundreds). */
export const stepOf = (g: Good) => (g === 'salt' ? 100 : FOOD[g]?.value === 1 ? 10 : 1)
/** Rations in `n` units of a food (or n itself for a good that isn't food). */
export const rationsOf = (g: Good, n: number) => n * (FOOD[g]?.value ?? 1)
export { shown } from './amount'
/** The step a good is shown in: food in whole rations, bulk goods in tenths of a load, everything else whole pieces. */
export const stepFor = (g: Good) => (FOOD[g] ? 1 : isBulk(g) ? 0.1 : 1)
/** A stored amount in the units it's shown in (rations for food), rounded down: see shown. */
export const shownStock = (g: Good, n: number) => shown(rationsOf(g, n), stepFor(g))
/** An amount of one good: food in rations, bulk in loads. */
export function fmtAmount(g: Good, n: number): string {
  if (FOOD[g]) return `${shownStock(g, n)} rations`
  return `${shownStock(g, n)}${isBulk(g) ? ' loads' : ''}`
}
