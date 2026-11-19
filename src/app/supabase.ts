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
import { FAMILY_WORLD, SANDBOX_WORLD } from './worlds'

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
export async function createSupabaseStore(worldSeed: string, preview = false): Promise<SupabaseStore | 'signin' | null> {
  if (!supabaseEnabled) return null
  const sb = await getClient()
  // detectSessionInUrl has already turned an emailed sign-in link into a session
  const { data: s } = await sb.auth.getSession()
  if (!s.session || s.session.user.is_anonymous || !s.session.user.email) {
    // offline with an expired token: the session can't refresh, but this device
    // was signed in, so carry on from its copy of the world until we're back
    if (!navigator.onLine && savedSessionEmail()) return new SupabaseStore(sb, worldSeed)
    // looking around without an account (public worlds only)
    if (preview) { try { sessionStorage.setItem(GUEST_KEY, '1') } catch { /* ignore */ } }
    if (preview || account.isGuest()) return new SupabaseStore(sb, worldSeed, true)
    return 'signin'
  }
  if (account.isGuest()) account.leaveGuest(false) // signed in now: no longer a guest
  // a shared link may carry an invite, which lets a new player into a closed world
  const invite = new URLSearchParams(location.search).get('invite')
  const { error } = await sb.rpc('join_world', invite ? { p_world: worldSeed, p_invite: invite } : { p_world: worldSeed })
  // a world that isn't taking new players: look around it instead (it's public)
  if (error && /WORLD_CLOSED/.test(error.message)) return new SupabaseStore(sb, worldSeed, true, true)
  if (error) console.warn('join_world', error.message)
  return new SupabaseStore(sb, worldSeed)
}

/** The email of the session saved on this device, if any (works offline). */
function savedSessionEmail(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (!/^sb-.*-auth-token$/.test(k)) continue
      const v = JSON.parse(localStorage.getItem(k) ?? 'null')
      const email = v?.user?.email ?? v?.currentSession?.user?.email
      if (email) return email
    }
  } catch { /* ignore */ }
  return null
}

/** A failure that means "can't reach the server" (retry later), not "refused". */
const offlineError = (msg: string) => !navigator.onLine || /fetch|network|load failed|timed? ?out/i.test(msg)

function readJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
function writeJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* full or private mode: offline copy is best-effort */ }
}

export class SupabaseStore implements EventStore {
  private sb: SupabaseClient
  private world: string
  /** true while showing the device's copy of the world because the server can't be reached */
  offline = false
  onStatus: () => void = () => {}
  private flushing = false

  /** read-only visitor: no account, or signed in to a world that isn't taking new players */
  readonly guest: boolean
  /** the visitor is signed in, but this world is closed to new players */
  readonly closedToMe: boolean

  constructor(sb: SupabaseClient, world: string, guest = false, closedToMe = false) {
    this.sb = sb
    this.world = world
    this.guest = guest
    this.closedToMe = closedToMe
    window.addEventListener('online', () => { void this.flush() })
  }

  /** Can people without an account look at this world? */
  async isPublic(): Promise<boolean> {
    const { data, error } = await this.sb.rpc('world_is_public', { p_world: this.world })
    if (error) { console.warn('world_is_public', error.message); return false }
    return !!data
  }

  // -------------------------------------------------------------- world admin

  async setPublic(on: boolean) {
    const { error } = await this.sb.rpc('set_world_public', { p_world: this.world, p_public: on })
    if (error) throw new Error(error.message)
  }
  /** This player's invite into the world, fetched ahead of time so sharing stays instant. */
  invite: string | null = null
  async loadInvite() {
    if (this.guest) return
    const { data, error } = await this.sb.rpc('world_invite', { p_world: this.world })
    if (error) console.warn('world_invite', error.message)
    else this.invite = data as string
  }

  async setClosed(on: boolean) {
    const { error } = await this.sb.rpc('set_world_closed', { p_world: this.world, p_closed: on })
    if (error) throw new Error(error.message)
  }
  async addAdmin(user: string) {
    const { error } = await this.sb.rpc('add_world_admin', { p_world: this.world, p_user: user })
    if (error) throw new Error(error.message)
  }
  async removeAdmin(user: string) {
    const { error } = await this.sb.rpc('remove_world_admin', { p_world: this.world, p_user: user })
    if (error) throw new Error(error.message)
  }

  private get cacheKey() { return `quex:world:v1:${this.world}` }
  private get queueKey() { return `quex:outbox:v1:${this.world}` }
  /** events made offline, waiting to be sent */
  pending(): GameEvent[] { return readJSON<GameEvent[]>(this.queueKey, []) }

  private setOffline(v: boolean) {
    if (this.offline !== v) { this.offline = v; this.onStatus() }
  }

