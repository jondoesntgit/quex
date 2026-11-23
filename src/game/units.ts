/** How amounts are shown to players. Weights are in pounds; a wagon load is WAGON_LB. Food is counted in
 *  rations (one person's food for a day) however the stores hold it; everything else bulk is in wagon loads. */
import { FOOD, isBulk, type Good } from './data'
import { WAGON_LB } from './market'

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
/** An amount of one good: food in rations, bulk in loads. */
export function fmtAmount(g: Good, n: number): string {
  if (FOOD[g]) return `${Math.round(rationsOf(g, n))} rations`
  return `${n1(n)}${isBulk(g) ? ' loads' : ''}`
}
