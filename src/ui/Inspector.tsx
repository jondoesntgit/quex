import { useState } from 'react'
import { ACTIONS, BUILDINGS, GOOD_LABEL, type ActionKind, type BuildingDef, type Good } from '../game/data'
import { buildCost, buildingAt, cellIndex, effectiveTerrain, fmtGoods, inTerritory, villageAt } from '../game/reducer'
import type { Player } from '../game/types'
import type { Game } from '../app/store'
import { ROLE_INFO, tryAction } from './helpers'

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
  const known = p.revealed.includes(i)
  const [mode, setMode] = useState<'main' | 'build' | 'caravan'>('main')
  const v = state.villages[p.villageId]
  const here = buildingAt(state, col, row)
  const village = villageAt(state, col, row)
  const lair = state.lairs.find((l) => l.col === col && l.row === row && !l.cleared)
  const terr = effectiveTerrain(world, state, i, game.today(p.id))
  const mine = inTerritory(v, col, row)

  const run = async (action: ActionKind, extra: Parameters<typeof tryAction>[5] = {}, need?: 'big' | 'medium' | 'small') => {
    const r = tryAction(game, p, action, col, row, extra, need)
    if (!r.ev) return notify(r.error ?? 'Not possible')
    await game.dispatch(r.ev)
    const last = game.state.log[game.state.log.length - 1]
    if (last) notify(last.text)
    setMode('main')
  }

  if (!known) {
    return (
      <Shell onClose={onClose} title="Unexplored">
        <p className="muted">Mist hides this hex.</p>
        <ActionButton game={game} p={p} action="scout" col={col} row={row} onRun={() => run('scout')} />
      </Shell>
    )
  }

  const title = village ? village.name : lair ? `${lair.kind[0].toUpperCase()}${lair.kind.slice(1)} lair` : here ? BUILDINGS[here.building.type].name : TERRAIN_NAME[terr]
  const sub = [TERRAIN_NAME[terr], `height ${cell.tier}`, cell.resource && `${cell.resource} deposit`, cell.riverTo !== -1 && cell.tier > 0 && 'river'].filter(Boolean).join(' · ')

  if (mode === 'build') {
    const defs = Object.values(BUILDINGS)
    const sorted = [...defs.filter((d) => d.role === v.role), ...defs.filter((d) => d.role === 'any'), ...defs.filter((d) => d.role !== v.role && d.role !== 'any')]
    return (
      <Shell onClose={onClose} title={`Build on ${TERRAIN_NAME[terr]}`}>
        <button className="btn ghost" onClick={() => setMode('main')}>← back</button>
        <div className="actions">
          {sorted.map((d) => <BuildButton key={d.id} game={game} p={p} def={d} col={col} row={row} onRun={() => run('build', { building: d.id }, d.size)} />)}
        </div>
        <p className="muted">Other roles’ buildings cost double: specialise and trade.</p>
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
    if (mine && cell.resource) acts.push('gather')
    if (mine && !here && !village) acts.push('plant')
    if (cell.tier > 0 && !mine) acts.push('outpost')
    if (cell.tier > 0) acts.push('road')
  }

  return (
    <Shell onClose={onClose} title={title}>
      <p className="muted" style={{ margin: 0 }}>{sub}</p>
      {village && <p style={{ margin: '4px 0' }}>{ROLE_INFO[village.role]?.name} · 👥 {Math.floor(village.population)} · morale {village.morale}</p>}
      {here && here.building.progress < 1 && <p style={{ margin: '4px 0' }}>Half built — spend another medium/big task to finish.</p>}
      {here && <p className="muted" style={{ margin: '4px 0' }}>{BUILDINGS[here.building.type].blurb}</p>}
      {lair && <p style={{ margin: '4px 0' }}>Strength {Math.round(lair.strength)}. Bring bronze, iron, leather and food to improve your odds.</p>}
      <div className="actions">
        {mine && !village && (!here || here.building.progress < 1) && (
          here
            ? <button className="btn medium action" onClick={() => run('build', { building: here.building.type }, BUILDINGS[here.building.type].size)}>Finish building<small>{fmtGoods(buildCost(v, BUILDINGS[here.building.type]), 0.5)}</small></button>
            : cell.tier > 0 && <button className="btn medium action" onClick={() => setMode('build')}>Build…<small>medium or big task</small></button>
        )}
        {acts.map((a) => a === 'caravan'
          ? <button key={a} className="btn medium action" onClick={() => setMode('caravan')}>Send caravan…<small>medium task</small></button>
          : <ActionButton key={a} game={game} p={p} action={a} col={col} row={row} onRun={() => run(a)} />)}
      </div>
    </Shell>
  )
}

function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="inspector" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
      <button className="btn ghost close" onClick={onClose} aria-label="close">✕</button>
      <h2>{title}</h2>
      {children}
    </div>
  )
}

function ActionButton({ game, p, action, col, row, onRun }: { game: Game; p: Player; action: ActionKind; col: number; row: number; onRun: () => void }) {
  const r = tryAction(game, p, action, col, row)
  const a = ACTIONS[action]
  return (
    <button className={`btn ${a.size} action`} disabled={!r.ev} onClick={onRun} title={r.error ?? a.blurb}>
      {a.name}{r.tok && r.tok.strength < 1 ? ' (½)' : ''}
      <small>{r.error ?? a.blurb}</small>
    </button>
  )
}

function BuildButton({ game, p, def, col, row, onRun }: { game: Game; p: Player; def: BuildingDef; col: number; row: number; onRun: () => void }) {
  const r = tryAction(game, p, 'build', col, row, { building: def.id }, def.size)
  const v = game.state.villages[p.villageId]
  return (
    <button className={`btn ${r.ev ? def.size : ''} action`} disabled={!r.ev} onClick={onRun} title={def.blurb}>
      {def.name}
      <small>{r.ev ? fmtGoods(buildCost(v, def), r.tok?.strength ?? 1) : r.error}</small>
    </button>
  )
}

function CaravanForm({ game, p, to, onBack, onSend }: { game: Game; p: Player; to: string; onBack: () => void; onSend: (g: Record<string, number>) => void }) {
  const v = game.state.villages[p.villageId]
  const [load, setLoad] = useState<Record<string, number>>({})
  const total = Object.values(load).reduce((a, n) => a + n, 0)
  const have = Object.entries(v.goods).filter(([, n]) => (n ?? 0) >= 1) as [Good, number][]
  return (
    <Shell onClose={onBack} title={`Caravan to ${game.state.villages[to].name}`}>
      <button className="btn ghost" onClick={onBack}>← back</button>
      <p className="muted">Up to 15 goods (6 on a half-finished task). Gifts of food or rare goods cheer them up.</p>
      {have.map(([g, n]) => (
        <div key={g} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{GOOD_LABEL[g]} <span className="muted">({Math.floor(n)})</span></span>
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
