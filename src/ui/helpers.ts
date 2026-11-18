import { useEffect, useReducer } from 'react'
import { ACTIONS, SIZE_RANK, type ActionKind, type BuildingId } from '../game/data'
import { cellIndex, effectiveTerrain, validate } from '../game/reducer'
import type { GameState } from '../game/types'
import { spiral } from '../world/hex'
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

/** The role the land around a spot favours most. */
export function suggestRole(world: World, s: GameState, at: Spot): Role {
  const count = { water: 0, mountain: 0, forest: 0, pasture: 0 }
  for (const o of spiral(at, 2)) {
    if (o.col < 0 || o.row < 0 || o.col >= world.width || o.row >= world.height) continue
    const i = cellIndex(world, o.col, o.row)
    const t = effectiveTerrain(world, s, i)
    if (world.cells[i].tier === 0) count.water++
    else if (MOUNTAIN_TERRAIN.includes(t)) count.mountain++
    else if (t === 'forest') count.forest++
    else if (t === 'hills' || t === 'meadow') count.pasture++
  }
  const nextToSea = spiral(at, 1).some((o) => world.cells[cellIndex(world, o.col, o.row)]?.tier === 0)
  if (nextToSea && count.water >= 3) return 'port'
  if (count.mountain >= 3) return 'mining'
  if (count.forest >= 6) return 'forestry'
  if (count.pasture >= 5) return 'herding'
  return 'farm'
}
