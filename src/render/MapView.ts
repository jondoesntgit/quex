/** Pixi map renderer.
 *
 *  Chunky pixels: the canvas is rendered at *art* resolution (1 canvas px =
 *  1 sprite px) and upscaled by CSS with `image-rendering: pixelated`, so
 *  every zoom level >= 1 is a clean integer scale and nothing is smoothed.
 *  Below 1 (overview zooms) the canvas is screen-sized and the scene is
 *  scaled down instead, so the whole continent fits on screen.
 *
 *  Painter's order: rows top to bottom, even columns before odd ones (odd
 *  columns sit half a hex lower). Each hex draws terrain column, river,
 *  then whatever stands on it, so nearer hexes correctly cover farther ones.
 */
import { Application, Container, CullerPlugin, extensions, Graphics, Sprite } from 'pixi.js'
import { Ambient } from './ambient'
import { Mountains } from './mountains'
import { mulberry32 } from '../world/rng'
import { extend, riverLayout, roadLayout } from './waterways'
import { drawBridge } from './bridge'
import { hexToPixel, neighbours, pixelToHex } from '../world/hex'
import type { World } from '../world/types'
import type { BuildingId } from '../game/data'
import type { GameState } from '../game/types'
import { landAt, territoryCells } from '../game/reducer'
import { isDeposit } from '../world/land'
import { People } from './people'
import { Traders } from './traders'
import type { Atlas } from './atlas'

export interface SceneInput {
  world: World
  state: GameState
  viewer: string | null
  selected: { col: number; row: number } | null
  highlight?: number[] // cells to tint (e.g. valid targets)
  blocked?: number[] // cells to tint red (e.g. too close to a neighbour)
  /** a hex someone sent a link to: marked in pink */
  focus?: number
  /** lift the fog (choosing where to found a village) */
  showAll?: boolean
  /** a guest: no player, but sees only what the world's players have explored */
  guest?: boolean
  /** prospecting: dim everything except deposits worth mining or gathering */
  prospect?: boolean
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
  people!: People
  traders!: Traders
  /** surf, glints, swaying trees, shimmering fields */
  ambient!: Ambient
  /** mountain ranges drawn from one height map (cached per world) */
  private mountains: Mountains | null = null
  zoom = typeof window !== "undefined" && window.innerWidth < 700 ? 1 : 2
  /** CSS upscale of the canvas (zoom >= 1) */
  private get cssScale() { return Math.max(1, this.zoom) }
  /** scene scale inside the canvas (zoom < 1) */
  private get sceneScale() { return Math.min(1, this.zoom) }
  camX = 0
  camY = 0
  private host!: HTMLElement
  private ro?: ResizeObserver
  private last: SceneInput | null = null
  onSelect: (col: number, row: number) => void = () => {}

  atlas: Atlas
  constructor(atlas: Atlas) {
    this.atlas = atlas
    this.people = new People(atlas.meta.size, atlas.meta.tier)
    this.traders = new Traders(atlas)
  }

  get W() { return this.atlas.meta.size }

  async mount(host: HTMLElement) {
    this.host = host
    // villagers live inside `cells` so they sort into the painter's order with trees and houses
    this.cells.sortableChildren = true
    this.root.addChild(this.cells, this.overlay)
    await this.startRenderer()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    document.addEventListener('visibilitychange', this.onVisible)
  }

