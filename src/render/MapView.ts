/** Pixi map renderer.
 *
 *  Chunky pixels: the canvas is rendered at *art* resolution (1 canvas px =
 *  1 sprite px) and upscaled by CSS with `image-rendering: pixelated`, so
 *  every zoom level is a clean integer scale and nothing is ever smoothed.
 *
 *  Painter's order: rows top to bottom, even columns before odd ones (odd
 *  columns sit half a hex lower). Each hex draws terrain column, river,
 *  then whatever stands on it, so nearer hexes correctly cover farther ones.
 */
import { Application, Container, Graphics, Sprite } from 'pixi.js'
import { hexToPixel, neighbours, pixelToHex } from '../world/hex'
import type { World } from '../world/types'
import type { BuildingId } from '../game/data'
import type { GameState } from '../game/types'
import { territoryCells } from '../game/reducer'
import type { Atlas } from './atlas'

export interface SceneInput {
  world: World
  state: GameState
  viewer: string | null
  selected: { col: number; row: number } | null
  highlight?: number[] // cells to tint (e.g. valid targets)
  today: string
}

const BUILDING_SPRITE: Partial<Record<BuildingId, string>> = {
  garden: 'f_farm', field: 'f_farm', irrigation: 'f_farm', orchard: 'f_oak3', mill: 'f_hut',
  shore_fishery: 'f_dock', docks: 'f_dock', shipyard: 'f_dock', salt_pans: 'f_farm', smokehouse: 'f_hut',
  quarry: 'f_mine', copper_mine: 'f_mine', iron_mine: 'f_mine', kiln: 'f_hut', smelter: 'f_hut', bloomery: 'f_hut', bronze_foundry: 'f_hut',
  lumber_camp: 'f_hut', forager_camp: 'f_hut', hunting_lodge: 'f_hut', charcoal_kiln: 'f_hut', sawmill: 'f_hut',
  pen: 'f_hut', dairy: 'f_hut', weaver: 'f_hut', scout_camp: 'f_hut', outfitter: 'f_hut',
  house: 'f_hut', granary: 'f_hut', palisade: 'f_hut', chapel: 'f_hut', library: 'f_hut', market: 'f_village',
}
const MONSTER_SPRITE = { goblins: 'f_goblins', orcs: 'f_orcs', trolls: 'f_troll', dragon: 'f_dragon' } as const

export class MapView {
  app = new Application()
  root = new Container()
  cells = new Container()
  overlay = new Container()
  zoom = typeof window !== "undefined" && window.innerWidth < 700 ? 1 : 2
  camX = 0
  camY = 0
  private host!: HTMLElement
  private ro?: ResizeObserver
  private last: SceneInput | null = null
  onSelect: (col: number, row: number) => void = () => {}

  atlas: Atlas
  constructor(atlas: Atlas) {
    this.atlas = atlas
  }

  get W() { return this.atlas.meta.size }

  async mount(host: HTMLElement) {
    this.host = host
    await this.app.init({ width: 10, height: 10, antialias: false, background: '#141424', resolution: 1, roundPixels: true })
    const c = this.app.canvas
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.imageRendering = 'pixelated'
    c.style.touchAction = 'none'
    c.style.display = 'block'
    host.appendChild(c)
    this.root.addChild(this.cells, this.overlay)
    this.app.stage.addChild(this.root)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    this.bindInput()
  }

  destroy() {
    this.ro?.disconnect()
    this.app.destroy(true, { children: true })
  }

  resize() {
    const w = Math.max(1, Math.ceil(this.host.clientWidth / this.zoom))
    const h = Math.max(1, Math.ceil(this.host.clientHeight / this.zoom))
    this.app.renderer.resize(w, h)
    this.applyCamera()
  }

  setZoom(z: number, anchor?: { x: number; y: number }) {
    const nz = Math.max(1, Math.min(6, Math.round(z)))
    if (nz === this.zoom) return
    // keep the art pixel under the anchor (CSS px) fixed
    const ax = anchor?.x ?? this.host.clientWidth / 2
    const ay = anchor?.y ?? this.host.clientHeight / 2
    const wx = this.camX + ax / this.zoom
    const wy = this.camY + ay / this.zoom
    this.zoom = nz
    this.camX = wx - ax / nz
    this.camY = wy - ay / nz
    this.resize()
  }

  /** yFrac: where on screen the hex should land (0 = top). Phones keep it
   *  above the bottom sheet. */
  centreOn(col: number, row: number, tier = 0, yFrac = this.host.clientWidth < 900 ? 0.27 : 0.5) {
    const p = hexToPixel(col, row, this.W)
    this.camX = p.x - this.app.renderer.width / 2
    this.camY = p.y - tier * this.atlas.meta.tier - this.app.renderer.height * yFrac
    this.applyCamera()
  }

  private applyCamera() {
    this.root.x = -Math.round(this.camX)
    this.root.y = -Math.round(this.camY)
  }

