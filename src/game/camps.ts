/** Raiding monster camps: the reason to send soldiers to a neighbour's palisade.
 *
 *  Every lair on the map is a camp with a name, a hoard (common plunder and a trophy found at no other camp)
 *  and a fighting strength that nobody knows exactly. A village with a palisade can raid one within reach,
 *  with its own fighters and every detachment stationed on its walls. Before it does, its war council shows
 *  what to expect: the chance of winning, how many may fall, and what the hoard may hold. Those are guesses:
 *  scouting the camp (a small action, anyone can do it, and everyone learns from it) narrows them, the way a
 *  bigger poll narrows an election forecast. With little known the chance sits near the middle; the more is
 *  known, the closer it moves to the real odds, which for a well-matched or badly-matched fight are near 0 or
 *  near 100.
 *
 *  The fight is fought out in detail (battle.ts): the quartermaster fits every soldier out from the kit they've
 *  all brought (swords and spears, bows, shields, helmets, mail and leather; ladders and a ram carried along),
 *  and the council's forecast is the fight run many times over what it believes of the camp. Orc camps stand
 *  behind a stockade; goblins, the troll and the dragon fight in the open.
 *
 *  Win: the hoard (and anything they'd carried off from us) is shared out by how many soldiers each village sent
 *  (not by their kit), any of our people they held come home, the camp is scattered (weaker, and quiet for
 *  QUIET_DAYS) and its hoard starts to build up again; a camp knocked down far enough breaks up for good.
 *  Lose: they keep the kit our fallen left on the field and take prisoners, and grow bolder.
 *
 *  The camps raid our villages too (see defend): every able adult turns out, behind the palisade if there is one.
 *  If the palisade falls they take its armoury (the kit in store) and carry off what they can from the stores.
 *
 *  Pure: the server and every screen agree. Randomness is seeded by the camp and how often it has been raided
 *  or scouted, so a forecast doesn't change from one look to the next. */
import { rngFor, type Rng } from '../world/rng'
import { MONSTERS, battle, goblinsOf, orcsOf, type Fate, type Kit, type Setup, type Strategy } from './battle'
import { WEIGHT } from './market'
import { distance } from '../world/hex'
import { FOOD, KIT, type Good, type Goods } from './data'
import type { GameState, LairState, Village } from './types'

/** How far a palisade's raiders march (hexes). */
export const RAID_RANGE = 9
/** Days a scattered camp stays quiet. */
export const QUIET_DAYS = 5
/** A camp beaten down below this strength breaks up for good. */
export const BREAK_UP = 5
/** How much a scouting narrows the guess, by how many times the camp has been scouted (spread of log strength). */
export const SPREAD = [0.55, 0.32, 0.18, 0.09, 0.04]
export const MAX_INTEL = SPREAD.length - 1

const ORC_TROPHIES: Good[] = ['tusk_ivory', 'warg_pelt', 'war_banner', 'black_iron', 'amber', 'chieftain_torc', 'war_horn']
const ORC_NAMES = ['Redtusk', 'Blacktusk', 'Mudwallow', 'Crookback', 'Ironjaw', 'Mudgrub', 'Stonegnaw', 'Ashmaw', 'Grimhollow']
const NAMES: Record<LairState['kind'], string[]> = {
  orcs: ORC_NAMES,
  goblins: ['Snickerwick', 'Pinchpocket', 'Mossgrin'],
  trolls: ["Old Gnarl's bridge", 'the Stone Troll', 'Moss-Back'],
  dragon: ['the Ember Wyrm'],
}

export interface CampState {
  /** how many times it has been scouted since it was last raided */
  intel: number
  /** times raided (a new hoard and a new strength each time) */
  raids: number
  /** last raided, and quiet (no raids on villages) until */
  raidedAt?: string
  quietUntil?: string
  /** what they've carried off from our villages, or picked up off a field we lost: in the hoard until it's taken */
  plunder?: Goods
  /** our people they hold, by village: freed when a raid takes the camp */
  prisoners?: Record<string, number>
  /** the dragon's strength: its wounds carry over from one fight to the next */
  dragonHp?: number
  /** the last day it grew stronger (see CAMP_GROWTH) */
  grewOn?: string
}

export interface Camp {
  /** index into GameState.lairs */
  idx: number
  lair: LairState
  name: string
  /** the trophy this camp alone has */
  trophy: Good
  state: CampState
}

