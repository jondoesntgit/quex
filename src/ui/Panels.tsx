import { useState } from 'react'
import { BUILDINGS, GOOD_LABEL, HABIT_PRESETS, MAX_HABIT_SLOTS, PERFECT_DAYS_PER_SLOT, SIZE_POINTS, type Good } from '../game/data'
import { dayScore, defence, foodStock, logText, popCap, storageCap } from '../game/reducer'
import type { Habit, Player, TaskStatus } from '../game/types'
import { addDays, weekday } from '../game/calendar'
import { eventId, type Game } from '../app/store'
import { ROLE_INFO, shareSpot, SIZE_LABEL } from './helpers'
import { supabaseEnabled } from '../app/supabase'
import { FAMILY_WORLD, SANDBOX_WORLD, worldUrl } from '../app/worlds'
import { winterPrep } from '../game/winter'
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
  // supervised players see their tasks; their parents/guardians set and check them off
  const editable = game.canEditTasks(p.id)
  const guardians = game.guardianNames(p.id)
  const mine = game.meta.localPlayers.includes(p.id)

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Today · {dayScore(day)}/100</h3>
        <span className="muted">{mine ? 'Task names are private to you' : `Only ${p.name} and their family see these`}</span>
      </div>
      <WinterNudge game={game} p={p} />
      {mine && !editable && (
        <p className="supervised">👪 Your tasks are set and checked off by {guardians.join(' & ') || 'your parent'}. Spend the actions you earn on the map!</p>
      )}
      {slots.map((s, i) => (
        <div className="slot" key={i}>
          <span className={`size ${s.size}`}>{SIZE_LABEL[s.size as keyof typeof SIZE_LABEL]} {SIZE_POINTS[s.size as keyof typeof SIZE_POINTS]}</span>
          <LabelInput game={game} pid={p.id} date={date} slot={i} readOnly={!editable}
            placeholder={!editable ? '—' : s.size === 'big' ? 'The one big thing…' : s.size === 'medium' ? 'A medium task…' : 'A small task…'} />
          <div className="tri" role="group" aria-label="progress">
            {(['none', 'half', 'full'] as TaskStatus[]).map((st) => (
              <button key={st} className={`${st} ${s.status === st ? 'on' : ''}`} disabled={!editable} onClick={() => set(i, st)} title={st}>
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
      {p.habits.map((h) => h.id === 'water' ? (
        <WaterTracker key={h.id} game={game} p={p} habit={h} date={date} editable={editable} />
      ) : (
        <label className="habit" key={h.id}>
          <input type="checkbox" disabled={!editable} checked={!!day?.habitsDone.includes(h.id)} onChange={(e) => toggleHabit(h.id, e.target.checked)} />
          {h.effect === 'rain' && <Icon name="water" size={16} />}
          <span>{h.name}</span>
          <span className="muted">{HABIT_PRESETS.find((x) => x.id === h.id)?.blurb}</span>
        </label>
      ))}
      {editable && free > 0 && !adding && <button className="btn" onClick={() => setAdding(true)}>+ Add habit</button>}
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
        <button className="btn" disabled={!editable || p.freezes <= 0 || day?.frozen}
          onClick={() => game.dispatch({ t: 'freeze', id: eventId(), at: game.now().toISOString(), playerId: p.id, date })}>
          {day?.frozen ? 'Frozen ❄' : 'Freeze today'}
        </button>
      </div>
    </div>
  )
}

const UNITS = ['cups', 'glasses', 'bottles', 'ml', 'L', 'oz']
/** Quick-add amounts that make sense for a unit. */
function quickAmounts(unit: string): number[] {
  const u = unit.toLowerCase()
  if (u === 'ml') return [250, 500]
  if (u === 'l' || u === 'litres' || u === 'liters') return [0.25, 0.5]
  if (u === 'oz' || u === 'fl oz') return [8, 16]
  return [1, 0.5]
}
const fmt = (n: number) => (Math.round(n * 100) / 100).toString()

/** Water habit as a tracker: a glass that fills toward the day's target,
 *  quick-add / custom amounts, and the last two weeks. Hitting the target
 *  ticks the habit (and brings the rain). */
function WaterTracker({ game, p, habit, date, editable }: { game: Game; p: Player; habit: Habit; date: string; editable: boolean }) {
  const goal = habit.goal
  const [setting, setSetting] = useState(!goal)
  const [target, setTarget] = useState(String(goal?.target ?? 8))
  const [unit, setUnit] = useState(goal?.unit ?? 'cups')
  const [custom, setCustom] = useState('')
  const [last, setLast] = useState<number | null>(null)
  const total = p.days[date]?.amounts?.[habit.id] ?? 0
  const pct = goal ? Math.min(100, (total / goal.target) * 100) : 0
  const done = !!goal && total + 1e-9 >= goal.target
  const at = () => game.now().toISOString()

  const add = async (amount: number) => {
    if (!amount) return
    await game.dispatch({ t: 'drink', id: eventId(), at: at(), playerId: p.id, date, habitId: habit.id, amount })
    setLast(amount)
  }
  const saveGoal = async () => {
    const t = Number(target)
    if (!(t > 0) || !unit.trim()) return
    await game.dispatch({ t: 'habitGoal', id: eventId(), at: at(), playerId: p.id, habitId: habit.id, target: t, unit: unit.trim() })
    setSetting(false)
  }
  const days = Array.from({ length: 14 }, (_, k) => addDays(date, k - 13))
  const hist = days.map((d) => ({ d, n: p.days[d]?.amounts?.[habit.id] ?? 0 }))
  const logged = hist.filter((x) => x.n > 0)
  const avg = logged.length ? logged.reduce((s, x) => s + x.n, 0) / logged.length : 0

  return (
    <div className="water">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>💧 {habit.name}</b>
        <span className="muted">Rain: +20% crops when you reach it</span>
      </div>
      {(setting || !goal) && editable ? (
        <form className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); saveGoal() }}>
          <span>Daily target</span>
          <input type="number" min="0" step="any" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 80 }} />
          <input list="water-units" value={unit} maxLength={12} onChange={(e) => setUnit(e.target.value)} style={{ width: 90 }} />
          <datalist id="water-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          <button type="submit" className="btn primary" disabled={!(Number(target) > 0) || !unit.trim()}>Save</button>
          {goal && <button type="button" className="btn" onClick={() => setSetting(false)}>Cancel</button>}
        </form>
      ) : !goal ? (
        <p className="muted">No daily target set yet.</p>
      ) : (
        <>
          <div className="water-row">
            <div className={`glass ${done ? 'full' : ''}`} title={`${fmt(total)} of ${fmt(goal.target)} ${goal.unit}`}>
              <i style={{ height: `${pct}%` }} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="water-total"><b>{fmt(total)}</b> / {fmt(goal.target)} {goal.unit} {done && <span className="done">✓ done!</span>}</div>
              {editable && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {quickAmounts(goal.unit).map((q) => <button key={q} className="btn" onClick={() => add(q)}>+{fmt(q)}</button>)}
                  <form className="row" style={{ gap: 4 }} onSubmit={(e) => { e.preventDefault(); const n = Number(custom); if (n) { add(n); setCustom('') } }}>
                    <input type="number" step="any" inputMode="decimal" placeholder="amount" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: 70 }} />
                    <button type="submit" className="btn" disabled={!Number(custom)}>Add</button>
                  </form>
                  {last !== null && total > 0 && <button className="btn ghost" title="Undo the last entry" onClick={() => { add(-Math.min(last, total)); setLast(null) }}>↶ undo</button>}
                  <button className="btn ghost" onClick={() => setSetting(true)} title="Change your daily target">⚙︎</button>
                </div>
              )}
            </div>
          </div>
          <div className="water-hist" aria-label="Last 14 days">
            {hist.map(({ d, n }) => (
              <span key={d} title={`${d}: ${fmt(n)} ${goal.unit}`} className={d === date ? 'today' : ''}>
                <i style={{ height: `${Math.min(100, (n / goal.target) * 100)}%` }} className={n + 1e-9 >= goal.target ? 'met' : ''} />
                <small>{'SMTWTFS'[weekday(d)]}</small>
              </span>
            ))}
          </div>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            {(() => {
              const met = hist.filter((x) => x.n + 1e-9 >= goal.target).length
              return `Last 14 days: target met ${met === 1 ? 'once' : `${met} times`}${logged.length ? `, about ${fmt(avg)} ${goal.unit} a day on days you logged` : ''}.`
            })()}
          </p>
        </>
      )}
    </div>
  )
}

