/** Where people and roads can go on a building's hex. Each building sprite comes with a walking grid
 *  derived from its Blender model (tools/blender/render_buildings.py): every cell that anything standing on
 *  the hex (walls, stacks, fences, pits) comes within a cell's width of is blocked, and the door is the free
 *  cell near the front that every edge of the hex can reach. Villagers cross the hex around what stands on
 *  it, and roads run from each edge to the door around it.
 *
 *  Grid space is the model's: x -1..1 across the hex (radius 1), y -0.875..0.875 from front to back.
 *  On screen a model unit is W/2 px across and W/(2*sqrt 3) px up the screen (the ground is foreshortened).
 *  Points here are px relative to the hex centre, on its top face. Pure geometry (no Pixi), so it is testable. */

export interface Pt { x: number; y: number }
export interface SiteGrid { cols: number; rows: number; cell: number; x0: number; y0: number }
export interface Site extends SiteGrid {
  /** 1 where blocked, row-major from the front row */
  blocked: Uint8Array
  /** the door, in model units */
  door: [number, number]
}

const R3 = Math.sqrt(3)

/** Decode a grid packed as hex digits (row-major from the front row, a bit per cell, 1 = blocked). */
export function decodeSite(g: SiteGrid, hex: string, door: [number, number]): Site {
  const n = g.cols * g.rows
  const blocked = new Uint8Array(n)
  const pad = Math.ceil(n / 4) - hex.length
  for (let k = 0; k < hex.length; k++) {
    const v = parseInt(hex[k], 16)
    for (let b = 0; b < 4; b++) {
      const i = (k + pad) * 4 + b
      if (i < n) blocked[i] = (v >> (3 - b)) & 1
    }
  }
  return { ...g, blocked, door }
}

export const toPx = (ux: number, uy: number, W: number): Pt => ({ x: (ux * W) / 2, y: (-uy * W) / (2 * R3) })
const toUnits = (p: Pt, W: number): [number, number] => [(p.x * 2) / W, (-p.y * 2 * R3) / W]

/** The door, px from the hex centre. */
export const doorOf = (s: Site, W: number) => toPx(s.door[0], s.door[1], W)

function cellAt(s: Site, p: Pt, W: number): [number, number] {
  const [ux, uy] = toUnits(p, W)
  return [Math.floor((uy - s.y0) / s.cell), Math.floor((ux - s.x0) / s.cell)]
}
function centre(s: Site, r: number, c: number, W: number): Pt {
  return toPx(s.x0 + (c + 0.5) * s.cell, s.y0 + (r + 0.5) * s.cell, W)
}
/** Is the cell free to stand on: on the grid, not blocked, its middle on the hex top. */
function open(s: Site, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r >= s.rows || c >= s.cols || s.blocked[r * s.cols + c]) return false
  const ux = Math.abs(s.x0 + (c + 0.5) * s.cell), uy = Math.abs(s.y0 + (r + 0.5) * s.cell)
  return uy <= 0.866 && ux <= 1 - uy / R3
}

/** Is p on ground nothing stands on? */
export function freeAt(s: Site, p: Pt, W: number): boolean {
  const [r, c] = cellAt(s, p, W)
  return open(s, r, c)
}

/** The free cell nearest p (its middle, px), or null if the hex is all built over. */
export function nearestFree(s: Site, p: Pt, W: number): Pt | null {
  let best: Pt | null = null, bd = Infinity
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (!open(s, r, c)) continue
    const q = centre(s, r, c, W)
    const d = Math.hypot(q.x - p.x, (q.y - p.y) * 2)
    if (d < bd) { bd = d; best = q }
  }
  return best
}

/** A way from a to b (px from the hex centre) that keeps off everything standing on the hex: the shortest
 *  path over the free cells, pulled straight wherever the ground between allows. Starts at a and ends at b
 *  even if they're on the hex's rim or just inside a margin (an edge point, a doorstep). */
