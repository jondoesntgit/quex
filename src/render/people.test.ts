import { describe, expect, it } from 'vitest'
import { buildRoute, corners, insideHex, routeTime, sample, type RouteHex } from './walk'
import { hexToPixel } from '../world/hex'

const W = 64, TP = 8
// a column of hexes (col 0, rows 0..3) with chosen tiers and buildings
function hexes(tiers: number[], blocked: number[] = []): RouteHex[] {
  return tiers.map((tier, row) => {
    const p = hexToPixel(0, row, W)
    return { cell: row, cx: p.x, cy: p.y, tier, blocked: blocked.includes(row) }
  })
}
const centre = (h: RouteHex) => ({ x: h.cx, y: h.cy })

function poses(hs: RouteHex[], start = centre(hs[0]), end = centre(hs[hs.length - 1])) {
  const route = buildRoute(hs, start, end, W, TP)
  const out = []
  for (let t = 0; t <= routeTime(route) + 1e-9; t += 0.02) out.push(sample(route, t, TP))
  return { route, out }
}

/** The ground point under a pose (tier removed), using the hex it sorts with. */
function onSolidGround(hs: RouteHex[], q: ReturnType<typeof sample>) {
  const h = hs.find((x) => x.cell === q.cell)!
  return insideHex({ x: q.x, y: q.y + h.tier * TP }, h.cx, h.cy, W, 1)
}

describe('villager routes', () => {
  it('walk only on the hex tops they belong to (never in mid-air)', () => {
    const hs = hexes([1, 1, 3, 1]) // up a 2-tier cliff, then down again
    const { out } = poses(hs)
    for (const q of out.filter((q) => q.kind === 'walk')) expect(onSolidGround(hs, q)).toBe(true)
  })
  it('take off a little way back from the edge and stay at ledge height until past it', () => {
    const hs = hexes([3, 1])
    const { route } = poses(hs)
    const hop = route.find((g) => g.kind === 'hop')!
    if (hop.kind !== 'hop') throw new Error('no hop')
    const edge = { x: (hs[0].cx + hs[1].cx) / 2, y: (hs[0].cy + hs[1].cy) / 2 }
    // take-off is on the high hex, clearly short of the edge; landing is inside the low hex
    expect(insideHex(hop.a, hs[0].cx, hs[0].cy, W)).toBe(true)
    expect(Math.hypot(hop.a.x - edge.x, (hop.a.y - edge.y) * 2)).toBeGreaterThan(W * 0.1)
    expect(insideHex(hop.b, hs[1].cx, hs[1].cy, W)).toBe(true)
    // the walk before the hop ends at the take-off point
    const before = route[route.indexOf(hop) - 1]
    expect(before.kind === 'walk' && before.b).toEqual(hop.a)
    // while still over the high hex the jumper is never below its surface
    const start = sample(route, route.slice(0, route.indexOf(hop)).reduce((s, g) => s + g.dur, 0), TP)
    for (let u = 0; u <= hop.over; u += 0.05) {
      const t = route.slice(0, route.indexOf(hop)).reduce((s, g) => s + g.dur, 0) + u * hop.dur
      expect(sample(route, t, TP).y).toBeLessThanOrEqual(start.y + 0.001)
    }
  })
  it('hop: lift, fall the full height, then land', () => {
    const hs = hexes([3, 1])
    const { out } = poses(hs)
    const hop = out.filter((q) => q.kind === 'hop')
    expect(Math.min(...hop.map((q) => q.y))).toBeLessThan(hop[0].y)
    expect(hop.at(-1)!.y - hop[0].y).toBeGreaterThan(2 * TP * 0.8)
    expect(out.some((q) => q.kind === 'land')).toBe(true)
  })
  it('climb straight up the cliff face at the edge, hand over hand', () => {
    const [high, low] = hexes([3, 1]) // row 0 (back) is 2 tiers above row 1 (front)
    const { out } = poses([low, high]) // from the front, up the visible cliff face
    const climb = out.filter((q) => q.kind === 'climb')
    expect(climb.length).toBeGreaterThan(5)
    expect(new Set(climb.map((q) => Math.round(q.x))).size).toBe(1)
    for (let k = 1; k < climb.length; k++) expect(climb[k].y).toBeLessThanOrEqual(climb[k - 1].y)
    expect(climb[climb.length - 1].y - climb[0].y).toBeLessThan(-2 * TP * 0.8)
    // a climber on the visible face sorts with the lower hex in front of it
    expect(climb.every((q) => q.cell === low.cell)).toBe(true)
  })
  it('walk around a building instead of through it', () => {
    // straight down a column through a built-up middle hex
    const hs = hexes([1, 1, 1], [1])
    const { out } = poses(hs)
    const mid = hs[1]
    const through = out.filter((q) => q.cell === 1).map((q) => Math.hypot(q.x - mid.cx, (q.y + TP - mid.cy) * 2))
    expect(Math.min(...through)).toBeGreaterThan(W * 0.25)
    for (const q of out.filter((q) => q.kind === 'walk')) expect(onSolidGround(hs, q)).toBe(true)
  })
  it('flat routes are all walking and end where they were sent', () => {
    const hs = hexes([2, 2, 2])
    const end = { x: hs[2].cx + 5, y: hs[2].cy + 3 }
    const { out } = poses(hs, centre(hs[0]), end)
    expect(out.every((q) => q.kind === 'walk')).toBe(true)
    expect(Math.round(out.at(-1)!.x)).toBe(Math.round(end.x))
  })
  it('hex corners helper is consistent with insideHex', () => {
    const c = corners(100, 100, W)
    for (const p of c) expect(insideHex(p, 100, 100, W)).toBe(true)
    expect(insideHex({ x: 100 + W, y: 100 }, 100, 100, W)).toBe(false)
  })
})

