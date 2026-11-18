import { useEffect, useState } from 'react'
import { HABIT_PRESETS } from '../game/data'
import { foundingProblem, validate } from '../game/reducer'
import type { GameEvent } from '../game/types'
import { ROLES, type Role } from '../world/types'
import { eventId, type Game } from '../app/store'
import { ROLE_INFO, suggestRole, type Spot } from './helpers'

export type { Spot }

/** Found a village: name + first habit, then tap the map to pick the spot
 *  and choose a role (one is suggested from the land around it). */
export function Onboarding({ game, site, onStep, onDone, onCancel, first }: {
  game: Game
  /** the hex last tapped on the map while choosing */
  site: Spot | null
  /** 'place' lifts the fog and routes map taps here */
  onStep: (step: 'about' | 'place') => void
  onDone: (playerId: string) => void
  onCancel?: () => void
  first: boolean
}) {
  const [step, setStep] = useState<'about' | 'place'>('about')
  const [name, setName] = useState('')
  const [habit, setHabit] = useState('water')
  const [picked, setPicked] = useState<{ key: string; role: Role } | null>(null)
  const pid = useState(() => 'p_' + Math.random().toString(36).slice(2, 10))[0]
  const tz = -new Date().getTimezoneOffset()

  useEffect(() => { onStep(step) }, [step, onStep])
  const suggested = site ? suggestRole(game.world, game.state, site) : null
  // a role pick sticks to the spot it was made for; a new spot starts from its suggestion
  const siteKey = site ? `${site.col},${site.row}` : ''
  const role = picked?.key === siteKey ? picked.role : suggested
  const setRole = (r: Role) => setPicked({ key: siteKey, role: r })

  const problem = site ? foundingProblem(game.state, game.world, site) : null

  const go = async () => {
    if (!site || !role) return
    const join: GameEvent = {
      t: 'join', id: eventId(), at: game.now().toISOString(), playerId: pid, name: name.trim() || 'Wanderer',
      role, site: { col: site.col, row: site.row }, resetHour: 3, tz,
    }
    const err = validate(game.state, game.world, join)
    if (err) return
    await game.dispatch(join)
    const h = HABIT_PRESETS.find((x) => x.id === habit)!
    await game.dispatch({ t: 'habitAdd', id: eventId(), at: game.now().toISOString(), playerId: pid, habit: { id: h.id, name: h.name, effect: h.effect } })
    game.meta.localPlayers.push(pid)
    game.meta.activePlayer = pid
    game.meta.joinedOn[pid] = game.today(pid)
    game.saveMeta()
    onDone(pid)
  }

  if (step === 'about') {
    return (
      <div className="modal">
        <div className="card">
          {first && <h1>QUEX</h1>}
          <p style={{ marginTop: 0 }}>
            {first
              ? 'Your real-life tasks power a little village in a hex world. Finish today’s 1-2-3 tasks, spend the action you earn, then get back to life.'
              : 'Add a friend on this device to try co-op before the online version is set up.'}
          </p>
          <label>Name</label>
          <input type="text" value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} maxLength={20} />
          <label>First habit (unlock more with perfect weeks)</label>
          <div className="row">
            {HABIT_PRESETS.map((h) => (
              <button key={h.id} className={`btn ${habit === h.id ? 'primary' : ''}`} onClick={() => setHabit(h.id)} title={h.blurb}>{h.name}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
            <button className="btn primary" onClick={() => setStep('place')}>Choose where to settle →</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="placebar card">
      {!site && <p style={{ margin: 0 }}><b>Tap any land to settle there.</b> <span className="muted">Pan and zoom to see the whole world. Red land is too close to a neighbour.</span></p>}
      {site && problem && <p style={{ margin: 0 }}><b>Can’t settle here:</b> {problem}. <span className="muted">Try another hex.</span></p>}
      {site && !problem && (
        <>
          <p style={{ margin: '0 0 6px' }}><b>Settle here as…</b> <span className="muted">(★ suits this land)</span></p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {ROLES.map((r) => (
              <button key={r} className={`btn ${role === r ? 'primary' : ''}`} title={ROLE_INFO[r].blurb} onClick={() => setRole(r)}>
                {r === suggested ? '★ ' : ''}{ROLE_INFO[r].name}
              </button>
            ))}
          </div>
          {role && <p className="muted" style={{ margin: '6px 0 0' }}>{ROLE_INFO[role].blurb}</p>}
        </>
      )}
      <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => setStep('about')}>← Back</button>
        <button className="btn primary" disabled={!site || !!problem || !role} onClick={go}>Found village</button>
      </div>
    </div>
  )
}
