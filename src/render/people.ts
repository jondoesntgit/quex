/** Tiny villagers (about 3×6 px) pottering about each village's territory: from
 *  the village square to its buildings, roads and fields, a short pause to
 *  "work", then home again. Purely cosmetic and per-device; never in the event log.
 *
 *  Walkers hop hex to hex through the village's own land, so they climb tier
 *  steps instead of floating across the map. */
import { Container, Graphics } from 'pixi.js'
import { hexToPixel, neighbours } from '../world/hex'
import { mulberry32, hashString } from '../world/rng'
import type { World } from '../world/types'
import type { GameState, Village } from '../game/types'
import { territoryCells } from '../game/reducer'

const SHIRT: Record<string, number> = {
  farm: 0xe8c040, port: 0x4878d8, mining: 0x9a9ab0, forestry: 0x3c8c3c, herding: 0xe0e0d0, explorer: 0xc04878,
}
const SKIN = [0xf0c8a0, 0xd8a070, 0xa06840, 0x704828]
const STAND = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', '.oLLo.', '.oLLo.', '.oooo.']
const WALK = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', 'oSSSSo', 'ooSSoo', 'oLooLo', 'oLooLo', 'oooooo']
const WORK_UP = ['.oooo.T', '.oHHoT', '.oHHSo', 'ooSSoo', '.oSSo.', '.oSSo.', '.oLLo.', '.oLLo.', '.oooo.']
const WORK_DOWN = ['.oooo.', '.oHHo.', '.oHHo.', 'ooSSoo', '.oSSSo', '.oSSoT', '.oLLoT', '.oLLo.', '.oooo.']
const SPEED = 9 // art px per second

interface Walker {
  g: Graphics
  path: number[] // cell indices, current position between path[seg] and path[seg+1]
  seg: number
  t: number // 0..1 along the segment
  wait: number // seconds left working/resting
  jitter: [number, number][] // per-cell foot offset so they don't all walk the centre line
  home: number
  rng: () => number
  frame: number
  shirt: number
  skin: number
}

export class People {
  layer = new Container()
  private walkers: Walker[] = []
  private sig = ''
  private world!: World
  private W: number
  private TP: number
  private targets = new Map<string, { home: number; spots: number[]; land: Set<number> }>()

  constructor(W: number, TP: number) {
    this.W = W
    this.TP = TP
  }

  /** Rebuild the crowd only when villages, buildings, roads or territory change. */
  sync(world: World, state: GameState, revealed: Set<number>) {
    this.world = world
    const vs = Object.values(state.villages)
    const sig = vs.map((v) => `${v.id}:${Math.floor(v.population)}:${v.buildings.length}:${v.roads.length}:${v.outposts.length}`).join('|')
    if (sig === this.sig) return
    this.sig = sig
    for (const w of this.walkers) w.g.destroy()
    this.walkers = []
    this.layer.removeChildren()
    for (const v of vs) this.spawn(world, v, revealed)
  }

  private spawn(world: World, v: Village, revealed: Set<number>) {
    const idx = (c: number, r: number) => r * world.width + c
    const home = idx(v.col, v.row)
    const land = new Set(territoryCells(world, v).filter((i) => world.cells[i].tier > 0 && revealed.has(i)))
    for (const i of v.roads) land.add(i)
    const spots = [
      ...v.buildings.map((b) => idx(b.col, b.row)),
      ...v.outposts.map((o) => idx(o.col, o.row)),
      ...v.roads,
    ].filter((i) => land.has(i))
    // a few wander spots so a brand-new village still has life
    const rest = [...land].filter((i) => i !== home)
    const rng = mulberry32(hashString(v.id))
    for (let k = 0; k < 3 && rest.length; k++) spots.push(rest[Math.floor(rng() * rest.length)])
    this.targets.set(v.id, { home, spots, land })
    const n = Math.min(10, Math.max(2, Math.floor(v.population / 2) + Math.floor(v.buildings.length / 2)))
    for (let k = 0; k < n; k++) {
      const r = mulberry32(hashString(`${v.id}-${k}`))
      const w: Walker = {
        g: new Graphics(), path: [home], seg: 0, t: 0, wait: r() * 4, jitter: [], home, rng: r, frame: 0,
        shirt: SHIRT[v.role] ?? 0xd0d0d0, skin: SKIN[Math.floor(r() * SKIN.length)],
      }
      this.layer.addChild(w.g)
      this.walkers.push(w)
      this.plan(w, v.id)
      // start somewhere along the route so they don't all leave home together
      w.seg = Math.floor(r() * Math.max(1, w.path.length - 1))
      w.t = r()
    }
  }

