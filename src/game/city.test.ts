import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { neighbours } from '../world/hex'
import { BASE_CAP, CITY_FROM, apply, cellIndex, cobbleError, newGame, popCap, validate } from './reducer'
import { COBBLE_COST, HOMES, centreOf, dims, findHome, findUpgrade, gatesOf, hexAt, homeFits, roomFor, visible, walkable } from './city'
import { EAT, HEADS } from './data'
import { needOf, people, spare } from './workers'
import type { GameEvent, GameState, Home } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const DAY = '2026-11-23'
const AT = `${DAY}T10:00:00.000Z`
let n = 0

function setup(site = 0): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[site], resetHour: 0, tz: 0 })
  s.villages.v_ann.goods = { grain: 12, timber: 80, stone: 80, planks: 20 }
  return s
}
const act = (s: GameState, action: string, col: number, row: number, extra: object = {}, size: 'small' | 'medium' | 'big' = 'medium') => {
  const id = `t${++n}`
  s.players.ann.tokens.push({ id, size, strength: 1, date: DAY, slot: 0 })
  return { t: 'act', id: `e${n}`, at: AT, playerId: 'ann', tokenId: id, action, col, row, ...extra } as GameEvent
}
const run = (s: GameState, ev: GameEvent) => { const err = validate(s, world, ev); if (!err) apply(s, world, ev); return err }
/** An open hex beside the city that cobblestone could go on. */
const nextHex = (s: GameState) => {
  const v = s.villages.v_ann
  for (const f of v.city!) for (const [c, r] of neighbours(world.cells[f].col, world.cells[f].row)) {
    const i = cellIndex(world, c, r)
    if (!cobbleError(world, s, v, i)) return i
  }
  return -1
}

describe('people are counted one by one', () => {
  it('keeps the economy the same: the same food, the same hands, the same hauling', () => {
    expect(EAT * HEADS).toBeCloseTo(0.5)
    expect(needOf({ type: 'field' })).toBe(2 * HEADS)
    const s = setup()
    const v = s.villages.v_ann
    expect(v.population).toBe(5 * HEADS)
    expect(BASE_CAP).toBe(6 * HEADS)
    expect(popCap(v)).toBe(BASE_CAP)
    expect(people(v)).toBe(5 * HEADS)
    expect(spare(v)).toBe(5 * HEADS) // nothing to staff yet
  })

  it('eats what five households did, and grows by the same share', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { grain: 12 }
    v.morale = 70
    const before = v.goods.grain!
    apply(s, world, { t: 'tick', id: 'k1', at: '2026-11-16T23:00:00.000Z', playerId: 'ann', date: '2026-11-16' })
    expect(before - (v.goods.grain ?? 0)).toBeCloseTo(2.5, 1) // 25 people at 0.1 = 5 at 0.5
  })
})

describe('the one-time update', () => {
  /** A village as the old rules left it: five "people", no city. */
  function old(): GameState {
    const s = setup()
    s.headsScaled = false
    const v = s.villages.v_ann
    v.population = 6; v.away = 1; v.jobs = { f: 2 }; delete v.city
    s.caravans.push({ id: 'c', from: 'v_ann', to: 'v_ann', goods: {}, departAt: AT, arriveAt: '2027-01-01T00:00:00.000Z', crew: 1 })
    s.homeward = [{ village: 'v_ann', crew: 1, at: '2027-01-01T00:00:00.000Z' }]
    s.garrisons = { v_ann: [{ id: 'd', from: 'v_ann', troops: 2, gear: {}, food: {}, status: 'waiting', since: AT }] }
    return s
  }
  const poke = (s: GameState, at = AT) => apply(s, world, { t: 'resetHour', id: `r${++n}`, at, playerId: 'ann', hour: 0 })

  it('turns households into people, once, and gives every village a city', () => {
    const s = old()
    poke(s)
    const v = s.villages.v_ann
    expect(s.headsScaled).toBe(true)
    expect(v.population).toBe(6 * HEADS)
    expect(v.away).toBe(HEADS)
    expect(v.jobs).toEqual({ f: 2 * HEADS })
    expect(s.caravans[0].crew).toBe(HEADS)
    expect(s.homeward![0].crew).toBe(HEADS)
    expect(s.garrisons!.v_ann[0].troops).toBe(2 * HEADS)
    expect(v.city!.length).toBeGreaterThanOrEqual(1)
    expect(v.city![0]).toBe(cellIndex(world, v.col, v.row))
    expect(s.log.some((l) => /one-time update/.test(l.text))).toBe(true)
    poke(s)
    expect(v.population).toBe(6 * HEADS) // not twice
  })

  it('waits for the day it was made for, and never touches a world made after it', () => {
    const early = old()
    poke(early, '2026-11-17T10:00:00.000Z')
    expect(early.headsScaled).toBe(false)
    expect(early.villages.v_ann.population).toBe(6)
    expect(CITY_FROM < AT).toBe(true)
    const fresh = setup()
    poke(fresh)
    expect(fresh.villages.v_ann.population).toBe(5 * HEADS)
  })

  it('raises the old Houses to room for 20, and the cap with them', () => {
    const s = old()
    s.villages.v_ann.buildings.push({ id: 'h', type: 'house', col: 0, row: 0, progress: 1 })
    poke(s)
    expect(popCap(s.villages.v_ann)).toBe(BASE_CAP + 4 * HEADS)
  })
})

