import { useState } from 'react'
import { ACTIONS, BUILDINGS, DEEPEN_COST, FOOD, FOOD_SCALE, GATHER, GOOD_LABEL, MAX_DEPTH, ORES, stationOres, type ActionKind, type BuildingDef, type Good } from '../game/data'
import { fmtLb, stepOf } from '../game/units'
import { CARRY, fieldRain, WELCOME_DAYS, WELCOME_MORALE, welcomeOpen, actionSize, buildCost, buildSiteError, buildingAt, palisades, scoutRadius, scoutsNew, caravanCarry, caravanMinutes, caravanTier, clayLeft, provisionsFor, workable, clayRenews, mountainSpring, cellIndex, fmtGoods, inTerritory, landAt, logText, validate, villageAt } from '../game/reducer'
import { hasTrees, isDeposit, treeCount } from '../world/land'
import { distance, neighbours } from '../world/hex'
import { DUNGEON, GAME_REGROW, about, gameLeft, gameMax, leftAt, levels, mixAt } from '../game/deposits'
import type { Home, Player } from '../game/types'
import { GEAR, RATION, foodValue, nightsOf, troopsAt } from '../game/garrison'
import { WEIGHT, weightOf } from '../game/market'
import { WALLS, strongholdAt, wallsAfter } from '../game/strongholds'
import { refineTips } from '../game/advisor'
import { CARRY_EACH, jobs, needOf, people, spare, staffing } from '../game/workers'
import { SEASON_ICON, weekSeason } from '../game/calendar'
import { SHEEP_PER_SHEPHERD, heads, pastureCap, penCrew } from '../game/herds'
import { THIRSTY, WATER_NAME, hasWater, waterAt } from '../game/water'
import { eventId, type Game } from '../app/store'
import { outcome } from '../game/preview'
import { CITY_RADIUS, HOMES, centreOf, findHome, findUpgrade, groundOf, hexAt, paveable, type HomeKind } from '../game/city'
import { Confirm, type ConfirmProps } from './Confirm'
import { useStep } from './Advisor'
import { ActionStrip } from './ActionStrip'
import { canPay, mixText, oreHint, shareSpot, spendables, tryAction } from './helpers'
import { Icon } from './Icon'
import { clockTime, span } from './Caravans'


/** What a deposit is good for (shown on the hex card). */
const DEPOSIT_NOTE: Record<string, string> = {
  iron: 'Iron deposit: rusty limonite at the surface to gather by hand. A Deep iron mine (big task) reaches hematite, and black magnetite deeper down. A Bloomery works them all into iron.',
  copper: 'Copper deposit: green malachite at the surface to gather by hand. A Copper mine (big task) reaches brassy chalcopyrite deeper down, which needs a Roasting heap before the Smelter, and carries a little silver. Copper plus a little tin makes bronze.',
  silver: 'Silver! Galena, heavy grey lead ore rich in silver. A Silver mine (big task) digs it, and a Silver refinery turns it into silver, the coin every merchant takes.',
  tin: 'Tin! Rare: gather it (small task) and trade it. A little tin turns copper into bronze.',
  stone: 'Building stone: a Quarry could go here (medium task), or gather stone by hand (small task).',
  clay: 'River clay: gather it (small task) for a Brick kiln.',
  salt: 'Salt: gather it (small task), or build Salt pans on the shore (medium task). One pinch salts a ration: dairies use it for cheese, and a smokehouse can cure game with it.',
}

const TERRAIN_NAME: Record<string, string> = {
  deep: 'Deep sea', ocean: 'Sea', shallow: 'Shallows', beach: 'Beach', grass: 'Grassland', meadow: 'Meadow',
  forest: 'Forest', swamp: 'Swamp', hills: 'Hills', desert: 'Desert', savannah: 'Savannah', rock: 'Mountain',
  tundra: 'Tundra', snow: 'Snowfield',
}

