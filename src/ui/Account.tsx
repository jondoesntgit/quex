import { useEffect, useState } from 'react'
import { account, type AccountInfo } from '../app/supabase'
import type { Game } from '../app/store'

/** Sign in with email so the same village follows you to other devices.
 *  With `onSignedIn` (founding a village), a guest who adds their email keeps
 *  their user id, so we carry on without reloading; signing in to a different
 *  existing account still reloads (after `beforeReload`) to pick up its villages. */
export function Account({ game, onClose, onSignedIn, beforeReload }: {
  game: Game
  onClose: () => void
  onSignedIn?: () => void
  beforeReload?: () => void
}) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<'email_change' | 'email' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { account.info().then(setInfo) }, [])
  const settling = !!onSignedIn

  const finish = (type: 'email_change' | 'email') => {
    if (type === 'email_change' && onSignedIn) return onSignedIn()
    beforeReload?.()
    location.reload() // reload as the signed-in user and pick up their villages
  }
  // tapping the emailed link (any tab or device) also works: notice it here
  useEffect(() => {
    if (!sent) return
    const t = setInterval(async () => {
      const i = await account.info()
      if (i && !i.guest) { clearInterval(t); finish(sent) }
    }, 4000)
    return () => clearInterval(t)
  }, [sent]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await f() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const send = () => run(async () => { setSent(await account.sendCode(email.trim())) })
  const verify = () => run(async () => {
    await account.verify(email.trim(), code, sent!)
    finish(sent!)
  })
  const signOut = () => run(async () => {
    await account.signOut()
    game.meta.localPlayers = []
    game.meta.activePlayer = null
    game.saveMeta()
    location.reload()
  })

  return (
    <div className="modal account" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{settling ? 'Sign in to settle' : 'Account'}</h2>
        {!info && <p className="muted">Checking…</p>}
        {info && !info.guest && (
          <>
            <p>Signed in as <b>{info.email}</b>. Sign in with this email on any device to play the same village.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" disabled={busy} onClick={signOut}>Sign out</button>
              <button className="btn primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
        {info?.guest && !sent && (
          <>
            <p style={{ marginTop: 0 }}>
              {settling
                ? 'Villages belong to a real person, so sign in with your email first. You’ll get a 6-digit code, and you can then play this village on any device.'
                : 'You’re playing as a guest on this device. Add your email to keep your village and play it on other devices.'}
              {' '}Already have an account? Enter its email to sign in.
            </p>
            <label>Email</label>
            <input type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose}>{settling ? 'Cancel' : 'Not now'}</button>
              <button className="btn primary" disabled={busy || !/.+@.+\..+/.test(email)} onClick={send}>Email me a code</button>
            </div>
          </>
        )}
        {info?.guest && sent && (
          <>
            <p style={{ marginTop: 0 }}>
              Check <b>{email}</b>. Tap the link in the email, or type the 6-digit code here.
              {sent === 'email' && game.meta.activePlayer && <><br /><span className="muted">That email already has an account: signing in switches to its villages, and this guest village stays behind on this device.</span></>}
            </p>
            <label>Code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} />
            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setSent(null); setCode('') }}>← Change email</button>
              <button className="btn primary" disabled={busy || code.trim().length < 6} onClick={verify}>Sign in</button>
            </div>
          </>
        )}
        {err && <p style={{ color: 'var(--big)' }}>{err}</p>}
      </div>
    </div>
  )
}