/** Task name box with a save indicator: … saving, ✓ saved, ! failed (retries on blur). */
function LabelInput({ game, pid, date, slot, placeholder, readOnly }: { game: Game; pid: string; date: string; slot: number; placeholder: string; readOnly?: boolean }) {
  const text = game.label(pid, date, slot)
  const st = game.labelStatus(pid, date, slot)
  const mark = readOnly ? '' : st === 'saving' ? '…' : st === 'error' ? '!' : st === 'saved' && text ? '✓' : ''
  const title = st === 'saving' ? 'Saving…' : st === 'error' ? 'Not saved: tap away to retry' : mark ? 'Saved' : undefined
  return (
    <span className="labelbox">
      <input placeholder={placeholder} value={text} maxLength={200} readOnly={readOnly}
        onChange={(e) => game.setLabel(pid, date, slot, e.target.value)}
        onBlur={(e) => game.setLabel(pid, date, slot, e.target.value, true)} />
      {mark && <span className={`labelmark ${st}`} title={title} aria-label={title}>{mark}</span>}
    </span>
  )
}

export function VillagePanel({ game, p, onAbandon, notify }: { game: Game; p: Player; onAbandon: () => void; notify: (s: string) => void }) {
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
        <span>Winter: <b>{winterPrep(v, game.today(p.id), dayScore(p.days[game.today(p.id)])).forecast}</b></span>
      </div>
      <div style={{ margin: '8px 0' }}>
        <span className="muted">Morale {v.morale}</span>
        <div className="bar"><i style={{ width: `${v.morale}%`, background: v.morale < 35 ? 'var(--danger)' : undefined }} /></div>
      </div>
      <WinterPrepCard game={game} p={p} />
      <button className="btn" style={{ marginBottom: 4 }} onClick={async () => {
        const msg = await shareSpot(game, v, `Come settle near ${v.name} in Quex!`)
        if (msg) notify(msg)
      }}>🔗 Invite someone to settle nearby</button>
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
          <p style={{ marginTop: 0 }}><b>Abandon {v.name}?</b> All progress resets. This can't be undone.</p>
          <div className="row">
            <button className="btn" onClick={() => setConfirm(false)}>Keep it</button>
            <button className="btn danger" onClick={onAbandon}>Abandon and start over</button>
          </div>
        </>
      )}
    </div>
  )
}

