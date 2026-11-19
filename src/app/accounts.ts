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