  // ---------------------------------------------------------------- scene

  render(input: SceneInput) {
    this.last = input
    const { world, state, viewer } = input
    const { tier: TP } = this.atlas.meta
    const W = this.W
    this.cells.removeChildren().forEach((c) => c.destroy())
    this.overlay.removeChildren().forEach((c) => c.destroy())

    const player = viewer ? state.players[viewer] : null
    const revealed = new Set(player?.revealed ?? world.cells.map((_, i) => i))
    // draw box: revealed bounds + margin of fog
    let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity
    for (const i of revealed) {
      const c = i % world.width, r = Math.floor(i / world.width)
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r)
    }
    const M = 4
    c0 = Math.max(0, c0 - M); r0 = Math.max(0, r0 - M)
    c1 = Math.min(world.width - 1, c1 + M); r1 = Math.min(world.height - 1, r1 + M)

    // lookup tables for things standing on hexes
    const things = new Map<number, { name: string; alpha?: number }>()
    const idx = (c: number, r: number) => r * world.width + c
    for (const l of state.lairs) if (!l.cleared) things.set(idx(l.col, l.row), { name: MONSTER_SPRITE[l.kind] })
    for (const v of Object.values(state.villages)) {
      for (const b of v.buildings) things.set(idx(b.col, b.row), { name: BUILDING_SPRITE[b.type] ?? 'f_hut', alpha: b.progress < 1 ? 0.55 : 1 })
      for (const o of v.outposts) things.set(idx(o.col, o.row), { name: 'f_hut' })
      for (const p of v.planted) things.set(p.cell, { name: input.today && p.date <= input.today && daysOld(p.date, input.today) >= 3 ? 'f_oak3' : 'f_oak1' })
      things.set(idx(v.col, v.row), { name: 'f_village' })
    }

