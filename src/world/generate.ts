/** Seeded world generation.
 *
 *  World = grid of regions (default 4x4 regions of 32x32 hexes = 128x128).
 *  One region is chosen as the starter region for a 2-4 player party; the
 *  rest is a stubbed frontier whose danger rises with distance.
 *
 *  Pipeline: elevation -> sea level -> tiers -> moisture -> rivers ->
 *  temperature -> biomes/features -> resources -> regions/sites -> lairs.
 */
import { fbm, simplex2 } from './noise'
import { hashString, rngFor, type Rng } from './rng'
import { distance, neighbours } from './hex'
import type { Cell, Lair, Region, Resource, Role, Terrain, VillageSite, World } from './types'

export interface GenOptions {
  regionsX?: number
  regionsY?: number
  regionSize?: number
  /** target fraction of land cells */
  landFraction?: number
}

const TIER_QUANTILES = [0.38, 0.63, 0.8, 0.91, 0.97] // land elevation quantiles -> tiers 2..6

export function generateWorld(seed: string, opts: GenOptions = {}): World {
  const RX = opts.regionsX ?? 4
  const RY = opts.regionsY ?? 4
  const RS = opts.regionSize ?? 32
  const W = RX * RS
  const H = RY * RS
  const landTarget = opts.landFraction ?? 0.5
  const base = hashString(seed)
  const nElev = simplex2(base ^ 0x1111)
  const nDetail = simplex2(base ^ 0x2222)
  const nMoist = simplex2(base ^ 0x3333)
  const nTemp = simplex2(base ^ 0x4444)
  const nVeinCu = simplex2(base ^ 0x5555)
  const nVeinFe = simplex2(base ^ 0x6666)
  const rng = rngFor(seed, 'world')

  const idx = (c: number, r: number) => r * W + c
  const inb = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H
  const nbrs = (i: number) =>
    neighbours(i % W, Math.floor(i / W)).filter(([c, r]) => inb(c, r)).map(([c, r]) => idx(c, r))

  // ---------------------------------------------------------------- elevation
  const cells: Cell[] = new Array(W * H)
  const elevs = new Float64Array(W * H)
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      // isotropic coordinates for flat-top hexes
      const x = c * 0.866
      const y = r + (c & 1 ? 0.5 : 0)
      const cont = fbm(nElev, x / 48, y / 48, 3)
      const detail = fbm(nDetail, x / 12, y / 12, 4)
      // ocean border: fade elevation near the world edge
      const ex = Math.min(c, W - 1 - c) / (W * 0.12)
      const ey = Math.min(r, H - 1 - r) / (H * 0.12)
      const edge = Math.min(1, ex, ey)
      const e = (0.62 * cont + 0.38 * detail) * 0.5 + 0.5
      elevs[idx(c, r)] = e * (0.35 + 0.65 * edge)
    }
  }
  const sorted = Array.from(elevs).sort((a, b) => a - b)
  const seaLevel = sorted[Math.floor(sorted.length * (1 - landTarget))]
  const landSorted = sorted.filter((e) => e > seaLevel)
  const tierCuts = TIER_QUANTILES.map((q) => landSorted[Math.floor(landSorted.length * q)] ?? 1)

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = idx(c, r)
      const e = elevs[i]
      let tier = 0
      if (e > seaLevel) {
        tier = 1
        for (const cut of tierCuts) if (e > cut) tier++
      }
      cells[i] = {
        col: c, row: r, elev: e, tier, moist: 0, temp: 0,
        terrain: tier === 0 ? 'ocean' : 'grass', feature: null, resource: null,
        riverTo: -1, riverFlow: 0,
        region: Math.floor(r / RS) * RX + Math.floor(c / RS),
      }
    }
  }
  const isWater = (i: number) => cells[i].tier === 0

  // distance to water (BFS) for moisture + ocean depth
  const distWater = bfsDistance(cells.length, (i) => isWater(i), nbrs)
  const distLand = bfsDistance(cells.length, (i) => !isWater(i), nbrs)

  // ---------------------------------------------------------------- moisture
  for (const cell of cells) {
    const x = cell.col * 0.866, y = cell.row
    const m = fbm(nMoist, x / 20, y / 20, 3) * 0.5 + 0.5
    const coast = Math.max(0, 1 - distWater[idx(cell.col, cell.row)] / 8)
    cell.moist = clamp01(m * 0.8 + coast * 0.3 - (cell.tier - 1) * 0.03)
  }

  // ---------------------------------------------------------------- rivers
  const landIdx = cells.map((_, i) => i).filter((i) => !isWater(i))
  const sources = landIdx.filter((i) => cells[i].tier >= 4 && cells[i].moist > 0.4)
  const wantRivers = Math.max(3, Math.round(landIdx.length / 140))
  shuffleInPlace(rng, sources)
  let made = 0
  for (const s of sources) {
    if (made >= wantRivers) break
    if (cells[s].riverTo !== -1 || cells[s].riverFlow > 0) continue
    // keep sources apart
    if (nbrs(s).some((n) => cells[n].riverTo !== -1)) continue
    const path = traceRiver(s)
    if (!path) continue
    for (let k = 0; k < path.length - 1; k++) {
      cells[path[k]].riverTo = path[k + 1]
    }
    // accumulate flow downstream (including into existing rivers)
    let cur = s, flow = 1, guard = 0
    while (cur !== -1 && guard++ < 500) {
      cells[cur].riverFlow += flow
      flow++
      if (isWater(cur)) break
      cur = cells[cur].riverTo
    }
    made++
  }

  function traceRiver(start: number): number[] | null {
    const path = [start]
    const seen = new Set([start])
    let cur = start
    for (let step = 0; step < 160; step++) {
      const ns = nbrs(cur).filter((n) => !seen.has(n))
      if (!ns.length) return null
      // water neighbour? finish at the sea
      const sea = ns.find((n) => isWater(n))
      if (sea !== undefined) {
        path.push(sea)
        return path
      }
      // joining an existing river finishes too
      const join = ns.find((n) => cells[n].riverTo !== -1 && cells[n].tier <= cells[cur].tier)
      if (join !== undefined && step > 1) {
        path.push(join)
        return path
      }
      ns.sort((a, b) => cells[a].elev - cells[b].elev)
      const next = ns[0]
      if (cells[next].tier > cells[cur].tier) return null // would flow uphill a whole tier
      path.push(next)
      seen.add(next)
      cur = next
    }
    return null
  }
  const nearRiver = bfsDistance(cells.length, (i) => cells[i].riverTo !== -1 && !isWater(i), nbrs)
  for (const i of landIdx) {
    if (nearRiver[i] <= 2) cells[i].moist = clamp01(cells[i].moist + (nearRiver[i] === 0 ? 0.2 : 0.1))
  }

  // ---------------------------------------------------------------- temperature
  for (const cell of cells) {
    const lat = cell.row / (H - 1) // 0 = north (cold) .. 1 = south (warm)
    const n = fbm(nTemp, cell.col / 30, cell.row / 30, 2)
    cell.temp = clamp01(0.12 + 0.75 * lat + 0.18 * n - 0.06 * Math.max(0, cell.tier - 1))
  }

  // ---------------------------------------------------------------- biomes
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    if (isWater(i)) {
      const d = distLand[i]
      cell.terrain = d <= 1 ? 'shallow' : d <= 3 ? 'ocean' : 'deep'
      continue
    }
    const { tier, moist: m, temp: t } = cell
    const coastal = nbrs(i).some((n) => isWater(n))
    const river = cell.riverTo !== -1
    const r = rng()
    let terr: Terrain = 'grass'
    let feat: Cell['feature'] = null
    if (tier >= 6) {
      terr = 'rock'
      feat = t < 0.5 ? 'mountain_snow' : 'mountain'
    } else if (tier === 5 && m < 0.62) {
      terr = r < 0.55 ? 'rock' : 'hills'
      feat = terr === 'rock' ? (t < 0.4 ? 'mountain_snow' : 'mountain') : 'hills'
    } else if (t < 0.18) {
      terr = 'snow'
    } else if (t < 0.3) {
      terr = 'tundra'
      if (m > 0.55) feat = r < 0.5 ? 'pine1' : 'pine3'
    } else if (tier === 1 && coastal && !river && m < 0.7 && r < 0.65) {
      terr = 'beach'
    } else if (tier <= 2 && m > 0.78) {
      terr = 'swamp'
      feat = 'reeds'
    } else if (m > 0.6) {
      terr = 'forest'
      const pine = t < 0.5
      feat = m > 0.75 ? (pine ? 'pine5' : 'oak5') : (pine ? 'pine3' : 'oak3')
    } else if (t > 0.7 && m < 0.3) {
      terr = 'desert'
      if (r < 0.15) feat = 'cactus'
    } else if (t > 0.62 && m < 0.48) {
      terr = 'savannah'
      if (r < 0.1) feat = 'oak1'
    } else if (tier >= 4) {
      terr = 'hills'
      feat = 'hills'
    } else {
      terr = m > 0.47 ? 'meadow' : 'grass'
      if (r < 0.08) feat = 'oak1'
    }
    cell.terrain = terr
    cell.feature = feat
  }

  // ---------------------------------------------------------------- resources
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const r = rng()
    const ns = nbrs(i)
    const veinCu = nVeinCu(cell.col / 6, cell.row / 6)
    const veinFe = nVeinFe(cell.col / 6, cell.row / 6)
    let res: Resource | null = null
    switch (cell.terrain) {
      case 'shallow':
        if (ns.some((n) => !isWater(n)) && r < 0.35) res = 'fish'
        break
      case 'ocean':
        if (r < 0.06) res = 'fish'
        break
      case 'rock':
        res = veinCu > 0.45 ? 'copper' : veinFe > 0.4 ? 'iron' : 'stone'
        break
      case 'hills':
        res = veinCu > 0.5 ? 'copper' : veinFe > 0.45 ? 'iron' : r < 0.3 ? 'stone' : r < 0.55 ? 'wool' : null
        break
      case 'forest':
        res = r < 0.6 ? 'timber' : r < 0.75 ? 'game' : ns.some((n) => cells[n].terrain !== 'forest') && r < 0.9 ? 'berries' : null
        break
      case 'swamp':
        res = r < 0.5 ? 'herbs' : null
        break
      case 'beach':
        res = r < 0.3 && ns.some((n) => cells[n].terrain === 'shallow') ? 'salt' : null
        break
      case 'desert':
        res = r < 0.08 ? 'salt' : null
        break
      case 'grass':
      case 'meadow':
        res = r < (nearRiver[i] <= 2 ? 0.45 : 0.18) ? 'grain' : r < 0.6 && cell.terrain === 'meadow' ? 'wool' : null
        break
      case 'savannah':
        res = r < 0.25 ? 'wool' : r < 0.35 ? 'game' : null
        break
      case 'tundra':
        res = r < 0.15 ? 'game' : null
        break
      default:
        break
    }
    // riverbank clay overrides weak claims in the lowlands
    if (!isWater(i) && cell.tier <= 2 && nearRiver[i] <= 1 && (res === null || res === 'grain') && r > 0.55) {
      res = 'clay'
    }
    cell.resource = res
  }

  // ---------------------------------------------------------------- regions
  const regions: Region[] = []
  const nameRng = rngFor(seed, 'names')
  for (let ry = 0; ry < RY; ry++) {
    for (let rx = 0; rx < RX; rx++) {
      const col0 = rx * RS, row0 = ry * RS
      let land = 0
      for (let r = row0; r < row0 + RS; r++) for (let c = col0; c < col0 + RS; c++) if (!isWater(idx(c, r))) land++
      const region: Region = {
        id: ry * RX + rx, rx, ry, name: regionName(nameRng),
        col0, row0, col1: col0 + RS, row1: row0 + RS,
        land: land / (RS * RS), danger: 0, sites: [],
      }
      region.sites = pickSites(cells, region, W, nbrs, isWater)
      regions.push(region)
    }
  }

  // starter: plenty of land, all core roles present, not at the world edge if possible
  const startScore = (rg: Region) => {
    const roles = new Set(rg.sites.map((s) => s.role))
    const landOk = rg.land > 0.35 && rg.land < 0.85 ? 1 : 0.3
    const edge = rg.rx === 0 || rg.ry === 0 || rg.rx === RX - 1 || rg.ry === RY - 1 ? 0.8 : 1
    return roles.size * 10 * landOk * edge + rg.sites.reduce((a, s) => a + s.score, 0) * 0.05
  }
  const startRegion = regions.reduce((best, rg) => (startScore(rg) > startScore(best) ? rg : best), regions[0]).id
  const sr = regions[startRegion]
  for (const rg of regions) rg.danger = Math.max(Math.abs(rg.rx - sr.rx), Math.abs(rg.ry - sr.ry))

  // tin: rare, frontier mountains only (danger >= 2)
  for (const cell of cells) {
    if (cell.terrain === 'rock' && regions[cell.region].danger >= 2 && rng() < 0.05) cell.resource = 'tin'
  }

  // ---------------------------------------------------------------- lairs
  const lairs: Lair[] = []
  const starterSites = sr.sites
  for (const rg of regions) {
    const want = Math.round((1 + rg.danger) * rg.land * 3)
    const spots: number[] = []
    for (let r = rg.row0 + 2; r < rg.row1 - 2; r++) {
      for (let c = rg.col0 + 2; c < rg.col1 - 2; c++) {
        const i = idx(c, r)
        const t = cells[i].terrain
        if (t !== 'forest' && t !== 'hills' && t !== 'rock' && t !== 'swamp' && t !== 'tundra') continue
        if (starterSites.some((s) => distance(s, cells[i]) < 6)) continue
        spots.push(i)
      }
    }
    shuffleInPlace(rng, spots)
    const placed: number[] = []
    for (const i of spots) {
      if (placed.length >= want) break
      if (placed.some((j) => distance(cells[i], cells[j]) < 5)) continue
      placed.push(i)
      const d = rg.danger
      const kind: Lair['kind'] =
        d >= 3 && cells[i].terrain === 'rock' ? 'dragon' : d >= 2 ? 'trolls' : d >= 1 ? 'orcs' : 'goblins'
      lairs.push({ col: cells[i].col, row: cells[i].row, kind, strength: Math.round(5 * (1 + d * 1.5) * (0.8 + 0.4 * rng())) })
    }
  }

  return { seed, width: W, height: H, regionSize: RS, seaLevel, cells, regions, startRegion, lairs }
}

