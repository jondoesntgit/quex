import { useEffect, useReducer } from 'react'
import { BUILDINGS, GOOD_LABEL, ORES, SIZE_RANK, type ActionKind, type BuildingId, type Good, type Goods, type TaskSize } from '../game/data'
import { FREE, actionSize, caravanTier, validate } from '../game/reducer'
import type { World } from '../world/types'
import type { GameEvent, Home, Player, Token, Village } from '../game/types'
import { eventId, type Game } from '../app/store'

export function useGame(game: Game | null) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!game) return
    const off = game.on(bump)
    return () => { off() }
  }, [game])
}

/** An action a player can spend: a whole token, or two half-done ones of the
 *  same size merged (the second in `tok2`) into a whole action of that size. */
export interface Spendable { id: string; size: TaskSize; strength: number; tok: Token; tok2?: Token }

/** Everything in the tray: whole tokens, then half-done ones paired with a
 *  half of the same size into wholes, then the unpaired halves (at most one per
 *  size), which can't be spent until another half of their size joins them. */
export function spendables(p: Player): Spendable[] {
  const one = (t: Token): Spendable => ({ id: t.id, size: t.size, strength: t.strength, tok: t })
  const pair = (a: Token, b: Token): Spendable => ({ id: `${a.id}+${b.id}`, size: a.size, strength: Math.min(1, a.strength + b.strength), tok: a, tok2: b })
  const out = p.tokens.filter((t) => t.strength >= 1).map(one)
  const left: Spendable[] = []
  for (const size of ['big', 'medium', 'small'] as const) {
    const hs = p.tokens.filter((t) => t.strength < 1 && t.size === size)
    for (let i = 0; i + 1 < hs.length; i += 2) out.push(pair(hs[i], hs[i + 1]))
    if (hs.length % 2) left.push(one(hs[hs.length - 1]))
  }
  return [...out, ...left]
}

/** Smallest sufficient whole action (a lone half-done one can't be spent). */
export function bestToken(p: Player, need: 'big' | 'medium' | 'small'): Spendable | null {
  const ok = spendables(p).filter((t) => t.strength >= 1 && SIZE_RANK[t.size] >= SIZE_RANK[need])
  ok.sort((a, b) => SIZE_RANK[a.size] - SIZE_RANK[b.size] || (a.tok2 ? 1 : 0) - (b.tok2 ? 1 : 0))
  return ok[0] ?? null
}

export function actEvent(game: Game, p: Player, tok: Spendable, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; home?: Home; replace?: number; to?: string; goods?: Record<string, number>; troops?: number; crew?: number; food?: Record<string, number> } = {}): GameEvent {
  return {
    t: 'act', id: eventId(), at: game.now().toISOString(), playerId: p.id, tokenId: tok.tok.id,
    ...(tok.tok2 ? { tokenId2: tok.tok2.id } : {}), action, col, row, ...extra,
  }
}

export function tryAction(game: Game, p: Player, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; home?: Home; replace?: number; to?: string; goods?: Record<string, number>; troops?: number; crew?: number; food?: Record<string, number> } = {}, needOverride?: 'big' | 'medium' | 'small') {
  // a caravan costs by how the villages are connected: across country, by road, or free on paved road
  const v = game.state.villages[p.villageId]
  const dest = action === 'caravan' && extra.to ? game.state.villages[extra.to] : null
  const tier = dest && v ? caravanTier(game.world, game.state, v, dest) : null
  if (tier === 'free') {
    const free: Spendable = { id: FREE, size: 'small', strength: 1, tok: { id: FREE, size: 'small', strength: 1, date: '', slot: -1 } }
    const ev = actEvent(game, p, free, action, col, row, extra)
    const error = validate(game.state, game.world, ev)
    // no carts, or oxen still out: fall back to a small task
    if (!error) return { ev, error, tok: free }
  }
  const size = needOverride ?? (tier ? (tier === 'medium' ? 'medium' : 'small') : actionSize(game.world, action, col, row, game.now().toISOString(), v))
  const tok = bestToken(p, size)
  if (!tok) {
    const need = size
    const half = p.tokens.some((t) => t.strength < 1 && SIZE_RANK[t.size] >= SIZE_RANK[need])
    return { ev: null, error: half ? `Finish your half-done ${need} task (or half-do another ${need} one) to unlock this` : `Finish a ${need} task to unlock this` }
  }
  const ev = actEvent(game, p, tok, action, col, row, extra)
  const error = validate(game.state, game.world, ev)
  return { ev: error ? null : ev, error, tok }
}

export const SIZE_LABEL = { big: 'Big', medium: 'Med', small: 'Small' } as const
/** Ways a village can specialise. Not a setting: just what the building ladders
 *  lead to, and what the land suits (roleFits). */
export const ROLE_INFO: Record<string, { name: string; blurb: string }> = {
  farm: { name: 'Farming', blurb: 'Plains and river valleys. Grain, bread, the food basket of the region.' },
  port: { name: 'Fishing & trade', blurb: 'On the coast. Fish, salt and ships, and the best trade with neighbours and far-off markets.' },
  mining: { name: 'Mining', blurb: 'Under the mountains. Stone, bricks, copper, then iron and bronze.' },
  forestry: { name: 'Forestry', blurb: 'Timber, game, leather and the charcoal the miners need.' },
  herding: { name: 'Herding', blurb: 'Hills and meadows. Wool, cheese, cloth and pack animals.' },
  explorer: { name: 'Exploring', blurb: 'The frontier. Fed by friends, brings back rare loot and new land.' },
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

// ------------------------------------------------------------------ ores

/** "mostly chalcopyrite, some malachite" */
export function mixText(g: Goods): string {
  const parts = (Object.entries(g) as [Good, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  if (parts.length === 1) return GOOD_LABEL[parts[0][0]].toLowerCase()
  return parts.map(([x, n], k) => `${k === 0 ? (n >= 0.7 ? 'mostly ' : '') : n < 0.35 ? 'some ' : ''}${GOOD_LABEL[x].toLowerCase()}`).join(', ')
}

/** What it takes to work an ore, for a village: "Smelter + Roasting heap, 1 charcoal each → 0.6 copper", and what's missing. */
export function oreHint(v: Village, g: Good): { text: string; missing: BuildingId[] } | null {
  const o = ORES[g]
  if (!o) return null
  const has = (id: BuildingId) => v.buildings.some((b) => b.type === id && b.progress >= 1)
  const need = [o.station, ...(o.with ? [o.with] : [])]
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()
  return {
    text: `${need.map((id) => BUILDINGS[id].name).join(' + ')}, ${fmt(o.fuel)} charcoal each → ${fmt(o.yield)} ${GOOD_LABEL[o.metal].toLowerCase()}`,
    missing: need.filter((id) => !has(id)),
  }
}
