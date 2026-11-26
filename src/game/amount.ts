/** How amounts are rounded for showing (no imports, so the rules and the UI can both use it). */

/** Less than this share of the shown step counts as used up (dust left by fractional work, not something you have). */
const DUST = 0.01
/** An amount as shown: rounded down to `step` (never up: you can't spend what you don't have), and never shown as 0
 *  when there's some: what would round down to nothing is either used up (dust, shown 0) or one step. Keeps the sign. */
export function shown(x: number, step = 1): number {
  const a = Math.abs(x)
  const down = Math.floor(a / step + 1e-9) * step
  const v = down > 0 ? down : a < step * DUST ? 0 : step
  const dp = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  return Math.sign(x) * Number(v.toFixed(dp))
}
