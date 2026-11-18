import { useState } from 'react'
import { BUILDINGS, GOOD_LABEL, HABIT_PRESETS, MAX_HABIT_SLOTS, PERFECT_DAYS_PER_SLOT, SIZE_POINTS, type Good } from '../game/data'
import { dayScore, defence, foodStock, popCap, storageCap } from '../game/reducer'
import type { Player, TaskStatus } from '../game/types'
import { eventId, type Game } from '../app/store'
import { ROLE_INFO, SIZE_LABEL } from './helpers'
import { Icon } from './Icon'

export function TodayPanel({ game, p }: { game: Game; p: Player }) {
  const date = game.today(p.id)
  const day = p.days[date]
  const slots = day?.slots ?? ['big', 'medium', 'medium', 'small', 'small', 'small'].map((size) => ({ size, status: 'none' as TaskStatus }))
  const set = (slot: number, status: TaskStatus) =>
    game.dispatch({ t: 'progress', id: eventId(), at: game.now().toISOString(), playerId: p.id, date, slot, status })
  const toggleHabit = (habitId: string, done: boolean) =>
    game.dispatch({ t: 'habit', id: eventId(), at: game.now().toISOString(), playerId: p.id, date, habitId, done })
  const [adding, setAdding] = useState(false)
  const free = p.habitSlots - p.habits.length

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Today · {dayScore(day)}/100</h3>
        <span className="muted">Labels stay on this device</span>
      </div>
      {slots.map((s, i) => (
        <div className="slot" key={i}>
          <span className={`size ${s.size}`}>{SIZE_LABEL[s.size as keyof typeof SIZE_LABEL]} {SIZE_POINTS[s.size as keyof typeof SIZE_POINTS]}</span>
          <input
            placeholder={s.size === 'big' ? 'The one big thing…' : s.size === 'medium' ? 'A medium task…' : 'A small task…'}
            value={game.label(p.id, date, i)}
            onChange={(e) => game.setLabel(p.id, date, i, e.target.value)}
          />
          <div className="tri" role="group" aria-label="progress">
            {(['none', 'half', 'full'] as TaskStatus[]).map((st) => (
              <button key={st} className={`${st} ${s.status === st ? 'on' : ''}`} onClick={() => set(i, st)} title={st}>
                {st === 'none' ? '·' : st === 'half' ? '½' : '✓'}
              </button>
            ))}
          </div>
        </div>
      ))}

      <h3>Habits · slot {p.habits.length}/{p.habitSlots}</h3>
      <p className="muted" style={{ margin: '0 0 4px' }}>
        Perfect days: {p.perfectStreak}/{PERFECT_DAYS_PER_SLOT} to unlock slot {Math.min(MAX_HABIT_SLOTS, p.habitSlots + 1)}. Missing a day never loses a slot.
      </p>
      {p.habits.map((h) => (
        <label className="habit" key={h.id}>
          <input type="checkbox" checked={!!day?.habitsDone.includes(h.id)} onChange={(e) => toggleHabit(h.id, e.target.checked)} />
          {h.effect === 'rain' && <Icon name="water" size={16} />}
          <span>{h.name}</span>
          <span className="muted">{HABIT_PRESETS.find((x) => x.id === h.id)?.blurb}</span>
        </label>
      ))}
      {free > 0 && !adding && <button className="btn" onClick={() => setAdding(true)}>+ Add habit</button>}
      {adding && (
        <div className="row">
          {HABIT_PRESETS.filter((h) => !p.habits.some((x) => x.id === h.id)).map((h) => (
            <button key={h.id} className="btn" onClick={() => {
              setAdding(false)
              game.dispatch({ t: 'habitAdd', id: eventId(), at: game.now().toISOString(), playerId: p.id, habit: { id: h.id, name: h.name, effect: h.effect } })
            }}>{h.name}</button>
          ))}
        </div>
      )}

      <h3><Icon name="freeze" size={16} /> Freezes</h3>
      <div className="row">
        <span className="muted">{p.freezes} left this week. A frozen day is shown to neighbours.</span>
        <button className="btn" disabled={p.freezes <= 0 || day?.frozen}
          onClick={() => game.dispatch({ t: 'freeze', id: eventId(), at: game.now().toISOString(), playerId: p.id, date })}>
          {day?.frozen ? 'Frozen ❄' : 'Freeze today'}
        </button>
      </div>
    </div>
  )
}

