/** The note shown when newcomers arrive: who they are, where from, and what they brought for the road.
 *  Shown once per arrival (the newest first, then any older ones not yet read); the log keeps a line. */
import { useEffect, useState } from 'react'
import { shown } from '../game/amount'
import { FOOD, GOOD_LABEL, HEADS, type Good } from '../game/data'
import { TRAVEL_DAYS } from '../game/immigrants'
import { BASE_CAP } from '../game/reducer'
import { HOMES } from '../game/city'
import type { Arrival, Player, Village } from '../game/types'
import { fresh, hadNotice, markNotice, onScreen } from './notices'
import type { Game } from '../app/store'
import { Icon } from './Icon'

// notes read before they were kept for every device (this device's list, still honoured)
const OLD_KEY = (villageId: string) => `quex:arrivals:${villageId}`
function readOld(villageId: string): string[] {
  try { return JSON.parse(localStorage.getItem(OLD_KEY(villageId)) ?? '[]') } catch { return [] }
}
const had = (v: Village, id: string) => hadNotice(v, id) || readOld(v.id).includes(id)

/** The newcomers' note to show: the newest still news that the player hasn't had (on any device). */
function nextArrival(v: Village, now: Date): Arrival | undefined {
  const list = [...(v.arrivals ?? [])].reverse()
  return list.find((x) => onScreen.has(x.id)) ?? list.find((x) => !had(v, x.id) && fresh(x.at, now))
}

/** A newcomers' note on screen or still to show (the morning report waits for it). */
export function arrivalPending(v: Village, now = new Date()): boolean {
  return !!nextArrival(v, now)
}

const amount = (n: number) => shown(n, 0.1).toString()

export function Arrivals({ game, p }: { game: Game; p: Player }) {
  const v = game.state.villages[p.villageId]
  const [, bump] = useState(0)
  const a = v && !game.guest ? nextArrival(v, game.now()) : undefined
  // had the moment it shows: another device, or opening the page again, won't show it again
  useEffect(() => {
    if (!a || !v || onScreen.has(a.id)) return
    onScreen.add(a.id)
    markNotice(game, p, v, a.id)
  }, [a?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !a) return null
  const goods = (Object.entries(a.goods) as [Good, number][]).filter(([, n]) => n > 0)
  const done = () => { onScreen.delete(a.id); bump((x) => x + 1) }
  if (a.kind === 'orcs') {
    const raided = (a.raided ?? []).filter((r) => r.village !== v.id)
    const me = (a.raided ?? []).filter((r) => r.village === v.id)
    const names = [...new Set(raided.map((r) => game.state.villages[r.village]?.name).filter(Boolean))]
    const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long' })
    return (
      <div className="confirm-scrim" role="dialog" aria-modal="true" aria-label="Orc raiders">
        <div className="card confirm arrival">
          <h2>⚔ Orc raiders</h2>
          <p style={{ margin: '4px 0 8px' }}>
            Riders came in the night with news: orcs have been raiding the villages{names.length ? <> of <b>{names.join(', ')}</b></> : ' nearby'}.
          </p>
          {raided.length > 0 && <ul>{raided.map((r, k) => <li key={k}>{game.state.villages[r.village]?.name}, {day(r.at)}: they carried off {r.took}.</li>)}</ul>}
          {me.length > 0 && <p style={{ margin: '4px 0' }}>They raided you too: {me.map((r) => r.took).join('; ')}.</p>}
          {a.camp && <p style={{ margin: '4px 0' }}>The nearest camp to you is <b>{a.camp.name}</b>, {a.camp.hexes} hexes away (hex {a.camp.col},{a.camp.row}).</p>}
          <p style={{ margin: '8px 0 4px' }}>
            The camps keep to themselves in <b>spring</b> and raid in summer and autumn. That's the time to act together: send soldiers in spring to the <b>palisade</b> of a village near the orcs, with food for the road and weapons and armour if you can spare them (a unit of copper, bronze or iron arms two; leather armours two). Away, they eat only what they carry, not your stores, and they come home while what's left still covers the road.
          </p>
          <p style={{ margin: '4px 0' }}>
            From its <b>war council</b> the palisade can raid a camp with every soldier on its walls. Scout a camp first (a small action) to know your odds. Win, and the hoard is shared by soldiers sent, with a trophy found nowhere else that merchants pay well for.
          </p>
          <div className="confirm-buttons"><button className="btn primary" onClick={done} autoFocus>To arms</button></div>
        </div>
      </div>
    )
  }
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
            <li>🥬 <b>Gardens</b> give vegetables, a different one each season: worts (kale and leeks) in spring, peas in summer, turnips in autumn. About 3 rations a worker.</li>
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
          {goods.map(([g, n]) => <li key={g}><Icon name={g} size={32} /> <b>{FOOD[g] ? `${shown(n * FOOD[g]!.value, 1)} rations of` : amount(n)}</b> {GOOD_LABEL[g].toLowerCase()}{g === 'grain' ? ' (seed grain: it will grow if sown)' : ''}</li>)}
        </ul>
        <p className="muted" style={{ margin: '4px 0 0' }}>So the stores aren't emptied the day they arrive. After that they eat with everyone else.</p>
        <div className="confirm-buttons"><button className="btn primary" onClick={done} autoFocus>Welcome them</button></div>
      </div>
    </div>
  )
}
