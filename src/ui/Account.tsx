import { useEffect, useState } from 'react'
import { account, SupabaseStore, type AccountInfo } from '../app/supabase'
import { eventId, type Game } from '../app/store'
import { validate } from '../game/reducer'
import { TodayPanel } from './Panels'
import { forgetAccount, rememberedAccounts } from '../app/accounts'

/** Full-screen sign-in in front of the shared world: Google, an emailed
 *  code (or link), or email + password. Every route ends in a reload, which
 *  loads the world as the signed-in player. */
export function SignIn() {
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
  const send = () => run(async () => { await account.sendCode(email.trim()); setSent('email') })
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
          Your real-life quests power a little village in a hex world. Finish today’s tasks and spend the actions you earn
          in order to better you and your party, then get back to life.
        </p>
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
                    <span key={e} className={`btn chipbtn ${email === e ? 'primary' : ''}`} onClick={() => setEmail(e)}>
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
                  <p className="muted" style={{ fontSize: 13 }}>We’ll email you a 6-digit code. New here? The same step creates your account.</p>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn primary" disabled={busy || !emailOk}>Email me a code</button>
                  </div>
                </>
              ) : (
                <>
                  <label>Password</label>
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="muted" style={{ fontSize: 13 }}>Forgot it, or never set one? Sign in with an email code, then set a password under Account.</p>
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
      </div>
    </div>
  )
}

async function signOutAndClear(game: Game) {
  await account.signOut()
  game.meta.localPlayers = []
  game.meta.activePlayer = null
  game.meta.labels = {}
  game.saveMeta()
  location.reload()
}

/** Your name, your parents/guardians, the children you look after, and
 *  signing out or switching to another account on this device. */
export function Account({ game, onClose, notify }: { game: Game; onClose: () => void; notify: (s: string) => void }) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
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
              : <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>Nobody yet. A parent or grandparent you add sets and checks off your tasks; you still choose your own actions and explore.</p>}
            <button className="btn" onClick={parentLink}>+ Add a parent or guardian</button>
          </>
        )}

        {wards.length > 0 && (
          <>
            <label>You look after</label>
            <p style={{ margin: 0 }}>{wards.map((id) => game.state.players[id].name).join(', ')}: set and check off their tasks from the Party tab.</p>
          </>
        )}

        <form onSubmit={(e) => { e.preventDefault(); savePw() }}>
          <label>Set or change password <span className="muted">(optional)</span></label>
          <div className="row" style={{ gap: 6 }}>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn" disabled={!pw}>Save</button>
          </div>
          {msg && <p className="muted" style={{ fontSize: 13 }}>{msg}</p>}
        </form>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => signOutAndClear(game)} title="Sign out and sign in as someone else on this device">Switch account</button>
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
          <h2 style={{ margin: 0 }}>{w.name}’s day</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>You set and check off {w.name}’s tasks and habits. {w.name} spends the actions they earn.</p>
        <TodayPanel game={game} p={w} />
        <form onSubmit={async (e) => { e.preventDefault(); setMsg(await renamePlayer(game, pid, name)) }}>
          <label>Name</label>
          <div className="row" style={{ gap: 6 }}>
            <input type="text" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn" disabled={!name.trim() || name.trim() === w.name}>Rename</button>
          </div>
          {msg && <p className="muted" style={{ fontSize: 13 }}>{msg}</p>}
        </form>
      </div>
    </div>
  )
}
