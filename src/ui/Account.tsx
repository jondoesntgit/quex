import { useEffect, useState } from 'react'
import { account, type AccountInfo } from '../app/supabase'
import type { Game } from '../app/store'

/** Full-screen sign-in in front of the shared world: Google, an emailed
 *  code (or link), or email + password. Every route ends in a reload, which
 *  loads the world as the signed-in player. */
export function SignIn() {
  const [mode, setMode] = useState<'code' | 'password'>('code')
  const [email, setEmail] = useState('')
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

/** Who you're signed in as, and signing out. */
export function Account({ game, onClose }: { game: Game; onClose: () => void }) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { account.info().then(setInfo) }, [])
  const savePw = async () => {
    setMsg(null)
    if (pw.length < 8) return setMsg('Use at least 8 characters.')
    try { await account.setPassword(pw); setPw(''); setMsg('Password saved: you can now sign in with it.') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
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
        <form onSubmit={(e) => { e.preventDefault(); savePw() }}>
          <label>Set or change password <span className="muted">(optional)</span></label>
          <div className="row" style={{ gap: 6 }}>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn" disabled={!pw}>Save</button>
          </div>
          {msg && <p className="muted" style={{ fontSize: 13 }}>{msg}</p>}
        </form>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={signOut}>Sign out</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
