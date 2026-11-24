/** Tiny villagers (about 6×9 px) pottering about each village's land: from
 *  the village square to its buildings, roads and fields, a pause to "work"
 *  in front of the building, then home again. Purely cosmetic and per-device;
 *  never in the event log.
 *
 *  Routes take the least effort through the village's land (climbing costs
 *  more than walking, roads cost less and are followed along the track),
 *  cross between hexes only at the shared edge, go around
 *  buildings, climb cliffs hand over hand and hop down them (see walk.ts).
 *  They sort into the map's painter's order (see MapView rank), so trees,
 *  houses and cliffs in front of them hide them.
 *
 *  A newly built road pops a puff of dust; villagers nearby give a startled
 *  hop, and those whose village it belongs to wander over for a look.
 *
 *  Villagers who cross paths sometimes stop for a natter: they face each
 *  other, gesture, and take turns with a little speech bubble, then carry on.
 *
 *  On the Sabbath (Saturday in the village owner's own day) nobody works:
 *  some go off into nature to read or pray quietly, and the rest gather in
 *  twos and threes to play the fiddle, flute or drum, little notes rising. */
import { Container, Graphics } from 'pixi.js'
import { distance, hexToPixel, neighbours } from '../world/hex'
import { mulberry32, hashString } from '../world/rng'
import type { World } from '../world/types'
import type { GameState, Village } from '../game/types'
import { landAt, territoryCells } from '../game/reducer'
import { isSabbath, playerDate } from '../game/calendar'
import { hasTrees, MOUNTAIN_TERRAIN } from '../world/land'
import { buildRoute, routeTime, sample, type Pose, type Pt, type RouteHex, type Seg } from './walk'
import { bridgeVia } from './waterways'
import { hexAt, SQ, townOf, type Town } from '../game/city'

/** Each village dresses in its own colour (once by role; now by village). */
const SHIRTS = [0xe8c040, 0x4878d8, 0x9a9ab0, 0x3c8c3c, 0xe0e0d0, 0xc04878, 0xd87838, 0x70b0b8]
const shirtFor = (vid: string) => SHIRTS[hashString(`shirt-${vid}`) % SHIRTS.length]
/** a player's own pick (settings), else their village's colour */
const shirtOf = (s: GameState | null, vid: string) => {
  const own = s?.players[s.villages[vid]?.playerId ?? '']?.colors?.meeple
  return own ? parseInt(own.slice(1), 16) : shirtFor(vid)
}
const SKIN = [0xf0c8a0, 0xd8a070, 0xa06840, 0x704828]
const STAND = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', '.oLLo.', '.oLLo.', '.oooo.']
const WALK = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', 'oLooLo', 'oLooLo', 'oooooo']
const WORK_UP = ['.oooo.T', '.oHHoT', '.oHHSo', 'ooSSoo', '.oSSo.', '.oSSo.', '.oLLo.', '.oLLo.', '.oooo.']
const WORK_DOWN = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', '.oSSSo', '.oSSoT', '.oLLoT', '.oLLo.', '.oooo.']
// climbing, seen from behind: hair (D), one hand reaching up; B mirrors A
const CLIMB_A = ['oo....', 'oHoooo', 'oSoDDo', 'ooSDDo', '.oSSSo', '.oSSSo', '.oLLoo', '.oLoLo', '.oooLo', '....oo']
const CLIMB_B = CLIMB_A.map((r) => r.padEnd(6, '.').split('').reverse().join(''))
// mid-hop: arms out, legs apart; then a squashed landing
const HOP = ['.oooo.', '.oHHo.', 'ooHHoo', 'HoSSoH', 'oSSSSo', '.oSSo.', 'oLooLo', 'Lo..oL', 'o....o']
const LAND = ['.oooo.', '.oHHo.', 'ooHHoo', 'oSSSSo', 'oSSSSo', 'oLLLLo', 'oooooo']
const MAX_STEP = 3 // tiers a villager will climb or drop in one go
const ROAD_COST = 0.4 // a road hex costs this much to cross, vs 1 for open land
const REACT_RANGE = 4 // hexes: villagers this close notice a new road
const PUFF_TIME = 0.9 // seconds
const CHAT_RANGE: [number, number] = [5, 11] // px apart (same height) to stop and talk
const CHAT_CHANCE = 0.6 // of stopping when two villagers meet
const CHAT_TIME: [number, number] = [2.5, 5] // seconds
const CHAT_COOLDOWN: [number, number] = [18, 40] // seconds before chatting again
// talking: one hand out, then raised; mirrored when the other villager is on the left
const TALK_A = ['.oooo..', '.oHHo..', '.oHHo..', 'ooSSoo.', 'oSSSSoH', 'ooSSoo.', '.oLLo..', '.oLLo..', '.oooo..']
const TALK_B = ['.oooo..', '.oHHo.H', '.oHHooS', 'ooSSSo.', 'oSSSSo.', 'ooSSoo.', '.oLLo..', '.oLLo..', '.oooo..']
// The Sabbath. Sprites face right (mirrored to face left) or face us;
// `anchor` is the column over the spot they're at.
// Reading: sitting facing us, head bowed (D hair), hands down on an open
// book lying flat on the grass in front of them (W pages with grey lines of
// text, k spine, B red cover showing at the edge); now and then a page lifts
// (TURN_A) and goes over the spine (TURN_B).
const READ = [
  '..oooo...',
  '..oDDo...',
  '..oHHo...',
  '.ooSSoo..',
  '.oSSSSo..',
  'oLLSSLLo.',
  'oLHooHLo.',
  'BWWWkWWWB',
  'BgggkgggB',
  'BWWWkWWWB',
  'BBBBBBBBB',
]
const READ_ANCHOR = 4
const READ_TURN_A = READ.map((r, i) => (i === 6 ? r.slice(0, 6) + 'W' + r.slice(7) : r))
const READ_TURN_B = READ.map((r, i) => (i === 6 ? r.slice(0, 4) + 'W' + r.slice(5) : r))
// Napping on their back in the grass: head on the left (eye shut, k), a hand
// on the chest, one knee up; little Z's drift up from the head (drawn separately).
// About as long as a standing villager is tall.
const NAP = [
  '.ooo..oo..',
  'oDHooooLo.',
  'oDkSHSLoLo',
  'ooooooooDo',
]
const NAP_ANCHOR = 4
// Sitting on the edge of a seaside hex facing us, feet dangling down the bank
// toward the water and swinging; the rows from SHORE_BASE down hang below the rim.
const SHORE_A = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'oLLLLo', 'oLooLo', 'oLooLo', 'oDooDo', 'oo..oo']
// swinging: the lower legs and feet sway a pixel to the side and back (never up)
const SHORE_B = ['.oooo..', '.oHHo..', '.oHHo..', 'ooSSoo.', 'oSSSSo.', 'oLLLLo.', 'oLooLo.', '.oLooLo', '.oDooDo', '.oo..oo']
const SHORE_BASE = 4 // rows below the seat
// On a walk together, one points out something nearby (arm out to the side)
const POINT = ['.oooo....', '.oHHo....', '.oHHooooo', 'ooSSSSSHo', 'oSSSSoooo', 'ooSSoo...', '.oLLo....', '.oLLo....', '.oooo....']
// little Z's rising from a napper; speech bubbles are mostly "...", sometimes "!", now and then a heart
const ZS = [['kkkk', '..k.', '.k..', 'kkkk'], ['kkkkk', '...k.', '..k..', '.k...', 'kkkkk']]
const DOTS = 0, BANG = 1, HEART = 2
/** A bubble's topic from a roll in [0, 1): a heart one time in ten, "!" two in ten, else "...". */
const topicFor = (roll: number) => (roll < 0.1 ? HEART : roll < 0.3 ? BANG : DOTS)
// Praying: kneeling, sitting back on the heels, head bowed forward over hands
// clasped under the chin; faint gold sparkles rise above (drawn separately).
const PRAY = ['..oooo..', '..oHHo..', '.ooHHoo.', 'oSSooHHo', 'oSSSHHo.', 'oSSSSo..', 'oSSLLLLo', 'oooooooo']
const LEGS = ['oSSSSo', 'ooSSoo', '.oLLo.', '.oLLo.', '.oooo.']
// instruments: a guitar across the body (G body, T neck; every band has one),
// fiddle under the chin with a bow (F wood), a flute held out at the mouth
// (I silver), a hand drum at the waist (R shell, W head)
const GUITAR = 0
const PLAY: string[][][] = [
  [
    ['.oooo.....', '.oHHo...oo', '.oHHo..oNo', 'ooSSo.oNHo', 'oSSSSoNo..', 'ooSHGNo...', 'oGGkGGo...', 'oGGGGo....', '.oooo.....'],
    ['.oooo.....', '.oHHo...oo', '.oHHo..oNo', 'ooSSo.oNHo', 'oSSSSoNo..', 'ooSGGNo...', 'oGGkHGo...', 'oGGGGo....', '.oooo.....'],
  ],
  [
    ['.oooo...', '.oHHoFo.', '.oHHFFFo', 'ooSSHFo.', 'oSSSSoTH', 'ooSSooT.', '.oLLo...', '.oLLo...', '.oooo...'],
    ['.oooo...', '.oHHoFo.', '.oHHFFFo', 'ooSSHFoT', 'oSSSSoHT', 'ooSSoo..', '.oLLo...', '.oLLo...', '.oooo...'],
  ],
  [
    ['.oooo....', '.oHHo....', '.oHHIIIIo', 'ooSHoHo..', ...LEGS],
    ['.oooo....', '.oHHo....', '.oHHIIIIo', 'ooSoHoH..', ...LEGS],
  ],
  [
    ['.oooo...', '.oHHo.H.', '.oHHo.o.', 'ooSSooo.', 'oSSSoWWo', 'ooSSoRRo', '.oLLoRRo', '.oLLoooo', '.oooo...'],
    ['.oooo...', '.oHHo...', '.oHHo...', 'ooSSoHo.', 'oSSSoWWo', 'ooSSoRRo', '.oLLoRRo', '.oLLoooo', '.oooo...'],
  ],
]
// a quarter note and an eighth note (k), drawn rising and fading above players
const NOTES = [['..k', '..k', '..k', 'kkk', 'kk.'], ['..kk.', '..k.k', '..k..', 'kkk..', 'kk...']]
const REST_TIME: [number, number] = [25, 55] // seconds at a quiet spot before maybe moving on
const NAP_TIME: [number, number] = [50, 100] // a good long nap, or an afternoon by the water
const STROLL_STOP: [number, number] = [4, 9] // seconds stopped to look at something on a walk
const STROLL_GAP = [5, 1] // where the second walker keeps, beside the leader (px)
const PLAY_TIME: [number, number] = [40, 80] // seconds a band plays before a breather

