import { describe, expect, it } from 'vitest'
import sheet from '../../public/art/houses/houses.json'
import { houseSpots, pick01, villageSpots, type Spot } from './townlayout'

const SQ = 0.5774
const frames = sheet.frames as Record<string, number[]>
const feet = sheet.footprints as Record<string, number[]>

/** A building's ground footprint (px), from the Blender model: [x0, x1, y0, y1] about its anchor. */
function box(s: Spot) {
  const [x0, x1, y0, y1] = feet[s.key]
  const hx = Math.max(-x0, x1), hy = Math.max(-y0, y1)
  return { x: s.x, y: s.y / SQ, hx, hy }
}
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => Math.abs(a.x - b.x) < a.hx + b.hx && Math.abs(a.y - b.y) < a.hy + b.hy
/** Inside a 64×32 hex face (screen px from its centre): |dy| <= 16 and |dx| + |dy| <= 32. */
const inHex = (x: number, y: number, slack = 0) => Math.abs(y) <= 16 + slack && Math.abs(x) + Math.abs(y) <= 32 + slack

describe('what stands on a village or House hex', () => {
  const hexes = Array.from({ length: 400 }, (_, i) => i * 37 + 5)

  it('the overlap check can tell (control)', () => {
    const a = box({ key: 't_tile_y_0', x: 0, y: 0 })
    expect(overlaps(a, box({ key: 't_tile_y_0', x: 5, y: 2 }))).toBe(true)
    expect(overlaps(a, box({ key: 't_tile_y_0', x: 60, y: 0 }))).toBe(false)
  })

  it('uses only sprites that are on the sheet, with footprints', () => {
    for (const i of hexes) for (const s of [...villageSpots(i), ...houseSpots(i)]) {
      expect(frames[s.key], s.key).toBeTruthy()
      expect(feet[s.key], s.key).toBeTruthy()
    }
  })

  it('never puts two buildings on top of each other', () => {
    for (const i of hexes) for (const spots of [villageSpots(i), houseSpots(i)]) {
      const bs = spots.map(box)
      for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) {
        expect(overlaps(bs[a], bs[b]), `${spots[a].key} / ${spots[b].key} (hex ${i})`).toBe(false)
      }
    }
  })

  it('keeps each building’s centre on its hex', () => {
    for (const i of hexes) for (const s of [...villageSpots(i), ...houseSpots(i)]) expect(inHex(s.x, s.y), s.key).toBe(true)
  })

  it('looks the same for the same hex, and varies between hexes', () => {
    expect(villageSpots(1234)).toEqual(villageSpots(1234))
    expect(new Set(hexes.map((i) => villageSpots(i).map((s) => s.key).join())).size).toBeGreaterThan(40)
    expect(new Set(hexes.map((i) => houseSpots(i).map((s) => s.key).join())).size).toBeGreaterThan(40)
  })

  it('has a village: a well and three two-storey town houses', () => {
    const s = villageSpots(7)
    expect(s.filter((x) => x.key.startsWith('t_'))).toHaveLength(3)
    expect(s.filter((x) => x.key === 'well')).toHaveLength(1)
  })

  it('hashes into 0..1', () => {
    for (let i = 0; i < 200; i++) { const p = pick01(i, 3); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(1) }
  })
})
