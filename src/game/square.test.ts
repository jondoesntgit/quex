import { describe, expect, it } from 'vitest'
import { generateWorld } from '../world/generate'
import { neighbours, spiral } from '../world/hex'
import { SQUARE_FROM, STARTER_FROM, apply, digRoads, newGame, popCap, roadPath, storageCap, validate } from './reducer'
import { HOMES, SQUARE, cornerOf, findHome, homeFits, levelWorld, relayout, visible } from './city'
import { FOOD_SCALE, ROAD_TEAM } from './data'
import type { GameEvent, GameState, Village } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const join = (s: GameState, at: string, id = 'ann', site = 0) =>
  apply(s, world, { t: 'join', id: `j${id}`, at, playerId: id, name: id, site: sites[site], resetHour: 0, tz: 0 })
const after = '2026-11-28T10:00:00.000Z'

describe('the square on the corner', () => {
  it('levels the odd one of the three hexes to the level the other two share', () => {
    const s = newGame(world, '2026-11-15')
    join(s, after)
    const v = s.villages.v_ann
    const c = cornerOf(world, v)!
    expect(c.levels).toBe(1)
    for (const [k, t] of Object.entries(s.levelled ?? {})) expect(world.cells[Number(k)].tier).toBe(t)
  })

  it('the levels live in the state: a world without them is put back as it was made', () => {
    const w = generateWorld('test-seed')
    const i = sites[0].row * w.width + sites[0].col, was = w.cells[i].tier
    levelWorld(w, { [i]: was + 1 })
    expect(w.cells[i].tier).toBe(was + 1)
    levelWorld(w, {})
    expect(w.cells[i].tier).toBe(was)
  })

  it('a new village has its well where its three cobbled hexes meet, with open ground round it', () => {
    const s = newGame(world, '2026-11-15')
    join(s, after)
    const v = s.villages.v_ann
    const c = cornerOf(world, v)!
    expect(c).not.toBeNull()
    expect(v.starter).toEqual({ x: c.at[0], y: c.at[1], square: SQUARE })
    expect(v.homes!.length).toBeGreaterThanOrEqual(2)
    for (const h of v.homes!) {
      expect(h.start).toBe(true)
      // every home stands clear of the square and is seen
      const others = { ...v, homes: v.homes!.filter((o) => o !== h) }
      expect(homeFits(world, others, h)).toBe(true)
    }
  })

  it('before the cutoff a new village gets the old square (offline logs replay as they were)', () => {
    const s = newGame(world, '2026-11-15')
    join(s, '2026-11-24T10:00:00.000Z')
    expect(s.villages.v_ann.starter).toEqual({ x: 0, y: 0 })
  })

  it('moves an old square to the corner once, keeping every home and the room they give', () => {
    const s = newGame(world, '2026-11-15')
    join(s, STARTER_FROM.replace('04:00', '05:00'))
    const v = s.villages.v_ann
    s.wellsMoved = false
    v.buildings.push({ id: 'g1', type: 'granary', col: sites[0].col, row: sites[0].row, progress: 1 })
    const cap = popCap(v), store = storageCap(v), kinds = v.homes!.map((h) => h.kind).sort()
    expect(v.starter).toEqual({ x: 0, y: 0 })
    apply(s, world, { t: 'tick', id: 'k', at: SQUARE_FROM, playerId: 'nobody', date: '2026-11-27' } as GameEvent)
    expect(s.wellsMoved).toBe(true)
    expect(v.starter!.square).toBe(SQUARE)
    expect(popCap(v)).toBe(cap)
    expect(storageCap(v)).toBe(store) // the granary became a barn that stores as much
    expect(v.buildings.some((b) => b.type === 'granary')).toBe(false)
    expect(v.homes!.filter((h) => h.kind !== 'barn').map((h) => h.kind).sort()).toEqual(kinds)
    expect(v.homes!.filter((h) => h.kind === 'barn')).toHaveLength(1)
    // once only
    const homes = JSON.stringify(v.homes)
    apply(s, world, { t: 'tick', id: 'k2', at: '2026-11-28T04:00:00.000Z', playerId: 'nobody', date: '2026-11-28' } as GameEvent)
    expect(JSON.stringify(v.homes)).toBe(homes)
  })

  it('cobbles the hex of an old House beside the city and builds it again as cottages', () => {
    const s = newGame(world, '2026-11-15')
    join(s, STARTER_FROM.replace('04:00', '05:00'))
    const v = s.villages.v_ann
    s.wellsMoved = false
    const spot = v.city!.flatMap((c) => neighbours(world.cells[c].col, world.cells[c].row))
      .map(([c, r]) => r * world.width + c).find((i) => !v.city!.includes(i) && world.cells[i].tier > 0 && world.cells[i].riverTo === -1 && !v.buildings.some((b) => b.row * world.width + b.col === i))!
    v.buildings.push({ id: 'h1', type: 'house', col: spot % world.width, row: Math.floor(spot / world.width), progress: 1 })
    const cap = popCap(v)
    apply(s, world, { t: 'tick', id: 'k', at: SQUARE_FROM, playerId: 'nobody', date: '2026-11-27' } as GameEvent)
    expect(v.city).toContain(spot)
    expect(v.buildings.some((b) => b.type === 'house')).toBe(false)
    expect(popCap(v)).toBeGreaterThanOrEqual(cap)
  })

  it('leaves a village with fewer than three cobbled hexes alone', () => {
    const v = { id: 'v', col: sites[0].col, row: sites[0].row, city: [sites[0].row * world.width + sites[0].col], homes: [] } as unknown as Village
    expect(relayout(world, v)).toBeNull()
  })

  it('a home that would hide the well is not allowed', () => {
    const s = newGame(world, '2026-11-15')
    join(s, after)
    const v = s.villages.v_ann
    const h = findHome(world, v, 'cottage')!
    expect(visible(world, v, h)).toBe(true)
    // right in front of the well (just clear of the square)
    const block = { ...h, x: v.starter!.x, y: v.starter!.y + SQUARE + 9 }
    expect(visible(world, v, block)).toBe(false)
  })
})