// speech bubbles above the speaker: "...", a little "!" or a heart
const BUBBLES = [
  ['.ooooooo.', 'oWWWWWWWo', 'oWkWkWkWo', 'oWWWWWWWo', '.oooooWo.', '......o..'],
  ['.ooooo.', 'oWWWWWo', 'oWWkWWo', 'oWWkWWo', 'oWWWWWo', 'oWWkWWo', 'oWWWWWo', '.oooWo.', '....o..'],
  ['.ooooooo.', 'oWrrWrrWo', 'oWrrrrrWo', 'oWWrrrWWo', 'oWWWrWWWo', '.oooooWo.', '......o..'],
]

/** What a villager does on the Sabbath, and where. */
interface Rest {
  kind: 'read' | 'pray' | 'play' | 'nap' | 'shore' | 'stroll'
  cell: number
  p: Pt
  /** instrument (index into PLAY) for players */
  inst: number
  /** face left (toward the band, or just to look the other way) */
  left: boolean
  /** a walk together: the other walker, and who leads (picks where to go) */
  pal?: Walker
  lead?: boolean
  /** the pair have met up and set off */
  met?: boolean
}

interface Walker {
  g: Graphics
  vid: string
  route: Seg[]
  t: number // seconds into the route
  end: number // route length in seconds
  wait: number // seconds left working / resting at the end
  at: { cell: number; p: Pt } // where the current route ends (start of the next)
  working: boolean // pausing at a work spot (tool animation) rather than resting
  rng: () => number
  shirt: number
  skin: number
  idle: number // time accumulator for the work animation
  react: number | null // a new road (cell) to react to at the next safe moment
  chat: { with: Walker; until: number; first: boolean; topic: number } | null
  chatAgain: number // clock time before which this villager won't stop to talk
  pose: Pose | null // last pose (for meeting checks)
  rest: Rest | null // Sabbath plans (null on working days)
  resting: boolean // at the Sabbath spot, reading / praying / playing
  phase: number // offsets the music so a band doesn't play in lockstep
}

/** A villager walking door to door through a city (see city.ts townOf). */
type Gp = [number, number]
interface Folk {
  g: Graphics; vid: string; shirt: number; skin: number; rng: () => number
  town: Town; at: number; path: Gp[]; seg: number; t: number; wait: number
}
/** How many villagers a village shows: one for every ten people (at least one, at most 20). */
export const folkFor = (population: number) => Math.min(20, Math.max(1, Math.ceil(population / 10)))

interface Puff { g: Graphics; cell: number; x: number; y: number; t: number }

interface Plan {
  home: number; spots: number[]; land: Set<number>; blocked: Set<number>
  /** Sabbath: quiet places (clear hexes by the woods, and wooded hexes); clear ground for bands; the wooded ones */
  nature: number[]; open: number[]; woods: Set<number>
  /** hexes whose front edge drops to the water (to sit and dangle feet), and wild places to walk to */
  shore: number[]; wild: number[]
}

