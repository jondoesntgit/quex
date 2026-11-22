import { useState } from 'react'
import { ACTIONS, BUILDINGS, GOOD_LABEL, type ActionKind, type BuildingDef, type Good } from '../game/data'
import { actionSize, buildCost, buildingAt, caravanMinutes, cellIndex, fmtGoods, inTerritory, landAt, logText, villageAt } from '../game/reducer'
import { hasTrees, isDeposit, treeCount } from '../world/land'
import { GAME_REGROW, about, gameLeft, gameMax, leftAt } from '../game/deposits'
import type { Player } from '../game/types'
import type { Game } from '../app/store'
import { shareSpot, tryAction } from './helpers'
import { Icon } from './Icon'
import { clockTime, span } from './Caravans'


/** What a deposit is good for (shown on the hex card). */
const DEPOSIT_NOTE: Record<string, string> = {
  iron: 'Iron deposit: a Deep iron mine could go here (big task). Iron makes better tools and weapons.',
  copper: 'Copper deposit (green malachite and blue azurite on rust-stained rock): gather the surface ore by hand, or sink a Copper mine (big task) to reach the deep ore, which carries a little silver. Copper plus a little tin makes bronze.',
  silver: 'Silver! Galena, heavy grey lead ore rich in silver. A Silver mine (big task) digs it, and a Silver refinery turns it into silver, the coin every merchant takes.',
  tin: 'Tin! Rare: gather it (small task) and trade it. A little tin turns copper into bronze.',
  stone: 'Building stone: a Quarry could go here (medium task), or gather stone by hand (small task).',
  clay: 'River clay: gather it (small task) for a Brick kiln.',
  salt: 'Salt: gather it (small task), or build Salt pans on the shore (medium task). Salt keeps cheese and fish.',
}

const TERRAIN_NAME: Record<string, string> = {
  deep: 'Deep sea', ocean: 'Sea', shallow: 'Shallows', beach: 'Beach', grass: 'Grassland', meadow: 'Meadow',
  forest: 'Forest', swamp: 'Swamp', hills: 'Hills', desert: 'Desert', savannah: 'Savannah', rock: 'Mountain',
  tundra: 'Tundra', snow: 'Snowfield',
}

