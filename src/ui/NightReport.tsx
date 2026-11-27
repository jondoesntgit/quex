/** The morning report: what last night's work made and used, building by building, with every step that scaled
 *  it (the day's score, morale, workers, tools, water, the season), then the flock, eating, spoiling and anything
 *  else the night did. Shown once, the first time the player opens the game after a night; the Village tab keeps
 *  it to read again. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FOOD, GOOD_LABEL, isBulk, type Good, type Goods } from '../game/data'
import { rationsOf, shown } from '../game/units'
import { weekSeason, SEASON_ICON } from '../game/calendar'
import type { NightReport, Player, Village } from '../game/types'
import type { Game } from '../app/store'
import { Icon } from './Icon'
import { arrivalPending } from './Arrivals'
import { hadNotice, markNotice, onScreen } from './notices'

const KEY = (villageId: string) => `quex:night:${villageId}`
function seenNight(villageId: string): string | null {
  try { return localStorage.getItem(KEY(villageId)) } catch { return null }
}
function rememberNight(villageId: string, date: string) {
  try { localStorage.setItem(KEY(villageId), date) } catch { /* private window: it just shows again */ }
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const dayName = (date: string) => DAY[new Date(`${date}T00:00:00Z`).getUTCDay()]

/** An amount of a good as the player counts it: rations for food, loads for bulk goods. */
function amount(g: Good, n: number) {
  const x = FOOD[g] ? rationsOf(g, n) : n
  const r = shown(x, Math.abs(x) >= 10 ? 1 : 0.1)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`
}
const unit = (g: Good) => (FOOD[g] ? ' rations' : isBulk(g) ? ' loads' : '')

function Deltas({ delta }: { delta: Goods }) {
  const rows = (Object.entries(delta) as [Good, number][]).filter(([g, n]) => Math.abs(FOOD[g] ? rationsOf(g, n) : n) >= 0.05)
  if (!rows.length) return <span className="muted">nothing</span>
  return (
    <span className="deltas">
      {rows.map(([g, n]) => (
        <span key={g} className={n > 0 ? 'up' : 'down'}><Icon name={g} title={GOOD_LABEL[g]} size={16} /> {amount(g, n)}{unit(g)}</span>
      ))}
    </span>
  )
}

export function NightReportCard({ r, onClose }: { r: NightReport; onClose: () => void }) {
  const total: Goods = {}
  for (const s of r.sources) for (const [g, n] of Object.entries(s.delta) as [Good, number][]) total[g] = (total[g] ?? 0) + n
  const season = weekSeason(r.date)
  return createPortal(
    <div className="modal fixed" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card breakdown night">
        <h2>{SEASON_ICON[season]} {dayName(r.date)} night</h2>
        <p className="muted" style={{ margin: '0 0 6px' }}>
          {season === 'winter'
            ? 'Winter: the buildings rested, and the village lived off its stores.'
            : <>Your score was <b>{r.score}/100</b>, so the buildings worked at <b>×{r.prod}</b> of a full day (×0.15 at 0, ×1 at 100), before morale and the rest below.</>}
        </p>
        <div className="row src-head total"><b>All together</b><Deltas delta={total} /></div>
        {r.sources.map((s, n) => (
          <div key={n} className="src">
            <div className="row src-head"><b>{s.label}</b><Deltas delta={s.delta} /></div>
            {s.factors.map((f, j) => <div key={j} className="row factor"><span>{f.label}</span><span>{f.value}</span></div>)}
          </div>
        ))}
        {!r.sources.length && <p className="muted">Nothing was made or used.</p>}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  )
}

/** Shown by itself once after each night (after any newcomers' note). */
export function MorningReport({ game, p }: { game: Game; p: Player }) {
  const v: Village | undefined = game.state.villages[p.villageId]
  const [, bump] = useState(0)
  const r = v?.lastNight
  const id = r ? `night:${r.date}` : ''
  const show = !!v && !!r && !game.guest && !arrivalPending(v, game.now())
    && (onScreen.has(id) || (!hadNotice(v, id) && seenNight(v.id) !== r.date))
  // had the moment it shows (on every device); it stays up until closed
  useEffect(() => {
    if (!show || !v || onScreen.has(id)) return
    onScreen.add(id)
    rememberNight(v.id, r!.date)
    markNotice(game, p, v, id)
  }, [show, id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null
  return <NightReportCard r={r!} onClose={() => { onScreen.delete(id); bump((x) => x + 1) }} />
}

/** The Village tab's way back to it. */
export function LastNightButton({ v }: { v: Village }) {
  const [open, setOpen] = useState(false)
  const r = v.lastNight
  if (!r) return null
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>📜 Last night ({dayName(r.date)})</button>
      {open && <NightReportCard r={r} onClose={() => setOpen(false)} />}
    </>
  )
}
