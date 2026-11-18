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

export async function createSupabaseStore(worldSeed: string): Promise<EventStore | null> {
  if (!supabaseEnabled) return null
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } })
  // Anonymous sign-in for the playtest; upgrade to magic link from settings later.
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

class SupabaseStore implements EventStore {
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

  subscribe(cb: (ev: GameEvent) => void) {
    const ch = this.sb.channel(`events:${this.world}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `world=eq.${this.world}` },
        (msg) => cb((msg.new as { body: GameEvent }).body))
      .subscribe()
    return () => { this.sb.removeChannel(ch) }
  }
}
