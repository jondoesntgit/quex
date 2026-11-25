import { describe, expect, it } from 'vitest'
import { distance as distanceOf } from '../world/hex'
import { generateWorld } from '../world/generate'
import { BUILDINGS, HEADS } from './data'
import { line } from '../world/hex'
import { FREE, HEX_MINUTES, apply, caravanMinutes, caravanTier, cellIndex, newGame, scoutRadius, scoutsNew, tonight, validate } from './reducer'
import type { GameEvent, GameState } from './types'

const world = generateWorld('test-seed')
const sites = world.regions[world.startRegion].sites
const DAY = '2026-11-23'
const AT = `${DAY}T10:00:00.000Z`
let n = 0

function setup(): GameState {
  const s = newGame(world, '2026-11-15')
  apply(s, world, { t: 'join', id: 'ja', at: '2026-11-16T08:00:00Z', playerId: 'ann', name: 'Ann', site: sites[0], resetHour: 0, tz: 0 })
  apply(s, world, { t: 'join', id: 'jb', at: '2026-11-16T08:00:00Z', playerId: 'bob', name: 'Bob', site: sites.find((x) => distanceOf(x, sites[0]) >= 10) ?? sites[1], resetHour: 0, tz: 0 })
  return s
}
const tok = (s: GameState, size: 'big' | 'medium' | 'small', strength = 1) => {
  const id = `t${++n}`
  s.players.ann.tokens.push({ id, size, strength, date: DAY, slot: 0 })
  return id
}
const run = (s: GameState, ev: GameEvent) => { const err = validate(s, world, ev); if (!err) apply(s, world, ev); return err }

describe('splitting actions', () => {
  it('big into medium and small, medium into two small, never a half or a small', () => {
    const s = setup()
    const big = tok(s, 'big')
    expect(run(s, { t: 'split', id: 's1', at: AT, playerId: 'ann', tokenId: big })).toBeNull()
    expect(s.players.ann.tokens.map((t) => t.size).sort()).toEqual(['medium', 'small'])
    const med = s.players.ann.tokens.find((t) => t.size === 'medium')!.id
    run(s, { t: 'split', id: 's2', at: AT, playerId: 'ann', tokenId: med })
    expect(s.players.ann.tokens.map((t) => t.size)).toEqual(['small', 'small', 'small'])
    expect(run(s, { t: 'split', id: 's3', at: AT, playerId: 'ann', tokenId: s.players.ann.tokens[0].id })).toMatch(/small/)
    const half = tok(s, 'big', 0.5)
    expect(run(s, { t: 'split', id: 's4', at: AT, playerId: 'ann', tokenId: half })).toMatch(/half-done/)
  })
})

describe('roads and caravans', () => {
  it('a dirt road is three times as fast, paved nine times', () => {
    const s = setup()
    const ann = s.villages.v_ann, bob = s.villages.v_bob
    const p = s.players.ann
    const wild = caravanMinutes(p, ann, bob, AT, world, s)
    const way = line(ann, bob).map((o) => cellIndex(world, o.col, o.row))
    ann.roads = way
    expect(caravanMinutes(p, ann, bob, AT, world, s)).toBeCloseTo(wild / 3, 0)
    ann.paved = way
    expect(caravanMinutes(p, ann, bob, AT, world, s)).toBeCloseTo(wild / 9, 0)
    expect(wild).toBeGreaterThanOrEqual((way.length - 2) * HEX_MINUTES.road) // most of it overland
  })

  it('costs a medium task cross-country, a small one by road, and nothing on paved road with ox carts', () => {
    const s = setup()
    const ann = s.villages.v_ann, bob = s.villages.v_bob
    ann.goods = { grain: 40 }
    const send = (tokenId: string, id: string) => run(s, { t: 'act', id, at: AT, playerId: 'ann', tokenId, action: 'caravan', col: bob.col, row: bob.row, to: 'v_bob', goods: { grain: 1 }, crew: HEADS, food: { grain: 3 } } as GameEvent)
    expect(caravanTier(world, s, ann, bob)).toBe('medium')
    expect(send(tok(s, 'small'), 'c1')).toMatch(/medium task/)
    const way = line(ann, bob).map((o) => cellIndex(world, o.col, o.row))
    ann.roads = way
    expect(caravanTier(world, s, ann, bob)).toBe('small')
    expect(send(tok(s, 'small'), 'c2')).toBeNull()
    ann.paved = way
    expect(caravanTier(world, s, ann, bob)).toBe('free')
    expect(send(FREE, 'c3')).toMatch(/ox carts/)
    ann.buildings.push({ id: 'st', type: 'stable', col: 0, row: 0, progress: 1 }, { id: 'cs', type: 'cart_shed', col: 0, row: 1, progress: 1 })
    expect(send(FREE, 'c4')).toBeNull()
    expect(send(FREE, 'c5')).toMatch(/oxen are still on the road/)
    // a free pass works only for that caravan
    expect(run(s, { t: 'act', id: 'x', at: AT, playerId: 'ann', tokenId: FREE, action: 'scout', col: 0, row: 0 } as GameEvent)).toMatch(/paved road/)
  })
})

