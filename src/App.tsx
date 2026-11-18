import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Game, LocalStore, loadMeta, newMeta, saveMeta, type EventStore } from './app/store'
import { account, createSupabaseStore } from './app/supabase'
import { Account } from './ui/Account'
import { loadAtlas } from './render/atlas'
import { MapView } from './render/MapView'
import { SEASON_ICON, SEASON_WEEKS, seasonWeek, weekSeason } from './game/calendar'
import { dayScore, foundingBlockedCells } from './game/reducer'
import { Inspector } from './ui/Inspector'
import { Onboarding, type Spot } from './ui/Onboarding'
import { LogPanel, PartyPanel, TodayPanel, VillagePanel } from './ui/Panels'
import { SIZE_LABEL, useGame } from './ui/helpers'
import { Icon } from './ui/Icon'

type Tab = 'today' | 'village' | 'party' | 'log'

export default function App() {
  const [game, setGame] = useState<Game | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let g: Game | null = null
    ;(async () => {
      try {
        const meta = loadMeta() ?? newMeta(new URLSearchParams(location.search).get('seed') ?? 'quex-season-1')
        saveMeta(meta)
        const remote = await createSupabaseStore(meta.worldSeed)
        const store: EventStore = remote ?? new LocalStore()
        g = new Game(meta, store)
        await g.init()
        if (remote) {
          // signed in on a new device (or after a sign-in): adopt this account's villages
          const owned = (await remote.ownedPlayers()).filter((id) => g!.state.players[id])
          for (const id of owned) if (!meta.localPlayers.includes(id)) meta.localPlayers.push(id)
          if (!meta.activePlayer || !g.state.players[meta.activePlayer]) meta.activePlayer = owned[0] ?? null
          saveMeta(meta)
        }
        setGame(g)
      } catch (e) {
        console.error(e)
        setError(String(e))
      }
    })()
    return () => g?.dispose()
  }, [])
  if (error) return <div className="modal"><div className="card"><h1>Oops</h1><p>{error}</p></div></div>
  if (!game) return <div className="modal"><div className="card"><h1>QUEX</h1><p className="muted">Generating the world…</p></div></div>
  return <Main game={game} />
}

