import { describe, expect, it } from 'vitest'
import { DEER_FROM, deerShown } from './herd'
import { generateWorld } from '../world/generate'
import { gameMax } from '../game/deposits'

describe('deer', () => {
  it('show only where game is plentiful: none on plain wild ground, two or three on a well-stocked game hex', () => {
    const world = generateWorld('test-seed')
    const plain = world.cells.findIndex((c) => c.terrain === 'forest' && c.resource !== 'game')
    const rich = world.cells.findIndex((c) => c.resource === 'game')
    expect(deerShown(gameMax(world, plain))).toBe(0)
    expect(deerShown(gameMax(world, rich))).toBe(3)
    expect(deerShown(DEER_FROM)).toBe(0)
    expect(deerShown(DEER_FROM + 1)).toBe(2)
  })
})

describe('no wool deposits', () => {
  it('worlds have none (wool comes from sheep pens)', () => {
    for (const seed of ['test-seed', 'quex-season-1']) expect(generateWorld(seed).cells.some((c) => c.resource === 'wool')).toBe(false)
  })
})
