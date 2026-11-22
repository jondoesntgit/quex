/** Village builder demo (development only: `npm run demo`, or `npx vite` and open /demo/village.html).
 *
 *  Pick a spot on a real Quex world and found a town: it claims the three hexes shown (the three that
 *  meet at the corner nearest the pointer), lays them with cobblestone with the well on that corner,
 *  and puts up a handful of buildings. Tap a hex to build:
 *  lay cobblestone (it joins the city), lay a road (one hex at a time, drawn by the game's own road
 *  code), or put up any building that has room there.
 *
 *  Inside the city everything stands on cobblestone, and a building may straddle cobbled hexes on
 *  one level. A building fits when:
 *  - its real ground footprint (exported from the Blender model: walls, eaves, chimney, door) overlaps
 *    nothing (two-storey town houses may share a wall), and it keeps clear of the square;
 *  - every door in town can still be walked to from the well, along lanes a villager wide;
 *  - in the picture it hides no more than a third of a building behind it, nor its door, and no
 *    higher ground in front hides it.
 *  Buildings never move: the town is the list of what was built, in order.
 *
 *  Drawing: every tile with its road or cobbles and its trees in the game's own order (back to
 *  front); then buildings, villagers and the trees just in front of the town, sorted by how far
 *  forward they stand (buildings span hex edges, so they can't be drawn hex by hex). */
import { generateWorld } from '../src/world/generate'
import { distance, hexToPixel, neighbours, pixelToHex } from '../src/world/hex'
import { hashString, mulberry32, type Rng } from '../src/world/rng'
import { extend, roadLayout, type RoadLayout } from '../src/render/waterways'
import type { Cell, World } from '../src/world/types'

type Pt = [number, number]
const TW = 64, TP = 8, SQ = 0.5774, PAD = 0.5, TERR = -1.0
const DIRT = '#c09858', EDGE = '#7a5830'
const SQUARE = 15 // the open square round the well (ground px)

// ------------------------------------------------------------------ assets
interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number }
const atlasMeta: { frames: Record<string, Frame> } = await (await fetch('/art/64/atlas.json')).json()
const houseMeta: { w: number; h: number; ax: number; ay: number; frames: Record<string, Pt>; footprints: Record<string, [number, number, number, number]> } = await (await fetch('/art/houses/houses.json')).json()
const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src })
const [atlasImg, houseImg] = await Promise.all([loadImg('/art/64/atlas.png'), loadImg('/art/houses/houses.png')])
const houseAlpha = (() => {
  const c = document.createElement('canvas'); c.width = houseImg.width; c.height = houseImg.height
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(houseImg, 0, 0)
  return g.getImageData(0, 0, c.width, c.height).data
})()
const masks = new Map<string, Uint8Array>()
function mask(key: string): Uint8Array {
  let m = masks.get(key)
  if (m) return m
  m = new Uint8Array(64 * 96)
  if (!houseMeta.frames[key]) throw new Error(`no sprite ${key}`)
  const [fx, fy] = houseMeta.frames[key]
  for (let y = 0; y < 96; y++) for (let x = 0; x < 64; x++) m[y * 64 + x] = houseAlpha[((fy + y) * houseImg.width + fx + x) * 4 + 3] > 0 ? 1 : 0
  masks.set(key, m)
  return m
}
const baseKey = (k: string) => houseMeta.footprints[k] ? k : k.replace(/_(o|b)$/, '')
function dims(key: string): Pt {
  const [x0, x1, y0, y1] = houseMeta.footprints[baseKey(key)]
  return [Math.max(-x0, x1) + PAD, Math.max(-y0, y1) + PAD]
}

// ------------------------------------------------------------------ small helpers
const hyp = Math.hypot
interface Box { gx: number; gy: number; hx: number; hy: number }
const overlap = (a: Box, b: Box, m: number) => Math.abs(a.gx - b.gx) < a.hx + b.hx + m && Math.abs(a.gy - b.gy) < a.hy + b.hy + m
const hash2 = (x: number, y: number) => (Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0) / 4294967296
const pickOf = <T,>(r: Rng, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]

// ------------------------------------------------------------------ world
let world: World
const idx = (c: number, r: number) => r * world.width + c
const inWorld = (c: number, r: number) => c >= 0 && r >= 0 && c < world.width && r < world.height
const nbrs = (i: number) => { const c = world.cells[i]; return neighbours(c.col, c.row).filter(([nc, nr]) => inWorld(nc, nr)).map(([nc, nr]) => idx(nc, nr)) }
const BAD_FEATURE = new Set(['mountain', 'mountain_snow'])
/** Land a town can build on, at any level: not water, mountains, rivers, swamp, snow or beach. */
const buildable = (c: Cell | undefined) => !!c && c.tier > 0 && !BAD_FEATURE.has(c.feature ?? '') && c.riverTo === -1 && !['swamp', 'snow', 'beach'].includes(c.terrain)

// ------------------------------------------------------------------ the town
interface Bldg extends Box { id: number; key: string; kind: string; side: 'front' | 'back'; people: number }
interface Town {
  col: number; row: number; tier: number; seed: number
  hub: number              // the founding hex the pointer was on
  O: Pt                    // its centre (unlifted): the origin of ground coordinates
  well: Pt                 // the square: the corner where the three founding hexes meet
  found: Set<number>       // cobbled hexes: the city
  roads: Set<number>       // road hexes, as in the game
  b: Bldg[]
  nextId: number
  /** the land round the town by column: raised hexes hide what's behind them */
  high: Map<number, { cx: number; cy: number; tier: number; order: number }[]>
}
let town: Town | null = null
const scr = (g: Pt): Pt => [town!.O[0] + g[0], town!.O[1] + g[1] * SQ]
const gnd = (x: number, y: number): Pt => [x - town!.O[0], (y - town!.O[1]) / SQ]
const hexOfG = (g: Pt) => { const s = scr(g); const o = pixelToHex(s[0], s[1], TW); return inWorld(o.col, o.row) ? idx(o.col, o.row) : -1 }
const tierAt = (g: Pt) => world.cells[hexOfG(g)]?.tier ?? 0
const liftAt = (g: Pt) => tierAt(g) * TP
const centreG = (i: number): Pt => { const c = world.cells[i], q = hexToPixel(c.col, c.row, TW); return gnd(q.x, q.y) }
const people = (k: string) => /^[th]_/.test(k) ? 24 : /^c_/.test(k) ? ({ S: 8, M: 12, L: 16 } as Record<string, number>)[k.split('_')[1]] : k === 'manor' ? 8 : 0
const pop = () => town ? town.b.reduce((a, b) => a + b.people, 0) : 0
const isHouse = (k: string) => /^[cht]_/.test(k)
const sprKey = (b: { key: string; side?: string }) => b.key + (b.side === 'back' && isHouse(b.key) ? '_b' : '')
const doorAt = (b: Box, side: 'front' | 'back'): Pt => [b.gx, b.gy + (side === 'front' ? 1 : -1) * (b.hy + 1.5)]

