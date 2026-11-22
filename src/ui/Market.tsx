import { useState } from 'react'
import { GOOD_LABEL, type Good, type Goods } from '../game/data'
import { playerDate } from '../game/calendar'
import { CARAVAN_ROADS, COPPER_PER_SILVER, WAGON_ROADS, WEIGHT, inCopper, askFor, bidFor, merchants, reach, weigh, type Merchant } from '../game/market'
import { validate } from '../game/reducer'
import type { Player } from '../game/types'
import { eventId, type Game } from '../app/store'
import { Icon } from './Icon'

const n1 = (x: number) => (Math.round(x * 10) / 10).toString()
/** A worth in coin: "0.25 copper", "4 copper", "1.2 silver". */
const cu = (grain: number) => {
  const c = inCopper(grain)
  if (c >= COPPER_PER_SILVER) return `${n1(c / COPPER_PER_SILVER)} silver`
  return `${c >= 1 ? n1(c) : (Math.round(c * 100) / 100).toString()} copper`
}

/** How the terms feel, from the asking price. */
function terms(sell: number) {
  if (sell <= 1.4) return 'good prices'
  if (sell <= 1.8) return 'fair prices'
  return 'steep prices'
}

/** The merchants calling at the player's village today, and a barter with one. */
export function Market({ game, p }: { game: Game; p: Player }) {
  const [open, setOpen] = useState<Merchant['kind'] | null>(null)
  const v = game.state.villages[p.villageId]
  if (!v) return null
  const now = game.now()
  const date = playerDate(now, p.resetHour, p.tz)
  const list = merchants(game.world, game.state, v, date)
  const r = reach(game.world, v)
  const m = list.find((x) => x.kind === open)
  if (m) return <Barter game={game} p={p} m={m} onBack={() => setOpen(null)} />
  const tips = [
    !r.coast && 'a coast (sea traders)',
    !r.river && 'a river (barges)',
    r.roads < CARAVAN_ROADS && `${CARAVAN_ROADS - r.roads} more road hexes (overland caravans)`,
    r.roads >= CARAVAN_ROADS && r.roads < WAGON_ROADS && `${WAGON_ROADS - r.roads} more road hexes (wagons)`,
    r.roads >= WAGON_ROADS && r.roads < 10 && 'longer roads',
    !r.market && 'a market',
    r.coast && !r.docks && 'docks',
    r.coast && !r.shipyard && 'a shipyard',
  ].filter(Boolean) as string[]
  return (
    <>
      <h3>Merchants at {v.name}</h3>
      {list.length === 0 ? <p className="muted">The merchants rest on the Sabbath. They'll be back tomorrow.</p> : (
        <ul className="caravan-list">
          {list.map((x) => {
            const wares = Object.entries(x.wares) as [Good, number][]
            return (
              <li key={x.kind}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span><b>{x.name}</b> <span className="muted">· {terms(x.sell)}</span></span>
                  <button className="btn" disabled={!wares.length} onClick={() => setOpen(x.kind)}>Trade</button>
                </div>
                <div className="muted">{wares.length ? wares.map(([g, n]) => `${n} ${GOOD_LABEL[g].toLowerCase()}`).join(', ') : 'Sold out for today.'}</div>
                <div className="muted">Carries up to {x.cap} weight · wants {x.wants.map((g) => GOOD_LABEL[g].toLowerCase()).join(', ')}</div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted">
        Trade links: {r.score < 0.2 ? 'remote' : r.score < 0.5 ? 'modest' : r.score < 0.8 ? 'good' : 'a hub'}.
        {tips.length > 0 && <> More merchants and better prices with {tips.join(', ')}.</>}
      </p>
    </>
  )
}

function Barter({ game, p, m, onBack }: { game: Game; p: Player; m: Merchant; onBack: () => void }) {
  const v = game.state.villages[p.villageId]
  const [take, setTake] = useState<Goods>({})
  const [give, setGive] = useState<Goods>({})
  const [msg, setMsg] = useState<string | null>(null)
  const clean = (g: Goods) => Object.fromEntries(Object.entries(g).filter(([, n]) => (n ?? 0) > 0)) as Goods
  const deal = weigh(m, give, take)
  const theirs = Object.entries(m.wares) as [Good, number][]
  const mine = (Object.entries(v.goods) as [Good, number][]).filter(([, n]) => n >= 1)
  const step = (set: (g: Goods) => void, g: Goods, x: Good, d: number, max: number) =>
    set({ ...g, [x]: Math.max(0, Math.min(max, (g[x] ?? 0) + d)) })
  const pct = deal.asked > 0 ? Math.min(1, deal.offered / deal.asked) : 0
  const verdict = !deal.fits ? `Too heavy: they can carry ${m.cap}, and that leaves them with ${n1(deal.load)}.`
    : !deal.asked ? 'Pick something from their pack.'
    : deal.accept ? (deal.offered > deal.asked * 1.5 ? "A generous offer! They'd gladly accept." : "They'd accept.")
    : deal.offered === 0 ? 'Offer something from your stores.'
    : `They'd refuse: they want about ${cu(deal.asked - deal.offered)} more.`

  async function trade() {
    const ev = { t: 'barter' as const, id: eventId(), at: game.now().toISOString(), playerId: p.id, merchant: m.kind, give: clean(give), take: clean(take) }
    const err = validate(game.state, game.world, ev)
    if (err) { setMsg(err); return }
    await game.dispatch(ev)
    setTake({}); setGive({}); setMsg('Done. The goods are in your stores.')
  }

  return (
    <>
      <button className="btn ghost" onClick={onBack}>← merchants</button>
      <h3 style={{ marginBottom: 2 }}>{m.name}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{m.blurb} Prices are in copper and silver (1 silver = 10 copper), the coin every merchant takes.</p>
      <h4>Their pack</h4>
      {theirs.length === 0 && <p className="muted">Sold out for today.</p>}
      {theirs.map(([g, n]) => (
        <div key={g} className="row barter-row">
          <span className="barter-label"><Icon name={g} /> <span>{GOOD_LABEL[g]} <span className="muted">×{n}</span><small className="muted">{cu(askFor(m, g))} each · weight {WEIGHT[g]}</small></span></span>
          <span className="row stepper">
            <button className="btn icon" onClick={() => step(setTake, take, g, -1, n)}>−</button>
            <b className="qty">{take[g] ?? 0}</b>
            <button className="btn icon" disabled={(take[g] ?? 0) >= n} onClick={() => step(setTake, take, g, 1, n)}>+</button>
          </span>
        </div>
      ))}
      <h4>Your stores</h4>
      {mine.length === 0 && <p className="muted">Nothing to offer yet.</p>}
      {mine.map(([g, n]) => {
        const max = Math.floor(n)
        const wanted = m.wants.includes(g)
        return (
          <div key={g} className="row barter-row">
            <span className="barter-label"><Icon name={g} /> <span>{GOOD_LABEL[g]} <span className="muted">×{max}</span>{wanted && <span className="want"> wanted</span>}<small className="muted">{cu(bidFor(m, g))} each · weight {WEIGHT[g]}</small></span></span>
            <span className="row stepper">
              <button className="btn icon" onClick={() => step(setGive, give, g, -1, max)}>−</button>
              <b className="qty">{give[g] ?? 0}</b>
              <button className="btn icon" disabled={(give[g] ?? 0) >= max} onClick={() => step(setGive, give, g, 1, max)}>+</button>
            </span>
          </div>
        )
      })}
      <div className="deal">
        <div className="deal-bar"><i className={deal.accept ? 'ok' : ''} style={{ width: `${pct * 100}%` }} /></div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">You offer {cu(deal.offered)}</span>
          <span className="muted">They ask {cu(deal.asked)}</span>
        </div>
        <div className="muted">Their load after the trade: {n1(deal.load)} / {m.cap}</div>
        <p className={deal.accept ? 'deal-yes' : 'deal-no'}>{verdict}</p>
      </div>
      <button className="btn primary" disabled={!deal.accept} onClick={trade}>Trade</button>
      {msg && <p className="muted">{msg}</p>}
    </>
  )
}
