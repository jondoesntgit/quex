import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { eventId, Game, LocalStore, loadMeta, newMeta, saveMeta, type EventStore } from './app/store'
import { account, createSupabaseStore, PrivateWorldError, SupabaseStore } from './app/supabase'
import { familyPreviewUrl, SANDBOX_WORLD, worldUrl } from './app/worlds'
import { Account, ManageWard, SignIn } from './ui/Account'
import { Help } from './ui/Help'
import { rememberAccount } from './app/accounts'
import { loadAtlas } from './render/atlas'
import { MapView } from './render/MapView'
import { SEASON_ICON, SEASON_WEEKS, seasonWeek, weekSeason } from './game/calendar'
import { dayScore, foundingBlockedCells } from './game/reducer'
import { Inspector } from './ui/Inspector'
import { Onboarding, type Spot } from './ui/Onboarding'
import { GuestPanel, LogPanel, PartyPanel, TodayPanel, VillagePanel } from './ui/Panels'
import { linkedSpot, SIZE_LABEL, useGame } from './ui/helpers'
import { Icon } from './ui/Icon'

type Tab = 'today' | 'village' | 'party' | 'log'

export default function App() {
  const [game, setGame] = useState<Game | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needSignIn, setNeedSignIn] = useState(false)
  const [privateWorld, setPrivateWorld] = useState(false)
  useEffect(() => {
    let g: Game | null = null
    ;(async () => {
      try {
        // which world: the link's ?seed=, else this device's world, else the
        // family world for its players and the sandbox for everyone else
        const q = new URLSearchParams(location.search)
        const asked = q.get('seed')
        const preview = q.get('preview') === '1'
        let meta = loadMeta()
        if (asked && meta && meta.worldSeed !== asked) meta = null
        meta ??= newMeta(asked ?? (account.enabled ? await account.homeWorld() : SANDBOX_WORLD))
        const remote = await createSupabaseStore(meta.worldSeed, preview)
        if (remote === 'signin') return setNeedSignIn(true)
        // just looking: don't make this the device's world
        if (!remote?.guest) saveMeta(meta)
        const store: EventStore = remote ?? new LocalStore()
        g = new Game(meta, store)
        try {
          await g.init()
        } catch (e) {
          if (e instanceof PrivateWorldError) return setPrivateWorld(true)
          throw e
        }
        if (remote?.guest) {
          // looking around: nobody to play as, nothing to save
          g.meta = { ...meta, localPlayers: [], activePlayer: null }
          g.setAccess(await remote.access())
        } else if (remote) {
          // online, you play exactly this account's villages (new device, or a different account)
          // offline we can't check, so keep what this device already knew
          const owned = ((await remote.ownedPlayers()) ?? meta.localPlayers).filter((id) => g!.state.players[id])
          meta.localPlayers = owned
          meta.dayOffset = 0 // the testing day-skip never applies to the shared world
          if (!meta.activePlayer || !owned.includes(meta.activePlayer)) meta.activePlayer = owned[0] ?? null
          saveMeta(meta)
          remote.onStatus = () => g!.poke()
          g.setAccess(await remote.access())
          // opened from a parent link: become this child's guardian
          const params = new URLSearchParams(location.search)
          const token = params.get('guardian')
          if (token) {
            try {
              const pid = await remote.acceptParentLink(token)
              g.setAccess(await remote.access())
              g.flash = `You now look after ${g.state.players[pid]?.name ?? 'your child'}: set and check off their tasks from the Party tab.`
            } catch (e) {
              g.flash = e instanceof Error ? e.message : String(e)
            }
            params.delete('guardian')
            history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''))
          }
          await g.syncLabels()
          const r = remote
          r.watch((row) => g!.remoteLabel(row), async () => { g!.setAccess(await r.access()); await g!.syncLabels() })
          const info = await account.info()
          if (info?.email) rememberAccount(info.email)
        }
        setGame(g)
      } catch (e) {
        console.error(e)
        setError(String(e))
      }
    })()
    return () => g?.dispose()
  }, [])
  if (needSignIn) return <SignIn />
  if (privateWorld) return (
    <div className="modal"><div className="card">
      <h1>QUEX</h1>
      <p>This world is private, so only its players can see it. Sign in to join, or ask one of its admins to make it public.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => account.leaveGuest()}>Sign in</button></div>
    </div></div>
  )
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
  // a shared link (?at=col,row) centres on that hex, marks it, and opens it for existing players
  const [linked] = useState(() => linkedSpot(game.world))
  const [sel, setSel] = useState<{ col: number; row: number } | null>(() => (game.meta.activePlayer ? linked : null))
  const [preview, setPreview] = useState<Spot | null>(null)
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(false)
  useEffect(() => { placingRef.current = placing }, [placing])
  // a parent with no village of their own goes straight to looking after their children
  const [onboard, setOnboard] = useState<'first' | 'friend' | null>(game.meta.activePlayer || game.wards().length || game.guest ? null : 'first')
  const [managing, setManaging] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  // one-off message from startup (e.g. accepting a parent link)
  useEffect(() => {
    if (!game.flash) return
    const m = game.flash
    game.flash = null
    setToast(m)
    const t = setTimeout(() => setToast((x) => (x === m ? null : x)), 6000)
    return () => clearTimeout(t)
  }, [game])

  const pid = game.meta.activePlayer
  const p = pid ? game.state.players[pid] : null

  // switching player (hot-seat) clears the other player's selection
  const lastPid = useRef(pid)
  useEffect(() => {
    if (lastPid.current !== pid) setSel(null)
    lastPid.current = pid
  }, [pid])

  // mount Pixi once
  useEffect(() => {
    let view: MapView | null = null
    let alive = true
    ;(async () => {
      let atlas
      try {
        atlas = await loadAtlas()
      } catch (e) {
        setMapError(e instanceof Error ? e.message : String(e))
        return
      }
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
  const focus = linked ? linked.row * game.world.width + linked.col : undefined
  const highlight = useMemo(() => (preview ? [preview.row * game.world.width + preview.col] : []), [preview, game.world.width])
  const blocked = useMemo(() => (placing ? foundingBlockedCells(game.world, game.state) : []), [placing, game, game.state.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const onStep = useCallback((step: 'about' | 'place') => { setPlacing(step === 'place'); if (step === 'about') setPreview(null) }, [])

  // redraw on any state change
  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready) return
    view.render({ world: game.world, state: game.state, viewer: p?.id ?? null, selected: placing ? null : sel, highlight, blocked, focus, showAll: placing, guest: game.guest, today })
  })

  // centre the camera on the village (or the starter region) once
  const centred = useRef<string | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready) return
    const key = p?.id ?? 'region'
    if (centred.current === key) return
    const first = centred.current === null
    centred.current = key
    if (first && linked) {
      view.centreOn(linked.col, linked.row, game.world.cells[linked.row * game.world.width + linked.col].tier)
    } else if (p) {
      const v = game.state.villages[p.villageId]
      view.centreOn(v.col, v.row, game.world.cells[v.row * game.world.width + v.col].tier)
    } else {
      // visitors and newcomers: where the villages are, or the starter region in an empty world
      const vs = Object.values(game.state.villages)
      const rg = game.world.regions[game.world.startRegion]
      const col = vs.length ? Math.round(vs.reduce((t, x) => t + x.col, 0) / vs.length) : (rg.col0 + rg.col1) >> 1
      const row = vs.length ? Math.round(vs.reduce((t, x) => t + x.row, 0) / vs.length) : (rg.row0 + rg.row1) >> 1
      view.centreOn(col, row, 2)
    }
  }, [ready, p, game, linked])

  const abandon = async () => {
    if (!p) return
    await game.dispatch({ t: 'abandon', id: eventId(), at: game.now().toISOString(), playerId: p.id })
    const m = game.meta
    m.localPlayers = m.localPlayers.filter((id) => id !== p.id)
    delete m.labels[p.id]
    delete m.joinedOn[p.id]
    m.activePlayer = m.localPlayers.find((id) => game.state.players[id]) ?? null
    game.saveMeta()
    setTab('today')
    centred.current = null
    if (!m.activePlayer) setOnboard('first')
  }

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
        {game.store instanceof SupabaseStore && game.store.offline && (
          <span className="chip" title="No connection: you're playing from this device's copy of the world. Your changes will send when you're back online.">📴 Offline</span>
        )}
        <button className="chip" onClick={() => setShowHelp(true)} title="How to play" aria-label="How to play">?</button>
        {game.guest && <span className="chip" title="You're looking around: you can't change anything here">👀 Visiting</span>}
        {game.guest && game.meta.worldSeed !== SANDBOX_WORLD && (
          <button className="chip" onClick={() => { account.leaveGuest(false); location.href = worldUrl(SANDBOX_WORLD) }}>Play in the sandbox</button>
        )}
        {game.guest && game.meta.worldSeed === SANDBOX_WORLD && <button className="chip" onClick={() => account.leaveGuest()}>Sign in to play</button>}
        {account.enabled && !game.guest && <button className="chip" onClick={() => setShowAccount(true)}>Account</button>}
        {game.meta.worldSeed === SANDBOX_WORLD && <SandboxNote />}
      </div>

      <div className="zoom">
        <button className="btn icon" onClick={() => viewRef.current?.zoomStep(1)}>＋</button>
        <button className="btn icon" onClick={() => viewRef.current?.zoomStep(-1)}>－</button>
        {v && (
          <button className="btn icon" title="Back to your village" aria-label="Back to your village"
            onClick={() => viewRef.current?.centreOn(v.col, v.row, game.world.cells[v.row * game.world.width + v.col].tier)}>⌂</button>
        )}
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
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="sheet-body">
            {tab === 'today' && <TodayPanel game={game} p={p} />}
            {tab === 'village' && <VillagePanel game={game} p={p} onAbandon={abandon} notify={notify} />}
            {tab === 'party' && <PartyPanel game={game} p={p} onAddFriend={() => setOnboard('friend')} onManage={setManaging} />}
            {tab === 'log' && <LogPanel game={game} p={p} />}
          </div>
        </div>
      )}

      {onboard && (
        <Onboarding game={game} first={onboard === 'first'} site={preview} linked={!!linked} onStep={onStep}
          onCancel={onboard === 'friend' ? () => { setOnboard(null); setPlacing(false); setPreview(null) } : undefined}
          onDone={() => { setOnboard(null); setPlacing(false); setPreview(null); centred.current = null }} />
      )}
      {showAccount && <Account game={game} onClose={() => setShowAccount(false)} notify={notify} />}
      {showHelp && <Help onClose={() => setShowHelp(false)} />}
      {mapError && (
        <div className="modal"><div className="card">
          <h2 style={{ marginTop: 0 }}>The map didn’t load</h2>
          <p>{mapError}</p>
          <p className="muted">{navigator.userAgent}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => location.reload()}>Reload</button></div>
        </div></div>
      )}
      {managing && game.state.players[managing] && <ManageWard game={game} pid={managing} onClose={() => setManaging(null)} />}
      {game.guest && <GuestPanel game={game} />}
      {!p && !onboard && !game.guest && (
        // a parent/guardian without a village of their own
        <div className="sheet">
          <div className="sheet-body">
            <h3 style={{ marginTop: 0 }}>Your children</h3>
            {game.wards().map((id) => (
              <div key={id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
                <b>{game.state.players[id].name}</b>
                <button className="btn primary" onClick={() => setManaging(id)}>Set & check tasks</button>
              </div>
            ))}
            <p className="muted">You can also <button className="btn" onClick={() => setOnboard('first')}>found your own village</button></p>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

const NOTE_KEY = 'quex:sandbox-note:v1'

/** In the sandbox: say that the real playtest happens on a smaller family world, with a way to look at it. */
function SandboxNote() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(NOTE_KEY) !== 'seen' } catch { return true } })
  const close = () => { setOpen(false); try { localStorage.setItem(NOTE_KEY, 'seen') } catch { /* ignore */ } }
  if (!open) return <button className="chip sandbox-chip" onClick={() => setOpen(true)} title="About this world">🧪 Sandbox</button>
  return (
    <div className="sandbox-note">
      <b>🧪 This is the Quex sandbox.</b> Anyone can try the game here. Quex is being playtested by a small group of
      friends and family on their own, smaller world.{' '}
      <a href={familyPreviewUrl()}>Preview their world →</a>
      <button className="btn ghost" onClick={close} aria-label="close" style={{ float: 'right' }}>✕</button>
    </div>
  )
}