/** The game's road in hex i (lifted screen coordinates); the city's cobbles are where roads lead. */
function layoutAt(t: Town, i: number): RoadLayout {
  const c = world.cells[i], q = hexToPixel(c.col, c.row, TW)
  return roadLayout(world, i, q.x, q.y - c.tier * TP, TW, TP, t.roads, t.found)
}

// ------------------------------------------------------------------ walking (and whether every door can be reached)
interface Grid { x0: number; y0: number; W: number; H: number; ok: Uint8Array }
const CELL = 2
/** Walkable ground: the cobbles, outside every building, with room for a villager (a cell is
 *  walkable only if the cells round it are free too: lanes at least ~6 px wide). */
function walkGrid(t: Town, bs: Bldg[]): Grid {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const i of t.found) { const g = centreG(i); x0 = Math.min(x0, g[0] - 34); x1 = Math.max(x1, g[0] + 34); y0 = Math.min(y0, g[1] - 30); y1 = Math.max(y1, g[1] + 30) }
  const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((y1 - y0) / CELL)
  const free = new Uint8Array(W * H)
  const solid = bs.filter((b) => b.kind !== 'well')
  for (let j = 0; j < H; j++) for (let k = 0; k < W; k++) {
    const g: Pt = [x0 + (k + 0.5) * CELL, y0 + (j + 0.5) * CELL]
    if (!t.found.has(hexOfG(g))) continue
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
/** Breadth-first from a cell: the parent of every cell reached (-2: not reached). */
function flood(G: Grid, s0: number, stop = -1): Int32Array {
  const prev = new Int32Array(G.W * G.H).fill(-2)
  if (s0 < 0) return prev
  prev[s0] = -1
  const q = new Int32Array(G.W * G.H); let qh = 0, qt = 0; q[qt++] = s0
  while (qh < qt) {
    const n: number = q[qh++]; if (n === stop) break
    const k: number = n % G.W, j: number = (n - k) / G.W
    for (const [dk, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const kk: number = k + dk, jj: number = j + dj
      if (kk < 0 || jj < 0 || kk >= G.W || jj >= G.H) continue
      const m: number = jj * G.W + kk
      if (!G.ok[m] || prev[m] !== -2) continue
      if (dk && dj && (!G.ok[j * G.W + kk] || !G.ok[jj * G.W + k])) continue
      prev[m] = n; q[qt++] = m
    }
  }
  return prev
}
/** Is the town still one walkable place? From the square a villager must reach every door, every
 *  gate (the middle of each edge where open land could join the town later), and every part of the
 *  cobbles bigger than a gap between houses. */
function allReachable(t: Town, bs: Bldg[]): boolean {
  const G = walkGrid(t, bs)
  const reached = flood(G, cellNear(G, [t.well[0], t.well[1] + SQUARE - 4], 6))
  for (const b of bs) {
    if (b.kind === 'well') continue
    const c = cellNear(G, doorAt(b, b.side))
    if (c < 0 || reached[c] === -2) return false
  }
  for (const g of gatesOf(t)) { const c = cellNear(G, g, 4); if (c < 0 || reached[c] === -2) return false }
  // nothing closed off: every walkable cell not reached belongs to a small pocket
  const seen = new Uint8Array(G.W * G.H)
  for (let n = 0; n < G.W * G.H; n++) {
    if (!G.ok[n] || reached[n] !== -2 || seen[n]) continue
    let size = 0
    const stack = [n]; seen[n] = 1
    while (stack.length) {
      const m = stack.pop()!; size++
      const k = m % G.W, j = (m - k) / G.W
      for (const [dk, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const kk = k + dk, jj = j + dj
        if (kk < 0 || jj < 0 || kk >= G.W || jj >= G.H) continue
        const q = jj * G.W + kk
        if (G.ok[q] && !seen[q] && reached[q] === -2) { seen[q] = 1; stack.push(q) }
      }
    }
    if (size > 30) return false
  }
  return true
}
/** The middle of every edge between the town and open land it could take in, a little inside the town. */
function gatesOf(t: Town): Pt[] {
  const out: Pt[] = []
  for (const f of t.found) for (const j of nbrs(f)) {
    if (t.found.has(j) || !buildable(world.cells[j])) continue
    const a = centreG(f), b = centreG(j)
    out.push([a[0] + (b[0] - a[0]) * 0.42, a[1] + (b[1] - a[1]) * 0.42])
  }
  return out
}

// ------------------------------------------------------------------ hiding
/** Draw order of a hex: row by row, the even columns of a row before the odd ones (which sit lower). */
const orderOf = (col: number, row: number) => row * 2 + (col & 1)
/** Is this screen pixel, on ground of level `tier`, hidden by higher ground drawn after the hex with
 *  draw order `order`? A raised hex covers its top face lifted up, and its cliff down to the plane. */
function hiddenAt(t: Town, x: number, y: number, order: number, tier: number): boolean {
  const col = Math.round((x - 32) / 48)
  for (const cc of [col - 1, col, col + 1]) for (const h of t.high.get(cc) ?? []) {
    if (h.order <= order || h.tier <= tier) continue
    const dx = Math.abs(x - h.cx)
    if (dx > 32) continue
    const m = Math.min(16, 32 - dx)
    if (y <= h.cy + m && y + h.tier * TP >= h.cy - m) return true
  }
  return false
}
const orderAtG = (g: Pt) => { const s = scr(g); const o = pixelToHex(s[0], s[1], TW); return orderOf(o.col, o.row) }
function inView(t: Town, c: Bldg): boolean {
  const g: Pt = [c.gx, c.gy], [sx, sy] = scr(g), m = mask(sprKey(c)), order = orderAtG([c.gx, c.gy + c.hy]), tier = tierAt(g)
  const x0 = Math.round(sx) - 32, y0 = Math.round(sy - tier * TP) - 80
  for (let y = 0; y < 96; y += 2) for (let x = 0; x < 64; x += 2) if (m[y * 64 + x] && hiddenAt(t, x0 + x, y0 + y, order, tier)) return false
  return true
}
/** In the picture, no building may hide more than a third of one behind it, nor any of its door. */
function screenOk(c: Bldg, others: Bldg[]): boolean {
  for (const o of others) {
    if (Math.abs(o.gx - c.gx) > 70 || Math.abs(o.gy - c.gy) > 170) continue
    const [front, back] = c.gy + c.hy > o.gy + o.hy ? [c, o] : [o, c]
    const fs = scr([front.gx, front.gy]), bs = scr([back.gx, back.gy])
    const dx = Math.round(fs[0]) - Math.round(bs[0]), dy = Math.round(fs[1] - liftAt([front.gx, front.gy])) - Math.round(bs[1] - liftAt([back.gx, back.gy]))
    if (Math.abs(dx) >= 64 || Math.abs(dy) >= 96) continue
    const mb = mask(sprKey(back)), mf = mask(sprKey(front))
    let hid = 0, all = 0, doorHid = 0
    const dyp = Math.round(back.hy * SQ), checkDoor = back.side === 'front' && isHouse(back.key)
    for (let y = 0; y < 96; y++) for (let x = 0; x < 64; x++) {
      if (!mb[y * 64 + x]) continue
      all++
      const fx = x - dx, fy = y - dy
      if (fx >= 0 && fy >= 0 && fx < 64 && fy < 96 && mf[fy * 64 + fx]) {
        hid++
        if (checkDoor && y >= 80 + dyp - 9 && y <= 80 + dyp && x >= 30 && x <= 34) doorHid++
      }
    }
    if (hid > all / 3 || doorHid > 1) return false
  }
  return true
}

// ------------------------------------------------------------------ placing buildings
/** Room on the cobbles, on one level, clear of everything and of the square (cheap checks). */
function roomFor(t: Town, c: Bldg, skip?: Bldg): boolean {
  const tier = tierAt([c.gx, c.gy])
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const q: Pt = [c.gx + sx * c.hx, c.gy + sy * c.hy]
    if (!t.found.has(hexOfG(q)) || tierAt(q) !== tier) return false
  }
  const dw = hyp(Math.max(Math.abs(c.gx - t.well[0]) - c.hx, 0), Math.max(Math.abs(c.gy - t.well[1]) - c.hy, 0))
  if (dw < (c.kind === 'stall' ? 7 : SQUARE)) return false
  for (const o of t.b) if (o !== skip && o.kind !== 'well' && overlap(c, o, c.key[0] === 't' && o.key[0] === 't' ? TERR : 0.3)) return false
  return true
}
/** The full test: room, a door every villager can reach (front if it can, else back), and the picture. */
function fits(t: Town, c: Bldg, skip?: Bldg): boolean {
  if (!roomFor(t, c, skip)) return false
  const others = t.b.filter((o) => o !== skip)
  for (const side of isHouse(c.key) ? ['front', 'back'] as const : ['front'] as const) {
    c.side = side
    if (!screenOk(c, others) || !inView(t, c)) continue
    if (allReachable(t, [...others, c])) return true
  }
  return false
}

const ROOFS = ['tile', 'tile2', 'thatch', 'shingle', 'slate']
function keysFor(kind: string, r: Rng): string[] {
  const o = r() < 0.5 ? ['x', 'y'] : ['y', 'x']
  switch (kind) {
    case 'cottage': { const sz = pickOf(r, ['S', 'M', 'M', 'L']), roof = pickOf(r, ROOFS), tim = r() < 0.5 ? 1 : 0; return o.map((d) => `c_${sz}_${roof}_${d}_${tim}`) }
    case 'townhouse': return [`t_${pickOf(r, ['tile', 'tile2', 'slate', 'shingle'])}_y_${Math.floor(r() * 3)}`]
    case 'hall': { const sz = pickOf(r, ['M', 'L']), roof = pickOf(r, ['tile', 'shingle', 'slate']); return o.map((d) => `h_${sz}_${roof}_${d}`) }
    case 'barn': return [`b_${pickOf(r, ['thatch', 'shingle'])}`]
    case 'church': return ['church']
    case 'manor': return ['manor']
    case 'stall': return [pickOf(r, ['stall_r', 'stall_b'])]
  }
  return []
}

/** Put one up: in `hex` (nearest `near` if given), or anywhere on the cobbles (nearest the square
 *  first). With commit false, only says whether it would fit. */
function place(t: Town, kind: string, hex: number | null = null, near: Pt | null = null, commit = true): Bldg | null {
  const r = mulberry32(t.seed + t.nextId * 7919)
  const keys = keysFor(kind, r)
  const hexes = hex === null ? [...t.found] : [hex]
  const spots: { g: Pt; d: number }[] = []
  const aim = near ?? t.well
  for (const i of hexes) {
    const c = centreG(i)
    for (let dy = -27; dy <= 27; dy += 3) for (let dx = -30; dx <= 30; dx += 3) {
      const g: Pt = [c[0] + dx, c[1] + dy]
      if (hexOfG(g) !== i) continue
      spots.push({ g, d: hyp(g[0] - aim[0], g[1] - aim[1]) + (near ? 0 : hash2(Math.round(g[0]), Math.round(g[1])) * 10) })
    }
  }
  spots.sort((a, b) => a.d - b.d)
  for (const { g } of spots) for (const key of keys) {
    const [hx, hy] = dims(key)
    const c: Bldg = { gx: g[0], gy: g[1], hx, hy, id: t.nextId, key, kind, side: 'front', people: people(key) }
    if (!fits(t, c)) continue
    if (commit) { t.b.push(c); t.nextId++ }
    return c
  }
  return null
}

/** Rebuild a cottage as a two-storey town house in the same place (in `hex`, or the nearest the square). */
function upgradeOne(t: Town, hex: number | null = null, commit = true): boolean {
  const r = mulberry32(t.seed + t.nextId * 104729)
  for (const h of [...t.b].sort((a, b) => hyp(a.gx - t.well[0], a.gy - t.well[1]) - hyp(b.gx - t.well[0], b.gy - t.well[1]))) {
    if (h.key[0] !== 'c' || (hex !== null && hexOfG([h.gx, h.gy]) !== hex)) continue
    const key = `t_${pickOf(r, ['tile', 'tile2', 'slate', 'shingle'])}_y_${Math.floor(r() * 3)}`
    const [hx, hy] = dims(key)
    // the same front: the town house reaches back from it
    const c: Bldg = { ...h, key, kind: 'townhouse', hx, hy, gy: h.gy + (h.side === 'front' ? -1 : 1) * (hy - h.hy), people: people(key) }
    if (fits(t, c, h)) { if (commit) t.b[t.b.indexOf(h)] = c; return true }
  }
  return false
}

// ------------------------------------------------------------------ cobblestone and roads
const MAX_REACH = 5
/** Can hex i be laid with cobblestone (taken into the city)? Open land next to the city, near the square. */
function cobbleError(t: Town, i: number): string | null {
  const c = world.cells[i]
  if (t.found.has(i)) return 'Cobbled already'
  if (!buildable(c)) return c.tier === 0 ? 'Not on water' : c.riverTo !== -1 ? 'Not over a river' : 'Can’t build on this ground'
  if (distance(c, t) > MAX_REACH) return 'Too far from the square'
  if (!nbrs(i).some((j) => t.found.has(j))) return 'Has to join the city'
  return null
}
function cobble(t: Town, i: number): string | null {
  const err = cobbleError(t, i)
  if (!err) { t.found.add(i); t.roads.delete(i) }
  return err
}
/** Can a road go on hex i? The game's rules: land, joining another road or the city. */
function roadError(t: Town, i: number): string | null {
  const c = world.cells[i]
  if (c.tier === 0) return 'Roads need land'
  if (t.found.has(i)) return 'Cobbled already'
  if (t.roads.has(i)) return 'Already a road'
  if (c.riverTo !== -1) return 'Bridges aren’t in this demo'
  if (distance(c, t) > 14) return 'Too far for this demo'
  if (!nbrs(i).some((j) => t.roads.has(j) || t.found.has(j))) return 'A road has to join another road or the city'
  return null
}
/** Grow the city a hex: next to it, along a road if it can, on a level it already has. */
function growCity(t: Town): boolean {
  let best = -1, bs = 1e9
  const levels = new Set([...t.found].map((i) => world.cells[i].tier))
  for (const f of t.found) for (const i of nbrs(f)) {
    if (cobbleError(t, i)) continue
    const c = world.cells[i]
    const s = distance(c, t) * 30 + (t.roads.has(i) ? 0 : 12) + (levels.has(c.tier) ? 0 : 10) + hash2(c.col, c.row) * 6
    if (s < bs) { bs = s; best = i }
  }
  if (best < 0) return false
  cobble(t, best)
  return true
}

const HOUSES = new Set(['cottage', 'townhouse', 'hall', 'barn'])
/** Build one anywhere; for a house, the city grows a hex at a time until it fits. */
function build(kind: string): Bldg | null {
  const t = town!
  for (let grown = 0; ; grown++) {
    const b = place(t, kind)
    if (b) return b
    if (!HOUSES.has(kind) && grown >= 1) return null
    if (!growCity(t)) return null
  }
}
function autoKind(): string {
  const t = town!, p = pop(), has = (k: string) => t.b.filter((b) => b.kind === k).length
  if (p >= 60 && !has('church')) return 'church'
  if (p >= 80 && has('stall') < 2) return 'stall'
  if (p >= 200 && !has('manor')) return 'manor'
  const r = mulberry32(t.seed + t.nextId * 31)()
  if (p >= 100) return r < 0.55 ? 'townhouse' : r < 0.65 ? 'hall' : r < 0.7 ? 'barn' : 'cottage'
  return r < 0.07 ? 'barn' : 'cottage'
}
function growOnce(): boolean {
  if (pop() >= 120 && mulberry32(town!.seed + town!.nextId * 13)() < 0.35 && upgradeOne(town!)) return true
  const k = autoKind()
  return !!(build(k) ?? (k !== 'cottage' ? build('cottage') : null))
}

// ------------------------------------------------------------------ founding
/** The three hexes a town would claim from the pointer at (x, y): the hex under it and the two
 *  that meet it at its corner nearest the pointer. All open land on one level. */
function claimAt(col: number, row: number, x: number, y: number): { hexes: number[]; corner: number } | null {
  if (!inWorld(col, row)) return null
  const i = idx(col, row), c = world.cells[i], p = hexToPixel(col, row, TW)
  const a = ((Math.atan2((y - (p.y - c.tier * TP)) * 2, x - p.x) * 180 / Math.PI) + 360) % 360
  const corner = Math.round(a / 60) % 6
  // neighbours in hex.ts order: NE, SE, S, SW, NW, N; corner k lies between neighbours k and k+1
  const ns = neighbours(col, row)
  const pair = [ns[corner], ns[(corner + 1) % 6]]
  if (pair.some(([nc, nr]) => !inWorld(nc, nr))) return null
  const hexes = [i, ...pair.map(([nc, nr]) => idx(nc, nr))]
  if (!hexes.every((h) => buildable(world.cells[h]) && world.cells[h].tier === c.tier)) return { hexes, corner: -1 }
  return { hexes, corner }
}
const CORNERS: Pt[] = [[32, 0], [16, 16], [-16, 16], [-32, 0], [-16, -16], [16, -16]]

function found(claim: { hexes: number[]; corner: number }) {
  const [hub] = claim.hexes, c = world.cells[hub]
  const seed = hashString(`${world.seed}|${c.col}|${c.row}|${claim.corner}`)
  const p = hexToPixel(c.col, c.row, TW)
  const t: Town = { col: c.col, row: c.row, tier: c.tier, seed, hub, O: [p.x, p.y], well: [0, 0], found: new Set(claim.hexes), roads: new Set(), b: [], nextId: 1, high: new Map() }
  town = t
  const k = CORNERS[claim.corner]; t.well = [k[0], k[1] / SQ]
  for (let dc = -10; dc <= 10; dc++) for (let dr = -10; dr <= 10; dr++) {
    const nc = c.col + dc, nr = c.row + dr
    if (!inWorld(nc, nr)) continue
    const h = world.cells[idx(nc, nr)]
    if (h.tier > 0 && distance({ col: nc, row: nr }, t) <= 10) { const q = hexToPixel(nc, nr, TW); const L = t.high.get(nc) ?? []; L.push({ cx: q.x, cy: q.y, tier: h.tier, order: orderOf(nc, nr) }); t.high.set(nc, L) }
  }
  const [hx, hy] = dims('well')
  t.b.push({ id: 0, key: 'well', kind: 'well', gx: t.well[0], gy: t.well[1], hx, hy, side: 'front', people: 0 })
  // a handful of buildings, in the three hexes claimed
  for (const kind of ['cottage', 'cottage', 'cottage', 'cottage', 'barn']) place(t, kind)
  history.length = 0
  walkers = []; changed()
  camOn(p.x, p.y - c.tier * TP)
  closeMenu()
}

// ------------------------------------------------------------------ villagers
interface Walker { path: Pt[]; seg: number; t: number; home: Bldg; to: Bldg; wait: number; shirt: string }
let walkers: Walker[] = []
let grid: Grid | null = null
const openUntil = new Map<number, number>()
/** The way from one door to another, around everything in between. */
function route(a: Bldg, b: Bldg): Pt[] {
  const G = grid
  const da = doorAt(a, a.side), db = doorAt(b, b.side)
  if (!G) return [da, da]
  const s0 = cellNear(G, da), e0 = cellNear(G, db)
  const prev = flood(G, s0, e0)
  if (s0 < 0 || e0 < 0 || prev[e0] === -2) return [da, da]
  const cells: Pt[] = []
  for (let n = e0; n >= 0; n = prev[n]) { const k = n % G.W, j = (n - k) / G.W; cells.push([G.x0 + (k + 0.5) * CELL, G.y0 + (j + 0.5) * CELL]) }
  cells.reverse()
  return [da, ...cells.filter((_, i) => i % 3 === 0 || i === cells.length - 1), db]
}
const SHIRTS = ['#e8c040', '#4878d8', '#9a9ab0', '#3c8c3c', '#e0e0d0', '#c04878', '#d87838', '#70b0b8']
function spawnWalkers() {
  const homes = town!.b.filter((b) => b.kind !== 'well')
  walkers = walkers.filter((w) => town!.b.includes(w.home) && town!.b.includes(w.to))
  const n = Math.max(2, Math.min(40, Math.round(pop() / 12)))
  while (walkers.length < n && homes.length > 1) {
    const h = homes[Math.floor(Math.random() * homes.length)]
    walkers.push({ path: [doorAt(h, h.side)], seg: 0, t: 0, home: h, to: h, wait: Math.random() * 3, shirt: SHIRTS[walkers.length % SHIRTS.length] })
  }
  walkers = walkers.slice(0, n)
}
function stepWalkers(dt: number, now: number) {
  const homes = town!.b.filter((b) => b.kind !== 'well')
  for (const w of walkers) {
    if (w.wait > 0) {
      w.wait -= dt
      if (w.wait <= 0) {
        const to = Math.random() < 0.5 ? w.home : homes[Math.floor(Math.random() * homes.length)]
        w.path = route(w.to, to); w.seg = 0; w.t = 0
        openUntil.set(w.to.id, now + 700); w.to = to
      }
      continue
    }
    let move = dt * 14
    while (move > 0 && w.seg < w.path.length - 1) {
      const [a, b] = [w.path[w.seg], w.path[w.seg + 1]]; const L = hyp(b[0] - a[0], b[1] - a[1])
      if (w.t + move < L) { w.t += move; move = 0 } else { move -= L - w.t; w.seg++; w.t = 0 }
    }
    if (w.seg >= w.path.length - 1) { w.wait = 2 + Math.random() * 6; openUntil.set(w.to.id, now + 700) }
  }
}
const walkerPos = (w: Walker): Pt | null => {
  if (w.wait > 0) return null
  const [a, b] = [w.path[w.seg], w.path[Math.min(w.seg + 1, w.path.length - 1)]]; const L = hyp(b[0] - a[0], b[1] - a[1]) || 1
  return [a[0] + (b[0] - a[0]) * w.t / L, a[1] + (b[1] - a[1]) * w.t / L]
}
const MEEPLE = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', '.oLLo.', '.oLLo.', '.oooo.']
function drawMeeple(g: CanvasRenderingContext2D, x: number, y: number, shirt: string) {
  const col: Record<string, string> = { o: '#221a14', H: '#ecbe96', S: shirt, L: '#463a2c' }
  MEEPLE.forEach((row, j) => { for (let i = 0; i < 6; i++) { const ch = row[i]; if (ch !== '.') { g.fillStyle = col[ch]; g.fillRect(x - 3 + i, y - 8 + j, 1, 1) } } })
}

// ------------------------------------------------------------------ drawing
const cv = document.getElementById('c') as HTMLCanvasElement
const ctx = cv.getContext('2d')!
let zoom = 2, camX = 0, camY = 0
function camOn(x: number, y: number) { camX = x - cv.clientWidth / zoom / 2 + 140 / zoom; camY = y - cv.clientHeight / zoom / 2 }
let hover: { col: number; row: number } | null = null
let pointer: Pt = [0, 0]
let selected: number | null = null
const show = { found: false, foot: false, walk: true }

function atlasDraw(name: string, x: number, y: number) {
  const f = atlasMeta.frames[name]
  if (f) ctx.drawImage(atlasImg, f.x, f.y, f.w, f.h, Math.round(x - f.ax), Math.round(y - f.ay), f.w, f.h)
}
function featureName(i: number, c: Cell): string | null {
  if (!c.feature || c.feature === 'hills') return null
  const v = ((i * 2654435761) >>> 16) % 3
  return v && atlasMeta.frames[`f_${c.feature}_v${v}`] ? `f_${c.feature}_v${v}` : atlasMeta.frames[`f_${c.feature}`] ? `f_${c.feature}` : null
}
function hexPath(cx: number, cy: number) {
  ctx.beginPath(); ctx.moveTo(cx - 32, cy); ctx.lineTo(cx - 16, cy - 16); ctx.lineTo(cx + 16, cy - 16); ctx.lineTo(cx + 32, cy); ctx.lineTo(cx + 16, cy + 16); ctx.lineTo(cx - 16, cy + 16); ctx.closePath()
}
/** Cobblestone: a small tile of setts in staggered rows (squashed for the view), drawn once and
 *  repeated, fixed to the world so it runs on unbroken from one hex to the next. */
const cobbles = (() => {
  const W = 24, H = 12, c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#aaa494'; g.fillRect(0, 0, W, H)                     // mortar
  const tones = ['#bdb7a7', '#b5af9f', '#c3bdad', '#b9b3a3']
  for (let row = 0; row < H / 3; row++) for (let k = -1; k < W / 4 + 1; k++) {
    const x = k * 4 + (row % 2 ? 2 : 0), y = row * 3
    const w = 3 + ((k * 7 + row * 3) % 3 === 0 ? 1 : 0)
    g.fillStyle = tones[(k * 5 + row * 3 + 8) % tones.length]
    g.fillRect(((x % W) + W) % W, y, Math.min(w, W - (((x % W) + W) % W)), 2)
    if ((((x % W) + W) % W) + w > W) g.fillRect(0, y, (((x % W) + W) % W) + w - W, 2)
    g.fillStyle = '#cfc9b9'; g.fillRect(((x % W) + W) % W, y, 1, 1)    // a glint on each sett
  }
  return ctx.createPattern(c, 'repeat')!
})()
/** A cobbled hex: just inside its edges, except where the next hex (on the same level) is cobbled too,
 *  where it runs right across to join it. */
function paintCobbles(t: Town, i: number, cx: number, cy: number) {
  const c = world.cells[i]
  const ns = neighbours(c.col, c.row)
  const joined = ns.map(([nc, nr]) => inWorld(nc, nr) && t.found.has(idx(nc, nr)) && world.cells[idx(nc, nr)].tier === c.tier)
  const corner = (k: number, full: boolean): Pt => { const f = full ? 1.03 : 0.88; return [cx + CORNERS[k][0] * f, cy + CORNERS[k][1] * f] }
  const pts: Pt[] = []
  for (let k = 0; k < 6; k++) {
    // corner k sits between the edges facing neighbours k and k+1
    const a = corner(k, joined[k]), b = corner(k, joined[(k + 1) % 6])
    pts.push(a); if (a[0] !== b[0] || a[1] !== b[1]) pts.push(b)
  }
  ctx.fillStyle = cobbles
  ctx.beginPath(); pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill()
}
/** The game's road painting (MapView.road): every rim first, then every core, butt ends, round joins. */
function paintRoad(L: RoadLayout) {
  const w = L.width
  if (!L.legs.length) {
    ctx.fillStyle = EDGE; ctx.beginPath(); ctx.ellipse(L.mid[0], L.mid[1], w + 1, Math.ceil(w / 2) + 1, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = DIRT; ctx.beginPath(); ctx.ellipse(L.mid[0], L.mid[1], w, Math.ceil(w / 2), 0, 0, Math.PI * 2); ctx.fill()
    return
  }
  const legs = L.legs.map((leg) => extend(leg, 2, true))
  const pass = (width: number, r: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'butt'; ctx.lineJoin = 'round'
    ctx.beginPath()
    for (const leg of legs) { ctx.moveTo(leg[0][0], leg[0][1]); for (const p of leg.slice(1)) ctx.lineTo(p[0], p[1]) }
    if (L.tip) { ctx.moveTo(L.tip[0], L.tip[1]); ctx.lineTo(L.mid[0], L.mid[1]) }
    ctx.stroke()
    ctx.fillStyle = color
    const dot = (p: Pt) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill() }
    dot(L.mid); for (const leg of legs) dot(leg[0]); if (L.tip) dot(L.tip)
  }
  pass(w + 2, (w + 2) / 2, EDGE)
  pass(w, w / 2, DIRT)
  for (const st of L.steps) {
    ctx.fillStyle = EDGE; ctx.fillRect(st.x - 2, st.y0, 5, st.y1 - st.y0)
    ctx.fillStyle = DIRT; for (let y = st.y0 + 1; y < st.y1; y += 2) ctx.fillRect(st.x - 1, y, 3, 1)
  }
}

function draw(now: number) {
  const dpr = window.devicePixelRatio || 1
  if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr) }
  const s = zoom * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#14142a'; ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.imageSmoothingEnabled = false
  ctx.setTransform(s, 0, 0, s, -Math.round(camX * s), -Math.round(camY * s))
  const vw = cv.clientWidth / zoom, vh = cv.clientHeight / zoom
  const c0 = Math.max(0, Math.floor(camX / 48) - 2), c1 = Math.min(world.width - 1, Math.ceil((camX + vw) / 48) + 1)
  const r0 = Math.max(0, Math.floor(camY / 32) - 2), r1 = Math.min(world.height - 1, Math.ceil((camY + vh) / 32) + 8)
  const t = town
  // 1. every tile, with its cobbles or road and its trees, back to front (as the game draws them)
  const items: { y: number; f: () => void }[] = []
  for (let r = r0; r <= r1; r++) for (const par of [0, 1]) for (let c = c0 + ((c0 & 1) !== par ? 1 : 0); c <= c1; c += 2) {
    const i = idx(c, r), cell = world.cells[i], p = hexToPixel(c, r, TW), cy = p.y - cell.tier * TP
    atlasDraw(`t_${cell.terrain}_${(c * 7 + r * 13) % 3}`, p.x, cy)
    if (t && t.found.has(i)) { paintCobbles(t, i, p.x, cy); continue }
    if (t && t.roads.has(i)) paintRoad(layoutAt(t, i))
    const fn = t && t.roads.has(i) ? null : featureName(i, cell)
    if (!fn) continue
    // a tree next to the city may stand in front of a house: it waits to be sorted with them
    const nearTown = !!t && distance({ col: c, row: r }, t) <= MAX_REACH + 3 && [...t.found].some((d) => distance(world.cells[d], cell) <= 2)
      && !hiddenAt(t, p.x, cy, orderOf(c, r), cell.tier)
    if (nearTown) items.push({ y: p.y, f: () => atlasDraw(fn, p.x, cy) })
    else atlasDraw(fn, p.x, cy)
  }
  if (t) {
    if (show.found) {
      ctx.strokeStyle = 'rgba(120,112,96,0.9)'; ctx.lineWidth = 1 / zoom
      for (const i of t.found) { const c = world.cells[i], p = hexToPixel(c.col, c.row, TW); hexPath(p.x, p.y - c.tier * TP); ctx.stroke() }
    }
    // 2. everything standing, front-most last
    for (const b of t.b) {
      const [sx, sy] = scr([b.gx, b.gy]), lift = liftAt([b.gx, b.gy])
      const open = (openUntil.get(b.id) ?? 0) > now && b.side === 'front' && isHouse(b.key)
      const key = open ? b.key + '_o' : sprKey(b)
      items.push({
        y: sy + b.hy * SQ, f: () => {
          ctx.fillStyle = 'rgba(40,40,30,0.25)'; ctx.beginPath(); ctx.ellipse(sx + 2, sy - lift + b.hy * SQ * 0.6, b.hx, 2.5, 0, 0, Math.PI * 2); ctx.fill()
          const [fx, fy] = houseMeta.frames[key]
          ctx.drawImage(houseImg, fx, fy, 64, 96, Math.round(sx) - 32, Math.round(sy - lift) - 80, 64, 96)
        },
      })
    }
    if (show.walk) for (const w of walkers) {
      const g = walkerPos(w)
      if (!g) continue
      const [sx, sy] = scr(g), lift = liftAt(g)
      if (hiddenAt(t, sx, sy - lift, orderAtG(g), tierAt(g))) continue
      items.push({ y: sy + 0.1, f: () => drawMeeple(ctx, Math.round(sx), Math.round(sy - lift), w.shirt) })
    }
  }
  items.sort((a, b) => a.y - b.y)
  for (const it of items) it.f()
  if (t && show.foot) {
    ctx.lineWidth = 1 / zoom
    for (const b of t.b) {
      const lift = liftAt([b.gx, b.gy])
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => scr([b.gx + x * b.hx, b.gy + y * b.hy]))
      ctx.strokeStyle = '#ffffff'; ctx.beginPath(); cs.forEach(([x, y], k) => k ? ctx.lineTo(x, y - lift) : ctx.moveTo(x, y - lift)); ctx.closePath(); ctx.stroke()
      if (b.kind === 'well') continue
      const [dx, dy] = scr(doorAt(b, b.side))
      ctx.fillStyle = b.side === 'front' ? '#ff4040' : '#ff40ff'; ctx.fillRect(dx - 1, dy - lift - 1, 2, 2)
    }
  }
  // the hex under the pointer, and the one picked
  if (t) for (const [h, col] of [[hover ? idx(hover.col, hover.row) : null, 'rgba(255,255,255,0.5)'], [selected, '#ffe060']] as const) {
    if (h === null) continue
    const c = world.cells[h], p = hexToPixel(c.col, c.row, TW)
    ctx.lineWidth = 2 / zoom; ctx.strokeStyle = col; hexPath(p.x, p.y - c.tier * TP); ctx.stroke()
  }
  // choosing a spot: the three hexes that would be claimed, and the square on their corner
  if (!t && hover) {
    const cl = claimAt(hover.col, hover.row, pointer[0], pointer[1])
    const ok = !!cl && cl.corner >= 0
    ctx.lineWidth = 2 / zoom; ctx.strokeStyle = ok ? '#60ff80' : '#ff5050'; ctx.fillStyle = ok ? 'rgba(96,255,128,0.2)' : 'rgba(255,80,80,0.2)'
    for (const i of cl?.hexes ?? [idx(hover.col, hover.row)]) { const c = world.cells[i], p = hexToPixel(c.col, c.row, TW); hexPath(p.x, p.y - c.tier * TP); ctx.fill(); ctx.stroke() }
    if (ok) {
      const c = world.cells[cl.hexes[0]], p = hexToPixel(c.col, c.row, TW), k = CORNERS[cl.corner]
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x + k[0], p.y - c.tier * TP + k[1], 2.5, 0, Math.PI * 2); ctx.fill()
    }
  }
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  if (town && show.walk) stepWalkers(dt, now)
  draw(now)
  requestAnimationFrame(frame)
}