export function Inspector({ game, p, col, row, tap, onClose, notify, welcome: welcomeFirst }: {
  game: Game; p: Player; col: number; row: number; /** where on the map it was tapped (px, unlifted), so a home goes there */ tap?: { x: number; y: number }; onClose: () => void; notify: (s: string) => void
  /** open straight on a welcoming caravan to the village here (from the log) */
  welcome?: boolean
}) {
  const { world, state } = game
  const i = cellIndex(world, col, row)
  const cell = world.cells[i]
  const known = state.revealed.includes(i)
  const [mode, setMode] = useState<'main' | 'build' | 'gather' | 'caravan' | 'troops' | 'welcome'>(welcomeFirst ? 'welcome' : 'main')
  // the yes/no window shown before anything is spent
  const [confirm, setConfirm] = useState<Omit<ConfirmProps, 'onNo'> | null>(null)
  const v = state.villages[p.villageId]
  const season = weekSeason(game.today(p.id))
  const here = buildingAt(state, col, row)
  // any hex of a village's city is that village: tapping its cobbles names it and offers caravans and troops
  const village = villageAt(state, col, row) ?? Object.values(state.villages).find((x) => x.city?.includes(row * world.width + col)) ?? null
  const lair = state.lairs.find((l) => l.col === col && l.row === row && !l.cleared)
  const fort = known ? strongholdAt(world, i) : null
  const siege = fort ? state.sieges?.[i] : undefined
  const land = landAt(world, state, i, game.today(p.id))
  const terr = land.terrain
  const trees = hasTrees(land)
  const stand = state.woods?.[i]
  const count = trees ? treeCount(land) - (land.stumps ?? 0) : 0
  const treeNote = stand?.young ? `${stand.young} saplings (trees by winter)`
    : trees ? `${count} tree${count === 1 ? '' : 's'}${land.stumps ? `, ${land.stumps} stump${land.stumps === 1 ? '' : 's'}` : ''}` : null
  const mine = inTerritory(v, col, row)
  const inCity = !!v.city?.includes(i)
  /** can cobblestone go on this hex at all (land, near the square, not yet cobbled)? the card says why not when it can't yet */
  const cobbleOk = !inCity && !!v.city?.length && cell.tier > 0 && distance(cell, v) <= CITY_RADIUS && paveable(cell)
  const left = known ? leftAt(world, state, i) : null
  const wild = known ? gameMax(world, i) : 0

  const share = async () => {
    const text = village ? `Come settle near ${village.name} in Quex!` : 'Check out this spot in Quex:'
    const msg = await shareSpot(game, { col, row }, text)
    if (msg) notify(msg)
  }

  /** greyed out when there's no action to pay for it: still opens, to look at what it would take */
  const cant = (size: 'big' | 'medium' | 'small') => (canPay(p, size) ? '' : ' cant')
  /** the build menu holds every size: grey it only with no whole action at all */
  const cantAny = spendables(p).some((t) => t.strength >= 1) ? '' : ' cant'

  const run = async (action: ActionKind, extra: Parameters<typeof tryAction>[5] = {}, need?: 'big' | 'medium' | 'small') => {
    const r = tryAction(game, p, action, col, row, extra, need)
    // the window closes whatever happens: a "yes" that can't go through says why instead of hanging there
    setConfirm(null)
    if (!r.ev) return notify(r.error ?? 'Not possible')
    try {
      await game.dispatch(r.ev)
    } catch (e) {
      console.error(e)
      return notify("That didn't go through: try again")
    }
    const last = game.state.log[game.state.log.length - 1]
    if (last) notify(logText(game.state, last.text))
    setMode('main')
  }

  /** Show what an action would spend and give, and only spend it on a yes. */
  const ask = (action: ActionKind, extra: Parameters<typeof tryAction>[5] = {}, need?: 'big' | 'medium' | 'small', title?: string) => {
    const r = tryAction(game, p, action, col, row, extra, need)
    if (!r.ev || !r.tok) return notify(r.error ?? 'Not possible')
    const o = outcome(world, state, p, action, col, row, extra, { size: r.tok.size, strength: r.tok.strength, merged: !!r.tok.tok2 }, game.now().toISOString())
    const res = land.resource
    const what = extra.building ? `Build a ${BUILDINGS[extra.building].name}?`
      : extra.home ? `Build a ${HOMES[extra.home.kind].name.toLowerCase()}?`
      : action === 'gather' && res && GATHER[res] ? `Gather ${GOOD_LABEL[GATHER[res]!].toLowerCase()}?`
      : action === 'road' && r.tok.size === 'medium' ? 'Build a bridge?'
      : ASK_TITLE[action] ?? `${ACTIONS[action].name}?`
    setConfirm({ title: title ?? what, ...o, onYes: () => void run(action, extra, need) })
  }
  const dialog = confirm && <Confirm {...confirm} onNo={() => setConfirm(null)} extra={<ActionStrip game={game} p={p} readOnly />} />

  if (!known) {
    return (
      <Shell strip={<ActionStrip game={game} p={p} />} onClose={onClose} title="Unexplored" onShare={share}>
        <p className="muted">Mist hides this hex.</p>
        <ActionButton game={game} p={p} action="scout" col={col} row={row} onRun={() => run('scout')} />
      </Shell>
    )
  }

  const owner = village ? state.players[village.playerId] : null
  const title = village ? (village.col === col && village.row === row ? village.name : `${owner ? owner.name : village.name.replace(/'s .*$/, '')}'s city`) : known && strongholdAt(world, i) ? strongholdAt(world, i)!.name : lair ? `${lair.kind[0].toUpperCase()}${lair.kind.slice(1)} lair` : here ? BUILDINGS[here.building.type].name : TERRAIN_NAME[terr]
  const sub = [TERRAIN_NAME[terr], `height ${cell.tier}`, land.resource && `${land.resource} deposit`, treeNote, cell.riverTo !== -1 && cell.tier > 0 && 'river'].filter(Boolean).join(' · ')

  const tierOf = (to: NonNullable<typeof village>) => caravanTier(world, state, v, to)
  const acts: ActionKind[] = []
  /** things you collect (their own sub-menu) and things you make or lay (inside Build) */
  const gatherActs: ActionKind[] = [], workActs: ActionKind[] = []
  // scouting is only offered where it would uncover something
  const canScout = scoutsNew(world, state, col, row, scoutRadius(v, 1))
  const ownMine = here && here.village.id === v.id && BUILDINGS[here.building.type].mine && here.building.progress >= 1 ? here.building : null
  const dungeon = state.dungeons?.[i]
  if (fort && !siege?.fallen) acts.push('siege', ...(canScout ? ['scout' as const] : []))
  else if (lair) acts.push('expedition', ...(canScout ? ['scout' as const] : []))
  else if (village && village.id !== v.id) acts.push('caravan', 'troops')
  else {
    if (canScout) acts.push('scout')
    if (trees && !here && !village) gatherActs.push('chop', 'clear')
    if (mine && terr === 'swamp' && !here && !village) gatherActs.push('rice', 'peat')
    if (mine && land.resource && land.resource !== 'stone' && GATHER[land.resource]) gatherActs.push('gather')
    if (mine && left?.ore === 'stone' && left.surface >= 1) gatherActs.push('pick')
    if (mine && clayLeft(world, state, i) !== null) gatherActs.push('dig_clay')
    if (mine && !here && !village && !trees) workActs.push('plant')
    if (cell.tier > 0 && !mine) acts.push('outpost')
    // dirt roads are dug by the road team (the plan above); by hand, only stone
    // on a building's hex, paving is offered on the card itself (a road through a field joins two cities)
    if (cell.tier > 0 && !v.paved?.includes(i) && !inCity && !here) workActs.push('pave')
    if (mine && cell.tier > 0 && !waterAt(world, state, i) && (!hasWater(world, state, i) || (here && THIRSTY.has(here.building.type)))) workActs.push('well')
    if (ownMine && (ownMine.depth ?? 1) < MAX_DEPTH) acts.unshift('deepen')
    if (here && here.village.id === v.id && here.building.progress >= 1 && workable(here.building)) acts.unshift('work')
    if (dungeon && dungeon.villageId === v.id && dungeon.raids > 0) acts.unshift('expedition')
  }


  if (mode === 'build') {
    // homes go in the city now; the old House only for a village with no open land beside it for a city
    const stuck = (v.city?.length ?? 0) < 2 && !neighbours(world.cells[cellIndex(world, v.col, v.row)].col, world.cells[cellIndex(world, v.col, v.row)].row).some(([c, r]) => c >= 0 && r >= 0 && c < world.width && r < world.height && paveable(world.cells[cellIndex(world, c, r)]))
    const defs = Object.values(BUILDINGS).filter((d) => !d.legacy || stuck)
    // only what this hex could take: no silver mine without silver, no dock inland. What it's short of
    // (materials, a building it needs first) still shows, greyed, with the reason on the button
    const fits = defs.filter((d) => !buildSiteError(game.world, game.state, v, d, col, row) && !(here && here.building.type === d.id && here.building.progress >= 1))
    const ok = (d: (typeof defs)[number]) => !!tryAction(game, p, 'build', col, row, { building: d.id }, d.size).ev
    const sorted = [...fits.filter(ok), ...fits.filter((d) => !ok(d))]
    const hidden = defs.length - fits.length
    const ownHere = !!here && here.village.id === v.id
    const bldgs = mine && !village && (!here || ownHere) && !inCity
    return (
      <Shell strip={<ActionStrip game={game} p={p} />} onClose={onClose} title={`Build on ${TERRAIN_NAME[terr]}`}>
        <button className="btn ghost" onClick={() => setMode('main')}>← back</button>
        <p className="muted" style={{ margin: '4px 0' }}>Pick something to see what it costs and what you get. Nothing is spent until you say yes.</p>
        {(inCity || (cobbleOk && !village)) && (
          <>
            <h3 className="sub">City</h3>
            <div className="actions">
              {!inCity && <WorkButton game={game} p={p} action="cobble" col={col} row={row} onPick={() => ask('cobble')} />}
              {inCity && <UpgradeButton game={game} p={p} hex={i} col={col} row={row} onPick={(h, index) => ask('upgrade', { home: h, replace: index }, HOMES.townhouse.size)} />}
              {inCity && (['cottage', 'townhouse', 'barn'] as HomeKind[]).map((k) => <HomeButton key={k} game={game} p={p} kind={k} hex={i} col={col} row={row} tap={tap} onPick={(h) => ask('home', { home: h }, HOMES[k].size)} />)}
            </div>
          </>
        )}
        {cell.tier > 0 && (() => {
          const inPlan = (v.roadPlan ?? []).includes(i)
          const next = inPlan ? (v.roadPlan ?? []).filter((j) => j !== i) : [...(v.roadPlan ?? []), i]
          const w = game.world.width
          const ev = { t: 'roadplan' as const, id: eventId(), at: game.now().toISOString(), playerId: p.id, plan: next.map((j) => ({ col: j % w, row: Math.floor(j / w) })) }
          const err = inPlan ? null : validate(game.state, game.world, ev)
          return (
            <div className="actions">
              <button className="btn small action" disabled={!!err} title={err ?? undefined}
                onClick={() => { void game.dispatch(ev) }}>
                {inPlan ? 'Take off the road plan' : 'Add to the road plan'}
                <small>{err ?? (inPlan ? 'the team will skip this hex' : `a team of villagers digs it as no. ${next.length}; no action needed`)}</small>
              </button>
            </div>
          )
        })()}
        {workActs.length > 0 && (
          <>
            <h3 className="sub">Roads, wells and trees</h3>
            <div className="actions">
              {workActs.map((a) => <WorkButton key={a} game={game} p={p} action={a} col={col} row={row} onPick={() => ask(a)} />)}
            </div>
          </>
        )}
        {bldgs ? (
          <>
            <h3 className="sub">{ownHere ? `Replace the ${BUILDINGS[here!.building.type].name}` : 'Buildings'}</h3>
            {ownHere && <p className="muted" style={{ margin: '0 0 4px' }}>Building over it pulls it down at no cost in actions, and every material that went into it comes back.</p>}
            <div className="actions">
              {sorted.map((d) => <BuildButton key={d.id} game={game} p={p} def={d} col={col} row={row} onRun={() => ask('build', { building: d.id }, d.size)} />)}
            </div>
            {sorted.length === 0 && <p className="muted">Nothing can be built on this hex.</p>}
            <p className="muted">{hidden > 0 ? `${hidden} other buildings need different ground (a deposit, the shore, a river, open land). ` : ''}Any village can build anything it has the ground for. Neighbours who each specialise and trade get further than going it alone.</p>
          </>
        ) : <p className="muted">{village ? 'The village square: homes go on the cobblestone around it.' : inCity ? 'Workshops need open ground; homes go here.' : here ? 'There is a building here already.' : 'Buildings can only go up inside your territory.'}</p>}
        {dialog}
      </Shell>
    )
  }

  if (mode === 'gather') {
    return (
      <Shell strip={<ActionStrip game={game} p={p} />} onClose={onClose} title={`Gather on ${TERRAIN_NAME[terr]}`}>
        <button className="btn ghost" onClick={() => setMode('main')}>← back</button>
        <p className="muted" style={{ margin: '4px 0' }}>What do you want to gather here? You'll see what you'd get, and what it uses up, before anything is spent.</p>
        <div className="actions">
          {gatherActs.map((a) => <GatherButton key={a} game={game} p={p} action={a} col={col} row={row} onPick={() => ask(a)} />)}
        </div>
        {dialog}
      </Shell>
    )
  }

  if (mode === 'troops' && village) {
    return <TroopsForm game={game} p={p} to={village.id} onBack={() => setMode('main')} onSend={(troops, goods) => run('troops', { to: village.id, troops, goods })} />
  }

  if (mode === 'caravan' && village) {
    return <CaravanForm game={game} p={p} to={village.id} onBack={() => setMode('main')} onSend={(goods, crew, food) => run('caravan', { to: village.id, goods, crew, food })} />
  }
  if (mode === 'welcome' && village && welcomeOpen(state, v, village, game.now().toISOString())) {
    return <CaravanForm game={game} p={p} to={village.id} welcome onBack={() => setMode('main')} onSend={(goods, crew, food) => run('caravan', { to: village.id, goods, crew, food, welcome: true })} />
  }

  return (
    <Shell strip={<ActionStrip game={game} p={p} />} onClose={onClose} title={title} onShare={share}>
      <p className="muted" style={{ margin: 0 }}>{sub}</p>
      {!here && !village && land.resource && DEPOSIT_NOTE[land.resource] && isDeposit(land.resource, land.feature) && (
        <p className="deposit" style={{ margin: '4px 0' }}>⛏ {DEPOSIT_NOTE[land.resource]}</p>
      )}
      {!village && <Reserves left={left} wild={wild} game={wildNow(game, p, i)} building={here?.building.type} />}
      {known && clayLeft(world, state, i) !== null && (
        <p className="muted" style={{ margin: '4px 0' }}>
          {mountainSpring(world, i) ? '💧 A small spring trickles down the rock here, with white kaolin clay along it' : clayRenews(world, i) ? '🏺 Clay along the water here' : '🏺 Clay under the soil here (a dug pit seeps back one load each winter)'}: {Math.floor(clayLeft(world, state, i)!) || 'dug out'}{clayLeft(world, state, i)! >= 1 ? ' left' : ''}{clayRenews(world, i) ? ', and more every winter' : ''}.
        </p>
      )}
      {known && (() => {
        const today = game.today(p.id)
        const w = waterAt(world, state, i, today)
        const near = hasWater(world, state, i, today)
        const herd = here && THIRSTY.has(here.building.type)
        if (!w && !herd) return null
        return (
          <p className={herd && (!near || near.dry) ? 'deal-no' : 'muted'} style={{ margin: '4px 0' }}>
            {w ? `💧 ${w.kind === 'pond' ? 'A pond (an old clay pit, filled with rain)' : w.kind === 'well' ? 'A well' : `Fresh water: ${WATER_NAME[w.kind]}`}${w.dry ? ', dried up in the summer heat' : w.kind === 'pond' ? ': it dries up on summer days' : ''}.` : ''}
            {herd && (near && !near.dry ? ` The herd drinks from ${WATER_NAME[near.kind]}.` : near ? ` ${WATER_NAME[near.kind][0].toUpperCase() + WATER_NAME[near.kind].slice(1)} has dried up: the herd gives half until it fills.` : ' No fresh water within a hex: the herd gives half. Dig a well (medium task, 3 stone).')}
          </p>
        )
      })()}
      {inCity && <p className="muted" style={{ margin: '4px 0' }}>🧱 Cobbled city: homes can stand here{(v.homes ?? []).length ? ` (${v.homes!.length} in the city so far)` : ''}.</p>}
      {v.paved?.includes(i) && <p className="muted" style={{ margin: '4px 0' }}>A paved road: caravans along it carry more and go faster.</p>}
      {(() => {
        // other players' road plans through this hex: put it on yours too, and the teams dig it together
        const others = Object.values(state.villages).filter((x) => x.id !== v.id && x.roadPlan?.includes(i))
        if (!others.length) return null
        const names = others.map((x) => `${state.players[x.playerId]?.name ?? x.name}'s (no. ${x.roadPlan!.indexOf(i) + 1})`).join(' and ')
        const mineToo = v.roadPlan?.includes(i)
        return <p className="muted" style={{ margin: '4px 0' }}>🛠 On {names} road plan.{mineToo ? ' On yours too: your teams dig it together.' : ' Add it to your plan and your teams dig it together.'}</p>
      })()}
      {village && <p style={{ margin: '4px 0' }}>👥 {Math.floor(village.population)}{village.away ? ` (${village.away} away)` : ''} · morale {village.morale}</p>}
      {here && here.building.progress < 1 && <p style={{ margin: '4px 0' }}>Half built — spend another medium/big task to finish.</p>}
      {here && <p className="muted" style={{ margin: '4px 0' }}>{BUILDINGS[here.building.type].blurb}</p>}
      {here && here.village.id === v.id && here.building.progress >= 1 && needOf(here.building) > 0 && (
        needOf(here.building, season) === 0
          ? <p className="muted" style={{ margin: '4px 0' }}>{SEASON_ICON[season]} Nothing to do here in {season}: its {needOf(here.building)} people are free for other work.</p>
          : (
            <p className={staffing(v, here.building, season) < 1 ? 'deal-no' : 'muted'} style={{ margin: '4px 0' }}>
              👥 {jobs(v, season)[here.building.id] ?? 0} of {needOf(here.building, season)} workers {SEASON_ICON[season]}{staffing(v, here.building, season) < 1 ? `: it makes ${Math.round(staffing(v, here.building, season) * 100)}% (Village tab: Workers)` : ''}.
            </p>
          )
      )}
      {here && here.village.id === v.id && here.building.progress >= 1 && BUILDINGS[here.building.type].harvest && (
        <p className="muted" style={{ margin: '4px 0' }}>
          🌾 {season === 'spring' ? `Sowing now: ${Math.round((here.building.sown ?? 1) * 100)}% sown so far (half a crew sows over Sunday and Monday; seed sown on a day of the rain habit comes up 20% more).`
            : season === 'summer' ? `${Math.round((here.building.sown ?? 1) * 100)}% sown${fieldRain(here.building) > 1 ? `, ${Math.round((fieldRain(here.building) - 1) * 100)}% more for the spring rain` : ''}. Nothing to do until the harvest.`
            : season === 'autumn' ? `Harvest: a full crew reaps it Thursday and Friday; the rain habit on a reaping day reaps 20% more. It was ${Math.round((here.building.sown ?? 1) * 100)}% sown (unsown ground still gives a quarter)${fieldRain(here.building) > 1 ? `, ${Math.round((fieldRain(here.building) - 1) * 100)}% more for the spring rain` : ''}.`
            : 'Resting for the winter. It is sown again in spring.'}
        </p>
      )}
      {here && here.village.id === v.id && here.building.progress >= 1 && BUILDINGS[here.building.type].herd && (
        <p className="muted" style={{ margin: '4px 0' }}>
          🐑 {heads(here.building)} sheep, a shepherd to every {SHEEP_PER_SHEPHERD}: {penCrew(here.building)} to tend them. Your pasture feeds {pastureCap(world, state, v, (c, r) => inTerritory(v, c, r))} in all (the hexes within a hex of a well or pen that have nothing built on them). The flock grows by half each spring, and the oldest tenth is culled each autumn.
        </p>
      )}
      {here && here.village.id === v.id && BUILDINGS[here.building.type].recipes && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>
          <span className="muted">Making:</span>
          {BUILDINGS[here.building.type].recipes!.map((r) => {
            const on = (here.building.order ?? BUILDINGS[here.building.type].recipes![0].id) === r.id
            return <button key={r.id} className={`btn ${on ? 'primary' : ''}`} title={`${fmtGoods(r.consumes)} → ${fmtGoods(r.produces)} a night`}
              onClick={() => !on && void game.dispatch({ t: 'order', id: eventId(), at: game.now().toISOString(), playerId: p.id, building: here.building.id, recipe: r.id })}>{r.name}</button>
          })}
        </div>
      )}
      {here && BUILDINGS[here.building.type].mine && <Shaft game={game} i={i} depth={here.building.depth ?? 1} />}
      {here && BUILDINGS[here.building.type].smelts && here.village.id === v.id && <Works game={game} p={p} station={here.building.type} />}
      {dungeon && (
        <p style={{ margin: '4px 0' }}>
          🕳 Below: {DUNGEON[dungeon.kind].name}. {dungeon.raids > 0
            ? <>Strength {Math.round(dungeon.strength)}, loot for about {dungeon.raids} more raid{dungeon.raids === 1 ? '' : 's'} ({fmtGoods(DUNGEON[dungeon.kind].loot)} each). An expedition (big task) goes down the shaft.</>
            : <>Picked clean.</>}
        </p>
      )}
      {fort && <Siege game={game} p={p} fort={fort} siege={siege} />}
      {lair && <p style={{ margin: '4px 0' }}>Strength {Math.round(lair.strength)}. Bring bronze, iron, leather and food to improve your odds.</p>}
      <div className="actions">
        {mine && !village && here && here.building.progress < 1
          ? <button className={`btn medium action${cant(BUILDINGS[here.building.type].size)}`} onClick={() => ask('build', { building: here.building.type }, BUILDINGS[here.building.type].size, `Finish the ${BUILDINGS[here.building.type].name}?`)}>Finish building<small>would cost {fmtGoods(buildCost(v, BUILDINGS[here.building.type], game.now().toISOString()), 0.5)}</small></button>
          : (cell.tier > 0 || terr === 'shallow') && !(village && village.id !== v.id) && (!lair && !(fort && !siege?.fallen)) && (workActs.length > 0 || inCity || (cobbleOk && !village) || (mine && !village && (!here || here.village.id === v.id)))
            && <button className={`btn medium action${cantAny}`} onClick={() => setMode('build')}>Build…<small>{here ? 'build over it: its materials come back' : 'buildings, roads, wells, trees'}</small></button>}
        {gatherActs.length > 0 && <button className="btn small action" onClick={() => setMode('gather')}>Gather…<small>{gatherActs.length === 1 ? 'one thing to gather here' : `${gatherActs.length} things to gather here`}</small></button>}
        {village && village.id !== v.id && welcomeOpen(state, v, village, game.now().toISOString()) && (
          <button className="btn small action" onClick={() => setMode('welcome')}>Send a welcoming caravan…<small>they're new here: no action needed, and it lifts your village's morale (+{WELCOME_MORALE})</small></button>
        )}
        {here && cell.tier > 0 && !v.paved?.includes(i) && !inCity && (
          <WorkButton game={game} p={p} action="pave" col={col} row={row} label={`Pave a road through the ${BUILDINGS[here.building.type].name.toLowerCase()}`}
            note={`2 stone: the ${BUILDINGS[here.building.type].name.toLowerCase()} stays and keeps working, and a paved road runs on through it (to join two cities, say)`}
            onPick={() => ask('pave', {}, undefined, `Pave a road through the ${BUILDINGS[here.building.type].name.toLowerCase()}?`)} />
        )}
        {acts.map((a) => a === 'caravan'
          ? <button key={a} className={`btn ${tierOf(village!) === 'medium' ? 'medium' : 'small'} action${tierOf(village!) === 'free' ? '' : cant(tierOf(village!) === 'medium' ? 'medium' : 'small')}`} onClick={() => setMode('caravan')}>Send caravan…<small>{tierOf(village!) === 'free' ? 'free on paved road (ox carts)' : tierOf(village!) === 'small' ? 'small task: a road connects you' : 'medium task: no road connects you'}</small></button>
          : a === 'troops'
            ? <button key={a} className={`btn medium action${cant('medium')}`} disabled={!palisades(village!)} onClick={() => setMode('troops')}>Send troops…<small>{palisades(village!) ? `medium task · ${troopsAt(state, village!)} on their walls` : 'They have no palisade to hold them'}</small></button>
            : <ActionButton key={a} game={game} p={p} action={a} col={col} row={row} onRun={() => run(a)} />)}
      </div>
      {dialog}
    </Shell>
  )
}