describe('the barn', () => {
  it('is built on the cobbles and stores what a granary did', () => {
    const s = newGame(world, '2026-11-15')
    join(s, after)
    const v = s.villages.v_ann
    v.goods = { ...v.goods, timber: 50, stone: 50 }
    // a new square is full: make room as if the town had grown
    v.homes = v.homes!.slice(0, 1)
    const h = findHome(world, v, 'barn')!
    expect(h).not.toBeNull()
    expect(h.key).toMatch(/^b_(thatch|shingle)$/)
    s.players.ann.tokens.push({ id: 'tk', size: 'medium', strength: 1, date: '2026-11-28', slot: 0 })
    const store = storageCap(v), cap = popCap(v)
    const hex = (() => { for (const c of v.city!) { const at = findHome(world, v, 'barn', c); if (at && at.x === h.x && at.y === h.y) return c } return -1 })()
    const cell = world.cells[hex]
    const ev = { t: 'act', id: 'b1', at: after, playerId: 'ann', tokenId: 'tk', action: 'home', col: cell.col, row: cell.row, home: h } as GameEvent
    expect(validate(s, world, ev)).toBeNull()
    apply(s, world, ev)
    expect(storageCap(v)).toBe(store + HOMES.barn.storage! * FOOD_SCALE)
    expect(popCap(v)).toBe(cap) // houses nobody
  })
})