/** Every camp still standing, with its name and trophy (the orc camps each have a different one). */
export function campsOf(s: GameState): Camp[] {
  const out: Camp[] = []
  const seen: Record<string, number> = {}
  s.lairs.forEach((lair, idx) => {
    const k = seen[lair.kind] = (seen[lair.kind] ?? -1) + 1
    if (lair.cleared) return
    const names = NAMES[lair.kind]
    const name = lair.kind === 'orcs' ? `the ${names[k % names.length]} camp` : names[k % names.length]
    const trophy: Good = lair.kind === 'orcs' ? ORC_TROPHIES[k % ORC_TROPHIES.length] : lair.kind === 'trolls' ? 'troll_pearl' : lair.kind === 'goblins' ? 'goblin_gold' : 'dragon_scale'
    out.push({ idx, lair, name, trophy, state: s.camps?.[idx] ?? { intel: 0, raids: 0 } })
  })
  return out
}
export const campAt = (s: GameState, col: number, row: number) => campsOf(s).find((c) => c.lair.col === col && c.lair.row === row) ?? null

/** A standard normal draw. */
function normal(rng: Rng) {
  const u = Math.max(1e-9, rng()), v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const camp_rng = (s: GameState, c: Camp, ...more: (string | number)[]) => rngFor(s.worldSeed, 'camp', c.idx, c.state.raids, ...more)

/** What the hoard holds right now: plunder by the camp's size, its trophy, and luck (fixed until it's raided);
 *  after a raid it builds up again over QUIET_DAYS * 2 days. */
export function hoardOf(s: GameState, c: Camp, at: string): Goods {
  const rng = camp_rng(s, c, 'hoard')
  const luck = Math.exp(0.45 * normal(rng))
  const S = c.lair.strength
  const refill = c.state.raidedAt ? Math.min(1, (Date.parse(at) - Date.parse(c.state.raidedAt)) / (QUIET_DAYS * 2 * 86_400_000)) : 1
  const k = luck * refill
  const r2 = (x: number) => Math.round(x * 100) / 100
  const base: Goods = c.lair.kind === 'orcs' ? { iron: 2 + S / 5, leather: 2 + S / 4, copper: S / 3, cured_meat: S * 4 }
    : c.lair.kind === 'goblins' ? { copper: 2 + S / 5, berries: 3 }
    : c.lair.kind === 'trolls' ? { tin: 1 + S / 10, silver: 1 }
    : { silver: 2, tin: 3 }
  const out: Goods = {}
  for (const [g, n] of Object.entries(base)) out[g as Good] = r2((n ?? 0) * k)
  out[c.trophy] = r2((2 + S / 4) * k * (0.7 + 0.6 * rng()))
  // and whatever they've carried off from our villages, or picked up off a field we lost
  for (const [g, n] of Object.entries(c.state.plunder ?? {})) out[g as Good] = r2((out[g as Good] ?? 0) + (n ?? 0))
  return out
}

// ------------------------------------------------------------------ the forces

export { KIT }
const MELEE = ['sword', 'spear'] as const

/** A village's soldiers in a fight, with the kit they've brought (for the host's own: what's in its stores). */
export interface Group { village: string; troops: number; gear: Goods }
/** One soldier as the quartermaster fitted them out: their kit, and whose stores each piece came from. */
export interface Soldier { group: number; kit: Kit; items: { good: Good; from: number }[] }
export interface Fitting {
  soldiers: Soldier[]
  /** ladders and rams carried along, and whose they were */
  ladders: number; rams: number; carried: { good: Good; from: number; n: number }[]
  troops: number
  /** how many got each piece of kit */
  count: Partial<Record<Good | 'pitchfork', number>>
}

/** The quartermaster: fits out every soldier from the kit they've all brought between them, to keep the most
 *  alive and win. Swords, then spears, go to the line (a soldier's own village's kit first); bows to the next;
 *  everyone else takes a pitchfork. Mail, then leather jerkins, and helmets go to the front first; shields to
 *  anyone with a hand free (not the archers). Ladders and a ram are carried along. */
export function quartermaster(groups: Group[]): Fitting {
  const stock = groups.map((g) => Object.fromEntries(KIT.map((k) => [k, Math.floor((g.gear[k] ?? 0) + 1e-9)])) as Record<Good, number>)
  // from the soldier's own village's kit, or (on the second pass) anyone's
  const take = (good: Good, own: number, any = false): number | null => {
    if (stock[own]?.[good] > 0) { stock[own][good]--; return own }
    if (!any) return null
    const j = stock.findIndex((st) => st[good] > 0)
    if (j < 0) return null
    stock[j][good]--
    return j
  }
  const soldiers: Soldier[] = []
  for (let gi = 0; gi < groups.length; gi++) for (let k = 0; k < groups[gi].troops; k++) soldiers.push({ group: gi, kit: { weapon: 'none', body: 'none', helmet: false, shield: false }, items: [] })
  const count: Fitting['count'] = {}
  const got = (x: Soldier, good: Good, from: number) => { x.items.push({ good, from }); count[good] = (count[good] ?? 0) + 1 }
  // weapons: the line first
  for (const w of [...MELEE, 'bow'] as const) for (const any of [false, true]) for (const x of soldiers) {
    if (x.kit.weapon !== 'none') continue
    const from = take(w, x.group, any)
    if (from === null) { if (any) break; continue }
    x.kit.weapon = w; got(x, w, from)
  }
  count.pitchfork = soldiers.filter((x) => x.kit.weapon === 'none').length
  // armour: the front first (swords, spears, pitchforks, then the archers at the back)
  const front = [...soldiers].sort((p, q) => rank(p.kit.weapon) - rank(q.kit.weapon))
  for (const any of [false, true]) for (const x of front) {
    if (x.kit.body === 'none') for (const body of ['mail', 'jerkin'] as const) { const from = take(body, x.group, any); if (from !== null) { x.kit.body = body; got(x, body, from); break } }
    if (!x.kit.helmet) { const h = take('helmet', x.group, any); if (h !== null) { x.kit.helmet = true; got(x, 'helmet', h) } }
    if (x.kit.weapon !== 'bow' && !x.kit.shield) { const sh = take('shield', x.group, any); if (sh !== null) { x.kit.shield = true; got(x, 'shield', sh) } }
  }
  // carried along: ladders (one a soldier at most) and a ram
  const carried: Fitting['carried'] = []
  let ladders = 0, rams = 0
  for (let j = 0; j < stock.length; j++) {
    const l = Math.min(stock[j].ladder ?? 0, soldiers.length - ladders)
    if (l > 0) { ladders += l; carried.push({ good: 'ladder', from: j, n: l }) }
    if (!rams && (stock[j].ram ?? 0) >= 1) { rams = 1; carried.push({ good: 'ram', from: j, n: 1 }) }
  }
  return { soldiers, ladders, rams, carried, troops: soldiers.length, count }
}
const rank = (w: Kit['weapon']) => ({ sword: 0, spear: 1, none: 2, axe: 2, bow: 3, ballista: 4 })[w]

/** "46 soldiers: 10 swords, 20 spears, 16 pitchforks; 8 in mail, 20 in leather; 30 shields, 12 helmets; 6 ladders" */
export function fittingText(f: Fitting): string {
  const c = f.count
  const n = (x: number | undefined, one: string, many = `${one}s`) => (x ? `${x} ${x === 1 ? one : many}` : '')
  const parts = [
    [n(c.sword, 'sword'), n(c.spear, 'spear'), n(c.bow, 'bow'), n(c.pitchfork, 'pitchfork')].filter(Boolean).join(', '),
    [c.mail && `${c.mail} in mail`, c.jerkin && `${c.jerkin} in leather`].filter(Boolean).join(', '),
    [n(c.shield, 'shield'), n(c.helmet, 'helmet')].filter(Boolean).join(', '),
    [n(f.ladders, 'ladder'), f.rams ? 'a ram' : ''].filter(Boolean).join(' and '),
  ].filter(Boolean)
  return `${f.troops} soldier${f.troops === 1 ? '' : 's'}${parts.length ? `: ${parts.join('; ')}` : ''}`
}

/** What a camp puts in the field, at a given strength: orcs behind a stockade, goblins in the open, one troll
 *  (bigger for a bigger lair), the dragon with whatever strength it has left. */
export function foeOf(c: Camp, strength = c.lair.strength): Pick<Setup, 'foe' | 'orcs' | 'walls' | 'trollHp' | 'dragonHp'> {
  switch (c.lair.kind) {
    case 'orcs': return { foe: 'orcs', orcs: orcsOf(strength), walls: true }
    case 'goblins': return { foe: 'goblins', orcs: goblinsOf(strength), walls: false }
    case 'trolls': return { foe: 'troll', orcs: 0, walls: false, trollHp: Math.max(30, 6 * strength) }
    default: return { foe: 'dragon', orcs: 0, walls: false, dragonHp: c.state.dragonHp ?? MONSTERS.dragon.hp }
  }
}
const setupOf = (f: Fitting, foe: ReturnType<typeof foeOf>, strategy: Strategy, intel: number): Setup =>
  ({ attackers: f.soldiers.map((x) => x.kit), ...foe, rams: f.rams, ladders: f.ladders, strategy, intel })

// ------------------------------------------------------------------ the forecast

// quantiles of the normal, to average over what we believe of the camp
const Q = [-1.6, -1.1, -0.7, -0.35, 0, 0.35, 0.7, 1.1, 1.6]
/** Fights run at each of them for a forecast. */
const RUNS = 3

export interface Forecast {
  /** chance of winning as the council sees it, with an 80% range */
  chance: number; low: number; high: number
  /** soldiers who may fall (lost, wounded or taken): expected, and a range; and of them, lost for good */
  fall: number; fallLow: number; fallHigh: number; lost: number
  /** what the hoard may hold: the council's guess and a range, by good */
  booty: { good: Good; guess: number; low: number; high: number }[]
  /** how many times it's been scouted, and how sure the council is (0..1) */
  intel: number; sure: number
  /** the council's guess at the camp's strength */
  strength: number
  fitting: Fitting
}
const memo = new Map<string, Forecast>()

/** What the war council expects of raiding camp `c` with these soldiers and this plan, knowing what it has
 *  scouted: the fight run many times over what it believes of the camp. */
export function forecast(s: GameState, c: Camp, groups: Group[], strategy: Strategy, at: string): Forecast {
  const n = Math.min(c.state.intel, MAX_INTEL)
  const sd = SPREAD[n]
  // each scouting gives a fresh reading, a little off: closer the more it's been watched
  const read = camp_rng(s, c, 'read', n)
  const guess = c.lair.strength * Math.exp(sd * normal(read) * 0.55)
  const fitting = quartermaster(groups)
  const hoard = hoardOf(s, c, at)
  const key = JSON.stringify([s.worldSeed, c.idx, c.state.raids, n, strategy, Math.round(guess * 100), c.state.dragonHp, fitting.soldiers.map((x) => x.kit), fitting.ladders, fitting.rams, hoard])
  const hit = memo.get(key)
  if (hit) return hit
  const wins: number[] = [], falls: number[] = []
  let lost = 0
  for (let qi = 0; qi < Q.length; qi++) {
    const S = guess * Math.exp(sd * Q[qi])
    wins[qi] = 0
    for (let k = 0; k < RUNS; k++) {
      const r = fitting.troops ? battle(setupOf(fitting, foeOf(c, S), strategy, n / MAX_INTEL), rngFor(s.worldSeed, 'forecast', c.idx, c.state.raids, n, qi, k)) : null
      if (r?.win) wins[qi] += 1 / RUNS
      falls.push(r ? r.fates.filter((f) => f === 'lost' || f === 'wounded' || f === 'captured').length : 0)
      lost += r ? r.fates.filter((f) => f === 'lost').length / (Q.length * RUNS) : 0
    }
  }
  falls.sort((p, q) => p - q)
  const br = camp_rng(s, c, 'booty', n)
  const booty = (Object.entries(hoard) as [Good, number][]).filter(([, x]) => x > 0).map(([good, x]) => {
    const g = x * Math.exp(sd * normal(br) * 0.55)
    return { good, guess: g, low: g * Math.exp(-sd * 1.28), high: g * Math.exp(sd * 1.28) }
  })
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length)
  const out: Forecast = {
    chance: mean(wins), low: mean(wins.slice(-2)), high: mean(wins.slice(0, 2)),
    fall: mean(falls), fallLow: falls[Math.floor(falls.length * 0.1)] ?? 0, fallHigh: falls[Math.min(falls.length - 1, Math.floor(falls.length * 0.9))] ?? 0, lost,
    booty, intel: n, sure: 1 - sd / SPREAD[0], strength: guess, fitting,
  }
  if (memo.size > 200) memo.clear()
  memo.set(key, out)
  return out
}