  /** Create the Pixi app and canvas. Also used to rebuild after the GPU context
   *  is lost (laptop sleep, graphics switch) and the browser doesn't give it
   *  back: the scene and the tile images are still in memory, so no network. */
  private async startRenderer(): Promise<void> {
    // WebGL by default (its context loss/restore is the best supported path);
    // ?renderer=canvas|webgl|webgpu overrides, and a failed texture check
    // below falls back to the canvas renderer.
    await this.app.init({ width: 10, height: 10, antialias: false, background: '#141424', resolution: 1, roundPixels: true, preference: this.preference })
    if (this.preference !== 'canvas' && !this.texturesWork()) {
      console.warn(`Tiles render blank with ${this.preference}: switching to the canvas renderer`)
      this.app.destroy({ removeView: true }, { children: false, texture: false, textureSource: false })
      this.app = new Application()
      this.preference = 'canvas'
      return this.startRenderer()
    }
    const c = this.app.canvas
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.imageRendering = 'pixelated'
    c.style.touchAction = 'none'
    c.style.display = 'block'
    this.host.appendChild(c)
    c.addEventListener('webglcontextlost', () => {
      // Pixi asks for the context back; if the browser doesn't return it soon, rebuild
      clearTimeout(this.lostTimer)
      this.lostTimer = setTimeout(() => { if (this.contextLost()) void this.rebuild() }, 1500)
    })
    c.addEventListener('webglcontextrestored', () => clearTimeout(this.lostTimer))
    this.app.ticker.add((t) => {
      this.people.update(Math.min(0.1, t.deltaMS / 1000))
      this.traders.update(Date.now())
      if (this.ambient && this.host) {
        const z = this.zoom
        this.ambient.view(this.cells, this.camX, this.camY, this.camX + this.host.clientWidth / z, this.camY + this.host.clientHeight / z, this.sceneScale)
        this.ambient.update(performance.now() / 1000, this.sceneScale)
      }
    })
    this.app.stage.addChild(this.root)
    this.resize()
    this.bindInput()
  }

  /** Renderer to try first (see startRenderer). iPhones and iPads use the
   *  canvas renderer: WebGL texturing has drawn blank or solid tiles there. */
  preference: 'webgl' | 'webgpu' | 'canvas' = (() => {
    const r = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('renderer') : null
    if (r === 'canvas' || r === 'webgpu' || r === 'webgl') return r
    return isIOS() ? 'canvas' : 'webgl'
  })()

  /** Draw one grass tile off-screen and read it back: some phone GPUs leave
   *  textures blank (flat white quads). A real tile has many colours. */
  private texturesWork(): boolean {
    const t = this.atlas.tex('t_grass_0')
    if (!t) return true
    try {
      const s = new Sprite(t.texture)
      const { pixels } = this.app.renderer.extract.pixels({ target: s })
      s.destroy()
      const seen = new Set<number>()
      for (let i = 0; i < pixels.length; i += 4 * 7) if (pixels[i + 3] > 200) seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
      return seen.size >= 3
    } catch (e) {
      console.warn('texture check failed', e)
      return true // can't tell: keep the renderer we have
    }
  }

  private lostTimer?: ReturnType<typeof setTimeout>
  private rebuilding = false

