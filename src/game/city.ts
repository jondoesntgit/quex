/** The city: a village's cobbled hexes and the homes built on them.
 *
 *  A village starts with a village square (cobbles, a well and three town houses: see townlayout.ts)
 *  and two cobbled hexes beside it. The player lays more cobblestone, next to what's there, and builds
 *  homes on it. A home may stand across the edge between cobbled hexes (but on one level). It fits when
 *
 *   - it lies wholly on cobbles, on one level;
 *   - its real ground footprint (exported from the Blender model) overlaps no other (town houses may
 *     share a wall);
 *   - in the picture it hides no more than a third of any building behind it, nor any door, and no
 *     higher ground in front of it hides it (judged on each sprite's coarse silhouette);
 *   - nothing stands right in front of any door, so every door can be reached;
 *   - and the town stays one walkable place: from the edge of the cobbles a villager can still reach
 *     every home's door and every gate (where the city could grow).
 *
 *  Pure and deterministic, so the server's rules and the player's screen agree. Positions are ground
 *  px from the village hex's centre (screen y is ground y * 0.5774); homes never move once built. */
import sheet from '../../public/art/houses/houses.json'
import { distance, hexToPixel, neighbours, pixelToHex } from '../world/hex'
import { pick01, villageSpots } from '../render/townlayout'
import { hasTrees } from '../world/land'
import type { Cell, World } from '../world/types'
import type { Goods } from './data'
import type { Home, Village } from './types'

export const TW = 64, TP = 8, SQ = 0.5774
const PAD = 0.5
type Pt = [number, number]

export type HomeKind = Home['kind']
export const HOMES: Record<HomeKind, { name: string; size: 'medium' | 'big'; cost: Goods; cap: number; blurb: string }> = {
  cottage: { name: 'Cottage', size: 'medium', cost: { timber: 3, stone: 1 }, cap: 12, blurb: 'A cottage: room for 12 villagers.' },
  townhouse: { name: 'Town house', size: 'big', cost: { timber: 4, planks: 2, stone: 3 }, cap: 24, blurb: 'Two storeys on a narrow plot: room for 24 villagers.' },
}
/** Laying a hex of cobblestone. */
export const COBBLE_COST: Goods = { stone: 4 }
/** The city reaches this many hexes from the village square. */
export const CITY_RADIUS = 2

export const homesCap = (v: Village) => (v.homes ?? []).reduce((a, h) => a + HOMES[h.kind].cap, 0)

// ------------------------------------------------------------------ the ground
const feet = sheet.footprints as Record<string, number[]>
/** A sprite key that's really on the sheet, for this kind of home. */
export const validKey = (kind: HomeKind, key: string) => !!feet[key] && (kind === 'cottage' ? /^c_[SML]_(tile|tile2|thatch|shingle|slate)_[xy]_[01]$/.test(key) : /^t_(tile|tile2|slate|shingle)_y_[012]$/.test(key))

/** Half extents of a building's footprint on the ground (px), a little generous. */
export function dims(key: string): Pt {
  const [x0, x1, y0, y1] = feet[key]
  return [Math.max(-x0, x1) + PAD, Math.max(-y0, y1) + PAD]
}

interface Box { gx: number; gy: number; hx: number; hy: number; key: string; side: 'front' | 'back'; fixed?: boolean }
const overlap = (a: { gx: number; gy: number; hx: number; hy: number }, b: { gx: number; gy: number; hx: number; hy: number }, m: number) =>
  Math.abs(a.gx - b.gx) < a.hx + b.hx + m && Math.abs(a.gy - b.gy) < a.hy + b.hy + m

const origin = (v: Village) => hexToPixel(v.col, v.row, TW)
const idxOf = (world: World, c: { col: number; row: number }) => c.row * world.width + c.col