export function Inspector({ game, p, col, row, onClose, notify }: {
  game: Game; p: Player; col: number; row: number; onClose: () => void; notify: (s: string) => void
}) {
  const { world, state } = game
  const i = cellIndex(world, col, row)
  const cell = world.cells[i]
  const known = state.revealed.includes(i)
  const [mode, setMode] = useState<'main' | 'build' | 'caravan'>('main')
  const v = state.villages[p.villageId]
  const here = buildingAt(state, col, row)
  const village = villageAt(state, col, row)
  const lair = state.lairs.find((l) => l.col === col && l.row === row && !l.cleared)
  const land = landAt(world, state, i, game.today(p.id))
  const terr = land.terrain
  const trees = hasTrees(land)
  const stand = state.woods?.[i]
  const count = trees ? treeCount(land) - (land.stumps ?? 0) : 0
  const treeNote = stand?.young ? `${stand.young} saplings (trees by winter)`
    : trees ? `${count} tree${count === 1 ? '' : 's'}${land.stumps ? `, ${land.stumps} stump${land.stumps === 1 ? '' : 's'}` : ''}` : null
  const mine = inTerritory(v, col, row)
  const left = known ? leftAt(world, state, i) : null
  const wild = known ? gameMax(world, i) : 0

  const share = async () => {
    const text = village ? `Come settle near ${village.name} in Quex!` : 'Check out this spot in Quex:'
    const msg = await shareSpot(game, { col, row }, text)
    if (msg) notify(msg)
  }

  const run = async (action: ActionKind, extra: Parameters<typeof tryAction>[5] = {}, need?: 'big' | 'medium' | 'small') => {
    const r = tryAction(game, p, action, col, row, extra, need)
    if (!r.ev) return notify(r.error ?? 'Not possible')
    await game.dispatch(r.ev)
    const last = game.state.log[game.state.log.length - 1]
    if (last) notify(logText(game.state, last.text))
    setMode('main')
  }

  if (!known) {
    return (
      <Shell onClose={onClose} title="Unexplored" onShare={share}>
        <p className="muted">Mist hides this hex.</p>
        <ActionButton game={game} p={p} action="scout" col={col} row={row} onRun={() => run('scout')} />
      </Shell>
    )
  }

  const title = village ? village.name : lair ? `${lair.kind[0].toUpperCase()}${lair.kind.slice(1)} lair` : here ? BUILDINGS[here.building.type].name : TERRAIN_NAME[terr]
  const sub = [TERRAIN_NAME[terr], `height ${cell.tier}`, land.resource && `${land.resource} deposit`, treeNote, cell.riverTo !== -1 && cell.tier > 0 && 'river'].filter(Boolean).join(' · ')

  if (mode === 'build') {
    const defs = Object.values(BUILDINGS)
    // what this hex allows first, then the rest (each says why it can't go here)
    const ok = (d: (typeof defs)[number]) => !!tryAction(game, p, 'build', col, row, { building: d.id }, d.size).ev
    const sorted = [...defs.filter(ok), ...defs.filter((d) => !ok(d))]
    return (
      <Shell onClose={onClose} title={`Build on ${TERRAIN_NAME[terr]}`}>
        <button className="btn ghost" onClick={() => setMode('main')}>← back</button>
        <div className="actions">
          {sorted.map((d) => <BuildButton key={d.id} game={game} p={p} def={d} col={col} row={row} onRun={() => run('build', { building: d.id }, d.size)} />)}
        </div>
        <p className="muted">Any village can build anything. Neighbours who each specialise and trade get further than going it alone.</p>
      </Shell>
    )
  }

  if (mode === 'caravan' && village) {
    return <CaravanForm game={game} p={p} to={village.id} onBack={() => setMode('main')} onSend={(goods) => run('caravan', { to: village.id, goods })} />
  }

  const acts: ActionKind[] = []
  if (lair) acts.push('expedition', 'scout')
  else if (village && village.id !== v.id) acts.push('caravan')
  else {
    acts.push('scout')
    if (trees && !here && !village) acts.push('clear')
    if (mine && land.resource && land.resource !== 'stone') acts.push('gather')
    if (mine && left?.ore === 'stone' && left.surface >= 1) acts.push('pick')
    if (mine && !here && !village && !trees) acts.push('plant')
    if (cell.tier > 0 && !mine) acts.push('outpost')
    if (cell.tier > 0) acts.push('road')
  }

  return (
    <Shell onClose={onClose} title={title} onShare={share}>
      <p className="muted" style={{ margin: 0 }}>{sub}</p>
      {!here && !village && land.resource && DEPOSIT_NOTE[land.resource] && isDeposit(land.resource, land.feature) && (
        <p className="deposit" style={{ margin: '4px 0' }}>⛏ {DEPOSIT_NOTE[land.resource]}</p>
      )}
      {!village && <Reserves left={left} wild={wild} game={wildNow(game, p, i)} building={here?.building.type} />}
      {village && <p style={{ margin: '4px 0' }}>👥 {Math.floor(village.population)} · morale {village.morale}</p>}
      {here && here.building.progress < 1 && <p style={{ margin: '4px 0' }}>Half built — spend another medium/big task to finish.</p>}
      {here && <p className="muted" style={{ margin: '4px 0' }}>{BUILDINGS[here.building.type].blurb}</p>}
      {lair && <p style={{ margin: '4px 0' }}>Strength {Math.round(lair.strength)}. Bring bronze, iron, leather and food to improve your odds.</p>}
      <div className="actions">
        {mine && !village && (!here || here.building.progress < 1) && (
          here
            ? <button className="btn medium action" onClick={() => run('build', { building: here.building.type }, BUILDINGS[here.building.type].size)}>Finish building<small>{fmtGoods(buildCost(v, BUILDINGS[here.building.type], game.now().toISOString()), 0.5)}</small></button>
            : cell.tier > 0 && <button className="btn medium action" onClick={() => setMode('build')}>Build…<small>medium or big task</small></button>
        )}
        {acts.map((a) => a === 'caravan'
          ? <button key={a} className="btn medium action" onClick={() => setMode('caravan')}>Send caravan…<small>medium task</small></button>
          : <ActionButton key={a} game={game} p={p} action={a} col={col} row={row} onRun={() => run(a)} />)}
      </div>
    </Shell>
  )
}

const wildNow = (game: Game, p: Player, i: number) => gameLeft(game.world, game.state, i, game.today(p.id))

const ORE_NAME: Record<string, string> = { copper: 'copper ore', iron: 'iron ore', tin: 'tin', silver: 'silver ore', stone: 'stone' }
const DIGGER: Record<string, string> = { copper: 'a mine', iron: 'a mine', silver: 'a mine', stone: 'a quarry', tin: '' }

