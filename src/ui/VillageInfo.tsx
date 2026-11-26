import { BUILDINGS, FOOD, STREAK_MAX, STREAK_STEP, type Good } from '../game/data'
import { GROW_MORALE, MORALE_PULL, WELCOME_DAYS, WELCOME_MORALE, dayScore, moraleParts, popCap, streakBonus } from '../game/reducer'
import { influx } from '../game/immigrants'
import { people } from '../game/workers'
import { weekSeason } from '../game/calendar'
import type { Game } from '../app/store'
import type { Player } from '../game/types'
import { useGame } from './helpers'

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`
const signed = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 10) / 10}`

/** Tap the people and morale chip: what lifts the village's work, its morale and its numbers, where each stands
 *  today, and how to raise it. */
export function VillageInfo({ game, p, onClose }: { game: Game; p: Player; onClose: () => void }) {
  useGame(game)
  const v = game.state.villages[p.villageId]
  if (!v) return null
  const today = game.today(p.id)
  const now = game.now().toISOString()
  const d = p.days[today] ?? { date: today, slots: [], frozen: false, ticked: false, habitsDone: [] }
  const score = dayScore(d)
  const winter = weekSeason(today) === 'winter'

  // work: what tonight's shifts are multiplied by
  const prod = winter ? 0 : 0.15 + 0.85 * (score / 100)
  const moraleK = 0.75 + v.morale / 200
  const streak = p.taskStreak ?? 0
  const bonusNow = streakBonus(p, d, today, now)
  const bonusIfPerfect = Math.min(STREAK_MAX, STREAK_STEP * (streak + 1))
  const library = done(v, 'library')

  // morale: where it's heading tonight (a little of every food is eaten, so every kind in store counts)
  const variety = (Object.keys(v.goods) as Good[]).filter((g) => FOOD[g] && (v.goods[g] ?? 0) > 0.01).length
  const parts = moraleParts(v, p, d, score, variety)
  const target = Math.max(0, Math.min(100, parts.reduce((a, x) => a + x.value, 0)))

  // people: newcomers the Sunday after winter
  const room = popCap(v) - v.population
  const coming = influx(v.population, room, v.morale, GROW_MORALE)

  return (
    <div className="modal account" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{v.name}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">✕</button>
        </div>

        <h3>Work: what tonight's shifts are multiplied by</h3>
        <ul className="info-list">
          <li><b>Today's tasks ({score}/100): ×{Math.round(prod * 100) / 100}</b><br />
            <span className="muted">{winter ? 'Saturday is winter: the buildings rest.' : 'From ×0.15 with nothing done to ×1 for every task. Finish more of today\'s tasks.'}</span></li>
          <li><b>Morale ({v.morale}): ×{Math.round(moraleK * 100) / 100}</b><br />
            <span className="muted">From ×0.75 at 0 to ×1.25 at 100. See morale below.</span></li>
          <li><b>Perfect days in a row ({streak}): {bonusNow > 0 ? pct(bonusNow) + ' tonight' : score >= 100 ? 'none' : `${pct(bonusIfPerfect)} if you finish every task today`}</b><br />
            <span className="muted">Finish all of a day's tasks: {pct(STREAK_STEP)} the first day, {pct(STREAK_STEP * 2)} the second, {pct(STREAK_STEP * 3)} the third, and so on up to {pct(STREAK_MAX)}. A day with tasks left starts it again; Saturdays and frozen days don't break it.</span></li>
          <li><b>Library habit: {library ? (d.habitsDone.some((h) => p.habits.find((x) => x.id === h)?.effect === 'library') ? '+5% today' : '+5% on days you read') : 'needs a Library'}</b><br />
            <span className="muted">Keep the reading habit, with a {BUILDINGS.library?.name ?? 'Library'} built.</span></li>
          <li><b>Each building</b><br />
            <span className="muted">Its workers (Village tab, Workers), tools (Village tab), and its ground: a sawmill on a river, rain on gardens. Tap a good in Stores to see tonight's working.</span></li>
        </ul>

        <h3>Morale: {v.morale}, heading for {Math.round(target)}</h3>
        <p className="muted" style={{ margin: '2px 0' }}>Each night morale moves {Math.round(MORALE_PULL * 100)}% of the way to where it's heading, which is the sum of these (as things stand today):</p>
        <ul className="info-list">
          {parts.map((x) => (
            <li key={x.label}><b>{x.label}: {x.label === 'Where it settles' ? x.value : signed(x.value)}</b><br /><span className="muted">{x.how}</span></li>
          ))}
        </ul>
        <p className="muted" style={{ margin: '2px 0' }}>
          Straight off: going hungry costs 6 (12 on the winter night), and a winter night with no wood or peat to burn costs 6.
          Sending a welcoming caravan to a new village (in its first {WELCOME_DAYS} days, no action needed: see the Log) lifts it by {WELCOME_MORALE}.
        </p>

        <h3>People: {Math.floor(v.population)} ({people(v)} at home)</h3>
        <ul className="info-list">
          <li><b>Room: {Math.floor(popCap(v))}</b><br /><span className="muted">Homes in the city: lay cobblestone and build cottages and town houses on it.</span></li>
          <li><b>Newcomers: {coming > 0 ? `about ${coming} the Sunday after winter` : 'none yet'}</b><br />
            <span className="muted">They come once a week, on Sunday after the winter night, if nobody went hungry on it, there's room for them, and morale is at least {GROW_MORALE}{v.morale < GROW_MORALE ? ` (it's ${v.morale} now)` : ''}{room < 1 ? ' (the homes are full now)' : ''}. About a fifth of the village comes at a time.</span></li>
        </ul>
      </div>
    </div>
  )
}

const done = (v: { buildings: { type: string; progress: number }[] }, type: string) => v.buildings.some((b) => b.type === type && b.progress >= 1)
