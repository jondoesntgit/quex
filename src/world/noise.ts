/** Seeded 2D simplex noise + fractal helper. */
import { mulberry32 } from './rng'

const G = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]
const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6

export type Noise2 = (x: number, y: number) => number

export function simplex2(seed: number): Noise2 {
  const rng = mulberry32(seed)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]

  return (xin, yin) => {
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    const corner = (x: number, y: number, gi: number) => {
      let tt = 0.5 - x * x - y * y
      if (tt < 0) return 0
      tt *= tt
      const g = G[gi & 7]
      return tt * tt * (g[0] * x + g[1] * y)
    }
    n += corner(x0, y0, perm[ii + perm[jj]])
    n += corner(x1, y1, perm[ii + i1 + perm[jj + j1]])
    n += corner(x2, y2, perm[ii + 1 + perm[jj + 1]])
    return 70 * n // ~[-1, 1]
  }
}

/** Fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(n: Noise2, x: number, y: number, octaves = 4, lac = 2, gain = 0.5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lac
  }
  return sum / norm
}
