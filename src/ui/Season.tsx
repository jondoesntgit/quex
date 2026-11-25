import { SEASON_ICON, SEASON_WEEKS, seasonDaysLeft, seasonLastDay, seasonWeek, weekSeason, type WeekSeason } from '../game/calendar'
import type { Game } from '../app/store'
import { useGame } from './helpers'

const longDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

const WEEK: { s: WeekSeason; days: string }[] = [
  { s: 'spring', days: 'Sunday and Monday' },
  { s: 'summer', days: 'Tuesday and Wednesday' },
  { s: 'autumn', days: 'Thursday and Friday' },
  { s: 'winter', days: 'Saturday (the Sabbath)' },
]

/** The calendar: how far through the world's season we are and how long it has left. */
export function Season({ game, onClose }: { game: Game; onClose: () => void }) {
  useGame(game)
  const today = game.today()
  const start = game.state.seasonStart
  const week = seasonWeek(start, today)
  const left = seasonDaysLeft(start, today)
  const weeksLeft = Math.floor(left / 7)
  const now = weekSeason(today)
  const leftText =
    left < 0 ? 'This world’s season is over.'
    : left === 0 ? 'Today is the world’s last day.'
    : left === 1 ? 'The world has one more day after today.'
    : `The world has ${left} more days after today${weeksLeft >= 1 ? ` (${weeksLeft === 1 ? 'a week' : `${weeksLeft} weeks`}${left % 7 ? ` and ${left % 7} day${left % 7 > 1 ? 's' : ''}` : ''})` : ''}.`
  return (
    <div className="modal account" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{SEASON_ICON[now]} Week {Math.min(week, SEASON_WEEKS)} of {SEASON_WEEKS}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p><b>{leftText}</b></p>
        <p>
          This world began on {longDate(start)} and lasts {SEASON_WEEKS} weeks: its last day
          is {longDate(seasonLastDay(start))}. Unspent actions keep until then.
        </p>
        <h3>Every week has four seasons</h3>
        <ul>
          {WEEK.map(({ s, days }) => (
            <li key={s} style={s === now ? { fontWeight: 'bold' } : undefined}>
              {SEASON_ICON[s]} {s[0].toUpperCase() + s.slice(1)}: {days}{s === now ? ' — now' : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