describe('working a building', () => {
  it('runs an extra shift now, if it has what it needs; not on crops', () => {
    const s = setup()
    const v = s.villages.v_ann
    v.buildings.push({ id: 'k', type: 'kiln', col: v.col, row: v.row + 1, progress: 1 }, { id: 'f', type: 'field', col: v.col + 1, row: v.row, progress: 1 })
    v.goods = { clay: 0, timber: 5 }
    const work = (col: number, row: number) => run(s, { t: 'act', id: `w${++n}`, at: AT, playerId: 'ann', tokenId: tok(s, 'small'), action: 'work', col, row } as GameEvent)
    expect(work(v.col, v.row + 1)).toMatch(/needs/)
    v.goods = { clay: 4, timber: 5 }
    expect(work(v.col, v.row + 1)).toBeNull()
    expect(v.goods.bricks).toBeGreaterThan(0)
    expect(work(v.col + 1, v.row)).toMatch(/Crops grow/)
  })
})

describe('tonight', () => {
  it("shows what each good will gain or lose, without spoiling tonight's roll", () => {
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { grain: 10, fish: 5 }
    const before = JSON.stringify(s)
    const t = tonight(s, world, s.players.ann, new Date(AT))
    expect(JSON.stringify(s)).toBe(before) // nothing changed
    const fish = t.rows.find((r) => r.good === 'fish')!
    expect(fish.net[0]).toBeLessThan(0) // eaten and spoiling
  })
})

describe('scouting', () => {
  it('is refused on explored land with nothing new around it, and allowed from the edge', () => {
    const s = setup()
    const v = s.villages.v_ann
    const scout = (id: string, col: number, row: number) => run(s, { t: 'act', id, at: AT, playerId: 'ann', tokenId: tok(s, 'small'), action: 'scout', col, row } as GameEvent)
    // the village sees 4 hexes round it: scouting from its own square shows nothing new
    expect(scoutsNew(world, s, v.col, v.row, 2)).toBe(false)
    expect(scout('c1', v.col, v.row)).toMatch(/Nothing new/)
    // from the edge of what's known, the party sees beyond it
    const edge = { col: v.col + 4, row: v.row }
    expect(scoutsNew(world, s, edge.col, edge.row, 2)).toBe(true)
    expect(scout('c2', edge.col, edge.row)).toBeNull()
    // and once that's uncovered, the same spot is spent
    expect(scoutsNew(world, s, edge.col, edge.row, 2)).toBe(false)
    expect(scout('c3', edge.col, edge.row)).toMatch(/Nothing new/)
  })

  it('sees one hex further with a whole action than with half, and one more with a scout camp', () => {
    const s = setup()
    const v = s.villages.v_ann
    expect(scoutRadius(v, 1)).toBe(3)
    expect(scoutRadius(v, 0.5)).toBe(2)
    v.buildings.push({ id: 'sc', type: 'scout_camp', col: v.col + 1, row: v.row, progress: 1 })
    expect(scoutRadius(v, 1)).toBe(4)
  })
})