export class People {
  private walkers: Walker[] = []
  private folk: Folk[] = []
  private towns = new Map<string, { key: string; town: Town }>()
  private sig = ''
  private world!: World
  private W: number
  private TP: number
  private plans = new Map<string, Plan>()
  private rank: Int32Array = new Int32Array(0)
  private roads = new Set<number>()
  private roadsSeen = false
  private puffs: Puff[] = []
  /** one villager shovelling the hex each road team is on (by village) */
  private diggers = new Map<string, { g: Graphics; cell: number; shirt: number; skin: number }>()
  private clock = 0
  private parent: Container | null = null
  private state: GameState | null = null
  /** village id -> the owner's date when it is their Sabbath (absent otherwise) */
  private sabbath = new Map<string, string>()
  private sabbathCheck = 0
  /** the clock the Sabbath is judged by (tests set their own day) */
  now: () => Date = () => new Date()

  constructor(W: number, TP: number) {
    this.W = W
    this.TP = TP
  }

  /** Graphics owned by the crowd (MapView keeps these when it redraws). */
  nodes() { return [...this.walkers.map((w) => w.g), ...this.folk.map((f) => f.g), ...this.puffs.map((p) => p.g), ...[...this.diggers.values()].map((d) => d.g)] }

  /** Put the crowd into the map container and take its painter's ranks. */
  attach(parent: Container, rank: Int32Array) {
    this.rank = rank
    this.parent = parent
    for (const w of [...this.walkers, ...this.folk]) if (w.g.parent !== parent) parent.addChild(w.g)
    for (const p of this.puffs) if (p.g.parent !== parent) parent.addChild(p.g)
    for (const d of this.diggers.values()) if (d.g.parent !== parent) parent.addChild(d.g)
  }

  /** Rebuild the crowd when villages, population, buildings or outposts change;
   *  new roads only update routes (and get a puff and an audience). */
  sync(world: World, state: GameState, revealed: Set<number>) {
    this.world = world
    this.state = state
    for (const w of [...this.walkers, ...this.folk]) w.shirt = shirtOf(state, w.vid)
    const vs = Object.values(state.villages)
    const roads = new Set(vs.flatMap((v) => v.roads))
    const fresh = this.roadsSeen ? [...roads].filter((r) => !this.roads.has(r)) : []
    const roadsChanged = roads.size !== this.roads.size || fresh.length > 0
    this.roads = roads
    this.roadsSeen = true
    const idx = (col: number, row: number) => row * world.width + col
    this.hubs = new Set(vs.flatMap((v) => [idx(v.col, v.row), ...v.outposts.map((o) => idx(o.col, o.row)), ...v.buildings.map((b) => idx(b.col, b.row))]))
    this.vias.clear()
    const sig = vs.map((v) => `${v.id}:${folkFor(v.population)}:${v.buildings.length}:${v.outposts.length}:${(v.homes ?? []).length}:${(v.city ?? []).length}`).join('|')
    if (sig !== this.sig) {
      this.sig = sig
      for (const w of this.walkers) w.g.destroy()
      this.walkers = []
      for (const f of this.folk) f.g.destroy()
      this.folk = []
      for (const v of vs) this.spawn(world, v, revealed)
      this.sabbath.clear() // fresh crowd: hand out Sabbath plans again
    } else if (roadsChanged) {
      for (const v of vs) this.plans.set(v.id, this.planFor(world, v, revealed))
    }
    for (const r of fresh) this.newRoad(r)
    this.syncDiggers(state)
    this.checkSabbath()
  }

  /** A road team shows as one villager with a shovel on the hex they are digging (the first in the plan). */
  private syncDiggers(state: GameState) {
    const want = new Map<string, number>()
    for (const v of Object.values(state.villages)) if (v.roadPlan?.length && (v.roadCrew ?? 0) > 0) want.set(v.id, v.roadPlan[0])
    for (const [vid, d] of this.diggers) {
      if (want.get(vid) !== d.cell) { d.g.destroy(); this.diggers.delete(vid) } else d.shirt = shirtOf(state, vid)
    }
    for (const [vid, cell] of want) {
      if (this.diggers.has(vid)) continue
      const g = new Graphics()
      this.parent?.addChild(g)
      this.diggers.set(vid, { g, cell, shirt: shirtOf(state, vid), skin: SKIN[hashString(`dig-${vid}`) % SKIN.length] })
    }
  }

  /** Where a village's people may go: its land and roads, and what's worth visiting. */
  private planFor(world: World, v: Village, revealed: Set<number>): Plan {
    const idx = (c: number, r: number) => r * world.width + c
    const home = idx(v.col, v.row)
    const land = new Set(territoryCells(world, v).filter((i) => world.cells[i].tier > 0 && revealed.has(i)))
    for (const i of v.roads) land.add(i)
    land.add(home)
    const blocked = new Set([home, ...v.buildings.map((b) => idx(b.col, b.row)), ...v.outposts.map((o) => idx(o.col, o.row))])
    const spots = [
      ...v.buildings.map((b) => idx(b.col, b.row)),
      ...v.outposts.map((o) => idx(o.col, o.row)),
      ...v.roads,
    ].filter((i) => land.has(i))
    // a few wander spots so a brand-new village still has life
    const rest = [...land].filter((i) => i !== home)
    const rng = mulberry32(hashString(v.id))
    for (let k = 0; k < 3 && rest.length; k++) spots.push(rest[Math.floor(rng() * rest.length)])
    // for the Sabbath: quiet places among the trees (else any open land), and
    // open ground (not a building's hex) where a band can gather
    // bands play on open ground with no trees to hide them; quiet readers and
    // prayers look for the edge of the woods (a clear hex beside trees)
    const open = rest.filter((i) => !blocked.has(i))
    const trees = (i: number) => !!this.state && hasTrees(landAt(world, this.state, i))
    const clear = open.filter((i) => !trees(i))
    // bands: clear ground without rocks, deposits or other things drawn on it
    const bare = this.state ? clear.filter((i) => { const l = landAt(world, this.state!, i); return !l.feature && !l.resource }) : clear
    const byWoods = clear.filter((i) => !v.roads.includes(i) && neighbours(world.cells[i].col, world.cells[i].row)
      .some(([c, r]) => c >= 0 && r >= 0 && c < world.width && r < world.height && trees(r * world.width + c)))
    const woods = open.filter(trees)
    const quiet = [...(byWoods.length ? byWoods : clear.filter((i) => !v.roads.includes(i))), ...woods]
    const shore = clear.filter((i) => {
      const c = world.cells[i]
      const below = c.row + 1 < world.height ? world.cells[idx(c.col, c.row + 1)] : null
      return !!below && below.tier === 0 && c.tier > 0
    })
    const wild = open.filter((i) => trees(i) || MOUNTAIN_TERRAIN.includes(world.cells[i].terrain) || world.cells[i].tier >= 3)
    return {
      home, spots, land, blocked, nature: quiet.length ? quiet : clear, open: bare.length ? bare : clear, woods: new Set(woods),
      shore, wild: wild.length ? wild : open,
    }
  }

