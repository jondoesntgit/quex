/** How well each village role suits a spot, judged by what is within reach
 *  (3 hexes: the village's land plus room to grow), not by the centre hex. */
import { distance, spiral } from '../world/hex'
import { hasTrees, MOUNTAIN_TERRAIN } from '../world/land'
import type { Role, World } from '../world/types'
import { cellIndex, effectiveTerrain, landAt } from './reducer'
import type { GameState } from './types'

export const REACH = 3
export type Fit = 'great' | 'good' | 'ok'

/** Raw suitability points per role, plus the strongest reason for each. */
export function roleScores(world: World, s: GameState, at: { col: number; row: number }) {
  const n = {
    farmland: 0, pasture: 0, hills: 0, mountain: 0, forest: 0, coast: 0, beach: 0, river: 0,
    grain: 0, berries: 0, fish: 0, salt: 0, wool: 0, stone: 0, clay: 0, ore: 0, timber: 0, game: 0,
  }
  for (const o of spiral(at, REACH)) {
    if (o.col === at.col && o.row === at.row) continue
    if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) continue
    const i = cellIndex(world, o.col, o.row)
    const c = world.cells[i]
    if (c.tier === 0) continue
    const land = landAt(world, s, i)
    const t = land.terrain
    if (c.riverTo !== -1) n.river++
    if (MOUNTAIN_TERRAIN.includes(t)) n.mountain++
    else if (t === 'hills') n.hills++
    if (hasTrees(land)) n.forest++
    if (t === 'grass' || t === 'meadow' || t === 'savannah') n.farmland++
    if (t === 'meadow' || t === 'hills') n.pasture++
    if (t === 'beach' || t === 'desert') n.beach++
    const sea = spiral(o, 1).some((q) => world.cells[cellIndex(world, q.col, q.row)]?.tier === 0 &&
      ['shallow', 'ocean', 'deep'].includes(effectiveTerrain(world, s, cellIndex(world, q.col, q.row))))
    if (sea) n.coast++
    switch (land.resource) {
      case 'grain': n.grain++; break
      case 'berries': n.berries++; break
      case 'fish': n.fish++; break
      case 'salt': n.salt++; break
      case 'wool': n.wool++; break
      case 'stone': n.stone++; break
      case 'clay': n.clay++; break
      case 'copper': case 'iron': case 'tin': n.ore++; break
      case 'timber': n.timber++; break
      case 'game': n.game++; break
    }
  }
  const cell = world.cells[cellIndex(world, at.col, at.row)]
  const danger = world.regions[cell?.region ?? 0]?.danger ?? 0
  const others = Object.values(s.villages).map((v) => distance(v, at))
  const nearest = others.length ? Math.min(...others) : 99
  const lairs = s.lairs.filter((l) => !l.cleared && distance(l, at) <= 8).length

  const why = (pairs: [number, string][]) => pairs.filter(([k]) => k > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, w]) => w).join(', ') || 'little nearby'
  return {
    farm: { score: n.farmland + n.river * 1.5 + (n.grain + n.berries) * 3,
      why: why([[n.farmland, 'open fields'], [n.river * 1.5, 'river water'], [(n.grain + n.berries) * 3, 'wild grain and fruit']]) },
    port: { score: n.coast ? n.coast * 1.5 + (n.fish + n.salt) * 3 + n.beach + n.river * 0.5 : 0,
      why: n.coast ? why([[n.coast * 1.5, 'a long coastline'], [(n.fish + n.salt) * 3, 'fish and salt'], [n.beach, 'beaches for salt pans']]) : 'no coast nearby' },
    mining: { score: n.mountain * 2 + n.hills + (n.stone + n.clay) * 2 + n.ore * 4,
      why: why([[n.mountain * 2, 'mountains'], [n.hills, 'hills to quarry'], [n.ore * 4, 'copper and iron ore'], [(n.stone + n.clay) * 2, 'stone and clay']]) },
    forestry: { score: n.forest * 1.5 + (n.timber + n.game) * 2,
      why: why([[n.forest * 1.5, 'woodland'], [(n.timber + n.game) * 2, 'timber and game']]) },
    herding: { score: n.pasture * 1.5 + (n.farmland - n.pasture) * 0.5 + n.wool * 3,
      why: why([[n.pasture * 1.5, 'hills and meadows'], [n.wool * 3, 'wild sheep'], [(n.farmland - n.pasture) * 0.5, 'grazing land']]) },
    explorer: { score: danger * 3 + Math.min(nearest, 20) * 0.3 + lairs * 1.5,
      why: why([[danger * 3, 'the frontier'], [lairs * 1.5, 'monster lairs to clear'], [Math.min(nearest, 20) * 0.3, 'far from neighbours']]) },
  } satisfies Record<Role, { score: number; why: string }>
}

/** Score thresholds for ★★ / ★, calibrated so a typical site has a couple of
 *  good options (see scripts/calibrate-sites.ts). */
export const THRESHOLDS: Record<Role, [great: number, good: number]> = {
  farm: [40, 25], port: [17, 7], mining: [20, 8], forestry: [25, 12], herding: [38, 24], explorer: [15, 12],
}

export function roleFits(world: World, s: GameState, at: { col: number; row: number }): Record<Role, { fit: Fit; why: string; score: number }> {
  const sc = roleScores(world, s, at)
  const out = {} as Record<Role, { fit: Fit; why: string; score: number }>
  for (const r of Object.keys(sc) as Role[]) {
    const [great, good] = THRESHOLDS[r]
    out[r] = { ...sc[r], fit: sc[r].score >= great ? 'great' : sc[r].score >= good ? 'good' : 'ok' }
  }
  return out
}