  private contextLost(): boolean {
    const gl = (this.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl
    return !!gl && gl.isContextLost()
  }

  /** Coming back to the tab (e.g. opening the laptop): make sure the map can draw. */
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.contextLost()) void this.rebuild()
  }

  private async rebuild() {
    if (this.rebuilding) return
    this.rebuilding = true
    try {
      this.app.stage.removeChild(this.root)
      // drop the dead renderer but keep our scene, textures and tile images
      this.app.destroy({ removeView: true }, { children: false, texture: false, textureSource: false })
      this.app = new Application()
      await this.startRenderer()
      if (this.last) this.render(this.last)
    } finally {
      this.rebuilding = false
    }
  }

  destroy() {
    this.ro?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisible)
    clearTimeout(this.lostTimer)
    this.app.destroy(true, { children: true })
  }

  resize() {
    const w = Math.max(1, Math.ceil(this.host.clientWidth / this.cssScale))
    const h = Math.max(1, Math.ceil(this.host.clientHeight / this.cssScale))
    this.app.renderer.resize(w, h)
    this.applyCamera()
  }

  /** step through ZOOMS: +1 in, -1 out */
  zoomStep(dir: number, anchor?: { x: number; y: number }) {
    const k = ZOOMS.indexOf(this.zoom)
    this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, k + dir))], anchor)
  }

  setZoom(z: number, anchor?: { x: number; y: number }) {
    // snap to the nearest level (in log space, so pinches feel even)
    const nz = ZOOMS.reduce((best, l) => (Math.abs(Math.log(l / z)) < Math.abs(Math.log(best / z)) ? l : best))
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
    this.camX = p.x - this.host.clientWidth / this.zoom / 2
    this.camY = p.y - tier * this.atlas.meta.tier - (this.host.clientHeight / this.zoom) * yFrac
    this.applyCamera()
  }

  private applyCamera() {
    const s = this.sceneScale
    this.root.scale.set(s)
    this.root.x = -Math.round(this.camX * s)
    this.root.y = -Math.round(this.camY * s)
  }

  // ---------------------------------------------------------------- scene

  render(input: SceneInput) {
    this.last = input
    const { world, state, viewer } = input
    const { tier: TP } = this.atlas.meta
    const W = this.W
    const walkers = new Set<unknown>([...this.people.nodes(), ...this.traders.nodes()])
    for (const c of this.cells.removeChildren()) if (!walkers.has(c)) c.destroy({ children: true })
    this.ambient ??= new Ambient(W)
    if (!this.mountains || (this.mountains as unknown as { world: World }).world !== world) this.mountains = new Mountains(world, W, TP)
    this.ambient.reset()
    // choosing a site shows the whole world at once: keep that screen still (and quick)
    const animate = !input.showAll
    this.overlay.removeChildren().forEach((c) => c.destroy())

    const revealed = visibleSet(input)
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
      things.set(idx(v.col, v.row), { name: 'f_village' })
    }

    const order: number[] = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0 + (c0 & 1 ? 1 : 0); c <= c1; c += 2) order.push(idx(c, r))
      for (let c = c0 + (c0 & 1 ? 0 : 1); c <= c1; c += 2) order.push(idx(c, r))
    }
    // draw rank of each hex: everything on a hex sorts as rank*4 + layer
    // (0 terrain column, 1 road/river, 3 features); villagers slot in at 2 or 3.5
    const rank = new Int32Array(world.cells.length).fill(-1)
    order.forEach((i, k) => { rank[i] = k })
    const z = (i: number, layer: number) => rank[i] * 4 + layer
    const hl = new Set(input.highlight ?? [])
    const blocked = new Set(input.blocked ?? [])
    // roads join each other and the places they lead to
    const roadSet = new Set<number>()
    const hubs = new Set<number>()
    for (const v of Object.values(state.villages)) {
      for (const r of v.roads) if (revealed.has(r)) roadSet.add(r)
      hubs.add(idx(v.col, v.row))
      for (const o of v.outposts) hubs.add(idx(o.col, o.row))
      for (const b of v.buildings) hubs.add(idx(b.col, b.row))
    }
    // development only (?roadtest): roads on every river hex and a scatter of their
    // neighbours, so every kind of crossing and bridge can be reviewed at once
    if (import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('roadtest')) {
      for (const i of revealed) {
        const c = world.cells[i]
        if (c.riverTo === -1 || c.tier === 0) continue
        roadSet.add(i)
        neighbours(c.col, c.row).forEach(([nc, nr], k) => {
          const j = idx(nc, nr)
          if (nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && world.cells[j].tier > 0 && (i * 7 + k * 3) % 5 < 2) roadSet.add(j)
        })
      }
    }

    for (const i of order) {
      const cell = world.cells[i]
      const known = revealed.has(i)
      const p = hexToPixel(cell.col, cell.row, W)
      const tier = known ? cell.tier : 0
      const cx = p.x, cy = p.y - tier * TP
      const land = known ? landAt(world, state, i, input.today) : null
      const deposit = !!land && isDeposit(land.resource, land.feature)
      const dim = !!input.prospect && known && !deposit
      const terrainName = land ? `t_${land.terrain}_${(cell.col * 7 + cell.row * 13) % 3}` : `t_deep_${(cell.col + cell.row) % 3}`
      const t = this.atlas.tex(terrainName)
      if (t) {
        const s = new Sprite(t.texture)
        s.cullable = true
        s.x = cx - t.frame.ax
        s.y = cy - t.frame.ay
        if (!known) s.tint = 0x3a3a58
        else if (hl.has(i)) s.tint = 0xfff0a0
        else if (blocked.has(i) && cell.tier > 0) s.tint = 0xffb4a8
        else if (dim) s.tint = DIM
        s.zIndex = z(i, 0)
        this.cells.addChild(s)
      }
      if (!known) continue
      if (WATER.has(land!.terrain)) {
        // surf where the water meets land, glints out on open water
        const corners = hexCorners(cx, cy, W)
        const edges: [number, number, number, number][] = []
        neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
          if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) return
          const ni = idx(nc, nr)
          if (!revealed.has(ni) || world.cells[ni].tier <= cell.tier) return
          const [a, b] = EDGE_CORNERS[k]
          edges.push([corners[a][0], corners[a][1], corners[b][0], corners[b][1]])
        })
        const deep = land!.terrain !== 'shallow', zw = z(i, 0.4), zs = z(i, 0.5)
        if (animate) this.ambient.add(cx, cy, () => [
          ...this.ambient.water(cx, cy, i, deep, edges.length > 0).map((n) => [n, zw] as [Container, number]),
          ...(edges.length ? this.ambient.shore(cx, cy, edges, i).map((n) => [n, zs] as [Container, number]) : []),
        ])
      } else if ((land!.terrain === 'meadow' || land!.terrain === 'savannah') && !land!.feature && !things.has(i) && ((i * 2654435761) >>> 0) % 3 === 0) {
        const zf = z(i, 0.5)
        if (animate) this.ambient.add(cx, cy, () => [[this.ambient.field(cx, cy, i, 2), zf]])
      }
      if (roadSet.has(i) || (hubs.has(i) && neighbours(cell.col, cell.row).some(([nc, nr]) => roadSet.has(idx(nc, nr)))))
      {
        const { g: rg, bridges } = this.road(world, i, cx, cy, roadSet, hubs)
        rg.zIndex = z(i, 1)
        this.cells.addChild(rg)
        // bridges go over the river (which is drawn after the road, covering it where they cross)
        if (bridges) { bridges.zIndex = z(i, 1.6); bridges.cullable = true; this.cells.addChild(bridges) }
      }
      if (cell.riverTo !== -1 && cell.tier > 0) {
        this.cells.addChild(this.river(world, i, cx, cy)).zIndex = z(i, 1)
        this.riverLife(world, i, cx, cy, revealed, z)
      }
      const thing = things.get(i)
      // forests, mountains and hills come in three shapes, picked per hex so ranges don't look stamped
      const variant = ((i * 2654435761) >>> 16) % 3
      // hills are the raised ground itself: no mounds drawn on top
      // (development review, ?roadtest&bare: no trees, to see the waterways)
      const bare = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('bare') && !MOUNTAIN_FEATURE.has(land!.feature ?? '')
      const natural = land!.feature && land!.feature !== 'hills' && !bare
        ? (variant && this.atlas.tex(`f_${land!.feature}_v${variant}`) ? `f_${land!.feature}_v${variant}` : `f_${land!.feature}`)
        : null
      // mines and quarries are dug into the mountain: keep the peak, put the shaft in front
      const dug = thing?.name === 'f_mine' && (land!.feature === 'mountain' || land!.feature === 'mountain_snow' || land!.feature === 'hills')
      const layers: { name: string; alpha: number; dx?: number; dy: number }[] = []
      // an outcrop on open ground says what's in it (on mountains, the ore stains the rock instead).
      // It comes in two halves: a mine, house, town or lair here takes the far half, and the near half stays.
      const outcrop = deposit && !MOUNTAIN_FEATURE.has(land!.feature ?? '')
      const ore = (part: 'front' | 'back') => ({ name: `f_ore_${land!.resource}_${part}`, alpha: 1, dy: 0 })
      if (outcrop) {
        const far = { dx: -Math.round(W * 0.15), dy: -Math.round(W * 0.07) }
        if (thing && land!.resource === 'clay') layers.push({ name: thing.name, alpha: thing.alpha ?? 1, dy: 0 })
        else if (thing) layers.push({ name: dug ? 'f_mine' : thing.name, alpha: thing.alpha ?? 1, ...far }, ore('front'))
        // clay shows as red banks along the river instead; salt is common and low: just the near half
        else if (land!.resource === 'clay') { if (natural) layers.push({ name: natural, alpha: 1, dy: 0 }) }
        else if (land!.resource === 'salt') layers.push(...(natural ? [{ name: natural, alpha: 1, dy: 0 }] : []), ore('front'))
        else layers.push(ore('back'), ...(natural ? [{ name: natural, alpha: 1, dy: 0 }] : []), ore('front'))
      }
      else if (dug && natural) layers.push({ name: natural, alpha: 1, dy: 0 }, { name: 'f_mine', alpha: thing!.alpha ?? 1, dy: Math.round(W / 10) })
      else if (dug) layers.push({ name: 'f_mine', alpha: thing!.alpha ?? 1, dy: 0 })
      else if (thing) layers.push({ name: thing.name, alpha: thing.alpha ?? 1, dy: 0 })
      else if (natural) layers.push({ name: natural, alpha: 1, dy: 0 })
      for (const l of layers) {
        if (l.name.startsWith('f_mountain')) {
          // ranges come from the height map, not a sprite
          const m = this.mountains!.slice(i)
          if (m) {
            const s = new Sprite(m.texture)
            s.cullable = true
            s.x = cx + m.ox
            s.y = cy + m.oy
            if (dim) s.tint = DIM
            s.zIndex = z(i, 3)
            this.cells.addChild(s)
          }
          continue
        }
        const f = this.atlas.tex(l.name)
        if (!f) continue
        const s = new Sprite(f.texture)
        s.cullable = true
        // anchored at its foot, so trees can sway from the ground
        s.anchor.set(f.frame.ax / f.frame.w, f.frame.ay / f.frame.h)
        s.x = cx + (l.dx ?? 0)
        s.y = cy + l.dy
        s.alpha = l.alpha
        if (dim) s.tint = DIM
        s.zIndex = z(i, 3)
        this.cells.addChild(s)
        if (l.name === 'f_farm' && l.alpha === 1) {
          const zf = z(i, 3.2)
          if (animate) this.ambient.add(cx, cy, () => [[this.ambient.field(cx, cy, i + 0.5), zf]])
        }
      }
    }

    this.mountains!.flush()

    // Territory borders: dashed, Civilization-style, and part of the painter's
    // order. Each border hex draws its outside edges at its own height just
    // above its ground (z = rank*4 + 0.5), so its own trees, mountains and
    // houses, nearer hexes and villagers all cover the line. Where border hexes
    // of different heights meet at a corner, a dashed stroke runs down the
    // cliff corner between them; it sorts with the hex further back, so it
    // shows on a visible cliff face and hides behind a taller hex in front.
    for (const v of Object.values(state.villages)) {
      const color = v.playerId === viewer ? 0xfff070 : 0xff90c0
      const terr = new Set(territoryCells(world, v))
      const ends = new Map<string, { x: number; y: number; cell: number }[]>() // ground-plane corner -> drawn ends
      for (const i of terr) {
        const cell = world.cells[i]
        if (!revealed.has(i) || rank[i] < 0) continue
        const p = hexToPixel(cell.col, cell.row, W)
        const lift = cell.tier * TP
        const corners = hexCorners(p.x, p.y - lift, W)
        let bg: Graphics | null = null
        neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
          const ni = nr * world.width + nc
          if (terr.has(ni)) return
          const [a, b] = EDGE_CORNERS[k]
          bg ??= new Graphics()
          dashed(bg, corners[a][0], corners[a][1], corners[b][0], corners[b][1], color)
          for (const c of [corners[a], corners[b]]) {
            const key = `${Math.round(c[0])},${Math.round(c[1] + lift)}`
            const list = ends.get(key)
            const e = { x: c[0], y: c[1], cell: i }
            if (list) list.push(e)
            else ends.set(key, [e])
          }
        })
        if (bg) { (bg as Graphics).zIndex = z(i, 0.5); this.cells.addChild(bg) }
      }
      for (const list of ends.values()) {
        if (list.length < 2) continue
        const ys = list.map((e) => e.y)
        const top = Math.min(...ys), bottom = Math.max(...ys)
        if (bottom - top < 0.5) continue
        const back = list.reduce((m, e) => (rank[e.cell] < rank[m.cell] ? e : m))
        const cg = new Graphics()
        dashed(cg, list[0].x, top, list[0].x, bottom, color)
        cg.zIndex = z(back.cell, 0.5)
        this.cells.addChild(cg)
      }
    }
    // selection and highlights stay on top of everything
    const g = new Graphics()
    // highlighted hexes (e.g. the spot chosen for a new village): gold wash + bold outline;
    // a linked hex gets the same treatment in pink
    const marks: [number, number, number][] = [...hl].map((i) => [i, 0xffe040, 0xfff6c0])
    const reviewing = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('roadtest')
    if (input.focus !== undefined && !hl.has(input.focus) && !reviewing) marks.push([input.focus, 0xff60b0, 0xffd0ec])
    for (const [i, wash, rim] of marks) {
      const cell = world.cells[i]
      if (!cell) continue
      const p = hexToPixel(cell.col, cell.row, W)
      const cs = hexCorners(p.x, p.y - (revealed.has(i) ? cell.tier : 0) * TP, W).flat()
      g.poly(cs, true).fill({ color: wash, alpha: 0.45 })
      g.poly(cs, true).stroke({ width: 4, color: 0x141424 })
      g.poly(cs, true).stroke({ width: 2, color: rim })
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
    this.people.sync(world, state, revealed)
    this.people.attach(this.cells, rank)
    this.traders.sync(world, state, revealed)
    this.traders.attach(this.cells, rank)
  }

  /** Dirt track across the hex top toward neighbouring roads/buildings; where it
   *  drops to a lower hex in front, wooden steps run down the visible cliff face. */
  private road(world: World, i: number, cx: number, cy: number, roads: Set<number>, hubs: Set<number>): { g: Graphics; bridges: Graphics | null } {
    const W = this.W
    const TP = this.atlas.meta.tier
    const g = new Graphics()
    const L = roadLayout(world, i, cx, cy, W, TP, roads, hubs)
    const dirt = 0xc09858, edge = 0x7a5830
    const w = L.width
    if (!L.legs.length) {
      g.ellipse(cx, cy, w + 1, Math.ceil(w / 2) + 1).fill(edge).ellipse(cx, cy, w, Math.ceil(w / 2)).fill(dirt)
      return { g, bridges: null }
    }
    // Each hex draws its half of every road segment, from its middle to the
    // shared edge, with flat (butt) ends: a round cap there would paint its
    // dark rim across the neighbour's dirt. Halves run 2 px past the edge so
    // the next hex's tile outline never shows through the join (that overlap is
    // the same dirt colour). All rims go down first, then all dirt, so no rim
    // ever lands on dirt. The middle gets a round patch so bends look smooth,
    // and a dead end gets a rounded tip.
    const rim = (w + 2) / 2, core = w / 2
    const legs = L.legs.map((leg) => extend(leg, 2, true))
    const { mid, tip } = L
    const paint = (width: number, r: number, color: number) => {
      for (const leg of legs) polyline(g, leg)
      if (tip) g.moveTo(tip[0], tip[1]).lineTo(mid[0], mid[1])
      g.stroke({ width, color, cap: 'butt', join: 'round' })
      // round patches where legs meet (the middle, or each hub on a river hex)
      g.circle(mid[0], mid[1], r).fill(color)
      for (const leg of legs) g.circle(leg[0][0], leg[0][1], r).fill(color)
      if (tip) g.circle(tip[0], tip[1], r).fill(color)
    }
    paint(w + 2, rim, edge)
    paint(w, core, dirt)
    for (const st of L.steps) {
      g.rect(st.x - 2, st.y0, 5, st.y1 - st.y0).fill(edge)
      for (let y = st.y0 + 1; y < st.y1; y += 2) g.rect(st.x - 1, y, 3, 1).fill(dirt)
    }
    // bridges where the road crosses the river (planned by roadLayout)
    let bridges: Graphics | null = null
    if (L.bridges.length) {
      bridges = new Graphics()
      for (const br of L.bridges) drawBridge(bridges, br.a, br.b, w)
    }
    return { g, bridges }
  }


  /** A river hex's shape: its width, the edge where it leaves (the lip), and
   *  its legs as curves through a slightly off-centre middle. Each leg runs from
   *  an edge (upstream legs first, then the downstream one from the middle). */
  private riverShape(world: World, i: number, cx: number, cy: number) {
    const R = riverLayout(world, i, cx, cy, this.W, this.atlas.meta.tier)
    // drawn paths run 2 px past each edge so neighbouring hexes overlap (no seam)
    return { ...R, paths: R.flows.map((f) => extend(f, 2, R.spring)) }
  }

  private river(world: World, i: number, cx: number, cy: number): Graphics {
    const { width, paths, spring } = this.riverShape(world, i, cx, cy)
    // Drawn on the ground plane and then foreshortened (half height), so the
    // water and its banks are thinner where the river runs across the screen
    // than where it runs up it, as they would be lying on the ground.
    const g = new Graphics()
    const flat = (pts: [number, number][], dy = 0) => pts.map(([x, y]) => [x, cy + (y - cy) * 2 + dy] as [number, number])
    const cell = world.cells[i]
    // river clay, wherever this hex or a neighbour holds clay
    const clay = cell.resource === 'clay' || neighbours(cell.col, cell.row).some(([nc, nr]) =>
      nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && world.cells[nr * world.width + nc].resource === 'clay')
    const paint = (color: number, w: number, dy = 0, cap: 'butt' | 'round' = 'butt') => {
      for (const path of paths) polyline(g, flat(path, dy))
      g.stroke({ width: w, color, cap, join: 'round' })
      if (spring) { const [sx, sy] = flat(paths[0], dy)[0]; g.circle(sx, sy, w / 2).fill(color) }
    }
    if (clay) {
      // Clay banks: a mottled band of red-brown clay with ochre, rust, grey and
      // dried-pale patches, wet and dark right at the water. Rounded ends, so
      // where the clay country starts or stops it tapers instead of squaring off.
      paint(0xa4684a, width + 2 + 4, 0, 'round')
      const rnd = mulberry32(i * 2654435761)
      const MOTTLE = [0xc08a54, 0x8e4a2e, 0x9a958a, 0xd4ae7c, 0xb06c44]
      for (const path of paths) {
        const pts = flat(path)
        for (let k = 0; k + 1 < pts.length; k++) {
          const [x0, y0] = pts[k], [x1, y1] = pts[k + 1]
          const len = Math.hypot(x1 - x0, y1 - y0) || 1
          const nx = -(y1 - y0) / len, ny = (x1 - x0) / len
          for (let d = 0; d < len; d += 1.6) {
            const t = d / len, side = rnd() < 0.5 ? -1 : 1
            const off = (width / 2 + 1.5 + rnd() * 5) * side
            const x = x0 + (x1 - x0) * t + nx * off, y = y0 + (y1 - y0) * t + ny * off
            g.ellipse(x, y, 1 + rnd() * 1.8, 1 + rnd() * 1.4).fill(MOTTLE[Math.floor(rnd() * MOTTLE.length)])
          }
        }
      }
      paint(0x84503a, width + 3) // wet clay at the water's edge
    } else {
      // an earthy cut where the river has worn into the ground
      paint(0x5c4a34, width + 4)
    }
    // the water sits a little below the ground: shifted down, it leaves the far bank's face showing
    paint(0x2868b8, width + 2, 2)
    paint(0x50a8f0, width, 2)
    g.scale.set(1, 0.5)
    g.y = cy / 2
    return g
  }


  /** Flowing current on a river hex, and a waterfall where it drops off a cliff toward the viewer. */
  private riverLife(world: World, i: number, cx: number, cy: number, revealed: Set<number>, z: (i: number, layer: number) => number) {
    const TP = this.atlas.meta.tier
    const cell = world.cells[i]
    const down = world.cells[cell.riverTo]
    const { width, lip, flows } = this.riverShape(world, i, cx, cy)
    const legs = flows
    const zr = z(i, 1.1)
    const animate = !this.last?.showAll
    if (animate) this.ambient.add(cx, cy, () => legs.flatMap((pts, k) => this.ambient.stream(pts, width, i * 7 + k).map((n) => [n, zr] as [Container, number])))
    // a waterfall shows only on the cliff faces facing us (the hex below is SE, S or SW)
    const drop = cell.tier - down.tier
    const k = neighbours(cell.col, cell.row).findIndex(([nc, nr]) => nr * world.width + nc === cell.riverTo)
    if (drop > 0 && k >= 1 && k <= 3 && revealed.has(cell.riverTo)) {
      // the water column down the cliff (static), then its motion (animated, near the camera only)
      const w = Math.max(2, width), x0 = Math.round(lip[0] - w / 2), y0 = Math.round(lip[1]), h = drop * TP
      const col = new Graphics()
      col.rect(x0 - 1, y0, w + 2, h).fill({ color: 0x2868b8 })
      col.rect(x0, y0, w, h).fill({ color: 0x50a8f0 })
      col.cullable = true
      col.zIndex = z(i, 1.15)
      this.cells.addChild(col)
      const zc = z(i, 1.2), zd = z(cell.riverTo, 1.2)
      if (animate) this.ambient.add(lip[0], lip[1], () => {
        const [col, splash] = this.ambient.fall(lip[0], lip[1], drop * TP, width, i)
        return [...col.map((n) => [n, zc] as [Container, number]), ...splash.map((n) => [n, zd] as [Container, number])]
      })
    }
  }

  // ---------------------------------------------------------------- input

  private pick(cssX: number, cssY: number) {
    const s = this.last
    if (!s) return null
    const x = this.camX + cssX / this.zoom
    const y = this.camY + cssY / this.zoom
    const TP = this.atlas.meta.tier
    const revealed = visibleSet(s)
    let best: { col: number; row: number; depth: number } | null = null
    for (let t = 0; t <= this.atlas.meta.maxTier; t++) {
      const h = pixelToHex(x, y + t * TP, this.W)
      if (h.col < 0 || h.row < 0 || h.col >= s.world.width || h.row >= s.world.height) continue
      const i = h.row * s.world.width + h.col
      const tier = revealed.has(i) ? s.world.cells[i].tier : 0
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
    // Wheel and trackpad: a Mac trackpad sends dozens of small wheel events per
    // swipe, so collect them and zoom one level per notch-sized amount, at most
    // every 260 ms. Pinch (ctrlKey) gives small deltas, so it needs less.
    let wheelAcc = 0, lastStep = 0
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      const NOTCH = e.ctrlKey ? 30 : 160
      if (Math.sign(px) !== Math.sign(wheelAcc)) wheelAcc = 0
      wheelAcc += px
      const now = performance.now()
      if (Math.abs(wheelAcc) < NOTCH || now - lastStep < 260) return
      const r = c.getBoundingClientRect()
      this.zoomStep(wheelAcc < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top })
      wheelAcc = 0
      lastStep = now
    }, { passive: false })
  }
}