    const order: number[] = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0 + (c0 & 1 ? 1 : 0); c <= c1; c += 2) order.push(idx(c, r))
      for (let c = c0 + (c0 & 1 ? 0 : 1); c <= c1; c += 2) order.push(idx(c, r))
    }
    const hl = new Set(input.highlight ?? [])

    for (const i of order) {
      const cell = world.cells[i]
      const known = revealed.has(i)
      const p = hexToPixel(cell.col, cell.row, W)
      const tier = known ? cell.tier : 0
      const cx = p.x, cy = p.y - tier * TP
      const terrainName = known ? `t_${cell.terrain}_${(cell.col * 7 + cell.row * 13) % 3}` : `t_deep_${(cell.col + cell.row) % 3}`
      const t = this.atlas.tex(terrainName)
      if (t) {
        const s = new Sprite(t.texture)
        s.x = cx - t.frame.ax
        s.y = cy - t.frame.ay
        if (!known) s.tint = 0x3a3a58
        else if (hl.has(i)) s.tint = 0xfff0a0
        this.cells.addChild(s)
      }
      if (!known) continue
      if (cell.riverTo !== -1 && cell.tier > 0) this.cells.addChild(this.river(world, i, cx, cy))
      const thing = things.get(i)
      const name = thing?.name ?? (cell.feature ? `f_${cell.feature}` : null)
      const f = name ? this.atlas.tex(name) : null
      if (f) {
        const s = new Sprite(f.texture)
        s.x = cx - f.frame.ax
        s.y = cy - f.frame.ay
        s.alpha = thing?.alpha ?? 1
        this.cells.addChild(s)
      }
    }

    // territory borders + selection on top
    const g = new Graphics()
    for (const v of Object.values(state.villages)) {
      const mine = v.playerId === viewer
      const terr = new Set(territoryCells(world, v))
      for (const i of terr) {
        const cell = world.cells[i]
        if (!revealed.has(i)) continue
        const p = hexToPixel(cell.col, cell.row, W)
        const cy = p.y - cell.tier * TP
        const corners = hexCorners(p.x, cy, W)
        neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
          const ni = nr * world.width + nc
          if (terr.has(ni)) return
          const [a, b] = EDGE_CORNERS[k]
          g.moveTo(corners[a][0], corners[a][1]).lineTo(corners[b][0], corners[b][1])
        })
      }
      g.stroke({ width: 1, color: mine ? 0xfff070 : 0xff90c0, alpha: 0.9 })
    }
    if (input.selected) {
      const { col, row } = input.selected
      const cell = world.cells[idx(col, row)]
      if (cell) {
        const p = hexToPixel(col, row, W)
        const tier = revealed.has(idx(col, row)) ? cell.tier : 0
        const cs = hexCorners(p.x, p.y - tier * TP, W)
        g.poly(cs.flat(), true).stroke({ width: 2, color: 0xffffff })
      }
    }
    // caravans on the road
    const now = Date.now()
    for (const cv of state.caravans) {
      const a = state.villages[cv.from], b = state.villages[cv.to]
      const f = this.atlas.tex('f_caravan')
      if (!a || !b || !f) continue
      const t0 = Date.parse(cv.departAt), t1 = Date.parse(cv.arriveAt)
      const k = Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)))
      const pa = hexToPixel(a.col, a.row, W), pb = hexToPixel(b.col, b.row, W)
      const ta = world.cells[idx(a.col, a.row)].tier, tb = world.cells[idx(b.col, b.row)].tier
      const s = new Sprite(f.texture)
      s.x = Math.round(pa.x + (pb.x - pa.x) * k - f.frame.ax)
      s.y = Math.round(pa.y - ta * TP + (pb.y - tb * TP - pa.y + ta * TP) * k - f.frame.ay)
      this.overlay.addChild(s)
    }
    this.overlay.addChildAt(g, 0)
  }

  private river(world: World, i: number, cx: number, cy: number): Graphics {
    const W = this.W
    const TP = this.atlas.meta.tier
    const cell = world.cells[i]
    const g = new Graphics()
    const width = Math.max(2, Math.round(W / 24) + Math.min(3, Math.floor(cell.riverFlow / 6)))
    const pts: [number, number][] = []
    // segment toward the downstream hex, ending at the shared edge
    const down = world.cells[cell.riverTo]
    const dp = hexToPixel(down.col, down.row, W)
    pts.push([(cx + dp.x) / 2, (cy + dp.y - cell.tier * TP) / 2])
    // segments from upstream hexes
    const ups: [number, number][] = []
    for (const [nc, nr] of neighbours(cell.col, cell.row)) {
      if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
      const ni = nr * world.width + nc
      if (world.cells[ni].riverTo === i) {
        const up = hexToPixel(nc, nr, W)
        ups.push([(cx + up.x) / 2, (cy + up.y - cell.tier * TP) / 2])
      }
    }
    const draw = (color: number, w: number) => {
      g.moveTo(cx, cy).lineTo(pts[0][0], pts[0][1])
      for (const u of ups) g.moveTo(u[0], u[1]).lineTo(cx, cy)
      g.stroke({ width: w, color, cap: 'round', join: 'round' })
    }
    draw(0x2868b8, width + 2)
    draw(0x50a8f0, width)
    return g
  }

  // ---------------------------------------------------------------- input

  private pick(cssX: number, cssY: number) {
    const s = this.last
    if (!s) return null
    const x = this.camX + cssX / this.zoom
    const y = this.camY + cssY / this.zoom
    const TP = this.atlas.meta.tier
    const revealed = s.viewer ? new Set(s.state.players[s.viewer]?.revealed ?? []) : null
    let best: { col: number; row: number; depth: number } | null = null
    for (let t = 0; t <= this.atlas.meta.maxTier; t++) {
      const h = pixelToHex(x, y + t * TP, this.W)
      if (h.col < 0 || h.row < 0 || h.col >= s.world.width || h.row >= s.world.height) continue
      const i = h.row * s.world.width + h.col
      const tier = !revealed || revealed.has(i) ? s.world.cells[i].tier : 0
      if (tier !== t) continue
      const depth = h.row * 2 + (h.col & 1)
      if (!best || depth > best.depth) best = { ...h, depth }
    }
    return best
  }

  private bindInput() {
    const c = this.app.canvas
    const pts = new Map<number, { x: number; y: number }>()
    let moved = 0
    let pinch0 = 0, zoom0 = this.zoom
    const rel = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, rel(e))
      moved = 0
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
        zoom0 = this.zoom
      }
    })
    c.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId)
      if (!prev) return
      const p = rel(e)
      pts.set(e.pointerId, p)
      if (pts.size === 1) {
        const dx = p.x - prev.x, dy = p.y - prev.y
        moved += Math.abs(dx) + Math.abs(dy)
        this.camX -= dx / this.zoom
        this.camY -= dy / this.zoom
        this.applyCamera()
      } else if (pts.size === 2 && pinch0 > 0) {
        moved = 99
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        this.setZoom(zoom0 * (d / pinch0), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    })
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch0 = 0
      if (p && moved < 8 && pts.size === 0) {
        const h = this.pick(p.x, p.y)
        if (h) this.onSelect(h.col, h.row)
      }
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top })
    }, { passive: false })
  }
}

/** Corners of the projected top face (flat-top hex squashed to W x W/2),
 *  clockwise from the right-hand point. */
function hexCorners(cx: number, cy: number, W: number): [number, number][] {
  const hw = W / 2, qw = W / 4, hh = W / 4
  return [[cx + hw, cy], [cx + qw, cy + hh], [cx - qw, cy + hh], [cx - hw, cy], [cx - qw, cy - hh], [cx + qw, cy - hh]]
}

// neighbour order from hex.ts: NE, SE, S, SW, NW, N  ->  matching face edge (corner pairs)
const EDGE_CORNERS: [number, number][] = [[5, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]

function daysOld(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}