describe('roads', () => {
  it('a route across a road hex follows the track through its centre', () => {
    const hs = hexes([1, 1, 1]).map((h, i) => ({ ...h, road: i === 1 }))
    const off = { x: hs[0].cx + 10, y: hs[0].cy }
    const route = buildRoute(hs, off, { x: hs[2].cx - 10, y: hs[2].cy }, W, TP)
    const mid = hs[1]
    const throughCentre = route.some((g) => g.kind === 'walk' && g.cell === 1 && g.b.x === mid.cx && g.b.y === mid.cy)
    expect(throughCentre).toBe(true)
  })
  it('a startled bounce lifts and lands on the same spot', () => {
    const route: Parameters<typeof sample>[0] = [{ kind: 'bounce', at: { x: 10, y: 20 }, tier: 1, cell: 0, cy: 20, dur: 0.4, height: 5 }]
    expect(sample(route, 0.2, TP).y).toBeLessThan(20 - TP)
    expect(sample(route, 0.2, TP).kind).toBe('hop')
    expect(sample(route, 0.4, TP).y).toBe(20 - TP)
  })
})

describe('villagers and a new road', async () => {
  const { People } = await import('./people')
  const { generateWorld } = await import('../world/generate')
  const { newGame, apply, cellIndex } = await import('../game/reducer')
  const { spiral } = await import('../world/hex')
  it('puffs dust and gets nearby villagers to react', () => {
    const world = generateWorld('test-seed')
    const s = newGame(world, '2026-11-15')
    const site = world.regions[world.startRegion].sites[0]
    apply(s, world, { t: 'join', id: 'j', at: '2026-11-15T08:00:00Z', playerId: 'a', name: 'A', role: site.role, site, resetHour: 0, tz: 0 })
    const revealed = new Set(s.revealed)
    const people = new People(64, 8) as unknown as {
      sync: (w: typeof world, st: typeof s, r: Set<number>) => void
      update: (dt: number) => void
      puffs: unknown[]
      walkers: { react: number | null; route: { kind: string }[] }[]
    }
    people.sync(world, s, revealed)
    expect(people.puffs).toHaveLength(0) // nothing new on first look
    const v = s.villages.v_a
    const road = spiral(v, 1).map((o) => cellIndex(world, o.col, o.row)).find((i) => i !== cellIndex(world, v.col, v.row) && world.cells[i].tier > 0)!
    v.roads.push(road)
    const before = people.walkers.length
    people.sync(world, s, revealed)
    expect(people.walkers.length).toBe(before) // the crowd isn't rebuilt for a road
    expect(people.puffs).toHaveLength(1)
    expect(people.walkers.every((w) => w.react === road)).toBe(true)
    for (let k = 0; k < 400 && people.walkers.some((w) => w.react !== null); k++) people.update(0.05)
    expect(people.walkers.every((w) => w.route[0]?.kind === 'bounce')).toBe(true)
    for (let k = 0; k < 40; k++) people.update(0.05)
    expect(people.puffs).toHaveLength(0) // the puff has drifted away
  })
})