export function PartyPanel({ game, p, onAddFriend, onManage }: { game: Game; p: Player; onAddFriend: () => void; onManage: (pid: string) => void }) {
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
              <b>{o.name}{o.id === p.id ? ' (you)' : ''}{game.isSupervised(o.id) && <span className="muted" title={`Looked after by ${game.guardianNames(o.id).join(' & ')}`}> 👪</span>}</b>
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
              {game.isGuardianOf(o.id) && (
                <button className="btn primary" onClick={() => onManage(o.id)}>Set & check tasks</button>
              )}
            </div>
          </div>
        )
      })}
      {!supabaseEnabled && (
        // offline builds only (local dev and e2e tests): never on the live, shared world
        <>
          <h3>Testing</h3>
          <div className="row">
            <button className="btn" onClick={onAddFriend}>+ Local friend (hot-seat)</button>
            <button className="btn" onClick={async () => { game.meta.dayOffset++; game.saveMeta(); await game.catchUp() }}>Skip to tomorrow ⏭</button>
          </div>
          <p className="muted">Day offset: {game.meta.dayOffset}. Hot-seat players share this device so you can try co-op offline.</p>
        </>
      )}
    </div>
  )
}

export function LogPanel({ game, p }: { game: Game; p: Player }) {
  const entries = game.state.log.filter((e) => !e.text.startsWith('(ignored') && (e.playerId === p.id || e.kind !== 'info')).slice(-60).reverse()
  return (
    <div className="log">
      {entries.length ? entries.map((e, i) => (
        <p key={i} className={e.kind}>
          <span className="muted">{new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} </span>{logText(game.state, e.text)}
        </p>
      )) : <p className="muted">Nothing has happened yet.</p>}
    </div>
  )
}

