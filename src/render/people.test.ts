import { describe, expect, it } from 'vitest'
import { People } from './people'
import type { World } from '../world/types'

// three hexes in a column: row 0 tier 3 (back, high), row 1 tier 1, row 2 tier 1
function world(): World {
  const tiers = [3, 1, 1]
  const cells = tiers.map((tier, row) => ({ col: 0, row, tier, elev: 0, moist: 0, temp: 0, terrain: 'grass', feature: null, resource: null, riverTo: -1, riverFlow: 0, region: 0 }))
  return { seed: 't', width: 1, height: 3, regionSize: 3, seaLevel: 0, cells, regions: [], startRegion: 0, lairs: [] } as unknown as World
}

type Pose = { x: number; y: number; cell: number; front: boolean; kind: string; done: boolean }
function walk(path: number[]) {
  const W = 64, TP = 8
  const p = new People(W, TP) as unknown as { world: World; pose: (w: unknown, k: number, t: number) => Pose }
  p.world = world()
  const w = { path, jitter: path.map(() => [0, 0]) }
  const poses: Pose[] = []
  for (let t = 0; t < 30; t += 0.05) {
    const q = p.pose(w, 0, t)
    poses.push(q)
    if (q.done) break
  }
  return poses
}

describe('villager steps between tiers', () => {
  it('climbs a cliff hand over hand instead of floating', () => {
    const poses = walk([1, 0]) // tier 1 -> tier 3 (behind)
    const climb = poses.filter((q) => q.kind.startsWith('climb'))
    expect(climb.length).toBeGreaterThan(5)
    // straight up the face at the edge, alternating hands, never sideways
    expect(new Set(climb.map((q) => Math.round(q.x))).size).toBe(1)
    for (let k = 1; k < climb.length; k++) expect(climb[k].y).toBeLessThanOrEqual(climb[k - 1].y)
    expect(new Set(climb.map((q) => q.kind)).size).toBe(2)
    // walking parts stay level: no height change outside the climb
    const before = poses.slice(0, poses.indexOf(climb[0])).map((q) => q.y)
    expect(Math.min(...before) - Math.max(...before)).toBeLessThanOrEqual(0)
    expect(poses.at(-1)!.done).toBe(true)
    expect(poses.at(-1)!.cell).toBe(0)
  })
  it('hops down: a little up, then drops, then lands', () => {
    const poses = walk([0, 1]) // tier 3 -> tier 1 (in front)
    const hop = poses.filter((q) => q.kind === 'hop')
    expect(hop.length).toBeGreaterThan(3)
    const start = hop[0].y
    expect(Math.min(...hop.map((q) => q.y))).toBeLessThan(start) // lifts first
    expect(hop.at(-1)!.y).toBeGreaterThan(start + 8) // then falls most of 2 tiers
    expect(poses.some((q) => q.kind === 'land')).toBe(true)
    expect(poses.at(-1)!.done).toBe(true)
  })
  it('flat steps just walk', () => {
    const poses = walk([1, 2])
    expect(poses.every((q) => q.kind === 'walk')).toBe(true)
  })
  it('a climber up a cliff behind sorts with the lower hex in front of it', () => {
    const poses = walk([1, 0])
    expect(poses.filter((q) => q.kind.startsWith('climb')).every((q) => q.cell === 1)).toBe(true)
  })
})