/** The hex under a ground point (an index), or -1. */
export function hexAt(world: World, v: Village, g: Pt): number {
  const o = origin(v), p = pixelToHex(o.x + g[0], o.y + g[1] * SQ, TW)
  return p.col >= 0 && p.row >= 0 && p.col < world.width && p.row < world.height ? idxOf(world, p) : -1
}
export const tierAt = (world: World, v: Village, g: Pt) => world.cells[hexAt(world, v, g)]?.tier ?? 0
/** The centre of hex i, in ground px from the village hex's centre. */
export function centreOf(world: World, v: Village, i: number): Pt {
  const o = origin(v), c = world.cells[i], q = hexToPixel(c.col, c.row, TW)
  return [q.x - o.x, (q.y - o.y) / SQ]
}

/** Land a city can stand on, at any level (trees come down for it): not water, mountains, rivers, swamp or snow. */
export const paveable = (c: Cell | undefined) => !!c && c.tier > 0 && c.feature !== 'mountain' && c.feature !== 'mountain_snow' && c.riverTo === -1 && !['swamp', 'snow'].includes(c.terrain)

/** The three hexes a new village claims as its city: its own and two beside it that meet at a corner,
 *  open land, nothing built on them (preferring the same level). Fewer if there's no such corner. */
export function claimCity(world: World, v: Village, taken: Set<number>): number[] {
  const home = idxOf(world, v)
  const ns = neighbours(v.col, v.row).map(([c, r]) => (c < 0 || r < 0 || c >= world.width || r >= world.height ? -1 : r * world.width + c))
  const ok = (i: number) => i >= 0 && paveable(world.cells[i]) && !taken.has(i)
  let best: { pair: number[]; score: number } | null = null
  for (let k = 0; k < 6; k++) {
    const a = ns[k], b = ns[(k + 1) % 6]
    if (!ok(a) || !ok(b)) continue
    const tier = world.cells[home].tier
    // the same level, and open ground (a hex of trees has to be felled)
    const open = (i: number) => (world.cells[i].tier === tier ? 1 : 0) + (hasTrees(world.cells[i]) ? 0 : 1)
    const score = open(a) + open(b)
    if (!best || score > best.score) best = { pair: [a, b], score }
  }
  return [home, ...(best?.pair ?? [])]
}

// ------------------------------------------------------------------ what's seen
const maskHex = (sheet as unknown as { masks: Record<string, string> }).masks
const maskCache = new Map<string, Uint8Array>()
/** A sprite's silhouette: 16 x 24 blocks of 4 px, 1 where anything is drawn (from the packed sheet). */
function maskOf(key: string): Uint8Array {
  let m = maskCache.get(key)
  if (!m) {
    m = new Uint8Array(16 * 24)
    const hex = maskHex[key] ?? ''
    for (let c = 0; c < hex.length; c++) { const nib = parseInt(hex[c], 16); for (let b = 0; b < 4; b++) m[c * 4 + b] = (nib >> (3 - b)) & 1 }
    maskCache.set(key, m)
  }
  return m
}
const isHouseKey = (k: string) => /^[cht]_/.test(k)
/** The sprite a building is drawn with: houses turn their door to the back wall on the 'back' side. */
const spriteOf = (b: { key: string; side: 'front' | 'back' }) => b.key + (b.side === 'back' && isHouseKey(b.key) ? '_b' : '')

/** In the picture, no building may hide more than a third of one behind it, nor any of its door. */
function screenOk(world: World, v: Village, c: Box, others: Box[]): boolean {
  const lift = (b: Box) => tierAt(world, v, [b.gx, b.gy]) * TP
  for (const o of others) {
    if (Math.abs(o.gx - c.gx) > 70 || Math.abs(o.gy - c.gy) > 170) continue
    const [front, back] = c.gy + c.hy > o.gy + o.hy ? [c, o] : [o, c]
    const dx = Math.round(front.gx - back.gx), dy = Math.round(front.gy * SQ - lift(front) - (back.gy * SQ - lift(back)))
    if (Math.abs(dx) >= 64 || Math.abs(dy) >= 96) continue
    const mb = maskOf(spriteOf(back)), mf = maskOf(spriteOf(front))
    const sx = Math.round(dx / 4), sy = Math.round(dy / 4)
    const dyp = Math.round(back.hy * SQ), checkDoor = back.side === 'front' && isHouseKey(back.key)
    const doorTop = Math.floor((71 + dyp) / 4), doorBottom = Math.floor((80 + dyp) / 4)
    let hid = 0, all = 0, doorHid = 0
    for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) {
      if (!mb[y * 16 + x]) continue
      all++
      const fx = x - sx, fy = y - sy
      if (fx >= 0 && fy >= 0 && fx < 16 && fy < 24 && mf[fy * 16 + fx]) {
        hid++
        if (checkDoor && (x === 7 || x === 8) && y >= doorTop && y <= doorBottom) doorHid++
      }
    }
    if (hid > all / 3 || doorHid > 1) return false
  }
  return true
}

