/** Emails that have signed in on this device, most recent first (for switching). */
const ACCOUNTS_KEY = 'quex:accounts:v1'
export function rememberedAccounts(): string[] {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]') } catch { return [] }
}
export function rememberAccount(email: string) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([email, ...rememberedAccounts().filter((e) => e !== email)].slice(0, 6))) } catch { /* private mode */ }
}
export function forgetAccount(email: string) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(rememberedAccounts().filter((e) => e !== email))) } catch { /* private mode */ }
  saveSession(email, null)
}

/** Each remembered account's latest session on this device, so switching
 *  between them needs no new sign-in. Supabase already keeps the current
 *  session's tokens in localStorage; these are the same kind of tokens for the
 *  accounts not in use. Refresh tokens rotate, so this is rewritten whenever
 *  the current session refreshes. */
const SESSIONS_KEY = 'quex:sessions:v1'
export interface SavedSession { access_token: string; refresh_token: string }
function sessions(): Record<string, SavedSession> {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '{}') ?? {} } catch { return {} }
}
export function savedSession(email: string): SavedSession | null { return sessions()[email] ?? null }
export function saveSession(email: string, s: SavedSession | null) {
  try {
    const all = sessions()
    if (s) all[email] = { access_token: s.access_token, refresh_token: s.refresh_token }
    else delete all[email]
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(all))
  } catch { /* private mode */ }
}

/** The account this device stepped away from to sign in as someone else (so the sign-in screen can offer a way back). */
const AWAY_KEY = 'quex:away:v1'
export function awayAccount(): string | null {
  try { return localStorage.getItem(AWAY_KEY) } catch { return null }
}
export function setAway(email: string | null) {
  try { if (email) localStorage.setItem(AWAY_KEY, email); else localStorage.removeItem(AWAY_KEY) } catch { /* private mode */ }
}

/** An account picked on this device whose kept session has gone: the sign-in
 *  screen emails it a code straight away (this tab only). */
const SIGNIN_AS_KEY = 'quex:signin-as'
export function takeSignInAs(): string | null {
  try { const e = sessionStorage.getItem(SIGNIN_AS_KEY); sessionStorage.removeItem(SIGNIN_AS_KEY); return e } catch { return null }
}
export function setSignInAs(email: string) {
  try { sessionStorage.setItem(SIGNIN_AS_KEY, email) } catch { /* private mode */ }
}

/** Load the app fresh as whoever is signed in now, in that account's own
 *  world (no ?seed= or sign-in leftovers from the account before). */
export function reloadAsAccount() { location.replace(location.origin + location.pathname) }