/** How much the land here still holds, roughly. */
function Reserves({ left, wild, game: animals, building }: {
  left: ReturnType<typeof leftAt>; wild: number; game: number; building?: string
}) {
  const lines: string[] = []
  if (left && (left.ore !== 'stone' || left.surface + left.deep > 0)) {
    const name = ORE_NAME[left.ore]
    const loose = left.ore === 'stone' ? 'loose stone' : `${name} at the surface`
    if (left.surface >= 1) lines.push(`${about(left.surface)} ${loose}`)
    else if (left.start > 0) lines.push(left.ore === 'stone' ? 'picked clean of stone' : `${name}: worked out at the surface`)
    if (left.deep >= 1 && DIGGER[left.ore]) lines.push(`${about(left.deep)} more below${building && ['quarry', 'copper_mine', 'iron_mine', 'silver_mine'].includes(building) ? '' : ` (needs ${DIGGER[left.ore]})`}`)
    else if (left.deep < 1 && left.surface < 1 && left.ore !== 'stone') lines.push('nothing left')
  }
  if (wild > 0) lines.push(animals >= wild ? `game: ${wild} animals` : `game: ${Math.floor(animals)} of ${wild}, about ${GAME_REGROW} back a day`)
  if (!lines.length) return null
  return <p className="muted" style={{ margin: '4px 0' }}>⛰ {lines.join(' · ')}</p>
}

function Shell({ title, children, onClose, onShare }: { title: string; children: React.ReactNode; onClose: () => void; onShare?: () => void }) {
  return (
    <div className="inspector" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
      <button className="btn ghost close" onClick={onClose} aria-label="close">✕</button>
      {onShare && <button className="btn ghost share" onClick={onShare} title="Send someone a link to this hex">🔗 Share</button>}
      <h2>{title}</h2>
      {children}
    </div>
  )
}

function ActionButton({ game, p, action, col, row, onRun }: { game: Game; p: Player; action: ActionKind; col: number; row: number; onRun: () => void }) {
  const r = tryAction(game, p, action, col, row)
  const a = ACTIONS[action]
  // a road across a river is a bridge: a medium task
  const bridge = action === 'road' && actionSize(game.world, action, col, row, game.now().toISOString()) === 'medium'
  const name = bridge ? 'Bridge' : a.name
  const blurb = bridge ? 'A wood and stone bridge carries the road over the river.' : a.blurb
  return (
    <button className={`btn ${bridge ? 'medium' : a.size} action`} disabled={!r.ev} onClick={onRun} title={r.error ?? blurb}>
      {name}
      <small>{r.error ?? blurb}</small>
    </button>
  )
}

function BuildButton({ game, p, def, col, row, onRun }: { game: Game; p: Player; def: BuildingDef; col: number; row: number; onRun: () => void }) {
  const r = tryAction(game, p, 'build', col, row, { building: def.id }, def.size)
  const v = game.state.villages[p.villageId]
  return (
    <button className={`btn ${r.ev ? def.size : ''} action`} disabled={!r.ev} onClick={onRun} title={def.blurb}>
      {def.name}
      <small>{r.ev ? fmtGoods(buildCost(v, def, game.now().toISOString()), r.tok?.strength ?? 1) : r.error}</small>
    </button>
  )
}

function CaravanForm({ game, p, to, onBack, onSend }: { game: Game; p: Player; to: string; onBack: () => void; onSend: (g: Record<string, number>) => void }) {
  const v = game.state.villages[p.villageId]
  const [load, setLoad] = useState<Record<string, number>>({})
  const total = Object.values(load).reduce((a, n) => a + n, 0)
  const have = Object.entries(v.goods).filter(([, n]) => (n ?? 0) >= 1) as [Good, number][]
  const now = game.now()
  const mins = caravanMinutes(p, v, game.state.villages[to], now.toISOString())
  const arrive = new Date(now.getTime() + mins * 60_000)
  return (
    <Shell onClose={onBack} title={`Caravan to ${game.state.villages[to].name}`}>
      <button className="btn ghost" onClick={onBack}>← back</button>
      <p className="muted">Up to 15 goods. Gifts of food or rare goods cheer them up.</p>
      <p style={{ margin: '4px 0 8px' }}>
        Sent now, it arrives <b>{clockTime(arrive, now)}</b> <span className="muted">({span(mins * 60_000)} on the road, your phone's time)</span>
      </p>
      {have.map(([g, n]) => (
        <div key={g} className="row" style={{ justifyContent: 'space-between' }}>
          <span><Icon name={g} /> {GOOD_LABEL[g]} <span className="muted">({Math.floor(n)})</span></span>
          <span className="row">
            <button className="btn icon" onClick={() => setLoad({ ...load, [g]: Math.max(0, (load[g] ?? 0) - 1) })}>−</button>
            <b style={{ width: 24, textAlign: 'center' }}>{load[g] ?? 0}</b>
            <button className="btn icon" disabled={(load[g] ?? 0) + 1 > Math.floor(n) || total >= 15} onClick={() => setLoad({ ...load, [g]: (load[g] ?? 0) + 1 })}>+</button>
          </span>
        </div>
      ))}
      <button className="btn primary" disabled={!total} style={{ marginTop: 8 }}
        onClick={() => onSend(Object.fromEntries(Object.entries(load).filter(([, n]) => n > 0)))}>Send {total} goods</button>
    </Shell>
  )
}
