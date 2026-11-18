import { describe, expect, it } from 'vitest'
import { generateWorld } from './generate'
import { distance, hexToPixel, neighbours, pixelToHex } from './hex'

const world = generateWorld('test-seed')

describe('hex maths', () => {
  it('neighbours are all at distance 1', () => {
    for (const [c, r] of [[4, 4], [5, 4], [0, 0], [7, 9]]) {
      for (const [nc, nr] of neighbours(c, r)) expect(distance({ col: c, row: r }, { col: nc, row: nr })).toBe(1)
    }
  })
  it('pixelToHex inverts hexToPixel', () => {
    for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) {
      const p = hexToPixel(c, r, 32)
      expect(pixelToHex(p.x, p.y, 32)).toEqual({ col: c, row: r })
    }
  })
})

describe('generateWorld', () => {
  it('is deterministic for a seed', () => {
    const again = generateWorld('test-seed')
    expect(again.cells.map((c) => c.terrain + c.tier + c.resource)).toEqual(world.cells.map((c) => c.terrain + c.tier + c.resource))
    expect(again.startRegion).toBe(world.startRegion)
  })
  it('differs between seeds', () => {
    const other = generateWorld('another-seed')
    const same = other.cells.filter((c, i) => c.terrain === world.cells[i].terrain).length
    expect(same / other.cells.length).toBeLessThan(0.9)
  })
  it('has roughly the requested land fraction', () => {
    const land = world.cells.filter((c) => c.tier > 0).length / world.cells.length
    expect(land).toBeGreaterThan(0.4)
    expect(land).toBeLessThan(0.6)
  })
  it('water is tier 0 and land is tier 1..6', () => {
    for (const c of world.cells) {
      const water = c.terrain === 'deep' || c.terrain === 'ocean' || c.terrain === 'shallow'
      expect(water ? c.tier === 0 : c.tier >= 1 && c.tier <= 6).toBe(true)
    }
  })
  it('every river ends in water and never climbs a tier', () => {
    for (const c of world.cells) {
      if (c.riverTo === -1 || c.tier === 0) continue
      let cur = c, steps = 0
      while (cur.tier > 0 && steps++ < 400) {
        const next = world.cells[cur.riverTo]
        expect(next.tier).toBeLessThanOrEqual(cur.tier)
        cur = next
      }
      expect(cur.tier).toBe(0)
    }
  })
  it('starter region offers at least 4 distinct village roles, spaced apart', () => {
    const sr = world.regions[world.startRegion]
    expect(new Set(sr.sites.map((s) => s.role)).size).toBeGreaterThanOrEqual(4)
    for (const a of sr.sites) for (const b of sr.sites) if (a !== b) expect(distance(a, b)).toBeGreaterThanOrEqual(5)
    expect(sr.danger).toBe(0)
  })
  it('no gold anywhere, and tin only on the frontier', () => {
    for (const c of world.cells) {
      expect(c.resource).not.toBe('gold')
      if (c.resource === 'tin') expect(world.regions[c.region].danger).toBeGreaterThanOrEqual(2)
    }
  })
  it('keeps lairs away from starter village sites', () => {
    const sites = world.regions[world.startRegion].sites
    for (const l of world.lairs) for (const s of sites) expect(distance(l, s)).toBeGreaterThanOrEqual(6)
  })
  it('works across many seeds', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const w = generateWorld(seed)
      expect(w.regions[w.startRegion].sites.length).toBeGreaterThanOrEqual(4)
    }
  })
})
