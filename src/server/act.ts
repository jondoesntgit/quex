/** The game server's rules: the one place a world's state changes.
 *
 *  The Edge Function `quex-act` (supabase/functions/quex-act) holds each
 *  world's current state in `world_state` and runs every action through here:
 *  it stamps the server's time, validates with the same reducer the clients
 *  use, and applies it. Clients only ever propose actions. The function's
 *  HTTP and database plumbing is in index.ts; this file is plain TypeScript so
 *  it can be tested here and bundled for Deno (npm run build:functions).
 *
 *  Events are still stored, as the world's history (and what realtime sends to
 *  other players), but nothing is rebuilt from them any more except once, to
 *  make a world's first snapshot (seed). */
import { generateWorld } from '../world/generate'
import { levelWorld } from '../game/city'
import type { World } from '../world/types'
import { playerDate } from '../game/calendar'
import { apply, newGame, pendingTicks, validate } from '../game/reducer'
import type { GameEvent, GameState } from '../game/types'

const worlds = new Map<string, World>()
/** Worlds are a pure function of their seed; generating one takes ~70 ms, so keep them. */
export function worldFor(seed: string): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}

export type Outcome = { ok: true; state: GameState; event: GameEvent } | { ok: false; error: string }

/** Rules only the server can check, on top of the reducer's. */
function serverProblem(s: GameState, ev: GameEvent, now: Date): string | null {
  if (JSON.stringify(ev).length > 20_000) return 'That action is too big'
  if (ev.t === 'tick') {
    const p = s.players[ev.playerId]
    // a day is worked out once it's over, not before
    if (p && ev.date >= playerDate(now, p.resetHour, p.tz)) return "That day isn't over yet"
  }
  return null
}

/** Try one action on a world's state. The state passed in is not changed. */
export function act(state: GameState, world: World, proposed: GameEvent, now: Date): Outcome {
  // the server's clock decides when things happen
  const ev = { ...proposed, at: now.toISOString() } as GameEvent
  // the ground as this world's state has levelled it (squares on one level)
  levelWorld(world, state.levelled)
  const err = serverProblem(state, ev, now) ?? validate(state, world, ev)
  if (err) return { ok: false, error: err }
  const next = structuredClone(state)
  apply(next, world, ev)
  return { ok: true, state: next, event: ev }
}

/** The nightly work due for every player: each finished day not yet worked out. */
export function dueTicks(state: GameState, now: Date, id: () => string): GameEvent[] {
  const out: GameEvent[] = []
  for (const p of Object.values(state.players)) {
    const today = playerDate(now, p.resetHour, p.tz)
    // players from before `joined` was kept, who have never been ticked, are left to their own app
    const from = p.lastTick ? null : p.joined
    if (!p.lastTick && !from) continue
    for (const date of pendingTicks(p, today, from ?? today)) {
      out.push({ t: 'tick', id: id(), at: now.toISOString(), playerId: p.id, date })
    }
    // road teams dig by the hour: the hourly job carries the time to them, so the roads appear without anyone acting
    const v = state.villages[p.villageId]
    if (v?.roadPlan?.length && (v.roadCrew ?? 0) > 0) out.push({ t: 'roads', id: id(), at: now.toISOString(), playerId: p.id })
  }
  return out
}

/** A world's first snapshot: its whole history, replayed once, in time order. */
export function seed(world: World, seasonStart: string, events: GameEvent[]): GameState {
  const sorted = [...events].sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
  const s = newGame(world, seasonStart)
  for (const ev of sorted) apply(s, world, ev)
  return s
}