interface High { cx: number; cy: number; tier: number; order: number }
const highCache = new WeakMap<World, Map<number, High[]>>()
/** Draw order of a hex: row by row, the even columns before the odd ones (which sit lower). */
const orderOf = (col: number, row: number) => row * 2 + (col & 1)
/** Higher hexes within a few of this one: each covers its own top face (lifted) and its cliff down to the plane. */
function highsAround(world: World, hex: number): High[] {
  let cache = highCache.get(world)
  if (!cache) { cache = new Map(); highCache.set(world, cache) }
  let out = cache.get(hex)
  if (!out) {
    out = []
    const here = world.cells[hex]
    for (let dc = -6; dc <= 6; dc++) for (let dr = -6; dr <= 6; dr++) {
      const c = here.col + dc, r = here.row + dr
      if (c < 0 || r < 0 || c >= world.width || r >= world.height) continue
      const o = world.cells[r * world.width + c]
      if (o.tier > here.tier && distance(o, here) <= 6) { const q = hexToPixel(c, r, TW); out.push({ cx: q.x, cy: q.y, tier: o.tier, order: orderOf(c, r) }) }
    }
    cache.set(hex, out)
  }
  return out
}

/** No part of a building may stand hidden behind higher ground in front of it. */
function inView(world: World, v: Village, c: Box): boolean {
  const hi = hexAt(world, v, [c.gx, c.gy])
  if (hi < 0) return false
  const highs = highsAround(world, hi)
  if (!highs.length) return true
  const tier = world.cells[hi].tier, o = origin(v)
  const front = hexAt(world, v, [c.gx, c.gy + c.hy]), order = front >= 0 ? orderOf(world.cells[front].col, world.cells[front].row) : 0
  const m = maskOf(spriteOf(c)), x0 = o.x + c.gx - 32, y0 = o.y + c.gy * SQ - tier * TP - 80
  for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) {
    if (!m[y * 16 + x]) continue
    const px = x0 + x * 4 + 2, py = y0 + y * 4 + 2
    for (const h of highs) {
      if (h.order <= order || h.tier <= tier) continue
      const dx = Math.abs(px - h.cx)
      if (dx > 32) continue
      const k = Math.min(16, 32 - dx)
      if (py <= h.cy + k && py + h.tier * TP >= h.cy - k) return false
    }
  }
  return true
}

/** Seen properly: hides nothing it shouldn't, and is hidden by nothing. */
export function visible(world: World, v: Village, h: Home): boolean {
  const b = homeBox(h)
  return screenOk(world, v, b, boxesOf(world, v)) && inView(world, v, b)
}

// ------------------------------------------------------------------ what stands there
const fixedBoxes = (world: World, v: Village): Box[] =>
  villageSpots(idxOf(world, v)).map((s) => ({ gx: s.x, gy: s.y / SQ, ...boxDims(s.key), key: s.key, side: 'front' as const, fixed: true }))
const boxDims = (key: string) => { const [hx, hy] = dims(key); return { hx, hy } }
const homeBox = (h: Home): Box => ({ gx: h.x, gy: h.y, ...boxDims(h.key), key: h.key, side: h.side })
const boxesOf = (world: World, v: Village, extra: Home[] = []): Box[] => [...fixedBoxes(world, v), ...(v.homes ?? []).map(homeBox), ...extra.map(homeBox)]
const isTown = (k: string) => k.startsWith('t_')

