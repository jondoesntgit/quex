import { useEffect, useState } from 'react'
import { account, SupabaseStore, type AccountInfo, type AssistantLink } from '../app/supabase'
import { clearMeta, eventId, type Game } from '../app/store'
import { validate } from '../game/reducer'
import { TodayPanel } from './Panels'
import { Help } from './Help'
import { awayAccount, forgetAccount, reloadAsAccount, rememberAccount, rememberedAccounts, setSignInAs, takeSignInAs } from '../app/accounts'
import { FAMILY_WORLD, familyPreviewUrl, SANDBOX_WORLD, worldName, worldUrl } from '../app/worlds'

/** Full-screen sign-in in front of the shared world: Google, an emailed
 *  code (or link), or email + password. Every route ends in a reload, which
 *  loads the world as the signed-in player. */
export function SignIn() {
  const [help, setHelp] = useState(false)
  const [recent, setRecent] = useState(rememberedAccounts)
  const [mode, setMode] = useState<'code' | 'password'>('code')
  const [email, setEmail] = useState(() => rememberedAccounts()[0] ?? '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  /** waiting for an emailed code: 'email' sign-in or 'signup' confirmation */
  const [sent, setSent] = useState<'email' | 'signup' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const emailOk = /.+@.+\..+/.test(email)
  const away = awayAccount()
  const canGoBack = !!away && account.hasSession(away)

  // tapping the emailed link (another tab or device) signs in too: follow it
  useEffect(() => {
    if (!sent) return
    const t = setInterval(async () => {
      const i = await account.info()
      if (i && !i.guest) location.reload()
    }, 4000)
    return () => clearInterval(t)
  }, [sent])

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await f() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const sendTo = (to: string) => run(async () => { await account.sendCode(to); setSent('email') })
  const send = () => sendTo(email.trim())
  // picked on the account switcher, but its kept sign-in had gone: email it a code now
  useEffect(() => {
    const e = takeSignInAs()
    if (e) { setEmail(e); setMode('code'); void sendTo(e) }
  }, [])
  /** Tap a remembered account: switch to its kept sign-in, or (gone or run
   *  out) email it a code, so a tap always leads into that account. */
  const pickAccount = (e: string) => run(async () => {
    setEmail(e); setMode('code'); setCode('')
    if (account.hasSession(e)) {
      try { await account.switchTo(e); clearMeta(); reloadAsAccount(); return } catch { /* run out: sign in again below */ }
    }
    setRecent(rememberedAccounts())
    await account.sendCode(e)
    setSent('email')
  })
  const verify = () => run(async () => { await account.verify(email.trim(), code, sent ?? 'email'); location.reload() })
  const signInPw = () => run(async () => { await account.signInPassword(email.trim(), password); location.reload() })
  const signUpPw = () => run(async () => {
    if (password.length < 8) throw new Error('Use at least 8 characters for the password.')
    const r = await account.signUpPassword(email.trim(), password)
    if (r === 'signedIn') location.reload()
    else setSent('signup')
  })

  return (
    <div className="modal">
      <div className="card">
        <h1>QUEX</h1>
        <p style={{ marginTop: 0 }}>
          Your real-life quests power a little village in a hex world. Finish today's tasks and spend the actions you earn
          in order to better you and your party, then get back to life.{' '}
          <button type="button" className="linkbtn" onClick={() => setHelp(true)}>How does it work?</button>
        </p>
        {help && <Help onClose={() => setHelp(false)} />}
        {sent ? (
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) verify() }}>
            <p>Check <b>{email}</b>. Type the 6-digit code here, or tap the link in the email.</p>
            <label>Code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} />
            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => { setSent(null); setCode('') }}>← Back</button>
              <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6}>Sign in</button>
            </div>
          </form>
        ) : (
          <>
            {account.google && (
              <>
                <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => run(account.signInGoogle)}>Continue with Google</button>
                <p className="muted" style={{ textAlign: 'center', margin: '10px 0 0' }}>or</p>
              </>
            )}
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button className={`btn ${mode === 'code' ? 'primary' : ''}`} onClick={() => { setMode('code'); setErr(null) }}>Email me a code</button>
              <button className={`btn ${mode === 'password' ? 'primary' : ''}`} onClick={() => { setMode('password'); setErr(null) }}>Password</button>
            </div>
            {recent.length > 0 && (
              <>
                <label>Accounts on this device</label>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {recent.map((e) => (
                    <span key={e} role="button" tabIndex={0} className={`btn chipbtn ${email === e ? 'primary' : ''}`}
                      title={account.hasSession(e) ? 'Switch to this account' : 'Email this account a sign-in code'}
                      onClick={() => { if (!busy) void pickAccount(e) }}
                      onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && !busy) { ev.preventDefault(); void pickAccount(e) } }}>
                      {e}<button type="button" className="x" title="Forget on this device" onClick={(ev) => { ev.stopPropagation(); forgetAccount(e); setRecent(rememberedAccounts()) }}>×</button>
                    </span>
                  ))}
                </div>
              </>
            )}
            <form onSubmit={(e) => { e.preventDefault(); if (!emailOk) return; if (mode === 'code') send(); else signInPw() }}>
              <label>Email</label>
              <input type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              {mode === 'code' ? (
                <>
                  <p className="muted">We'll email you a 6-digit code. New here? The same step creates your account.</p>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn primary" disabled={busy || !emailOk}>Email me a code</button>
                  </div>
                </>
              ) : (
                <>
                  <label>Password</label>
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="muted">Forgot it, or never set one? Sign in with an email code, then set a password under Account.</p>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn" disabled={busy || !emailOk || !password} onClick={signUpPw}>Create account</button>
                    <button type="submit" className="btn primary" disabled={busy || !emailOk || !password}>Sign in</button>
                  </div>
                </>
              )}
            </form>
          </>
        )}
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        {!sent && canGoBack && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button className="btn" disabled={busy} onClick={() => run(async () => { await account.switchTo(away!); clearMeta(); reloadAsAccount() })}>← Back to {away}</button>
          </div>
        )}
        {!sent && (
          <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
            Just curious? <button type="button" className="linkbtn" onClick={() => account.enterGuest()}>Look around as a guest</button>.
          </p>
        )}
        {!sent && (
          <p className="muted playtest-note">
            New here? Signing in puts you in the <b>sandbox</b>, a world open to anyone. Quex is being playtested by a
            small group of friends and family on their own, smaller world: <a href={familyPreviewUrl()}>preview it →</a>
          </p>
        )}
      </div>
    </div>
  )
}

