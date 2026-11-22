import { useEffect, useState } from 'react'
import { HABIT_PRESETS } from '../game/data'
import { foundingProblem, validate } from '../game/reducer'
import type { GameEvent } from '../game/types'
import { ROLES } from '../world/types'
import { eventId, type Game } from '../app/store'
import { ROLE_INFO, roleFits, type Fit, type Spot } from './helpers'

export type { Spot }

/** Found a village: name + first habit, then tap the map to pick the spot
 *  (what the land around it suits is shown, but any village can do anything). */
export function Onboarding({ game, site, linked, onStep, onDone, onCancel, first }: {
  game: Game
  /** the hex last tapped on the map while choosing */
  site: Spot | null
  /** 'place' lifts the fog and routes map taps here */
  onStep: (step: 'about' | 'place') => void
  onDone: (playerId: string) => void
  onCancel?: () => void
  first: boolean
  /** opened from a shared link: the linked hex is marked in pink */
  linked?: boolean
}) {
  const [step, setStep] = useState<'about' | 'place'>('about')
  const [name, setName] = useState('')
  const [habit, setHabit] = useState('water')
  const pid = useState(() => 'p_' + Math.random().toString(36).slice(2, 10))[0]
  const tz = -new Date().getTimezoneOffset()

  useEffect(() => { onStep(step) }, [step, onStep])
  const fits = site ? roleFits(game.world, game.state, site) : null
  // what the land within reach is good for, best first (a hint, not a commitment)
  const suits = fits ? [...ROLES].filter((r) => fits[r].fit !== 'ok').sort((a, b) => RANK[fits[b].fit] - RANK[fits[a].fit]) : []

  const problem = site ? foundingProblem(game.state, game.world, site) : null

  const go = async () => {
    if (!site) return
    const join: GameEvent = {
      t: 'join', id: eventId(), at: game.now().toISOString(), playerId: pid, name: name.trim() || 'Wanderer',
      site: { col: site.col, row: site.row }, resetHour: 3, tz,
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
              ? 'Your real-life quests power a little village in a hex world. Finish today\'s tasks and spend the actions you earn in order to better you and your party, then get back to life.'
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
      {!site && linked && <p style={{ margin: '0 0 6px' }}><b>The spot from your link is marked in pink.</b> Settle near it: tap a hex just outside the shaded land.</p>}
      {!site && <p style={{ margin: 0 }}><b>Tap any land to settle there.</b> <span className="muted">Pan and zoom to see the whole world. Shaded land is too close to a neighbour.</span></p>}
      {site && problem && <p style={{ margin: 0 }}><b>Can't settle here:</b> {problem}. <span className="muted">Try another hex.</span></p>}
      {site && !problem && fits && (
        <>
          <p style={{ margin: 0 }}><b>Good land for…</b> <span className="muted">(what's within 3 hexes)</span></p>
          {suits.length ? (
            <ul className="suits">
              {suits.map((r) => <li key={r}>{STARS[fits[r].fit]}<b>{ROLE_INFO[r].name}</b> <span className="muted">· {fits[r].why}</span></li>)}
            </ul>
          ) : <p className="muted" style={{ margin: '4px 0 0' }}>Nothing stands out here, but you can build what you like and trade for the rest.</p>}
          <p className="muted" style={{ margin: '6px 0 0' }}>Your village isn't tied to any of these: build whatever you like, and work out with your neighbours who makes what.</p>
        </>
      )}
      <p className="muted" style={{ margin: '8px 0 0' }}>You can abandon your village any time and settle somewhere new, but that resets your progress.</p>
      <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => setStep('about')}>← Back</button>
        <button className="btn primary" disabled={!site || !!problem} onClick={go}>Found village</button>
      </div>
    </div>
  )
}

const RANK: Record<Fit, number> = { great: 2, good: 1, ok: 0 }
const STARS: Record<Fit, string> = { great: '★★ ', good: '★ ', ok: '' }