  private spawn(world: World, v: Village, revealed: Set<number>) {
    const plan = this.planFor(world, v, revealed)
    this.plans.set(v.id, plan)
    const { home, blocked } = plan
    // one villager for every ten people: a third of them out on the land, the rest in the city
    const all = folkFor(v.population)
    const town = this.townFor(world, v)
    const inTown = town.stops.length >= 2 ? Math.round(all * 2 / 3) || (all === 1 ? 1 : 0) : 0
    const n = all - inTown
    for (let k = 0; k < inTown; k++) this.spawnFolk(v, town, k)
    for (let k = 0; k < n; k++) {
      const r = mulberry32(hashString(`${v.id}-${k}`))
      const w: Walker = {
        g: new Graphics(), vid: v.id, route: [], t: 0, end: 0, wait: r() * 3, working: false, idle: 0, react: null, chat: null, chatAgain: r() * 10, pose: null,
        rest: null, resting: false, phase: r(),
        at: { cell: home, p: this.spot(home, blocked.has(home), r) }, rng: r,
        shirt: shirtOf(this.state, v.id), skin: SKIN[Math.floor(r() * SKIN.length)],
      }
      this.walkers.push(w)
      this.plan(w)
      // start somewhere along the route so they don't all leave home together
      w.t = r() * w.end
    }
  }

  private townFor(world: World, v: Village): Town {
    const key = `${(v.homes ?? []).length}:${(v.city ?? []).length}`
    const had = this.towns.get(v.id)
    if (had && had.key === key) return had.town
    const town = townOf(world, v)
    this.towns.set(v.id, { key, town })
    return town
  }

  private spawnFolk(v: Village, town: Town, k: number) {
    const r = mulberry32(hashString(`${v.id}-town-${k}`))
    const at = Math.floor(r() * town.stops.length)
    this.folk.push({ g: new Graphics(), vid: v.id, shirt: shirtOf(this.state, v.id), skin: SKIN[Math.floor(r() * SKIN.length)], rng: r, town, at, path: [town.stops[at]], seg: 0, t: 0, wait: r() * 6 })
    const f = this.folk[this.folk.length - 1]
    if (this.parent) this.parent.addChild(f.g)
  }

