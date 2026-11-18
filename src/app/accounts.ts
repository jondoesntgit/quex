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
}
