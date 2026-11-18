/** Supabase event store: one shared, append-only event log per world.
 *
 *  Switched on by VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. Without them
 *  the app falls back to LocalStore and nothing leaves the device.
 *
 *  Privacy: events never carry task text (labels live only in local
 *  storage), so neighbours can only ever see done/half/missed pips.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameEvent } from '../game/types'
import type { EventStore } from './store'

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseEnabled = !!(URL_ && KEY)

let client: Promise<SupabaseClient> | null = null
function getClient(): Promise<SupabaseClient> {
  return (client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })))
}

/** The shared world, or 'signin' when nobody is signed in with an email yet
 *  (the whole world sits behind sign-in, so there are no ghost villages). */
export async function createSupabaseStore(worldSeed: string): Promise<SupabaseStore | 'signin' | null> {
  if (!supabaseEnabled) return null
  const sb = await getClient()
  // detectSessionInUrl has already turned an emailed sign-in link into a session
  const { data: s } = await sb.auth.getSession()
  if (!s.session || s.session.user.is_anonymous || !s.session.user.email) return 'signin'
  await sb.rpc('join_world', { p_world: worldSeed }).then(({ error }) => error && console.warn('join_world', error.message))
  return new SupabaseStore(sb, worldSeed)
}

export class SupabaseStore implements EventStore {
  private sb: SupabaseClient
  private world: string
  constructor(sb: SupabaseClient, world: string) {
    this.sb = sb
    this.world = world
  }

  async load(): Promise<GameEvent[]> {
    const out: GameEvent[] = []
    let from = 0
    for (;;) {
      const { data, error } = await this.sb.from('events').select('body').eq('world', this.world)
        .order('at', { ascending: true }).order('seq', { ascending: true }).range(from, from + 999)
      if (error) throw error
      out.push(...data.map((r) => r.body as GameEvent))
      if (data.length < 1000) break
      from += 1000
    }
    return out
  }

  async append(ev: GameEvent) {
    const { error } = await this.sb.from('events').insert({
      id: ev.id, world: this.world, at: ev.at, player_id: ev.playerId, kind: ev.t, body: ev,
    })
    if (error) console.warn('event not synced', error.message)
  }

  /** Private task names for these players, last 30 days. */
  async loadLabels(playerIds: string[]) {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await this.sb.from('task_labels').select('player_id, date, slot, text')
      .in('player_id', playerIds).gte('date', since)
    if (error) { console.warn('task_labels', error.message); return [] }
    return data as { player_id: string; date: string; slot: number; text: string }[]
  }

  async saveLabel(playerId: string, date: string, slot: number, text: string) {
    const { error } = await this.sb.from('task_labels')
      .upsert({ player_id: playerId, date, slot, text, updated_at: new Date().toISOString() }, { onConflict: 'user_id,player_id,date,slot' })
    if (error) throw new Error(error.message)
  }

  /** Player ids in this world owned by the signed-in user (for a new device). */
  async ownedPlayers(): Promise<string[]> {
    const { data: u } = await this.sb.auth.getUser()
    if (!u.user) return []
    const { data, error } = await this.sb.from('player_owners').select('player_id').eq('world', this.world).eq('user_id', u.user.id)
    if (error) { console.warn('player_owners', error.message); return [] }
    return data.map((r) => r.player_id as string)
  }

  subscribe(cb: (ev: GameEvent) => void) {
    const ch = this.sb.channel(`events:${this.world}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `world=eq.${this.world}` },
        (msg) => cb((msg.new as { body: GameEvent }).body))
      .subscribe()
    return () => { this.sb.removeChannel(ch) }
  }
}

// ------------------------------------------------------------------ account

export interface AccountInfo { email: string | null; guest: boolean }

const here = () => location.origin + location.pathname + location.search

/** Sign-in: emailed code/link, password, or Google (when enabled in Supabase
 *  and VITE_AUTH_GOOGLE=1). Emails carry a link and a 6-digit {{ .Token }}. */
export const account = {
  enabled: supabaseEnabled,
  google: import.meta.env.VITE_AUTH_GOOGLE === '1',

  async info(): Promise<AccountInfo | null> {
    if (!supabaseEnabled) return null
    const sb = await getClient()
    const { data } = await sb.auth.getUser()
    if (!data.user) return null
    const email = data.user.email || null
    return { email, guest: !!data.user.is_anonymous || !email }
  },

  /** Email a sign-in link + 6-digit code (creates the account if new). */
  async sendCode(email: string): Promise<'email'> {
    const sb = await getClient()
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: here(), shouldCreateUser: true } })
    if (error) throw error
    return 'email'
  },

  async signInPassword(email: string, password: string) {
    const sb = await getClient()
    const { error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw error
  },

  /** New account with a password. 'confirm' = check your email for a code first. */
  async signUpPassword(email: string, password: string): Promise<'signedIn' | 'confirm'> {
    const sb = await getClient()
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } })
    if (error) throw error
    // an existing address comes back with no identities (Supabase hides whether it exists)
    if (data.user && data.user.identities?.length === 0) throw new Error('That email already has an account: sign in, or use an email code.')
    return data.session ? 'signedIn' : 'confirm'
  },

  /** Set or change the password on the signed-in account. */
  async setPassword(password: string) {
    const sb = await getClient()
    const { error } = await sb.auth.updateUser({ password })
    if (error) throw error
  },

  /** Redirects to Google and back to this page, signed in. */
  async signInGoogle() {
    const sb = await getClient()
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } })
    if (error) throw error
  },

  async verify(email: string, code: string, type: 'email' | 'signup' = 'email') {
    const sb = await getClient()
    const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type })
    if (error) throw error
  },

  async signOut() {
    const sb = await getClient()
    await sb.auth.signOut()
  },
}