  /** Walk the folk on: pause at a door, then off along the lanes to another. */
  private stepFolk(f: Folk, dt: number) {
    const v = this.state?.villages[f.vid]
    if (!v) return
    if (f.wait > 0) {
      f.wait -= dt
      if (f.wait <= 0) {
        const to = Math.floor(f.rng() * f.town.stops.length)
        const way = to === f.at ? null : f.town.route(f.at, to)
        if (way) { f.path = way; f.seg = 0; f.t = 0; f.at = to } else f.wait = 1 + f.rng() * 3
      }
    } else {
      let move = dt * 14
      while (move > 0 && f.seg < f.path.length - 1) {
        const [a, b] = [f.path[f.seg], f.path[f.seg + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (f.t + move < L) { f.t += move; move = 0 } else { move -= L - f.t; f.seg++; f.t = 0 }
      }
      if (f.seg >= f.path.length - 1) f.wait = 2 + f.rng() * 6
    }
    const a = f.path[f.seg], b = f.path[Math.min(f.seg + 1, f.path.length - 1)]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const walking = f.wait <= 0
    const g: [number, number] = walking ? [a[0] + (b[0] - a[0]) * f.t / L, a[1] + (b[1] - a[1]) * f.t / L] : f.path[f.path.length - 1]
    const i = hexAt(this.world, v, g)
    if (i < 0) return
    const o = hexToPixel(v.col, v.row, this.W)
    const x = Math.round(o.x + g[0]), y = Math.round(o.y + g[1] * SQ - this.world.cells[i].tier * this.TP)
    const r = this.rank[i] ?? -1
    const zi = r * 4 + 3.5
    if (f.g.zIndex !== zi) f.g.zIndex = zi
    this.draw(f, x, y, walking ? 'walk' : 'stand', walking ? Math.floor((f.t + f.seg * 7) / 3) & 1 : 0)
  }

  private hubs = new Set<number>()
  private vias = new Map<number, [number, number][] | null>()
  /** The bridge's ends on a river hex with a road (cached until the roads change). */
  private via(i: number) {
    if (!this.vias.has(i)) this.vias.set(i, bridgeVia(this.world, i, this.W, this.roads, this.hubs))
    return this.vias.get(i)!
  }

  private hex(i: number): RouteHex {
    const c = this.world.cells[i]
    const p = hexToPixel(c.col, c.row, this.W)
    return { cell: i, cx: p.x, cy: p.y, tier: c.tier, blocked: false }
  }

  /** A standing spot in a hex: in front of its building if it has one, else near the middle. */
  private spot(i: number, blocked: boolean, rng: () => number): Pt {
    const h = this.hex(i), W = this.W
    if (blocked) return { x: h.cx + (rng() - 0.5) * W * 0.36, y: h.cy + W * (0.15 + rng() * 0.05) }
    const a = rng() * Math.PI * 2, r = rng() * W * 0.16
    return { x: h.cx + Math.cos(a) * r, y: h.cy + Math.sin(a) * r * 0.5 }
  }

  /** Least-effort route through the village's land (climbing costs extra). */
  private cells(from: number, to: number, land: Set<number>): number[] {
    const world = this.world
    const dist = new Map<number, number>([[from, 0]])
    const prev = new Map<number, number>()
    const open = [from]
    while (open.length) {
      open.sort((a, b) => dist.get(a)! - dist.get(b)!)
      const i = open.shift()!
      if (i === to) break
      const c = world.cells[i]
      for (const [nc, nr] of neighbours(c.col, c.row)) {
        if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
        const j = nr * world.width + nc
        if (!land.has(j)) continue
        const dz = Math.abs(world.cells[j].tier - c.tier)
        if (dz > MAX_STEP) continue
        const d = dist.get(i)! + (this.roads.has(j) ? ROAD_COST : 1) + dz * 1.5
        if (d < (dist.get(j) ?? Infinity)) {
          if (!dist.has(j)) open.push(j)
          dist.set(j, d)
          prev.set(j, i)
        }
      }
    }
    if (!dist.has(to)) return [from]
    const path = [to]
    while (path[0] !== from) path.unshift(prev.get(path[0])!)
    return path
  }

  private plan(w: Walker) {
    const P = this.plans.get(w.vid)!
    w.resting = false
    if (w.rest) return this.planRest(w, P)
    const from = w.at.cell
    const goal = from === P.home && P.spots.length ? P.spots[Math.floor(w.rng() * P.spots.length)] : P.home
    const path = this.cells(from, goal, P.land)
    const dest = path[path.length - 1]
    const end = this.spot(dest, P.blocked.has(dest), w.rng)
    const hexes = path.map((i) => ({ ...this.hex(i), blocked: P.blocked.has(i), road: this.roads.has(i), via: this.via(i) }))
    w.route = buildRoute(hexes, w.at.p, end, this.W, this.TP)
    w.t = 0
    w.end = routeTime(w.route)
    w.at = { cell: dest, p: end }
    w.working = dest !== P.home && P.blocked.has(dest)
  }

  // ------------------------------------------------------------ the Sabbath

  /** Whose Sabbath it is: each village follows its owner's own day. Called on
   *  sync and every 20 s, so the crowd notices Saturday arriving and ending. */
  private checkSabbath() {
    const s = this.state
    if (!s) return
    const now = this.now()
    for (const v of Object.values(s.villages)) {
      const o = s.players[v.playerId]
      const date = o ? playerDate(now, o.resetHour, o.tz) : now.toISOString().slice(0, 10)
      const was = this.sabbath.get(v.id)
      const is = isSabbath(date) ? date : undefined
      if (was === is) continue
      if (is) this.sabbath.set(v.id, is)
      else this.sabbath.delete(v.id)
      this.assignRest(v.id, is)
    }
  }

  /** Hand out Sabbath plans to a village's people (or take them back): about
   *  half play in bands of two or three, the others go off to read or pray. */
  private assignRest(vid: string, date: string | undefined) {
    const ws = this.walkers.filter((w) => w.vid === vid)
    const P = this.plans.get(vid)
    for (const w of ws) { w.rest = null; w.resting = false; w.wait = Math.min(w.wait, 0.5) }
    if (!date || !P) return
    const rng = mulberry32(hashString(`${vid}-sabbath-${date}`))
    const order = [...ws].sort(() => rng() - 0.5)
    const pick = (xs: number[]) => xs[Math.floor(rng() * xs.length)]
    // roughly half play; a pair of villagers either both play or both rest
    const n = order.length
    let band = n === 2 ? (rng() < 0.5 ? 2 : 0) : Math.round(n * (0.35 + rng() * 0.3))
    if (band === 1) band = 2
    while (band >= 2 && order.length >= 2 && P.open.length) {
      const size = band >= 3 && order.length >= 3 && rng() < 0.5 ? 3 : 2
      const cell = pick(P.open)
      const c = this.spot(cell, false, rng)
      // side by side facing in, the third a step behind in the middle
      const seats = size === 2 ? [[-7, 0], [7, 0]] : [[-8, 1], [8, 1], [0, -3]]
      // a guitar, and then the others pick from fiddle, flute and drum
      const others = [1, 2, 3].sort(() => rng() - 0.5)
      for (let k = 0; k < size; k++) {
        const w = order.shift()!
        const [dx, dy] = seats[k]
        w.rest = { kind: 'play', cell, p: { x: c.x + dx, y: c.y + dy }, inst: k === 0 ? GUITAR : others[k - 1], left: dx > 0 }
      }
      band -= size
    }
    // the others: sit by the water, go for a walk together, nap, read or pray
    while (order.length) {
      const w = order.shift()!
      const roll = rng()
      if (P.shore.length && roll < 0.25) {
        const cell = pick(P.shore)
        const h = this.hex(cell)
        // on the front rim, where the bank drops to the water
        w.rest = { kind: 'shore', cell, p: { x: h.cx + (rng() - 0.5) * this.W * 0.3, y: h.cy + this.W / 4 - 1 }, inst: 0, left: false }
      } else if (order.length && roll < 0.55) {
        const pal = order.shift()!
        const cell = pick(P.nature.length ? P.nature : P.open.length ? P.open : [P.home])
        const p = this.spot(cell, false, rng)
        w.rest = { kind: 'stroll', cell, p, inst: 0, left: false, pal, lead: true }
        pal.rest = { kind: 'stroll', cell, p: { x: p.x + STROLL_GAP[0], y: p.y + STROLL_GAP[1] }, inst: 0, left: true, pal: w, lead: false }
      } else {
        const cell = pick(P.nature.length ? P.nature : [P.home])
        const kind = roll < 0.7 ? 'nap' : roll < 0.85 ? 'read' : 'pray'
        w.rest = { kind, cell, p: this.quietSpot(cell, P, rng), inst: 0, left: rng() < 0.5 }
      }
    }
  }

  /** A quiet place in a hex: in the woods, at the front edge in front of the
   *  trees (never in among them); on clear ground, anywhere near the middle. */
  private quietSpot(cell: number, P: Plan, rng: () => number): Pt {
    if (!P.woods.has(cell) && !P.blocked.has(cell)) return this.spot(cell, false, rng)
    const h = this.hex(cell)
    return { x: h.cx + (rng() - 0.5) * this.W * 0.3, y: h.cy + this.W * (0.18 + rng() * 0.04) }
  }

  /** Walk to the Sabbath spot (a quiet reader or napper may move on to another). */
  private planRest(w: Walker, P: Plan): void {
    const r = w.rest!
    if (r.kind === 'stroll') return this.planStroll(w, P)
    if ((r.kind === 'read' || r.kind === 'pray' || r.kind === 'nap') && w.at.cell === r.cell && w.rng() < 0.4 && P.nature.length) {
      const cell = P.nature[Math.floor(w.rng() * P.nature.length)]
      w.rest = { ...r, cell, p: this.quietSpot(cell, P, w.rng), left: w.rng() < 0.5 }
    }
    this.goTo(w, P, w.rest!.cell, w.rest!.p)
  }

  /** Route a resting villager to a spot (or the nearest place they can reach). */
  private goTo(w: Walker, P: Plan, cell: number, end: Pt) {
    const path = this.cells(w.at.cell, cell, P.land)
    const dest = path[path.length - 1]
    const hexes = path.map((i) => ({ ...this.hex(i), blocked: P.blocked.has(i), road: this.roads.has(i), via: this.via(i) }))
    // couldn't get there: stay where the path ends (a nearby spot) instead
    const goal = dest === cell ? end : this.spot(dest, P.blocked.has(dest), w.rng)
    w.route = buildRoute(hexes, w.at.p, goal, this.W, this.TP)
    w.t = 0
    w.end = routeTime(w.route)
    w.at = { cell: dest, p: goal }
    if (w.rest) { w.rest.cell = dest; w.rest.p = goal }
    w.working = false
    if (w.end <= 0) { w.resting = true; w.wait = this.restTime(w) }
  }

  /** A walk for two through the woods and hills: meet up, then the leader
   *  picks somewhere wild and they go side by side, chatting; at each stop the
   *  leader points something out. The second walker follows the leader's route. */
  private planStroll(w: Walker, P: Plan): void {
    const r = w.rest!
    const pal = r.pal
    if (!pal || pal.rest?.kind !== 'stroll' || pal.rest.pal !== w) {
      // walking partner gone (crowd rebuilt): a quiet read instead
      w.rest = { ...r, kind: 'read', pal: undefined, lead: false }
      return this.planRest(w, P)
    }
    const hold = () => { w.route = []; w.t = 0; w.end = 0; w.resting = true; w.wait = 0.6 }
    if (!r.met && w.at.cell !== r.cell) return this.goTo(w, P, r.cell, r.p) // go and meet
    if (!r.lead) return hold() // the leader takes us along
    if (pal.t < pal.end || pal.at.cell !== w.at.cell) return hold() // wait for them
    r.met = pal.rest.met = true
    const cell = P.wild[Math.floor(w.rng() * P.wild.length)]
    this.goTo(w, P, cell, this.quietSpot(cell, P, w.rng))
    r.left = w.rng() < 0.5 // which way to point at the next stop
    const [gx, gy] = STROLL_GAP
    const shift = (q: Pt) => ({ x: q.x + gx, y: q.y + gy })
    pal.route = w.route.map((g) => {
      const c: Seg = { ...g } as Seg
      if ('a' in c) c.a = shift(c.a)
      if ('b' in c) c.b = shift(c.b)
      if ('at' in c) c.at = shift(c.at)
      return c
    })
    pal.t = 0
    pal.end = w.end
    pal.wait = 0
    pal.resting = false
    pal.at = { cell: w.at.cell, p: shift(w.at.p) }
    pal.rest = { ...pal.rest, cell: w.at.cell, p: pal.at.p, met: true }
    if (w.end <= 0) { pal.resting = true; pal.wait = w.wait }
  }

  private restTime(w: Walker) {
    const k = w.rest?.kind
    const [a, b] = k === 'play' ? PLAY_TIME : k === 'stroll' ? STROLL_STOP : k === 'nap' || k === 'shore' ? NAP_TIME : REST_TIME
    return a + w.rng() * (b - a)
  }

  // ------------------------------------------------------------ new roads

  private newRoad(cell: number) {
    const h = this.hex(cell)
    const g = new Graphics()
    this.parent?.addChild(g)
    this.puffs.push({ g, cell, x: h.cx, y: h.cy - h.tier * this.TP, t: 0 })
    const c = this.world.cells[cell]
    for (const w of this.walkers) {
      const at = this.world.cells[w.at.cell]
      if (distance(at, c) <= REACT_RANGE + 1) w.react = cell
    }
  }

  /** Startled hop on the spot, then (if it's our village's road) go and look. */
  private reactTo(w: Walker, road: number, pose: Pose) {
    const P = this.plans.get(w.vid)
    if (!P) return
    const here = this.world.cells[pose.cell]
    if (!here || distance(here, this.world.cells[road]) > REACT_RANGE) return
    const h = this.hex(pose.cell)
    const ground = { x: pose.x, y: pose.y + h.tier * this.TP }
    const segs: Seg[] = [{ kind: 'bounce', at: ground, tier: h.tier, cell: pose.cell, cy: h.cy, dur: 0.38, height: 5 }]
    w.at = { cell: pose.cell, p: ground }
    if (P.land.has(road) && P.land.has(pose.cell)) {
      const path = this.cells(pose.cell, road, P.land)
      if (path[path.length - 1] === road) {
        const r = this.hex(road)
        // stand beside the new track and admire it
        const end = { x: r.cx + (w.rng() - 0.5) * this.W * 0.3, y: r.cy + this.W * (0.08 + w.rng() * 0.06) }
        const hexes = path.map((i) => ({ ...this.hex(i), blocked: P.blocked.has(i) && i !== road, road: this.roads.has(i), via: this.via(i) }))
        segs.push({ kind: 'pause', at: ground, tier: h.tier, cell: pose.cell, cy: h.cy, dur: 0.25 + w.rng() * 0.3, pose: 'stand' })
        segs.push(...buildRoute(hexes, ground, end, this.W, this.TP))
        w.at = { cell: road, p: end }
      }
    }
    w.route = segs
    w.t = 0
    w.end = routeTime(segs)
    w.working = false
  }

  private drawPuff(p: Puff) {
    const g = p.g
    g.clear()
    const u = p.t / PUFF_TIME
    const r = this.rank[p.cell] ?? -1
    g.zIndex = r * 4 + 3.8
    // four chunky dust blobs bursting out and up, then thinning away
    const blobs = [[-1, -0.2], [1, -0.3], [-0.4, -1], [0.5, -0.9]]
    const spread = this.W * 0.16 * Math.sqrt(u)
    const size = Math.max(1, Math.round(2 + u * 3))
    const alpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4
    for (const [bx, by] of blobs) {
      const x = Math.round(p.x + bx * spread - size / 2)
      const y = Math.round(p.y + by * spread * 0.8 - u * 4 - size / 2)
      g.rect(x, y, size, size).fill({ color: u < 0.3 ? 0xf8f0e0 : 0xc8b8a0, alpha })
      g.rect(x + 1, y + size - 1, Math.max(1, size - 2), 1).fill({ color: 0x8a7860, alpha: alpha * 0.8 })
    }
  }

  /** Two villagers on the ground, close together at the same height, may stop to talk. */
  private meetings() {
    const free = this.walkers.filter((w) => !w.chat && !w.rest && w.pose && w.chatAgain <= this.clock &&
      (w.pose.kind === 'walk' || w.pose.kind === 'stand') && w.react === null)
    for (let i = 0; i < free.length; i++) {
      const a = free[i]
      if (a.chat) continue
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j]
        if (b.chat) continue
        const pa = a.pose!, pb = b.pose!
        if (pa.kind === 'stand' && pb.kind === 'stand') continue // someone has to be passing by
        if (this.world.cells[pa.cell].tier !== this.world.cells[pb.cell].tier) continue
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
        if (d < CHAT_RANGE[0] || d > CHAT_RANGE[1]) continue
        // either way they're not stopping again for a while after this meeting
        const later = this.clock + CHAT_COOLDOWN[0] + a.rng() * (CHAT_COOLDOWN[1] - CHAT_COOLDOWN[0])
        a.chatAgain = b.chatAgain = later
        if (a.rng() > CHAT_CHANCE) continue
        const until = this.clock + CHAT_TIME[0] + a.rng() * (CHAT_TIME[1] - CHAT_TIME[0])
        a.chat = { with: b, until, first: true, topic: topicFor(a.rng()) }
        b.chat = { with: a, until, first: false, topic: topicFor(a.rng()) }
        a.chatAgain = b.chatAgain = until + (later - this.clock)
        break
      }
    }
  }