const wildNow = (game: Game, p: Player, i: number) => gameLeft(game.world, game.state, i, game.today(p.id))

/** A stronghold: its strength, its walls, and what the village could bring against them. */
function Siege({ game, p, fort, siege }: { game: Game; p: Player; fort: NonNullable<ReturnType<typeof strongholdAt>>; siege?: { strength: number; fallen?: string; by?: string } }) {
  if (siege?.fallen) return <p className="muted" style={{ margin: '4px 0' }}>🏳 Fallen: taken by {game.state.villages[siege.by ?? '']?.name ?? 'someone'}. Only ruins and ravens now.</p>
  const v = game.state.villages[p.villageId]
  const g = v.goods
  const strength = siege?.strength ?? fort.strength
  const cannon = Math.min(Math.floor(g.cannon ?? 0), Math.floor((g.cannonballs ?? 0) / 2), Math.floor((g.gunpowder ?? 0) / 2))
  const walls = wallsAfter(g, cannon)
  return (
    <div className="shaft">
      <p style={{ margin: '2px 0' }}>🏰 A warlord's stronghold. Strength {Math.round(strength)}, and its walls triple it (x{WALLS}).</p>
      <p className="muted" style={{ margin: '2px 0' }}>
        Against them you'd bring: {Math.floor(g.ram ?? 0)} rams, {Math.floor(g.siege_tower ?? 0)} siege towers, {cannon} cannon ready to fire (each needs 2 shot and 2 powder),
        {' '}{Math.min(Math.floor(g.musket ?? 0), Math.floor(g.gunpowder ?? 0))} muskets with powder. The walls would stand at x{walls}.
      </p>
      <p className="muted" style={{ margin: '2px 0' }}>Its hoard: {fmtGoods(fort.loot)}. Powder, shot and engines are spent in the assault, win or lose.</p>
    </div>
  )
}