/** The doorstep of a building: just outside the middle of its front (or back) wall. */
const doorOf = (b: Box): Pt => [b.gx, b.gy + (b.side === 'front' ? 1 : -1) * (b.hy + 1.5)]
/** The ground in front of a door that nothing may cover, or it couldn't be seen or reached. */
const approach = (b: Box) => ({ gx: b.gx, gy: b.gy + (b.side === 'front' ? 1 : -1) * (b.hy + 3.5), hx: 5, hy: 4.5 })

/** Does this home fit on the cobbles, among everything already there? (Cheap checks; no walking.) */
export function roomFor(world: World, v: Village, h: Home, skip?: Home): boolean {
  const city = new Set(v.city ?? [])
  const b = homeBox(h)
  const tier = tierAt(world, v, [b.gx, b.gy])
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const q: Pt = [b.gx + sx * b.hx, b.gy + sy * b.hy], i = hexAt(world, v, q)
    if (i < 0 || !city.has(i) || world.cells[i].tier !== tier) return false
  }
  const others = boxesOf(world, v).filter((o) => !skip || o.fixed || o.gx !== skip.x || o.gy !== skip.y)
  const mine = approach(b)
  for (const o of others) {
    if (overlap(b, o, isTown(b.key) && isTown(o.key) ? -1 : 0.3)) return false
    if (overlap(mine, o, 0) || overlap(approach(o), b, 0)) return false
  }
  return true
}

// ------------------------------------------------------------------ walking
const CELL = 2
interface Grid { x0: number; y0: number; W: number; H: number; ok: Uint8Array }

/** The cobbles a villager can walk: outside every building, with a cell's margin all round. */
function walkGrid(world: World, v: Village, bs: Box[]): Grid {
  const city = new Set(v.city ?? [])
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const i of city) { const g = centreOf(world, v, i); x0 = Math.min(x0, g[0] - 34); x1 = Math.max(x1, g[0] + 34); y0 = Math.min(y0, g[1] - 30); y1 = Math.max(y1, g[1] + 30) }
  const W = Math.max(1, Math.ceil((x1 - x0) / CELL)), H = Math.max(1, Math.ceil((y1 - y0) / CELL))
  const free = new Uint8Array(W * H)
  const solid = bs.filter((b) => b.key !== 'well')
  for (let j = 0; j < H; j++) for (let k = 0; k < W; k++) {
    const g: Pt = [x0 + (k + 0.5) * CELL, y0 + (j + 0.5) * CELL]
    if (!city.has(hexAt(world, v, g))) continue
    let f = 1
    for (const b of solid) if (Math.abs(g[0] - b.gx) < b.hx && Math.abs(g[1] - b.gy) < b.hy) { f = 0; break }
    free[j * W + k] = f
  }
  const ok = new Uint8Array(W * H)
  for (let j = 1; j < H - 1; j++) for (let k = 1; k < W - 1; k++) {
    let f = 1
    for (let dj = -1; dj <= 1 && f; dj++) for (let dk = -1; dk <= 1; dk++) if (!free[(j + dj) * W + k + dk]) { f = 0; break }
    ok[j * W + k] = f
  }
  return { x0, y0, W, H, ok }
}
function cellNear(G: Grid, g: Pt, reach = 3): number {
  const k = Math.floor((g[0] - G.x0) / CELL), j = Math.floor((g[1] - G.y0) / CELL)
  for (let r = 0; r <= reach; r++) for (let dj = -r; dj <= r; dj++) for (let dk = -r; dk <= r; dk++) {
    const kk = k + dk, jj = j + dj
    if (kk >= 0 && jj >= 0 && kk < G.W && jj < G.H && G.ok[jj * G.W + kk]) return jj * G.W + kk
  }
  return -1
}
/** The middle of each edge between the city and open land it could still take in (a little inside). */
export function gatesOf(world: World, v: Village): Pt[] {
  const city = new Set(v.city ?? []), home = idxOf(world, v), out: Pt[] = []
  for (const f of city) {
    const c = world.cells[f]
    for (const [nc, nr] of neighbours(c.col, c.row)) {
      if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
      const j = nr * world.width + nc, n = world.cells[j]
      if (city.has(j) || !paveable(n) || distance(n, world.cells[home]) > CITY_RADIUS) continue
      const a = centreOf(world, v, f), b = centreOf(world, v, j)
      out.push([a[0] + (b[0] - a[0]) * 0.42, a[1] + (b[1] - a[1]) * 0.42])
    }
  }
  return out
}

