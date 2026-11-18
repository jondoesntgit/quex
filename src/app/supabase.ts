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

export async function createSupabaseStore(worldSeed: string): Promise<SupabaseStore | null> {
  if (!supabaseEnabled) return null
  const sb = await getClient()
  // Everyone starts as an anonymous guest; adding an email (see `account`)
  // keeps the same user id, so their villages come with them.
  const { data: s } = await sb.auth.getSession()
  if (!s.session) {
    const { error } = await sb.auth.signInAnonymously()
    if (error) {
      console.warn('Supabase sign-in failed, playing offline:', error.message)
      return null
    }
  }
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

/** Email sign-in. A guest *adds* an email to their existing account (keeping
 *  their villages); if that email already has an account, we sign in to it
 *  instead. Either way the email carries a link and (if the template has
 *  {{ .Token }}) a 6-digit code. */
export const account = {
  enabled: supabaseEnabled,

  async info(): Promise<AccountInfo | null> {
    if (!supabaseEnabled) return null
    const sb = await getClient()
    const { data } = await sb.auth.getUser()
    if (!data.user) return null
    const email = data.user.email || null
    return { email, guest: !!data.user.is_anonymous || !email }
  },

  /** Returns which kind of code was sent, to pass back to `verify`. */
  async sendCode(email: string): Promise<'email_change' | 'email'> {
    const sb = await getClient()
    const redirect = location.origin + location.pathname
    const { data } = await sb.auth.getUser()
    if (data.user?.is_anonymous) {
      const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect })
      if (!error) return 'email_change'
      if (error.code !== 'email_exists' && !/already/i.test(error.message)) throw error
    }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } })
    if (error) throw error
    return 'email'
  },

  async verify(email: string, code: string, type: 'email_change' | 'email') {
    const sb = await getClient()
    const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type })
    if (error) throw error
  },

  async signOut() {
    const sb = await getClient()
    await sb.auth.signOut()
  },
}
