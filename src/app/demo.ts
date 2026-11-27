/** Development only: play a prepared world offline (`?demo=<name>`, files in demo/raids/<name>.json).
 *
 *  A demo file holds a world's state, who you play as, and the moment it starts. Actions go to an
 *  in-memory copy of the game server (the real rules, server/act.ts), so nothing touches the live
 *  database. The game's clock starts at the demo's moment; "Next morning" moves it on a day and works out
 *  every player's night, as the hourly job would. */
import { Game, newMeta, type EventStore, type Snapshot } from './store'
import { act, dueTicks, worldFor } from '../server/act'
import type { GameEvent, GameState } from '../game/types'

export interface DemoFile { title: string; seed: string; as: string; at: string; state: GameState; note?: string }

export async function demoGame(name: string): Promise<{ game: Game; demo: DemoFile; nextDay: () => Promise<void> }> {
  const demo: DemoFile = await (await fetch(`/demo/raids/${name}.json`, { cache: 'no-cache' })).json()
  const world = worldFor(demo.seed)
  let state = structuredClone(demo.state)
  let n = 1
  const subs = new Set<(ev: GameEvent, n?: number) => void>()
  const commit = (ev: GameEvent) => {
    const out = act(state, world, ev, new Date(Date.parse(ev.at)))
    if (!out.ok) return { status: 'refused' as const, error: out.error }
    state = out.state
    n++
    return { status: 'ok' as const, n, event: out.event }
  }
  const store: EventStore = {
    load: async () => [], append: async () => {},
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb) },
    snapshot: async (): Promise<Snapshot> => ({ state: structuredClone(state), n }),
    send: async (ev) => commit(ev),
  }
  const meta = { ...newMeta(demo.seed), seasonStart: demo.state.seasonStart, localPlayers: [demo.as], activePlayer: demo.as, dayOffset: (Date.parse(demo.at) - Date.now()) / 86_400_000 }
  const game = new Game(meta, store)
  await game.init()
  const nextDay = async () => {
    // the hosts nobody is playing take in the soldiers waiting at their gates
    for (const [host, ds] of Object.entries(state.garrisons ?? {})) {
      const hv = state.villages[host]
      if (!hv || hv.playerId === demo.as) continue
      for (const d of ds) if (d.status === 'waiting') {
        const r = commit({ t: 'garrison', id: `demo-accept-${d.id}`, at: game.now().toISOString(), playerId: hv.playerId, detachment: d.id, accept: true } as GameEvent)
        if (r.status === 'ok') for (const cb of subs) cb(r.event, r.n)
      }
    }
    game.meta.dayOffset += 1
    const now = game.now()
    for (const ev of dueTicks(state, now, () => `tick-${Math.random().toString(36).slice(2)}`)) {
      const r = commit(ev)
      if (r.status === 'ok') for (const cb of subs) cb(r.event, r.n)
    }
    await game.resync()
  }
  return { game, demo, nextDay }
}