// ------------------------------------------------------------------ sites

const ROLE_ORDER: Role[] = ['port', 'mining', 'forestry', 'farm', 'herding', 'explorer']

function pickSites(
  cells: Cell[], rg: Region, W: number,
  nbrs: (i: number) => number[], isWater: (i: number) => boolean,
): VillageSite[] {
  const idx = (c: number, r: number) => r * W + c
  const margin = 3
  const cand: number[] = []
  for (let r = rg.row0 + margin; r < rg.row1 - margin; r++) {
    for (let c = rg.col0 + margin; c < rg.col1 - margin; c++) {
      const i = idx(c, r)
      const cell = cells[i]
      if (isWater(i) || cell.tier >= 6 || cell.terrain === 'rock' || cell.terrain === 'swamp' || cell.terrain === 'snow') continue
      cand.push(i)
    }
  }
  const ring = (i: number, rad: number) => {
    const out: number[] = []
    const seen = new Set([i])
    let frontier = [i]
    for (let d = 0; d < rad; d++) {
      const next: number[] = []
      for (const f of frontier) for (const n of nbrs(f)) if (!seen.has(n)) { seen.add(n); next.push(n); out.push(n) }
      frontier = next
    }
    return out
  }
  const centre = { col: (rg.col0 + rg.col1) / 2, row: (rg.row0 + rg.row1) / 2 }
  const score = (role: Role, i: number): number => {
    const cell = cells[i]
    const near = ring(i, 2)
    const count = (f: (c: Cell, j: number) => boolean) => near.filter((j) => f(cells[j], j)).length
    const res = (r: Resource) => count((c) => c.resource === r)
    switch (role) {
      case 'port': {
        if (cell.tier > 1 || !nbrs(i).some((n) => isWater(n))) return 0
        const mouth = cell.riverTo !== -1 && isWater(cell.riverTo) ? 8 : 0
        return mouth + res('fish') * 2 + count((_, j) => isWater(j)) * 0.4 + res('salt')
      }
      case 'mining':
        if (cell.terrain === 'forest') return 0
        return res('copper') * 3 + res('iron') * 3 + res('stone') * 1.5 + count((c) => c.terrain === 'rock') * 0.5
      case 'forestry':
        return res('timber') * 2 + res('game') + count((c) => c.terrain === 'forest') * 0.8
      case 'farm':
        if (cell.terrain !== 'grass' && cell.terrain !== 'meadow') return 0
        return res('grain') * 3 + res('clay') + (cell.riverTo !== -1 ? 4 : 0) + count((c) => c.terrain === 'grass' || c.terrain === 'meadow') * 0.4
      case 'herding':
        return res('wool') * 3 + count((c) => c.terrain === 'hills' || c.terrain === 'meadow' || c.terrain === 'savannah') * 0.6
      case 'explorer': {
        // frontier: far from region centre, near rough/unknown land
        const d = distance(cell, { col: Math.round(centre.col), row: Math.round(centre.row) })
        return d * 0.6 + count((c) => c.terrain === 'forest' || c.terrain === 'hills' || c.terrain === 'rock') * 0.3
      }
    }
  }
  const sites: VillageSite[] = []
  for (const role of ROLE_ORDER) {
    let best = -1, bestScore = 0
    for (const i of cand) {
      if (sites.some((s) => distance(s, cells[i]) < 5)) continue
      const s = score(role, i)
      if (s > bestScore) { best = i; bestScore = s }
    }
    if (best >= 0 && bestScore >= 3) {
      sites.push({ role, col: cells[best].col, row: cells[best].row, score: Math.round(bestScore * 10) / 10 })
    }
  }
  return sites
}

