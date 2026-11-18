/** Print the spread of role scores over every legal village site, to set
 *  THRESHOLDS in src/game/sites.ts.   npx tsx scripts/calibrate-sites.ts */
import { generateWorld } from '../src/world/generate'
import { newGame, foundingProblem } from '../src/game/reducer'
import { roleFits, roleScores } from '../src/game/sites'
import { ROLES } from '../src/world/types'

const pct = (xs: number[], p: number) => xs[Math.floor((xs.length - 1) * p)]
for (const seed of ['quex-season-1', 'test-seed', 'alpha']) {
  const world = generateWorld(seed)
  const s = newGame(world, '2026-11-15')
  const sites = world.cells.filter((c) => !foundingProblem(s, world, c))
  const by: Record<string, number[]> = Object.fromEntries(ROLES.map((r) => [r, []]))
  const stars: number[] = []
  for (const c of sites) {
    const sc = roleScores(world, s, c)
    for (const r of ROLES) by[r].push(sc[r].score)
    const f = roleFits(world, s, c)
    stars.push(ROLES.filter((r) => f[r].fit !== 'ok').length)
  }
  console.log(`\n${seed}: ${sites.length} legal sites`)
  for (const r of ROLES) {
    const xs = by[r].sort((a, b) => a - b)
    console.log(r.padEnd(9), 'p25', pct(xs, 0.25).toFixed(1), 'p50', pct(xs, 0.5).toFixed(1), 'p75', pct(xs, 0.75).toFixed(1), 'p90', pct(xs, 0.9).toFixed(1))
  }
  const hist = [0, 1, 2, 3, 4, 5, 6].map((k) => stars.filter((x) => x === k).length)
  console.log('roles with a star per site (0..6):', hist.join(' '))
}