/** The town's main walkable area: the biggest connected stretch of cobbles a villager can walk. */
function mainArea(G: Grid): Uint8Array {
  const label = new Int32Array(G.W * G.H).fill(-1)
  let best = -1, bestSize = 0, count = 0
  const q = new Int32Array(G.W * G.H)
  for (let s0 = 0; s0 < G.W * G.H; s0++) {
    if (!G.ok[s0] || label[s0] >= 0) continue
    let qh = 0, qt = 0
    q[qt++] = s0; label[s0] = count
    while (qh < qt) {
      const n = q[qh++], k = n % G.W, j = (n - k) / G.W
      for (const [dk, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const kk = k + dk, jj = j + dj
        if (kk < 0 || jj < 0 || kk >= G.W || jj >= G.H) continue
        const m = jj * G.W + kk
        if (!G.ok[m] || label[m] >= 0) continue
        if (dk && dj && (!G.ok[j * G.W + kk] || !G.ok[jj * G.W + k])) continue
        label[m] = count; q[qt++] = m
      }
    }
    if (qt > bestSize) { bestSize = qt; best = count }
    count++
  }
  const out = new Uint8Array(G.W * G.H)
  for (let n = 0; n < out.length; n++) if (label[n] === best) out[n] = 1
  return out
}

/** The gates in the town's main walkable area right now (with the homes already built): the ones a new
 *  home must keep open. (Some fall inside the square's own houses, or behind earlier homes: not these.) */
export function openGates(world: World, v: Village): Pt[] {
  const gates = gatesOf(world, v)
  if (!gates.length) return []
  const G = walkGrid(world, v, boxesOf(world, v)), main = mainArea(G)
  return gates.filter((g) => { const c = cellNear(G, g, 4); return c >= 0 && main[c] })
}

/** Is the city still one walkable place with these homes? Every new home's door, and every gate that was
 *  open (an edge where the city could still grow), must be in the town's main walkable area. */
export function walkable(world: World, v: Village, extra: Home[] = [], gates: Pt[] = openGates(world, v)): boolean {
  const bs = boxesOf(world, v, extra)
  const G = walkGrid(world, v, bs), main = mainArea(G)
  // (the picture's own houses are exempt: the front one stands on the hex's edge)
  for (const b of bs) { if (b.fixed) continue; const c = cellNear(G, doorOf(b)); if (c < 0 || !main[c]) return false }
  for (const g of gates) { const c = cellNear(G, g, 4); if (c < 0 || !main[c]) return false }
  return true
}

/** The full test the server runs for a new home. */
export function homeFits(world: World, v: Village, h: Home): boolean {
  return roomFor(world, v, h) && visible(world, v, h) && walkable(world, v, [h])
}

/** A ground point (px from the village hex's centre) under a point on the map's plane (screen px, unlifted). */
export function groundOf(v: Village, x: number, y: number): Pt {
  const o = origin(v)
  return [x - o.x, (y - o.y) / SQ]
}

/** Rebuilding the cottage at `index` as a town house: it keeps the cottage's front and reaches back from it,
 *  nudged a little if it must. Returns the town house to put there, or null if there's no room for one. */
export function upgradeFor(world: World, v: Village, index: number): Home | null {
  const old = v.homes?.[index]
  if (!old || old.kind !== 'cottage') return null
  const without: Village = { ...v, homes: (v.homes ?? []).filter((_, k) => k !== index) }
  const key = keysFor('townhouse', seedOf(v) + index)[0]
  const [, hy] = dims(key), [, ohy] = dims(old.key)
  const y0 = old.y + (old.side === 'front' ? -1 : 1) * (hy - ohy)
  const gates = openGates(world, without)
  for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [6, 0], [-6, 0], [3, 3], [-3, -3], [3, -3], [-3, 3]]) {
    const h: Home = { kind: 'townhouse', key, x: Math.round((old.x + dx) * 10) / 10, y: Math.round((y0 + dy) * 10) / 10, side: old.side }
    if (roomFor(world, without, h) && visible(world, without, h) && walkable(world, without, [h], gates)) return h
  }
  return null
}