describe('building over a building', () => {
  it('pulls the old one down for no action and returns all its materials', async () => {
    const { territoryCells, buildCost, landAt } = await import('./reducer')
    const { hasTrees } = await import('../world/land')
    const s = setup()
    const v = s.villages.v_ann
    const plain = Object.values(BUILDINGS).filter((d) => !d.terrain && !d.resource && !d.needs && !d.nearTerrain && !d.mountain && !d.legacy)
    const [a, b] = plain.filter((d) => d.id !== 'palisade')
    const i = territoryCells(world, v).find((j) => j !== world.cells.findIndex((c) => c.col === v.col && c.row === v.row) && world.cells[j].tier > 0 && !hasTrees(landAt(world, s, j)) && !v.city?.includes(j))
    const c = world.cells[i!]
    v.buildings.push({ id: 'old', type: a.id, col: c.col, row: c.row, progress: 1 })
    v.goods = {}
    const cost = buildCost(v, b, AT)
    // no materials at all: refused, unless the old building's own materials pay for the new
    const enough = Object.entries(buildCost(v, a, AT)).every(([g, n]) => (n ?? 0) >= (cost[g as keyof typeof cost] ?? 0))
    const t = tok(s, b.size)
    const err = run(s, { t: 'act', id: 'b1', at: AT, playerId: 'ann', tokenId: t, action: 'build', building: b.id, col: c.col, row: c.row } as GameEvent)
    if (enough) expect(err).toBeNull(); else expect(err).toMatch(/Needs/)
    v.goods = { timber: 50, stone: 50, planks: 50, copper: 50, bricks: 50 }
    const before = { ...v.goods }
    expect(run(s, { t: 'act', id: 'b2', at: AT, playerId: 'ann', tokenId: t, action: 'build', building: b.id, col: c.col, row: c.row } as GameEvent)).toBeNull()
    expect(v.buildings.filter((x) => x.col === c.col && x.row === c.row).map((x) => x.type)).toEqual([b.id])
    for (const g of Object.keys({ ...cost, ...buildCost(v, a, AT) }) as (keyof typeof before)[]) {
      expect(v.goods[g] ?? 0).toBeCloseTo((before[g] ?? 0) + (buildCost(v, a, AT)[g] ?? 0) - (cost[g] ?? 0), 5)
    }
    // the same kind again is pointless
    expect(run(s, { t: 'act', id: 'b3', at: AT, playerId: 'ann', tokenId: tok(s, b.size), action: 'build', building: b.id, col: c.col, row: c.row } as GameEvent)).toMatch(/already/)
  })
})

describe('sawmills', () => {
  it('saw three times the timber in a shift beside a river, for the same planks per log', async () => {
    const { shift, riverBeside } = await import('./reducer')
    const s = setup()
    const v = s.villages.v_ann
    const land = world.cells.filter((c) => c.tier > 0)
    const wet = land.find((c) => riverBeside(world, c.col, c.row))!
    const dry = land.find((c) => !riverBeside(world, c.col, c.row))!
    const saw = (c: { col: number; row: number }, timber: number) => {
      v.goods = { timber }
      const b = { id: `sw${c.col}_${c.row}`, type: 'sawmill' as const, col: c.col, row: c.row, progress: 1 }
      v.buildings = [b]
      v.jobs = { [b.id]: 1000 }
      const planks = shift(s, world, v, b, 1, DAY, AT).planks ?? 0
      return { planks, used: timber - (v.goods.timber ?? 0) }
    }
    const d = saw(dry, 50), w = saw(wet, 50)
    expect(d.planks).toBeGreaterThan(0)
    expect(w.planks).toBeCloseTo(d.planks * 3, 5)
    expect(w.used).toBeCloseTo(d.used * 3, 5)
    expect(w.planks / w.used).toBeCloseTo(d.planks / d.used, 5)
    // short of logs, the wheel can't make planks out of nothing
    expect(saw(wet, d.used).planks).toBeCloseTo(d.planks, 5)
  })
  it('go up among the trees where a river runs through the woods, with no felling first', async () => {
    const { buildSiteError, landAt } = await import('./reducer')
    const { hasTrees } = await import('../world/land')
    const { neighbours } = await import('../world/hex')
    const s = setup()
    const v = s.villages.v_ann
    const woods = (river: boolean) => world.cells.find((c, i) => c.tier > 0 && (c.riverTo !== -1) === river && hasTrees(landAt(world, s, i))
      && !['rock', 'snow', 'swamp'].includes(landAt(world, s, i).terrain))!
    const at = (c: { col: number; row: number }, def = BUILDINGS.sawmill) => {
      // move the village next door, so the hex is in its land
      const [nc, nr] = neighbours(c.col, c.row).find(([a, b]) => a >= 0 && b >= 0 && a < world.width && b < world.height)!
      v.col = nc; v.row = nr; v.city = []
      return buildSiteError(world, s, v, def, c.col, c.row)
    }
    expect(at(woods(true))).toBeNull()
    expect(at(woods(false))).toMatch(/Fell the trees/)
    // nothing else gets to skip the felling
    expect(at(woods(true), BUILDINGS.granary)).toMatch(/Fell the trees/)
  })
})