/** Hexes drawn unfogged: everything while choosing a site (or with no
 *  player yet, or a visitor to an empty world), otherwise what any player in the world has seen. */
function visibleSet(s: SceneInput): Set<number> {
  // a visitor to a world nobody has explored yet sees the land waiting to be settled
  if (s.showAll || (!s.viewer && (!s.guest || !s.state.revealed.length))) return new Set(s.world.cells.map((_, i) => i))
  return new Set(s.state.revealed)
}

/** A chunky 2 px dashed line (3 on, 2 off), pixel-snapped, with a dark
 *  1 px shadow under each dash so it reads on light and dark ground. */
function dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 0.5) return
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len
  const ON = 3, OFF = 2
  for (let d = 0; d < len; d += ON + OFF) {
    const e = Math.min(len, d + ON)
    for (let t = d; t < e; t += 1) {
      const x = Math.round(x0 + ux * t), y = Math.round(y0 + uy * t)
      g.rect(x, y + 1, 2, 1).fill({ color: 0x141424, alpha: 0.45 })
      g.rect(x, y, 2, 1).fill(color)
    }
  }
}

// Skip drawing anything off-screen (matters most for the canvas renderer).
extensions.add(CullerPlugin)

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Zoom levels: below 1 shrinks the scene to see the whole continent. */
export const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6]

/** Corners of the projected top face (flat-top hex squashed to W x W/2),
 *  clockwise from the right-hand point. */
const WATER = new Set(['deep', 'ocean', 'shallow'])
const MOUNTAIN_FEATURE = new Set(['mountain', 'mountain_snow'])
const DIM = 0x5c5c70




function polyline(g: Graphics, pts: [number, number][]) {
  g.moveTo(pts[0][0], pts[0][1])
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1])
}

function hexCorners(cx: number, cy: number, W: number): [number, number][] {
  const hw = W / 2, qw = W / 4, hh = W / 4
  return [[cx + hw, cy], [cx + qw, cy + hh], [cx - qw, cy + hh], [cx - hw, cy], [cx - qw, cy - hh], [cx + qw, cy - hh]]
}

// neighbour order from hex.ts: NE, SE, S, SW, NW, N  ->  matching face edge (corner pairs)
const EDGE_CORNERS: [number, number][] = [[5, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
