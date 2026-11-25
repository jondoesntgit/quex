import { describe, expect, it } from 'vitest'
import { seasonDaysLeft, seasonLastDay, weekday } from './calendar'

describe('season length', () => {
  it('ends on the Saturday of week 13', () => {
    expect(seasonLastDay('2026-11-15')).toBe('2027-02-13')
    expect(weekday(seasonLastDay('2026-11-15'))).toBe(6)
  })
  it('counts the days left after today', () => {
    expect(seasonDaysLeft('2026-11-15', '2026-11-15')).toBe(90)
    expect(seasonDaysLeft('2026-11-15', '2027-02-13')).toBe(0)
    expect(seasonDaysLeft('2026-11-15', '2027-02-14')).toBe(-1)
  })
})