/** A mine's shaft, level by level: what's left, what it's made of, and how deep it reaches. */
function Shaft({ game, i, depth }: { game: Game; i: number; depth: number }) {
  const lv = levels(game.world, game.state, i)
  const left = leftAt(game.world, game.state, i)
  if (!lv || !left) return null
  const working = lv.findIndex((n) => n > 0.5)
  const next = depth < MAX_DEPTH ? DEEPEN_COST[depth + 1] : null
  return (
    <div className="shaft">
      {lv.map((n, k) => (
        <div key={k} className={`shaft-level ${k > depth ? 'unreached' : ''} ${k === working ? 'working' : ''}`}>
          <b>{k === 0 ? 'Surface' : `Level ${k}`}</b>
          <span className="muted">
            {n < 0.5 ? 'worked out' : `about ${Math.round(n)} · ${mixText(mixAt(left.ore, k))}`}
            {k > depth && n >= 0.5 ? ' · sink the shaft to reach' : k === working && k <= depth ? ' · digging now' : ''}
          </span>
        </div>
      ))}
      {next && <p className="muted" style={{ margin: '4px 0 0' }}>Sinking it to level {depth + 1} takes a big task and {fmtGoods(next)} to shore it up.{game.world.cells[i].feature?.startsWith('mountain') ? ' Deep under a mountain, who knows what the miners might break into.' : ''}</p>}
    </div>
  )
}