const DAY_STATUS = /^\(ignored|^Night falls|^❄️ Winter rest|perfect week|used a freeze/

/** What a visitor sees: who plays here and what's been happening (read-only), but not how anyone's day went. */
export function GuestPanel({ game }: { game: Game }) {
  const [tab, setTab] = useState<'party' | 'log'>('party')
  const [collapsed, setCollapsed] = useState(false)
  const players = Object.values(game.state.players)
  // players' days (scores, freezes, streaks) stay between players: visitors see the village story only
  const entries = game.state.log.filter((e) => e.kind !== 'info' && !DAY_STATUS.test(e.text)).slice(-60).reverse()
  return (
    <div className={`sheet ${collapsed ? 'collapsed' : ''}`}>
      <div className="tabs">
        {(['party', 'log'] as const).map((t) => (
          <button key={t} className={`tab ${tab === t && !collapsed ? 'on' : ''}`}
            onClick={() => { if (tab === t) setCollapsed(!collapsed); else { setTab(t); setCollapsed(false) } }}>
            {t === 'party' ? 'Players' : 'Log'}
          </button>
        ))}
      </div>
      <div className="sheet-body">
        {tab === 'party' ? (
          <div>
            {game.meta.worldSeed === FAMILY_WORLD
              ? <p style={{ marginTop: 0 }}>You're looking around the world where friends and family are playtesting Quex. <a href={worldUrl(SANDBOX_WORLD)}>Try it yourself in the sandbox →</a></p>
              : <p className="muted" style={{ marginTop: 0 }}>You're looking around a public world.</p>}
            {players.map((o) => {
              const v = game.state.villages[o.villageId]
              return (
                <div key={o.id} style={{ padding: '6px 0', borderBottom: '1px dashed var(--paper-2)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b>{o.name}</b>
                    <span className="muted">{ROLE_INFO[v.role]?.name} · {v.name}</span>
                  </div>
                  <span className="muted">{Math.floor(v.population)} villagers · {v.buildings.length} {v.buildings.length === 1 ? 'building' : 'buildings'}</span>
                </div>
              )
            })}
            {!players.length && <p className="muted">Nobody has settled here yet.</p>}
          </div>
        ) : (
          <div className="log">
            {entries.length ? entries.map((e, i) => (
              <p key={i} className={e.kind}>
                <span className="muted">{new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} </span>{logText(game.state, e.text)}
              </p>
            )) : <p className="muted">Nothing has happened yet.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

const whenWinter = (days: number) =>
  days === 0 ? "It's winter today: nothing grows, and the village lives off its stores tonight."
    : days === 1 ? 'Winter is tomorrow (Saturday).'
    : `Winter is on Saturday, in ${days} days.`

/** A line on the Today tab from Wednesday on: how winter prep stands, and that today's tasks help. */
function WinterNudge({ game, p }: { game: Game; p: Player }) {
  const v = game.state.villages[p.villageId]
  if (!v) return null
  const date = game.today(p.id)
  const w = winterPrep(v, date, dayScore(p.days[date]))
  if (w.days > 3) return null
  const left = w.items.filter((x) => !x.ok).length
  return (
    <p className="winter-nudge">
      ❄️ {whenWinter(w.days)} {left ? `${left} thing${left === 1 ? '' : 's'} left to prepare: see the winter checklist in the Village tab.` : 'Your village is ready for it.'}
      {w.days > 0 && w.tonight.full > 0.05 && ` A full day makes about ${Math.round(w.tonight.full * 10) / 10} food that keeps tonight.`}
    </p>
  )
}

/** The winter prep checklist: what's ready, what isn't, and which tasks fix it. */
function WinterPrepCard({ game, p }: { game: Game; p: Player }) {
  const v = game.state.villages[p.villageId]
  const date = game.today(p.id)
  const w = winterPrep(v, date, dayScore(p.days[date]))
  const ready = w.items.every((x) => x.ok)
  const [open, setOpen] = useState(w.days <= 3 && !ready)
  return (
    <details className="winter" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>❄️ Winter prep {ready ? '· ready' : `· ${w.items.filter((x) => !x.ok).length} to do`}</summary>
      <p className="muted" style={{ marginTop: 4 }}>{whenWinter(w.days)} Forecast: <b>{w.forecast}</b>.</p>
      <ul className="checklist">
        {w.items.map((it) => (
          <li key={it.id} className={it.ok ? 'ok' : ''}>
            <span className="tick" aria-hidden>{it.ok ? '✓' : '○'}</span>
            <div>
              <b>{it.title}</b>
              <div>{it.status}</div>
              {!it.ok && <div className="muted">{it.impact}</div>}
              {it.todo.map((t, k) => (
                <div key={k} className="todo"><span className={`size ${t.size}`}>{SIZE_LABEL[t.size]}</span> {t.text}</div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
