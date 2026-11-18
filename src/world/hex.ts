/** Flat-top hexes stored in "odd-q" offset layout (odd columns shifted down
 *  half a hex), matching the Blender camera and the 2025 Tiled maps. */

export interface Offset { col: number; row: number }
export interface Cube { q: number; r: number; s: number }

const EVEN = [[1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1]] as const
const ODD = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1]] as const

export function neighbours(col: number, row: number): [number, number][] {
  const d = col & 1 ? ODD : EVEN
  return d.map(([dc, dr]) => [col + dc, row + dr])
}

export function toCube(col: number, row: number): Cube {
  const q = col
  const r = row - (col - (col & 1)) / 2
  return { q, r, s: -q - r }
}

export function fromCube(c: Cube): Offset {
  return { col: c.q, row: c.r + (c.q - (c.q & 1)) / 2 }
}

export function distance(a: Offset, b: Offset): number {
  const ac = toCube(a.col, a.row)
  const bc = toCube(b.col, b.row)
  return Math.max(Math.abs(ac.q - bc.q), Math.abs(ac.r - bc.r), Math.abs(ac.s - bc.s))
}

/** All offsets within `radius` of centre (inclusive). */
export function spiral(centre: Offset, radius: number): Offset[] {
  const c = toCube(centre.col, centre.row)
  const out: Offset[] = []
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push(fromCube({ q: c.q + dq, r: c.r + dr, s: -(c.q + dq) - (c.r + dr) }))
    }
  }
  return out
}

/** Pixel position of a hex centre on the projected map (top face, tier 0).
 *  W = sprite width; face height = W/2; columns step 3/4 W. */
export function hexToPixel(col: number, row: number, W: number) {
  const face = W / 2
  return { x: col * W * 0.75 + W / 2, y: row * face + (col & 1 ? face / 2 : 0) + face / 2 }
}

/** Inverse of hexToPixel on the tier-0 plane (elevation ignored). */
export function pixelToHex(x: number, y: number, W: number): Offset {
  const face = W / 2
  // convert to an un-squashed flat-top axial space with size = W/2
  const size = W / 2
  const px = x - W / 2
  const py = (y - face / 2) * (Math.sqrt(3) * size) / face
  const q = (2 / 3) * px / size
  const r = (-1 / 3 * px + Math.sqrt(3) / 3 * py) / size
  return fromCube(cubeRound(q, r, -q - r))
}

function cubeRound(q: number, r: number, s: number): Cube {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  else rs = -rq - rr
  return { q: rq, r: rr, s: rs }
}