describe('the city', () => {
  it('starts with the village hex and two beside it that meet at a corner', () => {
    for (let k = 0; k < Math.min(6, sites.length); k++) {
      const s = setup(k)
      const v = s.villages.v_ann
      expect(v.city![0]).toBe(cellIndex(world, v.col, v.row))
      expect(v.city!.length).toBeLessThanOrEqual(3)
      if (v.city!.length === 3) {
        const [, a, b] = v.city!.map((i) => world.cells[i])
        expect(neighbours(a.col, a.row).some(([c, r]) => c === b.col && r === b.row)).toBe(true)
      }
    }
  })

  it('takes more cobblestone beside it, for stone, and nowhere else', () => {
    const s = setup()
    const v = s.villages.v_ann
    const i = nextHex(s)
    expect(i).toBeGreaterThanOrEqual(0)
    const c = world.cells[i]
    const before = v.goods.stone!
    expect(run(s, act(s, 'cobble', c.col, c.row))).toBeNull()
    expect(v.city).toContain(i)
    expect(v.goods.stone).toBe(before - COBBLE_COST.stone!)
    expect(cobbleError(world, s, v, i)).toMatch(/already/)
    // far away, or not joined to it, or too poor
    const far = world.cells.find((x) => x.tier > 0 && Math.abs(x.col - v.col) > 6)!
    expect(run(s, act(s, 'cobble', far.col, far.row))).toBeTruthy()
    const t = setup()
    const j = nextHex(t)
    t.villages.v_ann.goods = { stone: 2 }
    expect(run(t, act(t, 'cobble', world.cells[j].col, world.cells[j].row))).toMatch(/Needs/)
  })

  it('refuses a workshop on cobbles', () => {
    const s = setup()
    const v = s.villages.v_ann
    const second = world.cells[v.city![1] ?? v.city![0]]
    expect(run(s, act(s, 'build', second.col, second.row, { building: 'granary' }))).toMatch(/cobbled city|village square/)
  })
})