function Main({ game }: { game: Game }) {
  useGame(game)
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MapView | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('today')
  const [collapsed, setCollapsed] = useState(false)
  const [sel, setSel] = useState<{ col: number; row: number } | null>(null)
  const [preview, setPreview] = useState<Spot | null>(null)
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(false)
  useEffect(() => { placingRef.current = placing }, [placing])
  const [onboard, setOnboard] = useState<'first' | 'friend' | null>(game.meta.activePlayer ? null : 'first')
  const [toast, setToast] = useState<string | null>(null)
  const [showAccount, setShowAccount] = useState(false)

  const pid = game.meta.activePlayer
  const p = pid ? game.state.players[pid] : null

  // switching player (hot-seat) clears the other player's selection
  useEffect(() => { setSel(null) }, [pid])

  // mount Pixi once
  useEffect(() => {
    let view: MapView | null = null
    let alive = true
    ;(async () => {
      const atlas = await loadAtlas()
      if (!alive || !host.current) return
      view = new MapView(atlas)
      await view.mount(host.current)
      // while choosing a village site, taps pick the site instead of opening the inspector
      view.onSelect = (col, row) => (placingRef.current ? setPreview({ col, row }) : setSel({ col, row }))
      viewRef.current = view
      setReady(true)
    })()
    return () => { alive = false; view?.destroy(); viewRef.current = null }
  }, [])

  // keep "now" moving: ticks for finished days, caravans on the road
  useEffect(() => {
    const t = setInterval(() => { game.catchUp() }, 30_000)
    return () => clearInterval(t)
  }, [game])

  const today = game.today()
  const highlight = useMemo(() => (preview ? [preview.row * game.world.width + preview.col] : []), [preview, game.world.width])
  const blocked = useMemo(() => (placing ? foundingBlockedCells(game.world, game.state) : []), [placing, game, game.state.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const onStep = useCallback((step: 'about' | 'place') => { setPlacing(step === 'place'); if (step === 'about') setPreview(null) }, [])

  // redraw on any state change
  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready) return
    view.render({ world: game.world, state: game.state, viewer: p?.id ?? null, selected: placing ? null : sel, highlight, blocked, showAll: placing, today })
  })

  // centre the camera on the village (or the starter region) once
  const centred = useRef<string | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready) return
    const key = p?.id ?? 'region'
    if (centred.current === key) return
    centred.current = key
    if (p) {
      const v = game.state.villages[p.villageId]
      view.centreOn(v.col, v.row, game.world.cells[v.row * game.world.width + v.col].tier)
    } else {
      const rg = game.world.regions[game.world.startRegion]
      view.centreOn((rg.col0 + rg.col1) >> 1, (rg.row0 + rg.row1) >> 1, 2)
    }
  }, [ready, p, game])

  const notify = (s: string) => {
    setToast(s)
    setTimeout(() => setToast((t) => (t === s ? null : t)), 3500)
  }

  const season = weekSeason(today)
  const week = seasonWeek(game.meta.seasonStart, today)
  const score = p ? dayScore(p.days[today]) : 0
  const v = p ? game.state.villages[p.villageId] : null

  return (
    <div className="app">
      <div className="map" ref={host} />

      <div className="topbar">
        <span className="chip title">QUEX</span>
        <span className="chip">{SEASON_ICON[season]} {season} · wk {Math.min(week, SEASON_WEEKS)}/{SEASON_WEEKS}</span>
        {p && <span className="chip score"><Icon name="star" size={16} /> <b>{score}</b>/100</span>}
        {v && <span className="chip"><Icon name="people" size={16} /> {Math.floor(v.population)} · morale {v.morale}</span>}
        <span className="spacer" />
        {p && game.meta.localPlayers.length > 1 && <span className="chip">{p.name}</span>}
        {account.enabled && <button className="chip" onClick={() => setShowAccount(true)}>Account</button>}
      </div>

      <div className="zoom">
        <button className="btn icon" onClick={() => viewRef.current?.setZoom((viewRef.current?.zoom ?? 2) + 1)}>＋</button>
        <button className="btn icon" onClick={() => viewRef.current?.setZoom((viewRef.current?.zoom ?? 2) - 1)}>－</button>
      </div>

      {p && p.tokens.length > 0 && !sel && (
        <div className="tray" style={{ bottom: collapsed ? 54 : 'calc(52% + 8px)' }}>
          {p.tokens.map((t) => (
            <span key={t.id} className={`token ${t.size} ${t.strength < 1 ? 'half' : ''}`}>
              {SIZE_LABEL[t.size]} action{t.strength < 1 ? ' ½' : ''}
            </span>
          ))}
          <span className="token" style={{ background: 'var(--ink)' }}>tap a hex to spend</span>
        </div>
      )}

      {p && sel && !placing && <Inspector key={`${sel.col},${sel.row}`} game={game} p={p} col={sel.col} row={sel.row} onClose={() => setSel(null)} notify={notify} />}

      {p && !placing && (
        <div className={`sheet ${collapsed ? 'collapsed' : ''}`}>
          <div className="tabs">
            {(['today', 'village', 'party', 'log'] as Tab[]).map((t) => (
              <button key={t} className={`tab ${tab === t && !collapsed ? 'on' : ''}`}
                onClick={() => { if (tab === t) setCollapsed(!collapsed); else { setTab(t); setCollapsed(false) } }}>
                {t === 'today' ? `Today ${score}` : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="sheet-body">
            {tab === 'today' && <TodayPanel game={game} p={p} />}
            {tab === 'village' && <VillagePanel game={game} p={p} />}
            {tab === 'party' && <PartyPanel game={game} p={p} onAddFriend={() => setOnboard('friend')} />}
            {tab === 'log' && <LogPanel game={game} p={p} />}
          </div>
        </div>
      )}

      {onboard && (
        <Onboarding game={game} first={onboard === 'first'} site={preview} onStep={onStep}
          onCancel={onboard === 'friend' ? () => { setOnboard(null); setPlacing(false); setPreview(null) } : undefined}
          onDone={() => { setOnboard(null); setPlacing(false); setPreview(null); centred.current = null }} />
      )}
      {showAccount && <Account game={game} onClose={() => setShowAccount(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
