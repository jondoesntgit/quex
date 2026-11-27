import { describe, expect, it } from 'vitest'
import sheet from '../../public/art/houses/houses.json'
import { decodeSite, doorOf, freeAt, sitePath, workSpot, type Site } from './footprint'

const W = 64
const B = sheet.buildings
const sites = Object.fromEntries(Object.keys(B.walk).map((k) => [k, decodeSite(B.grid, (B.walk as Record<string, string>)[k], (B.doors as unknown as Record<string, [number, number]>)[k])])) as Record<string, Site>
/** Where a road or a walker crosses each of the six edges (px from the centre). */
const edges = Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 3) * k + Math.PI / 6
  return { x: Math.cos(a) * 0.866 * (W / 2), y: -Math.sin(a) * 0.866 * (W / (2 * Math.sqrt(3))) }
})
/** Every point along the path, a pixel apart, keeps off the building (bar a step at each end). */
function offTheBuilding(s: Site, path: { x: number; y: number }[]) {
  const a = path[0], b = path[path.length - 1]
  for (let k = 1; k < path.length; k++) {
    const p = path[k - 1], q = path[k]
    const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y))
    for (let j = 0; j <= n; j++) {
      const m = { x: p.x + ((q.x - p.x) * j) / n, y: p.y + ((q.y - p.y) * j) / n }
      const nearEnd = Math.hypot(m.x - a.x, (m.y - a.y) * 1.7) < 4 || Math.hypot(m.x - b.x, (m.y - b.y) * 1.7) < 4
      if (!nearEnd && !freeAt(s, m, W)) return false
    }
  }
  return true
}

describe('building footprints from the Blender models', () => {
  it('every building has one, with its door on open ground', () => {
    expect(Object.keys(sites).length).toBeGreaterThanOrEqual(40)
    for (const [k, s] of Object.entries(sites)) expect(freeAt(s, doorOf(s, W), W), k).toBe(true)
  })
  it('roads and walkers get from every edge to the door, around what stands there', () => {
    for (const [k, s] of Object.entries(sites)) {
      for (const e of edges) {
        const path = sitePath(s, e, doorOf(s, W), W)
        expect(offTheBuilding(s, path), `${k} from edge ${JSON.stringify(e)}`).toBe(true)
      }
    }
  })
  it('walkers cross from edge to edge around the building', () => {
    for (const [k, s] of Object.entries(sites)) {
      for (const a of edges) for (const b of edges) {
        if (a === b) continue
        expect(offTheBuilding(s, sitePath(s, a, b, W)), k).toBe(true)
      }
    }
  })
  it('workers stand on open ground by the door', () => {
    let seed = 1
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (const [k, s] of Object.entries(sites)) for (let n = 0; n < 5; n++) expect(freeAt(s, workSpot(s, W, rng), W), k).toBe(true)
  })
  it('a building blocks its own middle, and a field lets people through', () => {
    expect(freeAt(sites.k_chapel, { x: 0, y: -2 }, W)).toBe(false)
    expect(freeAt(sites.k_field, { x: -10, y: 4 }, W)).toBe(true)
  })
})