// ------------------------------------------------------------------ the fight

/** How each village's soldiers came out of a fight. */
export interface Tally { lost: number; wounded: number; captured: number; ran: number; unhurt: number }
export const tallyText = (t: Tally) =>
  [t.lost && `${t.lost} lost`, t.wounded && `${t.wounded} wounded`, t.captured && `${t.captured} taken prisoner`].filter(Boolean).join(', ') || 'all came home unhurt'

export interface RaidResult {
  win: boolean
  fitting: Fitting
  /** what became of each soldier the quartermaster fitted out, in order */
  fates: Fate[]
  /** by village */
  tally: Record<string, Tally>
  /** kit each group left on the field (a loss: what the fallen carried, and the ladders and ram) */
  kitLost: Goods[]
  /** what happened, a line at a time, in our voice */
  story: string[]
  /** each village's share of the hoard (a win only) */
  shares: Record<string, Goods>
  hoard: Goods
  /** the camp broke up for good (or the dragon fell) */
  broken: boolean
  /** the dragon's strength after the fight */
  dragonLeft?: number
  /** how many of them were left standing */
  standing: number
}

/** Who came out how, by village, and the kit the fallen left behind (on a lost field). */
function outcome(groups: Group[], f: Fitting, fates: Fate[], win: boolean) {
  const tally: Record<string, Tally> = {}
  const kitLost: Goods[] = groups.map(() => ({}))
  f.soldiers.forEach((x, k) => {
    const vid = groups[x.group].village
    const t = (tally[vid] ??= { lost: 0, wounded: 0, captured: 0, ran: 0, unhurt: 0 })
    t[fates[k]]++
    if (!win && (fates[k] === 'lost' || fates[k] === 'captured')) for (const it of x.items) kitLost[it.from][it.good] = (kitLost[it.from][it.good] ?? 0) + 1
  })
  if (!win) for (const c of f.carried) kitLost[c.from][c.good] = (kitLost[c.from][c.good] ?? 0) + c.n
  return { tally, kitLost }
}

