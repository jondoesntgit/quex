import { useEffect, useReducer } from 'react'
import { ACTIONS, SIZE_RANK, type ActionKind, type BuildingId } from '../game/data'
import { cellIndex, effectiveTerrain, validate } from '../game/reducer'
import type { GameState } from '../game/types'
import { distance, spiral } from '../world/hex'
import { MOUNTAIN_TERRAIN } from '../world/land'
import type { Role, World } from '../world/types'
import type { GameEvent, Player, Token } from '../game/types'
import { eventId, type Game } from '../app/store'

export function useGame(game: Game | null) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!game) return
    const off = game.on(bump)
    return () => { off() }
  }, [game])
}

/** Smallest sufficient token, full-strength preferred. */
export function bestToken(p: Player, need: 'big' | 'medium' | 'small'): Token | null {
  const ok = p.tokens.filter((t) => SIZE_RANK[t.size] >= SIZE_RANK[need])
  ok.sort((a, b) => b.strength - a.strength || SIZE_RANK[a.size] - SIZE_RANK[b.size])
  return ok[0] ?? null
}

export function actEvent(game: Game, p: Player, tok: Token, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; to?: string; goods?: Record<string, number> } = {}): GameEvent {
  return { t: 'act', id: eventId(), at: game.now().toISOString(), playerId: p.id, tokenId: tok.id, action, col, row, ...extra }
}

export function tryAction(game: Game, p: Player, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; to?: string; goods?: Record<string, number> } = {}, needOverride?: 'big' | 'medium' | 'small') {
  const tok = bestToken(p, needOverride ?? ACTIONS[action].size)
  if (!tok) return { ev: null, error: `Finish a ${needOverride ?? ACTIONS[action].size} task to unlock this` }
  const ev = actEvent(game, p, tok, action, col, row, extra)
  const error = validate(game.state, game.world, ev)
  return { ev: error ? null : ev, error, tok }
}

export const SIZE_LABEL = { big: 'Big', medium: 'Med', small: 'Small' } as const
export const ROLE_INFO: Record<string, { name: string; blurb: string }> = {
  farm: { name: 'Farmers', blurb: 'Plains and river valleys. Grain, bread, the food basket of the region.' },
  port: { name: 'Port', blurb: 'River mouth on the sea. Fish, salt, ships and the best NPC trade.' },
  mining: { name: 'Miners', blurb: 'Under the mountains. Stone, bricks, copper, then iron and bronze.' },
  forestry: { name: 'Foresters', blurb: 'Timber, game, leather and the charcoal the miners need.' },
  herding: { name: 'Herders', blurb: 'Hills and meadows. Wool, cheese, cloth and pack animals.' },
  explorer: { name: 'Explorers', blurb: 'The frontier. Fed by friends, brings back rare loot and new land.' },
}

export interface Spot { col: number; row: number }

export type Fit = 'great' | 'good' | 'ok'

/** How well each role suits the land around a spot, with a short reason.
 *  Advice only: any role can be founded anywhere. */
export function roleFits(world: World, s: GameState, at: Spot): Record<Role, { fit: Fit; why: string }> {
  const n = { water: 0, mountain: 0, hills: 0, forest: 0, meadow: 0, open: 0, river: 0 }
  for (const o of spiral(at, 2)) {
    if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) continue
    const i = cellIndex(world, o.col, o.row)
    const c = world.cells[i]
    const t = effectiveTerrain(world, s, i)
    if (c.tier === 0) { n.water++; continue }
    if (c.riverTo !== -1) n.river++
    if (MOUNTAIN_TERRAIN.includes(t)) n.mountain++
    else if (t === 'hills') n.hills++
    else if (t === 'forest') n.forest++
    else if (t === 'meadow') n.meadow++
    if (t === 'grass' || t === 'meadow' || t === 'savannah') n.open++
  }
  const coast = spiral(at, 1).some((o) => world.cells[cellIndex(world, o.col, o.row)]?.tier === 0)
  const cell = world.cells[cellIndex(world, at.col, at.row)]
  const danger = world.regions[cell?.region ?? 0]?.danger ?? 0
  const nearest = Math.min(Infinity, ...Object.values(s.villages).map((v) => distance(v, at)))
  const grade = (score: number, great: number, good: number): Fit => (score >= great ? 'great' : score >= good ? 'good' : 'ok')
  return {
    farm: { fit: grade(n.open + n.river * 2, 12, 7), why: n.river ? 'open land by a river' : 'open land' },
    port: { fit: coast ? grade(n.water, 6, 3) : 'ok', why: coast ? 'on the coast' : 'needs a coast' },
    mining: { fit: grade(n.mountain * 2 + n.hills, 6, 3), why: n.mountain ? 'mountains nearby' : 'hills nearby' },
    forestry: { fit: grade(n.forest, 8, 4), why: 'woodland around' },
    herding: { fit: grade(n.hills + n.meadow, 7, 4), why: 'hills and meadows' },
    explorer: { fit: grade(danger * 2 + (nearest >= 14 ? 2 : 0), 4, 2), why: danger ? 'toward the frontier' : 'far from neighbours' },
  }
}
