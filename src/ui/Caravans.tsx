import { useEffect, useState } from 'react'
import { fmtGoods } from '../game/reducer'
import type { Caravan } from '../game/types'
import type { Game } from '../app/store'
import { useGame } from './helpers'
import { Market } from './Market'

/** How long arrived caravans stay on the page. */
const RECENT_MS = 3 * 86_400_000

/** A time on this device's clock: "3:40 PM", with the weekday when it isn't today. */
export function clockTime(at: Date | string, now: Date): string {
  const d = typeof at === 'string' ? new Date(at) : at
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}

/** "1 h 20 min", "45 min", "under a minute" */
export function span(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'under a minute'
  const h = Math.floor(m / 60)
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
}

/** Every caravan on the world's roads, and the ones that arrived lately. */
export function Caravans({ game, onClose }: { game: Game; onClose: () => void }) {
  useGame(game)
  // keep the countdowns moving
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t) }, [])
  const now = game.now()
  const s = game.state
  const name = (id: string, kept?: string) => s.villages[id]?.name ?? kept ?? 'a village since abandoned'
  const me = game.meta.activePlayer ? s.players[game.meta.activePlayer] : undefined
  const mine = new Set(game.meta.localPlayers.map((pid) => s.players[pid]?.villageId).filter(Boolean))
  const road = [...s.caravans].sort((a, b) => a.arriveAt.localeCompare(b.arriveAt))
  const recent = (s.arrived ?? []).filter((c) => now.getTime() - Date.parse(c.arriveAt) < RECENT_MS).reverse()
  const who = (c: Caravan) => (
    <>
      <b className={mine.has(c.from) ? 'mine' : ''}>{name(c.from, c.fromName)}</b> → <b className={mine.has(c.to) ? 'mine' : ''}>{name(c.to, c.toName)}</b>
    </>
  )
  return (
    <div className="modal account" onClick={onClose}>
      <div className="card caravans" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Caravans</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        {me && <Market game={game} p={me} />}
        <h3>On the road</h3>
        {road.length === 0 && <p className="muted">No caravans on the road right now.</p>}
        <ul className="caravan-list">
          {road.map((c) => (
            <li key={c.id}>
              {who(c)}
              <div className="muted">{fmtGoods(c.goods)}</div>
              <div>Arrives {clockTime(c.arriveAt, now)} <span className="muted">(in {span(Date.parse(c.arriveAt) - now.getTime())})</span></div>
            </li>
          ))}
        </ul>
        <h3>Arrived lately</h3>
        {recent.length === 0 && <p className="muted">None in the last three days.</p>}
        <ul className="caravan-list">
          {recent.map((c) => (
            <li key={c.id}>
              {who(c)}
              <div className="muted">{fmtGoods(c.goods)}</div>
              <div>Arrived {clockTime(c.arriveAt, now)}</div>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>Times are on this device's clock.</p>
      </div>
    </div>
  )
}