/** The battle's story, told once: repeated lines (a ladder climbed, some losing their nerve) become one with a total. */
export function retell(lines: string[]): string[] {
  const sentences = lines.flatMap((l) => l.match(/[^.!]+[.!]/g)?.map((x) => x.trim()) ?? [l])
  const out: (string | { key: string })[] = []
  const totals = new Map<string, number>()
  const add = (key: string, n: number) => { if (!totals.has(key)) out.push({ key }); totals.set(key, (totals.get(key) ?? 0) + n) }
  for (const x of sentences) {
    let m
    if ((m = x.match(/^One of (us|them) got over (?:their|our) logs on a ladder\.$/))) add(`ladder|${m[1]}`, 1)
    else if ((m = x.match(/^(\d+) of (us|them) lost (?:our|their) nerve and ran\.$/))) add(`ran|${m[2]}`, +m[1])
    else if ((m = x.match(/^(\d+) of (us|them) (?:took heart and came back|came back to the fight)\.$/))) add(`back|${m[2]}`, +m[1])
    else if (!out.includes(x)) out.push(x)
  }
  return out.map((x) => {
    if (typeof x === 'string') return x
    const [k, who] = x.key.split('|'), n = totals.get(x.key)!
    const us = who === 'us'
    if (k === 'ladder') return n === 1 ? `One of ${who} got over ${us ? 'their' : 'our'} logs on a ladder.` : `${n} of ${who} got over ${us ? 'their' : 'our'} logs on ladders.`
    if (k === 'ran') return `${n} of ${who} lost ${us ? 'our' : 'their'} nerve and ran.`
    return us ? `${n} of us took heart and came back.` : `${n} of them came back to the fight.`
  })
}