  update(dt: number) {
    if (!this.world) return
    this.clock += dt
    this.sabbathCheck -= dt
    if (this.sabbathCheck <= 0) { this.sabbathCheck = 20; this.checkSabbath() }
    for (const p of this.puffs) { p.t += dt; this.drawPuff(p) }
    for (const p of this.puffs.filter((x) => x.t >= PUFF_TIME)) p.g.destroy()
    this.puffs = this.puffs.filter((x) => x.t < PUFF_TIME)
    for (const d of this.diggers.values()) {
      const h = this.hex(d.cell)
      d.g.zIndex = (this.rank[d.cell] ?? -1) * 4 + 3.5
      this.draw(d, Math.round(h.cx), Math.round(h.cy - h.tier * this.TP + this.W * 0.1), 'work', Math.floor(this.clock * 2.2) & 1)
    }
    for (const f of this.folk) this.stepFolk(f, dt)
    for (const w of this.walkers) {
      let pose: Pose
      // react only with both feet on the ground (not mid-climb or mid-hop)
      if (w.react !== null) {
        const now = w.t < w.end ? sample(w.route, w.t, this.TP) : null
        if (!now || now.kind === 'walk' || now.kind === 'stand' || now.kind === 'work') {
          const h = this.hex(w.at.cell)
          const p = now ?? { x: w.at.p.x, y: w.at.p.y - h.tier * this.TP, cell: w.at.cell, front: true, kind: 'stand' as const, dist: 0 }
          const road = w.react
          w.react = null
          // a new road beats a chat: both break off
          if (w.chat) { if (w.chat.with.chat?.with === w) w.chat.with.chat = null; w.chat = null }
          this.reactTo(w, road, p)
          w.wait = 0
        }
      }
      if (w.chat && this.clock < w.chat.until && w.react === null) {
        // stopped mid-route for a chat: hold the spot, the route waits
        const at = w.pose ?? sample(w.route, w.t, this.TP)
        pose = { ...at, kind: 'stand' }
        w.idle += dt
        w.pose = pose
        this.place(w, pose)
        this.draw(w, Math.round(pose.x), Math.round(pose.y), 'stand', 0, this.talking(w))
        continue
      }
      if (w.chat) w.chat = null
      if (w.t < w.end) {
        w.t = Math.min(w.end, w.t + dt)
        pose = sample(w.route, w.t, this.TP)
        if (w.t >= w.end) {
          w.resting = !!w.rest && w.at.cell === w.rest.cell
          w.wait = w.resting ? this.restTime(w) : w.working ? 2 + w.rng() * 4 : 1 + w.rng() * 3
        }
      } else if (w.wait > 0) {
        w.wait -= dt
        w.idle += dt
        const h = this.hex(w.at.cell)
        // resting counts as busy ('work'), so nobody stops them for a chat
        pose = { x: w.at.p.x, y: w.at.p.y - h.tier * this.TP, cell: w.at.cell, front: w.at.p.y > h.cy, kind: w.working || w.resting ? 'work' : 'stand', dist: 0 }
        if (w.resting && w.rest) {
          w.pose = pose
          this.place(w, pose)
          this.drawRest(w, Math.round(pose.x), Math.round(pose.y), w.rest)
          continue
        }
      } else {
        this.plan(w)
        // already there (an empty route): stand on the spot rather than nowhere
        const h = this.hex(w.at.cell)
        pose = w.end > 0 ? sample(w.route, 0, this.TP)
          : { x: w.at.p.x, y: w.at.p.y - h.tier * this.TP, cell: w.at.cell, front: w.at.p.y > h.cy, kind: w.resting ? 'work' : 'stand', dist: 0 }
      }
      w.pose = pose
      this.place(w, pose)
      // feet step every 3 px walked; hands alternate every 2 px climbed; tools swing twice a second
      const step = pose.kind === 'walk' ? Math.floor(pose.dist / 3) & 1
        : pose.kind === 'climb' ? Math.floor(pose.dist / 2) & 1
        : Math.floor(w.idle * 2) & 1
      this.draw(w, Math.round(pose.x), Math.round(pose.y), pose.kind, step)
      // walking together: they chat as they go
      if (w.rest?.kind === 'stroll' && w.rest.met && w.t < w.end) this.strollTalk(w, Math.round(pose.x), Math.round(pose.y) - 8)
    }
    this.meetings()
  }

