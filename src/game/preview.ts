/** What an action would cost and give, worked out before it's spent, for the confirmation window.
 *
 *  Two plain lists, so the player can tell what leaves from what arrives:
 *    spends: the action (task) used up, and any goods paid;
 *    gets:   what comes back, and what's built.
 *  `notes` are the small print (what's left of a deposit, what a dug-out pit becomes).
 *
 *  The numbers come from the same rule functions the reducer uses, so what's shown is what happens
 *  (preview.test.ts checks it against the reducer). Nothing here changes the game. */
import { ACTIONS, BUILDINGS, GATHER, GOOD_LABEL, type ActionKind, type BuildingId, type TaskSize } from './data'
import { DEPLETION_FROM, gameLeft, leftAt } from './deposits'
import { PAVE_COST, buildCost, fmtGoods, landAt, cellIndex } from './reducer'
import { COBBLE_COST, HOMES } from './city'
import type { GameState, Home, Player } from './types'
import { WELL_COST, clayLeft, clayRenews, mountainSpring } from './water'
import { hasTrees, treeCount } from '../world/land'
import type { World } from '../world/types'
import { playerDate } from './calendar'

export interface Outcome { spends: string[]; gets: string[]; notes: string[] }

const round2 = (x: number) => Math.round(x * 100) / 100
const good = (g: string) => GOOD_LABEL[g as keyof typeof GOOD_LABEL]?.toLowerCase() ?? g.replace('_', ' ')

/** The action spent: "1 small action", or one made of two half-done tasks. */
export function taskText(tok: { size: TaskSize; strength: number; merged?: boolean }): string {
  return `1 ${tok.size} action${tok.merged ? ' (two half-done tasks)' : ''}${tok.strength < 1 ? ', half strength: it does half as much' : ''}`
}

export function outcome(world: World, s: GameState, p: Player, action: ActionKind, col: number, row: number,
  extra: { building?: BuildingId; home?: Home } = {}, tok: { size: TaskSize; strength: number; merged?: boolean }, at: string): Outcome {
  const v = s.villages[p.villageId]
  const i = cellIndex(world, col, row)
  const land = landAt(world, s, i)
  const k = tok.strength
  const out: Outcome = { spends: [taskText(tok)], gets: [], notes: [] }
  switch (action) {
    case 'gather': {
      const g = GATHER[land.resource!]
      if (!g) break
      let n = round2(3 * k)
      const left = at >= DEPLETION_FROM ? leftAt(world, s, i) : null
      if (left && left.good === g) {
        n = round2(Math.min(n, left.surface))
        const rest = round2(left.surface - n)
        out.notes.push(rest >= 1 ? `About ${Math.round(rest)} more at the surface afterwards.` : `That clears the surface${left.deep >= 1 ? '; a mine could reach what is below' : ''}.`)
      }
      if (g === 'game') {
        const have = gameLeft(world, s, i, playerDate(at, p.resetHour, p.tz))
        n = round2(Math.min(n, have))
        out.notes.push(`${Math.floor(have - n)} animals would be left; they come back slowly.`)
      }
      out.gets.push(`+${n} ${good(g)}`)
      break
    }
    case 'pick': {
      const left = leftAt(world, s, i)
      const n = round2(Math.min(3 * k, left?.surface ?? 0))
      out.gets.push(`+${n} stone`)
      const rest = round2((left?.surface ?? 0) - n)
      out.notes.push(rest < 1 ? 'The ground is picked clean: fields here grow better.' : `About ${Math.round(rest)} more loose stone afterwards.`)
      break
    }
    case 'clear': {
      const n = round2((land.terrain === 'forest' ? 3 : 1) * k)
      out.gets.push(`+${n} timber`)
      const stand = s.woods?.[i]
      const standing = stand ? stand.n : treeCount(land) - (land.stumps ?? 0)
      out.notes.push(standing <= 1 ? 'That is the last tree: the land opens up.' : `One tree comes down; ${standing - 1} stay standing, and the trees spread back over the stumps in winter.`)
      break
    }
    case 'dig_clay': {
      const left = clayLeft(world, s, i) ?? 0
      const n = round2(Math.min(3 * k, left))
      out.gets.push(`+${n} clay`)
      const rest = round2(left - n)
      if (rest >= 1) out.notes.push(`About ${Math.floor(rest)} clay left in this ground.`)
      else if (clayRenews(world, i)) out.notes.push(`This digs it out until winter, when ${mountainSpring(world, i) ? 'the spring' : 'the water'} brings more.`)
      else out.notes.push('This digs the pit out for good. After the next winter, rain fills an empty pit and it becomes a pond (dry in summer), which a herd can drink from.')
      break
    }
    case 'plant':
      out.gets.push('Two saplings: they take root in winter, then the trees spread')
      break
    case 'road': {
      const bridge = world.cells[i].riverTo !== -1
      out.gets.push(bridge ? 'A bridge carries the road over the river' : 'A dirt road: caravans through here go 3x faster')
      break
    }
    case 'pave':
      out.spends.push(fmtGoods(PAVE_COST))
      out.gets.push('Stone paving: caravans along it go 9x faster than cross-country, and carry more')
      break
    case 'well':
      out.spends.push(fmtGoods(WELL_COST))
      out.gets.push('A well: fresh water that never runs dry, for herds within a hex')
      break
    case 'cobble': {
      out.spends.push(fmtGoods(COBBLE_COST))
      out.gets.push('A hex of cobbled city: homes can stand on it, and it joins the cobbles beside it')
      if (hasTrees(land)) {
        const n = treeCount(land)
        out.gets.push(`+${round2(n * (land.terrain === 'forest' ? 3 : 1) * 0.5)} timber from the ${n} tree${n === 1 ? '' : 's'} that come down for it`)
        out.notes.push('The trees here are felled for good: the ground is open from now on.')
      }
      break
    }
    case 'upgrade': {
      out.spends.push(fmtGoods(HOMES.townhouse.cost))
      out.gets.push('A town house in place of the cottage', `Room for ${HOMES.townhouse.cap - HOMES.cottage.cap} more villagers (${HOMES.townhouse.cap} instead of ${HOMES.cottage.cap})`)
      out.notes.push('The cottage is pulled down; its materials are not returned.')
      break
    }
    case 'home': {
      const h = extra.home
      if (!h) break
      const def = HOMES[h.kind]
      out.spends.push(fmtGoods(def.cost))
      out.gets.push(`A ${def.name.toLowerCase()} in the city`, `Room for ${def.cap} more villagers`)
      out.notes.push(def.blurb, 'Villagers only move in while there is food to feed them and morale is good.')
      break
    }
    case 'build': {
      const def = BUILDINGS[extra.building!]
      if (!def) break
      const cost = buildCost(v, def, at)
      if (Object.keys(cost).length) out.spends.push(`${fmtGoods(cost, k)}${k < 1 ? ' (half the cost)' : ''}`)
      out.gets.push(k < 1 ? `A half-built ${def.name}: another task finishes it` : `A ${def.name}`)
      out.notes.push(def.blurb)
      break
    }
    default:
      out.gets.push(ACTIONS[action].blurb)
  }
  return out
}