/** Fight it out: our raid on a camp. Changes nothing: the reducer applies the result. */
export function fight(s: GameState, c: Camp, groups: Group[], strategy: Strategy, at: string): RaidResult {
  const fitting = quartermaster(groups)
  const r = battle(setupOf(fitting, foeOf(c), strategy, Math.min(c.state.intel, MAX_INTEL) / MAX_INTEL), camp_rng(s, c, 'fight', at))
  const { tally, kitLost } = outcome(groups, fitting, r.fates, r.win)
  const hoard = r.win ? hoardOf(s, c, at) : {}
  const shares: Record<string, Goods> = {}
  if (r.win) {
    const by: Record<string, number> = {}
    for (const g of groups) by[g.village] = (by[g.village] ?? 0) + g.troops
    for (const [vid, n] of Object.entries(by)) {
      const k = n / Math.max(1, fitting.troops)
      shares[vid] = Object.fromEntries(Object.entries(hoard).map(([g, x]) => [g, Math.round((x ?? 0) * k * 100) / 100]).filter(([, x]) => (x as number) > 0))
    }
  }
  const broken = c.lair.kind === 'dragon' ? r.dragonLeft === 0 : r.win && c.lair.strength * 0.6 < BREAK_UP
  return { win: r.win, fitting, fates: r.fates, tally, kitLost, story: retell(r.story.slice(0, -1)), shares, hoard, broken, dragonLeft: r.dragonLeft, standing: r.b.n - r.b.dead - r.b.fled }
}

