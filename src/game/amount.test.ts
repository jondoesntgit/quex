import { describe, expect, it } from 'vitest'
import { shown } from './amount'

describe('amounts as shown', () => {
  it('round down, never up', () => {
    expect(shown(2.96)).toBe(2)
    expect(shown(2.96, 0.1)).toBe(2.9)
    expect(shown(-1.5)).toBe(-1)
  })
  it('never show 0 for something there is some of: used up, or the smallest step', () => {
    expect(shown(0.004)).toBe(0) // dust: used up
    expect(shown(0.3)).toBe(1)
    expect(shown(0.03, 0.1)).toBe(0.1)
    expect(shown(0.0004, 0.1)).toBe(0)
    expect(shown(0.003, 0.01)).toBe(0.01)
    expect(shown(0)).toBe(0)
  })
})