// ------------------------------------------------------------------ the build menu (tap a hex)
const $ = (id: string) => document.getElementById(id)!
const menu = $('menu')
const KINDS: [string, string][] = [['cottage', 'Cottage'], ['townhouse', 'Town house'], ['hall', 'Hall'], ['barn', 'Barn'], ['church', 'Church'], ['manor', 'Manor'], ['stall', 'Market stall']]
let tapG: Pt | null = null
function closeMenu() { selected = null; menu.hidden = true }
function openMenu(i: number, x: number, y: number, g: Pt) {
  selected = i; tapG = g
  menu.style.left = `${Math.min(x + 12, window.innerWidth - 250)}px`; menu.style.top = `${Math.min(y + 8, window.innerHeight - 400)}px`
  fillMenu()
  menu.hidden = false
}
function fillMenu() {
  const t = town!, i = selected!
  const c = world.cells[i]
  const opts: { label: string; why: string | null; act: () => void }[] = []
  const cobbled = t.found.has(i)
  if (!cobbled) {
    opts.push({ label: 'Lay cobblestone', why: cobbleError(t, i), act: () => cobble(t, i) })
    opts.push({ label: 'Road', why: roadError(t, i), act: () => { t.roads.add(i) } })
  }
  for (const [k, label] of KINDS) {
    const has = t.b.some((b) => b.kind === k)
    const why = !cobbled ? 'Lay cobblestone first' : (k === 'church' || k === 'manor') && has ? 'There is one already' : place(t, k, i, tapG, false) ? null : 'No room'
    opts.push({ label, why, act: () => place(t, k, i, tapG) })
  }
  if (cobbled && t.b.some((b) => b.key[0] === 'c' && hexOfG([b.gx, b.gy]) === i)) {
    opts.push({ label: 'Rebuild a cottage as a town house', why: upgradeOne(t, i, false) ? null : 'No room for one to go two storeys', act: () => upgradeOne(t, i) })
  }
  menu.innerHTML = `<div class="mh">${c.terrain}${cobbled ? ', cobbled' : ''} · level ${c.tier}<button class="x" title="Close">✕</button></div>`
  for (const o of opts) {
    const b = document.createElement('button')
    b.textContent = o.label; b.disabled = !!o.why; b.title = o.why ?? ''
    if (o.why) { const s = document.createElement('span'); s.textContent = o.why; b.append(s) }
    b.addEventListener('click', () => { history.push(snapshot()); o.act(); changed(); fillMenu() })
    menu.append(b)
  }
  menu.querySelector('.x')!.addEventListener('click', closeMenu)
}