/** Orcs carry off this much plunder each (lb), and never more than this share of any one good in store. */
export const CARRY_LB = 25
export const PLUNDER_SHARE = 0.25
/** A night raid is a band: this share of the camp. It takes a few prisoners at most. */
export const NIGHT_BAND = 0.3
export const NIGHT_CAPTIVES = 2
/** A camp left alone grows this much stronger a week (a little each day), and night raids come this much more
 *  often for every week since RAIDS_FROM, up to MAX_PRESSURE times as often. */
export const CAMP_GROWTH = 0.05
export const RAID_PRESSURE = 0.25
export const MAX_PRESSURE = 3
const METALS: Good[] = ['copper', 'bronze', 'iron', 'steel', 'silver', 'tin']

export interface DefenceResult {
  /** we held */
  win: boolean
  orcs: number
  fitting: Fitting
  fates: Fate[]
  tally: Record<string, Tally>
  kitLost: Goods[]
  story: string[]
  /** what they carried off from the stores (a loss), and the armoury (kit in store) if the palisade fell */
  plunder: Goods
  /** how many of them were left standing */
  standing: number
}

/** A band from camp `c` comes at village `v` in the night. Every able adult turns out (half the village), with
 *  any soldiers on its walls, fitted out from its stores (`groups`, the village's own first); behind a palisade
 *  they hold the fighting step. */
export function defend(s: GameState, c: Camp, v: Village, groups: Group[], walls: boolean, at: string): DefenceResult {
  const fitting = quartermaster(groups)
  const orcs = Math.max(3, Math.round(orcsOf(c.lair.strength) * NIGHT_BAND))
  const r = battle({
    attackers: fitting.soldiers.map((x) => x.kit), foe: c.lair.kind === 'goblins' ? 'goblins' : 'orcs', orcs, walls, raid: true,
    rams: walls && c.lair.strength >= 15 ? 1 : 0, ladders: walls ? Math.ceil(orcs / 4) : 0, strategy: 'assault', defendingHome: true, captives: NIGHT_CAPTIVES,
  }, camp_rng(s, c, 'night', v.id, at))
  const { tally, kitLost } = outcome(groups, fitting, r.fates, r.win)
  const standing = r.b.n - r.b.dead - r.b.fled
  const plunder: Goods = {}
  if (!r.win) {
    // the armoury, if they took the palisade; then what they can carry from the stores, food first, then metal
    if (walls) for (const g of KIT) { const n = Math.floor(v.goods[g] ?? 0) - (kitLost[0]?.[g] ?? 0); if (n > 0) plunder[g] = n }
    let room = CARRY_LB * standing
    const order = (Object.keys(v.goods) as Good[]).filter((g) => !KIT.includes(g) && (v.goods[g] ?? 0) > 0)
      .sort((p, q) => Number(!FOOD[p]) - Number(!FOOD[q]) || Number(!METALS.includes(p)) - Number(!METALS.includes(q)))
    for (const g of order) {
      if (room <= 0) break
      const x = Math.min((v.goods[g] ?? 0) * PLUNDER_SHARE, room / WEIGHT[g])
      // food by the ration's worth, everything else in whole pieces
      const n = FOOD[g] ? Math.floor(x * FOOD[g]!.value) / FOOD[g]!.value : Math.floor(x)
      if (n <= 0) continue
      plunder[g] = n
      room -= n * WEIGHT[g]
    }
  }
  return { win: r.win, orcs, fitting, fates: r.fates, tally, kitLost, story: retell(r.story.slice(1, -1)), plunder, standing }
}

/** Camps a village could raid from its palisade. */
export const campsInReach = (s: GameState, v: Village, width?: number) =>
  campsOf(s).filter((c) => distance(c.lair, v) <= RAID_RANGE && (width === undefined || s.revealed.includes(c.lair.row * width + c.lair.col)))
