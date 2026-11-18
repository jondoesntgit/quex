import { useEffect, useState } from 'react'
import { account, type AccountInfo } from '../app/supabase'
import type { Game } from '../app/store'

/** Full-screen sign-in in front of the shared world. Signing in by code
 *  reloads into the world; tapping the emailed link opens it signed in (and
 *  this tab notices and follows). */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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
  const send = () => run(async () => { await account.sendCode(email.trim()); setSent(true) })
  const verify = () => run(async () => { await account.verify(email.trim(), code); location.reload() })

  return (
    <div className="modal">
      <div className="card">
        <h1>QUEX</h1>
        <p style={{ marginTop: 0 }}>
          Your real-life quests power a little village in a hex world. Finish today’s tasks and spend the actions you earn
          in order to better you and your party, then get back to life.
        </p>
        {!sent ? (
          <form onSubmit={(e) => { e.preventDefault(); if (/.+@.+\..+/.test(email)) send() }}>
            <label>Sign in with your email</label>
            <input type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <p className="muted" style={{ fontSize: 13 }}>We’ll email you a 6-digit code. New here? The same step creates your account.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn primary" disabled={busy || !/.+@.+\..+/.test(email)}>Email me a code</button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) verify() }}>
            <p>Check <b>{email}</b>. Type the 6-digit code here, or tap the link in the email.</p>
            <label>Code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} />
            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => { setSent(false); setCode('') }}>← Change email</button>
              <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6}>Sign in</button>
            </div>
          </form>
        )}
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
    </div>
  )
}

/** Who you're signed in as, and signing out. */
export function Account({ game, onClose }: { game: Game; onClose: () => void }) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  useEffect(() => { account.info().then(setInfo) }, [])
  const signOut = async () => {
    await account.signOut()
    game.meta.localPlayers = []
    game.meta.activePlayer = null
    game.saveMeta()
    location.reload()
  }
  return (
    <div className="modal account" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Account</h2>
        {!info ? <p className="muted">Checking…</p> : (
          <p>Signed in as <b>{info.email}</b>. Sign in with this email on any device to play the same village.</p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={signOut}>Sign out</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