  private place(w: Walker, pose: Pose) {
    const r = this.rank[pose.cell] ?? -1
    const zi = r * 4 + (pose.front ? 3.5 : 2)
    if (w.g.zIndex !== zi) w.g.zIndex = zi
  }

  /** Who's speaking right now: partners take turns every ~0.9 s. */
  private talking(w: Walker): { mirror: boolean; speaking: boolean; topic: number; gesture: number } {
    const c = w.chat!
    const turn = Math.floor((c.until - this.clock) / 0.9) & 1
    const speaking = c.first ? turn === 0 : turn === 1
    const other = c.with.pose
    const mirror = !!other && !!w.pose && other.x < w.pose.x
    return { mirror, speaking, topic: c.topic, gesture: speaking ? Math.floor(this.clock * 3) & 1 : 0 }
  }

  /** A walk's chatter: the pair take turns, with pauses, mostly "..." and a
   *  heart now and then; the bubble leans toward the other walker. */
  private strollTalk(w: Walker, x: number, top: number) {
    const r = w.rest!
    const beat = Math.floor((this.clock + (r.lead ? 0 : 0)) / 1.2)
    const speaker = beat % 4 === 0 ? r.lead : beat % 4 === 2 ? !r.lead : null
    if (speaker !== true) return
    const pal = r.pal?.pose, me = w.pose
    const mirror = !!pal && !!me && pal.x < me.x
    const topic = topicFor((((beat * 2654435761) >>> 0) % 1000) / 1000)
    const b = BUBBLES[topic]
    b.forEach((rowStr, ry) => {
      for (let c = 0; c < rowStr.length; c++) {
        const ch = rowStr[c]
        if (ch !== '.') w.g.rect(x + (mirror ? -b[0].length + 1 : 0) + c, top - b.length - 1 + ry, 1, 1).fill(ch === 'W' ? 0xffffff : ch === 'r' ? 0xe04858 : 0x1c1828)
      }
    })
  }