/** The first cottage on this hex that can be rebuilt as a town house, with the town house that would replace it. */
export function findUpgrade(world: World, v: Village, hex: number): { index: number; home: Home } | null {
  for (const [index, h] of (v.homes ?? []).entries()) {
    if (h.kind !== 'cottage' || hexAt(world, v, [h.x, h.y]) !== hex) continue
    const home = upgradeFor(world, v, index)
    if (home) return { index, home }
  }
  return null
}

// ------------------------------------------------------------------ finding a place
const SIZES = ['S', 'M', 'M', 'L'], ROOFS = ['tile', 'tile2', 'thatch', 'shingle', 'slate'], TOWN_ROOFS = ['tile', 'tile2', 'slate', 'shingle']
function keysFor(kind: HomeKind, seed: number): string[] {
  const at = (xs: string[], salt: number) => xs[Math.floor(pick01(seed, salt) * xs.length)]
  if (kind === 'townhouse') return [`t_${at(TOWN_ROOFS, 1)}_y_${Math.floor(pick01(seed, 2) * 3)}`]
  const sz = at(SIZES, 1), roof = at(ROOFS, 2), tim = pick01(seed, 3) < 0.5 ? 0 : 1
  return pick01(seed, 4) < 0.5 ? [`c_${sz}_${roof}_x_${tim}`, `c_${sz}_${roof}_y_${tim}`] : [`c_${sz}_${roof}_y_${tim}`, `c_${sz}_${roof}_x_${tim}`]
}
const seedOf = (v: Village) => (v.homes?.length ?? 0) * 7919 + [...v.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

/** A place for a home of this kind: in `hex` if given (nearest `near`, else nearest the square), or
 *  anywhere in the city. Chooses what the player will be asked to confirm; the server re-checks it. */
export function findHome(world: World, v: Village, kind: HomeKind, hex: number | null = null, near: Pt | null = null): Home | null {
  const seed = seedOf(v), keys = keysFor(kind, seed), gates = openGates(world, v)
  const hexes = hex === null ? (v.city ?? []) : [hex]
  const aim: Pt = near ?? [0, 0]
  const spots: { g: Pt; d: number }[] = []
  for (const i of hexes) {
    const c = centreOf(world, v, i)
    for (let dy = -27; dy <= 27; dy += 3) for (let dx = -30; dx <= 30; dx += 3) {
      const g: Pt = [c[0] + dx, c[1] + dy]
      if (hexAt(world, v, g) !== i) continue
      spots.push({ g, d: Math.hypot(g[0] - aim[0], g[1] - aim[1]) + (near ? 0 : pick01(Math.round(g[0]) * 977 + Math.round(g[1]), seed) * 10) })
    }
  }
  spots.sort((a, b) => a.d - b.d)
  for (const { g } of spots) for (const key of keys) for (const side of ['front', 'back'] as const) {
    const h: Home = { kind, key, x: Math.round(g[0] * 10) / 10, y: Math.round(g[1] * 10) / 10, side }
    if (roomFor(world, v, h) && visible(world, v, h) && walkable(world, v, [h], gates)) return h
  }
  return null
}