/** Sign out for good on this device; the next account chooses its own world and villages. */
async function signOut() {
  await account.signOut()
  clearMeta()
  location.reload()
}

/** Your name, your parents/guardians, the children you look after, and
 *  signing out or switching to another account on this device. */
export function Account({ game, onClose, notify }: { game: Game; onClose: () => void; notify: (s: string) => void }) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const p = game.meta.activePlayer ? game.state.players[game.meta.activePlayer] : null
  const [name, setName] = useState(p?.name ?? '')
  useEffect(() => { account.info().then(setInfo) }, [])
  const remote = game.store instanceof SupabaseStore ? game.store : null

  const savePw = async () => {
    setMsg(null)
    if (pw.length < 8) return setMsg('Use at least 8 characters.')
    try { await account.setPassword(pw); setPw(''); setMsg('Password saved: you can now sign in with it.') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  const rename = async () => {
    if (!p) return
    const r = await renamePlayer(game, p.id, name)
    if (r) notify(r)
  }
  const parentLink = async () => {
    if (!p || !remote) return
    try {
      const url = await remote.createParentLink(p.id)
      const text = `Open this while signed in to your own Quex account to look after ${p.name}'s tasks (link works once, for 7 days):`
      try {
        if (navigator.share) { await navigator.share({ title: 'Quex parent link', text, url }); return }
      } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return }
      await navigator.clipboard.writeText(`${text} ${url}`)
      notify('Parent link copied: send it to your parent or grandparent.')
    } catch (e) { notify(e instanceof Error ? e.message : String(e)) }
  }
  const guardians = p ? game.guardianNames(p.id) : []
  const wards = game.wards()

  if (picking && info?.email) return <AccountPicker current={info.email} onCancel={() => setPicking(false)} />

  return (
    <div className="modal account" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Account</h2>
        {!info ? <p className="muted">Checking…</p> : <p style={{ marginTop: 0 }}>Signed in as <b>{info.email}</b>.</p>}

        {p && (
          <form onSubmit={(e) => { e.preventDefault(); rename() }}>
            <label>Your name in the world</label>
            <div className="row" style={{ gap: 6 }}>
              <input type="text" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="btn" disabled={!name.trim() || name.trim() === p.name}>Rename</button>
            </div>
          </form>
        )}

        {p && remote && (
          <>
            <label>Parents & guardians</label>
            {guardians.length
              ? <p style={{ margin: '0 0 6px' }}>👪 {guardians.join(', ')} set and check off your tasks.</p>
              : <p className="muted" style={{ margin: '0 0 6px' }}>Nobody yet. A parent or grandparent you add sets and checks off your tasks; you still choose your own actions and explore.</p>}
            <button className="btn" onClick={parentLink}>+ Add a parent or guardian</button>
          </>
        )}

        {remote && game.isAdmin() && <WorldSettings game={game} remote={remote} notify={notify} />}

        {wards.length > 0 && (
          <>
            <label>You look after</label>
            <p style={{ margin: 0 }}>{wards.map((id) => game.state.players[id].name).join(', ')}: set and check off their tasks from the Party tab.</p>
          </>
        )}

        {remote && (
          <>
            <label>World</label>
            <p style={{ margin: 0 }}>
              You're in {worldName(game.meta.worldSeed)}.{' '}
              {game.meta.worldSeed !== SANDBOX_WORLD && <a href={worldUrl(SANDBOX_WORLD)}>Go to the sandbox</a>}
              {game.meta.worldSeed !== FAMILY_WORLD && <a href={worldUrl(FAMILY_WORLD)}>Go to the family playtest world</a>}
            </p>
          </>
        )}

        {remote && info && !info.guest && <AssistantLinks notify={notify} />}


        <form onSubmit={(e) => { e.preventDefault(); savePw() }}>
          <label>Set or change password <span className="muted">(optional)</span></label>
          <div className="row" style={{ gap: 6 }}>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn" disabled={!pw}>Save</button>
          </div>
          {msg && <p className="muted">{msg}</p>}
        </form>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void signOut()} title="Sign out of this account on this device">Sign out</button>
          <button className="btn" onClick={() => setPicking(true)} title="Switch to another account on this device">Switch account</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

/** Rename a player (yourself, or a child you look after). Returns a message. */
async function renamePlayer(game: Game, pid: string, name: string): Promise<string> {
  const ev = { t: 'rename' as const, id: eventId(), at: game.now().toISOString(), playerId: pid, name: name.trim() }
  const err = validate(game.state, game.world, ev)
  if (err) return err
  await game.dispatch(ev)
  return `Renamed to ${name.trim()}.`
}

/** A parent/guardian's window onto a child's day: set and check off tasks and
 *  habits, and rename them. */
export function ManageWard({ game, pid, onClose }: { game: Game; pid: string; onClose: () => void }) {
  const w = game.state.players[pid]
  const [name, setName] = useState(w.name)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="modal account" onClick={onClose}>
      <div className="card manage" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{w.name}'s day</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>You set and check off {w.name}'s tasks and habits. {w.name} spends the actions they earn.</p>
        <TodayPanel game={game} p={w} />
        <form onSubmit={async (e) => { e.preventDefault(); setMsg(await renamePlayer(game, pid, name)) }}>
          <label>Name</label>
          <div className="row" style={{ gap: 6 }}>
            <input type="text" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn" disabled={!name.trim() || name.trim() === w.name}>Rename</button>
          </div>
          {msg && <p className="muted">{msg}</p>}
        </form>
      </div>
    </div>
  )
}

