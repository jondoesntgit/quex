/** Battles, fought out in detail on a grid with simplified 5e rules. Players see only the outcome, the battle
 *  report (a line for what happened, in our voice: "we" and "they") and, where we show it, a replay.
 *  Our side is always on the left. See BookStack, Quex › Game Mechanics › Battles: Kit, Stages and Outcomes.
 *
 *  Every fighter is a token on a W x H field (big ones fill 2x2) with armour class, hit points, attacks and a
 *  damage roll. Each round, in a shuffled order, a fighter strikes a foe in reach (d20 + to-hit against AC),
 *  shoots one if it has a bow and nobody is in reach, or walks towards the nearest foe (rear ranks walk round,
 *  so the bigger side wraps the smaller). House rules 5e lacks: flanking (advantage on a foe with two or more
 *  of your side next to it) and nerve (when a side has a third down, and every sixth after, each fighter saves
 *  on Wisdom or runs). At 0 HP a fighter is down, not dead: winners carry theirs home and most live (wounded).
 *
 *  A stockade is a ring of logs with a gate. The logs can't be hacked down in a fight; a ram breaks the gate.
 *  Defenders stand on a fighting step behind the logs (three-quarters cover, +5) and strike down at anyone
 *  at the foot of the wall; from below only spears and pitchforks reach them. Ladders get a soldier over,
 *  but every defender in reach gets a free swing (with advantage) at the climber.
 *
 *  Monsters: orcs (a band with a chief), goblins (small, quick, shoot and slip away, easily scared), a troll
 *  (big and strong: three blows a round), a dragon (big, flies out of reach of anything but bows and ballistae,
 *  roars, breathes fire in a cone, flies off when badly hurt, and keeps its wounds for next time).
 *
 *  Raids on a village: `raid` turns it round. The orcs come at the village's palisade from outside, with ladders
 *  (and a ram, from a big camp); the villagers hold the fighting step, defending their homes (steadier nerve).
 *  If the orcs win, the palisade falls (and its armoury with it).
 *
 *  Pure and seeded. `record` keeps a frame a round for the replay viewer. */
import type { Rng } from '../world/rng'

export const W = 48, H = 30
export type Weapon = 'none' | 'spear' | 'sword' | 'bow' | 'axe' | 'ballista'
export type Body = 'none' | 'jerkin' | 'hide' | 'mail'
export interface Kit { weapon: Weapon; body: Body; helmet: boolean; shield: boolean }
export type FoeKind = 'orcs' | 'goblins' | 'troll' | 'dragon'

/** House-rule numbers, all in one place for tuning. */
export const RULES = {
  villager: { hp: 11, hit: 3, dmg: 1, wis: 1 },
  /** damage die by weapon (pitchfork/club for none) */
  die: { none: 6, spear: 8, sword: 8, bow: 6, axe: 12, ballista: 10 } as Record<Weapon, number>,
  ac: { none: 10, jerkin: 11, hide: 12, mail: 16 } as Record<Body, number>,
  shield: 2, helmet: 1, cover: 5,
  flank: 2, speed: 6, bowRange: 24,
  nerveDC: 10, nerveFirst: 1 / 3, nerveStep: 1 / 6, homeNerve: 2, chiefNerve: 2,
  gateHp: 30, rams: 4, // the ram's crew, each striking the gate for a d10
  liveWin: 4, liveLoss: 11, // d20 at or above: a downed fighter lives (about 1 in 7 of the fallen is lost for good)
  rounds: 40,
}
interface Stat { hp: number; ac: number; hit: number; nd: number; die: number; dmg: number; multi: number; wis: number; size: number; speed: number; ranged?: boolean }
export const MONSTERS: Record<string, Stat> = {
  orc: { hp: 11, ac: 13, hit: 4, nd: 1, die: 12, dmg: 1, multi: 1, wis: 1, size: 1, speed: 6 },
  orcArcher: { hp: 11, ac: 13, hit: 4, nd: 1, die: 6, dmg: 1, multi: 1, wis: 1, size: 1, speed: 6, ranged: true },
  chief: { hp: 30, ac: 15, hit: 6, nd: 1, die: 12, dmg: 4, multi: 1, wis: 3, size: 1, speed: 6 },
  goblin: { hp: 7, ac: 13, hit: 3, nd: 1, die: 6, dmg: 2, multi: 1, wis: -1, size: 1, speed: 6 },
  goblinArcher: { hp: 7, ac: 12, hit: 3, nd: 1, die: 6, dmg: 2, multi: 1, wis: -1, size: 1, speed: 6, ranged: true },
  boss: { hp: 21, ac: 17, hit: 4, nd: 1, die: 6, dmg: 2, multi: 2, wis: 1, size: 1, speed: 6 },
  troll: { hp: 84, ac: 15, hit: 7, nd: 2, die: 6, dmg: 4, multi: 3, wis: 0, size: 2, speed: 6 },
  dragon: { hp: 150, ac: 18, hit: 8, nd: 2, die: 8, dmg: 4, multi: 3, wis: 4, size: 2, speed: 8 },
}
export const DRAGON = { fly: 16, breathLen: 6.5, breathDice: 6, breathDC: 14, roarDC: 10, leaveAt: 0.5 }
const BALLISTA = { hp: 25, ac: 13, hit: 6, nd: 3, die: 10, dmg: 0 }