  /** Reading, praying or playing on the Sabbath, feet at (x, y); players have
   *  notes drifting up and fading. */
  private drawRest(w: Walker, x: number, y: number, r: Rest) {
    const t = this.clock + w.phase * 10
    // a page turns every 7 s or so: up (0.3 s), over (0.3 s), down
    const turn = (t % 7) / 0.3
    // the second walker on a stroll faces the leader, who points at something
    const facePal = r.kind === 'stroll' && !r.lead && r.pal?.pose && w.pose ? r.pal.pose.x < w.pose.x : r.left
    let fig = r.kind === 'read' ? (turn < 1 ? READ_TURN_A : turn < 2 ? READ_TURN_B : READ)
      : r.kind === 'pray' ? PRAY
      : r.kind === 'nap' ? NAP
      : r.kind === 'shore' ? (Math.floor(t * 1.2) & 1 ? SHORE_B : SHORE_A) // feet swinging
      : r.kind === 'stroll' ? (r.lead && r.met ? POINT : STAND)
      : PLAY[r.inst][Math.floor(t * (r.inst === 3 ? 4 : 3)) & 1]
    const width = Math.max(...fig.map((row) => row.length))
    const anchor = r.kind === 'read' ? READ_ANCHOR : r.kind === 'nap' ? NAP_ANCHOR : 3
    const left = r.kind === 'stroll' && !r.lead ? facePal : r.left
    let dx = -anchor
    if (left) { fig = fig.map((row) => row.padEnd(width, '.').split('').reverse().join('')); dx = -(width - 1 - anchor) }
    const col: Record<string, number> = {
      o: 0x1c1828, H: w.skin, S: w.shirt, L: 0x5a4630, T: 0xa08050, W: 0xf8f4e8, B: 0xb03838, D: 0x4a3020, g: 0x9a9488,
      F: 0xb06830, I: 0xd8d8e8, R: 0xc04838, k: 0x1c1828, G: 0xd88838, N: 0x5a3418,
    }
    const g = w.g
    g.clear()
    // the shore-sitter's legs hang below the rim they sit on
    const top = y - fig.length + 1 + (r.kind === 'shore' ? SHORE_BASE : 0)
    fig.forEach((rowStr, ry) => {
      for (let c = 0; c < rowStr.length; c++) if (rowStr[c] !== '.') g.rect(x + dx + c, top + ry, 1, 1).fill(col[rowStr[c]])
    })
    if (r.kind === 'nap') {
      // Z's drift up and away from the sleeper's head, growing as they go
      const hx = x + dx + (left ? width - 3 : 2)
      for (let i = 0; i < 2; i++) {
        const ph = (this.clock / 3 + w.phase + i / 2) % 1
        const z = ZS[ph < 0.45 ? 0 : 1]
        const zx = Math.round(hx + (left ? 1 : -1) * ph * 5) - (left ? 0 : z[0].length - 1)
        const zy = Math.round(top - 2 - ph * 11) - z.length
        const alpha = Math.sin(ph * Math.PI)
        z.forEach((rowStr, ry) => {
          for (let c = 0; c < rowStr.length; c++) if (rowStr[c] === 'k') g.rect(zx + c, zy + ry, 1, 1).fill({ color: 0xf8f4e8, alpha })
        })
      }
      return
    }
    if (r.kind === 'stroll' && !r.lead && r.pal) this.strollTalk(w, x, top)
    if (r.kind === 'read') {
      // every so often the book gets to them: a "!" or a heart for a moment
      const cycle = Math.floor(t / 11)
      if (t % 11 > 9.7) {
        const b = BUBBLES[((cycle * 2654435761) >>> 0) % 2 ? HEART : BANG]
        b.forEach((rowStr, ry) => {
          for (let c = 0; c < rowStr.length; c++) {
            const ch = rowStr[c]
            if (ch !== '.') g.rect(x + c - 1, top - b.length - 1 + ry, 1, 1).fill(ch === 'W' ? 0xffffff : ch === 'r' ? 0xe04858 : 0x1c1828)
          }
        })
      }
    }
    if (r.kind === 'pray') {
      // three faint gold sparkles drifting slowly up from the joined hands
      for (let i = 0; i < 3; i++) {
        const ph = (this.clock / 3.6 + w.phase + i / 3) % 1
        const sx = Math.round(x + (r.left ? -2 : 2) + Math.sin((ph + i) * Math.PI * 2) * 1.5)
        const sy = Math.round(top - 1 - ph * 10)
        const alpha = Math.sin(ph * Math.PI) * 0.9
        g.rect(sx, sy, 1, 1).fill({ color: 0xf8e070, alpha })
        if (ph > 0.3 && ph < 0.6) { // a brief twinkle: a little plus
          g.rect(sx - 1, sy, 3, 1).fill({ color: 0xf8e070, alpha: alpha * 0.6 })
          g.rect(sx, sy - 1, 1, 3).fill({ color: 0xf8e070, alpha: alpha * 0.6 })
        }
      }
      return
    }
    if (r.kind !== 'play') return
    // two notes at a time, rising about 12 px over 2.4 s with a little sway
    for (let i = 0; i < 2; i++) {
      const ph = (this.clock / 2.4 + w.phase + i / 2) % 1
      const note = NOTES[(i + Math.floor(this.clock / 2.4 + w.phase + i / 2)) & 1]
      const side = r.left ? -1 : 1
      const nx = Math.round(x + side * (3 + ph * 4) + Math.sin(ph * Math.PI * 2) * 1.5) - 1
      const ny = Math.round(top - 3 - ph * 12) - note.length
      const alpha = ph < 0.6 ? 1 : (1 - ph) / 0.4
      note.forEach((rowStr, ry) => {
        for (let c = 0; c < rowStr.length; c++) if (rowStr[c] === 'k') g.rect(nx + c, ny + ry, 1, 1).fill({ color: 0x1c1828, alpha })
      })
    }
  }

  /** 6×9 px villager, feet at (x, y). Rows top to bottom; o outline, H skin,
   *  S shirt, L legs, T tool. */
  private draw(w: Pick<Walker, 'g' | 'shirt' | 'skin'>, x: number, y: number, kind: Pose['kind'], step: number,
    talk?: { mirror: boolean; speaking: boolean; topic: number; gesture: number }) {
    let fig = talk ? (talk.gesture ? TALK_B : TALK_A)
      : kind === 'work' ? (step ? WORK_UP : WORK_DOWN)
      : kind === 'walk' ? (step ? WALK : STAND)
      : kind === 'climb' ? (step ? CLIMB_B : CLIMB_A)
      : kind === 'hop' ? HOP : kind === 'land' ? LAND : STAND
    // mirrored talk poses are 7 wide with the body on the right: shift left one
    let dx = -3
    if (talk?.mirror) { fig = fig.map((r) => r.padEnd(7, '.').split('').reverse().join('')); dx = -4 }
    const col: Record<string, number> = { o: 0x1c1828, H: w.skin, S: w.shirt, L: 0x5a4630, T: 0xa08050, D: 0x4a3020, W: 0xffffff, k: 0x1c1828, r: 0xe04858 }
    const g = w.g
    g.clear()
    const top = y - fig.length + 1
    const paint = (rows: string[], ox: number, oy: number) => rows.forEach((rowStr, r) => {
      for (let c = 0; c < rowStr.length; c++) {
        const ch = rowStr[c]
        if (ch !== '.') g.rect(ox + c, oy + r, 1, 1).fill(col[ch])
      }
    })
    paint(fig, x + dx, top)
    if (talk?.speaking) {
      const b = BUBBLES[talk.topic % BUBBLES.length]
      // above the head, leaning toward the listener
      paint(b, x + (talk.mirror ? -b[0].length + 1 : 0), top - b.length - 1)
    }
  }
}