describe('roads', () => {
  it('run on through a building’s hex between two roads, and through cobbles', () => {
    const s = newGame(world, '2026-11-15')
    join(s, after, 'ann', 0)
    join(s, after, 'bob', 1)
    const a = s.villages.v_ann, b = s.villages.v_bob
    // a straight line of hexes between the two villages, as road, with one hex a field instead
    const line: number[] = []
    let cur = { col: a.col, row: a.row }
    const key = (o: { col: number; row: number }) => o.row * world.width + o.col
    const cube = (o: { col: number; row: number }) => { const q = o.col, r = o.row - (o.col - (o.col & 1)) / 2; return [q, r, -q - r] }
    const dist = (p: { col: number; row: number }, q: { col: number; row: number }) => { const x = cube(p), y = cube(q); return Math.max(...x.map((v, k) => Math.abs(v - y[k]))) }
    while (dist(cur, b) > 1) {
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, cur.col & 1 ? 1 : -1], [-1, cur.col & 1 ? 1 : -1]].map(([dc, dr]) => ({ col: cur.col + dc, row: cur.row + dr }))
      cur = nb.sort((p, q) => dist(p, b) - dist(q, b))[0]
      line.push(key(cur))
    }
    const mid = line[Math.floor(line.length / 2)]
    a.roads = line.filter((i) => i !== mid)
    expect(roadPath(world, s, a, b)).toBeNull()
    a.buildings.push({ id: 'f', type: 'field', col: mid % world.width, row: Math.floor(mid / world.width), progress: 1 })
    expect(roadPath(world, s, a, b)).not.toBeNull()
    // but not from one building's hex straight into the next
    const next = line[Math.floor(line.length / 2) + 1]
    a.roads = a.roads.filter((i) => i !== next)
    a.buildings.push({ id: 'p', type: 'pen', col: next % world.width, row: Math.floor(next / world.width), progress: 1 })
    expect(roadPath(world, s, a, b)).toBeNull()
  })
})

describe('notices had on any device', () => {
  it('a seen event keeps the ids on the village, once each', () => {
    const s = newGame(world, '2026-11-15')
    join(s, after)
    const ev = (id: string, ids: string[]) => ({ t: 'seen', id, at: after, playerId: 'ann', ids }) as GameEvent
    expect(validate(s, world, ev('s0', []))).not.toBeNull()
    apply(s, world, ev('s1', ['night:2026-11-27']))
    apply(s, world, ev('s2', ['night:2026-11-27', 'a1']))
    expect(s.villages.v_ann.seen).toEqual(['night:2026-11-27', 'a1'])
  })
})

describe('road teams dig together where their plans line up', () => {
  const setup = () => {
    const s = newGame(world, '2026-11-15')
    join(s, after, 'ann', 0)
    join(s, after, 'bob', 1)
    const a = s.villages.v_ann, b = s.villages.v_bob
    const hex = spiral(a, 2).map((o) => o.row * world.width + o.col)
      .find((i) => world.cells[i]?.tier > 0 && !a.city!.includes(i) && !b.city!.includes(i) && i !== a.row * world.width + a.col)!
    return { s, a, b, hex }
  }
  it('two teams on one hex dig it twice as fast, and it is a road for both', () => {
    const { s, a, b, hex } = setup()
    for (const v of [a, b]) { v.roadPlan = [hex]; v.roadCrew = ROAD_TEAM; v.roadAt = '2026-11-28T10:00:00.000Z' }
    digRoads(s, world, '2026-11-28T16:00:00.000Z') // a quarter day each: half the hex
    expect(s.roadWork?.[hex]).toBeCloseTo(0.5, 2)
    expect(a.roadDone).toBeCloseTo(0.5, 2)
    digRoads(s, world, '2026-11-28T22:00:00.000Z')
    expect(a.roads).toContain(hex)
    expect(b.roads).toContain(hex)
    expect(a.roadPlan).toEqual([])
    expect(b.roadPlan).toEqual([])
    expect(s.log.at(-1)!.text).toMatch(/together/)
  })
  it('someone else’s road is not planned again', () => {
    const { s, a, b, hex } = setup()
    b.roads.push(hex)
    const cell = world.cells[hex]
    const ev = { t: 'roadplan', id: 'rp', at: after, playerId: 'ann', plan: [{ col: cell.col, row: cell.row }] } as GameEvent
    expect(validate(s, world, ev)).toMatch(/Already a road/)
    void a
  })
  it('a team’s part-dug hex from before keeps what it had', () => {
    const { s, a, hex } = setup()
    a.roadPlan = [hex]; a.roadCrew = ROAD_TEAM; a.roadAt = '2026-11-28T10:00:00.000Z'; a.roadDone = 0.4
    delete s.roadWork
    digRoads(s, world, '2026-11-28T10:00:00.000Z')
    expect(s.roadWork?.[hex]).toBeCloseTo(0.4, 3)
  })
})