// ------------------------------------------------------------------ helpers

function bfsDistance(n: number, isSource: (i: number) => boolean, nbrs: (i: number) => number[]): Int32Array {
  const dist = new Int32Array(n).fill(1 << 20)
  const q: number[] = []
  for (let i = 0; i < n; i++) if (isSource(i)) { dist[i] = 0; q.push(i) }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]
    for (const j of nbrs(i)) if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j) }
  }
  return dist
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function shuffleInPlace<T>(rng: Rng, xs: T[]) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
}

const SYL_A = ['Bal', 'Kor', 'Mer', 'Tal', 'Fen', 'Ash', 'Bry', 'Cal', 'Dun', 'Eld', 'Gar', 'Hol', 'Lin', 'Ost', 'Pel', 'Riv', 'Sel', 'Thorn', 'Wyn', 'Yar']
const SYL_B = ['a', 'e', 'i', 'o', 'u', 'en', 'ar', 'is']
const SYL_C = ['bay', 'dale', 'mere', 'ford', 'holt', 'moor', 'reach', 'wick', 'crag', 'fell', 'marsh', 'vale', 'shire', 'strand']

function regionName(rng: Rng) {
  const a = SYL_A[Math.floor(rng() * SYL_A.length)]
  const b = rng() < 0.5 ? SYL_B[Math.floor(rng() * SYL_B.length)] : ''
  const c = SYL_C[Math.floor(rng() * SYL_C.length)]
  return `${a}${b} ${c[0].toUpperCase()}${c.slice(1)}`
}

export function cellAt(world: World, col: number, row: number): Cell | undefined {
  if (col < 0 || row < 0 || col >= world.width || row >= world.height) return undefined
  return world.cells[row * world.width + col]
}
