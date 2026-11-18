import { useState } from 'react'
import { HABIT_PRESETS } from '../game/data'
import { validate } from '../game/reducer'
import type { GameEvent } from '../game/types'
import type { VillageSite } from '../world/types'
import { eventId, type Game } from '../app/store'
import { ROLE_INFO } from './helpers'

/** Found a village: name, role (starter-region site), first habit. */
export function Onboarding({ game, onPreview, onDone, onCancel, first }: {
  game: Game
  onPreview: (s: VillageSite | null) => void
  onDone: (playerId: string) => void
  onCancel?: () => void
  first: boolean
}) {
  const [name, setName] = useState('')
  const [site, setSite] = useState<VillageSite | null>(null)
  const [habit, setHabit] = useState('water')
  const region = game.world.regions[game.world.startRegion]
  const pid = useState(() => 'p_' + Math.random().toString(36).slice(2, 10))[0]
  const tz = -new Date().getTimezoneOffset()

  const joinEv = (s: VillageSite): GameEvent => ({
    t: 'join', id: eventId(), at: game.now().toISOString(), playerId: pid, name: name.trim() || 'Wanderer',
    role: s.role, site: { col: s.col, row: s.row }, resetHour: 3, tz,
  })
  const free = region.sites.filter((s) => !validate(game.state, game.world, joinEv(s)))

  const go = async () => {
    if (!site) return
    await game.dispatch(joinEv(site))
    const h = HABIT_PRESETS.find((x) => x.id === habit)!
    await game.dispatch({ t: 'habitAdd', id: eventId(), at: game.now().toISOString(), playerId: pid, habit: { id: h.id, name: h.name, effect: h.effect } })
    game.meta.localPlayers.push(pid)
    game.meta.activePlayer = pid
    game.meta.joinedOn[pid] = game.today(pid)
    game.saveMeta()
    onDone(pid)
  }

  return (
    <div className="modal" style={{ alignItems: site ? 'flex-end' : 'center' }}>
      <div className="card">
        {first && <h1>QUEX</h1>}
        <p style={{ marginTop: 0 }}>
          {first
            ? 'Your real-life tasks power a little village in a hex world. Finish today’s 1-2-3 tasks, spend the action you earn, then get back to life.'
            : 'Add a friend on this device to try co-op before the online version is set up.'}
        </p>
        <p className="muted">Region: <b>{region.name}</b> · season week 1 of 13</p>
        <label>Name</label>
        <input type="text" value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} maxLength={20} />
        <label>Village (each suits a different role, so friends depend on each other)</label>
        {free.map((s) => (
          <button key={`${s.col},${s.row}`} className={`btn choice ${site === s ? 'on' : ''}`} onClick={() => { setSite(s); onPreview(s) }}>
            <b>{ROLE_INFO[s.role].name}</b> <span className="muted">— {ROLE_INFO[s.role].blurb}</span>
          </button>
        ))}
        {!free.length && <p className="muted">Every starter site is taken.</p>}
        <label>First habit (unlock more with perfect weeks)</label>
        <div className="row">
          {HABIT_PRESETS.map((h) => (
            <button key={h.id} className={`btn ${habit === h.id ? 'primary' : ''}`} onClick={() => setHabit(h.id)} title={h.blurb}>{h.name}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          {onCancel && <button className="btn" onClick={() => { onPreview(null); onCancel() }}>Cancel</button>}
          <button className="btn primary" disabled={!site} onClick={go}>Found village</button>
        </div>
      </div>
    </div>
  )
}