export type St = 0 | 1 | 2 | 3 | 4 | 5 // fighting, running, down, gone (fled or flew off), flying, taken prisoner
export interface U {
  id: number; side: 0 | 1; kind: string; s: number; x: number; y: number; hp: number; max: number; ac: number; hit: number; nd: number; die: number; dmg: number; multi: number; wis: number; speed: number
  ranged: boolean; reachy: boolean; st: St; hold: boolean; lured?: boolean; sleep: number; afraid: number; dark: boolean
  chief?: boolean; ram?: boolean; ladder?: boolean; fly?: boolean; breath?: boolean; leaving?: boolean; scorched?: boolean; bearing?: U; borne?: boolean; saved?: boolean; reload?: number; kit: Kit
  /** which of the attackers given (Setup.attackers) this is */
  src?: number
}
export interface Frame { u: number[]; wall: number[]; line?: string; fx?: number[] }
export type Strategy = 'assault' | 'night' | 'lure'
/** How a raid goes about it, as the war council puts it. */
export const STRATEGIES: Record<Strategy, { name: string; blurb: string }> = {
  assault: { name: 'Storm it at dawn', blurb: 'Straight at them in good order. Numbers and kit tell; against a stockade, bring ladders or a ram.' },
  night: { name: 'Night surprise', blurb: 'Creep up in the dark and fall on them asleep. Likelier with a small party and a camp well scouted; if they wake, we fight half blind and they see in the dark.' },
  lure: { name: 'Lure them out', blurb: 'Our archers bait the camp and draw part of it out into the open, where the rest of us wait. Needs at least 3 bows; the rest stay behind their walls.' },
}
export interface Setup {
  attackers: Kit[]; foe?: FoeKind; orcs: number; walls: boolean; rams?: number; ladders?: number; strategy: Strategy; intel?: number; defendingHome?: boolean
  /** orcs attack the village's palisade (the villagers inside, the orcs outside) */
  raid?: boolean
  /** the most of our fallen they'll take prisoner (otherwise two for each of them still standing) */
  captives?: number
  /** the dragon's hit points coming into this fight (wounds carry over) */
  dragonHp?: number
  /** the troll's hit points (a bigger lair, a bigger troll) */
  trollHp?: number
}
export interface Result { win: boolean; rounds: number; a: Tally; b: Tally; surprised: boolean | null; story: string[]; frames?: Frame[]; walls: [number, number][]; gate: number; units: { kind: string; s: number; side: 0 | 1 }[]; dragonLeft?: number
  /** what became of each of the attackers given, in order */
  fates: Fate[] }
/** What became of one of us: home unhurt (or ran home), wounded (out a few days), lost for good, or taken prisoner. */
export type Fate = 'unhurt' | 'ran' | 'wounded' | 'lost' | 'captured'
export interface Tally {
  n: number; dead: number; wounded: number; fled: number
  /** taken back to the orc camp (freed when the camp is taken) */
  captured: number
  /** fallen carried home by their comrades in the retreat (counted in wounded too) */
  carried: number
  /** how many soldiers' kit was left on the field for the monsters */
  kitLost: number
}

const CY = 15, R = 5 // the walls' centre row and the stockade's radius (the centre column depends on whose walls)
const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1]

export const orcsOf = (strength: number) => Math.max(3, Math.round(strength * 1.25))
export const goblinsOf = (strength: number) => Math.max(4, Math.round(strength * 1.5))

