/** Notices that pop up once (newcomers' notes, the morning report): once for the player, not once per device.
 *
 *  A notice is marked as had the moment it first shows, on the server (the 'seen' event, kept on the village),
 *  so the player's other devices and a reload of the page don't show it again. This device also remembers it,
 *  for offline play. Notices more than a few days old never pop up (a new device mustn't replay old news). */
import { eventId, type Game } from '../app/store'
import type { Player, Village } from '../game/types'

/** How long a notice stays news. */
const FRESH_DAYS = 3
export const fresh = (at: string, now: Date) => now.getTime() - Date.parse(at) <= FRESH_DAYS * 86_400_000

const KEY = (villageId: string) => `quex:seen:${villageId}`
function local(villageId: string): string[] {
  try { return JSON.parse(localStorage.getItem(KEY(villageId)) ?? '[]') } catch { return [] }
}
function rememberHere(villageId: string, id: string) {
  try { localStorage.setItem(KEY(villageId), JSON.stringify([...local(villageId), id].slice(-40))) } catch { /* private window */ }
}

/** Has the player had this notice, here or on any device? */
export const hadNotice = (v: Village, id: string) => !!v.seen?.includes(id) || local(v.id).includes(id)

/** On screen right now (shown, not yet closed): still "pending" for anything waiting its turn. */
export const onScreen = new Set<string>()

/** Mark a notice as had, here and for every device. */
export function markNotice(game: Game, p: Player, v: Village, id: string) {
  rememberHere(v.id, id)
  if (game.guest || v.seen?.includes(id)) return
  void game.dispatch({ t: 'seen', id: eventId(), at: game.now().toISOString(), playerId: p.id, ids: [id] }).catch(() => { /* this device still knows */ })
}