/** What a smelting station works, and whether the village has what each ore needs. */
function Works({ game, p, station }: { game: Game; p: Player; station: Parameters<typeof stationOres>[0] }) {
  const v = game.state.villages[p.villageId]
  return (
    <div className="shaft">
      {stationOres(station).map((g) => {
        const h = oreHint(v, g)!
        const have = Math.floor(v.goods[g] ?? 0)
        return (
          <div key={g} className="shaft-level">
            <b><Icon name={g} /> {GOOD_LABEL[g]}{have ? ` ×${have}` : ''}</b>
            <span className="muted">{ORES[g]!.yield} {GOOD_LABEL[ORES[g]!.metal].toLowerCase()} each, {ORES[g]!.fuel} charcoal{h.missing.length ? ` · needs a ${h.missing.map((id) => BUILDINGS[id].name).join(' and a ')}` : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

const ORE_NAME: Record<string, string> = { copper: 'malachite', iron: 'limonite', tin: 'tin', silver: 'galena', stone: 'stone' }
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

function Shell({ title, children, onClose, onShare, strip }: { title: string; children: React.ReactNode; onClose: () => void; onShare?: () => void; strip?: React.ReactNode }) {
  return (
    <div className="inspector" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
      <button className="btn ghost close" onClick={onClose} aria-label="close">✕</button>
      {onShare && <button className="btn ghost share" onClick={onShare} title="Send someone a link to this hex">🔗 Share</button>}
      <h2>{title}</h2>
      {strip}
      {children}
    </div>
  )
}

function ActionButton({ game, p, action, col, row, onRun }: { game: Game; p: Player; action: ActionKind; col: number; row: number; onRun: () => void }) {
  const r = tryAction(game, p, action, col, row)
  const a = ACTIONS[action]
  // a road across a river is a bridge: a medium task
  const bridge = (action === 'road' || action === 'pave') && actionSize(game.world, action, col, row, game.now().toISOString(), game.state.villages[p.villageId]) === 'medium'
  const name = bridge ? 'Bridge' : a.name
  const blurb = bridge ? 'A wood and stone bridge carries the road over the river.' : a.blurb
  return (
    <button className={`btn ${bridge ? 'medium' : a.size} action`} disabled={!r.ev} onClick={onRun} title={r.error ?? blurb}>
      {name}
      <small>{r.error ?? blurb}</small>
    </button>
  )
}

const homeCache = new Map<string, Home | null>()
/** Where a home of this kind would go on this hex (the same answer until the game changes). */
function homeSpot(game: Game, v: NonNullable<ReturnType<typeof villageAt>>, kind: HomeKind, hex: number, tap?: { x: number; y: number }): Home | null {
  // where you tapped, if you did; else the middle of the hex
  const near = tap ? groundOf(v, tap.x, tap.y) : centreOf(game.world, v, hex)
  const key = `${game.meta.worldSeed}:${game.state.version}:${v.id}:${hex}:${kind}:${Math.round(near[0] / 3)},${Math.round(near[1] / 3)}`
  if (!homeCache.has(key)) {
    if (homeCache.size > 200) homeCache.clear()
    homeCache.set(key, findHome(game.world, v, kind, hex, near))
  }
  return homeCache.get(key) ?? null
}

/** A cottage or town house for this hex: where it would stand is worked out first, so the card can say if there's no room. */
function HomeButton({ game, p, kind, hex, col, row, tap, onPick }: { game: Game; p: Player; kind: HomeKind; hex: number; col: number; row: number; tap?: { x: number; y: number }; onPick: (h: Home) => void }) {
  const v = game.state.villages[p.villageId]
  const def = HOMES[kind]
  const h = homeSpot(game, v, kind, hex, tap)
  const r = h ? tryAction(game, p, 'home', col, row, { home: h }, def.size) : null
  return (
    <button className={`btn ${r?.ev ? def.size : ''} action`} disabled={!r?.ev} onClick={() => h && onPick(h)} title={def.blurb}>
      {def.name}
      <small>{r?.ev ? `${def.storage ? `stores ${def.storage * FOOD_SCALE} rations` : `room for ${def.cap}`} · would cost ${fmtGoods(def.cost)}` : h ? r?.error : 'No room on this hex'}</small>
    </button>
  )
}

const upgradeCache = new Map<string, { index: number; home: Home } | null>()
/** Rebuild a cottage on this hex as a town house, if there is one and there's room (shown only when there's a cottage). */
function UpgradeButton({ game, p, hex, col, row, onPick }: { game: Game; p: Player; hex: number; col: number; row: number; onPick: (h: Home, index: number) => void }) {
  const v = game.state.villages[p.villageId]
  // only on a hex that has a cottage of its own
  if (!(v.homes ?? []).some((h) => h.kind === 'cottage' && hexAt(game.world, v, [h.x, h.y]) === hex)) return null
  const key = `${game.meta.worldSeed}:${game.state.version}:${v.id}:${hex}`
  if (!upgradeCache.has(key)) {
    if (upgradeCache.size > 100) upgradeCache.clear()
    upgradeCache.set(key, findUpgrade(game.world, v, hex))
  }
  const u = upgradeCache.get(key) ?? null
  const r = u ? tryAction(game, p, 'upgrade', col, row, { home: u.home, replace: u.index }, HOMES.townhouse.size) : null
  return (
    <button className={`btn ${r?.ev ? 'big' : ''} action`} disabled={!r?.ev} onClick={() => u && onPick(u.home, u.index)} title={ACTIONS.upgrade.blurb}>
      Rebuild a cottage as a town house
      <small>{r?.ev ? `+${HOMES.townhouse.cap - HOMES.cottage.cap} room · would cost ${fmtGoods(HOMES.townhouse.cost)}` : u ? r?.error : 'No room for a town house in place of a cottage here'}</small>
    </button>
  )
}

/** A thing you can lay or dig (road, paving, well, trees): what it does, until you pick it. */
function WorkButton({ game, p, action, col, row, onPick, label, note }: { game: Game; p: Player; action: ActionKind; col: number; row: number; onPick: () => void; label?: string; note?: string }) {
  const r = tryAction(game, p, action, col, row)
  const bridge = (action === 'road' || action === 'pave') && actionSize(game.world, action, col, row, game.now().toISOString(), game.state.villages[p.villageId]) === 'medium'
  const a = ACTIONS[action]
  return (
    <button className={`btn ${r.ev ? (bridge ? 'medium' : a.size) : ''} action`} disabled={!r.ev} onClick={onPick} title={r.error ?? a.blurb}>
      {(!bridge && label) || (bridge ? (action === 'pave' ? 'Stone bridge' : 'Bridge') : action === 'pave' && game.state.villages[p.villageId]?.roads.includes(cellIndex(game.world, col, row)) ? 'Pave the road' : a.name)}
      <small>{r.error ?? (!bridge && note) ?? (bridge ? `A ${action === 'pave' ? 'stone' : 'wood and stone'} bridge carries the road over the river${action === 'pave' ? ' (2 stone, a medium task)' : ''}.` : a.blurb)}</small>
    </button>
  )
}

const GATHER_NAME: Partial<Record<ActionKind, string>> = { pick: 'Pick up loose stone', chop: 'Gather wood', rice: 'Gather wild rice', peat: 'Cut peat', clear: 'Clear the forest', dig_clay: 'Dig clay' }
/** The question each confirmation asks. */
const ASK_TITLE: Partial<Record<ActionKind, string>> = {
  pick: 'Pick up the loose stone?', chop: 'Cut wood here?', rice: 'Gather wild rice here?', peat: 'Cut peat here?', clear: 'Clear every tree here?', dig_clay: 'Dig clay?', road: 'Lay a dirt road?', pave: 'Lay a paved road?', cobble: 'Lay cobblestone here?', upgrade: 'Rebuild the cottage as a town house?',
  well: 'Dig a well?', plant: 'Plant trees?',
}

/** One thing you could gather here, with what you'd get from it (nothing is spent by looking). */
function GatherButton({ game, p, action, col, row, onPick }: { game: Game; p: Player; action: ActionKind; col: number; row: number; onPick: () => void }) {
  const r = tryAction(game, p, action, col, row)
  const i = cellIndex(game.world, col, row)
  const res = landAt(game.world, game.state, i).resource
  const name = action === 'gather' && res && GATHER[res] ? `Gather ${GOOD_LABEL[GATHER[res]!].toLowerCase()}` : GATHER_NAME[action] ?? ACTIONS[action].name
  const o = r.ev && r.tok ? outcome(game.world, game.state, p, action, col, row, {}, { size: r.tok.size, strength: r.tok.strength, merged: !!r.tok.tok2 }, game.now().toISOString()) : null
  return (
    <button className={`btn ${r.ev ? 'small' : ''} action`} disabled={!r.ev} onClick={onPick} title={r.error ?? ACTIONS[action].blurb}>
      {name}
      <small>{o ? `you'd get ${o.gets[0]}` : r.error}</small>
    </button>
  )
}

function BuildButton({ game, p, def, col, row, onRun }: { game: Game; p: Player; def: BuildingDef; col: number; row: number; onRun: () => void }) {
  const r = tryAction(game, p, 'build', col, row, { building: def.id }, def.size)
  const v = game.state.villages[p.villageId]
  return (
    <button className={`btn ${r.ev ? def.size : ''} action`} disabled={!r.ev} onClick={onRun} title={def.blurb}>
      {def.name}
      <small>{r.ev ? `would cost ${fmtGoods(buildCost(v, def, game.now().toISOString()), r.tok?.strength ?? 1)}` : r.error}</small>
    </button>
  )
}

/** Lend people, weapons and armour to a neighbour's palisade, with food for them to live on. */
function TroopsForm({ game, p, to, onBack, onSend }: { game: Game; p: Player; to: string; onBack: () => void; onSend: (troops: number, g: Record<string, number>) => void }) {
  const v = game.state.villages[p.villageId]
  const host = game.state.villages[to]
  const [troops, setTroops] = useState(1)
  const [by, stepChips] = useStep(Math.floor(v.population))
  const [load, setLoad] = useState<Record<string, number>>({})
  const most = Math.max(0, people(v) - 2)
  const gear = GEAR.filter((g) => (v.goods[g] ?? 0) >= 1)
  const food = (Object.keys(v.goods) as Good[]).filter((g) => FOOD[g] && (v.goods[g] ?? 0) >= 1)
  const nights = nightsOf({ troops, food: Object.fromEntries(Object.entries(load).filter(([g]) => FOOD[g as Good])) })
  const step = (g: Good, d: number) => setLoad({ ...load, [g]: Math.max(0, Math.min(Math.floor(v.goods[g] ?? 0), (load[g] ?? 0) + d)) })
  const row = (g: Good) => (
    <div key={g} className="row" style={{ justifyContent: 'space-between' }}>
      <span><Icon name={g} /> {GOOD_LABEL[g]} <span className="muted">({Math.floor(v.goods[g] ?? 0)})</span></span>
      <span className="row">
        <button className="btn icon" onClick={() => step(g, -1)}>−</button>
        <b style={{ width: 24, textAlign: 'center' }}>{load[g] ?? 0}</b>
        <button className="btn icon" disabled={(load[g] ?? 0) >= Math.floor(v.goods[g] ?? 0)} onClick={() => step(g, 1)}>+</button>
      </span>
    </div>
  )
  return (
    <Shell strip={<ActionStrip game={game} p={p} />} onClose={onBack} title={`Troops to ${host.name}`}>
      <button className="btn ghost" onClick={onBack}>← back</button>
      <p className="muted">They stay your people (counted at home as away, with houses kept for them), but they can't work while they're gone. They wait at {host.name}'s gate until it takes them in (or turns them back). Once on the walls they're its to command, on guard and on expeditions, and they eat only the food you send. When it runs out they walk home, with their weapons and armour.</p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span><Icon name="people" /> Troops <span className="muted">(up to {most} of your people at home: two stay)</span></span>
        <span className="row">
          <button className="btn icon" disabled={troops <= 1} onClick={() => setTroops(Math.max(1, troops - by))}>−</button>
          <b style={{ minWidth: 24, textAlign: 'center' }}>{troops}</b>
          <button className="btn icon" disabled={troops >= most} onClick={() => setTroops(Math.min(most, troops + by))}>+</button>
        </span>
      </div>
      <div className="row" style={{ gap: 6, margin: '4px 0' }}><span className="muted">Move by</span> {stepChips}</div>
      <h4 style={{ margin: '8px 0 2px' }}>Weapons and armour</h4>
      {gear.length ? gear.map(row) : <p className="muted" style={{ margin: 0 }}>None in store (bronze, iron, steel, leather).</p>}
      <h4 style={{ margin: '8px 0 2px' }}>Food</h4>
      {food.length ? food.map(row) : <p className="muted" style={{ margin: 0 }}>No food in store.</p>}
      <p className={nights >= 1 ? 'deal-yes' : 'deal-no'} style={{ margin: '6px 0' }}>
        {nights >= 1 ? `Food for ${nights} night${nights === 1 ? '' : 's'} on the walls (${RATION} a night each).` : `Send at least a night's food: ${troops * RATION} worth.`}
      </p>
      <button className="btn primary" disabled={troops < 1 || troops > most || nights < 1}
        onClick={() => onSend(troops, Object.fromEntries(Object.entries(load).filter(([, n]) => n > 0)))}>Send {troops} troops</button>
    </Shell>
  )
}

function CaravanForm({ game, p, to, welcome, onBack, onSend }: { game: Game; p: Player; to: string; welcome?: boolean; onBack: () => void; onSend: (g: Record<string, number>, crew: number, food: Record<string, number>) => void }) {
  const v = game.state.villages[p.villageId]
  const dest = game.state.villages[to]
  const free = spare(v, weekSeason(game.today(p.id)))
  const [crew, setCrew] = useState(Math.min(1, free))
  const [by, stepChips] = useStep(Math.floor(v.population))
  const [load, setLoad] = useState<Record<string, number>>({})
  const [food, setFood] = useState<Record<string, number>>({})
  const carry = caravanCarry(game.world, game.state, v, dest, Math.max(1, crew))
  const tier = caravanTier(game.world, game.state, v, dest)
  const weight = weightOf(load) + weightOf(food)
  const now = game.now()
  const mins = caravanMinutes(p, v, dest, now.toISOString(), game.world, game.state)
  const arrive = new Date(now.getTime() + mins * 60_000)
  const need = provisionsFor(Math.max(1, crew), mins)
  const packed = foodValue(food)
  // what's left in store to load, once provisions are set aside
  const left = (g: Good) => Math.floor((v.goods[g] ?? 0) - (food[g] ?? 0) - (load[g] ?? 0))
  const have = (Object.keys(v.goods) as Good[]).filter((g) => (v.goods[g] ?? 0) >= 1)
  const foods = have.filter((g) => FOOD[g])
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const stepper = (state: Record<string, number>, set: (x: Record<string, number>) => void, g: Good) => (
    <span className="row">
      <button className="btn icon" onClick={() => set({ ...state, [g]: Math.max(0, (state[g] ?? 0) - stepOf(g)) })}>−</button>
      <b style={{ width: 24, textAlign: 'center' }}>{state[g] ?? 0}</b>
      <button className="btn icon" disabled={left(g) < stepOf(g) || weight + WEIGHT[g] * stepOf(g) > carry.cap} onClick={() => set({ ...state, [g]: (state[g] ?? 0) + stepOf(g) })}>+</button>
    </span>
  )
  return (
    <Shell strip={<ActionStrip game={game} p={p} />} onClose={onBack} title={welcome ? `Welcome ${dest.name}` : `Caravan to ${dest.name}`}>
      <button className="btn ghost" onClick={onBack}>← back</button>
      {welcome && <p className="deal-yes" style={{ margin: '4px 0' }}>A welcoming caravan for new neighbours: it needs no action, and sending it lifts your village's morale by {WELCOME_MORALE}. One to each new village, in its first {WELCOME_DAYS} days.</p>}
      <p className="muted" style={{ margin: '4px 0' }}>
        {welcome ? '' : tier === 'free'
          ? (carry.animals === 'carts' ? (v.oxenBack && v.oxenBack > now.toISOString() ? `Paved road all the way, but your oxen are on the road home until ${clockTime(new Date(v.oxenBack), now)}: it takes a small task till then.` : 'Paved road all the way: your ox carts go without a task, then walk home before they go again.') : 'Paved road all the way: with ox carts (a Cart shed) it would cost no task at all. For now, a small task.')
          : tier === 'small' ? 'A road connects you: a small task. Pave it all the way and ox carts go for free.' : 'No road connects you: a medium task, and a slow trek. A road makes it a small task and three times as fast.'}
        {' '}{pct(carry.road)} of the way is on roads{carry.paved > 0 ? `, ${pct(carry.paved)} paved` : ''}.
      </p>
      <p style={{ margin: '4px 0 8px' }}>
        Sent now, it arrives <b>{clockTime(arrive, now)}</b> <span className="muted">({span(mins * 60_000)} on the road; its people are home again {span(mins * 2 * 60_000)} from now)</span>
      </p>

      <h4 style={{ margin: '6px 0 2px' }}>People</h4>
      <div className="row" style={{ gap: 6, margin: '2px 0' }}><span className="muted">Move by</span> {stepChips}</div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span><Icon name="people" /> Going <span className="muted">({free} free; the rest are working)</span></span>
        <span className="row">
          <button className="btn icon" disabled={crew <= 1} onClick={() => setCrew(Math.max(1, crew - by))}>−</button>
          <b style={{ minWidth: 24, textAlign: 'center' }}>{crew}</b>
          <button className="btn icon" disabled={crew >= free} onClick={() => setCrew(Math.min(free, crew + by))}>+</button>
        </span>
      </div>
      <p className="muted" style={{ margin: '2px 0' }}>
        {free < 1 ? <span className="deal-no">Nobody is free to go: take someone off a building in the Village tab (Workers). </span> : null}
        Each carries {CARRY_EACH} lb{carry.animals === 'mules' ? `, and the pack mules carry ${CARRY.mules} lb more` : carry.animals === 'carts' ? `, and the ox carts carry ${CARRY.mules} to ${CARRY.carts} lb more (more on roads)` : `; a Mule stable adds ${CARRY.mules} lb`}{carry.paved > 0 ? ', and paved road half again' : ''}: up to <b>{fmtLb(carry.cap)}</b> in all. Loaded: {fmtLb(weight)}.
        {carry.thirsty ? ' (Your mules are thirsty: a well by the stable lets them carry more.)' : ''}
      </p>

      <h4 style={{ margin: '6px 0 2px' }}>Provisions for the road</h4>
      <p className={packed + 1e-9 >= need ? 'deal-yes' : 'deal-no'} style={{ margin: '2px 0' }}>
        {packed + 1e-9 >= need ? `Packed: food for the trip there and back (${Math.round(packed * 10) / 10} of ${need} needed).` : `Pack ${need} rations of food: ${crew} ${crew === 1 ? 'person' : 'people'}, one ration each a day, there and back. Packed: ${Math.round(packed * 10) / 10}.`}
      </p>
      {foods.length ? foods.map((g) => (
        <div key={`f-${g}`} className="row" style={{ justifyContent: 'space-between' }}>
          <span><Icon name={g} /> {GOOD_LABEL[g]} <span className="muted">({Math.floor(v.goods[g] ?? 0)} · wagon loads, {FOOD[g]!.value} rations each)</span></span>
          {stepper(food, setFood, g)}
        </div>
      )) : <p className="muted" style={{ margin: 0 }}>No food in store to pack.</p>}

      <h4 style={{ margin: '6px 0 2px' }}>Goods for {dest.name}</h4>
      {have.map((g) => (
        <div key={g} className="row" style={{ justifyContent: 'space-between' }}>
          <span><Icon name={g} /> {GOOD_LABEL[g]} <span className="muted">({Math.floor(v.goods[g] ?? 0)} · {WEIGHT[g]} lb each)</span></span>
          {stepper(load, setLoad, g)}
        </div>
      ))}
      <div className="deal-bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.min(100, (weight / Math.max(1, carry.cap)) * 100)}%` }} /></div>
      <p className="muted" style={{ margin: '2px 0' }}>Load: {Math.round(weight * 10) / 10} / {carry.cap} weight, provisions included. Gifts of food or rare goods cheer them up.</p>
      {refineTips(load).map((t) => <p key={t} className="muted" style={{ margin: '2px 0' }}>💡 {t}</p>)}
      <button className="btn primary" disabled={!weightOf(load) || crew < 1 || crew > free || packed + 1e-9 < need} style={{ marginTop: 4 }}
        onClick={() => onSend(Object.fromEntries(Object.entries(load).filter(([, n]) => n > 0)), crew, Object.fromEntries(Object.entries(food).filter(([, n]) => n > 0)))}>{welcome ? 'Send the welcome' : 'Send caravan'}</button>
    </Shell>
  )
}
