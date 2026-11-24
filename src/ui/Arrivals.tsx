/** The note shown when newcomers arrive: who they are, where from, and what they brought for the road.
 *  Shown once per arrival (the newest first, then any older ones not yet read); the log keeps a line. */
import { useState } from 'react'
import { FOOD, GOOD_LABEL, HEADS, type Good } from '../game/data'
import { TRAVEL_DAYS } from '../game/immigrants'
import { BASE_CAP } from '../game/reducer'
import { HOMES } from '../game/city'
import type { Arrival, Player } from '../game/types'
import type { Game } from '../app/store'
import { Icon } from './Icon'

const KEY = (villageId: string) => `quex:arrivals:${villageId}`
function readSeen(villageId: string): string[] {
  try { return JSON.parse(localStorage.getItem(KEY(villageId)) ?? '[]') } catch { return [] }
}
function remember(villageId: string, id: string) {
  try { localStorage.setItem(KEY(villageId), JSON.stringify([...readSeen(villageId), id].slice(-30))) } catch { /* private window: it just shows again */ }
}

/** A newcomers' note not yet read (the morning report waits for it). */
export function arrivalPending(v: { id: string; arrivals?: Arrival[] }): boolean {
  const seen = readSeen(v.id)
  return (v.arrivals ?? []).some((x) => !seen.includes(x.id))
}

const amount = (n: number) => (Math.round(n * 10) / 10).toString()

export function Arrivals({ game, p }: { game: Game; p: Player }) {
  const v = game.state.villages[p.villageId]
  const [, bump] = useState(0)
  if (!v || game.guest) return null
  const seen = readSeen(v.id)
  const a: Arrival | undefined = [...(v.arrivals ?? [])].reverse().find((x) => !seen.includes(x.id))
  if (!a) return null
  const goods = (Object.entries(a.goods) as [Good, number][]).filter(([, n]) => n > 0)
  const done = () => { remember(v.id, a.id); bump((x) => x + 1) }
  if (a.kind === 'food') {
    return (
      <div className="confirm-scrim" role="dialog" aria-modal="true" aria-label="The food rules have changed">
        <div className="card confirm arrival">
          <h2>How your village eats has changed</h2>
          <p style={{ margin: '4px 0 8px' }}>
            We have rebalanced food so that a village should need <b>no more than about 40% of its people</b> working on food, leaving the
            rest for building, mining, trading and fighting. Efficiency grows as the game goes on: <b>scythes</b> for the grain harvest,
            <b> spears, boats and bows</b> for fishing and hunting, and bigger pastures for flocks. Make them under <b>Tools</b> on the Village tab.
          </p>
          <ul>
            <li>🌾 <b>Fields</b> are sown in spring (about a quarter of the village), left alone in summer, and reaped in autumn (about half the village for two days, if grain is all you eat). Unsown ground still gives a quarter. The village does this for you unless you take over its workers.</li>
            <li>🥬 <b>Gardens</b> give grain and a vegetable each season: worts (kale and leeks) in spring, dried peas in summer, turnips in autumn. About 3 rations a worker.</li>
            <li>🐟 <b>Fishing</b> works on rivers as well as the shore, and hunters range over the forest around their lodge, never taking the last of the game.</li>
            <li>🐑 <b>Sheep pens</b> keep a flock that grows by half each spring, as far as the pasture around a well or pen allows. Cheese and wool all year, mutton at the autumn cull, and grain to feed them in winter.</li>
          </ul>
          {goods.length > 0 && <p style={{ margin: '8px 0 4px' }}>To ease the change, your stores were topped up with <b>{goods.map(([g, n]) => `${amount(n)} ${GOOD_LABEL[g].toLowerCase()}`).join(', ')}</b> (as much as they hold). If you had no field, one has been laid out for you.</p>}
          <div className="confirm-buttons"><button className="btn primary" onClick={done} autoFocus>Got it</button></div>
        </div>
      </div>
    )
  }
  return (
    <div className="confirm-scrim" role="dialog" aria-modal="true" aria-label="Newcomers">
      <div className="card confirm arrival">
        <h2>{a.kind === 'update' ? 'Your village has grown up' : 'Newcomers after the winter'}</h2>
        <p style={{ margin: '4px 0 8px' }}><b>{a.people} people</b> from {a.from} have settled in {v.name}.</p>
        {a.kind === 'update' && (
          <p className="muted" style={{ margin: '4px 0 8px' }}>
            A one-time update: villagers are counted one by one now, so you have {HEADS} times as many people on paper, and every
            number was scaled to match: the same food, the same work, the same fighting strength. The village square holds {BASE_CAP};
            lay cobblestone next to it, then build cottages ({HOMES.cottage.cap} people each) and town houses ({HOMES.townhouse.cap}) in
            your city for room to grow.
          </p>
        )}
        <h3 style={{ margin: '8px 0 4px', fontWeight: 400 }}>They brought food for {TRAVEL_DAYS} days</h3>
        <ul className="arrival-goods">
          {goods.map(([g, n]) => <li key={g}><Icon name={g} size={32} /> <b>{FOOD[g] ? `${Math.round(n * FOOD[g]!.value)} rations of` : amount(n)}</b> {GOOD_LABEL[g].toLowerCase()}{g === 'grain' ? ' (seed grain: it will grow if sown)' : ''}</li>)}
        </ul>
        <p className="muted" style={{ margin: '4px 0 0' }}>So the stores aren't emptied the day they arrive. After that they eat with everyone else.</p>
        <div className="confirm-buttons"><button className="btn primary" onClick={done} autoFocus>Welcome them</button></div>
      </div>
    </div>
  )
}