describe('colours', () => {
  it('lets a player pick border and villager colours, and put the defaults back', () => {
    const s = setup()
    const c = (rest: object) => ({ t: 'colors', id: `c${++n}`, at: AT, playerId: 'ann', ...rest }) as GameEvent
    expect(run(s, c({ border: 'red' }))).toMatch(/#aabbcc/)
    expect(run(s, c({}))).toMatch(/Pick/)
    expect(run(s, c({ border: '#FF8800', meeple: '#00AA55' }))).toBeNull()
    expect(s.players.ann.colors).toEqual({ border: '#ff8800', meeple: '#00aa55' })
    expect(run(s, c({ border: null }))).toBeNull()
    expect(s.players.ann.colors).toEqual({ meeple: '#00aa55' })
  })
})

describe('docks and shipyards', () => {
  it('go out into the shallows from your own shore, never on land', async () => {
    const { territoryCells, inTerritory } = await import('./reducer')
    const { neighbours } = await import('../world/hex')
    const s = setup()
    const v = s.villages.v_ann
    v.goods = { planks: 100, stone: 100, iron: 100, cloth: 100 }
    const cells = territoryCells(world, v)
    const shallow = cells.find((i) => world.cells[i].terrain === 'shallow' && world.cells[i].tier === 0 && neighbours(world.cells[i].col, world.cells[i].row)
      .some(([c, r]) => c >= 0 && r >= 0 && c < world.width && r < world.height && world.cells[r * world.width + c].tier > 0 && inTerritory(v, c, r)))
    expect(shallow).toBeDefined()
    const sh = world.cells[shallow!]
    const build = (id: string, b: 'docks' | 'shipyard', c: { col: number; row: number }) =>
      run(s, { t: 'act', id, at: AT, playerId: 'ann', tokenId: tok(s, 'big'), action: 'build', building: b, col: c.col, row: c.row } as GameEvent)
    const land = world.cells[cells.find((i) => world.cells[i].tier > 0 && !(world.cells[i].col === v.col && world.cells[i].row === v.row))!]
    expect(build('d0', 'docks', land)).toMatch(/not on land/)
    expect(build('d1', 'docks', sh)).toBeNull()
    expect(v.buildings.some((b) => b.type === 'docks' && b.col === sh.col && b.row === sh.row)).toBe(true)
    // other buildings still stay off the water
    expect(run(s, { t: 'act', id: 'g1', at: AT, playerId: 'ann', tokenId: tok(s, 'medium'), action: 'build', building: 'granary', col: sh.col, row: sh.row } as GameEvent)).toMatch(/Not on water/)
  })
})

describe('what a hex could take', () => {
  it('rules out mines without their ore and docks inland, and keeps what only lacks materials', async () => {
    const { buildSiteError, territoryCells, landAt } = await import('./reducer')
    const s = setup()
    const v = s.villages.v_ann
    const mines = Object.values(BUILDINGS).filter((d) => d.resource?.length)
    expect(mines.length).toBeGreaterThan(0)
    const cells = territoryCells(world, v).filter((i) => world.cells[i].tier > 0 && !(world.cells[i].col === v.col && world.cells[i].row === v.row))
    for (const d of mines) {
      for (const i of cells) {
        const c = world.cells[i]
        const has = d.resource!.includes(landAt(world, s, i).resource as never)
        if (!has) expect(buildSiteError(world, s, v, d, c.col, c.row)).not.toBeNull()
      }
    }
    const docks = BUILDINGS.docks
    const inland = world.cells[cells.find((i) => world.cells[i].tier > 0)!]
    expect(buildSiteError(world, s, v, docks, inland.col, inland.row)).toMatch(/shallows/)
    // short of planks is not a reason to hide a building
    v.goods = {}
    const open = cells.map((i) => world.cells[i]).find((c) => !landAt(world, s, world.cells.indexOf(c)).resource && buildSiteError(world, s, v, BUILDINGS.granary, c.col, c.row) === null)
    expect(open).toBeDefined()
  })
})

describe('winter fuel and peat', () => {
  const SAT = '2026-11-28'
  const winterNight = (s: GameState) => run(s, { t: 'tick', id: `w${++n}`, at: `2026-11-29T00:05:00Z`, playerId: 'ann', date: SAT } as GameEvent)
  it('burns a unit of peat, then wood, for every 100 people, and a cold night costs morale', async () => {
    const { people } = await import('./workers')
    const s = setup()
    const v = s.villages.v_ann
    v.population = 200
    const need = people(v) / 100
    expect(need).toBeGreaterThan(0)
    v.goods = { grain: 50, peat: need / 2, timber: 10 }
    winterNight(s)
    expect(v.goods.peat ?? 0).toBe(0)
    expect(v.goods.timber).toBeCloseTo(10 - need / 2, 1)
    expect(s.log.some((l) => /cold night/.test(l.text))).toBe(false)
    // nothing to burn
    const s2 = setup()
    const w = s2.villages.v_ann
    w.population = 200
    w.goods = { grain: 50 }
    w.morale = 80
    winterNight(s2)
    expect(w.morale).toBeLessThan(80)
    expect(s2.log.some((l) => /cold night/.test(l.text))).toBe(true)
  })
  it('lets you cut peat from swamp in your territory', async () => {
    const { territoryCells, landAt } = await import('./reducer')
    const s = setup()
    const v = s.villages.v_ann
    const i = territoryCells(world, v).find((j) => world.cells[j].tier > 0 && landAt(world, s, j).terrain === 'swamp')
    if (i === undefined) return // no swamp near this village in the test world
    const c = world.cells[i]
    expect(run(s, { t: 'act', id: 'p1', at: AT, playerId: 'ann', tokenId: tok(s, 'small'), action: 'peat', col: c.col, row: c.row } as GameEvent)).toBeNull()
    expect(v.goods.peat).toBe(3)
  })
})

describe('the road planner and wild rice', () => {
  const plan = (s: GameState, at: string, rest: object) => run(s, { t: 'roadplan', id: `rp${++n}`, at, playerId: 'ann', ...rest } as GameEvent)
  it('digs planned hexes in order: a team of 10 lays a hex a day, pro rata by the hour', async () => {
    const { territoryCells } = await import('./reducer')
    const s = setup()
    const v = s.villages.v_ann
    const hexes = territoryCells(world, v).map((i) => world.cells[i]).filter((c) => c.tier > 0 && !v.roads.includes(world.cells.indexOf(c))).slice(0, 3)
    const t0 = `${DAY}T00:00:00Z`
    expect(plan(s, t0, { plan: hexes.map((c) => ({ col: c.col, row: c.row })), crew: 10 })).toBeNull()
    // twelve hours: half a hex, nothing laid yet
    run(s, { t: 'tick', id: `x${++n}`, at: `${DAY}T12:00:00Z`, playerId: 'ann', date: '2026-11-22' } as GameEvent)
    expect(v.roads.length).toBe(0)
    expect(v.roadDone).toBeCloseTo(0.5, 2)
    // a day and a half in: the first is down
    run(s, { t: 'tick', id: `x${++n}`, at: `2026-11-24T12:00:00Z`, playerId: 'ann', date: '2026-11-23' } as GameEvent)
    expect(v.roads).toContain(world.cells.indexOf(hexes[0]))
    expect(v.roadPlan!.length).toBe(2)
    // bigger team, faster; nothing costs goods or actions
    expect(plan(s, `2026-11-24T12:00:00Z`, { crew: 20 })).toBeNull()
    expect(v.roadCrew).toBe(20)
  })
  it('refuses plans on water, outside the territory and teams bigger than the village', () => {
    const s = setup()
    const v = s.villages.v_ann
    const water = world.cells.find((c) => c.tier === 0)!
    expect(plan(s, AT, { plan: [{ col: water.col, row: water.row }] })).toMatch(/land/)
    expect(plan(s, AT, { crew: 100000 })).toMatch(/at most/)
    expect(plan(s, AT, {})).toMatch(/Nothing/)
    expect(v.roadPlan).toBeUndefined()
  })
  it('gathers wild rice from marshes in territory, any season', async () => {
    const { territoryCells, landAt } = await import('./reducer')
    const s = setup()
    const v = s.villages.v_ann
    const i = territoryCells(world, v).find((j) => world.cells[j].tier > 0 && landAt(world, s, j).terrain === 'swamp')
    if (i === undefined) return
    const c = world.cells[i]
    expect(run(s, { t: 'act', id: 'r1', at: AT, playerId: 'ann', tokenId: tok(s, 'small'), action: 'rice', col: c.col, row: c.row } as GameEvent)).toBeNull()
    expect(v.goods.rice).toBe(3)
  })
})
