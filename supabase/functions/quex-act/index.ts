// Quex game server: the only writer of a world's state.
//
// POST /functions/v1/quex-act, JSON:
//   { op: 'act', world, event }  a player's action (Authorization: the player's session)
//   { op: 'state', world }       the world's state, making its first snapshot if needed
//   { op: 'tick' }               the nightly work for every world (from the schedule,
//                                with the x-quex-cron secret; see the server_state migration)
//
// The game rules come from src/server/act.ts, bundled to ./game.js by
// `npm run build:functions` (CI does this before deploying). Every write goes
// through the commit_event SQL function, which checks who may act and saves the
// event with the new state in one transaction.
import { act, dueTicks, seed, worldFor } from './game.js'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Json = Record<string, unknown>
// deno-lint-ignore no-explicit-any
type Any = any

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

async function rpc(fn: string, args: Json): Promise<Any> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: admin, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
  return r.json()
}
async function select(path: string): Promise<Any[]> {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: admin })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r.json()
}

/** The signed-in user behind a request, or null. */
async function userOf(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } })
  if (!r.ok) return null
  const u = await r.json()
  return u?.id && !u.is_anonymous ? u.id : null
}

/** The world's current state, making the first snapshot from its history if there isn't one yet. */
async function load(world: string): Promise<{ state: Any; n: number } | null> {
  for (let tries = 0; tries < 3; tries++) {
    const [row] = await select(`world_state?world=eq.${encodeURIComponent(world)}&select=state,n`)
    if (row) return { state: row.state, n: Number(row.n) }
    const [w] = await select(`worlds?seed=eq.${encodeURIComponent(world)}&select=season_start`)
    if (!w) return null
    const events: Any[] = []
    for (let from = 0; ; from += 1000) {
      const page = await select(`events?world=eq.${encodeURIComponent(world)}&select=body&order=at.asc,seq.asc&offset=${from}&limit=1000`)
      events.push(...page.map((r) => r.body))
      if (page.length < 1000) break
    }
    const state = seed(worldFor(world), w.season_start, events)
    await rpc('seed_world_state', { p_world: world, p_state: state, p_count: events.length })
  }
  throw new Error('The world kept changing while its snapshot was being made')
}

/** Check and save one action, retrying if another action got in first. */
async function commit(world: string, user: string | null, proposed: Any) {
  // sent again after a dropped connection: it's already done
  const [prior] = await select(`events?world=eq.${encodeURIComponent(world)}&id=eq.${encodeURIComponent(proposed.id)}&select=n,body`)
  if (prior) return { status: 200, body: { n: prior.n, event: prior.body, duplicate: true } }
  for (let tries = 0; tries < 5; tries++) {
    const cur = await load(world)
    if (!cur) return { status: 404, body: { error: 'No such world' } }
    const out = act(cur.state, worldFor(world), proposed, new Date())
    if (!out.ok) return { status: 422, body: { error: out.error } }
    const r = await rpc('commit_event', { p_world: world, p_user: user, p_n: cur.n, p_event: out.event, p_state: out.state })
    if (r.conflict) continue
    if (r.error) return { status: 403, body: { error: r.error } }
    return { status: 200, body: { n: r.n, event: out.event, duplicate: !!r.duplicate } }
  }
  return { status: 503, body: { error: 'The world is busy: try again' } }
}

/** Work out every finished day, for every player in every world. */
async function tickAll() {
  const rows = await select('world_state?select=world')
  const done: Json = {}
  for (const { world } of rows) {
    const cur = await load(world)
    if (!cur) continue
    let k = 0
    for (const ev of dueTicks(cur.state, new Date(), () => `tick-${crypto.randomUUID()}`)) {
      const r = await commit(world, null, ev)
      if (r.status === 200) k++
    }
    done[world] = k
  }
  return done
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405)
  let body: Any
  try { body = await req.json() } catch { return reply({ error: 'Bad JSON' }, 400) }
  try {
    if (body.op === 'tick') {
      const secret = req.headers.get('x-quex-cron') ?? ''
      if (!secret || !(await rpc('cron_secret_ok', { p_secret: secret }))) return reply({ error: 'Not allowed' }, 403)
      return reply({ ticked: await tickAll() })
    }
    const world = String(body.world ?? '')
    if (!world) return reply({ error: 'Which world?' }, 400)
    const user = await userOf(req)
    if (body.op === 'state') {
      if (!(await rpc('may_read', { p_world: world, p_user: user }))) return reply({ error: 'This world is private' }, 403)
      const cur = await load(world)
      return cur ? reply(cur) : reply({ error: 'No such world' }, 404)
    }
    if (body.op === 'act') {
      if (!user) return reply({ error: 'Sign in to play' }, 401)
      const ev = body.event
      if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || typeof ev.t !== 'string' || typeof ev.playerId !== 'string') {
        return reply({ error: 'Bad action' }, 400)
      }
      // task names never reach the server
      if ('label' in ev || 'labels' in ev) return reply({ error: 'Task names stay on your device' }, 400)
      const r = await commit(world, user, ev)
      return reply(r.body, r.status)
    }
    return reply({ error: 'Unknown op' }, 400)
  } catch (e) {
    console.error(e)
    return reply({ error: 'Server error' }, 500)
  }
})