describe('homes', () => {
  it('a cottage goes up on the cobbles, costs its price, and raises the cap', () => {
    const s = setup()
    const v = s.villages.v_ann
    const h = findHome(world, v, 'cottage')
    expect(h).toBeTruthy()
    const i = hexAt(world, v, [h!.x, h!.y])
    const timber = v.goods.timber!, cap = popCap(v)
    expect(run(s, act(s, 'home', world.cells[i].col, world.cells[i].row, { home: h }))).toBeNull()
    expect(v.homes).toHaveLength(1)
    expect(v.goods.timber).toBe(timber - HOMES.cottage.cost.timber!)
    expect(popCap(v)).toBe(cap + HOMES.cottage.cap)
  })

  it('a town house needs a big action and gives more room', () => {
    const s = setup()
    const v = s.villages.v_ann
    const h = findHome(world, v, 'townhouse')
    if (!h) return // (a tight corner may have no room for one)
    const c = world.cells[hexAt(world, v, [h.x, h.y])]
    expect(run(s, act(s, 'home', c.col, c.row, { home: h }, 'medium'))).toMatch(/big task/)
    expect(run(s, act(s, 'home', c.col, c.row, { home: h }, 'big'))).toBeNull()
    expect(popCap(v)).toBe(BASE_CAP + HOMES.townhouse.cap)
  })

  it('will not stack two on the same spot, or build off the cobbles, or with a bad sprite', () => {
    const s = setup()
    const v = s.villages.v_ann
    const h = findHome(world, v, 'cottage')!
    const c = world.cells[hexAt(world, v, [h.x, h.y])]
    expect(run(s, act(s, 'home', c.col, c.row, { home: h }))).toBeNull()
    expect(run(s, act(s, 'home', c.col, c.row, { home: h }))).toMatch(/No room/)
    const off = world.cells.find((x) => x.tier > 0 && !v.city!.includes(cellIndex(world, x.col, x.row)) && Math.abs(x.col - v.col) > 5)!
    expect(run(s, act(s, 'home', off.col, off.row, { home: { ...h, x: 0, y: 0 } }))).toBeTruthy()
    expect(run(s, act(s, 'home', c.col, c.row, { home: { ...h, key: 'church' } }))).toMatch(/not a home/)
    expect(run(s, act(s, 'home', c.col, c.row, { home: { ...h, x: Number.NaN } }))).toMatch(/not a home/)
  })

  it('keeps the town walkable as it fills: every door reachable, no two homes overlapping', () => {
    for (const site of [0, 1, 2]) {
      const s = setup(site)
      const v = s.villages.v_ann
      // lay cobblestone out to a few hexes, then fill them with homes until none will go
      for (let k = 0; k < 3; k++) { const i = nextHex(s); if (i < 0) break; run(s, act(s, 'cobble', world.cells[i].col, world.cells[i].row)) }
      let placed = 0
      for (let k = 0; k < 40; k++) {
        const kind = k % 3 === 2 ? 'townhouse' : 'cottage'
        const h = findHome(world, v, kind) ?? findHome(world, v, 'cottage')
        if (!h) break
        const c = world.cells[hexAt(world, v, [h.x, h.y])]
        expect(run(s, act(s, 'home', c.col, c.row, { home: h }, 'big')), `home ${k}`).toBeNull()
        placed++
        v.goods = { timber: 80, stone: 80, planks: 20 }
      }
      expect(placed, `homes that fit on ${v.city!.length} hexes`).toBeGreaterThan(2)
      expect(walkable(world, v)).toBe(true)
      expect(gatesOf(world, v).length).toBeGreaterThan(0)
      // none of the placed homes would be allowed on top of the others
      for (const h of v.homes!) expect(roomFor(world, { ...v, homes: v.homes!.filter((x) => x !== h) }, h)).toBe(true)
      for (const h of v.homes!) expect(homeFits(world, v, h as Home), 'a placed home is not allowed twice').toBe(false)
    }
  })
})

describe('what is seen', () => {
  it('turns down spots where a home would hide one behind it, though they have room', () => {
    const s = setup()
    const v = s.villages.v_ann
    let roomy = 0, hidden = 0
    for (const i of v.city!) {
      const c = centreOf(world, v, i)
      for (let dy = -27; dy <= 27; dy += 3) for (let dx = -30; dx <= 30; dx += 3) {
        const h: Home = { kind: 'cottage', key: 'c_L_tile_x_1', x: c[0] + dx, y: c[1] + dy, side: 'front' }
        if (hexAt(world, v, [h.x, h.y]) !== i || !roomFor(world, v, h)) continue
        roomy++
        if (!visible(world, v, h)) hidden++
      }
    }
    expect(roomy).toBeGreaterThan(20)
    expect(hidden, 'spots with room that the picture rules refuse').toBeGreaterThan(0)
    expect(hidden).toBeLessThan(roomy) // and it still leaves places to build
  })

  it('every home the finder offers passes it', () => {
    for (const site of [0, 1, 2]) {
      const s = setup(site)
      const v = s.villages.v_ann
      for (let k = 0; k < 6; k++) {
        const h = findHome(world, v, 'cottage')
        if (!h) break
        expect(visible(world, v, h)).toBe(true)
        v.homes = [...(v.homes ?? []), h]
      }
    }
  })
})

