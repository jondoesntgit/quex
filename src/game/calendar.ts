/** Player-local calendar. A player's "day" runs from resetHour to resetHour.
 *  Weekly seasons: Sun-Mon spring, Tue-Wed summer, Thu-Fri autumn, Sat winter (Sabbath). */
import type { ISODate } from './types'

export type WeekSeason = 'spring' | 'summer' | 'autumn' | 'winter'

/** The player's current game date for an instant. tz = minutes east of UTC. */
export function playerDate(at: string | Date, resetHour: number, tz: number): ISODate {
  const ms = (typeof at === 'string' ? Date.parse(at) : at.getTime()) + tz * 60_000 - resetHour * 3_600_000
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = Date.parse(d + 'T00:00:00Z') + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

export function weekday(d: ISODate): number {
  return new Date(d + 'T00:00:00Z').getUTCDay() // 0 = Sunday
}

export function weekSeason(d: ISODate): WeekSeason {
  const w = weekday(d)
  if (w <= 1) return 'spring'
  if (w <= 3) return 'summer'
  if (w <= 5) return 'autumn'
  return 'winter'
}

export const SEASON_WEEKS = 13

export function seasonWeek(seasonStart: ISODate, d: ISODate): number {
  return Math.floor(daysBetween(seasonStart, d) / 7) + 1
}

export const SEASON_ICON: Record<WeekSeason, string> = { spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' }

/** Crop multiplier for the weekday season. */
export const CROP_SEASON: Record<WeekSeason, number> = { spring: 0.7, summer: 1.1, autumn: 1.4, winter: 0 }