  /** Breadth-first route through the village's land from where it stands to a new target. */
  private plan(w: Walker, vid: string) {
    const T = this.targets.get(vid)!
    const from = w.path[Math.min(w.seg + 1, w.path.length - 1)]
    const goal = from === T.home && T.spots.length ? T.spots[Math.floor(w.rng() * T.spots.length)] : T.home
    const prev = new Map<number, number>([[from, -1]])
    const q = [from]
    const world = this.world
    while (q.length) {
      const i = q.shift()!
      if (i === goal) break
      const c = world.cells[i]
      for (const [nc, nr] of neighbours(c.col, c.row)) {
        if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
        const j = nr * world.width + nc
        if (!T.land.has(j) || prev.has(j)) continue
        if (Math.abs(world.cells[j].tier - c.tier) > 2) continue // too high to climb
        prev.set(j, i)
        q.push(j)
      }
    }
    const path: number[] = []
    if (prev.has(goal)) for (let i = goal; i !== -1; i = prev.get(i)!) path.unshift(i)
    else path.push(from)
    w.path = path
    w.seg = 0
    w.t = 0
    w.jitter = path.map((_, k) => (k === 0 || k === path.length - 1)
      ? [Math.round((w.rng() - 0.5) * this.W * 0.35), Math.round((w.rng() - 0.5) * this.W * 0.15)]
      : [Math.round((w.rng() - 0.5) * this.W * 0.15), Math.round((w.rng() - 0.5) * this.W * 0.06)])
    ;(w as Walker & { vid?: string }).vid = vid
  }

  private foot(i: number, j: [number, number]) {
    const c = this.world.cells[i]
    const p = hexToPixel(c.col, c.row, this.W)
    return { x: p.x + j[0], y: p.y - c.tier * this.TP + j[1] }
  }

  update(dt: number) {
    if (!this.world) return
    for (const w of this.walkers) {
      const vid = (w as Walker & { vid?: string }).vid!
      let moving = false
      if (w.wait > 0) {
        w.wait -= dt
      } else if (w.seg >= w.path.length - 1) {
        w.wait = 1.5 + w.rng() * 4
        this.plan(w, vid)
      } else {
        const a = this.foot(w.path[w.seg], w.jitter[w.seg])
        const b = this.foot(w.path[w.seg + 1], w.jitter[w.seg + 1])
        const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
        w.t += (SPEED * dt) / len
        if (w.t >= 1) { w.seg++; w.t = 0 }
        moving = true
      }
      const k = Math.min(w.seg, w.path.length - 1)
      const a = this.foot(w.path[k], w.jitter[k])
      const b = k + 1 < w.path.length ? this.foot(w.path[k + 1], w.jitter[k + 1]) : a
      const x = Math.round(a.x + (b.x - a.x) * w.t)
      const y = Math.round(a.y + (b.y - a.y) * w.t)
      w.frame += dt * (moving ? 6 : 1.5)
      const f = Math.floor(w.frame) & 1
      this.draw(w, x, y, f, !moving && w.wait > 0)
    }
  }

  /** 6×9 px villager, feet at (x, y). Rows top to bottom; o outline, H skin,
   *  S shirt, L legs, T tool. */
  private draw(w: Walker, x: number, y: number, step: number, working: boolean) {
    const fig = working ? (step ? WORK_UP : WORK_DOWN) : step ? WALK : STAND
    const col: Record<string, number> = { o: 0x1c1828, H: w.skin, S: w.shirt, L: 0x5a4630, T: 0xa08050 }
    const g = w.g
    g.clear()
    const top = y - fig.length + 1
    fig.forEach((rowStr, r) => {
      for (let c = 0; c < rowStr.length; c++) {
        const ch = rowStr[c]
        if (ch !== '.') g.rect(x - 3 + c, top + r, 1, 1).fill(col[ch])
      }
    })
  }
}