describe('placing a home where you tap', () => {
  it('goes to the spot nearest the tap, not just the middle of the hex', () => {
    const s = setup()
    const v = s.villages.v_ann
    const i = v.city![1] ?? v.city![0]
    const c = centreOf(world, v, i)
    const west: [number, number] = [c[0] - 18, c[1]], east: [number, number] = [c[0] + 18, c[1]]
    const a = findHome(world, v, 'cottage', i, west), b = findHome(world, v, 'cottage', i, east)
    if (!a || !b) return // (a crowded hex may have room in one place only)
    const d = (h: Home, to: [number, number]) => Math.hypot(h.x - to[0], h.y - to[1])
    expect(d(a, west)).toBeLessThanOrEqual(d(b, west) + 0.01)
    expect(d(b, east)).toBeLessThanOrEqual(d(a, east) + 0.01)
  })
})

describe('rebuilding a cottage as a town house', () => {
  it('pulls down the cottage and raises a town house in its place, for a big action and the town house price', () => {
    let done = 0
    for (const site of [0, 1, 2, 3, 4, 5]) {
      const s = setup(site)
      const v = s.villages.v_ann
      const h = findHome(world, v, 'cottage')
      if (!h) continue
      const i = hexAt(world, v, [h.x, h.y]), c = world.cells[i]
      expect(run(s, act(s, 'home', c.col, c.row, { home: h }))).toBeNull()
      const up = findUpgrade(world, v, i)
      if (!up) continue
      const cap = popCap(v), timber = v.goods.timber!
      expect(run(s, act(s, 'upgrade', c.col, c.row, { home: up.home, replace: up.index }, 'medium'))).toMatch(/big task/)
      expect(run(s, act(s, 'upgrade', c.col, c.row, { home: up.home, replace: up.index }, 'big'))).toBeNull()
      expect(v.homes).toHaveLength(1)
      expect(v.homes![0].kind).toBe('townhouse')
      expect(popCap(v)).toBe(cap + HOMES.townhouse.cap - HOMES.cottage.cap)
      expect(v.goods.timber).toBe(timber - HOMES.townhouse.cost.timber!)
      // it was a cottage once: not again, and not a made-up one
      expect(run(s, act(s, 'upgrade', c.col, c.row, { home: up.home, replace: up.index }, 'big'))).toMatch(/cottage/)
      done++
    }
    expect(done, 'sites where a cottage could be rebuilt').toBeGreaterThan(0)
  })

  it('refuses a town house that would not fit, or one that is not a town house', () => {
    const s = setup()
    const v = s.villages.v_ann
    const h = findHome(world, v, 'cottage')!
    const i = hexAt(world, v, [h.x, h.y]), c = world.cells[i]
    run(s, act(s, 'home', c.col, c.row, { home: h }))
    expect(run(s, act(s, 'upgrade', c.col, c.row, { home: { ...h, kind: 'cottage' }, replace: 0 }, 'big'))).toMatch(/not a town house/)
    expect(run(s, act(s, 'upgrade', c.col, c.row, { home: { kind: 'townhouse', key: 't_tile_y_0', x: 0, y: 0, side: 'front' }, replace: 0 }, 'big'))).toBeTruthy()
    expect(dims('t_tile_y_0')[1]).toBeGreaterThan(dims('c_S_tile_x_0')[1] - 1)
  })
})

describe('the one-time update never stops the game', () => {
  it('leaves the world as it was, and carries on, if the update cannot run', () => {
    const s = setup()
    s.headsScaled = false
    const v = s.villages.v_ann
    v.population = 6; v.away = 1; delete v.city
    s.garrisons = { v_ann: [null as never] } // a malformed record the update trips over, after it has begun
    const before = JSON.stringify(s.villages)
    expect(() => apply(s, world, { t: 'resetHour', id: 'rx', at: AT, playerId: 'ann', hour: 0 })).not.toThrow()
    expect(s.headsScaled).toBeFalsy()
    expect(v.population).toBe(6)
    expect(v.away).toBe(1)
    const A = JSON.parse(before).v_ann, B = JSON.parse(JSON.stringify(s.villages)).v_ann
    // (everything but the goods: the purse of coins is a different one-time rule, handed out first in the same event)
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (k !== 'goods') expect(JSON.stringify(B[k]), `field ${k}`).toBe(JSON.stringify(A[k]))
  })
})