// ------------------------------------------------------------------ input
let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null
const toWorld = (e: MouseEvent): Pt => [camX + e.clientX / zoom, camY + e.clientY / zoom]
function hexUnder(e: MouseEvent): { col: number; row: number } | null {
  const [x, y] = toWorld(e)
  // try the higher levels first: a raised hex is drawn above where it sits on the plane
  for (let tier = 6; tier >= 0; tier--) {
    const o = pixelToHex(x, y + tier * TP, TW)
    if (!inWorld(o.col, o.row)) continue
    if (world.cells[idx(o.col, o.row)].tier === tier) return o
  }
  return null
}
/** The ground point under the pointer, on hex h's level. */
function groundUnder(e: MouseEvent, h: { col: number; row: number }): Pt {
  const [x, y] = toWorld(e)
  return gnd(x, y + world.cells[idx(h.col, h.row)].tier * TP)
}
cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: camX, cy: camY, moved: false } })
window.addEventListener('mousemove', (e) => {
  if (drag) {
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true
    if (drag.moved) { camX = drag.cx - (e.clientX - drag.x) / zoom; camY = drag.cy - (e.clientY - drag.y) / zoom }
  }
  hover = e.target === cv ? hexUnder(e) : null
  pointer = toWorld(e)
  const tip = $('tip')
  if (!town && hover && !drag?.moved) {
    const c = world.cells[idx(hover.col, hover.row)]
    const cl = claimAt(hover.col, hover.row, pointer[0], pointer[1])
    tip.style.display = 'block'; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 10}px`
    tip.textContent = `${c.terrain}${c.feature ? ', ' + c.feature : ''} (level ${c.tier})${cl && cl.corner >= 0 ? ': click to found here' : ': not here (three hexes of open land on one level)'}`
  } else tip.style.display = 'none'
})
window.addEventListener('mouseup', (e) => {
  if (drag && !drag.moved && e.target === cv) {
    const h = hexUnder(e)
    if (!town) {
      if (h) { const [x, y] = toWorld(e); const cl = claimAt(h.col, h.row, x, y); if (cl && cl.corner >= 0) found(cl) }
    } else if (h) { const i = idx(h.col, h.row); if (selected === i) closeMenu(); else openMenu(i, e.clientX, e.clientY, groundUnder(e, h)) }
    else closeMenu()
  }
  drag = null
})
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu() })
cv.addEventListener('wheel', (e) => {
  e.preventDefault()
  const [wx, wy] = toWorld(e)
  zoom = Math.max(1, Math.min(5, zoom + (e.deltaY < 0 ? 1 : -1)))
  camX = wx - e.clientX / zoom; camY = wy - e.clientY / zoom
}, { passive: false })

// ------------------------------------------------------------------ panel
const history: string[] = []
const snapshot = () => JSON.stringify({ b: town!.b, f: [...town!.found], n: town!.nextId, r: [...town!.roads] })
function restore(s: string) {
  const o = JSON.parse(s), t = town!
  t.b = o.b; t.found = new Set(o.f); t.nextId = o.n; t.roads = new Set(o.r)
  walkers = []; changed()
  if (selected !== null) fillMenu()
}
function changed() { grid = walkGrid(town!, town!.b); spawnWalkers(); ui() }
function say(m: string) { $('msg').textContent = m }
function ui() {
  $('pick').hidden = !!town; $('build').hidden = !town
  cv.classList.toggle('picking', !town)
  if (!town) return
  const p = pop(), houses = town.b.filter((b) => b.people > 0).length
  $('pop').textContent = String(p); $('nh').textContent = String(houses); $('nx').textContent = String(town.found.size)
  $('stage').textContent = p < 50 ? 'Hamlet' : p < 150 ? 'Village' : p < 350 ? 'Small town' : 'Market town'
  ;($('undo') as HTMLButtonElement).disabled = !history.length
}
document.querySelectorAll<HTMLButtonElement>('[data-grow]').forEach((btn) => btn.addEventListener('click', () => {
  history.push(snapshot())
  const g = btn.dataset.grow!
  const target = g.startsWith('+') ? Infinity : Number(g), n0 = town!.b.length
  let stuck = 0
  while (pop() < target && (g.startsWith('+') ? town!.b.length - n0 < Number(g.slice(1)) : true)) {
    if (!growOnce()) { if (++stuck > 3) break } else stuck = 0
  }
  say(pop() < target && !g.startsWith('+') ? `Full at ${pop()} people: no more open land within ${MAX_REACH} hexes of the square.` : '')
  changed()
  if (selected !== null) fillMenu()
}))
$('undo').addEventListener('click', () => { const s = history.pop(); if (s) restore(s) })
$('reset').addEventListener('click', () => { closeMenu(); town = null; walkers = []; history.length = 0; say(''); ui() })
;($('showDistrict') as HTMLInputElement).addEventListener('change', (e) => { show.found = (e.target as HTMLInputElement).checked })
;($('showFoot') as HTMLInputElement).addEventListener('change', (e) => { show.foot = (e.target as HTMLInputElement).checked })
;($('showWalk') as HTMLInputElement).addEventListener('change', (e) => { show.walk = (e.target as HTMLInputElement).checked })

function loadWorld(seed: string) {
  world = generateWorld(seed)
  town = null; walkers = []
  closeMenu()
  const rg = world.regions[world.startRegion]
  const p = hexToPixel(Math.round((rg.col0 + rg.col1) / 2), Math.round((rg.row0 + rg.row1) / 2), TW)
  camOn(p.x, p.y)
  ui()
}
;($('seed') as HTMLSelectElement).addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value
  loadWorld(v === '*' ? `demo-${Math.floor(Math.random() * 1e6)}` : v)
})
loadWorld('quex-sandbox')
requestAnimationFrame(frame)

// for automated checks
;(window as unknown as Record<string, unknown>).demo = {
  found, claimAt, build, growOnce, pop, place, cobble, cobbleError, roadError, roomFor, fits, screenOk, inView, allReachable, dims, centreG, tierAt, hexOfG, walkGrid, flood, cellNear, doorAt,
  get town() { return town }, get world() { return world },
  toScreen: (i: number, off: Pt = [0, 0]) => { const c = world.cells[i], p = hexToPixel(c.col, c.row, TW); return [(p.x + off[0] - camX) * zoom, (p.y + off[1] - c.tier * TP - camY) * zoom] },
}