export function battle(set: Setup, rng: Rng, record = false): Result {
  const foe: FoeKind = set.foe ?? 'orcs'
  const inner: 0 | 1 = set.raid ? 0 : 1 // the side on the walls
  const d = (n: number) => 1 + Math.floor(rng() * n)
  const roll = (n: number, die: number) => { let t = 0; for (let k = 0; k < n; k++) t += d(die); return t }
  const d20 = (adv: number) => adv > 0 ? Math.max(d(20), d(20)) : adv < 0 ? Math.min(d(20), d(20)) : d(20)
  const story: string[] = []
  let line: string | undefined
  const say = (s: string) => { line = line ? `${line} ${s}` : s }
  // ---- the field
  const wall = new Int16Array(W * H) // 1: log; >1: the gate's hp
  const wallList: [number, number][] = []
  // our side is always on the left: a camp's stockade stands on the right with its gate facing us; our own
  // palisade stands on the left with its gate facing the orcs coming from the right
  const CX = set.raid ? W - 1 - 37 : 37, face = set.raid ? 1 : -1
  const GX = CX + face * R, GY = CY
  if (set.walls) for (let y = CY - R; y <= CY + R; y++) for (let x = CX - R; x <= CX + R; x++) {
    if (cheb(x, y, CX, CY) !== R) continue
    wall[y * W + x] = x === GX && y === GY ? RULES.gateHp : 1
    wallList.push([x, y])
  }
  const occ = new Int32Array(W * H).fill(-1)
  const U: U[] = []
  const setOcc = (u: U, id: number) => { for (let j = 0; j < u.s; j++) for (let i = 0; i < u.s; i++) occ[(u.y + j) * W + u.x + i] = id }
  const free = (x: number, y: number, s = 1, me = -1) => {
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const X = x + i, Y = y + j
      if (X < 0 || Y < 0 || X >= W || Y >= H || wall[Y * W + X] > 0) return false
      const o = occ[Y * W + X]
      if (o >= 0 && o !== me) return false
    }
    return true
  }
  const add = (u: Omit<U, 'id'>) => { const v = { ...u, id: U.length } as U; U.push(v); setOcc(v, v.id); return v }
  const none: Kit = { weapon: 'axe', body: 'hide', helmet: false, shield: false }
  const monster = (kind: string, st: Stat, x: number, y: number, extra: Partial<U> = {}) => add({
    side: 1, kind, s: st.size, x, y, hp: st.hp, max: st.hp, ac: st.ac, hit: st.hit, nd: st.nd, die: st.die, dmg: st.dmg, multi: st.multi, wis: st.wis, speed: st.speed,
    ranged: !!st.ranged, reachy: false, st: 0, hold: false, sleep: 0, afraid: 0, dark: false, kit: none, ...extra,
  })
  // ---- the foe
  let surprised: boolean | null = null
  const nA = set.attackers.length
  if (foe === 'orcs' || foe === 'goblins') {
    const n = set.orcs
    if (set.strategy === 'night') surprised = rng() < Math.max(0.1, Math.min(0.85, 0.75 - nA / 120 + (set.intel ?? 0) * 0.25))
    const spots: [number, number][] = []
    for (let y = CY - R + 1; y < CY + R; y++) for (let x = CX - R + 1; x < CX + R; x++) spots.push([x, y])
    spots.sort((p, q) => cheb(p[0], p[1], CX, CY) - cheb(q[0], q[1], CX, CY) || rng() - 0.5)
    const archers = Math.round(n * (foe === 'goblins' ? 0.5 : 0.2))
    for (let k = 0; k < n; k++) {
      const st = foe === 'orcs' ? (k === 0 ? MONSTERS.chief : k <= archers ? MONSTERS.orcArcher : MONSTERS.orc) : (k === 0 ? MONSTERS.boss : k <= archers ? MONSTERS.goblinArcher : MONSTERS.goblin)
      const kind = foe === 'orcs' ? (k === 0 ? 'O' : 'o') : (k === 0 ? 'G' : 'g')
      if (set.raid) { // in a column outside, ladders and the ram's crew in front
        const col = Math.floor(k / 20), row = k % 20
        const x = W - 9 + col, y = 15 + (row % 2 ? (row + 1) / 2 : -row / 2)
        const crew = k >= 1 && k <= (set.rams ? RULES.rams : 0)
        monster(kind, st, x, y, { chief: k === 0, ram: crew, ladder: !crew && k >= 1 + (set.rams ? RULES.rams : 0) && k < 1 + (set.rams ? RULES.rams : 0) + (set.ladders ?? 0) })
        continue
      }
      const [x, y] = spots[k] ?? [CX + 6 + (k % 4), (k * 7) % H]
      monster(kind, st, x, y, { chief: k === 0, hold: set.walls || set.strategy === 'lure', sleep: surprised ? 2 : 0, ac: surprised ? 10 : st.ac })
    }
  } else if (foe === 'troll') {
    const t = monster('T', MONSTERS.troll, CX, CY - 1)
    if (set.trollHp) t.hp = t.max = Math.round(set.trollHp)
  } else {
    const st = MONSTERS.dragon
    const dr = monster('D', st, CX + 2, CY - 1, { breath: true, fly: true })
    dr.hp = Math.min(st.hp, set.dragonHp ?? st.hp)
    setOcc(dr, -1)
  }
  // ---- the attackers: armoured melee in front, archers and engines behind
  const front = (k: Kit) => (k.weapon === 'ballista' ? 20 : k.weapon === 'bow' ? 10 : 0) + (k.body === 'mail' ? 0 : k.body === 'jerkin' ? 1 : 2) + (k.shield ? 0 : 1)
  const order = set.attackers.map((_, i) => i).sort((i, j) => front(set.attackers[i]) - front(set.attackers[j]))
  // on their own walls: the long weapons on the fighting step all round, the bows behind them
  const step: [number, number][] = []
  if (set.raid) {
    for (let y = CY - R + 1; y < CY + R; y++) for (let x = CX - R + 1; x < CX + R; x++) step.push([x, y])
    step.sort((p, q) => cheb(q[0], q[1], CX, CY) - cheb(p[0], p[1], CX, CY) || (q[0] - p[0]) || rng() - 0.5)
  }
  const x0 = set.strategy === 'night' ? 22 : foe === 'dragon' ? 8 : 4
  const cols = Math.ceil(nA / 24)
  order.forEach((i, k) => {
    const kit = set.attackers[i]
    const col = Math.floor(k / 24), row = k % 24
    let x = x0 + cols - 1 - col, y = 15 + (row % 2 ? (row + 1) / 2 : -row / 2)
    if (set.raid && step[k]) [x, y] = step[k]
    const b = RULES.villager
    if (kit.weapon === 'ballista') { add({ side: 0, kind: 'X', s: 1, x: x - 3, y, hp: BALLISTA.hp, max: BALLISTA.hp, ac: BALLISTA.ac, hit: BALLISTA.hit, nd: BALLISTA.nd, die: BALLISTA.die, dmg: BALLISTA.dmg, multi: 1, wis: 5, speed: 0, ranged: true, reachy: false, st: 0, hold: true, sleep: 0, afraid: 0, dark: false, reload: 0, kit, src: i }); return }
    add({
      side: 0, kind: 'v', s: 1, x, y, hp: b.hp, max: b.hp, ac: RULES.ac[kit.body] + (kit.shield ? RULES.shield : 0) + (kit.helmet ? RULES.helmet : 0), hit: b.hit, nd: 1, die: RULES.die[kit.weapon], dmg: b.dmg, multi: 1,
      wis: b.wis + (set.defendingHome || set.raid ? RULES.homeNerve : 0), speed: RULES.speed, ranged: kit.weapon === 'bow', reachy: kit.weapon === 'spear' || kit.weapon === 'none', src: i,
      st: 0, hold: !!set.raid, sleep: 0, afraid: 0, dark: set.strategy === 'night' && !surprised, kit,
      ram: !set.raid && set.walls && k < (set.rams ? RULES.rams : 0), ladder: !set.raid && set.walls && k >= RULES.rams && k < RULES.rams + (set.ladders ?? 0),
    })
  })
  const startN = [U.filter((u) => u.side === 0).length, U.filter((u) => u.side === 1).length]
  const dragon = U.find((u) => u.kind === 'D')
  const dragonStart = dragon?.hp ?? 0

  // ---- geometry
  /** Chebyshev gap between two tokens (1: side by side) */
  const gap = (a: U, b: U) => Math.max(0, b.x - (a.x + a.s - 1), a.x - (b.x + b.s - 1), b.y - (a.y + a.s - 1), a.y - (b.y + b.s - 1))
  const onWall = (u: U) => set.walls && cheb(u.x, u.y, CX, CY) < R
  /** 1: next to each other; 2: either side of a log (the one inside on the fighting step) */
  function reach(a: U, b: U): 0 | 1 | 2 {
    if (a.fly || b.fly || b.st === 3) return 0
    const g = gap(a, b)
    if (g === 1) return 1
    if (g === 2 && a.s === 1 && b.s === 1) {
      const dx = b.x - a.x, dy = b.y - a.y
      if (dx % 2 === 0 && dy % 2 === 0 && wall[(a.y + dy / 2) * W + a.x + dx / 2] > 0) return 2
    }
    return 0
  }
  /** can a strike over the logs land: defenders on the step strike down freely; from below only long weapons */
  const overOk = (a: U, b: U) => onWall(a) || (a.reachy && onWall(b))
  const inside = (x: number, y: number) => cheb(x, y, CX, CY) < R || (cheb(x, y, CX, CY) === R && wall[y * W + x] <= 0)
  const centre = (u: U) => [u.x + (u.s - 1) / 2, u.y + (u.s - 1) / 2]

  // ---- moving
  const fields: (Int16Array | null)[] = [null, null]
  const queue = new Int32Array(W * H)
  /** steps from every square to the nearest free square from which a foe can be struck */
  function field(side: 0 | 1) {
    const dist = new Int16Array(W * H).fill(9999)
    let qh = 0, qt = 0
    const goal = (i: number) => { if (dist[i] !== 0) { dist[i] = 0; queue[qt++] = i } }
    for (const v of U) {
      if (v.side === side || v.fly || (v.st !== 0 && v.st !== 1)) continue
      for (let y = v.y - 1; y <= v.y + v.s; y++) for (let x = v.x - 1; x <= v.x + v.s; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || (x >= v.x && x < v.x + v.s && y >= v.y && y < v.y + v.s)) continue
        if (wall[y * W + x] > 0) {
          if (v.s !== 1) continue
          const x2 = 2 * x - v.x, y2 = 2 * y - v.y
          if (x2 >= 0 && y2 >= 0 && x2 < W && y2 < H && wall[y2 * W + x2] <= 0 && occ[y2 * W + x2] < 0) goal(y2 * W + x2)
          continue
        }
        if (occ[y * W + x] < 0) goal(y * W + x)
      }
    }
    while (qh < qt) {
      const i = queue[qh++], x = i % W, y = (i / W) | 0
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k]
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (dist[j] <= dist[i] + 1 || wall[j] > 0) continue
        dist[j] = dist[i] + 1
        if (occ[j] < 0) queue[qt++] = j
      }
    }
    return dist
  }
  function advance(u: U) {
    const dist = fields[u.side] ??= field(u.side)
    let cur = 9999
    for (let k = 0; k < 8; k++) { const x = u.x + DX[k], y = u.y + DY[k]; if (x >= 0 && y >= 0 && x < W && y < H) cur = Math.min(cur, dist[y * W + x] + 1) }
    if (cur >= 9999) return false
    for (let s2 = 0; s2 < u.speed && cur > 0; s2++) {
      let best = -1, bd = cur
      for (let k = 0; k < 8; k++) {
        const x = u.x + DX[k], y = u.y + DY[k]
        if (!free(x, y) || (u.hold && !inside(x, y))) continue
        if (dist[y * W + x] < bd) { bd = dist[y * W + x]; best = k }
      }
      if (best < 0) break
      setOcc(u, -1); u.x += DX[best]; u.y += DY[best]; setOcc(u, u.id); cur = bd
    }
    return true
  }
  /** straight-line walking (big tokens, runners): towards (tx, ty), or away from it */
  function walk(u: U, tx: number, ty: number, n: number, away = false, stop?: () => boolean) {
    for (let k = 0; k < n; k++) {
      if (stop?.()) return
      const [cx, cy] = centre(u)
      const now = Math.hypot(cx - tx, cy - ty)
      let best = -1, bd = now
      for (let q = 0; q < 8; q++) {
        const nx = u.x + DX[q], ny = u.y + DY[q]
        if (!free(nx, ny, u.s, u.id) || (u.hold && !inside(nx, ny))) continue
        const dd = Math.hypot(cx + DX[q] - tx, cy + DY[q] - ty)
        if (away ? dd > bd + 1e-9 : dd < bd - 1e-9) { bd = dd; best = q }
      }
      if (best < 0) return
      setOcc(u, -1); u.x += DX[best]; u.y += DY[best]; setOcc(u, u.id)
    }
  }

  // ---- striking
  const alongside = (a: U, b: U) => U.filter((v) => v.side === a.side && v.st === 0 && reach(v, b) === 1).length
  const down = (b: U) => {
    if (b.bearing) { b.bearing.borne = false; b.bearing = undefined }
    b.hp = Math.min(b.hp, 0); b.st = 2
    setOcc(b, -1)
  }
  function strike(a: U, b: U, ranged: boolean, cover: boolean, adv0 = 0) {
    let adv = adv0
    if (!ranged && alongside(a, b) >= RULES.flank) adv++
    if (b.st === 1 || b.sleep > 0) adv++
    if (a.dark) adv--
    if (ranged && U.some((v) => v.side !== a.side && v.st === 0 && reach(a, v) === 1)) adv--
    const r = d20(Math.sign(adv))
    if (r === 1 || (r !== 20 && r + a.hit < b.ac + (cover ? RULES.cover : 0))) return false
    b.hp -= roll(a.nd * (r === 20 ? 2 : 1), a.die) + a.dmg
    if (b.kind === 'D' && b.hp > 0 && !b.leaving && b.hp <= dragonStart * DRAGON.leaveAt) {
      setOcc(b, -1); b.fly = true; b.st = 4; b.leaving = true
      say('Badly hurt, the dragon took to the air and made for its lair.')
      return true
    }
    if (b.hp <= 0 && b.st !== 2) {
      down(b)
      if (b.kind === 'T') say('The troll went down.')
      if (b.chief) say(b.kind === 'O' ? 'Their chief fell.' : 'Their boss fell.')
    }
    return true
  }
  const nearest = (u: U, pred: (v: U) => boolean) => {
    let best: U | null = null, bd = 1e9
    for (const v of U) if (pred(v)) { const dd = gap(u, v) + (v.st === 1 ? 2 : 0); if (dd < bd) { bd = dd; best = v } }
    return best
  }
  function meleeTurn(u: U) {
    // everyone in reach, by how hurt they are
    const near = U.filter((v) => v.side !== u.side && (v.st === 0 || v.st === 1) && reach(u, v) > 0 && (reach(u, v) === 1 || overOk(u, v)))
    if (!near.length) return false
    for (let m = 0; m < u.multi; m++) {
      const live = near.filter((v) => v.st < 2)
      if (!live.length) break
      const t = live.sort((p, q) => p.hp - q.hp)[0]
      strike(u, t, false, reach(u, t) === 2 && onWall(t))
    }
    return true
  }

  // ---- monsters' own turns
  function trollTurn(u: U) {
    if (u.st !== 0) return
    if (meleeTurn(u)) return
    const t = nearest(u, (v) => v.side === 0 && v.st === 0)
    if (t) { walk(u, ...(centre(t) as [number, number]), u.speed, false, () => U.some((v) => v.side === 0 && v.st === 0 && reach(u, v) === 1)); meleeTurn(u) }
  }
  function dragonTurn(u: U, round: number) {
    if (round === 0) {
      let ran = 0
      for (const v of U) if (v.side === 0 && v.st === 0 && v.kind === 'v' && d20(0) + v.wis < DRAGON.roarDC) { v.afraid = 1; ran++ }
      say(`The dragon roared: ${ran} of us froze in fear.`)
    }
    if (!u.leaving && u.hp <= dragonStart * DRAGON.leaveAt) { setOcc(u, -1); u.fly = true; u.st = 4; u.leaving = true; say('Badly hurt, the dragon took to the air and made for its lair.') }
    if (u.leaving) { // away over the trees, still within bowshot for a round or two
      u.x = Math.min(W - 1, u.x + DRAGON.fly); u.y = Math.max(0, u.y - 3)
      if (u.x >= W - 2) { u.st = 3; say('The dragon was gone.') }
      return
    }
    if (!u.breath && d(6) >= 5) u.breath = true
    const foes = U.filter((v) => v.side === 0 && v.st === 0)
    if (!foes.length) return
    if (u.breath) {
      // up, over the thickest crowd, and fire
      const t = foes.map((v) => ({ v, n: foes.filter((w) => cheb(v.x, v.y, w.x, w.y) <= 3).length })).sort((p, q) => q.n - p.n)[0].v
      setOcc(u, -1); u.fly = true; u.st = 4
      const [cx, cy] = centre(u)
      const dist = Math.hypot(t.x - cx, t.y - cy)
      const go = Math.max(0, Math.min(DRAGON.fly, dist - 3))
      u.x = Math.round(u.x + (t.x - cx) / dist * go); u.y = Math.max(0, Math.min(H - 2, Math.round(u.y + (t.y - cy) / dist * go)))
      if (dist - go > 4) return // still on its way: the fire can wait
      const [ox, oy] = centre(u)
      const dx = t.x - ox, dy = t.y - oy, dl = Math.hypot(dx, dy) || 1
      const cone: number[] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const vx = x - ox, vy = y - oy, vl = Math.hypot(vx, vy)
        if (vl < 0.5 || vl > DRAGON.breathLen) continue
        if ((vx * dx + vy * dy) / (vl * dl) >= Math.cos(Math.PI / 6)) cone.push(x, y)
      }
      let hit = 0, fell = 0
      for (const v of U) if (v.side === 0 && v.st < 2) {
        for (let k = 0; k < cone.length; k += 2) if (cone[k] === v.x && cone[k + 1] === v.y) {
          const dmg = roll(DRAGON.breathDice, 6)
          v.hp -= d20(0) >= DRAGON.breathDC ? Math.floor(dmg / 2) : dmg
          hit++
          if (v.hp <= 0) { v.hp = 1; v.st = 1; v.scorched = true; fell++ } // singed and scattered, never burnt up
          break
        }
      }
      fx = cone
      u.breath = false
      say(`The dragon breathed fire: ${hit === 1 ? 'one of us was' : `${hit} of us were`} caught in it${fell ? `, ${fell === hit ? (hit === 1 ? 'and ran off singed' : 'and all ran off singed') : `${fell} ran off singed`}` : ''}.`)
      return
    }
    // swoop down beside the nearest of them and strike, or circle out of reach
    if (u.fly && rng() < 0.5) return
    const t = nearest(u, (v) => v.side === 0 && v.st === 0)!
    let spot: [number, number] | null = null, sd = 1e9
    for (let y = t.y - 3; y <= t.y + 3; y++) for (let x = t.x - 3; x <= t.x + 3; x++) {
      if (!free(x, y, 2, u.id)) continue
      const g = Math.max(0, t.x - (x + 1), x - t.x, t.y - (y + 1), y - t.y)
      if (g !== 1) continue
      const dd = Math.hypot(x - u.x, y - u.y)
      if (dd < sd) { sd = dd; spot = [x, y] }
    }
    if (!spot) { if (!u.fly) meleeTurn(u); return }
    if (u.fly || Math.hypot(spot[0] - u.x, spot[1] - u.y) > 0) { setOcc(u, -1); u.x = spot[0]; u.y = spot[1]; u.fly = false; u.st = 0; setOcc(u, u.id) }
    meleeTurn(u)
  }

  // ---- the approach
  if (set.strategy === 'lure' && (foe === 'orcs' || foe === 'goblins')) {
    const bows = U.filter((u) => u.side === 0 && u.ranged && u.kind === 'v')
    if (bows.length >= 3) {
      for (const u of bows) walk(u, u.x + 14, u.y, 99)
      const share = Math.min(0.75, 0.35 + bows.length / set.orcs * 0.6 + (set.intel ?? 0) * 0.1)
      const out = U.filter((u) => u.side === 1 && !u.chief).sort(() => rng() - 0.5).slice(0, Math.round((set.orcs - 1) * share))
      for (const u of out) { u.hold = false; u.lured = true }
      story.push(`Our archers baited them: ${out.length} came out after us.`)
    } else story.push('We had no bows to bait them with, so they stayed put.')
  } else if (set.strategy === 'night') story.push(surprised ? 'We crept up in the dark and fell on their camp while they slept.' : 'One of us stumbled in the dark, and they woke.')
  else story.push(set.raid ? (set.walls ? 'They came at our palisade.' : 'They came at our village.') : foe === 'troll' ? 'We went out to face the troll.' : foe === 'dragon' ? 'We waited for the dragon on open ground.' : set.walls ? 'We marched on their stockade at dawn.' : 'We marched on their camp at dawn.')

  // ---- the rounds
  let fx: number[] | undefined
  const frames: Frame[] = []
  const snap = (l?: string) => { if (record) frames.push({ u: U.flatMap((u) => [u.x, u.y, u.st]), wall: wallList.map(([x, y]) => wall[y * W + x] > 0 ? 1 : 0), line: l, fx }); fx = undefined }
  snap(story[0])
  const nextNerve = [RULES.nerveFirst, RULES.nerveFirst]
  const standing = (s: 0 | 1) => U.filter((u) => u.side === s && (u.st === 0 || u.st === 4)).length
  let round = 0, chase = 0, loser: 0 | 1 | null = null
  for (; round < RULES.rounds; round++) {
    line = undefined
    // getting nowhere: we break off in good order, carrying the fallen we can (a raid on us just goes on)
    if (round === RULES.rounds - 8 && loser === null && !set.raid && foe !== 'dragon') {
      if (standing(1) * 4 <= standing(0)) { // all but beaten: the last of them slip away
        for (const u of U) if (u.side === 1 && u.st === 0) { u.st = 3; setOcc(u, -1) }
        say('The last of them slipped away over the back of their stockade.')
        loser = 1
      } else {
        for (const u of U) if (u.side === 0 && u.st === 0 && u.kind === 'v') u.st = 1
        say('Getting nowhere, we broke off and fell back.')
        loser = 0
      }
    }
    const seq = U.filter((u) => u.st !== 3).sort(() => rng() - 0.5)
    let moves = 0
    for (const u of seq) {
      if (++moves % 12 === 0) fields[0] = fields[1] = null
      if (u.kind === 'T') { trollTurn(u); continue }
      if (u.kind === 'D') { if (u.st === 0 || u.st === 4) dragonTurn(u, round); continue }
      if (u.st >= 2 || u.sleep > 0) continue
      if (u.afraid > 0) { u.afraid--; continue }
      if (u.st === 1) { // running for its own edge
        const ex = u.side === 0 ? 0 : W - 1
        u.hold = false
        // from inside their own walls, over the logs on the far side
        if (set.walls && cheb(u.x, u.y, CX, CY) === R - 1) {
          const dx = Math.sign(ex - u.x), lx = u.x + dx
          if (wall[u.y * W + lx] > 0 && free(lx + dx, u.y)) { setOcc(u, -1); u.x = lx + dx; setOcc(u, u.id) }
        }
        // falling back, we pick up a fallen comrade close by (unless three or more of them stand over the fallen) and carry them along
        let pace = u.speed
        if (u.side === 0 && u.kind === 'v' && !u.bearing) {
          const c = U.find((v) => v.side === 0 && v.kind === 'v' && v.st === 2 && !v.borne && cheb(u.x, u.y, v.x, v.y) <= 6 && U.filter((o) => o.side === 1 && o.st === 0 && gap(o, v) <= 1).length < 3)
          if (c) { walk(u, c.x, c.y, 6, false, () => cheb(u.x, u.y, c.x, c.y) <= 1); if (cheb(u.x, u.y, c.x, c.y) <= 1) { u.bearing = c; c.borne = true; pace = 2 } }
        }
        if (u.bearing) pace = Math.min(pace, 4)
        walk(u, ex, u.y, pace)
        if (u.bearing) { u.bearing.x = Math.min(W - 1, u.x + 1); u.bearing.y = u.y }
        if (u.x === ex || (u.side === 1 && u.x + u.s - 1 === W - 1)) {
          u.st = 3; setOcc(u, -1)
          if (u.bearing) { u.bearing.st = 3; u.bearing.saved = true; u.bearing.x = u.x }
        }
        continue
      }
      if (u.kind === 'X') { // a ballista: a shot every other round, at the biggest thing in range
        if ((u.reload ?? 0) > 0) { u.reload!--; continue }
        const t = nearest(u, (v) => v.side === 1 && (v.st === 0 || v.st === 4))
        if (t && gap(u, t) <= 40) { if (strike(u, t, true, false)) say('A bolt from our ballista struck home.'); u.reload = 1 }
        continue
      }
      if (meleeTurn(u)) continue
      const t = nearest(u, (v) => v.side !== u.side && (v.st === 0 || v.st === 1 || v.st === 4))
      if (!t) continue
      // goblins: shoot and slip away
      if (u.ranged && (u.kind === 'g') && U.some((v) => v.side === 0 && v.st === 0 && gap(u, v) <= 2)) walk(u, ...(centre(t) as [number, number]), u.speed, true)
      if (u.ranged && gap(u, t) <= RULES.bowRange) { strike(u, t, true, onWall(t)); continue }
      if (t.fly) continue // nothing to do but wait for it to come down
      if (u.hold && gap(u, t) > 14) continue
      // at the stockade: the ram to the gate, ladders over the logs
      if (u.side !== inner && set.walls && wall[GY * W + GX] > 0 && u.ram) {
        if (cheb(u.x, u.y, GX, GY) === 1) {
          wall[GY * W + GX] = Math.max(0, wall[GY * W + GX] - d(10))
          if (wall[GY * W + GX] <= 0) say(u.side === 0 ? 'Our ram broke their gate in.' : 'Their ram broke our gate in.')
        } else walk(u, GX + face, GY, u.speed, false, () => cheb(u.x, u.y, GX, GY) === 1)
        continue
      }
      if (u.side !== inner && set.walls && u.ladder && !onWall(u)) {
        for (let k = 0; k < 8; k++) {
          const lx = u.x + DX[k], ly = u.y + DY[k]
          if (lx < 0 || ly < 0 || lx >= W || ly >= H || wall[ly * W + lx] !== 1) continue
          const ox = lx + DX[k], oy = ly + DY[k]
          if (!free(ox, oy) || !inside(ox, oy)) continue
          // up the ladder: every defender in reach takes a swing, with advantage
          for (const v of U) if (v.side === inner && v.st === 0 && reach(v, u) === 2) strike(v, u, false, false, 1)
          if (u.st === 0) { setOcc(u, -1); u.x = ox; u.y = oy; setOcc(u, u.id); u.hold = false; say(u.side === 0 ? 'One of us got over their logs on a ladder.' : 'One of them got over our logs on a ladder.') }
          break
        }
        if (onWall(u) || u.st !== 0) continue
      }
      if (!advance(u)) walk(u, t.x, t.y, u.speed, false, () => reach(u, t) > 0)
    }
    fields[0] = fields[1] = null
    for (const u of U) if (u.sleep > 0) { u.sleep--; if (u.sleep === 0) u.ac = MONSTERS[u.chief ? (u.kind === 'O' ? 'chief' : 'boss') : u.kind === 'o' ? (u.ranged ? 'orcArcher' : 'orc') : (u.ranged ? 'goblinArcher' : 'goblin')].ac }
    if (round >= 2) for (const u of U) u.dark = false
    // ---- nerve (crowds only: a troll or a dragon doesn't lose its nerve)
    for (const s of [0, 1] as const) {
      if (s === 1 && (foe === 'troll' || foe === 'dragon')) continue
      const out = U.filter((u) => u.side === s && u.st >= 2 && u.kind !== 'X').length / startN[s]
      if (out < nextNerve[s]) continue
      nextNerve[s] += RULES.nerveStep
      const chiefDown = s === 1 && U.some((u) => u.chief && u.st >= 2)
      // nerve goes with how the fight is going: nobody runs from a beaten foe, and it's easier when winning
      const ours = U.filter((u) => u.side === s && u.st === 0).length, theirs = U.filter((u) => u.side !== s && (u.st === 0 || u.st === 4)).length
      if (theirs === 0) continue
      const winning = ours >= theirs * 2 ? 1 : 0
      let ran = 0
      for (const u of U) if (u.side === s && u.st === 0 && u.kind !== 'X') {
        const adv = winning - (U.filter((v) => v.side !== s && v.st === 0 && reach(u, v) === 1).length >= 2 ? 1 : 0)
        if (d20(adv) + u.wis - (chiefDown ? RULES.chiefNerve : 0) < RULES.nerveDC) { u.st = 1; ran++ }
      }
      if (ran) say(s === 1 ? `${ran} of them lost their nerve and ran.` : `${ran} of us lost our nerve and ran.`)
    }
    // runners rally when their side is clearly winning
    for (const s of [0, 1] as const) {
      const ours = U.filter((u) => u.side === s && u.st === 0).length, theirs = U.filter((u) => u.side !== s && (u.st === 0 || u.st === 4)).length
      if (ours === 0 || ours < theirs * 2) continue
      let back = 0
      for (const u of U) if (u.side === s && u.st === 1 && !u.scorched && !u.bearing && d20(0) + u.wis >= RULES.nerveDC) { u.st = 0; back++ }
      if (back) say(s === 0 ? `${back} of us took heart and came back.` : `${back} of them came back to the fight.`)
    }
    snap(line)
    if (line) story.push(line)
    if (loser === null) {
      if (standing(0) === 0) loser = 0
      else if (standing(1) === 0) loser = 1
    }
    if (loser !== null && (chase++ >= 3 || !U.some((u) => u.side === loser && u.st === 1))) { round++; break }
  }
  if (loser === null) loser = set.raid ? 1 : 0 // nobody won by nightfall: the attackers draw off
  const win = loser === 1
  // ---- after the fight: who comes home
  // winners carry their fallen home (most live, wounded). On a lost field: orcs take prisoners, except those with a
  // comrade close by, who are carried off in the retreat; goblins and the troll take no one, only the kit they
  // dropped. Those the dragon's fire scattered come home singed (wounded).
  const fallen = U.filter((u) => u.side === 0 && u.kind !== 'X' && (u.st === 2 || u.saved || u.borne))
  const fate = new Map<U, 'home' | 'lost' | 'carried' | 'captured' | 'limped'>()
  let room = Math.min(set.captives ?? Infinity, 2 * U.filter((v) => v.side === 1 && v.st === 0 && v.s === 1).length)
  for (const u of fallen) {
    if (win) { fate.set(u, d(20) >= RULES.liveWin ? 'home' : 'lost'); continue }
    // a few of the fallen don't recover, win or lose (prisoners always live: they're freed later)
    const off = u.saved || u.borne // carried off in the retreat
    if (foe === 'orcs' && !off && room-- > 0) { fate.set(u, 'captured'); continue } // left on the field: the orcs take them (two each)
    if (d(20) < RULES.liveWin) { fate.set(u, 'lost'); continue }
    fate.set(u, off ? 'carried' : 'limped')
  }
  const of2 = (f: string) => [...fate.values()].filter((x) => x === f).length
  // the winners' runners come back once it's won
  for (const u of U) if (u.side !== loser && u.st === 1 && !u.scorched && !u.bearing) u.st = 0
  if (record && fate.size) { // the closing scene: the fallen helped away; the orcs go home, each dragging a prisoner
    const home: [number, number] = set.raid ? [W - 1, CY] : [CX, CY]
    const captors = new Map<U, U>()
    const orcsLeft = U.filter((v) => v.side === 1 && v.st === 0 && v.s === 1)
    for (const [u, f] of fate) if (f === 'captured' && orcsLeft.length) {
      const o = orcsLeft.sort((p, q) => cheb(p.x, p.y, u.x, u.y) - cheb(q.x, q.y, u.x, u.y))[0]
      captors.set(u, o)
    }
    const toward = (v: { x: number; y: number }, n: number) => { v.x += Math.sign(home[0] - v.x) * Math.min(n, Math.abs(home[0] - v.x)); v.y += Math.sign(home[1] - v.y) * Math.min(Math.ceil(n / 2), Math.abs(home[1] - v.y)) }
    // when we win, those of us still standing go to the fallen and carry them home; when goblins win, they go
    // round the fallen pinching gear and then make off (only in the picture: the tally is as the fight left it)
    const keepSt = new Map(U.map((u) => [u, u.st]))
    const pairs: { b: U; u: U; got: boolean }[] = []
    const onField = [...fate.keys()].filter((u) => u.st === 2 && !u.saved && !u.borne)
    if (win) {
      const free = U.filter((v) => v.side === 0 && v.kind === 'v' && v.st === 0)
      for (const u of onField.sort((p, q) => p.x - q.x)) {
        if (!free.length) break
        free.sort((p, q) => cheb(p.x, p.y, u.x, u.y) - cheb(q.x, q.y, u.x, u.y))
        pairs.push({ b: free.shift()!, u, got: false })
      }
    }
    const pinch: { g: U; u: U | null; got: boolean }[] = !win && foe === 'goblins'
      ? U.filter((v) => v.side === 1 && v.st === 0).map((g, i) => ({ g, u: onField.length ? onField.sort((p, q) => cheb(p.x, p.y, g.x, g.y) - cheb(q.x, q.y, g.x, g.y))[i % Math.max(1, Math.min(3, onField.length))] : null, got: !onField.length }))
      : []
    const step = (v: U, tx: number, ty: number, n: number) => { v.x += Math.sign(tx - v.x) * Math.min(n, Math.abs(tx - v.x)); v.y += Math.sign(ty - v.y) * Math.min(n, Math.abs(ty - v.y)) }
    const scene = pairs.length || pinch.length ? 10 : 5
    for (let k = 0; k < scene; k++) {
      for (const p of pairs) {
        if (p.b.st === 3) continue
        if (!p.got) { step(p.b, p.u.x - 1, p.u.y, 8); if (cheb(p.b.x, p.b.y, p.u.x, p.u.y) <= 1) p.got = true }
        else { p.b.x = Math.max(0, p.b.x - 6); p.u.x = p.b.x + 1; p.u.y = p.b.y; if (p.b.x === 0) { p.b.st = 3; p.u.st = 3 as St } }
      }
      for (const p of pinch) {
        if (p.g.st === 3) continue
        if (!p.got && p.u) { step(p.g, p.u.x + 1, p.u.y, 6); if (cheb(p.g.x, p.g.y, p.u.x, p.u.y) <= 1) p.got = true }
        else { p.g.x = Math.min(W - 1, p.g.x + 6); if (p.g.x === W - 1) p.g.st = 3 }
      }
      for (const u of U) if (u.side === 0 && u.bearing && u.st === 1) { u.x = Math.max(0, u.x - 4); u.bearing.x = Math.min(W - 1, u.x + 1); u.bearing.y = u.y; if (u.x === 0) { u.st = 3; u.bearing.st = 3 } }
      if (!win && foe === 'orcs') {
        for (const o of U) if (o.side === 1 && o.st === 0 && o.s === 1) toward(o, 4)
        for (const [u, o] of captors) { u.st = 5 as St; u.x = Math.max(0, Math.min(W - 1, o.x - Math.sign(home[0] - o.x || 1))); u.y = o.y }
        for (const [u, f] of fate) if (f === 'captured' && !captors.has(u)) { u.st = 5 as St; toward(u, 4) }
      }
      for (const u of U) if (u.side === 0 && u.st === 1 && !fate.has(u) && !u.bearing) u.x = Math.max(0, u.x - 6)
      const n = of2('carried') + [...fate].filter(([u, f]) => f === 'lost' && (u.saved || u.borne)).length, c = of2('captured')
      const crawl = of2('limped')
      const after = crawl ? ` ${crawl === 1 ? 'One more' : `${crawl} more`} crawled home after dark.` : ''
      snap(k === 0 ? (win ? 'We carried our wounded home.' : foe === 'orcs' ? (!c ? `We fell back, carrying ${n === 1 ? 'our fallen' : `all ${n} of our fallen`} with us.` : !n ? 'They dragged our fallen back to their camp as prisoners.' : `We fell back, carrying ${n} of our fallen. They dragged ${c} back to their camp as prisoners.`) + after : foe === 'goblins' ? 'They pinched the gear our fallen had dropped; our fallen crawled home after dark.' : foe === 'troll' ? 'The troll kept what we had dropped; our fallen crawled home after dark.' : 'We fell back.') : undefined)
    }
    if (frames.length) story.push(frames[frames.length - scene].line!)
    for (const [u, st] of keepSt) if (!fate.has(u)) u.st = st
  }
  const tally = (s: 0 | 1): Tally => {
    const mine = U.filter((u) => u.side === s && u.kind !== 'X')
    if (s === 1) {
      const down = mine.filter((u) => u.st === 2).length
      return { n: mine.length, dead: down, wounded: 0, fled: mine.filter((u) => u.st === 3 || u.st === 1).length, captured: 0, carried: 0, kitLost: 0 }
    }
    const of = (f: string) => [...fate.values()].filter((x) => x === f).length
    const scorched = mine.filter((u) => u.scorched && !fate.has(u)).length
    return {
      n: mine.length, dead: of('lost'), wounded: of('home') + of('carried') + of('limped') + scorched, captured: of('captured'), carried: of('carried'),
      fled: mine.filter((u) => (u.st === 3 || u.st === 1) && !u.scorched && !fate.has(u)).length,
      kitLost: win ? 0 : of('captured') + of('limped'),
    }
  }
  const a = tally(0), b = tally(1)
  // each of the attackers given, by what the fight did to them
  const fates: Fate[] = set.attackers.map(() => 'unhurt')
  for (const u of U) {
    if (u.side !== 0 || u.src === undefined) continue
    const f = fate.get(u)
    fates[u.src] = f === 'lost' ? 'lost' : f === 'captured' ? 'captured' : f || u.scorched ? 'wounded' : u.st === 1 || u.st === 3 ? 'ran' : 'unhurt'
  }
  const last = foe === 'dragon'
    ? (dragon!.st === 2 ? 'We brought the dragon down!' : dragon!.st === 3 ? `It will be back, with ${Math.max(0, dragon!.hp)} of its ${MONSTERS.dragon.hp} strength.` : 'The dragon drove us off.')
    : set.raid ? (win ? (set.walls ? 'Our palisade held.' : 'We drove them off.') : set.walls ? 'They took our palisade, and its armoury with it.' : 'They broke into our village.')
    : foe === 'troll' ? (win ? 'We defeated the troll.' : 'The troll held its bridge.') : win ? 'We took their camp.' : 'We fell back.'
  story.push(`${last} Of our ${a.n}: ${[a.dead && `${a.dead} lost`, a.wounded && `${a.wounded} wounded`, a.captured && `${a.captured} taken prisoner`, a.fled && `${a.fled} ${set.raid ? "got away" : "ran home"}`, !win && a.n - a.dead - a.wounded - a.captured - a.fled > 0 && `${a.n - a.dead - a.wounded - a.captured - a.fled} came back unhurt`].filter(Boolean).join(', ') || 'all came home'}.`)
  return { win, rounds: round, a, b, surprised, story, frames: record ? frames : undefined, walls: wallList, gate: wallList.findIndex(([x, y]) => x === GX && y === GY), units: U.map((u) => ({ kind: u.kind === 'v' ? kitCode(u.kit) : u.kind, s: u.s, side: u.side })), dragonLeft: dragon ? Math.max(0, dragon.hp) : undefined, fates }
}
const kitCode = (k: Kit) => ({ none: 'N', spear: 'P', sword: 'S', bow: 'B', axe: 'A', ballista: 'X' })[k.weapon] + ({ none: 'n', jerkin: 'j', hide: 'h', mail: 'm' })[k.body]
