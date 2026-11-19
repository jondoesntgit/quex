import { useEffect, useReducer } from 'react'
import { ACTIONS, SIZE_RANK, type ActionKind, type BuildingId } from '../game/data'
import { validate } from '../game/reducer'
import type { World } from '../world/types'
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

/** Smallest sufficient whole token (half-done ones can't be spent). */
export function bestToken(p: Player, need: 'big' | 'medium' | 'small'): Token | null {
  const ok = p.tokens.filter((t) => t.strength >= 1 && SIZE_RANK[t.size] >= SIZE_RANK[need])
  ok.sort((a, b) => SIZE_RANK[a.size] - SIZE_RANK[b.size])
  return ok[0] ?? null
}

export function actEvent(game: Game, p: Player, tok: Token, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; to?: string; goods?: Record<string, number> } = {}): GameEvent {
  return { t: 'act', id: eventId(), at: game.now().toISOString(), playerId: p.id, tokenId: tok.id, action, col, row, ...extra }
}

export function tryAction(game: Game, p: Player, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; to?: string; goods?: Record<string, number> } = {}, needOverride?: 'big' | 'medium' | 'small') {
  const tok = bestToken(p, needOverride ?? ACTIONS[action].size)
  if (!tok) {
    const need = needOverride ?? ACTIONS[action].size
    const half = p.tokens.some((t) => t.strength < 1 && SIZE_RANK[t.size] >= SIZE_RANK[need])
    return { ev: null, error: half ? `Finish your half-done ${need} task to unlock this` : `Finish a ${need} task to unlock this` }
  }
  const ev = actEvent(game, p, tok, action, col, row, extra)
  const error = validate(game.state, game.world, ev)
  return { ev: error ? null : ev, error, tok }
}

export const SIZE_LABEL = { big: 'Big', medium: 'Med', small: 'Small' } as const
export const ROLE_INFO: Record<string, { name: string; blurb: string }> = {
  farm: { name: 'Farmers', blurb: 'Plains and river valleys. Grain, bread, the food basket of the region.' },
  port: { name: 'Trade', blurb: 'On the coast. Fish, salt and ships, and the best trade with neighbours and far-off markets.' },
  mining: { name: 'Miners', blurb: 'Under the mountains. Stone, bricks, copper, then iron and bronze.' },
  forestry: { name: 'Foresters', blurb: 'Timber, game, leather and the charcoal the miners need.' },
  herding: { name: 'Herders', blurb: 'Hills and meadows. Wool, cheese, cloth and pack animals.' },
  explorer: { name: 'Explorers', blurb: 'The frontier. Fed by friends, brings back rare loot and new land.' },
}

export interface Spot { col: number; row: number }

export { roleFits, type Fit } from '../game/sites'

/** A link that opens the game centred on one hex (and its world, if not the default). */
export function spotLink(game: Game, at: Spot): string {
  const u = new URL(location.origin + location.pathname)
  u.searchParams.set('seed', game.meta.worldSeed)
  u.searchParams.set('at', `${at.col},${at.row}`)
  // lets the person it's sent to join, even if the world is closed to new players
  const invite = (game.store as { invite?: string | null }).invite
  if (invite) u.searchParams.set('invite', invite)
  return u.toString()
}

/** `?at=col,row` from the current URL, if valid for this world. */
export function linkedSpot(world: World): Spot | null {
  const m = /^(\d+),(\d+)$/.exec(new URLSearchParams(location.search).get('at') ?? '')
  if (!m) return null
  const col = Number(m[1]), row = Number(m[2])
  return col < world.width && row < world.height ? { col, row } : null
}

/** Share sheet on phones, clipboard elsewhere. Returns a message for a toast. */
export async function shareSpot(game: Game, at: Spot, text: string): Promise<string> {
  const url = spotLink(game, at)
  try {
    if (navigator.share) { await navigator.share({ title: 'Quex', text, url }); return 'Shared!' }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return ''
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return 'Link copied: paste it into a text.' } catch { return url }
}