describe('villagers stop to chat', async () => {
  const { People } = await import('./people')
  const { generateWorld } = await import('../world/generate')
  const { newGame, apply } = await import('../game/reducer')
  it('two villagers passing close by sometimes stop, take turns talking, then carry on', () => {
    const world = generateWorld('test-seed')
    const s = newGame(world, '2026-11-15')
    const site = world.regions[world.startRegion].sites[0]
    apply(s, world, { t: 'join', id: 'j', at: '2026-11-15T08:00:00Z', playerId: 'a', name: 'A', role: site.role, site, resetHour: 0, tz: 0 })
    s.villages.v_a.population = 200 // a busy village
    type W = { chat: { with: unknown; until: number } | null; t: number; chatAgain: number }
    const people = new People(64, 8) as unknown as { sync: (...a: unknown[]) => void; update: (dt: number) => void; walkers: W[]; now: () => Date }
    people.now = () => new Date('2026-11-18T12:00:00Z') // a Wednesday: work and chatter
    people.sync(world, s, new Set(s.revealed))
    let chats = 0, frozen = true, mutual = true
    const seen = new Set<unknown>()
    for (let k = 0; k < 20 * 60 * 10; k++) { // ten simulated minutes at 20 fps
      people.update(0.05)
      for (const w of people.walkers) {
        if (!w.chat) continue
        if (!seen.has(w.chat)) { seen.add(w.chat); chats++ }
        const other = w.chat.with as W
        if (other.chat && other.chat.with !== w) mutual = false
      }
      // while chatting, the route clock doesn't move
      const talker = people.walkers.find((w) => w.chat)
      if (talker) { const t = talker.t; people.update(0.05); if (talker.chat && talker.t !== t) frozen = false }
    }
    expect(chats).toBeGreaterThan(1)
    expect(mutual).toBe(true)
    expect(frozen).toBe(true)
    // after chatting, a cooldown keeps them from stopping again straight away
    expect(people.walkers.some((w) => w.chatAgain > 0)).toBe(true)
  }, 30_000)
})

describe('the Sabbath', async () => {
  const { People } = await import('./people')
  const { generateWorld } = await import('../world/generate')
  const { newGame, apply } = await import('../game/reducer')
  it('on Saturday nobody works: everyone has something restful to do, and keeps at it', () => {
    const world = generateWorld('test-seed')
    const s = newGame(world, '2026-11-15')
    const site = world.regions[world.startRegion].sites[0]
    apply(s, world, { t: 'join', id: 'j', at: '2026-11-15T08:00:00Z', playerId: 'a', name: 'A', role: site.role, site, resetHour: 0, tz: 0 })
    s.villages.v_a.population = 200
    type W = { rest: { kind: string; pal?: unknown } | null; working: boolean; pose: { cell: number } | null }
    const people = new People(64, 8) as unknown as { sync: (...a: unknown[]) => void; update: (dt: number) => void; walkers: W[]; now: () => Date }
    people.now = () => new Date('2026-11-21T12:00:00Z') // a Saturday
    people.sync(world, s, new Set(s.revealed))
    expect(people.walkers.length).toBeGreaterThan(2)
    expect(people.walkers.every((w) => w.rest)).toBe(true)
    // walks are in pairs that point at each other
    for (const w of people.walkers) if (w.rest!.kind === 'stroll') expect((w.rest!.pal as W).rest!.pal).toBe(w)
    for (let k = 0; k < 20 * 60 * 3; k++) { // three simulated minutes
      people.update(0.05)
      for (const w of people.walkers) {
        expect(w.working).toBe(false)
        expect(w.pose?.cell ?? 0).toBeGreaterThanOrEqual(0) // always somewhere on the map
      }
    }
    // and on Sunday they're back at work
    people.now = () => new Date('2026-11-22T12:00:00Z')
    people.update(25) // past the next Sabbath check
    expect(people.walkers.every((w) => !w.rest)).toBe(true)
  }, 30_000)
})

describe('villagers in the city', async () => {
  const { People, folkFor } = await import('./people')
  const { generateWorld } = await import('../world/generate')
  const { newGame, apply } = await import('../game/reducer')
  it('one for every ten people, at most 20; they walk from door to door along the lanes', () => {
    expect([1, 10, 11, 25, 200, 900].map(folkFor)).toEqual([1, 1, 2, 3, 20, 20])
    const world = generateWorld('test-seed')
    const s = newGame(world, '2026-11-15')
    const site = world.regions[world.startRegion].sites[0]
    apply(s, world, { t: 'join', id: 'j', at: '2026-11-15T08:00:00Z', playerId: 'a', name: 'A', role: site.role, site, resetHour: 0, tz: 0 })
    s.villages.v_a.population = 150
    type F = { at: number; path: [number, number][]; seg: number; t: number; wait: number; town: { stops: unknown[] } }
    const people = new People(64, 8) as unknown as { sync: (...a: unknown[]) => void; update: (dt: number) => void; folk: F[]; walkers: unknown[]; now: () => Date }
    people.now = () => new Date('2026-11-24T12:00:00Z') // a Tuesday
    people.sync(world, s, new Set(s.revealed))
    expect(people.folk.length + people.walkers.length).toBe(15)
    expect(people.folk.length).toBe(10)
    expect(people.folk[0].town.stops.length).toBeGreaterThanOrEqual(2)
    const visited = people.folk.map(() => new Set<number>())
    let walked = 0
    for (let k = 0; k < 20 * 120; k++) { // two simulated minutes
      people.update(0.05)
      people.folk.forEach((f, i) => { visited[i].add(f.at); if (f.wait <= 0) walked++ })
    }
    expect(walked).toBeGreaterThan(0)
    expect(visited.some((v) => v.size > 1)).toBe(true) // they go somewhere else, door to door
  }, 30_000)
})