  async load(): Promise<GameEvent[]> {
    if (this.guest && !(await this.isPublic())) throw new PrivateWorldError()
    const out: GameEvent[] = []
    let from = 0
    try {
      for (;;) {
        const { data, error } = await this.sb.from('events').select('body').eq('world', this.world)
          .order('at', { ascending: true }).order('seq', { ascending: true }).range(from, from + 999)
        if (error) throw new Error(error.message)
        out.push(...data.map((r) => r.body as GameEvent))
        if (data.length < 1000) break
        from += 1000
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const cached = readJSON<GameEvent[] | null>(this.cacheKey, null)
      if (cached && offlineError(msg)) {
        // offline: play from this device's copy (plus anything still waiting to send)
        this.setOffline(true)
        const seen = new Set(cached.map((x) => x.id))
        return [...cached, ...this.pending().filter((x) => !seen.has(x.id))]
      }
      throw e
    }
    this.setOffline(false)
    writeJSON(this.cacheKey, out)
    void this.flush()
    const seen = new Set(out.map((x) => x.id))
    return [...out, ...this.pending().filter((x) => !seen.has(x.id))]
  }

  private remember(ev: GameEvent) {
    const cached = readJSON<GameEvent[]>(this.cacheKey, [])
    if (!cached.some((x) => x.id === ev.id)) { cached.push(ev); writeJSON(this.cacheKey, cached) }
  }

  async append(ev: GameEvent) {
    this.remember(ev)
    if (!navigator.onLine) return this.queue(ev)
    const { error } = await this.sb.from('events').insert({
      id: ev.id, world: this.world, at: ev.at, player_id: ev.playerId, kind: ev.t, body: ev,
    })
    if (!error) return this.setOffline(false)
    if (offlineError(error.message)) this.queue(ev)
    else console.warn('event not synced', error.message)
  }

  private queue(ev: GameEvent) {
    const q = this.pending()
    if (!q.some((x) => x.id === ev.id)) { q.push(ev); writeJSON(this.queueKey, q) }
    this.setOffline(true)
  }

  /** Send events made while offline, oldest first. */
  async flush() {
    if (this.flushing || !navigator.onLine) return
    this.flushing = true
    try {
      for (const ev of this.pending()) {
        const { error } = await this.sb.from('events').insert({
          id: ev.id, world: this.world, at: ev.at, player_id: ev.playerId, kind: ev.t, body: ev,
        })
        if (error && offlineError(error.message)) return // still offline: try again later
        // sent, already there (duplicate id) or refused: either way it leaves the outbox
        if (error && !/duplicate key/i.test(error.message)) console.warn('queued event not synced', error.message)
        writeJSON(this.queueKey, this.pending().filter((x) => x.id !== ev.id))
      }
      this.setOffline(false)
    } finally {
      this.flushing = false
    }
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
      .upsert({ player_id: playerId, date, slot, text }, { onConflict: 'player_id,date,slot' })
    if (error) throw new Error(error.message)
  }

  /** Player ids in this world owned by the signed-in user (for a new device). */
  /** null = couldn't check (offline): keep what this device already knows. */
  async ownedPlayers(): Promise<string[] | null> {
    const { data: s } = await this.sb.auth.getSession()
    const uid = s.session?.user.id
    if (!uid) return []
    const { data, error } = await this.sb.from('player_owners').select('player_id').eq('world', this.world).eq('user_id', uid)
    if (error) { console.warn('player_owners', error.message); return offlineError(error.message) ? null : [] }
    return data.map((r) => r.player_id as string)
  }

  subscribe(cb: (ev: GameEvent) => void) {
    const ch = this.sb.channel(`events:${this.world}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `world=eq.${this.world}` },
        (msg) => { const ev = (msg.new as { body: GameEvent }).body; this.remember(ev); cb(ev) })
      .subscribe()
    return () => { this.sb.removeChannel(ch) }
  }

  // -------------------------------------------------------------- guardians

  /** Who is signed in, who guards which player, and which user plays which player. */
  async access(): Promise<Access> {
    if (this.guest) return { me: null, guardians: [], owners: [], admins: [], public: true, closed: this.closedToMe }
    const key = `quex:access:v1:${this.world}`
    const { data: s } = await this.sb.auth.getSession()
    const [g, o, ad, w] = await Promise.all([
      this.sb.from('player_guardians').select('player_id, guardian_id').eq('world', this.world),
      this.sb.from('player_owners').select('player_id, user_id').eq('world', this.world),
      this.sb.from('world_admins').select('user_id').eq('world', this.world),
      this.sb.from('worlds').select('public, closed').eq('seed', this.world).maybeSingle(),
    ])
    if (g.error || o.error) {
      // offline: who guards whom hasn't changed, use the last known roles
      console.warn('access', g.error?.message ?? o.error?.message)
      const cached = readJSON<Access | null>(key, null)
      if (cached) return cached
    }
    const a: Access = {
      me: s.session?.user.id ?? null,
      guardians: (g.data ?? []).map((r) => ({ player: r.player_id as string, user: r.guardian_id as string })),
      owners: (o.data ?? []).map((r) => ({ player: r.player_id as string, user: r.user_id as string })),
      admins: (ad.data ?? []).map((r) => r.user_id as string),
      public: !!(w.data as { public?: boolean } | null)?.public,
      closed: !!(w.data as { closed?: boolean } | null)?.closed,
    }
    if (!g.error && !o.error) writeJSON(key, a)
    return a
  }

  /** A one-time link a parent opens (signed in to their own account) to become a guardian. */
  async createParentLink(playerId: string): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(18))
    const token = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''))
    const { error } = await this.sb.from('guardian_invites').insert({ token, world: this.world, player_id: playerId })
    if (error) throw new Error(error.message)
    const u = new URL(location.origin + location.pathname)
    u.searchParams.set('seed', this.world)
    u.searchParams.set('guardian', token)
    return u.toString()
  }

  async acceptParentLink(token: string): Promise<string> {
    const { data, error } = await this.sb.rpc('accept_guardian', { p_token: token })
    if (error) throw new Error(error.message)
    return (data as { player_id: string }[])[0]?.player_id ?? ''
  }

  async stopGuarding(playerId: string) {
    const { data: u } = await this.sb.auth.getUser()
    const { error } = await this.sb.from('player_guardians').delete()
      .eq('world', this.world).eq('player_id', playerId).eq('guardian_id', u.user?.id ?? '')
    if (error) throw new Error(error.message)
  }

  /** Live task-name edits (from a parent or child) and guardian changes. */
  watch(onLabel: (r: { player_id: string; date: string; slot: number; text: string }) => void, onAccess: () => void) {
    const ch = this.sb.channel(`private:${this.world}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_labels' },
        (msg) => { if (msg.new && 'player_id' in msg.new) onLabel(msg.new as { player_id: string; date: string; slot: number; text: string }) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_guardians', filter: `world=eq.${this.world}` }, () => onAccess())
      .subscribe()
    return () => { this.sb.removeChannel(ch) }
  }
}

// ------------------------------------------------------------------ account

/** Online roles in a world (see Game.access). */
export interface Access {
  me: string | null
  guardians: { player: string; user: string }[]
  owners: { player: string; user: string }[]
  /** users who administer this world */
  admins: string[]
  /** can people without an account look at it? */
  public: boolean
  /** only existing players can join */
  closed: boolean
}

/** A guest tried to look at a world that isn't public. */
export class PrivateWorldError extends Error {
  constructor() { super('This world is private') }
}

export interface AssistantLink { id: string; label: string; created_at: string; last_used_at: string | null }

export interface AccountInfo { email: string | null; guest: boolean }

const here = () => location.origin + location.pathname + location.search

/** Sign-in: emailed code/link, password, or Google (when enabled in Supabase
 *  and VITE_AUTH_GOOGLE=1). Emails carry a link and a 6-digit {{ .Token }}. */
const GUEST_KEY = 'quex:guest'

export const account = {
  enabled: supabaseEnabled,

  /** Looking around a public world without an account (this tab only). */
  isGuest(): boolean { try { return sessionStorage.getItem(GUEST_KEY) === '1' } catch { return false } },
  enterGuest() { try { sessionStorage.setItem(GUEST_KEY, '1') } catch { /* ignore */ } location.reload() },
  leaveGuest(reload = true) { try { sessionStorage.removeItem(GUEST_KEY) } catch { /* ignore */ } if (reload) location.reload() },
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

  /** Links that let an AI assistant (Claude, ChatGPT…) read and plan tasks through the quex-mcp function. */
  async assistantLinks(): Promise<AssistantLink[]> {
    const sb = await getClient()
    const { data, error } = await sb.from('assistant_links').select('id, label, created_at, last_used_at')
      .is('revoked_at', null).order('created_at')
    if (error) throw new Error(error.message)
    return data as AssistantLink[]
  },
  /** Makes a link; the full address is only ever shown this once. */
  async createAssistantLink(label: string): Promise<string> {
    const sb = await getClient()
    const { data, error } = await sb.rpc('create_assistant_link', { p_label: label })
    if (error) throw new Error(error.message)
    return `${URL_}/functions/v1/quex-mcp/${data as string}`
  },
  async revokeAssistantLink(id: string) {
    const sb = await getClient()
    const { error } = await sb.rpc('revoke_assistant_link', { p_id: id })
    if (error) throw new Error(error.message)
  },

  /** Where a signed-in person plays by default: the family world if they have a
   *  village there or look after a child there, otherwise the sandbox. */
  async homeWorld(): Promise<string> {
    if (!supabaseEnabled) return SANDBOX_WORLD
    const sb = await getClient()
    const { data: s } = await sb.auth.getSession()
    const uid = s.session?.user.id
    if (!uid) return SANDBOX_WORLD
    const [o, g] = await Promise.all([
      sb.from('player_owners').select('player_id').eq('world', FAMILY_WORLD).eq('user_id', uid).limit(1),
      sb.from('player_guardians').select('player_id').eq('world', FAMILY_WORLD).eq('guardian_id', uid).limit(1),
    ])
    if (o.error && g.error) return offlineError(o.error.message) ? FAMILY_WORLD : SANDBOX_WORLD
    return (o.data?.length || g.data?.length) ? FAMILY_WORLD : SANDBOX_WORLD
  },

  async signOut() {
    const sb = await getClient()
    await sb.auth.signOut()
  },
}