/** Admins only: who can see the world, and who else administers it. */
function WorldSettings({ game, remote, notify }: { game: Game; remote: SupabaseStore; notify: (s: string) => void }) {
  const a = game.access!
  const [busy, setBusy] = useState(false)
  const refresh = async () => game.setAccess(await remote.access())
  const run = async (f: () => Promise<void>, ok: string) => {
    setBusy(true)
    try { await f(); await refresh(); notify(ok) } catch (e) { notify(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  // people with a village here who aren't admins yet
  const candidates = [...new Set(a.owners.map((o) => o.user))].filter((u) => !a.admins.includes(u))
  const link = worldUrl(game.meta.worldSeed)
  return (
    <>
      <label>World <span className="muted">(you're an admin)</span></label>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" id="world-public" checked={a.public} disabled={busy}
          onChange={(e) => run(() => remote.setPublic(e.target.checked), e.target.checked ? 'World is public: anyone with the link can look around.' : 'World is private: players only.')} />
        <span><b>Public</b>: anyone can look around without joining</span>
      </div>
      {a.public && <p className="muted" style={{ margin: '4px 0' }}>Share <b>{link}</b> to let people look around. Visitors never see task names or how anyone's day went.</p>}
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" id="world-closed" checked={!a.closed} disabled={busy}
          onChange={(e) => run(() => remote.setClosed(!e.target.checked), e.target.checked ? 'Anyone signed in can now join and settle.' : 'Closed: only existing players can play; others can only look.')} />
        <span><b>Taking new players</b>: anyone signed in can join and settle</span>
      </div>
      <p style={{ margin: '8px 0 4px' }}>Admins: {a.admins.map((u) => (
        <span key={u} style={{ marginRight: 8 }}>
          {game.userName(u)}
          {a.admins.length > 1 && <button className="linkbtn" disabled={busy} onClick={() => run(() => remote.removeAdmin(u), 'Admin removed.')} title="Remove as admin"> ×</button>}
        </span>
      ))}</p>
      {candidates.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="muted">Make admin:</span>
          {candidates.map((u) => (
            <button key={u} className="btn" disabled={busy} onClick={() => run(() => remote.addAdmin(u), `${game.userName(u)} is now an admin.`)}>{game.userName(u)}</button>
          ))}
        </div>
      )}
    </>
  )
}

/** Connect Claude, ChatGPT or another AI assistant: a secret link (an MCP
 *  server address) that can read and plan your tasks and your children's. */
function AssistantLinks({ notify }: { notify: (s: string) => void }) {
  const [links, setLinks] = useState<AssistantLink[] | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => account.assistantLinks().then(setLinks).catch(() => setLinks([]))
  useEffect(() => { load() }, [])
  const make = async () => {
    setBusy(true)
    try {
      const url = await account.createAssistantLink('AI assistant')
      setFresh(url)
      await load()
      try { await navigator.clipboard.writeText(url); notify('Assistant link copied.') } catch { /* shown below */ }
    } catch (e) { notify(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const revoke = async (id: string) => {
    setBusy(true)
    try { await account.revokeAssistantLink(id); setFresh(null); await load(); notify('Link turned off.') }
    catch (e) { notify(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const day = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <>
      <label>AI assistant <span className="muted">(Claude, ChatGPT)</span></label>
      <p className="muted" style={{ margin: '0 0 6px' }}>
        Let an assistant read your tasks and plan days ahead, for you and any children you look after. It can't tick
        tasks off or touch your village.
      </p>
      {fresh && (
        <div className="assistant-link">
          <input type="text" readOnly value={fresh} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          <p className="muted" style={{ margin: '4px 0' }}>
            Copy this now: it won't be shown again. Keep it secret, like a password.
            In <b>Claude</b>: Settings → Connectors → Add custom connector, paste it as the URL.
            In <b>ChatGPT</b>: Settings → Apps & Connectors → Advanced → Developer mode, then Create and paste it (no authentication).
          </p>
        </div>
      )}
      {links && links.length > 0 && (
        <ul className="assistant-links" style={{ margin: '0 0 6px', paddingLeft: 18 }}>
          {links.map((l) => (
            <li key={l.id}>
              Link made {day(l.created_at)}{l.last_used_at ? `, last used ${day(l.last_used_at)}` : ', not used yet'}
              <button className="linkbtn" disabled={busy} onClick={() => revoke(l.id)} title="Turn this link off"> Turn off</button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" disabled={busy} onClick={make}>+ Connect an AI assistant</button>
    </>
  )
}

/** Pick another account on this device. Nothing changes until you pick one, and Cancel goes back. */
function AccountPicker({ current, onCancel }: { current: string; onCancel: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const others = rememberedAccounts().filter((e) => e !== current)
  const go = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await f(); clearMeta(); reloadAsAccount() } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }
  /** Sign in to this account again: step away to the sign-in screen, which emails it a code. */
  const signInAgain = async (e: string) => { rememberAccount(e); setSignInAs(e); await account.stepAway() }
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Switch account</h2>
        <p className="muted" style={{ marginTop: 0 }}>You're signed in as <b>{current}</b>.</p>
        {others.map((e) => {
          const kept = account.hasSession(e)
          return (
            <button key={e} className="btn choice" disabled={busy}
              onClick={() => go(async () => {
                if (kept) { try { await account.switchTo(e); return } catch { /* run out: sign in again */ } }
                await signInAgain(e)
              })}>
              {e}{!kept && <span className="muted"> · email a sign-in code</span>}
            </button>
          )
        })}
        <button className="btn choice" disabled={busy} onClick={() => go(() => account.stepAway())}>+ Another account</button>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn primary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