export function sitePath(s: Site, a: Pt, b: Pt, W: number): Pt[] {
  const slack = (s.cell * W) / 2 * 1.6 // cells this near either end needn't be on free ground
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, (p.y - q.y) * R3) <= slack
  // every cell the straight line from p to q passes through (an exact grid walk) must be open,
  // except right by the two ends
  const clear = (p: Pt, q: Pt) => {
    const [px, py] = toUnits(p, W), [qx, qy] = toUnits(q, W)
    let gx = (px - s.x0) / s.cell, gy = (py - s.y0) / s.cell
    const ex = (qx - s.x0) / s.cell, ey = (qy - s.y0) / s.cell
    let c = Math.floor(gx), r = Math.floor(gy)
    const c1 = Math.floor(ex), r1 = Math.floor(ey)
    const dx = ex - gx, dy = ey - gy
    const sx = Math.sign(dx), sy = Math.sign(dy)
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity
    let tx = dx ? (sx > 0 ? c + 1 - gx : gx - c) * tdx : Infinity
    let ty = dy ? (sy > 0 ? r + 1 - gy : gy - r) * tdy : Infinity
    for (let k = 0; k < 4 * (s.cols + s.rows); k++) {
      if (!open(s, r, c)) {
        const m = centre(s, r, c, W)
        if (!near(m, a) && !near(m, b)) return false
      }
      if (c === c1 && r === r1) return true
      if (Math.abs(tx - ty) < 1e-9) {
        // through a corner exactly: both cells beside it count
        for (const [rr, cc] of [[r, c + sx], [r + sy, c]]) {
          if (!open(s, rr, cc)) { const m = centre(s, rr, cc, W); if (!near(m, a) && !near(m, b)) return false }
        }
      }
      if (tx < ty) { c += sx; tx += tdx } else { r += sy; ty += tdy }
    }
    return true
  }
  if (clear(a, b)) return [a, b]
  const start = nearestFree(s, a, W), goal = nearestFree(s, b, W)
  if (!start || !goal) return [a, b]
  const [r0, c0] = cellAt(s, start, W), [r1, c1] = cellAt(s, goal, W)
  // A* over the free cells, eight ways (render_buildings.py's door check moves the same way)
  const n = s.rows * s.cols
  const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n)
  const h = (r: number, c: number) => Math.hypot(r - r1, c - c1)
  const from = r0 * s.cols + c0, to = r1 * s.cols + c1
  g[from] = 0
  const openSet = [from]
  while (openSet.length) {
    let bi = 0
    for (let k = 1; k < openSet.length; k++) {
      const x = openSet[k], y = openSet[bi]
      if (g[x] + h(Math.floor(x / s.cols), x % s.cols) < g[y] + h(Math.floor(y / s.cols), y % s.cols)) bi = k
    }
    const cur = openSet.splice(bi, 1)[0]
    if (cur === to) break
    if (done[cur]) continue
    done[cur] = 1
    const r = Math.floor(cur / s.cols), c = cur % s.cols
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      if (!open(s, r + dr, c + dc)) continue
      if (dr && dc && (!open(s, r + dr, c) || !open(s, r, c + dc))) continue // never across a blocked cell's corner
      const j = (r + dr) * s.cols + c + dc
      const ng = g[cur] + (dr && dc ? Math.SQRT2 : 1)
      if (ng < g[j]) { g[j] = ng; prev[j] = cur; openSet.push(j) }
    }
  }
  if (g[to] === Infinity) return [a, b]
  const cells: Pt[] = []
  for (let k = to; k !== -1; k = prev[k]) cells.push(centre(s, Math.floor(k / s.cols), k % s.cols, W))
  cells.reverse()
  // pull the string: from each point, on to the furthest one in clear sight
  const pts = [a, ...cells, b]
  const out = [a]
  let i = 0
  while (i < pts.length - 1) {
    let j = i + 1
    while (j + 1 < pts.length && clear(pts[i], pts[j + 1])) j++
    out.push(pts[j])
    i = j
  }
  return out
}

/** Somewhere to stand and work near the door: free ground a step or so from it. */
export function workSpot(s: Site, W: number, rng: () => number): Pt {
  const d = doorOf(s, W)
  const p = { x: d.x + (rng() - 0.5) * W * 0.16, y: d.y + (rng() - 0.5) * W * 0.04 }
  return freeAt(s, p, W) ? p : nearestFree(s, p, W) ?? d
}
