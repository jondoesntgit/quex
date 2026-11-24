import { useState } from 'react'
import { stepsFor } from '../game/workers'
import { BUILDINGS, GOOD_LABEL } from '../game/data'
import { NEED_NAME, REFINED, recommend, refinedGain, shortfalls } from '../game/advisor'
import { done } from '../game/reducer'
import type { Player } from '../game/types'
import type { Game } from '../app/store'

const OWN: Record<string, string> = {
  food: 'food stores', larder: 'larder', winter: 'winter stores', textiles: 'textiles', shelter: 'housing',
  building: 'building materials', fuel: 'fuel', metal: 'metal',
}

/** What the village is light on, and what to build next for the busiest friends. */
export function Focus({ game, p }: { game: Game; p: Player }) {
  const v = game.state.villages[p.villageId]
  const short = shortfalls(v).slice(0, 3)
  const recs = recommend(game.world, game.state, p, game.now())
  const gains = REFINED.filter(([raw, refined], k) => REFINED.findIndex((x) => x[1] === refined) === k && raw !== 'limonite')
    .map(([raw, refined]) => `${GOOD_LABEL[refined].toLowerCase()} ${GOOD_LABEL[refined].endsWith('s') ? 'are' : 'is'} worth ${Math.round(refinedGain(raw, refined) * 10) / 10}× ${GOOD_LABEL[raw].toLowerCase()}`)
    .slice(0, 4)
  return (
    <div className="focus">
      <h4 style={{ margin: '8px 0 2px' }}>What to focus on</h4>
      {short.length ? (
        <p style={{ margin: '2px 0' }}>
          <b>Light on:</b> {short.map((f, k) => <span key={f.need}>{k ? '; ' : ''}<b>{NEED_NAME[f.need]}</b> <span className="muted">({f.why})</span></span>)}.
        </p>
      ) : <p className="muted" style={{ margin: '2px 0' }}>Nothing pressing: your stores are in good shape.</p>}
      {recs.length > 0 && <p style={{ margin: '6px 0 2px' }}><b>Build next</b> <span className="muted">(what your land allows, for the friends busiest this week):</span></p>}
      {recs.map((r) => (
        <p key={r.industry.id} className="focus-rec" style={{ margin: '2px 0' }}>
          <b>{r.industry.name}</b>: {r.todo.map((id) => BUILDINGS[id].name).join(' → ')}, from {r.industry.from}.{' '}
          <span className="muted">
            {r.helps.length > 0 && <>{r.helps.map((h) => `${h.name} (${h.points} points this week)`).join(' and ')} {r.helps.length === 1 ? 'is' : 'are'} short of {[...new Set(r.helps.flatMap((h) => h.needs))].map((x) => NEED_NAME[x]).join(' and ')}. </>}
            {r.self.length > 0 && <>It helps your own {r.self.map((x) => OWN[x]).join(' and ')} too.</>}
          </span>
        </p>
      ))}
      <p className="muted" style={{ margin: '6px 0 0' }}>
        Send friends refined goods, not raw: a caravan carries by weight, and for the same weight {gains.slice(0, -1).join(', ')} and {gains[gains.length - 1]}.
      </p>
    </div>
  )
}

/** First steps, ticked off from what the player has actually done. */
export function GettingStarted({ game, p }: { game: Game; p: Player }) {
  const [hidden, setHidden] = useState(() => !!game.meta.guideDone?.includes(p.id))
  const s = game.state
  const v = s.villages[p.villageId]
  if (!v || hidden) return null
  const today = game.today(p.id)
  const wrote = [0, 1, 2, 3, 4, 5].some((k) => game.label(p.id, today, k)) || Object.values(p.days).some((d) => d.slots?.some((x) => x.status !== 'none'))
  const earned = p.tokens.length > 0 || v.buildings.length > 0 || v.roads.length > 0
  const FOODS = ['garden', 'field', 'shore_fishery', 'pen', 'hunting_lodge', 'forager_camp', 'orchard']
  const steps = [
    { ok: wrote, text: "Write today's 1-2-3: one big task, two medium and three small, on the Today tab." },
    { ok: earned, text: 'Tick a task off when it\'s done: each one earns an action (big, medium or small) to spend on the map.' },
    { ok: done(v).some((b) => FOODS.includes(b.type)), text: 'Tap your land and Build something that makes food. A Wheat field is the best start (sown in spring, reaped in autumn: half the village for two days feeds it all week), or Garden plots, a Shore fishery on the coast or a river.' },
    { ok: done(v).some((b) => b.type === 'granary') || v.winterForecast === 'stocked', text: "Saturday is winter: store food that keeps (grain, smoked fish, cheese), or build a Granary." },
    { ok: v.roads.length > 0, text: 'Lay a road out from your village: caravans travel faster, and more merchants come.' },
    { ok: !!v.trade || (s.arrived ?? []).some((c) => c.from === v.id) || s.caravans.some((c) => c.from === v.id), text: "Trade: barter with today's merchants (Caravans, top right), or send a neighbour a caravan." },
  ]
  const left = steps.filter((x) => !x.ok).length
  if (!left) return null
  const next = steps.findIndex((x) => !x.ok)
  const dismiss = () => {
    game.meta.guideDone = [...(game.meta.guideDone ?? []), p.id]
    game.saveMeta()
    setHidden(true)
  }
  return (
    <details className="guide" open>
      <summary>Getting started · {steps.length - left}/{steps.length}</summary>
      <ol>
        {steps.map((x, k) => <li key={k} className={x.ok ? 'done' : k === next ? 'next' : ''}>{x.text}</li>)}
      </ol>
      <p className="muted" style={{ margin: '4px 0 0' }}>
        The Village tab says what your village is light on and what to build next. <button className="linkbtn" onClick={dismiss}>Hide this</button>
      </p>
    </details>
  )
}

/** Pick how many people a tap on − or + moves: 1, 5, 10 (more as the village grows). */
export function useStep(population: number): [number, React.ReactNode] {
  const steps = stepsFor(population)
  const [picked, setPicked] = useState(1)
  const step = steps.includes(picked) ? picked : 1
  return [step, (
    <span className="steps" role="group" aria-label="people moved per tap">
      {steps.map((n) => <button key={n} className={`chip ${n === step ? 'on' : ''}`} onClick={() => setPicked(n)}>±{n}</button>)}
    </span>
  )]
}