export function VillagePanel({ game, p, onAbandon }: { game: Game; p: Player; onAbandon: () => void }) {
  const v = game.state.villages[p.villageId]
  const [confirm, setConfirm] = useState(false)
  const goods = Object.entries(v.goods).filter(([, n]) => (n ?? 0) > 0.05) as [Good, number][]
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{v.name}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{ROLE_INFO[v.role]?.blurb}</p>
      <div className="row" style={{ gap: 14 }}>
        <span><Icon name="people" title="Villagers" /> {Math.floor(v.population)}/{popCap(v)}</span>
        <span><Icon name="defence" title="Defence" /> {defence(v)}</span>
        <span><Icon name="bread" title="Food stored" /> {Math.round(foodStock(v))}/{storageCap(v)}</span>
        <span>Winter: <b>{v.winterForecast}</b></span>
      </div>
      <div style={{ margin: '8px 0' }}>
        <span className="muted">Morale {v.morale}</span>
        <div className="bar"><i style={{ width: `${v.morale}%`, background: v.morale < 35 ? 'var(--danger)' : undefined }} /></div>
      </div>
      <h3>Goods</h3>
      {goods.length ? (
        <div className="goods">{goods.map(([g, n]) => <span key={g} className="good"><Icon name={g} title={GOOD_LABEL[g]} /> <span>{GOOD_LABEL[g]}<br /><b>{Math.round(n * 10) / 10}</b></span></span>)}</div>
      ) : <p className="muted">Nothing in store.</p>}
      <h3>Buildings</h3>
      {v.buildings.length ? v.buildings.map((b) => (
        <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{BUILDINGS[b.type].name}</span>
          <span className="muted">{b.progress >= 1 ? 'working' : `${Math.round(b.progress * 100)}% built`}</span>
        </div>
      )) : <p className="muted">Tap a hex in your territory (yellow border) and finish a medium task to build.</p>}
      <h3>Start over</h3>
      {!confirm ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Wrong spot or wrong role? You can abandon this village and settle somewhere new. Your habits, buildings, goods and streaks are lost; the map stays explored.</p>
          <button className="btn" onClick={() => setConfirm(true)}>Abandon village…</button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}><b>Abandon {v.name}?</b> All progress resets. This can’t be undone.</p>
          <div className="row">
            <button className="btn" onClick={() => setConfirm(false)}>Keep it</button>
            <button className="btn danger" onClick={onAbandon}>Abandon and start over</button>
          </div>
        </>
      )}
    </div>
  )
}

export function PartyPanel({ game, p, onAddFriend }: { game: Game; p: Player; onAddFriend: () => void }) {
  const players = Object.values(game.state.players)
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Your party</h3>
      <p className="muted" style={{ marginTop: 0 }}>Neighbours see <i>whether</i> you finished tasks and habits, never <i>what</i> they were.</p>
      {players.map((o) => {
        const d = o.days[game.today(o.id)]
        const v = game.state.villages[o.villageId]
        const local = game.meta.localPlayers.includes(o.id)
        return (
          <div key={o.id} style={{ padding: '6px 0', borderBottom: '1px dashed var(--paper-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{o.name}{o.id === p.id ? ' (you)' : ''}</b>
              <span className="muted">{ROLE_INFO[v.role]?.name} · habits {o.habits.length}/{o.habitSlots}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pips">
                {(d?.slots ?? []).map((s, i) => <span key={i} className={`pip ${s.status} ${d?.frozen ? 'frozen' : ''}`} title={s.size} />)}
                {!d && <span className="muted">no check-in yet today</span>}
              </span>
              {local && o.id !== p.id && (
                <button className="btn" onClick={() => { game.meta.activePlayer = o.id; game.saveMeta() }}>Play as</button>
              )}
            </div>
          </div>
        )
      })}
      <h3>Testing</h3>
      <div className="row">
        <button className="btn" onClick={onAddFriend}>+ Local friend (hot-seat)</button>
        <button className="btn" onClick={async () => { game.meta.dayOffset++; game.saveMeta(); await game.catchUp() }}>Skip to tomorrow ⏭</button>
      </div>
      <p className="muted">Day offset: {game.meta.dayOffset}. Hot-seat players share this device so you can try co-op before Supabase is set up.</p>
    </div>
  )
}

export function LogPanel({ game, p }: { game: Game; p: Player }) {
  const entries = game.state.log.filter((e) => !e.text.startsWith('(ignored') && (e.playerId === p.id || e.kind !== 'info')).slice(-60).reverse()
  return (
    <div className="log">
      {entries.length ? entries.map((e, i) => (
        <p key={i} className={e.kind}>
          <span className="muted">{new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} </span>{e.text}
        </p>
      )) : <p className="muted">Nothing has happened yet.</p>}
    </div>
  )
}
